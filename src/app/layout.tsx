import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AramBI – Gestão Agro",
  description: "Sistema de gestão financeira e operacional para o agronegócio",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.className} h-full`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
