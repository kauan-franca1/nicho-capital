-- 0002_stats — volatilidade GARCH e ajustes no event study (fase 3).

-- Event study: novo tipo de origem "mercado" (choques do próprio Ibovespa), rótulo legível e
-- parâmetros do modelo de mercado em colunas próprias.
alter table event_studies drop constraint event_studies_origem_tipo_check;
alter table event_studies add constraint event_studies_origem_tipo_check
    check (origem_tipo in ('filing', 'story', 'manual', 'mercado'));

-- O UNIQUE original trata NULLs como distintos: com origem_id nulo, reprocessar duplicaria linhas.
do $$
declare c text;
begin
    select conname into c from pg_constraint
    where conrelid = 'event_studies'::regclass and contype = 'u';
    execute format('alter table event_studies drop constraint %I', c);
end $$;
alter table event_studies add constraint event_studies_uq
    unique nulls not distinct (ticker, data_evento, janela, origem_tipo, origem_id);

alter table event_studies
    add column rotulo text,
    add column alpha double precision,
    add column beta double precision,
    add column sigma double precision,
    add column r2 double precision;

-- Ajuste GARCH(1,1) mais recente de cada ativo.
create table garch_fits (
    ticker           text primary key references assets (ticker),
    distribuicao     text not null,
    mu               double precision not null,
    omega            double precision not null,
    alpha            double precision not null,
    beta             double precision not null,
    nu               double precision,
    persistencia     double precision not null,
    meia_vida        double precision,
    vol_longo_prazo  double precision,
    log_likelihood   double precision not null,
    n                integer not null,
    convergiu        boolean not null,
    ultimo_dia       date not null,
    previsao         jsonb not null,           -- vol anualizada dos próximos h pregões
    ajustado_em      timestamptz not null default now()
);

-- Série diária de volatilidade (fração anualizada).
create table volatility_daily (
    ticker            text not null references assets (ticker),
    dia               date not null,
    vol_garch         double precision,
    vol_realizada_21  double precision,
    primary key (ticker, dia)
);
