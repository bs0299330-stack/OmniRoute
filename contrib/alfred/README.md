# 🎩 Alfred — assistente virtual por voz

Alfred é um assistente pessoal com que você conversa **por voz**, fora do Claude Code, com uma
interface escura (preto, grafite e um toque de amarelo) em que um globo de partículas reage ao que
ele faz, e três jeitos de usar:

| Onde                   | Como abrir                                   | Microfone            | Voz de IA |
| ---------------------- | -------------------------------------------- | -------------------- | --------- |
| Site no seu PC         | `node contrib/alfred/server.mjs`             | sim (Chrome/Edge)    | sim       |
| Terminal               | `node contrib/alfred/cli.mjs`                | sim (com `sox`)      | sim       |
| Celular, de qualquer lugar | `node contrib/alfred/server.mjs --tunel` | sim (link https)     | sim       |
| Dentro do app do Claude | Artifact publicado de `claude/index.html`   | ditado do teclado    | não       |

O **cérebro** é escolhido sozinho (`ALFRED_BRAIN=auto`): o seu **OmniRoute** se ele responder
(herda provedores, combos e fallback), senão a **OpenAI** (com `OPENAI_API_KEY`), senão o
**Claude**, pelo Claude Code instalado no PC (`claude -p`, sem ferramentas, só conversa).

- Sem dependências: um servidor Node (`server.mjs`) + uma página HTML.
- Fala → texto pelo navegador (Web Speech API) e texto → fala por uma **voz de IA da OpenAI**
  (`gpt-4o-mini-tts`, direto ou via OmniRoute) ou, sem configurar nada, pela voz do navegador.
- Conversa contínua: diga "Alfred, …", ele responde e já escuta a sua próxima frase.
- Responde em streaming e começa a falar a primeira frase antes da resposta terminar.
- A chave do OmniRoute fica no servidor — nunca vai para o navegador.

## Hospedar no seu PC (Windows)

O Alfred é só esta pasta (`contrib/alfred`). Ele não precisa do resto do OmniRoute, de Git nem de
`npm install`, só do Node.js 22+, que o instalador coloca se faltar.

**Jeito mais fácil: um comando.** Abra o **PowerShell** (menu Iniciar → digite "PowerShell"),
cole esta linha inteira e aperte Enter:

```powershell
irm https://raw.githubusercontent.com/bs0299330-stack/OmniRoute/claude/alfred-virtual-assistant-awv48m/contrib/alfred/windows/instalar.ps1 | iex
```

Ele baixa o Alfred para `Documentos\Alfred`, instala o Node.js (se faltar, pelo `winget`), cria o
atalho **Alfred** na Área de Trabalho e já abre o Alfred no navegador. Rodar o mesmo comando de
novo **atualiza** o Alfred e mantém o seu `alfred.env`.

**Sem o comando:** baixe o `Alfred.zip`, clique com o botão direito → **Extrair tudo** (por
exemplo em `Documentos`), entre em `Alfred\windows` e dê clique duplo em `iniciar-alfred.cmd`.
Se o Windows avisar "O Windows protegeu o computador", clique em **Mais informações → Executar
assim mesmo** (acontece com qualquer arquivo baixado da internet).

**Com Git** (para quem já usa):

```powershell
git clone --depth 1 --branch claude/alfred-virtual-assistant-awv48m --filter=blob:none --sparse https://github.com/bs0299330-stack/OmniRoute Alfred
cd Alfred; git sparse-checkout set contrib/alfred
```

**Depois de instalado**, os atalhos ficam em `Alfred\windows` (ou `contrib\alfred\windows` no Git):

| Atalho                       | O que faz                                                            |
| ---------------------------- | -------------------------------------------------------------------- |
| `iniciar-alfred.cmd`         | Liga o Alfred e abre <http://localhost:20140> no navegador            |
| `alfred-celular.cmd`         | Liga e mostra um link https para usar no celular, com microfone      |
| `alfred-terminal.cmd`        | Alfred no terminal                                                    |
| `ligar-com-o-windows.cmd`    | Faz o Alfred ligar sozinho (minimizado) sempre que você entrar no PC |
| `desligar-com-o-windows.cmd` | Desfaz o anterior                                                     |

