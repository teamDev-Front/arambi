-- ============================================================================
-- 0014 — Vendas Futuras + Armazéns + Depósitos de Safra
-- ============================================================================
-- Espelha as planilhas-satélite "Provisionamento_VENDAS 2026.xlsx" e
-- "Provisionamento Safra 25.25 - Copasul.xlsx" (vide ANALISE-NOVAS-PLANILHAS.md).
--
-- Conceitos:
--   • vendas_provisionadas  → contratos de venda já firmados, aguardando pgto
--   • armazens              → cadastro dos cerealistas (Copasul, etc)
--   • safra_depositos       → cada DFe/NFP de produto entregue no armazém
--   • A view v_safra_depositos_calculado aplica fórmulas da planilha
--     (quebra técnica, taxa de armazenagem, taxa de devolução) usando uma
--     data parametrizada — o front passa a "Data Atual" via filtro.

-- ---------------------------------------------------------------------------
-- Enums novos
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'cultura_safra') then
    create type public.cultura_safra as enum ('soja','milho','sorgo','girassol','algodao','feijao','trigo');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'venda_status') then
    create type public.venda_status as enum (
      'firmada',          -- contrato assinado, aguardando pagamento
      'parcial',          -- alguma parcela já paga
      'liquidada',        -- 100% recebida
      'cancelada'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'safra_deposito_status') then
    create type public.safra_deposito_status as enum (
      'armazenado',       -- em estoque no armazém
      'vendido_parcial',
      'vendido_total',
      'retirado',         -- retirado sem venda
      'baixa'             -- baixa por perda/sinistro
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Armazéns (cooperativas / cerealistas)
-- ---------------------------------------------------------------------------
create table if not exists public.armazens (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null unique,                -- "Copasul"
  apelido       text,                                -- "Copasul Maracaju"
  cnpj          text,
  cidade        text,
  uf            text,
  observacao    text,
  ativo         boolean not null default true,
  ordem         smallint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists tg_armazens_updated_at on public.armazens;
create trigger tg_armazens_updated_at
  before update on public.armazens
  for each row execute function public.tg_set_updated_at();

comment on table public.armazens is
  'Cerealistas/cooperativas onde a Aramburu armazena grãos para venda futura.';

-- ---------------------------------------------------------------------------
-- Parâmetros de cálculo da safra (taxas)
-- ---------------------------------------------------------------------------
-- Cada combinação (armazém, cultura, safra) tem suas taxas próprias.
-- Vem das constantes da aba Detalhado__ (L13, P13, S13) da planilha Copasul.
create table if not exists public.safra_parametros (
  id                          uuid primary key default gen_random_uuid(),
  armazem_id                  uuid not null references public.armazens(id) on delete cascade,
  cultura                     public.cultura_safra not null,
  safra                       text not null,                          -- "24/25", "25/25"
  -- Constantes de cálculo
  quebra_quinzena_pct         numeric(8,5) not null default 0.0015,   -- 0.15%
  armazenagem_por_kg_quinzena numeric(10,4) not null default 0.20,    -- R$/kg/quinzena
  devolucao_por_saca          numeric(10,4) not null default 4.75,    -- R$/saca
  carencia_dias               smallint not null default 30,           -- período sem cobrança
  kg_por_saca                 numeric(6,2) not null default 60.00,    -- conversão base
  -- Inputs do dashboard
  data_atual                  date not null default current_date,     -- usada nos cálculos
  cotacao_simulada_sc         numeric(10,2),                          -- R$/saca para simular venda
  observacao                  text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (armazem_id, cultura, safra)
);

create index if not exists idx_sp_armazem on public.safra_parametros(armazem_id);

drop trigger if exists tg_sp_updated_at on public.safra_parametros;
create trigger tg_sp_updated_at
  before update on public.safra_parametros
  for each row execute function public.tg_set_updated_at();

comment on table public.safra_parametros is
  'Constantes e inputs editáveis por (armazem, cultura, safra) — espelha L13/P13/S13/F7/E20 da aba Detalhado__ Copasul.';

-- ---------------------------------------------------------------------------
-- Depósitos da safra (cada DFe/NFP entregue no armazém)
-- ---------------------------------------------------------------------------
create table if not exists public.safra_depositos (
  id                  uuid primary key default gen_random_uuid(),
  armazem_id          uuid not null references public.armazens(id) on delete restrict,
  cultura             public.cultura_safra not null,
  safra               text not null,                                  -- "25/25"
  data_deposito       date not null,
  dfe_entrada         text,                                           -- "54383"
  nfp                 text,                                           -- "8285721"
  kg_bruto            numeric(15,3) not null check (kg_bruto >= 0),
  status              public.safra_deposito_status not null default 'armazenado',
  observacao          text,
  origem_planilha     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.users(id) on delete set null
);

create index if not exists idx_sd_armazem  on public.safra_depositos(armazem_id);
create index if not exists idx_sd_cultura  on public.safra_depositos(cultura);
create index if not exists idx_sd_safra    on public.safra_depositos(safra);
create index if not exists idx_sd_data     on public.safra_depositos(data_deposito);
create index if not exists idx_sd_status   on public.safra_depositos(status);

drop trigger if exists tg_sd_updated_at on public.safra_depositos;
create trigger tg_sd_updated_at
  before update on public.safra_depositos
  for each row execute function public.tg_set_updated_at();

comment on table public.safra_depositos is
  'Cada DFe entregue no armazém — espelha R16:R31 da aba Detalhado__ Copasul.';

-- ---------------------------------------------------------------------------
-- View calculada: aplica fórmulas da planilha sobre cada depósito
-- ---------------------------------------------------------------------------
-- Reproduz exatamente:
--   I_r = (H_r - C_r) - carencia        (dias percorridos)
--   J_r = I_r / 15                      (quinzenas)
--   L_r = quebra_pct * J_r * F_r        (quebra técnica em kg)
--   M_r = F_r - L_r                     (produto líquido em kg)
--   N_r = M_r / kg_por_saca             (líquido em sacas)
--   Q_r = M_r * I_r * (P13/15) / kg_por_saca   (taxa armazenagem)
--   S_r = G_r * devolucao_sc            (taxa devolução)
--   U_r = Q_r + S_r                     (total a descontar)
--   W_r = N_r * cotacao_sc              (valor venda simulado)
create or replace view public.v_safra_depositos_calculado as
select
  d.id,
  d.armazem_id,
  a.nome           as armazem_nome,
  a.apelido        as armazem_apelido,
  d.cultura,
  d.safra,
  d.data_deposito,
  d.dfe_entrada,
  d.nfp,
  d.kg_bruto,
  d.status,
  d.observacao,
  d.created_at,
  d.updated_at,
  -- Parâmetros vigentes
  p.id                          as parametros_id,
  p.quebra_quinzena_pct,
  p.armazenagem_por_kg_quinzena,
  p.devolucao_por_saca,
  p.carencia_dias,
  p.kg_por_saca,
  p.data_atual,
  p.cotacao_simulada_sc,
  -- Conversões base
  (d.kg_bruto / p.kg_por_saca)::numeric(15,4)            as sc_bruto,
  -- Tempo decorrido (descontando carência)
  greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::int as dias_percorridos,
  (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)::numeric(10,4) as quinzenas,
  -- Quebra técnica
  (
    (p.quebra_quinzena_pct *
     (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)
    ) * d.kg_bruto
  )::numeric(15,3) as quebra_kg,
  -- Produto líquido
  (
    d.kg_bruto -
    (p.quebra_quinzena_pct *
     (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)
    ) * d.kg_bruto
  )::numeric(15,3) as kg_liquido,
  (
    (
      d.kg_bruto -
      (p.quebra_quinzena_pct *
       (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)
      ) * d.kg_bruto
    ) / p.kg_por_saca
  )::numeric(15,4) as sc_liquida,
  -- Taxa de armazenagem  =  kg_liq * dias * (armaz/15) / kg_por_saca
  (
    (
      d.kg_bruto -
      (p.quebra_quinzena_pct *
       (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)
      ) * d.kg_bruto
    )
    * greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric
    * (p.armazenagem_por_kg_quinzena / 15)
    / p.kg_por_saca
  )::numeric(15,2) as taxa_armazenagem,
  -- Taxa de devolução  =  sc_bruta * devolucao_sc
  ( (d.kg_bruto / p.kg_por_saca) * p.devolucao_por_saca )::numeric(15,2) as taxa_devolucao,
  -- TOTAL A DESCONTAR
  (
    (
      d.kg_bruto -
      (p.quebra_quinzena_pct *
       (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)
      ) * d.kg_bruto
    )
    * greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric
    * (p.armazenagem_por_kg_quinzena / 15)
    / p.kg_por_saca
    +
    (d.kg_bruto / p.kg_por_saca) * p.devolucao_por_saca
  )::numeric(15,2) as total_a_descontar,
  -- VALOR DE VENDA (simulado): sc_liq × cotacao
  (
    (
      (
        d.kg_bruto -
        (p.quebra_quinzena_pct *
         (greatest((p.data_atual - d.data_deposito) - p.carencia_dias, 0)::numeric / 15)
        ) * d.kg_bruto
      ) / p.kg_por_saca
    ) * coalesce(p.cotacao_simulada_sc, 0)
  )::numeric(15,2) as valor_venda_simulado
from public.safra_depositos d
join public.armazens a            on a.id = d.armazem_id
left join public.safra_parametros p on p.armazem_id = d.armazem_id
                                    and p.cultura = d.cultura
                                    and p.safra = d.safra;

comment on view public.v_safra_depositos_calculado is
  'Cada depósito enriquecido com cálculos da planilha (quebra, armazenagem, devolução, valor venda). Usa safra_parametros.data_atual como "Data Atual".';

-- ---------------------------------------------------------------------------
-- Vendas Provisionadas (Provisionamento_VENDAS 2026)
-- ---------------------------------------------------------------------------
-- Destino_da_venda: para qual entidade vai o valor (empresa Aramburu ou um sócio direto).
create table if not exists public.vendas_provisionadas (
  id                  uuid primary key default gen_random_uuid(),
  data_venda          date not null,                          -- data do contrato
  comprador           text not null,                          -- "Copasul"
  cultura             public.cultura_safra not null,
  safra               text not null,                          -- "24/25"
  aut_fixacao         text,                                   -- nº autorização de fixação
  numero_contrato     text,                                   -- "153076"
  nota_fiscal         text,
  kg                  numeric(15,3) not null check (kg >= 0),
  preco_sc            numeric(12,4) not null,                 -- R$/saca
  kg_por_saca         numeric(6,2) not null default 60.00,
  data_pgto_prevista  date not null,                          -- quando vai cair na conta
  destino_empresa     boolean not null default true,          -- true=Aramburu, false=socio_id setado
  socio_destino_id    uuid references public.socios(id) on delete set null,
  taxa_armazenagem    numeric(12,2) not null default 0,
  observacao          text,
  status              public.venda_status not null default 'firmada',
  -- Conexão com transação real quando paga
  transacao_empresa_id uuid references public.transacoes_empresa(id) on delete set null,
  origem_planilha     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.users(id) on delete set null,
  check (destino_empresa or socio_destino_id is not null)
);

create index if not exists idx_vp_data_pgto  on public.vendas_provisionadas(data_pgto_prevista);
create index if not exists idx_vp_data_venda on public.vendas_provisionadas(data_venda);
create index if not exists idx_vp_status     on public.vendas_provisionadas(status);
create index if not exists idx_vp_safra      on public.vendas_provisionadas(safra);
create index if not exists idx_vp_cultura    on public.vendas_provisionadas(cultura);
create index if not exists idx_vp_socio      on public.vendas_provisionadas(socio_destino_id);

drop trigger if exists tg_vp_updated_at on public.vendas_provisionadas;
create trigger tg_vp_updated_at
  before update on public.vendas_provisionadas
  for each row execute function public.tg_set_updated_at();

comment on table public.vendas_provisionadas is
  'Contratos de venda firmados aguardando pgto futuro — espelha Provisionamento_VENDAS 2026.xlsx.';

-- ---------------------------------------------------------------------------
-- View enriquecida + agregados por trimestre/mês
-- ---------------------------------------------------------------------------
create or replace view public.v_vendas_provisionadas as
select
  v.*,
  (v.kg / v.kg_por_saca)::numeric(15,4) as sacas,
  ((v.kg / v.kg_por_saca) * v.preco_sc)::numeric(15,2) as valor_total,
  s.nome_completo as socio_destino_nome,
  s.apelido       as socio_destino_apelido,
  -- Mês & trimestre do recebimento
  public.fn_mes_referencia(v.data_pgto_prevista) as mes_recebimento,
  case
    when extract(month from v.data_pgto_prevista) <= 3 then '1º TRI'
    when extract(month from v.data_pgto_prevista) <= 6 then '2º TRI'
    when extract(month from v.data_pgto_prevista) <= 9 then '3º TRI'
    else '4º TRI'
  end as trimestre_recebimento
from public.vendas_provisionadas v
left join public.socios s on s.id = v.socio_destino_id;

comment on view public.v_vendas_provisionadas is
  'Vendas com sacas, valor_total e mês/trim de recebimento calculados.';

-- Agregação por trimestre/destino (alimenta o card de "Saldo Futuro")
create or replace view public.v_vendas_por_trimestre as
select
  destino_empresa,
  socio_destino_id,
  cultura,
  safra,
  trimestre_recebimento,
  count(*)                 as qtd,
  sum(sacas)               as sacas_total,
  sum(valor_total)         as valor_total
from public.v_vendas_provisionadas
group by destino_empresa, socio_destino_id, cultura, safra, trimestre_recebimento
order by safra, trimestre_recebimento;

create or replace view public.v_vendas_por_mes as
select
  destino_empresa,
  socio_destino_id,
  cultura,
  safra,
  mes_recebimento,
  count(*)                 as qtd,
  sum(sacas)               as sacas_total,
  sum(valor_total)         as valor_total
from public.v_vendas_provisionadas
group by destino_empresa, socio_destino_id, cultura, safra, mes_recebimento
order by safra, mes_recebimento;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.armazens enable row level security;
drop policy if exists armazens_read on public.armazens;
create policy armazens_read on public.armazens
  for select using (auth.uid() is not null);
drop policy if exists armazens_write on public.armazens;
create policy armazens_write on public.armazens
  for all using (public.fn_can_write()) with check (public.fn_can_write());

alter table public.safra_parametros enable row level security;
drop policy if exists sp_read on public.safra_parametros;
create policy sp_read on public.safra_parametros
  for select using (auth.uid() is not null);
drop policy if exists sp_write on public.safra_parametros;
create policy sp_write on public.safra_parametros
  for all using (public.fn_can_write()) with check (public.fn_can_write());

alter table public.safra_depositos enable row level security;
drop policy if exists sd_read on public.safra_depositos;
create policy sd_read on public.safra_depositos
  for select using (auth.uid() is not null);
drop policy if exists sd_write on public.safra_depositos;
create policy sd_write on public.safra_depositos
  for all using (public.fn_can_write()) with check (public.fn_can_write());

alter table public.vendas_provisionadas enable row level security;
drop policy if exists vp_read on public.vendas_provisionadas;
create policy vp_read on public.vendas_provisionadas
  for select using (auth.uid() is not null);
drop policy if exists vp_write on public.vendas_provisionadas;
create policy vp_write on public.vendas_provisionadas
  for all using (public.fn_can_write()) with check (public.fn_can_write());
