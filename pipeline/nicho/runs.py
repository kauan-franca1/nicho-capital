"""Registro de execuções do pipeline na tabela `pipeline_runs` (alimenta a página /status)."""

from __future__ import annotations

import time
import traceback
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Literal, Protocol

from nicho.log import get_logger

Status = Literal["rodando", "ok", "parcial", "falhou"]

log = get_logger(__name__)


class RunRecorder(Protocol):
    def start(self, etapa: str, gatilho: str) -> int: ...
    def finish(
        self,
        run_id: int,
        status: Status,
        duracao_ms: int,
        contagens: dict[str, int],
        erro: str | None,
    ) -> None: ...


@dataclass
class RunContext:
    etapa: str
    contagens: dict[str, int] = field(default_factory=dict)
    avisos: list[str] = field(default_factory=list)

    def contar(self, chave: str, n: int = 1) -> None:
        self.contagens[chave] = self.contagens.get(chave, 0) + n

    def avisar(self, mensagem: str) -> None:
        """Registra uma falha não fatal; a execução termina como 'parcial'."""
        self.avisos.append(mensagem)
        log.warning("aviso", etapa=self.etapa, mensagem=mensagem)


@contextmanager
def track_run(recorder: RunRecorder, etapa: str, gatilho: str = "manual") -> Iterator[RunContext]:
    run_id = recorder.start(etapa, gatilho)
    ctx = RunContext(etapa)
    inicio = time.perf_counter()
    log.info("etapa_iniciada", etapa=etapa, run_id=run_id, gatilho=gatilho)
    try:
        yield ctx
    except Exception as exc:
        duracao = int((time.perf_counter() - inicio) * 1000)
        erro = "".join(traceback.format_exception_only(exc)).strip()
        recorder.finish(run_id, "falhou", duracao, ctx.contagens, erro)
        log.error("etapa_falhou", etapa=etapa, run_id=run_id, erro=erro, duracao_ms=duracao)
        raise
    duracao = int((time.perf_counter() - inicio) * 1000)
    status: Status = "parcial" if ctx.avisos else "ok"
    erro_txt = "; ".join(ctx.avisos) if ctx.avisos else None
    recorder.finish(run_id, status, duracao, ctx.contagens, erro_txt)
    log.info(
        "etapa_concluida",
        etapa=etapa,
        run_id=run_id,
        status=status,
        duracao_ms=duracao,
        contagens=ctx.contagens,
    )


class MemoryRecorder:
    """Recorder em memória, para testes e execuções sem banco."""

    def __init__(self) -> None:
        self.runs: dict[int, dict[str, object]] = {}

    def start(self, etapa: str, gatilho: str) -> int:
        run_id = len(self.runs) + 1
        self.runs[run_id] = {"etapa": etapa, "gatilho": gatilho, "status": "rodando"}
        return run_id

    def finish(
        self,
        run_id: int,
        status: Status,
        duracao_ms: int,
        contagens: dict[str, int],
        erro: str | None,
    ) -> None:
        self.runs[run_id].update(
            status=status, duracao_ms=duracao_ms, contagens=dict(contagens), erro=erro
        )
