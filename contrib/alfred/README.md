# 🎩 Alfred — assistente virtual por voz

Alfred é um assistente pessoal com que você conversa **por voz no navegador** (PC ou celular),
fora do Claude Code. O "cérebro" é o seu **OmniRoute**: o Alfred envia a conversa para o endpoint
OpenAI-compatível (`/v1/chat/completions`), então herda todos os provedores, combos e o fallback
automático que você já configurou.

- Sem dependências: um servidor Node (`server.mjs`) + uma página HTML.
- Fala → texto pelo navegador (Web Speech API) e texto → fala pelo navegador **ou** por uma voz
  neural do OmniRoute (`/v1/audio/speech`), em pt-BR.
- Conversa contínua: diga "Alfred, …", ele responde e já escuta a sua próxima frase.
- Responde em streaming e começa a falar a primeira frase antes da resposta terminar.
- A chave do OmniRoute fica no servidor — nunca vai para o navegador.

## Como usar

1. Deixe o OmniRoute rodando (`npm run dev` ou `omniroute`) com pelo menos um provedor conectado.
2. (Opcional) Configure o Alfred — o servidor lê `contrib/alfred/alfred.env` sozinho se ele existir:

   ```bash
   cp contrib/alfred/alfred.env.example contrib/alfred/alfred.env
   # edite OMNIROUTE_API_KEY (se o seu OmniRoute exige chave) e ALFRED_MODEL
   ```

3. Inicie **no mesmo computador** onde está o código (deixe o terminal aberto):

   ```bash
   node contrib/alfred/server.mjs
   ```

   Ele mostra o endereço e se o OmniRoute está respondendo:

   ```
   🎩 Alfred às suas ordens em http://127.0.0.1:20140
      cérebro: http://localhost:20128/v1 (modelo "auto")
      ✅ OmniRoute respondendo.
   ```

4. Abra <http://localhost:20140> no **Chrome ou Edge** desse mesmo computador e permita o microfone.

## Não abre?

| Sintoma                                              | Causa / solução                                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Não é possível acessar esse site" em `localhost`    | O servidor não está rodando **nesse aparelho**. `localhost` é sempre o próprio aparelho: rode o passo 3 no mesmo PC e mantenha o terminal aberto. |
| Abre no PC mas não no celular                        | O Alfred escuta só no próprio PC por padrão. Veja "Usar no celular" abaixo.                                                                         |
| `❌ A porta 20140 já está em uso`                     | Rode com outra porta: `ALFRED_PORT=20141 node contrib/alfred/server.mjs`.                                                                          |
| Página abre, mas responde "Não consegui falar com o OmniRoute" | Inicie o OmniRoute (`npm run dev` ou `omniroute`) ou ajuste `OMNIROUTE_URL`.                                                              |
| "O OmniRoute respondeu com erro (401)"               | Crie uma chave no dashboard do OmniRoute e coloque em `OMNIROUTE_API_KEY`.                                                                           |
| Microfone não funciona                               | Use Chrome/Edge, em `localhost` ou https, e permita o microfone no cadeado da barra de endereço.                                                     |

### Formas de falar

| Ação                | Como                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------- |
| Apertar para falar  | Clique em 🎙 (ou segure **Espaço**), fale; ele envia quando você para de falar        |
| Mãos livres         | Ligue **Sempre ouvindo** e diga "Alfred, que horas são?" (ou só "Alfred" e a pergunta) |
| Conversa contínua   | **Modo conversa** (ligado): depois de responder, ele já escuta a sua próxima frase     |
| Interromper         | **Esc**, ou clique no 🎙 e fale por cima                                              |
| Digitar             | Campo de texto + Enviar                                                               |
| Silenciar respostas | Desmarque **Voz**                                                                     |

Um bipe ascendente avisa que o microfone abriu; um descendente, que a frase foi enviada. Enquanto o
Alfred fala, o microfone fica fechado para ele não ouvir a própria voz.

### A voz do Alfred

Em **Ajustar a voz** você escolhe a voz, a velocidade e o tom, e testa na hora. O padrão do Alfred
é uma voz masculina, um pouco mais lenta (0,95×) e mais grave (tom 0,85). O texto é falado frase a
frase, sem markdown nem emojis, começando já na primeira vírgula para responder mais rápido.

A escolha automática prefere, nesta ordem: vozes **naturais/neurais** em pt-BR (no **Edge**,
"Microsoft Antonio Online (Natural)" é a mais fluida), as do Google, vozes masculinas e o resto.
Para a melhor voz sem configurar nada, use o **Microsoft Edge**.

