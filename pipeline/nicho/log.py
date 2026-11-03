"""Logs estruturados em JSON (structlog)."""

from __future__ import annotations

import logging
import sys

import structlog


def configure(level: str = "INFO", json: bool = True) -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stderr, level=level)
    # httpx loga cada requisição em INFO; os eventos relevantes já saem pelos nossos logs.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    renderer: structlog.types.Processor = (
        structlog.processors.JSONRenderer() if json else structlog.dev.ConsoleRenderer()
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level)),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)  # type: ignore[no-any-return]
