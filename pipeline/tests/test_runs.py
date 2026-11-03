import pytest

from nicho.runs import MemoryRecorder, track_run


def test_execucao_ok_registra_contagens() -> None:
    rec = MemoryRecorder()
    with track_run(rec, "ingest_precos", gatilho="cron") as run:
        run.contar("linhas", 10)
        run.contar("linhas", 5)
    r = rec.runs[1]
    assert r["status"] == "ok"
    assert r["gatilho"] == "cron"
    assert r["contagens"] == {"linhas": 15}
    assert r["erro"] is None


def test_aviso_marca_execucao_como_parcial() -> None:
    rec = MemoryRecorder()
    with track_run(rec, "ingest_noticias") as run:
        run.avisar("feed X fora do ar")
    assert rec.runs[1]["status"] == "parcial"
    assert rec.runs[1]["erro"] == "feed X fora do ar"


def test_excecao_marca_falha_e_propaga() -> None:
    rec = MemoryRecorder()
    with pytest.raises(ValueError), track_run(rec, "stats"):
        raise ValueError("série vazia")
    assert rec.runs[1]["status"] == "falhou"
    assert "série vazia" in str(rec.runs[1]["erro"])
