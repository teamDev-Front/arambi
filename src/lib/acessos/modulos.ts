// Catálogo dos módulos do AramBI — fonte única para menu, guardas de rota
// (proxy e páginas), APIs e a tela Acessos.
//
// Cada item do menu é um módulo. As chaves são gravadas em users.permissoes
// (migration 0058) — NÃO renomear uma chave sem migrar os dados.
//
// Arquivo de dados puro (sem ícones/React): é importado também pelo proxy.

export type ModuloKey =
  | "home"
  | "financeiro"
  | "distribuicao"
  | "bancos"
  | "saldos"
  | "orcamentos"
  | "provisionamento"
  | "vendas"
  | "estoque"
  | "animais"
  | "maquinario"
  | "horta"
  | "operacao"
  | "relatorios"
  | "documentos"
  | "assistentes"
  | "recibos"
  | "lixeira"
  | "logs"
  | "acessos"
  | "configuracoes";

/** Módulos que nunca entram em users.permissoes — só o Super Admin acessa. */
export type ModuloExclusivo = "acessos" | "configuracoes";
/** Módulos que podem ser liberados na tela Acessos. */
export type ModuloConcedivel = Exclude<ModuloKey, ModuloExclusivo>;

export type GrupoModulo = "visao" | "financeiro" | "agro" | "documentos" | "sistema";

export interface ModuloDef {
  key: ModuloKey;
  label: string;
  href: string;
  grupo: GrupoModulo;
  /** Uma linha explicando o que a pessoa passa a ver (tela Acessos). */
  descricao: string;
  exclusivoSuperAdmin?: boolean;
}

/** Na ordem do menu lateral (a primeira rota liberada vira a página inicial). */
export const MODULOS: readonly ModuloDef[] = [
  { key: "home",            label: "Home",                  href: "/dashboard",                 grupo: "visao",      descricao: "Painel geral; os blocos financeiros só aparecem com o Financeiro liberado." },
  { key: "financeiro",      label: "Financeiro",            href: "/dashboard/financeiro",      grupo: "financeiro", descricao: "Lançamentos de entradas e saídas, status, resgates e relatórios." },
  { key: "distribuicao",    label: "Distribuição de Lucro", href: "/dashboard/distribuicao",    grupo: "financeiro", descricao: "DL dos sócios, repasses e capa do sócio." },
  { key: "bancos",          label: "Bancos",                href: "/dashboard/bancos",          grupo: "financeiro", descricao: "Contas bancárias da empresa e dos sócios." },
  { key: "saldos",          label: "Saldos Mensais",        href: "/dashboard/saldos",          grupo: "financeiro", descricao: "Saldo de cada conta mês a mês." },
  { key: "orcamentos",      label: "Orçamentos",            href: "/dashboard/orcamentos",      grupo: "financeiro", descricao: "Orçado × realizado por conta." },
  { key: "provisionamento", label: "Provisionamento Anual", href: "/dashboard/provisionamento", grupo: "financeiro", descricao: "Previsão do ano e espelhamento de lançamentos." },
  { key: "vendas",          label: "Vendas Futuras",        href: "/dashboard/vendas-futuras",  grupo: "agro",       descricao: "Vendas de safra contratadas e recebimentos." },
  { key: "estoque",         label: "Culturas & Safra",      href: "/dashboard/estoque",         grupo: "agro",       descricao: "Depósitos de grãos, armazéns e estoque." },
  { key: "animais",         label: "Animais",               href: "/dashboard/animais",         grupo: "agro",       descricao: "Lotes, eventos, vacinação e ocorrências." },
  { key: "maquinario",      label: "Maquinário",            href: "/dashboard/maquinario",      grupo: "agro",       descricao: "Máquinas, veículos, manutenções e documentos." },
  { key: "horta",           label: "Horta",                 href: "/dashboard/horta",           grupo: "agro",       descricao: "Canteiros, plantios e colheitas." },
  { key: "operacao",        label: "Operação de Campo",     href: "/dashboard/operacao",        grupo: "agro",       descricao: "Talões, abastecimentos e reservatórios." },
  { key: "relatorios",      label: "Relatórios PDF",        href: "/dashboard/relatorios",      grupo: "documentos", descricao: "Capas e relatórios mensais em PDF." },
  { key: "documentos",      label: "Documentos",            href: "/dashboard/documentos",      grupo: "documentos", descricao: "Documentos gerados: recibos, termos e contratos." },
  { key: "assistentes",     label: "Assistentes IA",        href: "/dashboard/assistentes",     grupo: "sistema",    descricao: "Chat com os agentes; cada agente só consulta os módulos liberados." },
  { key: "recibos",         label: "Recibos & Termos",      href: "/dashboard/recibos",         grupo: "documentos", descricao: "Cadastro de recibos e termos." },
  { key: "lixeira",         label: "Lixeira",               href: "/dashboard/lixeira",         grupo: "sistema",    descricao: "Itens excluídos nos últimos 30 dias (restaurar exige edição)." },
  { key: "logs",            label: "Logs do Sistema",       href: "/dashboard/logs",            grupo: "sistema",    descricao: "Auditoria: acessos, convites, bloqueios e logins." },
  { key: "acessos",         label: "Acessos",               href: "/dashboard/acessos",         grupo: "sistema",    descricao: "Usuários, convites, módulos e níveis.", exclusivoSuperAdmin: true },
  { key: "configuracoes",   label: "Configurações",         href: "/dashboard/configuracoes",   grupo: "sistema",    descricao: "Plano de contas, status, colaboradores e automações.", exclusivoSuperAdmin: true },
];

