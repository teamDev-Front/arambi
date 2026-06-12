# Diagnóstico técnico — Home > Financeiro (ajustes 12-jun-2026)

> Escopo desta rodada: **somente Home > Financeiro** (RF-FIN-01 a RF-FIN-09).
> Itens de Home > Documentos do PDF estão **fora de escopo** (já em produção).
> Base: leitura read-only do código real (`arambi/`) + 7 agentes de diagnóstico paralelos.

---

## 1. Arquitetura atual do módulo financeiro

O módulo se espalha por **duas telas** que o cliente trata como "Financeiro":

| Tela | Rota real | Componente | O que mostra |
|------|-----------|------------|--------------|
| **Home / Dashboard** | `src/app/dashboard/page.tsx` | `components/dashboard/DashboardHome.tsx` | Cards "SALDOS POR BANCO" + Total Geral, gráfico donut "Despesa por Conta Contábil", barras receita/despesa |
| **Financeiro** | `src/app/dashboard/financeiro/page.tsx` | `components/financeiro/FinanceiroPage.tsx` | KPIs (inclui "Total no banco"), barra de filtros, tabela de Lançamentos, modal CRUD |
| **Relatórios** | `src/app/dashboard/relatorios/page.tsx` | `components/relatorios/RelatoriosPage.tsx` | Geração de PDFs via PDFMonkey (Capa Empresa, Capa Sócio, Relatório Contábil, Relatório Sócios) |

> ⚠️ Armadilha de rotas: a pasta `src/app/(dashboard)/**` só redireciona; o conteúdo real vive em `src/app/dashboard/**`.

**Dados são 100% reais (Supabase)** — não há mocks nesta área. Tabela central: `transacoes_empresa` (≈739 linhas). Saldos/agregações vêm de views Postgres (`v_saldo_atual_por_banco`, `v_por_conta_contabil_mensal`, etc.).

---

## 2. Componentes encontrados (por requisito)

| RF | Onde mexer |
|----|-----------|
| RF-FIN-01/02 cards bancários | `dashboard/SaldosBancariosGrid.tsx`, `lib/queries/dashboard.ts` (interface `SaldoAtualBanco`), migration `0010_saldo_por_banco.sql` (view), seed `03_contas_bancarias_empresa.sql`, `bancos/BancosPage.tsx`, `dashboard/BancoDetalheModal.tsx` |
| RF-FIN-03 % no donut | `dashboard/DashboardHome.tsx` (L106-118 `pieData`, L274-286 legenda) |
| RF-FIN-04 paleta lateral | `layout/Sidebar.tsx`, `app/globals.css`, `tailwind.config.ts` |
| RF-FIN-05 cores de status | `ui/Badge.tsx`, `FinanceiroPage.tsx` (`statusBadgeVariant`), `LancamentoDetalheModal.tsx`, `BancoDetalheModal.tsx`, `SaldosBancariosGrid.tsx` |
| RF-FIN-06 Emissão/Vencimento | migration nova (`data_emissao`), `types/database.ts`, `FinanceiroPage.tsx` (tabela+modal), `LancamentoDetalheModal.tsx` |
| RF-FIN-07 "Total no banco" | `FinanceiroPage.tsx` L274-300 (KpiCard) |
| RF-FIN-08 filtro Centro de Custo | `FinanceiroPage.tsx` (UI). Backend `lib/queries/financeiro.ts` **já suporta** (`centroCustoCod`, L66) |
| RF-FIN-09 relatório por escopo | `RelatoriosPage.tsx`, `lib/pdfmonkey/{frontend,builders,types}.ts`, `api/pdfmonkey/generate/route.ts`, `FinanceiroPage.tsx` (seleção), migration (`scope_applied`) |

---

## 3. Cards bancários e saldos (RF-FIN-01, 02, 07)

**Estado atual:** `SaldosBancariosGrid` renderiza um card por conta vinda de `v_saldo_atual_por_banco`. O subtítulo mostra só instituição + agência (`Banco Cora • ag. 0001`). **Não há logo, nem nº do banco, nem nº da conta exibidos.**

