"use client";
import { useEffect, useRef, useState } from "react";
import { Bold, List, ListOrdered } from "lucide-react";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { FormShell, FormSection } from "./FormShell";
import { DraftBanner } from "./DraftBanner";
import { DescricaoAutocomplete } from "./DescricaoAutocomplete";
import { TermoTemplatePicker } from "./TermoTemplatePicker";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { listarContasEmpresa } from "@/lib/queries/bancos";
import { formatMoeda, valorPorExtenso, inteiroPorExtenso } from "@/lib/pdf/helpers";
import {
  TERMO_REMETENTES, TERMO_TEMPLATES,
  type TermoFornecedorTemplate,
} from "@/lib/documentos/termo-templates";
import type { ContaBancariaEmpresaRow } from "@/types";
import type { DadosTermoTransferencia } from "@/lib/pdf/types";

interface Props {
  onSubmit: (dados: DadosTermoTransferencia) => Promise<void> | void;
  onCancel: () => void;
  submitting: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  seed?: DadosTermoTransferencia | null;   // RF-09 — edição
  /** RF 24-jul — na edição: salva as alterações sem gerar novo PDF. */
  onSalvarSemPdf?: (dados: DadosTermoTransferencia) => Promise<void> | void;
  salvandoSemPdf?: boolean;
}

function fromDados(d: DadosTermoTransferencia) {
  return {
    remetente_razao_social:    d.remetente_razao_social,
    remetente_documento:       d.remetente_documento,
    remetente_banco:           d.remetente_bancarios.banco,
    remetente_agencia:         d.remetente_bancarios.agencia,
    remetente_conta:           d.remetente_bancarios.conta,
    destinatario_razao_social: d.destinatario_razao_social,
    destinatario_documento:    d.destinatario_documento,
    destinatario_banco:        d.destinatario_bancarios.banco,
    destinatario_agencia:      d.destinatario_bancarios.agencia,
    destinatario_conta:        d.destinatario_bancarios.conta,
    destinatario_pix:          d.destinatario_bancarios.chave_pix ?? "",
    valor:                     String(d.valor ?? ""),
    data_transferencia:        d.data_transferencia,
    numero_nota:               d.numero_nota ?? "",
    descricao_objeto:          d.descricao_objeto,
    saldo_remanescente:        d.saldo_remanescente != null ? String(d.saldo_remanescente) : "",
    saldo_parcelado:           d.saldo_parcelado ? "sim" : "nao",
    saldo_parcelas:            d.saldo_parcelas != null ? String(d.saldo_parcelas) : "",
    titulo_documento:          d.titulo_documento ?? "",
    destinatario_nome_paragrafo: d.destinatario_nome_paragrafo ?? "",
    observacoes:               d.observacoes ?? "",
    template_fornecedor_id:    d.template_fornecedor_id ?? "",
  };
}

/** Preview simples do markdown-lite das Observações (**negrito**, "- ", "1. "). */
function ObsPreview({ md }: { md: string }) {
  const linhas = md.replace(/\r\n/g, "\n").split("\n");
  const renderLinha = (l: string, key: number) => {
    const bullet = /^[-•*]\s+/.exec(l.trim());
    const numero = /^(\d{1,3})[.)]\s+/.exec(l.trim());
    const corpo = l.trim().replace(/^([-•*]|\d{1,3}[.)])\s+/, "");
    const partes = corpo.split(/\*\*(.+?)\*\*/g).map((p, i) =>
      i % 2 === 1 ? <strong key={i}>{p}</strong> : <span key={i}>{p}</span>,
    );
    if (l.trim() === "") return <div key={key} className="h-2" />;
    return (
      <p key={key} className={bullet || numero ? "pl-4" : ""}>
        {bullet ? "•  " : numero ? `${numero[1]}.  ` : ""}
        {partes}
      </p>
    );
  };
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-700 leading-relaxed space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 pb-1">Como sai no PDF</p>
      {linhas.map(renderLinha)}
    </div>
  );
}

