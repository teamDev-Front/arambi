"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useModulo } from "@/components/acessos/PermissoesProvider";
import {
  Trash2, Undo2, Search, Loader2, AlertTriangle, Eye, ShieldQuestion,
} from "lucide-react";
import { formatDate } from "@/lib/utils/format";
import {
  listarLixeira, restaurarDaLixeira, descartarDaLixeira, expurgarLixeira,
  lixeiraIndisponivel, LIXEIRA_TABELA_LABEL,
  type LixeiraItem,
} from "@/lib/queries/lixeira";

/** Data + hora curtas — na lixeira o "quando" quase sempre é hoje ou ontem. */
function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${formatDate(iso.slice(0, 10))} às ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Lixeira (ajuste 17-ago-2026, pedido da Ana).
 *
 *   "caso ela em algum lançamento exclua por acidente e perceba posteriormente
 *    que não deveria ter excluído, o item poderá ficar armazenado na lixeira
 *    para possível recuperação. Podemos definir um prazo de 30 dias, após o
 *    qual os itens serão excluídos definitivamente."
 *
 * Complementa — não substitui — o "Desfazer" de 8 segundos dos toasts: aquele
 * resolve o clique errado percebido na hora; esta resolve o que só se percebe
 * dias depois. Quem restaura pelo toast some daqui sozinho (a view confere se
 * o registro voltou).
 */
