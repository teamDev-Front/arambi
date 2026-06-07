# Diagnóstico Técnico — Melhorias do módulo *Home > Documentos*

> Base: `ajustes-07-junho-2026/especificacao-melhorias-sistema-arambi.md` + PDF de evidências (3 páginas).
> Entregável da **Fase 1** do plano. Não contém código — apenas mapeamento, impacto e plano.

## 1. Arquitetura atual

- **Frontend:** Next 16 / React 19. A área é um componente client único: [`DocumentosPage.tsx`](../../src/components/documentos/DocumentosPage.tsx).
  - Cards de modelos (`MODELOS`) abrem um **Modal** com o form correspondente (`FORM_BY_TIPO`).
  - Tabela "Últimos gerados" com busca/filtros/paginação. Ações por linha: **Baixar** e **Excluir** (sem Editar).
- **Modal genérico:** [`ui/Modal.tsx`](../../src/components/ui/Modal.tsx) — fecha no **clique no overlay** (L38) e no **ESC** (L27). Sem proteção contra perda de dados.
- **Forms:** `src/components/documentos/forms/*` — estado local com `useState`, validação manual via `valido`, sem lib de form. `FormShell` provê o botão Gerar/Cancelar; `FormSection` o grid; `Select` PF/PJ já existe.
- **Geração de PDF:** server-side com **pdf-lib**, via [`PdfBuilder`](../../src/lib/pdf/builder.ts). 6 geradores em `src/lib/pdf/generators/*`. Roteador [`pdf/index.ts`](../../src/lib/pdf/index.ts).
- **API:** `POST /api/documentos/gerar`, `GET /api/documentos/[id]/download`, `DELETE /api/documentos/[id]`.
- **Persistência:** tabela `documentos_gerados` (migration 0016) + bucket privado `documentos-gerados` (Storage). **O payload do form é salvo em `dados jsonb`** (snapshot) → habilita regerar/editar.
- **Status:** o módulo **já está em produção com dados reais** (evidência: tabela da pág. 3 com lançamentos reais). Não é mais mock.

## 2. Fluxo do módulo

1. Usuário clica num card → `setTipoAberto(tipo)` → Modal abre com `FormAtivo`.
2. Form valida e chama `onSubmit(dados)` → `gerarDocumento(tipo, dados)` → `POST /api/documentos/gerar`.
3. API: autentica → `gerarDocumentoPdf` → `resumoDocumento` → upload no Storage → insert em `documentos_gerados` → devolve **signed URL** (10 min) → front abre download.
4. Listagem: `listarDocumentosGerados` (busca em `beneficiario/descricao/numero` via trigram) + `listarMesesDistintos`.

## 3. Banco de dados e models

- `documentos_gerados (id, tipo, numero, beneficiario, valor, descricao, mes_referencia, dados jsonb, pdf_path, pdf_size, created_at, created_by)`.
- `contas_bancarias_empresa` (migrations 0004/0015): `nome, apelido, banco, agencia, tipo, numero_conta, digito, ordem`. **⚠️ não tem coluna `ativa`** (só a de sócio tem). Seed: Cora, Sicredi MJU, Sicredi CGR.
- **Não existe** tabela `empresa` nem campo de logomarca.
- RLS: leitura para autenticado; escrita via `fn_can_write()` (admin/editor).
- Enum `documento_gerado_tipo` controla os tipos (FE + BE + DB).

## 4. APIs e serviços

| Rota | Função | Observação p/ as melhorias |
|---|---|---|
| `POST /api/documentos/gerar` | gera + salva | precisa virar reaproveitável p/ **editar** (RF-09) |
| `GET /api/documentos/[id]/download` | signed URL | ok |
| `DELETE /api/documentos/[id]` | remove row + PDF | manter |
| `lib/queries/bancos.ts` | contas da empresa | fonte do seletor (RF-06) |

## 5. Templates de documentos (geradores)

- `recibo-vale-combustivel.ts` — **hardcoded** "inscrito(a) no CPF" (benef.) e "cadastro de pessoa física" (pagador) → **RF-01**.
- `recibo-pagamento-prestador.ts` — `"Dados do Pagamento:"` com dois-pontos (L28) → **RF-05**; ambos os lados hardcoded "CPF" → **RF-04**.
- `termo-transferencia-bancaria.ts` — sem logo; "inscrita no CNPJ" hardcoded → **RF-07** (timbre) e RF-06 (seletor).
- `PdfBuilder` **não tem método de imagem/marca d'água** → precisa ganhar `watermark()`/`image()` p/ RF-07.
- Padrão PF/PJ a reutilizar: `DadosTermoAutorizacaoTerceiros.autorizante_tipo` + `Select` no `TermoAutorizacaoForm`.

