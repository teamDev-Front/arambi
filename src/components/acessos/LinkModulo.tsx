"use client";
// Link para outro módulo que respeita a tela Acessos: sem o módulo de destino,
// vira texto simples (ou some, com semAcesso="ocultar") em vez de levar à
// tela "Sem acesso".

import Link from "next/link";
import type { ComponentProps } from "react";
import { classificarRota } from "@/lib/acessos/modulos";
import { usePermissoes } from "@/components/acessos/PermissoesProvider";

type Props = ComponentProps<typeof Link> & { semAcesso?: "texto" | "ocultar" };

export function LinkModulo({ semAcesso = "texto", href, className, title, children, ...rest }: Props) {
  const { podeVer } = usePermissoes();
  const caminho = typeof href === "string" ? href.split(/[?#]/)[0] : href.pathname ?? "";
  const rota = classificarRota(caminho);
  if (rota.tipo === "modulo" && !podeVer(rota.modulo)) {
    if (semAcesso === "ocultar") return null;
    return <span className={className} title={title}>{children}</span>;
  }
  return <Link href={href} className={className} title={title} {...rest}>{children}</Link>;
}
