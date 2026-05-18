"use client";
import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { FormShell, FormSection } from "./FormShell";
import type { DadosReciboValeCombustivel } from "@/lib/pdf/types";

interface Props {
  onSubmit: (dados: DadosReciboValeCombustivel) => Promise<void> | void;
  onCancel: () => void;
  submitting: boolean;
}

export function ReciboValeForm({ onSubmit, onCancel, submitting }: Props) {
  const hoje = new Date().toISOString().slice(0, 10);
  const mesAtual = hoje.slice(0, 7);

  const [form, setForm] = useState({
    beneficiario_nome:   "",
    beneficiario_doc:    "",
    pagador_nome:        "",
    pagador_doc:         "",
    valor:               "",
    competencia:         mesAtual,
    periodo:             "",
    cidade:              "Campo Grande - MS",
    data_emissao:        hoje,
  });

  const valido =
    !!form.beneficiario_nome.trim() &&
    !!form.beneficiario_doc.trim() &&
    !!form.pagador_nome.trim() &&
    !!form.pagador_doc.trim() &&
    !!form.competencia &&
    !!form.periodo.trim() &&
    !!form.cidade.trim() &&
    !!form.data_emissao &&
    Number(form.valor) > 0;

  function handleSubmit() {
    const dados: DadosReciboValeCombustivel = {
      beneficiario: { nome: form.beneficiario_nome.trim(), documento: form.beneficiario_doc.trim() },
      pagador:      { nome: form.pagador_nome.trim(),      documento: form.pagador_doc.trim() },
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
      <FormSection title="Beneficiário (quem recebe)" columns={2}>
        <Input label="Nome completo"  value={form.beneficiario_nome} onChange={(e) => setForm({ ...form, beneficiario_nome: e.target.value })} />
        <Input label="CPF"            value={form.beneficiario_doc}  onChange={(e) => setForm({ ...form, beneficiario_doc: e.target.value })} placeholder="000.000.000-00" />
      </FormSection>

      <FormSection title="Pagador" columns={2}>
        <Input label="Nome completo"  value={form.pagador_nome} onChange={(e) => setForm({ ...form, pagador_nome: e.target.value })} />
        <Input label="CPF"            value={form.pagador_doc}  onChange={(e) => setForm({ ...form, pagador_doc: e.target.value })} placeholder="000.000.000-00" />
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