**Lacunas de dados (schema):**
- ❌ Não existe coluna `numero_banco` (código BACEN 403/748/077/348).
- `numero_conta` e `digito` existem (migration `0015`) mas estão **vazios** e nunca são exibidos.
- ❌ Não existe `Inter` no seed; existe `Sicredi MJU` (0902) que deve sair.
- ❌ Não existem assets de logo no projeto.

**Contas reais hoje no banco (6):** Banco Cora (0001, corrente), Sicredi MJU (0902, corrente), Sicredi CGR (0913, corrente), XP Conta / Invest / Invest Evolutivo (3× investimento, instituição "XP Investimentos").

**Painel desejado pelo cliente (5):** CORA, SICREDI, SICREDINVEST, INTER, XP — dados exatos fornecidos no PDF (ver §10, dúvida D-1).

**"Total no banco" (RF-FIN-07):** é o `KpiCard` em `FinanceiroPage.tsx` L275-280 — mostra `String(total)` (a **contagem** de lançamentos, ex. `731`), não um valor financeiro. **Puramente visual, não entra em nenhum cálculo.** Remoção segura.

---

## 4. Gráficos financeiros (RF-FIN-03)

Donut "Despesa por Conta Contábil" em `DashboardHome.tsx`: `pieData` filtra `natureza='saida'`, agrupa por `conta_contabil_cod`, top 8, ordena desc. Legenda customizada mostra **código + nome + R$**, sem percentual. Tooltip mostra só R$.

**Mudança:** calcular `total` das saídas no `pieData`, anexar `percentual` por item (1 casa decimal), exibir na legenda (e tooltip). Tratar `total = 0` (sem divisão por zero). Respeita o filtro de mês automaticamente (recompute via `useMemo`). Sem migration.

---

## 5. Tabela de lançamentos (RF-FIN-06, 08, 09)

Tabela HTML estática, 9 colunas: `Data, Conta, Centro de Custo, Descrição, Fornecedor, Banco, Status, Valor, Ações`. Filtros client-side (state, sem URL params): busca, status, conta contábil (N2), mês, banco. **Sem seleção de linhas (checkbox).**

- **RF-FIN-06:** coluna "Data" usa `t.data`. Renomear cabeçalho → **Vencimento**; adicionar coluna **Emissão** (`t.data_emissao`, nova). São campos distintos — vencimento nunca é sobrescrito.
- **RF-FIN-08:** "Centro de Custo" **já é modelado** (`centro_custo_cod` = nível 3 do plano de contas, filho da Conta Contábil N2). Query já filtra por ele. Falta só o `<select>` na barra + ligar o state.
- **RF-FIN-09 (suporte):** adicionar seleção manual (checkbox por linha + selecionar página) e expor `{filtros, idsSelecionados}` para a geração de relatório.

---

## 6. Filtros atuais

`FinanceiroPage` mantém 5 filtros em `useState`; cada mudança faz `setPage(1)` + refetch server-side (`listarTransacoesEmpresa`). Backend (`financeiro.ts`) aceita: `search, status, contaContabilCod, centroCustoCod, contaBancariaId, mesReferencia, dataDe, dataAte` — **`centroCustoCod` já implementado mas não usado pela UI**.

---

## 7. Geração de relatórios (RF-FIN-09) — maior esforço

**Hoje:** o único parâmetro é o **mês** (`mes_referencia`). `RelatoriosPage` → `gerarPdfBloqueante({slug, mes_referencia})` → `/api/pdfmonkey/generate` → builder consulta `transacoes_empresa`/views **com `eq('mes_referencia', …)`** e monta o payload. A **Capa Empresa** sempre inclui **todas as contas ativas** (`contas_bancarias_empresa WHERE ativa=true`), independentemente de movimento.

**Problema do cliente:** "as contas pagas no mês não serão todas; preciso gerar pelo meu filtro / itens selecionados; a capa só das contas selecionadas."

**Mudança necessária:**
1. Passar **escopo explícito** ao backend: `scope_type ∈ {por_mes, por_filtros, por_selecao}` + `filtros{status, conta_contabil_cod, centro_custo_cod, conta_bancaria_id, data_de, data_ate}` + `transacao_ids[]` + `conta_ids[]`.
2. Builders passam a filtrar `transacoes_empresa` por esse escopo (precedência: seleção manual > filtros > mês).
3. Capa Empresa filtra as contas pelo escopo (não todas).
4. **Modal de revisão** pré-geração: qtd de lançamentos, contas, centros, período, status, total geral, e se é por filtro ou seleção.
5. Registrar o escopo usado em `pdfmonkey_geracoes.scope_applied` (JSONB) — reprodutibilidade/auditoria.

