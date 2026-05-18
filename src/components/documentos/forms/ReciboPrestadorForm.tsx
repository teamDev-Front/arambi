"use client";
import { useState } from "react";
import { Input, Textarea } from "@/components/ui/Input";
import { FormShell, FormSection } from "./FormShell";
import type { DadosReciboPagamentoPrestador } from "@/lib/pdf/types";

interface Props {
  onSubmit: (dados: DadosReciboPagamentoPrestador) => Promise<void> | void;
  onCancel: () => void;
  submitting: boolean;
}

export function ReciboPrestadorForm({ onSubmit, onCancel, submitting }: Props) {
  const hoje = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    prestador_nome:    "",
    prestador_cpf:     "",
    pagador_nome:      "",
    pagador_cpf:       "",
    valor:             "",
    descricao_servico: "",
    propriedade:       "Fazenda Aramburu",
    data_pagamento:    "",
    forma_pagamento:   "",
    cidade:            "Maracaju - MS",
    data_emissao:      hoje,
  });

  const valido =
    !!form.prestador_nome.trim() &&
    !!form.prestador_cpf.trim() &&
    !!form.pagador_nome.trim() &&
    !!form.pagador_cpf.trim() &&
    !!form.descricao_servico.trim() &&
    !!form.forma_pagamento.trim() &&
    !!form.cidade.trim() &&
    Number(form.valor) > 0;

  function handleSubmit() {
    const dados: DadosReciboPagamentoPrestador = {
      prestador:           { nome: form.prestador_nome.trim(), documento: form.prestador_cpf.trim() },
      pagador:             { nome: form.pagador_nome.trim(),   documento: form.pagador_cpf.trim() },
      valor:               Number(form.valor),
      descricao_servico:   form.descricao_servico.trim(),
      propriedade:         form.propriedade.trim() || undefined,
      data_pagamento:      form.data_pagamento || undefined,
      forma_pagamento:     form.forma_pagamento.trim(),
      cidade:              form.cidade.trim(),
      data_emissao:        form.data_emissao || undefined,
    };
    return onSubmit(dados);
  }

  return (
    <FormShell onCancel={onCancel} onSubmit={handleSubmit} submitting={submitting} disabled={!valido}>
      <FormSection title="Prestador (quem recebe)" columns={2}>
        <Input label="Nome completo" value={form.prestador_nome} onChange={(e) => setForm({ ...form, prestador_nome: e.target.value })} />
        <Input label="CPF"           value={form.prestador_cpf}  onChange={(e) => setForm({ ...form, prestador_cpf: e.target.value })} placeholder="000.000.000-00" />
      </FormSection>

      <FormSection title="Pagador" columns={2}>
        <Input label="Nome completo" value={form.pagador_nome} onChange={(e) => setForm({ ...form, pagador_nome: e.target.value })} />
        <Input label="CPF"           value={form.pagador_cpf}  onChange={(e) => setForm({ ...form, pagador_cpf: e.target.value })} placeholder="000.000.000-00" />
      </FormSection>

      <FormSection title="Serviço" columns={1}>
        <Textarea
          label="Descrição do serviço prestado"
          value={form.descricao_servico}
          onChange={(e) => setForm({ ...form, descricao_servico: e.target.value })}
          placeholder="Ex.: troca de disjuntor, transformador, conectores e manutenção de baixa tensão"
          rows={3}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Valor (R$)"  type="number" step="0.01" min="0" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
          <Input label="Propriedade (opcional)" value={form.propriedade} onChange={(e) => setForm({ ...form, propriedade: e.target.value })} />
        </div>
      </FormSection>

      <FormSection title="Pagamento" columns={2}>
        <Input label="Data do pagamento (opcional)" type="date" value={form.data_pagamento} onChange={(e) => setForm({ ...form, data_pagamento: e.target.value })} />
        <Input label="Forma de pagamento"   value={form.forma_pagamento} onChange={(e) => setForm({ ...form, forma_pagamento: e.target.value })} placeholder="Chave Pix – CPF ... (Banco)" />
      </FormSection>

      <FormSection title="Local e data" columns={2}>
        <Input label="Cidade/UF"            value={form.cidade}        onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
        <Input label="Data de emissão"      type="date" value={form.data_emissao} onChange={(e) => setForm({ ...form, data_emissao: e.target.value })} />
      </FormSection>
    </FormShell>
  );
}