A janela preta é o Alfred rodando: **fechar a janela desliga o Alfred**. Na primeira vez os
atalhos criam o `alfred.env`. Abra no Bloco de Notas e preencha `OPENAI_API_KEY=` para ter a voz
de IA. Sem nada configurado, o cérebro é o **Claude Code** do seu PC (se você usa o `claude` no
terminal), ou o OmniRoute, se estiver rodando.

No Mac ou no Linux: instale o Node 22, baixe com o comando `git` acima e rode
`node contrib/alfred/server.mjs` (ou `--tunel`, ou `cli.mjs`).

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

## Alfred no terminal

```bash
node contrib/alfred/cli.mjs                  # conversa por texto (+ voz, se configurada)
node contrib/alfred/cli.mjs --conversa       # mãos livres: ouve, responde, ouve de novo
node contrib/alfred/cli.mjs --cerebro=claude # força o cérebro (claude, openai, omniroute)
node contrib/alfred/cli.mjs --sem-voz
```

Lê o mesmo `alfred.env`. Dentro dele: escreva e aperte Enter; **Enter vazio** ouve uma frase pelo
microfone; `/conversa`, `/voz`, `/nova`, `/ajuda`, `/sair`. Ctrl+C interrompe a fala ou a resposta,
e dois Ctrl+C saem.

- **Voz:** com `OPENAI_API_KEY`, ele fala com a voz de IA. No Windows usa o player do próprio
  sistema (PowerShell), no Mac o `afplay` e no Linux `paplay`, `aplay`, `ffplay` ou `mpv`.
- **Microfone:** precisa do **sox** (Windows: `winget install ChrisBagwell.SoX`; Mac:
  `brew install sox`; Linux: `apt install sox`) e de `OPENAI_API_KEY` para transcrever
  (`gpt-4o-mini-transcribe`), ou de `ALFRED_STT_MODEL` com um modelo de transcrição do OmniRoute. Ele
  para de gravar sozinho depois de ~1,6 s de silêncio.

## Não abre?

| Sintoma                                              | Causa / solução                                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Não é possível acessar esse site" em `localhost`    | O servidor não está rodando **nesse aparelho**. `localhost` é sempre o próprio aparelho: rode o passo 3 no mesmo PC e mantenha o terminal aberto. |
| Abre no PC mas não no celular                        | Use `node contrib/alfred/server.mjs --tunel` e abra o link no celular. Veja "Falar com o Alfred pelo celular".                                    |
| `❌ A porta 20140 já está em uso`                     | Rode com outra porta: `ALFRED_PORT=20141 node contrib/alfred/server.mjs`.                                                                          |
| Página abre, mas responde "Não consegui falar com o OmniRoute" | Inicie o OmniRoute, ou use outro cérebro: `ALFRED_BRAIN=claude` (Claude Code) ou `OPENAI_API_KEY`. |
| "O Claude Code não está logado"                      | Rode `claude` uma vez no terminal e entre na sua conta.                                                                                            |
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

**Voz de IA (recomendado):** coloque a sua chave da OpenAI no `alfred.env`:

```bash
OPENAI_API_KEY=sk-...
ALFRED_TTS_VOICE=onyx   # grave; experimente ash, echo, cedar, ballad
```

O Alfred passa a falar com o `gpt-4o-mini-tts`, que soa natural e segue uma direção de estilo
(`ALFRED_TTS_INSTRUCTIONS`): mordomo refinado, voz grave e calma, ritmo pausado, sotaque brasileiro.
A primeira frase é pedida assim que fica pronta, e o resto da resposta vai em blocos de várias
frases, buscados enquanto o bloco anterior toca. Assim não há corte a cada vírgula. Se a voz de IA
falhar, aquele trecho sai na voz do navegador. Em **Ajustar a voz** você troca a voz de IA na hora.
A chave fica só no servidor, nunca vai para o navegador.

