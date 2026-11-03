import type { Metadata, Viewport } from "next";
import { Fira_Code, Inter, Libre_Baskerville } from "next/font/google";

import { Disclaimer } from "@/components/disclaimer";
import { SiteHeader } from "@/components/layout/site-header";

import "./globals.css";

// Fontes auto-hospedadas no build (funcionam offline no modo demo).
const serif = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-libre-baskerville-src",
  display: "swap",
});
const sans = Inter({ subsets: ["latin"], variable: "--font-inter-src", display: "swap" });
const mono = Fira_Code({ subsets: ["latin"], variable: "--font-fira-code-src", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Nicho Capital", template: "%s · Nicho Capital" },
  description:
    "Inteligência de mercado sobre a B3 com IA: anomalias, notícias relevantes, grafos e briefing diário. Projeto educacional.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  // A meta theme-color não aceita var(); valor = --color-carbon-canvas.
  // eslint-disable-next-line no-restricted-syntax
  themeColor: "#181818",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-16 focus:top-16 focus:z-50 focus:rounded-md focus:bg-surface-4 focus:px-16 focus:py-8"
        >
          Pular para o conteúdo
        </a>
        <SiteHeader />
        <main id="conteudo" className="mx-auto w-full max-w-page flex-1 px-16 py-32 md:py-48">
          {children}
        </main>
        <footer className="border-t border-surface-2 bg-surface-0 py-32" data-print="hide">
          <div className="mx-auto flex max-w-page flex-col gap-4 px-16 text-data text-muted">
            <p>
              Nicho Capital — projeto pessoal de portfólio. Sem vínculo com nenhuma instituição
              financeira.
            </p>
            <p>
              Fontes: B3 via Yahoo Finance e brapi, Banco Central (SGS), CVM (Dados Abertos),
              portais de notícias.
            </p>
          </div>
        </footer>
        <Disclaimer />
      </body>
    </html>
  );
}
