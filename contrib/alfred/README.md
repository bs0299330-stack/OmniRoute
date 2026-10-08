# 🎩 Alfred — assistente virtual por voz

Alfred é um assistente pessoal com que você conversa **por voz no navegador** (PC ou celular),
fora do Claude Code. O "cérebro" é o seu **OmniRoute**: o Alfred envia a conversa para o endpoint
OpenAI-compatível (`/v1/chat/completions`), então herda todos os provedores, combos e o fallback
automático que você já configurou.

- Sem dependências: um servidor Node (`server.mjs`) + uma página HTML.
- Fala → texto e texto → fala pelo próprio navegador (Web Speech API), em pt-BR.
- Responde em streaming e começa a falar a primeira frase antes da resposta terminar.
- A chave do OmniRoute fica no servidor — nunca vai para o navegador.

## Como usar

1. Deixe o OmniRoute rodando (`npm run dev` ou `omniroute`) com pelo menos um provedor conectado.
2. Configure o Alfred:

   ```bash
   cp contrib/alfred/alfred.env.example contrib/alfred/alfred.env
   # edite OMNIROUTE_API_KEY (se o seu OmniRoute exige chave) e ALFRED_MODEL
   ```

3. Inicie:

   ```bash
   node --env-file=contrib/alfred/alfred.env contrib/alfred/server.mjs
   ```

4. Abra <http://localhost:20130> no **Chrome ou Edge** e permita o microfone.

### Formas de falar

| Ação                         | Como                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| Apertar para falar           | Clique em 🎙️ (ou segure **Espaço**), fale e solte/clique    |
| Mãos livres                  | Ative **Modo "Alfred…"** e diga "Alfred, que horas são?"    |
| Digitar                      | Campo de texto + Enviar                                      |
| Silenciar respostas          | Desmarque **Voz**                                            |
| Nova conversa                | Botão ↺                                                      |

O histórico fica no `localStorage` do navegador (últimas 40 mensagens).

## Usar no celular / fora de casa

O navegador só libera o microfone em `localhost` ou **https**. Para acessar de outro aparelho:

1. Defina um token: `ALFRED_TOKEN=um-segredo-longo` e `ALFRED_HOST=0.0.0.0`.
2. Publique com https — por exemplo, um túnel (Cloudflare Tunnel, Tailscale Serve, ngrok)
   apontando para a porta `20130`.
3. Abra a URL https no celular; o Alfred pede o token na primeira mensagem.
   No Android/Chrome, "Adicionar à tela inicial" deixa com cara de app.

## Configuração

| Variável               | Padrão                       | Descrição                                       |
| ---------------------- | ---------------------------- | ----------------------------------------------- |
| `OMNIROUTE_URL`        | `http://localhost:20128/v1`  | Endpoint OpenAI-compatível do OmniRoute         |
| `OMNIROUTE_API_KEY`    | —                            | Chave de API do OmniRoute                        |
| `ALFRED_MODEL`         | `auto`                       | Modelo ou combo (`auto/fast`, `auto/smart`, …)  |
| `ALFRED_HOST`          | `127.0.0.1`                  | Interface de escuta                              |
| `ALFRED_PORT`          | `20130`                      | Porta                                            |
| `ALFRED_TOKEN`         | —                            | Exige `Authorization: Bearer` nas rotas `/api/*` |
| `ALFRED_USER_NAME`     | —                            | Como o Alfred deve chamar você                   |
| `ALFRED_SYSTEM_PROMPT` | persona de mordomo em pt-BR  | Substitui a personalidade inteira                |

## Arquitetura

```
Navegador (voz ⇄ texto)  ──POST /api/chat──▶  server.mjs  ──stream──▶  OmniRoute /v1/chat/completions
          ▲                                       │
          └────────── SSE {text} ◀────────────────┘
```

- `lib.mjs` — funções puras (config, prompt de sistema, validação, parser SSE); testadas em
  `tests/unit/alfred-lib.test.ts`.
- `server.mjs` — HTTP: serve a página, valida, injeta o prompt de sistema e repassa o stream.
- `public/index.html` — interface, reconhecimento e síntese de voz.

## Ideias para evoluir

- Ferramentas (clima, agenda, lembretes) via tool calling ou via o servidor MCP do OmniRoute.
- Memória de longo prazo usando o módulo de memória do OmniRoute.
- Voz neural (TTS do OmniRoute/OpenAI) no lugar da voz do navegador.
- Bot de Telegram reaproveitando `lib.mjs`.
