-- 0005_graphs — grafos (fase 5).

-- Novo tipo de snapshot: rankings de propagação de choque pré-calculados.
alter table graph_snapshots drop constraint graph_snapshots_tipo_check;
alter table graph_snapshots add constraint graph_snapshots_tipo_check
    check (tipo in ('correlacao_mst', 'conhecimento', 'choque'));

-- Participação acionária relevante sem controle (ex.: gestora com 6,7%).
alter table kg_edges drop constraint kg_edges_relacao_check;
alter table kg_edges add constraint kg_edges_relacao_check
    check (relacao in ('ADMINISTRA', 'CONTROLA', 'PARTICIPA', 'PERTENCE_A', 'MENCIONADA_EM',
                       'CO_MENCIONADA_COM', 'AFETA'));

-- Acionistas pessoa jurídica fora do universo também são nós.
alter table kg_nodes drop constraint kg_nodes_tipo_check;
alter table kg_nodes add constraint kg_nodes_tipo_check
    check (tipo in ('Empresa', 'Pessoa', 'Setor', 'Evento', 'Noticia', 'Acionista'));
