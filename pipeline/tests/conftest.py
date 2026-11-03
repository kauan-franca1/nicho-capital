import os
import uuid
from collections.abc import Iterator

import psycopg
import pytest

from nicho import migrate
from nicho.paths import migrations_dir


@pytest.fixture
def pg_isolado() -> Iterator[psycopg.Connection]:
    """Conexão num schema temporário com todas as migrations aplicadas; apagado no fim.

    Não toca nos dados do schema `public` (o banco de desenvolvimento continua intacto).
    """
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL não definida")
    schema = f"teste_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(url) as conn:
        conn.execute(f"create schema {schema}")
        conn.execute(f"set search_path to {schema}, public")
        conn.commit()
        try:
            migrate.apply(conn, migrate.discover(migrations_dir()))
            yield conn
        finally:
            conn.rollback()
            conn.execute(f"drop schema {schema} cascade")
            conn.commit()
