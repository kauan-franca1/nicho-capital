# Metodologia estatística

Base da página `/metodologia` (fase 8). Parâmetros em [`config/stats.yaml`](../config/stats.yaml); código em [`pipeline/nicho/stats/`](../pipeline/nicho/stats).

## Retornos

- **Log-retorno:** $r_t = \ln(P_t / P_{t-1})$, com $P$ = preço ajustado a proventos quando disponível.
- **Volatilidade realizada:** desvio-padrão amostral de 21 pregões, anualizado por $\sqrt{252}$.

## Anomalias

### z-score robusto (retorno e volume)

$$z_t = \frac{x_t - \operatorname{mediana}(x_{t-60}, \dots, x_{t-1})}{1{,}4826 \cdot \operatorname{MAD}(x_{t-60}, \dots, x_{t-1})}$$

- **Por que robusto:** mediana e MAD não são arrastadas pelos próprios outliers, ao contrário de média e desvio-padrão. O fator 1,4826 iguala a MAD ao desvio-padrão sob normalidade, então $|z| = 3$ significa o mesmo que no z clássico.
- **Sem look-ahead:** a referência de $t$ usa só as 60 observações anteriores. O teste `test_robust_z_sem_look_ahead` altera o futuro e verifica que o passado não muda.
- **Volume:** usa o log do volume (distribuição muito assimétrica) e só sinaliza volume **alto**. O volume do índice no Yahoo não é confiável e fica de fora.
- **Severidade:** $|z| \ge 3$ baixa, $\ge 4{,}5$ média, $\ge 6$ alta.

### Mudanças de regime (change points)

- **Algoritmo:** PELT (biblioteca `ruptures`) com custo gaussiano por segmento, $n \cdot \ln \hat\sigma^2$, sobre os log-retornos. O custo é calculado em O(1) com somas acumuladas.
- **Penalidade:** $3 \ln n$, no estilo do BIC.
- **Saída:** a razão de volatilidade depois/antes define a severidade (≥ 1,5 baixa, ≥ 2 média, ≥ 3 alta).
- **Limitação:** a detecção é **retrospectiva**, porque usa a série inteira. Serve para descrever regimes, não como alerta em tempo real.

## Volatilidade condicional: GARCH(1,1)

$$r_t = \mu + \varepsilon_t, \quad \varepsilon_t = \sigma_t z_t, \quad \sigma_t^2 = \omega + \alpha\,\varepsilon_{t-1}^2 + \beta\,\sigma_{t-1}^2$$

- **Ajuste:** inovações $z_t$ com t de Student (caudas pesadas), estimadas por máxima verossimilhança (`arch`) em 750 pregões.
- **Leitura para o cliente:**
  - α mede a reação a choques novos.
  - β mede a memória.
  - **Persistência** α+β próxima de 1 significa que choques demoram a se dissipar.
  - **Meia-vida** de um choque: $\ln 0{,}5 / \ln(\alpha+\beta)$ pregões.
  - **Volatilidade de longo prazo:** $\sqrt{\omega / (1-\alpha-\beta)}$.
- **Limitações:**
  - A série de volatilidade é in-sample, porque os parâmetros usam a amostra inteira. A previsão de 5 pregões usa só dados até o último pregão.
  - Choques extremos (como 26/10/2026) dominam a estimação.
- **Validação:** `test_garch_recupera_parametros_conhecidos` simula um GARCH com α = 0,08 e β = 0,87 e confere a recuperação dos parâmetros.

## Event study (modelo de mercado)

1. **Estimação:** OLS de $R_{i,t} = \alpha_i + \beta_i R_{m,t} + \varepsilon_{i,t}$ na janela de −250 a −11 pregões. Ela termina antes da janela do evento, o que evita look-ahead.
2. **Retorno anormal:** $AR_{i,t} = R_{i,t} - (\hat\alpha_i + \hat\beta_i R_{m,t})$.
3. **CAR:** $CAR_i[a,b] = \sum_{t=a}^{b} AR_{i,t}$, nas janelas [−1, +1] e [0, +5].
4. **Teste:**
   - Estatística: $t = CAR / (\hat\sigma_\varepsilon \sqrt{L})$, com $L = b-a+1$ e $T-2$ graus de liberdade.
   - Intervalo de confiança de 95% pela t de Student.
   - A aproximação $\operatorname{Var}(CAR) \approx L\hat\sigma^2$ ignora o erro de estimação de $\hat\alpha$ e $\hat\beta$, que é desprezível com $T \ge 120$.

**Eventos usados hoje:** dias em que o **próprio Ibovespa** teve anomalia de retorno de severidade alta. A seleção é feita pelo índice, então o AR de cada ação mede a reação **além** do mercado e não é circular. A partir da fase 4, fatos relevantes da CVM e notícias de alta materialidade entram como eventos.

**Validação:**
- `test_event_study_recupera_efeito_sintetico_conhecido` injeta +6% no dia do evento e recupera o efeito.
- `test_event_study_sem_efeito_nao_e_significativo` roda 200 simulações sem efeito e verifica rejeição de H0 perto de 5%, ou seja, o teste está calibrado.
- `test_stats_ponta_a_ponta_e_idempotente` faz a etapa completa num schema Postgres temporário, com um choque sintético e uma ação de beta conhecido.

**Limitações:**
- **Choque de mercado:** num dia de crash, o próprio modelo de mercado é estressado, e o β estimado em período calmo pode não valer no choque.
- **Janelas incompletas:** uma janela de evento que ainda não terminou (ex.: [0, +5] a 4 pregões do fim da série) não é calculada. Ela aparece como pendente no log da etapa.
- **Múltiplas comparações:** muitos ativos testados no mesmo evento inflam os falsos positivos. A correção de Benjamini-Hochberg entra na fase 4, junto com o sentimento × retorno.
