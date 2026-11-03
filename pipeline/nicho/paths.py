"""Localização dos diretórios do repositório."""

from __future__ import annotations

import os
from pathlib import Path


def repo_root() -> Path:
    """Raiz do repositório: `NICHO_ROOT` ou o primeiro ancestral que contém `config/`."""
    env = os.environ.get("NICHO_ROOT")
    if env:
        return Path(env).resolve()
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "config").is_dir() and (parent / "db").is_dir():
            return parent
    raise RuntimeError("Raiz do repositório não encontrada; defina NICHO_ROOT.")


def config_dir() -> Path:
    return repo_root() / "config"


def migrations_dir() -> Path:
    return repo_root() / "db" / "migrations"
