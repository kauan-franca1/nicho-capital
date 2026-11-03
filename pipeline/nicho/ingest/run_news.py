"""Etapa `nicho ingest noticias`: notícias (RSS, Google News, GDELT) e documentos da CVM."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import httpx
import psycopg

from nicho.config import Config
from nicho.ingest.cvm import CvmClient, filtrar_ipe, hash_texto, mapa_cnpj, texto_pdf
from nicho.ingest.news import Coletor, MatcherTickers, desde_dias, filtrar_e_marcar
from nicho.runs import RunContext


def coletar_noticias(
    conn: psycopg.Connection, cfg: Config, run: RunContext, coletor: Coletor, agora: datetime
) -> None:
    c = cfg.nlp.coleta
    resultados = [coletor.rss(c.resumo_max_caracteres)]
    if c.google_news_por_empresa:
        resultados.append(coletor.google_news(cfg.universe.ativos))
    resultados.append(coletor.gdelt(cfg.universe.ativos, c.gdelt_empresas_por_consulta, c.dias))

    falhas = [f for r in resultados for f in r.falhas]
    por_fonte: dict[str, int] = {}
    for f in falhas:
        chave = f.split(" ", 1)[0].rstrip(":")
        por_fonte[chave] = por_fonte.get(chave, 0) + 1
    for fonte, n in sorted(por_fonte.items()):
        exemplo = next(f for f in falhas if f.startswith(fonte))
        run.avisar(f"{fonte}: {n} falha(s), ex.: {exemplo[:160]}")

    itens = filtrar_e_marcar(
        (i for r in resultados for i in r.itens),
        MatcherTickers(cfg.universe.ativos),
        desde_dias(c.dias, agora),
    )
    novos = 0
    with conn.cursor() as cur:
        for it in itens:
            cur.execute(
                """
                insert into news_items (content_hash, fonte_id, fonte_nome, titulo, link, resumo,
                    publicado_em, coletado_via, tickers)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (content_hash) do nothing
                """,
                (
                    it.content_hash,
                    it.fonte_id,
                    it.fonte_nome,
                    it.titulo,
                    it.link,
                    it.resumo,
                    it.publicado_em,
                    it.coletado_via,
                    list(it.tickers),
                ),
            )
            novos += cur.rowcount
    conn.commit()
    run.contar("noticias_coletadas", len(itens))
    run.contar("noticias_novas", novos)
    run.contar("noticias_com_ticker", sum(1 for i in itens if i.tickers))
    for via in ("rss", "google_news", "gdelt"):
        run.contar(f"via_{via}", sum(1 for i in itens if i.coletado_via == via))


def coletar_cvm(
    conn: psycopg.Connection, cfg: Config, run: RunContext, cvm: CvmClient, hoje: date
) -> None:
    ccfg = cfg.nlp.cvm
    try:
        fca = cvm.fca_valor_mobiliario(hoje.year)
    except httpx.HTTPStatusError:
        fca = cvm.fca_valor_mobiliario(hoje.year - 1)  # começo de ano: arquivo novo ainda não saiu
    mapa = mapa_cnpj(fca, cfg.universe)
    with conn.cursor() as cur:
        cur.executemany(
            "update assets set cnpj = %s where ticker = %s", [(c, t) for c, t in mapa.items()]
        )
    run.contar("cnpjs_mapeados", len(mapa))
    sem_cnpj = {a.ticker for a in cfg.universe.ativos} - set(mapa.values())
    # Ações de classes diferentes da mesma empresa (PETR3/PETR4) compartilham o CNPJ.
    sem_cnpj_reais = sorted(t for t in sem_cnpj if not any(t[:4] == m[:4] for m in mapa.values()))
    if sem_cnpj_reais:
        run.avisar(f"sem CNPJ no FCA: {', '.join(sem_cnpj_reais)}")

    desde = hoje - timedelta(days=ccfg.dias)
    linhas = []
    for ano in sorted({desde.year, hoje.year}):
        linhas += cvm.ipe(ano)
    filings = filtrar_ipe(linhas, mapa, ccfg.categorias, desde)
    novos = 0
    with conn.cursor() as cur:
        for f in filings:
            cur.execute(
                """
                insert into filings (protocolo_entrega, versao, ticker, cnpj, categoria, tipo,
                    especie, assunto, data_entrega, data_referencia, link_download)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (protocolo_entrega, versao) do nothing
                """,
                (
                    f.protocolo_entrega,
                    f.versao,
                    f.ticker,
                    f.cnpj,
                    f.categoria,
                    f.tipo,
                    f.especie,
                    f.assunto,
                    f.data_entrega,
                    f.data_referencia,
                    f.link_download,
                ),
            )
            novos += cur.rowcount
        cur.execute(
            "select id, link_download from filings where texto_status = 'pendente' "
            "order by data_entrega desc limit %s",
            (ccfg.max_pdfs_por_execucao,),
        )
        pendentes = cur.fetchall()
    conn.commit()
    run.contar("documentos_cvm", len(filings))
    run.contar("documentos_cvm_novos", novos)

    ok = falhou = 0
    for fid, link in pendentes:
        try:
            texto = texto_pdf(cvm.pdf(link), ccfg.max_caracteres_texto)
            status = "ok" if texto.strip() else "falhou"
        except Exception:
            texto, status = None, "falhou"
        with conn.cursor() as cur:
            cur.execute(
                "update filings set texto = %s, content_hash = %s, texto_status = %s where id = %s",
                (texto, hash_texto(texto) if texto else None, status, fid),
            )
        conn.commit()
        ok += status == "ok"
        falhou += status == "falhou"
        cvm.dormir(ccfg.intervalo_download_segundos)
    run.contar("pdfs_lidos", ok)
    if falhou:
        run.avisar(f"{falhou} PDF(s) da CVM sem texto (escaneado ou download falhou)")
