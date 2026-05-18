"use client";
import { useState } from "react";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { FormShell, FormSection } from "./FormShell";
import type { DadosTermoAutorizacaoTerceiros } from "@/lib/pdf/types";

interface Props {
  onSubmit: (dados: DadosTermoAutorizacaoTerceiros) => Promise<void> | void;
  onCancel: () => void;
  submitting: boolean;
}

export function TermoAutorizacaoForm({ onSubmit, onCancel, submitting }: Props) {
  const hoje = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    autorizante_razao_social: "",
    autorizante_tipo:         "pj" as "pj" | "pf",
    autorizante_documento:    "",
    autorizante_endereco:     "",
    autorizada_razao_social:  "AGROPECUÁRIA ARAMBURU LTDA",
    autorizada_documento:     "30.921.299/0001-88",
    autorizada_endereco:      "Rodovia MS 157 KM 21 a Direita mais 1,2 KM, Zona Rural, Maracaju – MS",
    numero_nota:              "",
    valor_pagamento:          "",
    valor_total_nota:         "",
    titulo_pagamento:         "",
    saldo_remanescente:       "",
    beneficiario_nome:        "",
    beneficiario_cpf:         "",
    benef_banco:              "",
    benef_agencia:            "",
    benef_conta:              "",
    benef_chave_pix:          "",
    parentesco:               "",
    cidade:                   "",
    data_emissao:             hoje,
    signatario_nome:          "",
  });

  const valido =
    !!form.autorizante_razao_social.trim() &&
    !!form.autorizante_documento.trim() &&
    !!form.autorizante_endereco.trim() &&
    !!form.autorizada_razao_social.trim() &&
    !!form.autorizada_documento.trim() &&
    !!form.autorizada_endereco.trim() &&
    !!form.numero_nota.trim() &&
    Number(form.valor_pagamento) > 0 &&
    Number(form.valor_total_nota) > 0 &&
    !!form.beneficiario_nome.trim() &&
    !!form.beneficiario_cpf.trim() &&
    !!form.benef_banco.trim() &&
    !!form.benef_agencia.trim() &&
    !!form.benef_conta.trim() &&
    !!form.cidade.trim() &&
    !!form.data_emissao &&
    !!form.signatario_nome.trim();

  function handleSubmit() {
    const dados: DadosTermoAutorizacaoTerceiros = {
      autorizante_razao_social: form.autorizante_razao_social.trim(),
      autorizante_tipo:         form.autorizante_tipo,
      autorizante_documento:    form.autorizante_documento.trim(),
      autorizante_endereco:     form.autorizante_endereco.trim(),
      autorizada_razao_social:  form.autorizada_razao_social.trim(),
      autorizada_documento:     form.autorizada_documento.trim(),
      autorizada_endereco:      form.autorizada_endereco.trim(),
      numero_nota:              form.numero_nota.trim(),
      valor_pagamento:          Number(form.valor_pagamento),
      valor_total_nota:         Number(form.valor_total_nota),
      titulo_pagamento:         form.titulo_pagamento.trim() || undefined,
      saldo_remanescente:       form.saldo_remanescente ? Number(form.saldo_remanescente) : undefined,
      beneficiario_nome:        form.beneficiario_nome.trim(),
      beneficiario_cpf:         form.beneficiario_cpf.trim(),
      beneficiario_dados_bancarios: {
        banco:      form.benef_banco.trim(),
        agencia:    form.benef_agencia.trim(),
        conta:      form.benef_conta.trim(),
        chave_pix:  form.benef_chave_pix.trim() || undefined,
      },
      parentesco:               form.parentesco.trim() || undefined,
      cidade:                   form.cidade.trim(),
      data_emissao:             form.data_emissao,
      signatario_nome:          form.signatario_nome.trim(),
    };
    return onSubmit(dados);
  }

  return (
    <FormShell onCancel={onCancel} onSubmit={handleSubmit} submitting={submitting} disabled={!valido}>
      <FormSection title="Autorizante (quem autoriza o pagamento)" columns={2}>
        <Input  label="Razão social / Nome" value={form.autorizante_razao_social} onChange={(e) => setForm({ ...form, autorizante_razao_social: e.target.value })} />
        <Select label="Tipo"                value={form.autorizante_tipo}         onChange={(e) => setForm({ ...form, autorizante_tipo: e.target.value as "pj" | "pf" })}>
          <option value="pj">Pessoa Jurídica</option>
          <option value="pf">Pessoa Física</option>
        </Select>
        <Input  label={form.autorizante_tipo === "pj" ? "CNPJ" : "CPF"} value={form.autorizante_documento} onChange={(e) => setForm({ ...form, autorizante_documento: e.target.value })} />
        <Input  label="Endereço completo"   value={form.autorizante_endereco}    onChange={(e) => setForm({ ...form, autorizante_endereco: e.target.value })} />
      </FormSection>

      <FormSection title="Autorizada (quem efetua o pagamento)" columns={1}>
        <Input  label="Razão social"        value={form.autorizada_razao_social} onChange={(e) => setForm({ ...form, autorizada_razao_social: e.target.value })} />
        <div className="grid grid-cols-2 gap-4">
          <Input  label="CNPJ"              value={form.autorizada_documento}    onChange={(e) => setForm({ ...form, autorizada_documento: e.target.value })} />
          <Input  label="Endereço"          value={form.autorizada_endereco}     onChange={(e) => setForm({ ...form, autorizada_endereco: e.target.value })} />
        </div>
      </FormSection>

      <FormSection title="Detalhes da operação" columns={3}>
        <Input  label="Nº da NF"            value={form.numero_nota}      onChange={(e) => setForm({ ...form, numero_nota: e.target.value })} />
        <Input  label="Valor a autorizar (R$)" type="number" step="0.01" min="0" value={form.valor_pagamento} onChange={(e) => setForm({ ...form, valor_pagamento: e.target.value })} />
        <Input  label="Valor total da NF (R$)" type="number" step="0.01" min="0" value={form.valor_total_nota} onChange={(e) => setForm({ ...form, valor_total_nota: e.target.value })} />
        <Input  label="Título (opcional)"   value={form.titulo_pagamento} onChange={(e) => setForm({ ...form, titulo_pagamento: e.target.value })} placeholder="entrada, parcela 2/3..." />
        <Input  label="Saldo remanescente (R$)" type="number" step="0.01" min="0" value={form.saldo_remanescente} onChange={(e) => setForm({ ...form, saldo_remanescente: e.target.value })} />
      </FormSection>

      <FormSection title="Beneficiário do pagamento" columns={2}>
        <Input  label="Nome completo"       value={form.beneficiario_nome}    onChange={(e) => setForm({ ...form, beneficiario_nome: e.target.value })} />
        <Input  label="CPF"                 value={form.beneficiario_cpf}     onChange={(e) => setForm({ ...form, beneficiario_cpf: e.target.value })} />
        <Input  label="Banco"               value={form.benef_banco}          onChange={(e) => setForm({ ...form, benef_banco: e.target.value })} placeholder="Cooperativa Sicredi Vanguarda PR/SP/RJ (748)" />
        <Input  label="Agência"             value={form.benef_agencia}        onChange={(e) => setForm({ ...form, benef_agencia: e.target.value })} />
        <Input  label="Conta"               value={form.benef_conta}          onChange={(e) => setForm({ ...form, benef_conta: e.target.value })} />
        <Input  label="Chave Pix (opcional)" value={form.benef_chave_pix}     onChange={(e) => setForm({ ...form, benef_chave_pix: e.target.value })} />
        <Textarea label="Parentesco / vínculo (opcional)" rows={2}
                  value={form.parentesco}    onChange={(e) => setForm({ ...form, parentesco: e.target.value })}
                  placeholder="parente de primeiro grau (filha) do representante..." />
      </FormSection>

      <FormSection title="Local, data e assinatura" columns={2}>
        <Input  label="Cidade/UF"           value={form.cidade}            onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
        <Input  label="Data de emissão"     type="date" value={form.data_emissao} onChange={(e) => setForm({ ...form, data_emissao: e.target.value })} />
        <Input  label="Nome do signatário (assinatura)" value={form.signatario_nome} onChange={(e) => setForm({ ...form, signatario_nome: e.target.value })} />
      </FormSection>
    </FormShell>
  );
}
