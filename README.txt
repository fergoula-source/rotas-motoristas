ROTAS INTERNAS - PROTÓTIPO V3

ALTERAÇÕES DESTA VERSÃO
-----------------------
- Atualizadas as coordenadas reais dos pontos 0 a 17.
- O mapa de fundo voltou a ser o mapa limpo.
- O traçado desenhado pelo usuário foi reconstruído como rede de navegação.
- Preto: via de entrada / sentido de ida.
- Vermelho: via de mão dupla.
- Azul: saída única; não é utilizada para calcular rotas de entrada.
- A rota pode começar da localização atual do celular.
- Se o GPS ainda não estiver disponível, o sistema usa a Portaria para teste.
- O GPS é encaixado na via permitida mais próxima antes de calcular a rota.
- Layout base já usa laranja, preto, branco e cinza.

TESTE LOCAL
-----------
Abra um terminal nesta pasta e execute:

python -m http.server 8000

Depois acesse:
http://localhost:8000

No computador, localhost permite testar a geolocalização.
No celular, para GPS real, publique em HTTPS (por exemplo GitHub Pages).

ATUALIZAR O GITHUB
------------------
Substitua no repositório os arquivos:
index.html
style.css
dados.js
app.js
mapa_patio.png

Depois aguarde o GitHub Pages publicar a nova versão.

IMPORTANTE
----------
Esta ainda é uma versão de validação. Teste as 17 rotas no mapa antes
de liberar oficialmente para motoristas externos.
