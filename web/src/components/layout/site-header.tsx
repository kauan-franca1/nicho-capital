"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";
import { isActive, NAV_ITEMS } from "@/lib/routes";

/**
 * Barra de 64 px, sem sticky e sem hamburger (decisão C9). No celular, a lista rola na horizontal.
 */
export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="border-b border-default bg-surface-1" data-print="hide">
      <div className="mx-auto flex max-w-page flex-col gap-4 px-16 py-12 md:h-(--nav-height) md:flex-row md:items-center md:gap-32 md:py-0">
        <Link
          href="/"
          className="font-serif text-heading-sm font-normal tracking-[-0.025em] text-primary"
        >
          Nicho Capital
        </Link>
        <nav
          aria-label="Principal"
          className="-mx-16 overflow-x-auto px-16 [scrollbar-width:none] md:mx-0 md:px-0"
        >
          <ul className="flex min-w-max items-center gap-20">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block border-b py-8 text-data transition-colors duration-(--duration-fast)",
                      active
                        ? "border-(--color-fog) text-primary"
                        : "border-transparent text-muted hover:text-primary",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
