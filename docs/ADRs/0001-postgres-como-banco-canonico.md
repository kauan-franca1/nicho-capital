# ADR 0001 — Postgres como único banco canônico

- **Status:** aceito (31/10/2026)

## Contexto
O prompt sugere Supabase (Postgres + pgvector) com SQLite/DuckDB como fallback local. O pipeline (Python) e o produto (TypeScript) só se comunicam pelo banco.

## Decisão
O schema canônico é Postgres 15+ com a extensão `vector`, versionado em `db/migrations/NNNN_nome.sql` e aplicado por `nicho migrate`. Em produção, o banco é o Supabase Free; localmente, Postgres + pgvector via Docker (`docker compose up db`) ou o próprio Supabase.

## Consequências
- Um único dialeto SQL e um único conjunto de migrations.
- Não há backend SQLite/DuckDB. O papel de "rodar sem nada" fica com o modo demo (ADR 0002).
- Rodar o pipeline localmente exige Docker ou uma `DATABASE_URL` do Supabase.

## Alternativa rejeitada
Abstrair dois bancos (Postgres + DuckDB): dobra os testes e cria risco de divergência de schema, sem ganho para a demo.
