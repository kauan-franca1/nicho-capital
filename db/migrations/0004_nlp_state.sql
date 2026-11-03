-- 0004_nlp_state — estado persistente do NLP (fase 4).
-- Guarda o vetor médio dos embeddings usado para centralizar o espaço do e5 (anisotrópico:
-- dois títulos aleatórios têm cosseno médio ~0,87). Fixo entre execuções para manter as
-- histórias comparáveis.
comment on column stories.centroid is
    'Vetor-semente da história (embedding do primeiro item), centralizado pelo vetor médio';

create table nlp_state (
    chave       text primary key,
    valor       jsonb not null,
    atualizado_em timestamptz not null default now()
);
