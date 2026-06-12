import { cn } from "@/lib/utils/cn";
import { getBancoBrand } from "@/lib/constants/bancos";

interface BankLogoProps {
  banco?: string | null;
  apelido?: string | null;
  /** lado do selo em px */
  size?: number;
  className?: string;
}

/**
 * Selo da instituição financeira (RF-FIN-02): quadrado arredondado com a cor da
 * marca + monograma. Sem imagem remota — mantém proporção e nunca quebra (tem
 * fallback de iniciais para bancos desconhecidos).
 */
export function BankLogo({ banco, apelido, size = 36, className }: BankLogoProps) {
  const brand = getBancoBrand(banco, apelido);
  return (
    <span
      aria-hidden
      className={cn("inline-flex items-center justify-center rounded-lg font-bold shrink-0 select-none leading-none", className)}
      style={{
        width: size,
        height: size,
        background: brand.bg,
        color: brand.fg,
        fontSize: Math.round(size * (brand.monograma.length > 1 ? 0.36 : 0.46)),
      }}
    >
      {brand.monograma}
    </span>
  );
}