**Ressalva técnica:** o **Relatório Sócios** consome views pré-agregadas por mês (`v_*_mensal`). Filtros granulares não se aplicam limpo a ele sem reescrever as views como funções parametrizadas. Proposta: RF-FIN-09 cobre **Capa Empresa + Relatório Contábil** (que leem `transacoes_empresa` direto); Relatório Sócios permanece por mês (ver dúvida D-3).

---

## 8. Banco de dados e models

- `transacoes_empresa` (0005): única coluna de data = `data` (date); `mes_referencia` é GENERATED STORED a partir dela. **Sem `data_emissao`.** `centro_custo_cod`/`conta_contabil_cod` → FK `classificacao_financeira`.
- `classificacao_financeira` (0004): plano de contas hierárquico níveis 1-3. **Centro de custo = nível 3** (ex. `2.3.6`). Não há tabela separada.
- `contas_bancarias_empresa` (0004 + 0015): `nome, apelido, banco (instituição texto), agencia, conta (deprecado/null), tipo, numero_conta, digito, ativa, ordem`. **Sem `numero_banco`/`logo`.**
- Views: `v_saldo_atual_por_banco`, `v_por_conta_contabil_mensal`, `v_por_centro_custo_mensal`, `v_saldo_por_banco_mensal`, etc.
- `pdfmonkey_geracoes` (0015): log de gerações (payload JSONB) — falta `scope_applied`.

**Migrations necessárias (todas reversíveis):**
1. `transacoes_empresa.data_emissao date NULL` + índice (RF-FIN-06).
2. `contas_bancarias_empresa.numero_banco text NULL` (+ opcional `instituicao_slug`/`logo` para mapear logo) (RF-FIN-01/02) + atualizar a view `v_saldo_atual_por_banco`.
3. `pdfmonkey_geracoes.scope_applied jsonb NULL` (RF-FIN-09).
4. Dados: setar `numero_banco`/`numero_conta`/`digito` das contas conhecidas, criar Inter, desativar Sicredi MJU (ver D-1).

---

## 9. Status e paleta visual (RF-FIN-04, 05)

**Status (RF-FIN-05):** mapeamento `status → variante` está **descentralizado e inconsistente**:
- `FinanceiroPage.statusBadgeVariant` (correto): entrada→`success` (verde), saída `a_*`→`warning` (âmbar), demais saídas→`danger` (vermelho), neutro→`neutral` (cinza).
- `LancamentoDetalheModal` (inline) **não distingue** `a_pagar` de `pago` (ambos vermelho). 🐛
- `BancoDetalheModal` renderiza **sempre `neutral`**, ignorando o status. 🐛
- Cores soltas em `SaldosBancariosGrid` (`text-emerald-600/amber-600/red-500`).

→ Centralizar em `lib/utils/status-colors.ts` e aplicar em todas as telas (corrige os 2 bugs). As cores do `Badge` são hex isolados — **não dependem** dos tokens de tema.

**Paleta lateral (RF-FIN-04):** `Sidebar.tsx` hardcoda gradiente **verde** (`#0f1f1c→#152824→#1a3028`) inline, texto inativo `#7ab8aa`, ativo `bg-white/10` + ícone dourado `#c49830`, logo `#a67c20`. Tokens `--color-sidebar-*` existem em `globals.css` mas **não são usados**. Trocar para lateral **escura (quase preta)** com ativo **dourado/marrom**.

✅ **Sem acoplamento de risco:** os verdes de status (`Badge` hex, `text-emerald-*`) são independentes do gradiente da sidebar. Trocar a sidebar **não** regride os status (atende RF-FIN-05).

---

## 10. Impacto por requisito (resumo)

