# ADR 0002 — Modo demo por snapshot JSON

- **Status:** aceito (31/10/2026)

## Contexto
A demo precisa funcionar numa entrevista sem internet e sem chaves (`make demo`).

## Decisão
O web lê dados por uma interface `DataSource` com duas implementações: `PostgresSource` e `SnapshotSource`. Com `DEMO_MODE=true`, ou quando o banco não responde, usa `SnapshotSource`, que lê arquivos JSON versionados em `demo/`. Esses arquivos são gerados por `nicho export-demo` a partir de dados reais. A busca semântica no snapshot é cosseno em TypeScript sobre embeddings pré-calculados.

## Consequências
- `make demo` só precisa do Node instalado.
- O snapshot é atualizado por commit semanal do pipeline, o que também mantém o repositório "ativo" para o cron do GitHub (ADR 0003).
- O tamanho do snapshot precisa de controle (alvo < 20 MB).