export function TermoTransferenciaForm({
  onSubmit, onCancel, submitting, onDirtyChange, seed, onSalvarSemPdf, salvandoSemPdf,
}: Props) {
  const hoje = new Date().toISOString().slice(0, 10);

  const [form, setForm, draft] = useFormDraft("termo_transferencia_bancaria", seed ? fromDados(seed) : {
    remetente_razao_social:    "Agropecuária Aramburu Ltda",
    remetente_documento:       "30.921.299/0001-88",
    remetente_banco:           "Sicredi (748)",
    remetente_agencia:         "",
    remetente_conta:           "",
    destinatario_razao_social: "",
    destinatario_documento:    "",
    destinatario_banco:        "",
    destinatario_agencia:      "",
    destinatario_conta:        "",
    destinatario_pix:          "",
    valor:                     "",
    data_transferencia:        hoje,
    numero_nota:               "",
    descricao_objeto:          "",
    saldo_remanescente:        "",
    saldo_parcelado:           "nao",
    saldo_parcelas:            "",
    titulo_documento:          "",
    destinatario_nome_paragrafo: "",
    observacoes:               "",
    template_fornecedor_id:    "",
  }, onDirtyChange, !!seed);

  // RF-06 — contas bancárias ativas da empresa (preenchimento automático do remetente).
  const [contas, setContas] = useState<ContaBancariaEmpresaRow[]>([]);
  const [contaSelId, setContaSelId] = useState("");

  useEffect(() => {
    let ativo = true;
    listarContasEmpresa()
      .then((rows) => { if (ativo) setContas(rows.filter((c) => c.ativa)); })
      .catch(() => { /* sem contas: o usuário preenche manualmente */ });
    return () => { ativo = false; };
  }, []);

  function aplicarConta(id: string) {
    setContaSelId(id);
    const c = contas.find((x) => x.id === id);
    if (!c) return;
    const contaStr = c.numero_conta
      ? `${c.numero_conta}${c.digito ? "-" + c.digito : ""}`
      : (c.conta ?? "");
    setForm((f) => ({
      ...f,
      remetente_banco:   c.apelido || c.banco || c.nome,
      remetente_agencia: c.agencia ?? "",
      remetente_conta:   contaStr,
    }));
  }

  // ─── Modelo de fornecedor (ajuste 29-jul) ────────────────────────────────
  const templateSel = TERMO_TEMPLATES.find((t) => t.id === form.template_fornecedor_id) ?? null;

  function aplicarTemplate(t: TermoFornecedorTemplate) {
    setContaSelId("");
    const rem = TERMO_REMETENTES[t.remetente];
    setForm((f) => ({
      ...f,
      template_fornecedor_id:    t.id,
      titulo_documento:          t.titulo ?? "",
      remetente_razao_social:    "Agropecuária Aramburu Ltda",
      remetente_documento:       "30.921.299/0001-88",
      remetente_banco:           rem.banco,
      remetente_agencia:         rem.agencia,
      remetente_conta:           rem.conta,
      destinatario_razao_social: t.destinatario.razao_social,
      destinatario_documento:    t.destinatario.documento,
      destinatario_banco:        t.destinatario.banco,
      destinatario_agencia:      t.destinatario.agencia,
      destinatario_conta:        t.destinatario.conta,
      destinatario_pix:          t.destinatario.pix,
      destinatario_nome_paragrafo:
        t.favorecido.trim().toLowerCase() !== t.destinatario.razao_social.trim().toLowerCase()
          ? t.favorecido
          : "",
      // Termos com bloco extra (parcelas, retenções) chegam com as observações
      // do modelo — a operadora só atualiza os valores.
      observacoes: t.observacoes_exemplo ?? f.observacoes,
    }));
  }

  function limparTemplate() {
    setForm((f) => ({ ...f, template_fornecedor_id: "", titulo_documento: "" }));
  }

  // ─── Observações (markdown-lite) ─────────────────────────────────────────
  const obsRef = useRef<HTMLTextAreaElement>(null);

  function obsNegrito() {
    const el = obsRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const sel = value.slice(s, e) || "negrito";
    setForm((f) => ({ ...f, observacoes: value.slice(0, s) + `**${sel}**` + value.slice(e) }));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + 2, s + 2 + sel.length); });
  }

  function obsLista(prefixo: (i: number) => string) {
    const el = obsRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    // expande a seleção para linhas inteiras
    const ini = value.lastIndexOf("\n", s - 1) + 1;
    const fimQuebra = value.indexOf("\n", e);
    const fim = fimQuebra === -1 ? value.length : fimQuebra;
    const linhas = value.slice(ini, fim).split("\n");
    let n = 0;
    const bloco = linhas
      .map((l) => {
        if (l.trim() === "") return l;
        const semMarcador = l.replace(/^\s*([-•*]|\d{1,3}[.)])\s+/, "");
        return prefixo(n++) + semMarcador;
      })
      .join("\n");
    setForm((f) => ({ ...f, observacoes: value.slice(0, ini) + bloco + value.slice(fim) }));
    requestAnimationFrame(() => el.focus());
  }

  // ─── Saldo remanescente (RF 24-jul) ──────────────────────────────────────
  // Monta a frase padrão com valor por extenso. O PDF abre com "Este valor
  // corresponde a …", então a frase começa em minúscula, sem repetir o início.
  const saldoNum = Number(form.saldo_remanescente);
  const saldoParcelado = form.saldo_parcelado === "sim";
  const nParcelas = Math.floor(Number(form.saldo_parcelas) || 0);

  function montarFraseSaldo(): string | null {
    if (!(saldoNum > 0)) return null;
    const saldoStr = `R$ ${formatMoeda(saldoNum)} (${valorPorExtenso(saldoNum)})`;
    if (saldoParcelado) {
      if (nParcelas < 1) return null;
      return `ao valor da entrada, sendo o saldo remanescente parcelado em ${nParcelas} (${inteiroPorExtenso(nParcelas)}) parcela${nParcelas === 1 ? "" : "s"}, totalizando ${saldoStr}.`;
    }
    return `ao valor da entrada, restando um saldo remanescente de ${saldoStr}.`;
  }
  const fraseSaldo = montarFraseSaldo();

  function inserirFraseNaDescricao() {
    if (!fraseSaldo) return;
    const atual = form.descricao_objeto.trim();
    const complemento = atual
      ? ` O pagamento refere-se a ${atual}`
      : " O pagamento refere-se a ";
    setForm({ ...form, descricao_objeto: `${fraseSaldo}${complemento}` });
  }

  // Dados bancários do destinatário: agência + conta OU Chave Pix — pagamento
  // via Pix não tem agência/conta (ajuste 28-jul, pedido da Adri).
  const destinoBancarioOk =
    (!!form.destinatario_agencia.trim() && !!form.destinatario_conta.trim()) ||
    !!form.destinatario_pix.trim();

  const valido =
    !!form.remetente_razao_social.trim() &&
    !!form.remetente_documento.trim() &&
    !!form.remetente_banco.trim() &&
    !!form.remetente_agencia.trim() &&
    !!form.remetente_conta.trim() &&
    !!form.destinatario_razao_social.trim() &&
    !!form.destinatario_documento.trim() &&
    !!form.destinatario_banco.trim() &&
    destinoBancarioOk &&
    Number(form.valor) > 0 &&
    !!form.data_transferencia &&
    !!form.descricao_objeto.trim();

  function montarDados(): DadosTermoTransferencia {
    return {
      remetente_razao_social: form.remetente_razao_social.trim(),
      remetente_documento:    form.remetente_documento.trim(),
      remetente_bancarios: {
        banco:   form.remetente_banco.trim(),
        agencia: form.remetente_agencia.trim(),
        conta:   form.remetente_conta.trim(),
      },
      destinatario_razao_social: form.destinatario_razao_social.trim(),
      destinatario_documento:    form.destinatario_documento.trim(),
      destinatario_bancarios: {
        banco:     form.destinatario_banco.trim(),
        agencia:   form.destinatario_agencia.trim(),
        conta:     form.destinatario_conta.trim(),
        chave_pix: form.destinatario_pix.trim() || undefined,
      },
      valor:               Number(form.valor),
      data_transferencia:  form.data_transferencia,
      numero_nota:         form.numero_nota.trim() || undefined,
      descricao_objeto:    form.descricao_objeto.trim(),
      saldo_remanescente:  saldoNum > 0 ? saldoNum : undefined,
      saldo_parcelado:     saldoNum > 0 ? saldoParcelado : undefined,
      saldo_parcelas:      saldoNum > 0 && saldoParcelado && nParcelas >= 1 ? nParcelas : undefined,
      titulo_documento:            form.titulo_documento.trim() || undefined,
      destinatario_nome_paragrafo: form.destinatario_nome_paragrafo.trim() || undefined,
      observacoes:                 form.observacoes.trim() || undefined,
      template_fornecedor_id:      form.template_fornecedor_id || undefined,
    };
  }

  function handleSubmit() {
    return onSubmit(montarDados());
  }

  return (
    <FormShell
      onCancel={onCancel}
      onSubmit={handleSubmit}
      submitting={submitting}
      disabled={!valido}
      onSecondary={onSalvarSemPdf ? () => onSalvarSemPdf(montarDados()) : undefined}
      secondarySubmitting={salvandoSemPdf}
    >
      <DraftBanner show={draft.recovered} onDiscard={draft.discard} />

      {/* Modelo de fornecedor (ajuste 29-jul) — 94 termos analisados um a um */}
      <FormSection title="Modelo de fornecedor" columns={1}>
        <TermoTemplatePicker onSelect={aplicarTemplate} />
        {templateSel && (
          <div className="rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 space-y-1.5 -mt-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-stone-700">
                Modelo aplicado: {templateSel.nome}
                {templateSel.titulo ? ` — título "${templateSel.titulo}"` : ""}
              </p>
              <button
                type="button"
                onClick={limparTemplate}
                className="text-[11px] font-medium text-accent-700 hover:text-accent-800 underline cursor-pointer shrink-0"
                title="Desvincula o modelo (os campos preenchidos não são apagados)"
              >
                Limpar modelo
              </button>
            </div>
            <p className="text-[11px] text-stone-600">
              Remetente e destinatário foram preenchidos com os dados do termo deste fornecedor — tudo continua editável.
            </p>
            <details className="text-[11px] text-stone-600">
              <summary className="cursor-pointer font-medium hover:text-stone-800">
                Ver o 1º parágrafo do último termo deste fornecedor (referência de redação)
              </summary>
              <p className="italic mt-1 leading-relaxed">{templateSel.paragrafo_exemplo}</p>
            </details>
          </div>
        )}
      </FormSection>

      <FormSection title="Remetente" columns={2}>
        <div className="sm:col-span-2">
          {contas.length > 0 ? (
            <Select
              label="Conta bancária da empresa (preenche banco, agência e conta)"
              value={contaSelId}
              onChange={(e) => aplicarConta(e.target.value)}
            >
              <option value="">Selecionar conta ativa…</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>{c.apelido || c.nome}</option>
              ))}
            </Select>
          ) : (
            <p className="text-xs text-stone-500">
              Nenhuma conta ativa cadastrada. Cadastre em <span className="font-medium">Bancos</span> para
              preencher o remetente automaticamente, ou informe os dados abaixo manualmente.
            </p>
          )}
        </div>
        <Input label="Razão social" value={form.remetente_razao_social} onChange={(e) => setForm({ ...form, remetente_razao_social: e.target.value })} />
        <Input label="CNPJ"         value={form.remetente_documento}    onChange={(e) => setForm({ ...form, remetente_documento: e.target.value })} />
        <Input label="Banco / Cooperativa" value={form.remetente_banco}  onChange={(e) => setForm({ ...form, remetente_banco: e.target.value })} placeholder="Sicredi (748)" />
        <Input label="Agência"      value={form.remetente_agencia}      onChange={(e) => setForm({ ...form, remetente_agencia: e.target.value })} />
        <Input label="Conta Corrente" value={form.remetente_conta}      onChange={(e) => setForm({ ...form, remetente_conta: e.target.value })} />
      </FormSection>

      <FormSection title="Destinatário" columns={2}>
        <Input label="Razão social / Nome"  value={form.destinatario_razao_social} onChange={(e) => setForm({ ...form, destinatario_razao_social: e.target.value })} />
        <Input label="CNPJ ou CPF"          value={form.destinatario_documento}    onChange={(e) => setForm({ ...form, destinatario_documento: e.target.value })} />
        <div className="sm:col-span-2">
          <Input
            label="Nome no 1º parágrafo (opcional — quando difere da razão social)"
            value={form.destinatario_nome_paragrafo}
            onChange={(e) => setForm({ ...form, destinatario_nome_paragrafo: e.target.value })}
            placeholder='Ex.: "Douravet Veterinária Ltda Epp – Central Veterinária"'
          />
        </div>
        <Input label="Banco"          value={form.destinatario_banco}   onChange={(e) => setForm({ ...form, destinatario_banco: e.target.value })} placeholder="Sicredi (748)" />
        <Input label="Agência"        value={form.destinatario_agencia} onChange={(e) => setForm({ ...form, destinatario_agencia: e.target.value })} />
        <Input label="Conta Corrente" value={form.destinatario_conta}   onChange={(e) => setForm({ ...form, destinatario_conta: e.target.value })} />
        <Input label="Chave Pix"      value={form.destinatario_pix}     onChange={(e) => setForm({ ...form, destinatario_pix: e.target.value })} />
        <p className={`sm:col-span-2 text-[11px] -mt-1 ${destinoBancarioOk ? "text-stone-400" : "text-amber-600 font-medium"}`}>
          Informe <b>Agência + Conta Corrente</b> OU a <b>Chave Pix</b> do destinatário — pagamento via
          Pix não precisa de agência/conta.
        </p>
      </FormSection>

      <FormSection title="Detalhes da transferência" columns={3}>
        <Input label="Valor (R$)"            type="number" step="0.01" min="0" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
        <Input label="Data da transferência" type="date" value={form.data_transferencia} onChange={(e) => setForm({ ...form, data_transferencia: e.target.value })} />
        <Input label="Nº da NF (opcional)"   value={form.numero_nota} onChange={(e) => setForm({ ...form, numero_nota: e.target.value })} />
      </FormSection>

      {/* Saldo remanescente (RF 24-jul) — frase padrão com valor por extenso */}
      <FormSection title="Saldo remanescente (opcional)" columns={3}>
        <Input
          label="Saldo remanescente (R$)"
          type="number" step="0.01" min="0"
          value={form.saldo_remanescente}
          onChange={(e) => setForm({ ...form, saldo_remanescente: e.target.value })}
          placeholder="7926,10"
        />
        <Select
          label="Saldo será parcelado?"
          value={form.saldo_parcelado}
          onChange={(e) => setForm({ ...form, saldo_parcelado: e.target.value })}
        >
          <option value="nao">Não</option>
          <option value="sim">Sim</option>
        </Select>
        <Input
          label="Nº de parcelas"
          type="number" min="1" step="1"
          value={form.saldo_parcelas}
          disabled={!saldoParcelado}
          onChange={(e) => setForm({ ...form, saldo_parcelas: e.target.value })}
          placeholder="4"
        />
        {saldoNum > 0 && (
          <div className="sm:col-span-3 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 space-y-2">
            {fraseSaldo ? (
              <>
                <p className="text-[11px] text-stone-600 leading-relaxed">
                  <span className="font-semibold text-stone-700">Frase que será inserida na descrição</span>{" "}
                  (o termo abre com {"“Este valor corresponde a”"}):
                  <br />
                  <span className="italic">…{fraseSaldo}</span>
                </p>
                <button
                  type="button"
                  onClick={inserirFraseNaDescricao}
                  className="text-xs font-medium text-accent-700 hover:text-accent-800 underline cursor-pointer"
                  title="Insere a frase acima no início da Descrição — o texto continua editável"
                >
                  Inserir na descrição
                </button>
              </>
            ) : (
              <p className="text-[11px] text-stone-500">
                Informe o nº de parcelas para montar a frase do saldo parcelado.
              </p>
            )}
          </div>
        )}
      </FormSection>

      <FormSection columns={1}>
        <DescricaoAutocomplete
          tipo="termo_transferencia_bancaria"
          label="Descrição / objeto da transferência"
          value={form.descricao_objeto}
          onChange={(v) => setForm({ ...form, descricao_objeto: v })}
          placeholder="saldo do material utilizado, relativos ao forro da área gourmet..."
          rows={3}
        />
      </FormSection>

      {/* Observações (ajuste 29-jul) — bloco extra entre o parágrafo e o
          REMETENTE no PDF: parcelamentos, retenções de impostos etc. */}
      <FormSection title="Observações (opcional — parcelas, retenções, detalhes extras)" columns={1}>
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={obsNegrito}
              className="h-7 px-2 rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-stone-50 flex items-center gap-1 text-[11px] font-medium cursor-pointer"
              title="Deixa o texto selecionado em negrito (**texto**)"
            >
              <Bold size={12} /> Negrito
            </button>
            <button
              type="button"
              onClick={() => obsLista(() => "- ")}
              className="h-7 px-2 rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-stone-50 flex items-center gap-1 text-[11px] font-medium cursor-pointer"
              title="Transforma as linhas selecionadas em lista com marcadores"
            >
              <List size={12} /> Bullets
            </button>
            <button
              type="button"
              onClick={() => obsLista((i) => `${i + 1}. `)}
              className="h-7 px-2 rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-stone-50 flex items-center gap-1 text-[11px] font-medium cursor-pointer"
              title="Transforma as linhas selecionadas em lista numerada (1. 2. 3.)"
            >
              <ListOrdered size={12} /> Numerada
            </button>
          </div>
          <Textarea
            ref={obsRef}
            value={form.observacoes}
            onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            rows={6}
            placeholder={"**Parcelamento em 5x — valor total: R$ 61.000,00**\n- Parcela 1/5: R$ 12.200,00 — venc. 29/10/2025 - Entrada\n- Parcela 2/5: R$ 12.200,00 — venc. novembro/25 - 30D"}
          />
          <p className="text-[11px] text-stone-400">
            <b>**texto**</b> vira negrito · linha começando com <b>{"“- ”"}</b> vira bullet · com{" "}
            <b>{"“1. ”"}</b> vira lista numerada. O bloco sai no PDF entre o parágrafo inicial e o REMETENTE.
          </p>
          {form.observacoes.trim() && <ObsPreview md={form.observacoes} />}
        </div>
      </FormSection>
    </FormShell>
  );
}
