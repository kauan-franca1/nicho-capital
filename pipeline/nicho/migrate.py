"""Runner mínimo de migrations SQL (ADR 0001).

Cada arquivo `db/migrations/NNNN_nome.sql` é aplicado uma única vez, dentro de uma transação,
e registrado em `schema_migrations` com o checksum. Se um arquivo já aplicado mudar, o runner
para com erro em vez de divergir em silêncio.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

FILENAME_RE = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")


@dataclass(frozen=True)
class Migration:
    versao: str
    nome: str
    sql: str

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.sql.encode("utf-8")).hexdigest()


class MigrationError(RuntimeError):
    pass


def discover(directory: Path) -> list[Migration]:
    migrations: list[Migration] = []
    for path in sorted(directory.glob("*.sql")):
        m = FILENAME_RE.match(path.name)
        if not m:
            raise MigrationError(f"nome de migration inválido: {path.name}")
        migrations.append(Migration(m.group(1), path.stem, path.read_text(encoding="utf-8")))
    versoes = [m.versao for m in migrations]
    if len(versoes) != len(set(versoes)):
        raise MigrationError("há duas migrations com a mesma versão")
    return migrations


def pending(applied: dict[str, str], available: list[Migration]) -> list[Migration]:
    """Migrations ainda não aplicadas. `applied` mapeia versão -> checksum."""
    by_version = {m.versao: m for m in available}
    for versao, checksum in applied.items():
        m = by_version.get(versao)
        if m is None:
            raise MigrationError(f"versão {versao} aplicada no banco, mas sem arquivo local")
        if m.checksum != checksum:
            raise MigrationError(f"migration {m.nome} mudou depois de aplicada")
    return [m for m in available if m.versao not in applied]


class _Cursor(Protocol):
    def execute(self, query: str, params: tuple[object, ...] | None = ..., /) -> object: ...
    def fetchall(self) -> list[tuple[object, ...]]: ...


class _Connection(Protocol):
    def cursor(self) -> _Cursor: ...
    def commit(self) -> None: ...
    def rollback(self) -> None: ...


CREATE_TABLE = """
create table if not exists schema_migrations (
    versao      text primary key,
    nome        text not null,
    checksum    text not null,
    aplicado_em timestamptz not null default now()
)
"""


def apply(conn: _Connection, available: list[Migration]) -> list[Migration]:
    cur = conn.cursor()
    cur.execute(CREATE_TABLE)
    conn.commit()
    cur.execute("select versao, checksum from schema_migrations")
    applied = {str(v): str(c) for v, c in cur.fetchall()}
    todo = pending(applied, available)
    for m in todo:
        try:
            cur.execute(m.sql)
            cur.execute(
                "insert into schema_migrations (versao, nome, checksum) values (%s, %s, %s)",
                (m.versao, m.nome, m.checksum),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return todo
