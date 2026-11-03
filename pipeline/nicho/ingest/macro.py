"""Ingestão das séries macro do SGS (config/macro.yaml)."""

from __future__ import annotations

from datetime import date, timedelta

import httpx
import psycopg

from nicho.config import Macro
from nicho.providers.sgs import SgsClient
from nicho.runs import RunContext


def ingest_macro(
    conn: psycopg.Connection,
    macro: Macro,
    client: SgsClient,
    run: RunContext,
    hoje: date | None = None,
) -> None:
    fim = hoje or date.today()
    inicio = fim - timedelta(days=round(365.25 * macro.anos_historico))
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into macro_series (codigo_sgs, slug, nome, unidade, periodicidade)
            values (%s, %s, %s, %s, %s)
            on conflict (codigo_sgs) do update set slug = excluded.slug, nome = excluded.nome,
                unidade = excluded.unidade, periodicidade = excluded.periodicidade
            """,
            [(s.codigo, s.slug, s.nome, s.unidade, s.periodicidade) for s in macro.series],
        )
    conn.commit()

    for s in macro.series:
        try:
            obs = client.serie(s.codigo, inicio, fim)
        except httpx.HTTPError as exc:
            run.avisar(f"SGS {s.codigo} ({s.slug}) falhou: {exc!r}")
            continue
        with conn.cursor() as cur:
            cur.executemany(
                """
                insert into macro_observations (codigo_sgs, dia, valor) values (%s, %s, %s)
                on conflict (codigo_sgs, dia) do update set valor = excluded.valor
                """,
                [(s.codigo, o.dia, o.valor) for o in obs],
            )
        conn.commit()
        run.contar(f"sgs_{s.slug}", len(obs))
