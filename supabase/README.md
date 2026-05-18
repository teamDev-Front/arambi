# AramBI — Supabase

Schema, RLS e seeds derivados da planilha `Provisionamento_FLUXO DE CAIXA 2025.xlsx`.

## Estrutura

```
supabase/
├── migrations/          DDL (schema, índices, triggers, RLS)
│   ├── 0001_extensions_and_helpers.sql
│   ├── 0002_enums.sql
│   ├── 0003_users_e_perfis.sql
│   ├── 0004_cadastros.sql
│   ├── 0005_transacoes.sql
│   ├── 0006_obra_lts.sql
│   ├── 0007_sistema_aplicacao.sql
│   ├── 0008_views_dashboard.sql
│   ├── 0009_rls.sql
│   ├── 0010_saldo_por_banco.sql
│   ├── 0011_contas_investimento.sql
│   ├── 0012_promover_admin.sql
│   ├── 0013_garantir_perfil_admin.sql
│   ├── 0014_vendas_e_safra.sql
│   ├── 0015_bancos_e_pdfmonkey.sql
│   └── 0016_documentos_gerados.sql      ← tabela + bucket Storage p/ recibos & termos via código
├── seed/                Dados de domínio (extraídos da planilha)
│   ├── 01_classificacao_financeira.sql      78 linhas (plano de contas)
│   ├── 02_classificacao_pessoal.sql         6 linhas (categorias dos sócios)
│   ├── 03_contas_bancarias_empresa.sql      3 linhas
│   ├── 04_socios.sql                        4 linhas
│   ├── 05_contas_bancarias_socio.sql        11 linhas (Pedro: nenhuma)
│   ├── 06_despesas_recorrentes.sql          85 linhas (Pedro: nenhuma)
│   ├── 07_recibo_modelos.sql                5 linhas
│   └── 08_obra_parametros.sql               8 parâmetros
└── apply_all.sql        Tudo concatenado — para colar no SQL Editor do Supabase
```

## Como aplicar (Supabase Cloud)

1. Abrir o **SQL Editor** do projeto Supabase em <https://supabase.com/dashboard/project/acxrdcszcbrisnerkzvg/sql>.
2. Abrir uma nova query.
3. Copiar **todo o conteúdo de `apply_all.sql`** e colar no editor.
4. Clicar em **Run**.

Tudo é **idempotente** (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`) — pode rodar várias vezes sem erro.

> Tempo aproximado: 5–10 segundos. ~1.7k linhas de SQL.

## Como aplicar (psql local, opcional)

Se tiver `psql` e a URL Postgres do projeto:

```bash
psql "postgresql://postgres.<projref>:<senha>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
  -f arambi/supabase/apply_all.sql
```

## Verificar a aplicação

No SQL Editor do Supabase, rode:

```sql
-- Conta quantas tabelas/views/types foram criadas
select
  (select count(*) from pg_tables where schemaname = 'public')                                  as tabelas,
  (select count(*) from pg_views  where schemaname = 'public' and viewname like 'v\_%')         as views,
  (select count(*) from pg_type   where typcategory = 'E' and typnamespace =
       (select oid from pg_namespace where nspname='public'))                                   as enums,
  (select count(*) from public.classificacao_financeira)                                        as plano_contas,
  (select count(*) from public.socios)                                                          as socios,
  (select count(*) from public.despesas_recorrentes_socio)                                      as despesas_recorrentes;
```

Esperado:
- **tabelas:** 17 (users, classificacao_financeira, classificacao_pessoal, socios, contas_bancarias_empresa, contas_bancarias_socio, despesas_recorrentes_socio, fornecedores, transacoes_empresa, transacoes_socio, obra_lts_itens, obra_pendencias, notas_em_grupo, obra_parametros, estoque, documentos, recibo_modelos, recibos, chat_sessions, chat_mensagens, logs)
- **views:** 7 (v_kpi_mensal, v_por_conta_contabil_mensal, v_por_centro_custo_mensal, v_saldo_por_banco_mensal, v_obra_resumo_atual, v_obra_totais, v_capinha_socio_mensal, v_distribuicao_lucro_mensal)
- **enums:** 11
- **plano_contas:** 78
- **socios:** 4
- **despesas_recorrentes:** 85

## Próximo passo

Importar as transações da planilha (Aramburu_Mensal + Distribuição de Lucro_Mensal) → script `scripts/import_planilha.mjs` (a ser criado).

## Como regerar os seeds

Se a planilha for atualizada, regere os seeds:

```bash
cd _analise_planilha
node 10_gen_seeds.mjs    # gera supabase/seed/*.sql
node 11_concat_all.mjs   # gera supabase/apply_all.sql
```
