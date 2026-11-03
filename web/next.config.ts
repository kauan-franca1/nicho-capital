import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // O snapshot demo/ e os docs de metodologia ficam na raiz do repositório, fora de web/. As
  // funções serverless (ex.: /api/agent no modo demo) os leem em runtime, então entram no trace.
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/*": ["../demo/**/*.json", "../docs/metodologia-*.md"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
