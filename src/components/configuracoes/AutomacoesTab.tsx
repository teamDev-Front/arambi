"use client";
import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Landmark, Loader2, SlidersHorizontal } from "lucide-react";
import {
  obterConfigApp, obterConfigAppSeExistir, salvarConfigApp, CONFIG_RESGATES_SICREDI,
  CONFIG_LIMITE_DV, CONFIG_FATURA_CARTAO_DIA, CONFIG_RESGATE_CONTA_ORIGEM,
} from "@/lib/queries/configuracoes";
import { listarContasEmpresa } from "@/lib/queries/bancos";
import type { ContaBancariaEmpresaRow } from "@/types";

/**
 * Configurações → Automações (ajuste 27-jul).
 *
 * Toggle dos RESGATES AUTOMÁTICOS do Sicredi Invest: hoje, toda despesa
 * lançada na conta Sicredi gera automaticamente um resgate do Invest para
 * cobrir o pagamento. Quando a operação passar a ser direto na conta corrente,
 * basta DESLIGAR aqui — sem reconfigurar nada no sistema (pedido da Lola:
 * "como podemos deixar no sistema, para não ter que reconfigurar futuramente?").
 *
 * Desde a 0064 (reunião 20-out) dá para escolher DE QUAL conta de investimento
 * os resgates saem (SICREDINVEST, SICREDI EMPRESARIAL, SICREDI APLICAÇÃO
 * AUTOMÁTICA…) — ver ContaOrigemResgates.
 */
