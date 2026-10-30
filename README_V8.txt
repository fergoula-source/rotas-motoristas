ROTAS INTERNAS V8 - PATCH SEGURO PARA frontend/public

SUBSTITUIR SOMENTE:
- app.js
- dados.js
- index.html

NÃO ALTERAR / NÃO SUBSTITUIR:
- style.css
- env-banner.js
- /env.js (gerado no deploy)
- favicons
- logo_kepler.png
- mapa_patio.png
- Dockerfile
- nginx.conf
- package.json / package-lock.json
- arquivos CI/CD / deploy

O index.html desta versão foi criado a partir do arquivo oficial atual e
preserva /env.js, /env-banner.js, favicons e o padrão da TI. A única mudança
de infraestrutura no index é o cache-busting de app.js e dados.js para v8.0.

PRINCIPAIS CORREÇÕES:
- geolocalização visual continua na posição real calculada no mapa;
- encaixe no grafo passa a ser calculado geograficamente, não por pixels;
- são avaliados vários acessos próximos para evitar prender a rota em um
  segmento sem saída ou no sentido errado;
- pontos A-X usados para calibrar GPS/mapa;
- ponto 2 exige a volta completa;
- pontos 4/5/6 seguem entradas validadas e saída azul compartilhada;
- pontos 7/8/9/11/12 usam o corredor superior validado;
- ponto 10 usa acesso dedicado;
- área M (empilhadeiras) não faz parte da malha de caminhões;
- rotas 13/14/15 seguem os ramais de entrada da Fábrica Central.

Antes de solicitar merge:
1. criar nova branch a partir da dev atual;
2. substituir apenas os 3 arquivos acima;
3. testar os 17 destinos em QAS/dev;
4. abrir MR para dev.
