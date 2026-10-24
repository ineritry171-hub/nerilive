# NERI LIVE V2

App de transmissão de tela via WebRTC com salas privadas e chat, para uso no PC e espectadores via navegador.

## Deploy no Render

1. Crie um repositório GitHub com o conteúdo desta pasta na raiz.
2. Render > New > Web Service > selecione o repositório.
3. Build Command `npm install`; Start Command `npm start`; plano Free para testes.
4. Abra o HTTPS gerado, crie a sala e compartilhe somente o link `/watch/...`.

Para Windows local: clique `ABRIR_NO_WINDOWS.bat`.

> O vídeo usa WebRTC P2P. Redes com NAT rigoroso podem precisar de TURN.
> Consulte o LEIA-ME.txt para instruções completas.
