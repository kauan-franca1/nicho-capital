import os
from pathlib import Path

import pytest

from nicho import migrate
from nicho.migrate import Migration, MigrationError
from nicho.paths import migrations_dir


def test_migrations_do_repositorio_sao_descobertas_em_ordem() -> None:
    ms = migrate.discover(migrations_dir())
    assert ms[0].versao == "0001"
    assert [m.versao for m in ms] == sorted(m.versao for m in ms)


def test_nome_invalido_e_rejeitado(tmp_path: Path) -> None:
    (tmp_path / "init.sql").write_text("select 1", encoding="utf-8")
    with pytest.raises(MigrationError, match="inválido"):
        migrate.discover(tmp_path)


def test_pending_ignora_ja_aplicadas() -> None:
    a, b = Migration("0001", "0001_a", "select 1"), Migration("0002", "0002_b", "select 2")
    assert migrate.pending({"0001": a.checksum}, [a, b]) == [b]


def test_pending_detecta_migration_alterada() -> None:
    a = Migration("0001", "0001_a", "select 1")
    with pytest.raises(MigrationError, match="mudou"):
        migrate.pending({"0001": "checksum-antigo"}, [a])


def test_pending_detecta_versao_sem_arquivo() -> None:
    with pytest.raises(MigrationError, match="sem arquivo"):
        migrate.pending({"0009": "x"}, [])


@pytest.mark.db
@pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL não definida")
def test_migrate_e_sync_sao_idempotentes() -> None:
    from nicho import db
    from nicho.config import load_config

    with db.connect() as conn:
        migrate.apply(conn, migrate.discover(migrations_dir()))
        assert migrate.apply(conn, migrate.discover(migrations_dir())) == []

        universe = load_config().universe
        db.upsert_assets(conn, universe)
        db.upsert_assets(conn, universe)
        with conn.cursor() as cur:
            cur.execute("select count(*) from assets")
            row = cur.fetchone()
        assert row is not None and row[0] == len(universe.ativos) + 1
