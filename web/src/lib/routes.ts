export type NavItem = { href: string; label: string };

/** As 8 páginas do produto (prompt §7). A ordem é a da navegação. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Mercado" },
  { href: "/noticias", label: "Notícias" },
  { href: "/grafos", label: "Grafos" },
  { href: "/analista", label: "Analista" },
  { href: "/briefing", label: "Briefing" },
  { href: "/metodologia", label: "Metodologia" },
  { href: "/status", label: "Status" },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/ativo/");
  return pathname === href || pathname.startsWith(`${href}/`);
}
