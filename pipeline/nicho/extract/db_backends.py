"""Cache de respostas do LLM (llm_cache) e contador de cota (quota_usage) no Postgres."""

from __future__ import annotations

from datetime import date
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from nicho.extract.run import Cache


class CacheBanco(Cache):
    def __init__(self, conn: psycopg.Connection) -> None:
        self.conn = conn

    def get(self, content_hash: str, prompt_versao: str) -> dict[str, Any] | None:
        with self.conn.cursor() as cur:
            cur.execute(
                "select provedor, modelo, resposta from llm_cache "
                "where content_hash = %s and prompt_versao = %s",
                (content_hash, prompt_versao),
            )
            row = cur.fetchone()
        if row is None:
            return None
        provedor, modelo, resposta = row
        return {"provedor": provedor, "modelo": modelo, **resposta}

    def put(
        self,
        content_hash: str,
        prompt_versao: str,
        provedor: str,
        modelo: str,
        resposta: dict[str, Any],
    ) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                "insert into llm_cache (content_hash, prompt_versao, provedor, modelo, resposta) "
                "values (%s, %s, %s, %s, %s) on conflict do nothing",
                (content_hash, prompt_versao, provedor, modelo, Jsonb(resposta)),
            )
        self.conn.commit()


class UsoBanco:
    def __init__(self, conn: psycopg.Connection) -> None:
        self.conn = conn

    def requests_hoje(self, provedor: str, dia: date) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                "select requests from quota_usage where provedor = %s and dia = %s", (provedor, dia)
            )
            row = cur.fetchone()
        return int(row[0]) if row else 0

    def registrar(self, provedor: str, dia: date, tokens: int) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                insert into quota_usage (provedor, dia, requests, tokens) values (%s, %s, 1, %s)
                on conflict (provedor, dia) do update set
                    requests = quota_usage.requests + 1,
                    tokens = quota_usage.tokens + excluded.tokens
                """,
                (provedor, dia, tokens),
            )
        self.conn.commit()
