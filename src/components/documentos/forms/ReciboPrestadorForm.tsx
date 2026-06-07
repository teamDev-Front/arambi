"use client";
import { Input, Select } from "@/components/ui/Input";
import { FormShell, FormSection } from "./FormShell";
import { DraftBanner } from "./DraftBanner";
import { DescricaoAutocomplete } from "./DescricaoAutocomplete";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import {
  documentoLabel, mensagemDocumentoInvalido, validarDocumento, type PessoaTipo,
} from "@/lib/utils/documento";
import type { DadosReciboPagamentoPrestador } from "@/lib/pdf/types";

interface Props {
  onSubmit: (dados: DadosReciboPagamentoPrestador) => Promise<void> | void;
  onCancel: () => void;
  submitting: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  seed?: DadosReciboPagamentoPrestador | null;   // RF-09 — edição
}

function fromDados(d: DadosReciboPagamentoPrestador, hoje: string) {
  return {
    prestador_nome:    d.prestador.nome,
    prestador_tipo:    (d.prestador.tipo ?? "pf") as PessoaTipo,
    prestador_doc:     d.prestador.documento,
    pagador_nome:      d.pagador.nome,
    pagador_tipo:      (d.pagador.tipo ?? "pf") as PessoaTipo,
    pagador_doc:       d.pagador.documento,
    valor:             String(d.valor ?? ""),
    descricao_servico: d.descricao_servico,
    propriedade:       d.propriedade ?? "",
    data_pagamento:    d.data_pagamento ?? "",
    forma_pagamento:   d.forma_pagamento,
    cidade:            d.cidade,
    data_emissao:      d.data_emissao ?? hoje,
  };
}

export function ReciboPrestadorForm({ onSubmit, onCancel, submitting, onDirtyChange, seed }: Props) {
  const hoje = new Date().toISOString().slice(0, 10);

  const [form, setForm, draft] = useFormDraft("recibo_pagamento_prestador", seed ? fromDados(seed, hoje) : {
    prestador_nome:    "",
    prestador_tipo:    "pf" as PessoaTipo,
    prestador_doc:     "",
    pagador_nome:      "",
    pagador_tipo:      "pf" as PessoaTipo,
    pagador_doc:       "",
    valor:             "",
    descricao_servico: "",
    propriedade:       "Fazenda Aramburu",
    data_pagamento:    "",
    forma_pagamento:   "",
    cidade:            "Maracaju - MS",
    data_emissao:      hoje,
  }, onDirtyChange, !!seed);

  const prestadorDocOk = validarDocumento(form.prestador_tipo, form.prestador_doc);
  const pagadorDocOk   = validarDocumento(form.pagador_tipo, form.pagador_doc);

  const valido =
    !!form.prestador_nome.trim() &&
    prestadorDocOk &&
    !!form.pagador_nome.trim() &&
    pagadorDocOk &&
    !!form.descricao_servico.trim() &&
    !!form.forma_pagamento.trim() &&
    !!form.cidade.trim() &&
    Number(form.valor) > 0;

  function handleSubmit() {
    const dados: DadosReciboPagamentoPrestador = {
      prestador:           { nome: form.prestador_nome.trim(), documento: form.prestador_doc.trim(), tipo: form.prestador_tipo },
      pagador:             { nome: form.pagador_nome.trim(),   documento: form.pagador_doc.trim(),   tipo: form.pagador_tipo },
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
      <DraftBanner show={draft.recovered} onDiscard={draft.discard} />
      <FormSection title="Prestador (quem recebe)" columns={3}>
        <Input label="Nome / Razão social" value={form.prestador_nome} onChange={(e) => setForm({ ...form, prestador_nome: e.target.value })} />
        <Select
          label="Tipo"
          value={form.prestador_tipo}
          onChange={(e) => setForm({ ...form, prestador_tipo: e.target.value as PessoaTipo })}
        >
          <option value="pf">Pessoa Física</option>
          <option value="pj">Pessoa Jurídica</option>
        </Select>
        <Input
          label={documentoLabel(form.prestador_tipo)}
          value={form.prestador_doc}
          onChange={(e) => setForm({ ...form, prestador_doc: e.target.value })}
          placeholder={form.prestador_tipo === "pj" ? "00.000.000/0000-00" : "000.000.000-00"}
          error={form.prestador_doc.trim() && !prestadorDocOk ? mensagemDocumentoInvalido(form.prestador_tipo) : undefined}
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

      <FormSection title="Serviço" columns={1}>
        <DescricaoAutocomplete
          tipo="recibo_pagamento_prestador"
          label="Descrição do serviço prestado"
          value={form.descricao_servico}
          onChange={(v) => setForm({ ...form, descricao_servico: v })}
          placeholder="Ex.: troca de disjuntor, transformador, conectores e manutenção de baixa tensão"
          rows={3}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
