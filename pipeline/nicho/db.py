"""Acesso ao Postgres (psycopg 3)."""

from __future__ import annotations

import os

import psycopg
from psycopg.types.json import Jsonb

from nicho.config import Universe
from nicho.runs import Status


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError(
            "DATABASE_URL não definida. Use o Supabase ou `docker compose up -d db` "
            "(postgresql://nicho:nicho@localhost:54329/nicho)."
        )
    return url


def connect(url: str | None = None) -> psycopg.Connection:
    return psycopg.connect(url or database_url())


class PostgresRecorder:
    def __init__(self, conn: psycopg.Connection) -> None:
        self.conn = conn

    def start(self, etapa: str, gatilho: str) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                "insert into pipeline_runs (etapa, status, gatilho) values (%s, 'rodando', %s) "
                "returning id",
                (etapa, gatilho),
            )
            row = cur.fetchone()
        self.conn.commit()
        assert row is not None
        return int(row[0])

    def finish(
        self,
        run_id: int,
        status: Status,
        duracao_ms: int,
        contagens: dict[str, int],
        erro: str | None,
    ) -> None:
        self.conn.rollback()  # descarta uma transação da etapa que tenha ficado aberta
        with self.conn.cursor() as cur:
            cur.execute(
                "update pipeline_runs set status = %s, terminado_em = now(), duracao_ms = %s, "
                "contagens = %s, erro = %s where id = %s",
                (status, duracao_ms, Jsonb(contagens), erro, run_id),
            )
        self.conn.commit()


def upsert_assets(conn: psycopg.Connection, universe: Universe) -> int:
    """Sincroniza `assets` com `config/universe.yaml`. Idempotente."""
    rows: list[tuple[str, str, str, bool, list[str]]] = [
        (universe.indice.ticker, universe.indice.nome, "indice", True, [])
    ] + [(a.ticker, a.nome, a.setor, False, list(a.apelidos)) for a in universe.ativos]
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into assets (ticker, nome, setor, is_index, apelidos)
            values (%s, %s, %s, %s, %s)
            on conflict (ticker) do update set
                nome = excluded.nome, setor = excluded.setor,
                is_index = excluded.is_index, apelidos = excluded.apelidos, updated_at = now()
            """,
            rows,
        )
    conn.commit()
    return len(rows)
