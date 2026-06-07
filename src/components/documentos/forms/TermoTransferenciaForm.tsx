"use client";
import { useEffect, useState } from "react";
import { Input, Select } from "@/components/ui/Input";
import { FormShell, FormSection } from "./FormShell";
import { DraftBanner } from "./DraftBanner";
import { DescricaoAutocomplete } from "./DescricaoAutocomplete";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { listarContasEmpresa } from "@/lib/queries/bancos";
import type { ContaBancariaEmpresaRow } from "@/types";
import type { DadosTermoTransferencia } from "@/lib/pdf/types";

interface Props {
  onSubmit: (dados: DadosTermoTransferencia) => Promise<void> | void;
  onCancel: () => void;
  submitting: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  seed?: DadosTermoTransferencia | null;   // RF-09 — edição
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
  };
}

export function TermoTransferenciaForm({ onSubmit, onCancel, submitting, onDirtyChange, seed }: Props) {
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

  const valido =
    !!form.remetente_razao_social.trim() &&
    !!form.remetente_documento.trim() &&
    !!form.remetente_banco.trim() &&
    !!form.remetente_agencia.trim() &&
    !!form.remetente_conta.trim() &&
    !!form.destinatario_razao_social.trim() &&
    !!form.destinatario_documento.trim() &&
    !!form.destinatario_banco.trim() &&
    !!form.destinatario_agencia.trim() &&
    !!form.destinatario_conta.trim() &&
    Number(form.valor) > 0 &&
    !!form.data_transferencia &&
    !!form.descricao_objeto.trim();

  function handleSubmit() {
    const dados: DadosTermoTransferencia = {
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
    };
    return onSubmit(dados);
  }

  return (
    <FormShell onCancel={onCancel} onSubmit={handleSubmit} submitting={submitting} disabled={!valido}>
      <DraftBanner show={draft.recovered} onDiscard={draft.discard} />
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
        <Input label="Banco"                value={form.destinatario_banco}        onChange={(e) => setForm({ ...form, destinatario_banco: e.target.value })} placeholder="Sicredi (748)" />
        <Input label="Agência"              value={form.destinatario_agencia}      onChange={(e) => setForm({ ...form, destinatario_agencia: e.target.value })} />
        <Input label="Conta Corrente"       value={form.destinatario_conta}        onChange={(e) => setForm({ ...form, destinatario_conta: e.target.value })} />
        <Input label="Chave Pix (opcional)" value={form.destinatario_pix}          onChange={(e) => setForm({ ...form, destinatario_pix: e.target.value })} />
      </FormSection>

      <FormSection title="Detalhes da transferência" columns={3}>
        <Input label="Valor (R$)"            type="number" step="0.01" min="0" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
        <Input label="Data da transferência" type="date" value={form.data_transferencia} onChange={(e) => setForm({ ...form, data_transferencia: e.target.value })} />
        <Input label="Nº da NF (opcional)"   value={form.numero_nota} onChange={(e) => setForm({ ...form, numero_nota: e.target.value })} />
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
    </FormShell>
  );
}