Para usar um provedor de voz conectado ao OmniRoute em vez da OpenAI direta:
`ALFRED_TTS_PROVIDER=omniroute` e `ALFRED_TTS_MODEL=<provedor/modelo>`. O OmniRoute hoje não
repassa `instructions`, então ali a direção de estilo não vale.

**Voz do navegador (sem chave):** em **Ajustar a voz** você escolhe a voz, a velocidade e o tom, e
testa na hora. O padrão mantém velocidade e tom naturais (1,0), porque alterar o tom é o que mais
deixa as vozes com som robótico. A escolha automática prefere vozes **naturais/neurais** em pt-BR
(no **Microsoft Edge**, "Microsoft Antonio Online (Natural)" é a mais fluida), depois as do Google,
depois vozes masculinas.

A voz é um personagem original no estilo de um mordomo. Ela não imita a voz de nenhum ator ou
dublador real.

## Falar com o Alfred pelo celular (com microfone)

O navegador do celular só libera o microfone em **https**. O Alfred cria esse link sozinho:

1. Instale o **cloudflared** no PC (uma vez): `winget install Cloudflare.cloudflared` no Windows,
   ou `brew install cloudflared` no Mac.
2. Inicie o Alfred com `--tunel`:

   ```bash
   node contrib/alfred/server.mjs --tunel
   ```

3. Ele mostra um link `https://….trycloudflare.com/#token=…`. Abra esse link no celular (Chrome
   no Android). A senha vai junto no link, a página guarda e tira da barra de endereço. Toque no
   🎙 e fale.

Enquanto o link estiver ativo, as rotas `/api/*` exigem a senha. Se `ALFRED_TOKEN` não estiver
definido, ele gera uma senha nova a cada execução. **Não compartilhe o link**, porque quem tiver o
link fala com o seu Alfred, usando o seu cérebro e a sua voz de IA. O link fecha quando você
encerra o Alfred. Sem cloudflared, dá para usar outro túnel https (Tailscale Serve, ngrok)
apontando para a porta `20140`, com `ALFRED_TOKEN` definido.

**Na página do Claude** o app não deixa a página usar o microfone. Lá, ligue o **Modo ditado**
(já vem ligado no celular): toque no campo, use o 🎤 do teclado e fale. Quando você para de falar,
ele envia sozinho.

## Configuração

| Variável               | Padrão                       | Descrição                                       |
| ---------------------- | ---------------------------- | ----------------------------------------------- |
| `ALFRED_BRAIN`         | `auto`                       | `omniroute`, `openai` ou `claude` (Claude Code)  |
| `ALFRED_CLAUDE_MODEL`  | —                            | Modelo do Claude Code (`sonnet`, `opus`…)        |
| `ALFRED_OPENAI_MODEL`  | `gpt-4o-mini`                | Modelo quando o cérebro é a OpenAI              |
| `ALFRED_STT_MODEL`     | `gpt-4o-mini-transcribe`     | Transcrição do microfone no terminal            |
| `OMNIROUTE_URL`        | `http://localhost:20128/v1`  | Endpoint OpenAI-compatível do OmniRoute         |
| `OMNIROUTE_API_KEY`    | —                            | Chave de API do OmniRoute                        |
| `ALFRED_MODEL`         | `auto`                       | Modelo ou combo (`auto/fast`, `auto/smart`, …)  |
| `ALFRED_HOST`          | `127.0.0.1`                  | Interface de escuta                              |
| `ALFRED_PORT`          | `20140`                      | Porta                                            |
| `ALFRED_TOKEN`         | —                            | Exige `Authorization: Bearer` nas rotas `/api/*` |
| `ALFRED_TUNNEL`        | —                            | `1` = o mesmo que `--tunel` (link para o celular) |
| `OPENAI_API_KEY`       | —                            | Liga a voz de IA da OpenAI (gpt-4o-mini-tts)     |
| `ALFRED_TTS_VOICE`     | `onyx`                       | Voz padrão (OpenAI: onyx, ash, echo, cedar…)     |
| `ALFRED_TTS_PROVIDER`  | automático                   | `openai`, `omniroute` ou `off`                   |
| `ALFRED_TTS_MODEL`     | `gpt-4o-mini-tts` (OpenAI)   | Modelo de voz (obrigatório com `omniroute`)      |
| `ALFRED_TTS_SPEED`     | `1`                          | Velocidade, só para `tts-1`/`tts-1-hd`           |
| `ALFRED_TTS_INSTRUCTIONS` | mordomo refinado          | Direção de estilo do `gpt-4o-mini-tts`           |
| `ALFRED_USER_NAME`     | —                            | Como o Alfred deve chamar você                   |
| `ALFRED_SYSTEM_PROMPT` | persona de mordomo em pt-BR  | Substitui a personalidade inteira                |

