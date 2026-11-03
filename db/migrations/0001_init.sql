-- 0001_init — schema inicial do Nicho Capital (ADR 0001).
-- Convenções:
--   * timestamps em timestamptz (UTC no banco; a apresentação converte para America/Sao_Paulo);
--   * chaves naturais ou content_hash com UNIQUE, para upserts idempotentes;
--   * embeddings 384-d (intfloat/multilingual-e5-small).

create extension if not exists vector;

-- ---------------------------------------------------------------- cadastro
create table assets (
    ticker          text primary key,
    nome            text not null,
    setor           text not null,
    cnpj            text,
    codigo_cvm      text,
    is_index        boolean not null default false,
    apelidos        text[] not null default '{}',
    updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- mercado
create table prices_daily (
    ticker      text not null references assets (ticker),
    dia         date not null,
    open        numeric(18, 6),
    high        numeric(18, 6),
    low         numeric(18, 6),
    close       numeric(18, 6) not null,
    adj_close   numeric(18, 6),
    volume      bigint,
    fonte       text not null,
    ingested_at timestamptz not null default now(),
    primary key (ticker, dia)
);

create table prices_intraday (
    ticker      text not null references assets (ticker),
    ts          timestamptz not null,
    intervalo   text not null,
    close       numeric(18, 6) not null,
    volume      bigint,
    fonte       text not null,
    primary key (ticker, intervalo, ts)
);

create table macro_series (
    codigo_sgs  integer primary key,
    slug        text not null unique,
    nome        text not null,
    unidade     text not null,
    periodicidade text not null check (periodicidade in ('diaria', 'mensal'))
);

create table macro_observations (
    codigo_sgs  integer not null references macro_series (codigo_sgs),
    dia         date not null,
    valor       numeric(20, 8) not null,
    primary key (codigo_sgs, dia)
);

-- ---------------------------------------------------------------- documentos
create table filings (
    id                bigserial primary key,
    protocolo_entrega text not null,
    versao            integer not null default 1,
    ticker            text references assets (ticker),
    cnpj              text,
    categoria         text not null,
    tipo              text,
    especie           text,
    assunto           text,
    data_entrega      timestamptz not null,
    data_referencia   date,
    link_download     text not null,
    texto             text,
    content_hash      text,
    ingested_at       timestamptz not null default now(),
    unique (protocolo_entrega, versao)
);

create table news_items (
    id            bigserial primary key,
    content_hash  text not null unique,
    fonte_id      text not null,
    fonte_nome    text not null,
    titulo        text not null,
    link          text not null,
    resumo        text,
    publicado_em  timestamptz not null,
    coletado_via  text not null check (coletado_via in ('rss', 'google_news', 'gdelt')),
    embedding     vector(384),
    ingested_at   timestamptz not null default now()
);
create index news_items_publicado_em_idx on news_items (publicado_em desc);

create table stories (
    id            bigserial primary key,
    titulo        text not null,
    primeira_em   timestamptz not null,
    ultima_em     timestamptz not null,
    n_fontes      integer not null default 1,
    centroid      vector(384),
    updated_at    timestamptz not null default now()
);

create table story_items (
    story_id      bigint not null references stories (id) on delete cascade,
    news_item_id  bigint references news_items (id) on delete cascade,
    filing_id     bigint references filings (id) on delete cascade,
    similaridade  real,
    check ((news_item_id is null) <> (filing_id is null))
);
create unique index story_items_news_uq on story_items (news_item_id) where news_item_id is not null;
create unique index story_items_filing_uq on story_items (filing_id) where filing_id is not null;

-- ---------------------------------------------------------------- IA
create table llm_cache (
    content_hash   text not null,
    prompt_versao  text not null,
    provedor       text not null,
    modelo         text not null,
    resposta       jsonb not null,
    created_at     timestamptz not null default now(),
    primary key (content_hash, prompt_versao)
);

create table extractions (
    id             bigserial primary key,
    news_item_id   bigint references news_items (id) on delete cascade,
    filing_id      bigint references filings (id) on delete cascade,
    prompt_versao  text not null,
    status         text not null check (status in ('ok', 'reparado', 'extraction_failed')),
    payload        jsonb,
    provedor       text,
    modelo         text,
    created_at     timestamptz not null default now(),
    check ((news_item_id is null) <> (filing_id is null))
);
create unique index extractions_news_uq on extractions (news_item_id, prompt_versao) where news_item_id is not null;
create unique index extractions_filing_uq on extractions (filing_id, prompt_versao) where filing_id is not null;

create table sentiment (
    news_item_id  bigint references news_items (id) on delete cascade,
    filing_id     bigint references filings (id) on delete cascade,
    modelo        text not null,
    label         text not null check (label in ('positivo', 'neutro', 'negativo')),
    score         real not null,
    created_at    timestamptz not null default now(),
    check ((news_item_id is null) <> (filing_id is null))
);
create unique index sentiment_news_uq on sentiment (news_item_id, modelo) where news_item_id is not null;
create unique index sentiment_filing_uq on sentiment (filing_id, modelo) where filing_id is not null;

-- ---------------------------------------------------------------- estatística
create table anomalies (
    ticker      text not null references assets (ticker),
    dia         date not null,
    metodo      text not null,            -- robust_z_retorno | robust_z_volume | change_point
    valor       double precision not null,
    severidade  text not null check (severidade in ('baixa', 'media', 'alta')),
    detalhes    jsonb not null default '{}',
    primary key (ticker, dia, metodo)
);

create table event_studies (
    id               bigserial primary key,
    ticker           text not null references assets (ticker),
    data_evento      date not null,
    janela           text not null,       -- ex.: "[-1,+1]"
    origem_tipo      text not null check (origem_tipo in ('filing', 'story', 'manual')),
    origem_id        bigint,
    car              double precision not null,
    t_stat           double precision,
    p_valor          double precision,
    ic_inf           double precision,
    ic_sup           double precision,
    n_estimacao      integer not null,
    serie            jsonb not null,      -- AR/CAR por dia relativo, para o gráfico
    created_at       timestamptz not null default now(),
    unique (ticker, data_evento, janela, origem_tipo, origem_id)
);

-- ---------------------------------------------------------------- grafos
create table graph_snapshots (
    tipo        text not null check (tipo in ('correlacao_mst', 'conhecimento')),
    referencia  date not null,
    payload     jsonb not null,           -- nós e arestas com layout pré-calculado
    metricas    jsonb not null default '{}',
    created_at  timestamptz not null default now(),
    primary key (tipo, referencia)
);

create table kg_nodes (
    id        text primary key,           -- ex.: "empresa:PETR4", "pessoa:<hash>"
    tipo      text not null check (tipo in ('Empresa', 'Pessoa', 'Setor', 'Evento', 'Noticia')),
    rotulo    text not null,
    atributos jsonb not null default '{}'
);

create table kg_edges (
    origem     text not null references kg_nodes (id) on delete cascade,
    destino    text not null references kg_nodes (id) on delete cascade,
    relacao    text not null check (relacao in
               ('ADMINISTRA', 'CONTROLA', 'PERTENCE_A', 'MENCIONADA_EM', 'CO_MENCIONADA_COM', 'AFETA')),
    peso       double precision not null default 1,
    fonte      text not null,
    visto_em   timestamptz not null default now(),
    primary key (origem, destino, relacao)
);

-- ---------------------------------------------------------------- produto
create table relevance_scores (
    story_id     bigint primary key references stories (id) on delete cascade,
    score        real not null check (score between 0 and 100),
    componentes  jsonb not null,          -- contribuição de cada fator
    pesos_versao integer not null,
    calculado_em timestamptz not null default now()
);

create table briefings (
    dia         date not null,
    versao      integer not null,
    conteudo    jsonb not null,           -- seções + citações
    provedor    text,
    modelo      text,
    created_at  timestamptz not null default now(),
    primary key (dia, versao)
);

-- ---------------------------------------------------------------- observabilidade
create table pipeline_runs (
    id           bigserial primary key,
    etapa        text not null,
    status       text not null check (status in ('rodando', 'ok', 'parcial', 'falhou')),
    iniciado_em  timestamptz not null default now(),
    terminado_em timestamptz,
    duracao_ms   integer,
    contagens    jsonb not null default '{}',
    erro         text,
    gatilho      text not null default 'manual'
);
create index pipeline_runs_iniciado_em_idx on pipeline_runs (iniciado_em desc);

create table quota_usage (
    provedor   text not null,
    dia        date not null,
    requests   integer not null default 0,
    tokens     bigint not null default 0,
    primary key (provedor, dia)
);
