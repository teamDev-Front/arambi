"use client";
import { useState } from "react";
import { Input, Textarea } from "@/components/ui/Input";
import { FormShell, FormSection } from "./FormShell";
import type { DadosContratoPrestacaoServicos } from "@/lib/pdf/types";

interface Props {
  onSubmit: (dados: DadosContratoPrestacaoServicos) => Promise<void> | void;
  onCancel: () => void;
  submitting: boolean;
}

export function ContratoForm({ onSubmit, onCancel, submitting }: Props) {
  const hoje = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    contratante_razao_social:        "AGROPECUÁRIA ARAMBURU LTDA",
    contratante_cnpj:                "30.921.299/0001-88",
    contratante_inscricao_estadual:  "28.828.807-6",
    contratante_endereco:            "Rodovia MS 157, KM 21, entrada à direita mais 12km, Zona Rural, CEP 79150-000, Maracaju/MS",
    contratante_telefone:            "(67) 99805-0505",
    contratante_email:               "financeirofragelli@gmail.com",
    contratante_representantes:      "Cláudio Luiz Resta Fragelli e Ana Beatriz Ponte Fragelli",
    contratado_nome:                 "",
    contratado_nacionalidade:        "brasileiro",
    contratado_nascimento:           "",
    contratado_naturalidade:         "",
    contratado_cpf:                  "",
    contratado_rg:                   "",
    contratado_endereco:             "",
    objeto:                          "",
    valor_total:                     "",
    pagamento_texto:                 "",
    prazo_texto:                     "",
    multa_percentual:                "10",
    foro_comarca:                    "Maracaju/MS",
    cidade:                          "Maracaju, MS",
    data_emissao:                    hoje,
  });

  const valido =
    !!form.contratante_razao_social.trim() &&
    !!form.contratante_cnpj.trim() &&
    !!form.contratante_endereco.trim() &&
    !!form.contratante_representantes.trim() &&
    !!form.contratado_nome.trim() &&
    !!form.contratado_cpf.trim() &&
    !!form.contratado_endereco.trim() &&
    !!form.objeto.trim() &&
    Number(form.valor_total) > 0 &&
    !!form.pagamento_texto.trim() &&
    !!form.prazo_texto.trim() &&
    !!form.foro_comarca.trim() &&
    !!form.cidade.trim() &&
    !!form.data_emissao;

  function handleSubmit() {
    const dados: DadosContratoPrestacaoServicos = {
      contratante_razao_social:       form.contratante_razao_social.trim(),
      contratante_cnpj:               form.contratante_cnpj.trim(),
      contratante_inscricao_estadual: form.contratante_inscricao_estadual.trim() || undefined,
      contratante_endereco:           form.contratante_endereco.trim(),
      contratante_telefone:           form.contratante_telefone.trim() || undefined,
      contratante_email:              form.contratante_email.trim()    || undefined,
      contratante_representantes:     form.contratante_representantes.trim(),
      contratado_nome:                form.contratado_nome.trim(),
      contratado_nacionalidade:       form.contratado_nacionalidade.trim() || undefined,
      contratado_nascimento:          form.contratado_nascimento           || undefined,
      contratado_naturalidade:        form.contratado_naturalidade.trim()  || undefined,
      contratado_cpf:                 form.contratado_cpf.trim(),
      contratado_rg:                  form.contratado_rg.trim() || undefined,
      contratado_endereco:            form.contratado_endereco.trim(),
      objeto:                         form.objeto.trim(),
      valor_total:                    Number(form.valor_total),
      pagamento_texto:                form.pagamento_texto.trim(),
      prazo_texto:                    form.prazo_texto.trim(),
      multa_percentual:               form.multa_percentual ? Number(form.multa_percentual) : undefined,
      foro_comarca:                   form.foro_comarca.trim(),
      cidade:                         form.cidade.trim(),
      data_emissao:                   form.data_emissao,
    };
    return onSubmit(dados);
  }

  return (
    <FormShell onCancel={onCancel} onSubmit={handleSubmit} submitting={submitting} disabled={!valido}>
      <FormSection title="Contratante" columns={2}>
        <Input label="Razão social"             value={form.contratante_razao_social}      onChange={(e) => setForm({ ...form, contratante_razao_social: e.target.value })} />
        <Input label="CNPJ"                     value={form.contratante_cnpj}              onChange={(e) => setForm({ ...form, contratante_cnpj: e.target.value })} />
        <Input label="Inscrição estadual"       value={form.contratante_inscricao_estadual} onChange={(e) => setForm({ ...form, contratante_inscricao_estadual: e.target.value })} />
        <Input label="Telefone"                 value={form.contratante_telefone}          onChange={(e) => setForm({ ...form, contratante_telefone: e.target.value })} />
        <Input label="E-mail"                   value={form.contratante_email}             onChange={(e) => setForm({ ...form, contratante_email: e.target.value })} />
        <Input label="Representantes legais"    value={form.contratante_representantes}    onChange={(e) => setForm({ ...form, contratante_representantes: e.target.value })} />
      </FormSection>
      <FormSection columns={1}>
        <Input label="Endereço completo (contratante)" value={form.contratante_endereco} onChange={(e) => setForm({ ...form, contratante_endereco: e.target.value })} />
      </FormSection>

      <FormSection title="Contratado" columns={2}>
        <Input label="Nome completo"            value={form.contratado_nome}          onChange={(e) => setForm({ ...form, contratado_nome: e.target.value })} />
        <Input label="Nacionalidade"            value={form.contratado_nacionalidade} onChange={(e) => setForm({ ...form, contratado_nacionalidade: e.target.value })} />
        <Input label="Data de nascimento"       type="date" value={form.contratado_nascimento} onChange={(e) => setForm({ ...form, contratado_nascimento: e.target.value })} />
        <Input label="Naturalidade"             value={form.contratado_naturalidade}  onChange={(e) => setForm({ ...form, contratado_naturalidade: e.target.value })} placeholder="Dourados/MS" />
        <Input label="CPF"                      value={form.contratado_cpf}           onChange={(e) => setForm({ ...form, contratado_cpf: e.target.value })} />
        <Input label="RG (com órgão emissor)"   value={form.contratado_rg}            onChange={(e) => setForm({ ...form, contratado_rg: e.target.value })} placeholder="152966 – SSP/MS" />
      </FormSection>
      <FormSection columns={1}>
        <Input label="Endereço completo (contratado)" value={form.contratado_endereco} onChange={(e) => setForm({ ...form, contratado_endereco: e.target.value })} />
      </FormSection>

      <FormSection title="Objeto e cláusulas" columns={1}>
        <Textarea label="Cláusula 1 – Objeto do contrato" rows={3}
                  value={form.objeto}     onChange={(e) => setForm({ ...form, objeto: e.target.value })}
                  placeholder="Ex: prestação de serviços de construção civil, consistentes na execução..." />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Valor total (R$)"   type="number" step="0.01" min="0" value={form.valor_total} onChange={(e) => setForm({ ...form, valor_total: e.target.value })} />
          <Input label="Multa (%)"          type="number" step="1" min="0" max="100" value={form.multa_percentual} onChange={(e) => setForm({ ...form, multa_percentual: e.target.value })} />
        </div>
        <Textarea label="Cláusula 2 – Detalhes do pagamento (após o valor total)" rows={4}
                  value={form.pagamento_texto} onChange={(e) => setForm({ ...form, pagamento_texto: e.target.value })}
                  placeholder="Ex: O valor de R$ 5.000,00 (cinco mil reais) foi pago a título de entrada em 06/02/2026, via Pix. O saldo remanescente será pago..." />
        <Textarea label="Cláusula 3 – Prazo de execução" rows={3}
                  value={form.prazo_texto} onChange={(e) => setForm({ ...form, prazo_texto: e.target.value })}
                  placeholder="Os serviços encontram-se em andamento na data de assinatura, com previsão de conclusão até..." />
      </FormSection>

      <FormSection title="Foro, local e data" columns={3}>
        <Input label="Foro (comarca)"    value={form.foro_comarca} onChange={(e) => setForm({ ...form, foro_comarca: e.target.value })} />
        <Input label="Cidade da assinatura" value={form.cidade}    onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
        <Input label="Data de emissão"   type="date" value={form.data_emissao} onChange={(e) => setForm({ ...form, data_emissao: e.target.value })} />
      </FormSection>
    </FormShell>
  );
}
