ROTAS INTERNAS V9 - PATCH FINAL

Substituir SOMENTE em frontend/public:
- app.js
- dados.js
- index.html

NÃO ALTERAR:
- style.css
- env-banner.js
- /env.js
- favicons
- logo_kepler.png
- mapa_patio.png
- Docker / Nginx / package.json / CI-CD

PRINCIPAIS CORREÇÕES
- Uma rota fixa e independente para cada destino 1 a 17.
- As rotas são extraídas dos traçados finais fornecidos em campo.
- Ponto 4 entra pela direita; não existe mais atalho de entrada pela esquerda.
- Azul (saída) não entra no cálculo de chegada.
- Roxo / área de empilhadeiras não entra na malha de caminhões.
- GPS visual permanece na posição real.
- Para iniciar a navegação, apenas a rota selecionada é conectada à posição atual por uma linha tracejada.
- Transformação GPS -> mapa recalibrada com A-X, P1MID, P2MID, início da curva do 9 e GPS1 da Ferramentaria.
- R usa exatamente -28.31135931233716, -53.496221157504145.
- Favicons, /env.js e /env-banner.js da TI foram preservados no index.
