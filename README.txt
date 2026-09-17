GPS DE PÁTIO - PROTÓTIPO V2

O que já funciona
-----------------
- mapa interno como fundo;
- os 17 destinos solicitados;
- Portaria como origem fixa;
- rota de entrada desenhada no mapa;
- posição do celular convertida para a planta usando 3 pontos reais;
- precisão informada pelo GPS;
- botão de teste na Portaria;
- zoom e movimentação do mapa;
- distância aproximada da rota.

IMPORTANTE
----------
Esta versão é um protótipo.

As rotas foram reconstruídas manualmente pela imagem fornecida. Elas ainda
precisam ser conferidas fisicamente antes de serem utilizadas por motoristas.

Quando estiver disponível um DXF pequeno contendo a layer "Caminho", as
polylines deste protótipo devem ser substituídas pela geometria exata do CAD.

PONTOS DE GEOREFERENCIAMENTO USADOS
-----------------------------------
Portaria:
-28.317572, -53.500773

Ponto 1:
-28.315245, -53.499432

Ponto 10:
-28.312751, -53.496495

TESTE
-----
Você pode abrir index.html e usar o botão "TESTAR DA PORTARIA" para testar
a interface.

A geolocalização real do navegador normalmente exige HTTPS ou localhost.
Para testar em um computador com Python instalado:

1. Abra o terminal dentro da pasta.
2. Execute:
   python -m http.server 8000
3. Abra:
   http://localhost:8000

Para uso no celular por motoristas externos, a versão final deverá ser
publicada em HTTPS.

NÃO PUBLICAR ESTA VERSÃO COMO PRODUTO FINAL
-------------------------------------------
A imagem atual contém informações internas e o traçado ainda é aproximado.
A versão pública deve usar um mapa simplificado mostrando somente o
necessário ao motorista.
