ROTAS INTERNAS – V7 FINAL PARA VALIDAÇÃO DA TI

OBJETIVO
--------
Aplicação web estática para orientar motoristas externos e colaboradores
até os pontos de carregamento 1 a 17 dentro da unidade.

PRINCIPAIS RECURSOS
-------------------
- Geolocalização em tempo real pelo navegador.
- A posição exibida no mapa é a posição real calculada pelo GPS; ela não é
  mais "jogada" diretamente para cima da estrada.
- Quando a pessoa está fora da via interna, uma linha tracejada liga sua
  posição exata ao ponto de acesso mais próximo da malha de rotas.
- A partir desse acesso, o caminho segue as vias cadastradas e os sentidos
  permitidos.
- A rota é recalculada automaticamente conforme a pessoa se movimenta.
- Se a localização estiver indisponível ou for recusada, a Portaria passa
  a ser a origem.
- Popup orienta o usuário a liberar a permissão de localização.
- Zoom por botões, roda do mouse e gesto de pinça no celular.
- Botão de centralização na posição atual.
- Tentativa de manter a tela acesa durante a navegação via Screen Wake Lock.
- Layout responsivo nas cores laranja, preto, branco e cinza.
- Logo institucional no cabeçalho.
- Sem bibliotecas externas e sem chamadas para serviços de mapas.

ROTAS / SENTIDOS
----------------
A malha foi atualizada com base no último mapa anotado fornecido:
- segmentos vermelhos = mão dupla;
- segmentos pretos = sentido cadastrado de ida;
- a saída azul não é utilizada como rota de entrada;
- foram adicionadas conexões de saída/two-way nos pontos atualizados no mapa.

PRIVACIDADE
-----------
A geolocalização é processada somente no navegador do usuário.
Esta versão não possui backend, banco de dados, analytics nem envio de
coordenadas para servidor externo.

ARQUIVOS
--------
index.html        interface
style.css         layout responsivo
app.js            GPS, cálculo de rota, navegação e mapa
dados.js          pontos, coordenadas e grafo de rotas
mapa_patio.png    imagem-base do mapa interno
logo_kepler.png   logo exibida no cabeçalho

REQUISITOS PARA PUBLICAÇÃO
--------------------------
1. Hospedagem HTTPS (obrigatória para Geolocation e Wake Lock em produção).
2. Navegador moderno com JavaScript habilitado.
3. Permissão de localização concedida pelo usuário.
4. Para GPS de melhor precisão, o usuário deve manter a localização precisa
   habilitada no aparelho.

Pode ser hospedado como site estático em servidor interno, GitHub Pages
durante piloto, ou infraestrutura web definida pela TI.

SCREEN WAKE LOCK
----------------
A aplicação solicita ao navegador que mantenha a tela ativa após o usuário
iniciar uma rota. O comportamento final depende do navegador, do sistema
operacional e das políticas de economia de energia do aparelho.

VALIDAÇÃO RECOMENDADA ANTES DA LIBERAÇÃO
----------------------------------------
- Testar fisicamente as rotas 1 a 17.
- Conferir todos os trechos marcados como mão dupla.
- Testar em Android/Chrome e iPhone/Safari.
- Testar GPS em pontos afastados das vias (usuário a pé).
- Confirmar política interna para exposição do mapa a motoristas externos.

VERSÃO
------
V7 – 06/10/2026


AJUSTE V7.1 - PONTO DE CARREGAMENTO 2
-------------------------------------
O acesso de entrada ao Ponto 2 deve obrigatoriamente seguir o contorno
preto ao redor da área do Ponto 1.

O pequeno trecho inferior ligado ao Ponto 2 é tratado somente como saída.
Assim, o algoritmo não pode mais utilizar esse trecho como atalho de entrada.
