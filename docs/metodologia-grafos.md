# Metodologia: grafos

Parâmetros em [`config/graphs.yaml`](../config/graphs.yaml); código em [`pipeline/nicho/graphs`](../pipeline/nicho/graphs).

## Rede de correlação

1. **Correlação:** Pearson dos log-retornos (preço ajustado) em janela de 90 dias corridos, com no mínimo 40 pregões em comum por par.
2. **Distância de Mantegna:** $d_{ij} = \sqrt{2(1-\rho_{ij})}$. É uma métrica: 0 para ρ = 1, √2 para ρ = 0 e 2 para ρ = −1.
3. **Minimum Spanning Tree (Kruskal):** as $n-1$ arestas que ligam todos os ativos com a menor soma de distâncias. É o "esqueleto" das dependências.
4. **Comunidades:** Louvain (networkx, semente fixa) no grafo completo com ρ ≥ 0,3, ponderado por ρ.
5. **Centralidades:**
   - grau e intermediação, na MST: quem é ponte entre grupos;
   - autovetor, no grafo completo: quem está ligado a quem está ligado. A de autovetor, normalizada pelo máximo, alimenta o fator "centralidade" do score de relevância.
6. **Linha do tempo:** um snapshot por fim de mês nos últimos 24 meses. O layout de cada mês parte das posições do anterior, para a animação mostrar mudança de estrutura, não ruído do algoritmo.

**Leitura de negócio:** árvore mais curta e correlação média maior significam ativos andando juntos e menos diversificação. Exemplo real: de nov/2024 a out/2026, a correlação média foi de 0,30 para 0,43 e as comunidades de 7 para 4.

## Grafo de conhecimento

| Nó | Fonte |
|---|---|
| Empresa, Setor | `config/universe.yaml` |
| Pessoa | FRE da CVM (administradores): presidentes de diretoria e conselho, mais quem está em 2+ empresas do universo |
| Acionista | FRE (posição acionária, 1º nível): participação ≥ 5% (aresta CONTROLA se controlador, senão PARTICIPA) |
| Evento | histórias da fase 4 com score ≥ 60 |

- **Arestas:** ADMINISTRA, CONTROLA, PARTICIPA, PERTENCE_A, MENCIONADA_EM e CO_MENCIONADA_COM. Esta última soma $0{,}5^{\text{idade}/7\,\text{dias}}$ por história em que as duas empresas aparecem juntas.
- **Filtros:**
  - conselho fiscal fica de fora, porque fiscaliza e não decide;
  - blocos familiares de controle, com dezenas de pessoas e frações pequenas, ficam de fora pelo mínimo de 5%;
  - de cada companhia, vale só a versão mais recente do FRE.
- **LGPD:** de pessoas, só nome e cargo já publicados pela CVM. O CPF existe no arquivo, mas nunca é lido.

## Propagação de choque

- **PageRank personalizado** (α = 0,85) com a semente como distribuição de recomeço, num grafo que soma:
  - correlação (peso 1,0 × ρ);
  - coocorrência em notícias (0,5, normalizada);
  - controle (0,8);
  - participação (0,3 × min(%/20, 1));
  - administrador em comum (0,3);
  - setor (0,4).
- **Sementes:** cada empresa, cada setor e cada acionista ligado a 2+ empresas. Os rankings são pré-calculados no pipeline.
- **Explicação:** para cada empresa do ranking, o caminho mais forte até a semente (menor soma de 1/peso), com o motivo de cada passo.
- **Limitação:** mede **exposição por conexão**, não prevê preço nem magnitude. Fatores externos ao universo (ex.: minério de ferro) não são nós. O choque "minério" se aproxima semeando VALE3 ou o setor de mineração.
