"use client";
import { Input } from "@/components/ui/Input";
import { FormShell, FormSection } from "./FormShell";
import { DraftBanner } from "./DraftBanner";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import type { DadosReciboAluguel } from "@/lib/pdf/types";

interface Props {
  onSubmit: (dados: DadosReciboAluguel) => Promise<void> | void;
  onCancel: () => void;
  submitting: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  seed?: DadosReciboAluguel | null;   // RF-09 — edição
}

function fromDados(d: DadosReciboAluguel) {
  return {
    numero:               d.numero,
    proprietario_nome:    d.proprietario_nome,
    imovel_nome:          d.imovel_nome,
    imovel_endereco:      d.imovel_endereco,
    locatario_nome:       d.locatario_nome,
    locatario_cnpj:       d.locatario_cnpj,
    valor:                String(d.valor ?? ""),
    competencia:          d.competencia,
    data_pagamento:       d.data_pagamento,
    forma_pagamento:      d.forma_pagamento,
    tipo_servico:         d.tipo_servico ?? "",
    cidade:               d.cidade,
    data_emissao:         d.data_emissao,
    emissor_razao_social: d.emissor_razao_social,
    emissor_cnpj:         d.emissor_cnpj,
    emissor_signatario:   d.emissor_signatario,
  };
}

export function ReciboAluguelForm({ onSubmit, onCancel, submitting, onDirtyChange, seed }: Props) {
  const hoje = new Date().toISOString().slice(0, 10);
  const mesAtual = hoje.slice(0, 7);

  const [form, setForm, draft] = useFormDraft("recibo_aluguel", seed ? fromDados(seed) : {
    numero:                "",
    proprietario_nome:     "",
    imovel_nome:           "",
    imovel_endereco:       "",
    locatario_nome:        "Agropecuária Aramburu Ltda",
    locatario_cnpj:        "30.921.299/0001-88",
    valor:                 "",
    competencia:           mesAtual,
    data_pagamento:        hoje,
    forma_pagamento:       "",
    tipo_servico:          "",
    cidade:                "Campo Grande - MS",
    data_emissao:          hoje,
    emissor_razao_social:  "",
    emissor_cnpj:          "",
    emissor_signatario:    "",
  }, onDirtyChange, !!seed);

  const valido =
    !!form.numero.trim() &&
    !!form.proprietario_nome.trim() &&
    !!form.imovel_nome.trim() &&
    !!form.imovel_endereco.trim() &&
    !!form.locatario_nome.trim() &&
    !!form.locatario_cnpj.trim() &&
    !!form.competencia &&
    !!form.data_pagamento &&
    !!form.forma_pagamento.trim() &&
    !!form.cidade.trim() &&
    !!form.data_emissao &&
    !!form.emissor_razao_social.trim() &&
    !!form.emissor_cnpj.trim() &&
    !!form.emissor_signatario.trim() &&
    Number(form.valor) > 0;

  function handleSubmit() {
    const dados: DadosReciboAluguel = {
      numero:               form.numero.trim(),
      proprietario_nome:    form.proprietario_nome.trim(),
      imovel_nome:          form.imovel_nome.trim(),
      imovel_endereco:      form.imovel_endereco.trim(),
      locatario_nome:       form.locatario_nome.trim(),
      locatario_cnpj:       form.locatario_cnpj.trim(),
      valor:                Number(form.valor),
      competencia:          form.competencia,
      data_pagamento:       form.data_pagamento,
      forma_pagamento:      form.forma_pagamento.trim(),
      tipo_servico:         form.tipo_servico.trim() || undefined,
      cidade:               form.cidade.trim(),
      data_emissao:         form.data_emissao,
      emissor_razao_social: form.emissor_razao_social.trim(),
      emissor_cnpj:         form.emissor_cnpj.trim(),
      emissor_signatario:   form.emissor_signatario.trim(),
    };
    return onSubmit(dados);
  }

  return (
    <FormShell onCancel={onCancel} onSubmit={handleSubmit} submitting={submitting} disabled={!valido}>
      <DraftBanner show={draft.recovered} onDiscard={draft.discard} />
      <FormSection title="Identificação do recibo" columns={2}>
        <Input label="Número"            value={form.numero}             onChange={(e) => setForm({ ...form, numero: e.target.value })}             placeholder="022/2026" />
        <Input label="Proprietário"      value={form.proprietario_nome}  onChange={(e) => setForm({ ...form, proprietario_nome: e.target.value })} />
      </FormSection>

      <FormSection title="Imóvel" columns={1}>
        <Input label="Nome do imóvel"    value={form.imovel_nome}        onChange={(e) => setForm({ ...form, imovel_nome: e.target.value })} placeholder="Atmosphera – Saúde, Esportes e Recreação Ltda" />
        <Input label="Endereço completo" value={form.imovel_endereco}    onChange={(e) => setForm({ ...form, imovel_endereco: e.target.value })} placeholder="Rua, número, bairro, cidade-UF, CEP" />
      </FormSection>

      <FormSection title="Locatário (pagador)" columns={2}>
        <Input label="Razão social"      value={form.locatario_nome}     onChange={(e) => setForm({ ...form, locatario_nome: e.target.value })} />
        <Input label="CNPJ"              value={form.locatario_cnpj}     onChange={(e) => setForm({ ...form, locatario_cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
      </FormSection>

      <FormSection title="Pagamento" columns={3}>
        <Input label="Valor (R$)"        type="number" step="0.01" min="0" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
        <Input label="Competência"       type="month" value={form.competencia} onChange={(e) => setForm({ ...form, competencia: e.target.value })} />
        <Input label="Data do pagamento" type="date" value={form.data_pagamento} onChange={(e) => setForm({ ...form, data_pagamento: e.target.value })} />
        <Input label="Forma de pagamento"  value={form.forma_pagamento} onChange={(e) => setForm({ ...form, forma_pagamento: e.target.value })} placeholder="Chave Pix - CNPJ nº ..." />
        <Input label="Tipo de serviço"     value={form.tipo_servico}    onChange={(e) => setForm({ ...form, tipo_servico: e.target.value })}    placeholder="Coworking (opcional)" />
        <Input label="Cidade/UF"           value={form.cidade}          onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
      </FormSection>

      <FormSection title="Emissor (rodapé)" columns={1}>
        <Input label="Razão social do emissor" value={form.emissor_razao_social} onChange={(e) => setForm({ ...form, emissor_razao_social: e.target.value })} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="CNPJ do emissor"       value={form.emissor_cnpj}        onChange={(e) => setForm({ ...form, emissor_cnpj: e.target.value })} />
          <Input label="Signatário"            value={form.emissor_signatario}  onChange={(e) => setForm({ ...form, emissor_signatario: e.target.value })} />
        </div>
        <Input label="Data de emissão"         type="date" value={form.data_emissao} onChange={(e) => setForm({ ...form, data_emissao: e.target.value })} />
      </FormSection>
    </FormShell>
  );
}