export function AutomacoesTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [resgatesAtivos, setResgatesAtivos] = useState<boolean | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    obterConfigApp(CONFIG_RESGATES_SICREDI, "on")
      .then((v) => setResgatesAtivos(v !== "off"))
      .catch((e: unknown) => {
        setResgatesAtivos(true);
        toast.error("Erro carregando configuração", (e as Error).message ?? String(e));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function alternar() {
    if (resgatesAtivos === null || salvando) return;
    const novo = !resgatesAtivos;
    setSalvando(true);
    try {
      await salvarConfigApp(CONFIG_RESGATES_SICREDI, novo ? "on" : "off");
      setResgatesAtivos(novo);
      toast.success(
        novo ? "Resgates automáticos LIGADOS" : "Resgates automáticos DESLIGADOS",
        novo
          ? "Despesas na conta Sicredi voltam a gerar o resgate automático da conta de investimento."
          : "Novos lançamentos na conta Sicredi NÃO geram mais resgate automático. Os resgates já existentes não foram alterados.",
      );
    } catch (e: unknown) {
      toast.error("Não foi possível salvar", (e as Error).message ?? String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Resgates automáticos — Sicredi</CardTitle>
          <Landmark size={16} className="text-stone-400" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="text-sm text-stone-600 space-y-2 max-w-xl">
              <p>
                <b className="text-stone-800">Como funciona hoje:</b> ao lançar uma despesa vinculada à conta
                Sicredi (0913), o sistema gera automaticamente um <b>resgate da conta de investimento</b>{" "}
                (escolhida abaixo) no dia útil anterior ao vencimento, para suprir o pagamento.
              </p>
              <p>
                Quando vocês deixarem de trabalhar com essa sistemática e passarem a operar direto na{" "}
                <b>conta corrente</b>, basta desligar a chave ao lado — nenhuma outra configuração é
                necessária, e dá para religar a qualquer momento.
              </p>
              <p className="text-xs text-stone-400">
                Desligar NÃO altera resgates e vínculos já existentes — apenas os lançamentos novos deixam de
                gerar resgate automático.
              </p>
            </div>
            {resgatesAtivos === null ? (
              <span className="inline-flex items-center gap-2 text-sm text-stone-400">
                <Loader2 size={16} className="animate-spin" /> Carregando…
              </span>
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={resgatesAtivos}
                disabled={!canEdit || salvando}
                onClick={alternar}
                title={canEdit
                  ? (resgatesAtivos ? "Clique para DESLIGAR os resgates automáticos" : "Clique para LIGAR os resgates automáticos")
                  : "Apenas administradores podem alterar"}
                className={`relative inline-flex h-8 w-32 items-center rounded-full transition-colors text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  resgatesAtivos ? "bg-emerald-600 text-white" : "bg-stone-300 text-stone-700"
                }`}
              >
                <span className={`absolute h-6 w-6 rounded-full bg-white shadow transition-all ${resgatesAtivos ? "right-1" : "left-1"}`} />
                <span className={`w-full ${resgatesAtivos ? "pr-8 text-right" : "pl-8 text-left"} px-3`}>
                  {salvando ? "…" : resgatesAtivos ? "LIGADO" : "DESLIGADO"}
                </span>
              </button>
            )}
          </div>

          <ContaOrigemResgates canEdit={canEdit} />
        </CardContent>
      </Card>
      {/* Parâmetros numéricos (RF 31-jul) — limite de DV e vencimento da fatura */}
      <Card>
        <CardHeader>
          <CardTitle>Parâmetros do Financeiro</CardTitle>
          <SlidersHorizontal size={16} className="text-stone-400" />
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="text-sm text-stone-600 max-w-xl space-y-1">
              <p><b className="text-stone-800">Limite mensal de Despesas Variáveis</b></p>
              <p className="text-xs leading-relaxed">
                Teto usado pelo card <b>Despesa Variável</b> do Financeiro: o saldo do mês é este limite
                menos o que já foi lançado como Despesa Variável (status A pagar, Pago e Provisionado).
                É o mesmo &quot;20 mil&quot; que era controlado na planilha.
              </p>
            </div>
            <ParametroNumerico
              chave={CONFIG_LIMITE_DV}
              fallback="20000"
              sufixo="R$"
              largura="w-32"
              canEdit={canEdit}
              min={0}
              rotuloSucesso="Limite de Despesa Variável atualizado"
            />
          </div>

          <div className="flex items-start justify-between gap-4 flex-wrap border-t border-stone-100 pt-4">
            <div className="text-sm text-stone-600 max-w-xl space-y-1">
              <p><b className="text-stone-800">Vencimento da fatura do cartão Sicredi</b></p>
              <p className="text-xs leading-relaxed">
                Dia do mês em que a fatura vence. Os lançamentos do Sicredi com forma de pagamento
                <b> Cartão de Crédito</b> geram <b>um único resgate</b> do Invest, programado para o dia
                útil anterior a esta data. As demais formas de pagamento seguem a regra normal.
              </p>
            </div>
            <ParametroNumerico
              chave={CONFIG_FATURA_CARTAO_DIA}
              fallback="15"
              sufixo="dia"
              largura="w-20"
              canEdit={canEdit}
              min={1}
              max={28}
              rotuloSucesso="Vencimento da fatura atualizado"
            />
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-stone-400">
        As automações valem para todo o sistema. Alterações exigem as migrations 0047 e 0048 aplicadas no banco
        (a conta de origem dos resgates, a 0064).
      </p>
    </div>
  );
}

/** Mesma regra de fn_conta_sicredi_invest_padrao() no banco (0044/0064). */
function ehSicredInvest(c: ContaBancariaEmpresaRow): boolean {
  return c.nome === "Cooperativa Sicredi Investimento (0913)" || c.apelido === "SICREDINVEST";
}

function rotuloConta(c: ContaBancariaEmpresaRow): string {
  return c.apelido?.trim() || c.nome;
}

/** Valor do <select> enquanto a conta gravada for inválida (força o onChange). */
const OPCAO_INVALIDA = "__invalida__";

/**
 * Conta de origem dos resgates automáticos (migration 0064, reunião 20-out).
 *
 * Grava em app_config `resgate_conta_origem` o id da conta de investimento;
 * vazio = SICREDINVEST (padrão). O banco só aceita conta ATIVA de tipo
 * investimento — qualquer outra coisa cai na SICREDINVEST, e a tela avisa.
 * Vale para os resgates criados a partir da troca: os que já existem continuam
 * na conta deles (o banco nunca muda a conta de um par já criado).
 */
function ContaOrigemResgates({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [contas, setContas] = useState<ContaBancariaEmpresaRow[]>([]);
  // null = a chave não existe → migration 0064 ainda não aplicada.
  const [gravado, setGravado] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [erroCarga, setErroCarga] = useState(false);
  const [pendente, setPendente] = useState<string | null>(null); // escolha aguardando confirmação
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    Promise.all([listarContasEmpresa(), obterConfigAppSeExistir(CONFIG_RESGATE_CONTA_ORIGEM)])
      .then(([cs, v]) => {
        setContas(cs);
        setGravado(v);
      })
      .catch((e: unknown) => {
        setErroCarga(true);
        toast.error("Erro carregando a conta de origem dos resgates", (e as Error).message ?? String(e));
      })
      .finally(() => setCarregado(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const migrationAplicada = gravado !== null;
  const investimentos = contas.filter((c) => c.ativa && c.tipo === "investimento");
  const padrao = contas.filter(ehSicredInvest).sort((a, b) => Number(b.ativa) - Number(a.ativa))[0];
  const nomePadrao = padrao ? rotuloConta(padrao) : "SICREDINVEST";
  const idGravado = (gravado ?? "").trim().toLowerCase();
  const configurada = idGravado ? investimentos.find((c) => c.id.toLowerCase() === idGravado) : undefined;
  const invalida = idGravado !== "" && !configurada;
  const efetiva = configurada ?? padrao;
  const valorSelect = invalida
    ? OPCAO_INVALIDA
    : configurada && configurada.id !== padrao?.id ? configurada.id : "";

  // A SICREDINVEST é gravada como vazio ("sem configuração" = comportamento de sempre).
  const opcoes = investimentos.map((c) => ({
    value: c.id === padrao?.id ? "" : c.id,
    label: c.id === padrao?.id ? `${rotuloConta(c)} (padrão)` : rotuloConta(c),
  }));
  if (!opcoes.some((o) => o.value === "")) opcoes.unshift({ value: "", label: `${nomePadrao} (padrão)` });

  function nomeDe(v: string): string {
    if (v === "") return nomePadrao;
    const c = investimentos.find((x) => x.id === v);
    return c ? rotuloConta(c) : "escolhida";
  }

  async function confirmar() {
    if (pendente === null || salvando) return;
    setSalvando(true);
    try {
      await salvarConfigApp(CONFIG_RESGATE_CONTA_ORIGEM, pendente);
      setGravado(pendente);
      toast.success(
        `Resgates novos saem da conta ${nomeDe(pendente)}`,
        "Os resgates já criados continuam na conta em que foram lançados.",
      );
      setPendente(null);
    } catch (e: unknown) {
      toast.error("Não foi possível salvar", (e as Error).message ?? String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 flex-wrap border-t border-stone-100 pt-4">
      <div className="text-sm text-stone-600 max-w-xl space-y-1">
        <p><b className="text-stone-800">Conta de origem dos resgates automáticos</b></p>
        <p className="text-xs leading-relaxed">
          Conta de investimento de onde sai o dinheiro de cada resgate (a linha negativa do par; a
          positiva continua na conta Sicredi). Vale para os resgates criados a partir da troca — os que
          já existem, inclusive a linha amarela (provisionados) de um mês que já tenha uma, continuam na
          conta em que foram lançados.
        </p>
        {carregado && !erroCarga && !migrationAplicada && (
          <p className="text-xs text-amber-700">
            Disponível depois que a migration 0064 for aplicada no banco. Até lá, os resgates saem da{" "}
            {nomePadrao}.
          </p>
        )}
        {invalida && (
          <p className="text-xs text-amber-700">
            A conta escolhida está inativa ou não é de investimento — os resgates novos estão saindo da{" "}
            {nomePadrao}. Escolha uma conta na lista.
          </p>
        )}
        {migrationAplicada && efetiva?.compoe_fluxo_caixa === false && (
          <p className="text-xs text-stone-400">
            {rotuloConta(efetiva)} não entra no Saldo Fluxo de Caixa (Bancos): no Fluxo de Caixa da Home, o
            resgate aparece só como entrada na conta Sicredi.
          </p>
        )}
      </div>
      {!carregado ? (
        <span className="inline-flex items-center gap-2 text-sm text-stone-400">
          <Loader2 size={16} className="animate-spin" /> Carregando…
        </span>
      ) : (
        <select
          value={valorSelect}
          onChange={(e) => { if (e.target.value !== valorSelect) setPendente(e.target.value); }}
          disabled={!canEdit || !migrationAplicada || erroCarga || salvando}
          title={!canEdit
            ? "Apenas administradores podem alterar"
            : migrationAplicada ? "Conta de investimento dos resgates automáticos novos" : "Aplique a migration 0064 no banco"}
          className="h-9 max-w-[18rem] rounded-lg border border-stone-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent-400 disabled:opacity-50"
        >
          {invalida && <option value={OPCAO_INVALIDA} disabled>Conta inválida — usando {nomePadrao}</option>}
          {opcoes.map((o) => (
            <option key={o.value || "padrao"} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}

      <ConfirmDialog
        open={pendente !== null}
        title={`Resgates novos vão sair da conta ${nomeDe(pendente ?? "")}`}
        description={
          "Vale só para os resgates criados a partir de agora. Os que já existem continuam na conta em que foram lançados.\n\n" +
          "A validação de saldo dos resgates novos passa a olhar o saldo dessa conta — confira se o saldo inicial dela está lançado no Financeiro."
        }
        confirmText="Trocar a conta"
        busy={salvando}
        onConfirm={confirmar}
        onCancel={() => { if (!salvando) setPendente(null); }}
      />
    </div>
  );
}

/**
 * Campo numérico ligado a uma chave do app_config. Salva no blur/Enter e só
 * grava quando o valor realmente mudou — evita escrita a cada foco perdido.
 */
function ParametroNumerico({
  chave, fallback, sufixo, largura, canEdit, min, max, rotuloSucesso,
}: {
  chave: string;
  fallback: string;
  sufixo: string;
  largura: string;
  canEdit: boolean;
  min?: number;
  max?: number;
  rotuloSucesso: string;
}) {
  const toast = useToast();
  const [valor, setValor] = useState<string | null>(null);
  const [original, setOriginal] = useState<string>(fallback);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    obterConfigApp(chave, fallback)
      .then((v) => { setValor(v); setOriginal(v); })
      .catch(() => { setValor(fallback); setOriginal(fallback); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  async function salvar() {
    if (valor === null || salvando || valor === original) return;
    const n = Number(valor);
    if (!Number.isFinite(n) || n < (min ?? 0) || (max != null && n > max)) {
      toast.warning("Valor inválido", `Informe um número entre ${min ?? 0} e ${max ?? "…"}.`);
      setValor(original);
      return;
    }
    setSalvando(true);
    try {
      await salvarConfigApp(chave, String(n));
      setOriginal(String(n));
      setValor(String(n));
      toast.success(rotuloSucesso);
    } catch (e: unknown) {
      toast.error("Não foi possível salvar", (e as Error).message ?? String(e));
      setValor(original);
    } finally {
      setSalvando(false);
    }
  }

  if (valor === null) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-stone-400">
        <Loader2 size={16} className="animate-spin" /> Carregando…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-xs text-stone-400 uppercase font-semibold">{sufixo}</span>
      <input
        type="number"
        value={valor}
        min={min}
        max={max}
        disabled={!canEdit || salvando}
        onChange={(e) => setValor(e.target.value)}
        onBlur={salvar}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        title={canEdit ? "Digite e saia do campo (ou tecle Enter) para salvar" : "Apenas administradores podem alterar"}
        className={`${largura} h-9 rounded-lg border border-stone-200 px-2.5 text-sm text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-accent-400 disabled:opacity-50`}
      />
      {salvando && <Loader2 size={14} className="animate-spin text-stone-400" />}
    </span>
  );
}