export const MODULO_POR_KEY: Readonly<Record<ModuloKey, ModuloDef>> = Object.fromEntries(
  MODULOS.map((m) => [m.key, m]),
) as Record<ModuloKey, ModuloDef>;

export const MODULOS_CONCEDIVEIS = MODULOS.filter((m) => !m.exclusivoSuperAdmin) as readonly (ModuloDef & {
  key: ModuloConcedivel;
})[];

export const MODULOS_EXCLUSIVOS = MODULOS.filter((m) => m.exclusivoSuperAdmin);

export const GRUPOS_MODULO: readonly { id: GrupoModulo; label: string }[] = [
  { id: "visao",      label: "Visão geral" },
  { id: "financeiro", label: "Financeiro" },
  { id: "agro",       label: "Agro & Operação" },
  { id: "documentos", label: "Documentos & Relatórios" },
  { id: "sistema",    label: "Sistema" },
];

export function ehModuloConcedivel(key: string): key is ModuloConcedivel {
  return MODULOS_CONCEDIVEIS.some((m) => m.key === key);
}

/** Rotas do /dashboard que qualquer usuário ativo abre (não são módulos). */
const ROTAS_LIVRES = ["/dashboard/perfil", "/dashboard/sem-acesso"];

export type ClasseRota =
  | { tipo: "fora" }                         // não é /dashboard
  | { tipo: "livre" }                        // perfil, sem-acesso
  | { tipo: "modulo"; modulo: ModuloKey }
  | { tipo: "desconhecida" };                // /dashboard/* fora do catálogo → só Super Admin

/** Descobre a que módulo pertence uma URL do app. */
export function classificarRota(pathname: string): ClasseRota {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (p !== "/dashboard" && !p.startsWith("/dashboard/")) return { tipo: "fora" };
  if (p === "/dashboard") return { tipo: "modulo", modulo: "home" };
  if (ROTAS_LIVRES.some((r) => p === r || p.startsWith(r + "/"))) return { tipo: "livre" };
  for (const m of MODULOS) {
    if (m.href === "/dashboard") continue;
    if (p === m.href || p.startsWith(m.href + "/")) return { tipo: "modulo", modulo: m.key };
  }
  return { tipo: "desconhecida" };
}