export function LixeiraPage() {
  const toast = useToast();
  // Leitura: lista e vê os campos; restaurar e apagar de vez exigem edição.
  const { podeEditar } = useModulo("lixeira");
  const [itens, setItens] = useState<LixeiraItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [indisponivel, setIndisponivel] = useState(false);
  const [search, setSearch] = useState("");
  const [filtroTabela, setFiltroTabela] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verItem, setVerItem] = useState<LixeiraItem | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listarLixeira({
        tabela: filtroTabela || undefined,
        search: search || undefined,
      });
      setItens(rows);
      setIndisponivel(false);
    } catch (e: unknown) {
      const msg = (e as Error).message ?? String(e);
      if (lixeiraIndisponivel(msg)) setIndisponivel(true);
      else toast.error("Erro carregando a lixeira", msg);
      setItens([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroTabela, search]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, [fetchData]);

  // Expurga o que passou dos 30 dias ao abrir a tela: a lixeira só precisa
  // estar limpa quando alguém a olha — dispensa agendador. Só quem edita
  // expurga; a view já esconde o que expirou.
  useEffect(() => {
    if (!podeEditar) return;
    expurgarLixeira().catch(() => undefined);
  }, [podeEditar]);

  const porTabela = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of itens) m.set(i.tabela, (m.get(i.tabela) ?? 0) + 1);
    return m;
  }, [itens]);

  async function restaurar(item: LixeiraItem) {
    if (!podeEditar) return;
    setOcupado(item.id);
    try {
      await restaurarDaLixeira(item.id);
      toast.success(
        "Lançamento restaurado",
        `Voltou para ${LIXEIRA_TABELA_LABEL[item.tabela] ?? item.tabela} exatamente como estava, com o mesmo código.`,
      );
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível restaurar", (e as Error).message ?? String(e));
      await fetchData();
    } finally {
      setOcupado(null);
    }
  }

  async function descartar(item: LixeiraItem) {
    if (!podeEditar) return;
    if (!confirm(
      `Apagar DEFINITIVAMENTE este item da lixeira?\n\n${item.resumo ?? ""}\n\n` +
      `Depois disso não há como recuperá-lo. Sem fazer nada, ele sairia sozinho em ${item.dias_restantes} dia(s).`
    )) return;
    setOcupado(item.id);
    try {
      await descartarDaLixeira(item.id);
      toast.success("Item apagado definitivamente");
      await fetchData();
    } catch (e: unknown) {
      toast.error("Não foi possível apagar", (e as Error).message ?? String(e));
    } finally {
      setOcupado(null);
    }
  }

  if (indisponivel) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Lixeira</h1>
          <p className="text-sm text-stone-500">Itens excluídos, recuperáveis por 30 dias</p>
        </div>
        <Card>
          <CardContent className="flex items-start gap-3 text-sm text-stone-600">
            <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-stone-800">Lixeira ainda não ativada neste banco</p>
              <p className="mt-1">
                A migration <b>0054</b> precisa ser aplicada no Supabase. Enquanto isso, as exclusões
                continuam contando com o <b>Desfazer</b> de 8 segundos que aparece no aviso logo após excluir.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0f1f1c]">Lixeira</h1>
          <p className="text-sm text-stone-500">
            Tudo que foi excluído fica aqui por <b>30 dias</b> e pode voltar com um clique
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex-col items-start gap-3 lg:flex-row lg:items-center">
          <CardTitle>
            {loading ? "Itens excluídos" : `${itens.length} item${itens.length === 1 ? "" : "s"} recuperável${itens.length === 1 ? "" : "is"}`}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar pela descrição…"
                className="h-8 rounded-lg border border-stone-200 pl-8 pr-3 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-accent-400"
              />
            </div>
            <select
              value={filtroTabela}
              onChange={(e) => setFiltroTabela(e.target.value)}
              className="h-8 rounded-lg border border-stone-200 px-2 text-xs bg-white"
              aria-label="Filtrar por módulo"
            >
              <option value="">Todos os módulos</option>
              {Object.entries(LIXEIRA_TABELA_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}{porTabela.has(k) ? ` (${porTabela.get(k)})` : ""}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  {["Excluído em", "Módulo", "O que era", "Quem excluiu", "Some em", "Ações"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-stone-400">
                    <Loader2 size={18} className="inline-block animate-spin mr-2" /> Carregando…
                  </td></tr>
                )}
                {!loading && itens.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-stone-400">
                    Lixeira vazia — nada foi excluído nos últimos 30 dias
                    {(search || filtroTabela) && " dentro deste filtro"}.
                  </td></tr>
                )}
                {!loading && itens.map((i) => {
                  const urgente = i.dias_restantes <= 3;
                  return (
                    <tr key={i.id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors table-row-alt">
                      <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">{quando(i.excluido_em)}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className="inline-flex items-center rounded-full bg-stone-100 text-stone-600 px-2 py-0.5 font-medium whitespace-nowrap">
                          {LIXEIRA_TABELA_LABEL[i.tabela] ?? i.tabela}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-stone-700 max-w-[420px] truncate" title={i.resumo ?? ""}>
                        {i.resumo || <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">
                        {i.excluido_por_nome || <span className="text-stone-300">—</span>}
                      </td>
                      <td className={`px-4 py-3 text-xs whitespace-nowrap font-medium ${urgente ? "text-red-600" : "text-stone-500"}`}>
                        {i.dias_restantes === 0
                          ? "hoje"
                          : `${i.dias_restantes} dia${i.dias_restantes === 1 ? "" : "s"}`}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {podeEditar && (
                            <Button
                              size="sm"
                              variant="outline"
                              loading={ocupado === i.id}
                              disabled={ocupado !== null}
                              onClick={() => restaurar(i)}
                              title="Devolve o lançamento ao módulo de origem, exatamente como estava"
                            >
                              <Undo2 size={13} /> Restaurar
                            </Button>
                          )}
                          <button
                            onClick={() => setVerItem(i)}
                            className="p-1.5 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-700 transition"
                            title="Ver todos os campos do item"
                          >
                            <Eye size={14} />
                          </button>
                          {podeEditar && (
                            <button
                              onClick={() => descartar(i)}
                              disabled={ocupado !== null}
                              className="p-1.5 rounded hover:bg-red-50 text-stone-400 hover:text-red-500 transition disabled:opacity-40"
                              title="Apagar definitivamente agora (não dá para recuperar depois)"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 text-xs text-stone-400">
        <ShieldQuestion size={14} className="shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          Lançamentos que o próprio sistema mantém (resgates automáticos do Invest, o Provisionado DL
          e o saldo de Despesa Variável) não entram na lixeira: eles nascem de novo sozinhos quando o
          lançamento que os originou volta. Restaurar devolve o item com o <b>mesmo código</b>, então
          vínculos como o repasse consolidado e a baixa de estoque continuam apontando para ele.
        </p>
      </div>

      {/* Todos os campos do item — para conferir antes de restaurar */}
      <Modal open={!!verItem} onClose={() => setVerItem(null)} title="Item excluído" size="lg">
        {verItem && (
          <div className="p-5 space-y-3">
            <p className="text-sm text-stone-700 font-medium">{verItem.resumo}</p>
            <p className="text-xs text-stone-400">
              {LIXEIRA_TABELA_LABEL[verItem.tabela] ?? verItem.tabela} · excluído em {quando(verItem.excluido_em)}
              {verItem.excluido_por_nome ? ` por ${verItem.excluido_por_nome}` : ""}
            </p>
            <div className="rounded-lg border border-stone-200 overflow-hidden">
              <table className="w-full text-xs">
                <tbody>
                  {Object.entries(verItem.dados)
                    .filter(([, v]) => v !== null && v !== "")
                    .map(([k, v]) => (
                      <tr key={k} className="border-b border-stone-50 last:border-0">
                        <td className="px-3 py-1.5 text-stone-400 font-medium w-52 align-top">{k}</td>
                        <td className="px-3 py-1.5 text-stone-700 break-all">{String(v)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setVerItem(null)}>Fechar</Button>
              {podeEditar && (
                <Button
                  loading={ocupado === verItem.id}
                  disabled={ocupado !== null}
                  onClick={async () => { const alvo = verItem; setVerItem(null); await restaurar(alvo); }}
                >
                  <Undo2 size={14} /> Restaurar
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