**Voz neural (mais natural):** defina `ALFRED_TTS_MODEL` com um modelo de voz que o seu OmniRoute
tenha conectado, por exemplo `openai/gpt-4o-mini-tts` com `ALFRED_TTS_VOICE=onyx` (grave). O
Alfred pede cada frase ao OmniRoute assim que ela fica pronta e já busca a próxima enquanto a atual
toca. Se a voz neural falhar, aquela frase sai na voz do navegador. O Alfred envia também uma
direção de estilo (`ALFRED_TTS_INSTRUCTIONS`: mordomo inglês refinado, voz grave e pausada) para
modelos que a aceitam. Hoje o OmniRoute não repassa esse campo ao provedor, então ela só passa a
valer quando o OmniRoute passar a repassá-lo.

A voz é um personagem original no estilo de um mordomo. Ela não imita a voz de nenhum ator ou
dublador real. Para usar uma voz específica do ElevenLabs, coloque o `voice_id` em
`ALFRED_TTS_VOICE`, desde que você tenha o direito de usar essa voz.

O histórico fica no `localStorage` do navegador (últimas 40 mensagens).

## Usar no celular / fora de casa

O navegador só libera o microfone em `localhost` ou **https**. Para acessar de outro aparelho:

1. Defina um token: `ALFRED_TOKEN=um-segredo-longo` e `ALFRED_HOST=0.0.0.0`. O servidor passa a
   mostrar também os endereços de rede (`http://192.168.x.x:20140`) — pelo IP só a parte de
   texto funciona; o microfone exige https.
2. Publique com https — por exemplo, um túnel (Cloudflare Tunnel, Tailscale Serve, ngrok)
   apontando para a porta `20140`.
3. Abra a URL https no celular; o Alfred pede o token na primeira mensagem.
   No Android/Chrome, "Adicionar à tela inicial" deixa com cara de app.

## Configuração

| Variável               | Padrão                       | Descrição                                       |
| ---------------------- | ---------------------------- | ----------------------------------------------- |
| `OMNIROUTE_URL`        | `http://localhost:20128/v1`  | Endpoint OpenAI-compatível do OmniRoute         |
| `OMNIROUTE_API_KEY`    | —                            | Chave de API do OmniRoute                        |
| `ALFRED_MODEL`         | `auto`                       | Modelo ou combo (`auto/fast`, `auto/smart`, …)  |
| `ALFRED_HOST`          | `127.0.0.1`                  | Interface de escuta                              |
| `ALFRED_PORT`          | `20140`                      | Porta                                            |
| `ALFRED_TOKEN`         | —                            | Exige `Authorization: Bearer` nas rotas `/api/*` |
| `ALFRED_TTS_MODEL`     | —                            | Modelo de voz neural no OmniRoute (vazio = navegador) |
| `ALFRED_TTS_VOICE`     | `onyx`                       | Voz do provedor (ou `voice_id` do ElevenLabs)    |
| `ALFRED_TTS_SPEED`     | `1`                          | Velocidade da voz neural (0.25–4)                |
| `ALFRED_TTS_INSTRUCTIONS` | mordomo inglês refinado   | Direção de estilo para modelos que aceitam       |
| `ALFRED_USER_NAME`     | —                            | Como o Alfred deve chamar você                   |
| `ALFRED_SYSTEM_PROMPT` | persona de mordomo em pt-BR  | Substitui a personalidade inteira                |

## Arquitetura

```
Navegador (voz ⇄ texto)  ──POST /api/chat──▶  server.mjs  ──stream──▶  OmniRoute /v1/chat/completions
          ▲                                       │
          ├────────── SSE {text} ◀────────────────┘
          └── POST /api/tts (uma frase) ──▶ server.mjs ──▶ OmniRoute /v1/audio/speech  (opcional)
```

- `lib.mjs` — funções puras (config, prompt de sistema, validação, parser SSE); testadas em
  `tests/unit/alfred-lib.test.ts`.
- `server.mjs` — HTTP: serve a página, valida, injeta o prompt de sistema e repassa o stream.
- `public/voice.mjs` — motor de voz compartilhado: limpeza do texto, divisão em frases, escolha da
  voz, fila de fala (navegador ou neural), palavra de ativação e bipes; testado em
  `tests/unit/alfred-voice.test.ts`.
- `public/index.html` — interface e microfone (máquina de estados: parado → frase → "Alfred…").
- `claude/index.html` — versão que roda dentro do Claude (Artifact): o cérebro é o Claude, a voz é a
  do navegador, e o microfone é bloqueado pelo app (use o ditado do teclado). Publicada junto com
  `public/voice.mjs`.

## Ideias para evoluir

- Ferramentas (clima, agenda, lembretes) via tool calling ou via o servidor MCP do OmniRoute.
- Memória de longo prazo usando o módulo de memória do OmniRoute.
- Fazer o OmniRoute repassar `instructions` ao TTS da OpenAI, para a direção de estilo valer.
- Reconhecimento de fala pelo OmniRoute (`/v1/audio/transcriptions`) para funcionar fora do Chrome/Edge.
- Bot de Telegram reaproveitando `lib.mjs`.
