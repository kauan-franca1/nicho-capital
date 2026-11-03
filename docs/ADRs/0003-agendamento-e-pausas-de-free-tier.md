# ADR 0003 — Agendamento e pausas de free tier

- **Status:** aceito (31/10/2026)

## Contexto
Documentação oficial verificada em 31/10/2026:
- Supabase Free pausa projetos após 7 dias de inatividade.
- GitHub Actions desativa workflows agendados em repositório público após 60 dias sem atividade no repositório.

## Decisão
- Cron em dias úteis às 12:00 UTC (09:00 de Brasília, sem horário de verão) e às 21:30 UTC (pós-fechamento).
- Toda execução escreve em `pipeline_runs`, o que mantém o Supabase ativo.
- Uma vez por semana, o pipeline faz commit do snapshot `demo/`, o que mantém o cron ativo.
- Se o banco estiver pausado, o web cai para o snapshot e mostra um aviso.
