-- 0003_news — notícias, documentos da CVM e histórias (fase 4).

-- Tickers do universo citados no item (casamento por apelidos, antes do LLM).
alter table news_items add column tickers text[] not null default '{}';
create index news_items_tickers_idx on news_items using gin (tickers);

alter table filings
    add column embedding vector(384),
    add column texto_status text not null default 'pendente'
        check (texto_status in ('pendente', 'ok', 'falhou', 'ignorado'));
create index filings_data_entrega_idx on filings (data_entrega desc);

-- Resumo consolidado de cada história (derivado dos itens e das extrações).
alter table stories
    add column tickers text[] not null default '{}',
    add column tipo_evento text,
    add column materialidade text check (materialidade in ('baixa', 'media', 'alta')),
    add column sentimento real,                 -- −1 (negativo) a +1 (positivo)
    add column resumo text,
    add column fontes text[] not null default '{}';
create index stories_ultima_em_idx on stories (ultima_em desc);
create index stories_tickers_idx on stories using gin (tickers);

-- Probabilidades por classe do modelo de sentimento (para kappa e intensidade).
alter table sentiment add column probabilidades jsonb;

-- Método de extração: llm (com provedor/modelo) ou regras (fallback sem LLM).
alter table extractions add column metodo text not null default 'llm'
    check (metodo in ('llm', 'regras'));

-- Concordância LLM × FinBERT (kappa de Cohen), uma linha por execução.
create table sentiment_agreement (
    calculado_em timestamptz primary key default now(),
    n            integer not null,
    kappa        double precision,
    concordancia double precision,
    matriz       jsonb not null
);