| RF | Frontend | Backend/Query | Migration | Esforço |
|----|:--------:|:-------------:|:---------:|:-------:|
| 01 dados bancários completos | ✅ | ✅ | ✅ (numero_banco + dados) | M |
| 02 logos + lista (−MJU +Inter) | ✅ | ✅ | ✅ (seed/dados) | M |
| 03 % no donut | ✅ | — | — | P |
| 04 paleta lateral | ✅ | — | — | P |
| 05 cores de status (centralizar) | ✅ | — | — | P-M |
| 06 Emissão + Vencimento | ✅ | ✅ | ✅ (data_emissao) | M |
| 07 remover "Total no banco" | ✅ | — | — | P |
| 08 filtro Centro de Custo | ✅ | já pronto | — | P |
| 09 relatório por escopo + capa | ✅✅ | ✅✅ | ✅ (scope_applied) | **G** |

---

## 11. Riscos técnicos

1. **Integridade de dados bancários (D-1):** há transações reais ligadas aos IDs atuais das contas. Remover/renomear contas no banco vivo pode "órfãos" saldos. → desativar (soft) em vez de deletar; reconciliar via migration controlada.
2. **Relatório Sócios usa views por mês:** escopo granular não se aplica sem reescrever views (ver §7).
3. **Capa "só contas com movimento":** contas vazias somem do PDF — pode surpreender; deixar claro no modal de revisão.
4. **Seleção manual entre páginas:** seleção precisa persistir ao paginar (usar `Set<id>` global, não por página).
5. **Logos ausentes:** sem assets, cards quebram → usar SVG/locais com fallback de iniciais.
6. **Reprodutibilidade:** sem registrar `scope_applied`, não há auditoria de qual recorte gerou cada PDF.

---

## 12. Plano de implementação por fases

Ordem por dependência (base de dados → filtros → relatórios → visual):

- **Fase 0 — Migrations reversíveis:** `data_emissao`, `numero_banco`, `scope_applied`, reconciliação de contas. *(uma migration por tema, com seção de rollback)*
- **Fase 1 — RF-FIN-06** (Emissão/Vencimento) + **RF-FIN-08** (filtro Centro de Custo). *Prep para relatórios corretos.*
- **Fase 2 — RF-FIN-09** (relatório por escopo + seleção + modal de revisão + capa). *Núcleo.*
- **Fase 3 — RF-FIN-01/02/07** (cards bancários: dados completos + logos + lista, remover "Total no banco").
- **Fase 4 — RF-FIN-03/05** (% no donut + centralização das cores de status).
- **Fase 5 — RF-FIN-04** (paleta lateral) — visual, por último para não interferir nas demais.

Cada fase: migration reversível quando aplicável, mudanças pequenas, tratamento de erro e estados vazios, responsivo, sem mocks.

---

## 13. Dúvidas que precisam de confirmação (bloqueiam parte da implementação)

- **D-1 (contas bancárias):** o banco vivo tem 6 contas (Cora, Sicredi MJU 0902, Sicredi CGR 0913, XP Conta, Invest, Invest Evolutivo). O painel desejado tem 5 (CORA, SICREDI, SICREDINVEST, INTER, XP). Como reconciliar — em especial **as 3 contas de investimento** (qual vira "XP" e qual vira "SICREDINVEST"?) e a criação do **Inter**? Migration controlada por mim, ou Lola ajusta no cadastro (Bancos)?
- **D-2 (Centro de Custo):** filtro de **seleção única** ou **múltipla**?
- **D-3 (Capa do relatório):** considerar **somente contas com movimento** no recorte, ou **todas as contas selecionadas** (mesmo zeradas)?
- **D-4 (Cores de status):** manter a **paleta atual do sistema** (badges escuros) só centralizando/consertando bugs, ou **adotar as cores da legenda do Excel** mostrada no PDF (cinza/azul claro/verde/vermelho/amarelo)?
- **D-5 (Sicredi MJU):** desativar só do painel (preservando histórico) — recomendado — confirma?
- **D-6 (Relatório Sócios):** ok manter **por mês** (RF-FIN-09 aplicado a Capa Empresa + Relatório Contábil), já que ele lê views pré-agregadas?

Itens já decididos sem precisar perguntar: "Data" atual = Vencimento (instrução explícita do cliente); "Total no banco" removido (sem cálculo); logos via SVG/local com fallback de iniciais; Centro de Custo afeta tabela+cards+gráfico+relatório.
