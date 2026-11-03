"""CLI do pipeline: `uv run nicho --help`."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path

import typer

from nicho import db, migrate
from nicho.briefing import build_briefing, query_briefing_inputs, salvar_briefing
from nicho.config import load_config
from nicho.export import query_snapshot, write_snapshot
from nicho.ingest.macro import ingest_macro
from nicho.ingest.prices import ingest_daily, ingest_intraday
from nicho.log import configure, get_logger
from nicho.paths import migrations_dir, repo_root
from nicho.providers.quotes import BrapiProvider, QuoteProvider, YFinanceProvider
from nicho.providers.sgs import SgsClient
from nicho.runs import track_run
from nicho.stats.run import run_stats

app = typer.Typer(no_args_is_help=True, help="Pipeline de dados do Nicho Capital.")
ingest_app = typer.Typer(no_args_is_help=True, help="Etapas de ingestão.")
app.add_typer(ingest_app, name="ingest")
log = get_logger("nicho.cli")

GATILHO = typer.Option("manual", help="Quem disparou: manual, cron, ci…")


@app.callback()
def _main(
    json_logs: bool = typer.Option(True, "--json/--console", help="Formato dos logs."),
) -> None:
    configure(json=json_logs)


@app.command("validar-config")
def validar_config() -> None:
    """Valida os YAMLs de config/ contra os schemas."""
    cfg = load_config()
    typer.echo(
        f"ok: {len(cfg.universe.ativos)} ativos, {len(cfg.sources.rss)} feeds RSS, "
        f"{len(cfg.macro.series)} séries SGS, cadeia LLM {' → '.join(cfg.llm.cadeia)}"
    )


@app.command("migrate")
def migrate_cmd() -> None:
    """Aplica as migrations pendentes de db/migrations/."""
    with db.connect() as conn:
        aplicadas = migrate.apply(conn, migrate.discover(migrations_dir()))
    typer.echo(f"{len(aplicadas)} migration(s) aplicada(s)")
    for m in aplicadas:
        typer.echo(f"  • {m.nome}")


@app.command("sync-universo")
def sync_universo(gatilho: str = GATILHO) -> None:
    """Sincroniza a tabela `assets` com config/universe.yaml (idempotente)."""
    cfg = load_config()
    with (
        db.connect() as conn,
        track_run(db.PostgresRecorder(conn), "sync_universo", gatilho) as run,
    ):
        run.contar("ativos", db.upsert_assets(conn, cfg.universe))


@ingest_app.command("precos")
def ingest_precos(
    anos: int = typer.Option(3, min=1, max=10, help="Anos de histórico diário."),
    intraday: bool = typer.Option(True, help="Também coleta intraday de 15 min (5 dias)."),
    gatilho: str = GATILHO,
) -> None:
    """Cotações diárias (yfinance → brapi) e intraday recente."""
    cfg = load_config()
    yf = YFinanceProvider()
    providers: list[QuoteProvider] = [yf, BrapiProvider(token=os.environ.get("BRAPI_TOKEN"))]
    with db.connect() as conn, track_run(db.PostgresRecorder(conn), "precos", gatilho) as run:
        db.upsert_assets(conn, cfg.universe)
        ingest_daily(conn, cfg.universe, providers, run, anos=anos)
        if intraday:
            ingest_intraday(conn, cfg.universe, yf, run)


@ingest_app.command("macro")
def ingest_macro_cmd(gatilho: str = GATILHO) -> None:
    """Séries do Banco Central (SGS) definidas em config/macro.yaml."""
    cfg = load_config()
    with db.connect() as conn, track_run(db.PostgresRecorder(conn), "macro", gatilho) as run:
        ingest_macro(conn, cfg.macro, SgsClient(), run)


@app.command("export-demo")
def export_demo(
    saida: Path = typer.Option(None, help="Diretório de saída (padrão: demo/ na raiz)."),
    gatilho: str = GATILHO,
) -> None:
    """Gera o snapshot JSON usado pelo modo demo (ADR 0002)."""
    out = saida or repo_root() / "demo"
    with db.connect() as conn, track_run(db.PostgresRecorder(conn), "export_demo", gatilho) as run:
        files = query_snapshot(conn, datetime.now(UTC))
        total = write_snapshot(files, out)
        run.contar("arquivos", len(files))
        run.contar("bytes", total)
    typer.echo(f"{len(files)} arquivos, {total / 1_048_576:.1f} MB em {out}")


@app.command("stats")
def stats_cmd(gatilho: str = GATILHO) -> None:
    """Anomalias (z robusto, change points), GARCH(1,1) e event studies de choques de mercado."""
    cfg = load_config()
    with db.connect() as conn, track_run(db.PostgresRecorder(conn), "stats", gatilho) as run:
        run_stats(conn, cfg.universe, cfg.stats, run)


@ingest_app.command("noticias")
def ingest_noticias(
    noticias: bool = typer.Option(True, help="Coleta notícias (RSS, Google News, GDELT)."),
    cvm: bool = typer.Option(True, help="Coleta documentos da CVM (IPE + PDFs)."),
    max_pdfs: int | None = typer.Option(None, help="Sobrescreve nlp.cvm.max_pdfs_por_execucao."),
    gatilho: str = GATILHO,
) -> None:
    """Notícias (RSS, Google News, GDELT) e fatos relevantes/comunicados da CVM."""
    from nicho.ingest.cvm import CvmClient
    from nicho.ingest.news import Coletor
    from nicho.ingest.run_news import coletar_cvm, coletar_noticias

    cfg = load_config()
    if max_pdfs is not None:
        cvm_cfg = cfg.nlp.cvm.model_copy(update={"max_pdfs_por_execucao": max_pdfs})
        cfg = cfg.model_copy(update={"nlp": cfg.nlp.model_copy(update={"cvm": cvm_cfg})})
    agora = datetime.now(UTC)
    with db.connect() as conn:
        if noticias:
            with track_run(db.PostgresRecorder(conn), "noticias", gatilho) as run:
                coletar_noticias(conn, cfg, run, Coletor(cfg.sources), agora)
        if cvm:
            with track_run(db.PostgresRecorder(conn), "cvm", gatilho) as run:
                coletar_cvm(conn, cfg, run, CvmClient(), agora.date())


@app.command("enriquecer")
def enriquecer(gatilho: str = GATILHO) -> None:
    """Embeddings, histórias, sentimento (FinBERT), extração (LLM → regras) e agregação."""
    from datetime import timedelta

    from nicho.enrich import run as er
    from nicho.enrich.models import E5Encoder, FinBertPtBr
    from nicho.extract.db_backends import CacheBanco, UsoBanco
    from nicho.extract.llm import Cadeia, montar_cadeia
    from nicho.extract.run import Extrator
    from nicho.ingest.news import MatcherTickers

    cfg = load_config()
    n = cfg.nlp
    desde = datetime.now(UTC) - timedelta(days=max(n.coleta.dias, n.cvm.dias))
    sentimento = FinBertPtBr(n.sentimento.modelo, n.sentimento.lote)
    with db.connect() as conn, track_run(db.PostgresRecorder(conn), "enriquecer", gatilho) as run:
        er.remarcar_tickers(conn, MatcherTickers(cfg.universe.ativos), run, desde)
        er.gerar_embeddings(conn, E5Encoder(n.embeddings.modelo, n.embeddings.lote), run, desde)
        er.agrupar_historias(conn, cfg, run, desde)
        er.classificar_sentimento(conn, sentimento, run, desde)
        extrator = Extrator(
            Cadeia(montar_cadeia(cfg.llm, UsoBanco(conn))),
            CacheBanco(conn),
            cfg.universe,
            cfg.scoring,
            n.extracao.prompt_versao,
            n.extracao.temperatura,
            n.extracao.max_caracteres_entrada,
            max_llm=n.extracao.max_itens_por_execucao,
        )
        er.extrair(conn, cfg, extrator, sentimento.nome, run, desde)
        er.agregar_historias(conn, sentimento.nome, run, desde)
        er.calcular_concordancia(conn, sentimento.nome, run)


@app.command("pontuar")
def pontuar(gatilho: str = GATILHO) -> None:
    """Score de relevância das histórias e event studies de fatos relevantes e notícias."""
    from datetime import timedelta

    from nicho.scoring.run import estudos_de_eventos, pontuar_historias

    cfg = load_config()
    agora = datetime.now(UTC)
    desde = agora - timedelta(days=max(cfg.nlp.coleta.dias, cfg.nlp.cvm.dias))
    with db.connect() as conn, track_run(db.PostgresRecorder(conn), "pontuar", gatilho) as run:
        pontuar_historias(conn, cfg, run, agora, desde)
        estudos_de_eventos(conn, cfg, run)


@app.command("grafos")
def grafos_cmd(gatilho: str = GATILHO) -> None:
    """Rede de correlação (MST, Louvain), grafo de conhecimento (FRE + notícias) e choques."""
    from nicho.graphs.run import rodar as rodar_grafos
    from nicho.ingest.cvm import CvmClient

    cfg = load_config()
    with db.connect() as conn, track_run(db.PostgresRecorder(conn), "grafos", gatilho) as run:
        rodar_grafos(conn, cfg, run, CvmClient())


@app.command("rodar")
def rodar(gatilho: str = GATILHO) -> None:
    """Executa todas as etapas em sequência: mercado, estatística, notícias e relevância."""
    ingest_precos(anos=3, intraday=True, gatilho=gatilho)
    ingest_macro_cmd(gatilho=gatilho)
    stats_cmd(gatilho=gatilho)
    ingest_noticias(noticias=True, cvm=True, max_pdfs=None, gatilho=gatilho)
    enriquecer(gatilho=gatilho)
    pontuar(gatilho=gatilho)
    grafos_cmd(gatilho=gatilho)
    pontuar(gatilho=gatilho)  # de novo, agora com a centralidade do grafo
    briefing_cmd(gatilho=gatilho)


@app.command("briefing")
def briefing_cmd(gatilho: str = GATILHO) -> None:
    """Gera e versiona o briefing do último pregão (só dados do banco, com citações)."""
    cfg = load_config()
    with db.connect() as conn, track_run(db.PostgresRecorder(conn), "briefing", gatilho) as run:
        dados = query_briefing_inputs(conn, cfg.universe.indice.ticker)
        conteudo = build_briefing(
            indice=cfg.universe.indice.ticker, gerado_em=datetime.now(UTC), **dados
        )
        versao = salvar_briefing(conn, conteudo)
        run.contar("versao", versao)
        run.contar("fontes", len(conteudo["fontes"]))
    typer.echo(f"briefing de {conteudo['dia']} v{versao}: {len(conteudo['fontes'])} fontes")


@app.command("heartbeat")
def heartbeat(gatilho: str = GATILHO) -> None:
    """Registra uma execução vazia: mantém o Supabase Free ativo (ADR 0003)."""
    with db.connect() as conn, track_run(db.PostgresRecorder(conn), "heartbeat", gatilho):
        pass


if __name__ == "__main__":
    app()