## Arquitetura

```
Navegador (voz ⇄ texto)  ──POST /api/chat──▶  server.mjs  ──stream──▶  brain.mjs → OmniRoute | OpenAI | claude -p
          ▲                                       │
          ├────────── SSE {text} ◀────────────────┘
          └── POST /api/tts (um trecho) ──▶ server.mjs ──▶ OpenAI ou OmniRoute /audio/speech (opcional)
```

- `lib.mjs` — funções puras (config, prompt de sistema, validação, parser SSE, comando do Claude
  Code, argumentos do sox); testadas em `tests/unit/alfred-lib.test.ts` e `alfred-brain.test.ts`.
- `brain.mjs` — o cérebro: escolhe e conversa com OmniRoute, OpenAI ou Claude Code, em streaming.
  O texto do usuário vai para o `claude` só pelo stdin, nunca pela linha de comando.
- `cli.mjs` — o Alfred do terminal (voz, microfone com sox, modo conversa).
- `public/hud.css` + `public/hud.mjs` — o visual e o globo de ~700 partículas: gira devagar em
  espera, fica amarelo e "respira" ouvindo, gira em faixas processando e se agita com a voz
  falando (pelo volume real da voz de IA, ou pelas palavras da voz do navegador).
- `server.mjs` — HTTP: serve a página, valida, injeta o prompt de sistema e repassa o stream.
- `public/voice.mjs` — motor de voz compartilhado: limpeza do texto, divisão em frases, escolha da
  voz, fila de fala (navegador ou neural), palavra de ativação e bipes; testado em
  `tests/unit/alfred-voice.test.ts`.
- `public/index.html` — interface e microfone (máquina de estados: parado → frase → "Alfred…").
- `windows/*.cmd` — atalhos de clique duplo para o Windows (iniciar, celular, terminal, ligar com
  o Windows); `windows/instalar.ps1` — o instalador de um comando (a lista de arquivos dele é
  conferida por um teste).
- `claude/index.html` — versão que roda dentro do Claude (Artifact): o cérebro é o Claude, a voz é a
  do navegador, e o microfone é bloqueado pelo app (use o ditado do teclado). Antes de publicar,
  `node contrib/alfred/claude/build.mjs` gera `claude/dist/alfred.html`, um arquivo único com o
  CSS e os módulos embutidos; esse é o arquivo publicado.

## Ideias para evoluir

- Ferramentas (clima, agenda, lembretes) via tool calling ou via o servidor MCP do OmniRoute.
- Memória de longo prazo usando o módulo de memória do OmniRoute.
- Fazer o OmniRoute repassar `instructions` ao TTS da OpenAI, para a direção de estilo valer.
- Reconhecimento de fala pelo OmniRoute (`/v1/audio/transcriptions`) para funcionar fora do Chrome/Edge.
- Bot de Telegram reaproveitando `lib.mjs`.
