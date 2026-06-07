"use client";
import { Input, Select } from "@/components/ui/Input";
import { FormShell, FormSection } from "./FormShell";
import { DraftBanner } from "./DraftBanner";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import {
  documentoLabel, mensagemDocumentoInvalido, validarDocumento, type PessoaTipo,
} from "@/lib/utils/documento";
import type { DadosReciboValeCombustivel } from "@/lib/pdf/types";

interface Props {
  onSubmit: (dados: DadosReciboValeCombustivel) => Promise<void> | void;
  onCancel: () => void;
  submitting: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  seed?: DadosReciboValeCombustivel | null;   // RF-09 — edição: dados originais
}

function fromDados(d: DadosReciboValeCombustivel) {
  return {
    beneficiario_nome: d.beneficiario.nome,
    beneficiario_doc:  d.beneficiario.documento,
    pagador_nome:      d.pagador.nome,
    pagador_tipo:      (d.pagador.tipo ?? "pf") as PessoaTipo,
    pagador_doc:       d.pagador.documento,
    valor:             String(d.valor ?? ""),
    competencia:       d.competencia,
    periodo:           d.periodo,
    cidade:            d.cidade,
    data_emissao:      d.data_emissao,
  };
}

export function ReciboValeForm({ onSubmit, onCancel, submitting, onDirtyChange, seed }: Props) {
  const hoje = new Date().toISOString().slice(0, 10);
  const mesAtual = hoje.slice(0, 7);

  const [form, setForm, draft] = useFormDraft("recibo_vale_combustivel", seed ? fromDados(seed) : {
    beneficiario_nome:   "",
    beneficiario_doc:    "",
    pagador_nome:        "",
    pagador_tipo:        "pf" as PessoaTipo,
    pagador_doc:         "",
    valor:               "",
    competencia:         mesAtual,
    periodo:             "",
    cidade:              "Campo Grande - MS",
    data_emissao:        hoje,
  }, onDirtyChange, !!seed);

  // Beneficiário é sempre Pessoa Física (quem recebe o auxílio).
  const beneficiarioDocOk = validarDocumento("pf", form.beneficiario_doc);
  const pagadorDocOk      = validarDocumento(form.pagador_tipo, form.pagador_doc);

  const valido =
    !!form.beneficiario_nome.trim() &&
    beneficiarioDocOk &&
    !!form.pagador_nome.trim() &&
    pagadorDocOk &&
    !!form.competencia &&
    !!form.periodo.trim() &&
    !!form.cidade.trim() &&
    !!form.data_emissao &&
    Number(form.valor) > 0;

  function handleSubmit() {
    const dados: DadosReciboValeCombustivel = {
      beneficiario: { nome: form.beneficiario_nome.trim(), documento: form.beneficiario_doc.trim(), tipo: "pf" },
      pagador:      { nome: form.pagador_nome.trim(),      documento: form.pagador_doc.trim(), tipo: form.pagador_tipo },
      valor:        Number(form.valor),
      competencia:  form.competencia,
      periodo:      form.periodo.trim(),
      cidade:       form.cidade.trim(),
      data_emissao: form.data_emissao,
    };
    return onSubmit(dados);
  }

  return (
    <FormShell onCancel={onCancel} onSubmit={handleSubmit} submitting={submitting} disabled={!valido}>
      <DraftBanner show={draft.recovered} onDiscard={draft.discard} />
      <FormSection title="Beneficiário (quem recebe)" columns={2}>
        <Input label="Nome completo"  value={form.beneficiario_nome} onChange={(e) => setForm({ ...form, beneficiario_nome: e.target.value })} />
        <Input
          label="CPF"
          value={form.beneficiario_doc}
          onChange={(e) => setForm({ ...form, beneficiario_doc: e.target.value })}
          placeholder="000.000.000-00"
          error={form.beneficiario_doc.trim() && !beneficiarioDocOk ? mensagemDocumentoInvalido("pf") : undefined}
        />
      </FormSection>

      <FormSection title="Pagador" columns={3}>
        <Input label="Nome / Razão social" value={form.pagador_nome} onChange={(e) => setForm({ ...form, pagador_nome: e.target.value })} />
        <Select
          label="Tipo"
          value={form.pagador_tipo}
          onChange={(e) => setForm({ ...form, pagador_tipo: e.target.value as PessoaTipo })}
        >
          <option value="pf">Pessoa Física</option>
          <option value="pj">Pessoa Jurídica</option>
        </Select>
        <Input
          label={documentoLabel(form.pagador_tipo)}
          value={form.pagador_doc}
          onChange={(e) => setForm({ ...form, pagador_doc: e.target.value })}
          placeholder={form.pagador_tipo === "pj" ? "00.000.000/0000-00" : "000.000.000-00"}
          error={form.pagador_doc.trim() && !pagadorDocOk ? mensagemDocumentoInvalido(form.pagador_tipo) : undefined}
        />
      </FormSection>

      <FormSection title="Auxílio combustível" columns={3}>
        <Input label="Valor (R$)"       type="number" step="0.01" min="0" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
        <Input label="Competência"      type="month" value={form.competencia} onChange={(e) => setForm({ ...form, competencia: e.target.value })} />
        <Input label="Período"          value={form.periodo} onChange={(e) => setForm({ ...form, periodo: e.target.value })} placeholder="02 a 31/03" />
      </FormSection>

      <FormSection title="Local e data" columns={2}>
        <Input label="Cidade/UF"        value={form.cidade}       onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
        <Input label="Data de emissão"  type="date" value={form.data_emissao} onChange={(e) => setForm({ ...form, data_emissao: e.target.value })} />
      </FormSection>
    </FormShell>
  );
}