## 6. Permissões e segurança

- Escrita protegida por `fn_can_write()` (RLS). Leitura por autenticado.
- **Não há `company_id`** — sistema é single-tenant (uma empresa, Aramburu). O risco "vazamento entre empresas" do doc **não se aplica** hoje; manter consultas por usuário.
- Sem validação centralizada de CPF/CNPJ — **criar** `lib/utils/documento.ts`.

## 7. Evidências do PDF (o que cada página prova)

- **Pág. 1 (RF-01):** recibo real com pagador **Aramburu Ltda (CNPJ 30.921.299/0001-88)** imprime *"inscrito(a) no **cadastro de pessoa física** 30.921.299/0001-88"* → documento contraditório hoje.
- **Pág. 2:** caixa vermelha em `Dados do Pagamento:` (RF-05); exemplo do timbre = **marca d'água** do monograma "A" Aramburu **ao fundo, atrás do texto** (RF-07).
- **Pág. 3:** card "Contrato de Prestação de Serviços" a remover (RF-08); coluna **Ações** só com baixar/lixeira (RF-09).

## 8. Impacto de cada requisito

| RF | Camadas tocadas | Migration? | Risco |
|---|---|---|---|
| RF-01 PF/PJ vale comb. | form + type + gerador | não | baixo |
| RF-02 histórico descrições | nova tabela + API + autocomplete | **sim** | médio |
| RF-03 anti-perda (autosave) | Modal + form + localStorage + ConfirmDialog | não | baixo |
| RF-04 PF/PJ prestador | form + type + gerador | não | baixo |
| RF-05 remover ":" | gerador (1 linha) | não | nulo |
| RF-06 seletor conta ativa | form + query + **coluna `ativa`** | **sim** | baixo |
| RF-07 timbre/marca d'água | PdfBuilder + gerador(es) | não | baixo |
| RF-08 remover card contrato | DocumentosPage (UI) | não | baixo |
| RF-09 editar + versão | API + tabela versões + UI | **sim** | médio/alto |

## 9. Riscos e mitigação

- **Editar documentos históricos (RF-09):** decisão = **versionar** (snapshot por versão, original preservado, PDF antigo intacto).
- **Concordância PF/PJ (RF-01/04):** centralizar geração textual ("inscrito no CPF" / "inscrita no CNPJ") e testar as combinações.
- **Logo distorcida (RF-07):** manter proporção do JPEG (388×490), baixa opacidade, fundo branco do JPEG fica invisível na página branca.
- **Conta desativada após emissão (RF-06):** já resolvido pelo snapshot em `dados jsonb` — o termo grava cópia, não referência.

## 10. Plano de implementação por fases

- **Fase 2 — quick wins (1 PR, baixo risco):** RF-05 (dois-pontos) + RF-08 (remover card) + trava de fechamento acidental do Modal.
- **Fase 3 — PF/PJ:** RF-01 + RF-04 + `lib/utils/documento.ts` (validação/format CPF-CNPJ) + ajuste dos geradores.
- **Fase 4 — anti-perda:** RF-03 (autosave localStorage + ConfirmDialog próprio + recuperação ao reabrir).
- **Fase 5 — banco + identidade:** RF-06 (coluna `ativa` + seletor + autopreenchimento) + RF-07 (marca d'água `PdfBuilder.watermark`).
- **Fase 6 — edição/versão:** RF-09 (tabela `documentos_gerados_versoes`, refactor da API gerar→regerar, botão Editar, histórico).
- **Fase 7 — histórico de descrições:** RF-02 (tabela `document_description_history` + autocomplete).

## 11. Decisões confirmadas (07/06/2026)

1. **RF-09:** versionamento (preserva original + histórico).
2. **RF-03:** proteção + autosave **localStorage** + **modal próprio do front** (não nativo) + recuperação. Sem tabela.
3. **RF-07:** marca d'água com `public/logomarga-timbre-aramburu-agropecuaria.jpg` (monograma "A"), esmaecida, atrás do texto, todas as páginas.
4. **Single-tenant:** sem `company_id`; regras de multi-empresa não se aplicam.
</invoke>
