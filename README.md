# NERI LIVE DUO V3

Uma sala privada para **duas pessoas** transmitirem a tela simultaneamente em duas janelas de vídeo. Não requer instalação no computador do amigo.

## Atualizar seu NERI LIVE que já está no Render

1. Extraia este ZIP.
2. Entre no repositório GitHub usado no Render (ex.: `nerilive`).
3. Substitua `server.js`, `package.json` e `render.yaml` pelos arquivos deste pacote.
4. Entre na pasta `public` do repositório e substitua `index.html`, `app.js`, `style.css` e `favicon.svg` pelos arquivos dentro de `public` deste pacote. **IMPORTANTE: não coloque outra pasta `public` dentro da pasta `public`.**
5. Aguarde o **Auto Deploy** do Render ou abra Manual Deploy > Deploy latest commit.
6. No site atualizado, clique em **Criar sala**, mande o novo link `/room/priv-...` para seu amigo e **ambos** podem clicar em **Iniciar minha transmissão**.

⚠️ Salas antigas deixam de existir quando o servidor reinicia; crie uma nova após o deploy. É necessário atualizar **servidor e interface**, não só HTML.

## Executar localmente

Com Node.js 18+ instalado, execute `npm start` e abra `http://localhost:4747`.

## Sobre a conexão

- WebRTC envia vídeo P2P, não por meio do servidor Render.
- HTTPS obrigatório para captura de tela fora de localhost.
- STUN está configurado; em algumas redes será necessário TURN. Para adicionar seus próprios servidores use a variável de ambiente `ICE_SERVERS_JSON` no Render (JSON de `RTCIceServer[]`, com credenciais seguras).
- Selecionar 1080p/60 FPS não garante que o navegador/rede vai entregar esses números; avalie o bitrate e os FPS reais.
- Compartilhe o link somente com quem pode ver a tela. O app não implementa gravação nem acesso remoto ao PC.

## Testes

`npm test` valida criação de sala, limite de 2 participantes e sinalização dos dois lados.
