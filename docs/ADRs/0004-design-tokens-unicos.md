# ADR 0004 — Design tokens num arquivo único

- **Status:** aceito (31/10/2026)

## Decisão
- Todos os tokens da identidade Altitude, mais as extensões de `docs/decisoes-de-design.md`, ficam em `web/src/styles/tokens.css`, com variáveis CSS e um bloco `@theme` do Tailwind v4.
- Componentes usam só utilitários do Tailwind gerados por esses tokens ou `var(--...)`.
- Uma regra de ESLint proíbe literais de cor (`#rgb`, `rgb()`, `hsl()`, `oklch()`) em arquivos `.ts`/`.tsx`. Um teste garante que nenhum outro `.css` define cores.
