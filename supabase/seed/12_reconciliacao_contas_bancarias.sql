-- ============================================================================
-- 12 — Reconciliação das contas bancárias da empresa (RF-FIN-01/02, 12-jun-2026)
-- ============================================================================
-- Estado-alvo do painel "Saldos por Banco" (5 cards), conforme o print enviado
-- pela Lola: CORA, SICREDI, SICREDINVEST, INTER, XP + Total Geral.
--
-- Dados oficiais (PDF "Considerações — 12 de junho"):
--   CORA          Banco 403 · Ag. 0001   · Conta Corrente     2347942-2
--   SICREDI       Coop. 748 · Ag. 0913   · Conta Corrente     29945-3
--   SICREDINVEST  Coop. 748 · Ag. 0913   · Conta Corrente     29945-3   (investimento)
--   INTER         Banco 077 · Ag. 0001-9 · Conta Corrente     18843124-1
--   XP            Banco 348 · Ag. 0001   · Conta Investimento 5740321
--
-- Regras desta rodada:
--   • Desconsiderar o "Sicredi MJU" (0902) — DESATIVADO, nunca deletado
--     (as transações históricas ficam intactas, só somem do painel/Total Geral).
--   • Incluir o INTER.
--   • Reaproveitar a conta XP existente e desativar as contas de investimento
--     antigas que saíram do painel (Invest, Invest Evolutivo).
--
-- IDEMPOTENTE: pode rodar várias vezes. Depende das colunas numero_banco/
-- tipo_instituicao (migration 0030) e deve rodar DEPOIS dos seeds 03 e 0011.

-- ---------------------------------------------------------------------------
-- CORA (corrente)
-- ---------------------------------------------------------------------------
update public.contas_bancarias_empresa set
  apelido          = 'CORA',
  banco            = 'Banco Cora',
  tipo_instituicao = 'banco',
  numero_banco     = '403',
  agencia          = '0001',
  numero_conta     = '2347942',
  digito           = '2',
  tipo             = 'corrente',
  ativa            = true,
  ordem            = 1
where nome = 'Banco Cora (0001)';

-- ---------------------------------------------------------------------------
-- SICREDI (corrente — cooperativa 0913)
-- ---------------------------------------------------------------------------
update public.contas_bancarias_empresa set
  apelido          = 'SICREDI',
  banco            = 'Cooperativa Sicredi',
  tipo_instituicao = 'cooperativa',
  numero_banco     = '748',
  agencia          = '0913',
  numero_conta     = '29945',
  digito           = '3',
  tipo             = 'corrente',
  ativa            = true,
  ordem            = 2
where nome = 'Cooperativa Sicredi (0913)';

-- ---------------------------------------------------------------------------
-- SICREDI MJU (0902) — desconsiderar do painel, preservando histórico
-- ---------------------------------------------------------------------------
update public.contas_bancarias_empresa set ativa = false
where nome = 'Cooperativa Sicredi (0902)';

-- ---------------------------------------------------------------------------
-- SICREDINVEST (investimento — mesma cooperativa/agência/conta da Sicredi)
-- Conta nova: começa zerada (R$ 0,00 no print). upsert pela chave única `nome`.
-- ---------------------------------------------------------------------------
insert into public.contas_bancarias_empresa
  (nome, apelido, banco, tipo_instituicao, numero_banco, agencia, numero_conta, digito, tipo, ativa, ordem)
values
  ('Cooperativa Sicredi Investimento (0913)', 'SICREDINVEST', 'Cooperativa Sicredi', 'cooperativa',
   '748', '0913', '29945', '3', 'investimento', true, 3)
on conflict (nome) do update set
  apelido          = excluded.apelido,
  banco            = excluded.banco,
  tipo_instituicao = excluded.tipo_instituicao,
  numero_banco     = excluded.numero_banco,
  agencia          = excluded.agencia,
  numero_conta     = excluded.numero_conta,
  digito           = excluded.digito,
  tipo             = excluded.tipo,
  ativa            = true,
  ordem            = excluded.ordem;

-- ---------------------------------------------------------------------------
-- INTER (corrente) — incluir
-- ---------------------------------------------------------------------------
insert into public.contas_bancarias_empresa
  (nome, apelido, banco, tipo_instituicao, numero_banco, agencia, numero_conta, digito, tipo, ativa, ordem)
values
  ('Banco Inter (0001-9)', 'INTER', 'Banco Inter', 'banco',
   '077', '0001-9', '18843124', '1', 'corrente', true, 4)
on conflict (nome) do update set
  apelido          = excluded.apelido,
  banco            = excluded.banco,
  tipo_instituicao = excluded.tipo_instituicao,
  numero_banco     = excluded.numero_banco,
  agencia          = excluded.agencia,
  numero_conta     = excluded.numero_conta,
  digito           = excluded.digito,
  tipo             = excluded.tipo,
  ativa            = true,
  ordem            = excluded.ordem;

-- ---------------------------------------------------------------------------
-- XP (investimento) — reaproveita a conta de investimento existente
-- ---------------------------------------------------------------------------
update public.contas_bancarias_empresa set
  apelido          = 'XP',
  banco            = 'XP Investimentos',
  tipo_instituicao = 'banco',
  numero_banco     = '348',
  agencia          = '0001',
  numero_conta     = '5740321',
  digito           = null,
  tipo             = 'investimento',
  ativa            = true,
  ordem            = 5
where nome = 'XP (Conta)';

-- ---------------------------------------------------------------------------
-- Contas de investimento antigas que saíram do painel (preserva histórico)
-- ---------------------------------------------------------------------------
update public.contas_bancarias_empresa set ativa = false
where nome in ('Invest', 'Invest Evolutivo');

-- ----------------------------------------------------------------------------
-- ROLLBACK (reverter a reconciliação — reativa as contas antigas):
--   update public.contas_bancarias_empresa set ativa = true
--     where nome in ('Cooperativa Sicredi (0902)', 'Invest', 'Invest Evolutivo');
--   delete from public.contas_bancarias_empresa
--     where nome in ('Cooperativa Sicredi Investimento (0913)', 'Banco Inter (0001-9)')
--       and not exists (select 1 from public.transacoes_empresa t
--                       where t.conta_bancaria_id = contas_bancarias_empresa.id);
-- ----------------------------------------------------------------------------
