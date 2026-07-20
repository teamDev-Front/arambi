import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/ui/Toast";

// Portal do Colaborador — rota PÚBLICA (o proxy só protege /dashboard).
// Mobile-first: os operadores acessam pelo celular via link/QR code.

export const metadata: Metadata = {
  title: "AramBI – Portal do Colaborador",
  description: "Talões de uso e abastecimento — Agropecuária Aramburu",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AramBI Campo",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1a2e28",
};

export default function ColaboradorLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="min-h-full bg-[#f5f0e8]">{children}</div>
    </ToastProvider>
  );
}
