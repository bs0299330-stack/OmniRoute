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
(herda provedores, combos e fallback), senão a **IA do PC** pelo Ollama (grátis, sem chave), senão
o **Gemini** do Google (grátis, com
`GEMINI_API_KEY`), senão a **OpenAI** (com `OPENAI_API_KEY`), senão o **Claude**, pelo Claude
Code instalado no PC (`claude -p`, só com as ferramentas de ler a web).

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
| `diagnostico.cmd`            | Testa o cérebro, a voz e o microfone e diz exatamente o que falta     |

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
node contrib/alfred/cli.mjs --cerebro=claude # força o cérebro (local, gemini, claude, openai, omniroute)
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

## Trocar o cérebro (sem gastar o Claude)

Rode o instalador de novo (o comando do PowerShell acima). Ele pergunta:

```
  Qual cerebro o Alfred vai usar?
    1) IA no seu PC   - gratis, sem chave e sem conta (download de 1 a 3 GB)
    2) Gemini         - gratis, precisa de uma chave da conta Google
    3) Claude Code    - usa o seu plano Pro ou Max
```

Só Enter mantém o cérebro atual. A escolha fica gravada em `ALFRED_BRAIN` no `alfred.env`.

### 1) IA no seu PC (Ollama)

Grátis, **sem chave e sem conta**, e funciona até sem internet. O instalador instala o
[Ollama](https://ollama.com) pelo `winget` e baixa o modelo aberto **Gemma 3** do Google (fala
português): `gemma3:4b` (3,4 GB) ou, em PC com menos de 8 GB de memória, `gemma3:1b` (0,8 GB). O
download acontece só uma vez.

- O Ollama abre sozinho com o Windows (ícone de lhama perto do relógio). Se o Alfred disser que
  não conseguiu falar com a IA do PC, abra o **Ollama** pelo menu Iniciar.
- A primeira resposta depois de ligar o PC demora alguns segundos (o modelo carrega na memória).
  Em PC sem placa de vídeo boa, as respostas saem mais devagar que nas IAs da internet.
- É uma IA bem menor que o Claude: ótima para conversa e perguntas simples, mais fraca em
  raciocínio longo. Ela **não pesquisa na internet**.
- Outro modelo: `ollama pull <modelo>` no PowerShell e `ALFRED_LOCAL_MODEL=<modelo>` no
  `alfred.env`.

### 2) Gemini do Google

1. Entre em <https://aistudio.google.com/apikey> com a sua conta Google e clique em
   **Create API key** (Criar chave de API). Copie a chave.
2. Rode o instalador de novo e escolha **2**. Ele pergunta pela chave: cole com o botão direito do
   mouse e aperte Enter. Ele grava `GEMINI_API_KEY` e `ALFRED_BRAIN=gemini` no `alfred.env`.

Sem o instalador: abra `Documentos\Alfred\alfred.env` no Bloco de Notas, troque a linha
`ALFRED_BRAIN=auto` por `ALFRED_BRAIN=gemini`, coloque a chave em `GEMINI_API_KEY=` e reabra o
Alfred.

O modelo padrão é `gemini-flash-latest`, que sempre aponta para o Flash mais novo
(`ALFRED_GEMINI_MODEL` troca). **Limites:** o plano grátis tem um limite de perguntas por minuto e
por dia. Quando passa, o Alfred avisa e volta a funcionar sozinho depois. No plano grátis o Gemini
**não pesquisa na internet**: para cotações, notícias ou clima de agora, o Alfred diz que não
consegue ver. Para voltar ao Claude, troque para `ALFRED_BRAIN=claude`.

## Internet

O Alfred pesquisa e lê páginas na internet quando a pergunta envolve algo atual (notícias, preços,
clima, resultados, horários). Enquanto pesquisa, a tela mostra "Pesquisando: …" ou "Lendo
site.com", e o terminal mostra "🔎 …". Ele cita a fonte numa frase ("segundo o InfoMoney…"). A
lista de links aparece no histórico, clicável, mas não é lida em voz alta.

| Cérebro   | Como pesquisa                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------- |
| Claude    | Ferramentas **WebSearch** e **WebFetch** do Claude Code, as únicas liberadas (só leitura)        |
| OpenAI    | Modelo de pesquisa `gpt-5-search-api` (`ALFRED_OPENAI_SEARCH_MODEL`), que pesquisa a cada pergunta |
| OmniRoute | Escolha um modelo que pesquisa sozinho, por exemplo `ALFRED_MODEL=perplexity/sonar`             |
| Gemini    | Não pesquisa: a pesquisa do Google não faz parte do plano grátis                                |
| IA do PC  | Não pesquisa: responde só com o que o modelo já sabe                                            |

`ALFRED_WEB=full` (padrão) pesquisa e lê páginas; `search` só pesquisa; `off` desliga a internet.
**Cuidados:** cada pesquisa gasta um pouco mais do seu plano ou crédito, e respostas com pesquisa
levam de 10 a 30 segundos. Páginas da web podem trazer texto tentando dar ordens ao Alfred. Ele foi
instruído a tratar isso só como informação, e com o Claude ele não tem nenhuma ferramenta além de
ler a web (não mexe em arquivos nem roda comandos). Mesmo assim, não peça para ele abrir links em
que você não confia.

## Abre, mas não responde?

O Alfred precisa de **um cérebro**. Ao abrir, ele avisa quando nenhum está funcionando, e o
`diagnostico.cmd` (ou `node cli.mjs --diagnostico`, ou `/diagnostico` no terminal) testa cada um
de verdade. Escolha um:

1. **Claude** (plano Pro ou Max): no PowerShell, `irm https://claude.ai/install.ps1 | iex`. Depois
   abra um PowerShell novo, rode `claude` e faça o login uma vez. O Alfred encontra o Claude Code
   mesmo que o terminal ainda não o enxergue (`%USERPROFILE%\.local\bin\claude.exe`).
2. **OpenAI**: coloque `OPENAI_API_KEY=` no `alfred.env`.
3. **OmniRoute**: deixe o OmniRoute ligado.

Enquanto espera a resposta, o terminal mostra "pensando… Ns" (ou "🔎 Pesquisando: …"). Se ficar
90 segundos sem nenhum sinal, ele desiste e diz o motivo, em vez de ficar travado.

## Não abre?

| Sintoma                                              | Causa / solução                                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Não é possível acessar esse site" em `localhost`    | O servidor não está rodando **nesse aparelho**. `localhost` é sempre o próprio aparelho: rode o passo 3 no mesmo PC e mantenha o terminal aberto. |
| Abre no PC mas não no celular                        | Use `node contrib/alfred/server.mjs --tunel` e abra o link no celular. Veja "Falar com o Alfred pelo celular".                                    |
| `❌ A porta 20140 já está em uso`                     | Rode com outra porta: `ALFRED_PORT=20141 node contrib/alfred/server.mjs`.                                                                          |
| Página abre, mas responde "Não consegui falar com o OmniRoute" | Inicie o OmniRoute, ou use outro cérebro: `GEMINI_API_KEY` (grátis), `ALFRED_BRAIN=claude` (Claude Code) ou `OPENAI_API_KEY`. |
| "Não consegui falar com a IA do PC (Ollama)"         | Abra o **Ollama** pelo menu Iniciar e pergunte de novo.                                                                                            |
| "A IA do PC ainda não tem o modelo …"                | Rode no PowerShell o `ollama pull …` que a mensagem mostra.                                                                                        |
| "O Gemini atingiu o limite grátis"                   | Passou do limite do plano grátis. Espere um minuto, ou até o dia seguinte se foi o limite do dia.                                                  |
| "O Claude Code não está logado"                      | Rode `claude` uma vez no terminal e entre na sua conta.                                                                                            |
| "O OmniRoute respondeu com erro (401)"               | Crie uma chave no dashboard do OmniRoute e coloque em `OMNIROUTE_API_KEY`.                                                                           |
| Microfone não funciona                               | Use Chrome/Edge, em `localhost` ou https, e permita o microfone no cadeado da barra de endereço.                                                     |

### Só voz: o globo e nada mais

A página mostra **só o globo** (e a cidade ao fundo). Não há texto, campo de digitar nem botão de
microfone: tudo é por voz. Use o **Edge** ou o **Chrome** (Brave, Opera e Firefox não fazem
reconhecimento de voz).

| Ação                 | Como                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| **Chamar**           | Diga **"Alfred, …"** (por exemplo "Alfred, que horas são?") ou bata **duas palmas**    |
| Continuar            | Depois de chamar, só fale: a conversa segue sem repetir o nome                         |
| Encerrar             | Diga "tchau", "pode parar" ou "obrigado, Alfred"                                        |
| Interromper a fala   | **Esc**                                                                                 |
| Sem falar o nome     | Clique no globo (liga e desliga a conversa) ou segure **Espaço**, fale e solte          |
| Opções e histórico   | Tecla **M** ou **segurar o globo** abre o menu (voz, palmas, música, histórico com os links das fontes) |

- **O microfone fica sempre ligado**, esperando o nome "Alfred" ou duas palmas. Ele não responde à
  TV nem a quem conversa perto do PC, só a quem chama pelo nome. Depois de chamado, ele responde,
  ouve de novo e continua até você dizer "tchau" ou ficar cerca de 1 minuto em silêncio. Aí ele
  diz "Estarei por aqui, senhor" e volta a esperar o nome.
- Enquanto o Alfred fala, o microfone fica fechado para ele não ouvir a própria voz. Um bipe avisa
  quando é a sua vez.
- **O globo mostra o estado:** cinza esperando, amarelo ouvindo ou falando, pulsando ao pensar.
- **Avisos só quando algo dá errado:** se o microfone for bloqueado ou o servidor cair, uma linha
  discreta aparece embaixo e o Alfred fala o problema. Se a internet cair ou o microfone parar de
  responder, ele tenta de novo sozinho a cada 30 segundos.
- **Janela própria:** o `iniciar-alfred.cmd` abre o Alfred no Edge em uma janela só dele, sem abas
  nem barra de endereço, e já com o som liberado (perfil separado em
  `%LOCALAPPDATA%\Alfred\Edge`). Na primeira vez, o Edge pede o microfone: clique em **Permitir**.
  Aberto em outro navegador, ele pode pedir **um clique no globo** para ligar o som.

### Chamar com duas palmas

As palmas já vêm ligadas (dá para desligar no menu, tecla **M**). Com o Alfred parado, bata **duas
palmas seguidas**: toca a música de abertura e ele cumprimenta conforme a hora ("Bom dia / Boa
tarde / Boa noite, senhor. Em que posso ser útil?"). Depois é só falar.

- O detector roda no próprio PC, em `public/clap.mjs`, e nada do microfone é enviado. Ele só aceita
  duas batidas curtas e fortes, com 0,15 a 0,8 s entre elas e silêncio antes e depois. Fala, música,
  três palmas seguidas e digitação são ignoradas. Enquanto o Alfred ouve, pensa ou fala, as palmas
  ficam desligadas.
- **Música ao chamar:** antes do cumprimento, toca o **Tema do Alfred**, uma abertura original de
  cerca de 10 s, orquestral e sombria, composta na hora pelo navegador (`playGothamTheme` em `public/hud.mjs`). No
  menu, **Escolher música…** usa um arquivo seu (MP3 etc.), tocado por 8, 15, 30 s ou inteiro. O
  arquivo fica guardado só neste navegador. Um clique no globo ou Esc cortam a música.
- **Sensibilidade:** use *Baixa* em ambiente barulhento e *Alta* se as palmas forem fracas ou
  estiverem longe do microfone.
- Para já ligar tudo junto com o PC, rode `ligar-com-o-windows.cmd` e responda **S** para abrir o
  Alfred no Edge.

No **terminal**, o microfone precisa do `sox` e de `OPENAI_API_KEY` (para transcrever). Sem chave,
converse por voz pelo site.

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

### Frases gravadas (voz do Fabio)

As frases fixas do Alfred tocam gravadas, na voz **"Fabio Oliveira Deep Portuguese"** da biblioteca
de vozes do [ElevenLabs](https://elevenlabs.io), sem chave nenhuma no PC: os áudios ficam em
`public/frases/`. O resto (as respostas da IA) sai na voz configurada acima.

| Frase                                         | Quando                         | Arquivo               |
| --------------------------------------------- | ------------------------------ | --------------------- |
| "Bom dia / Boa tarde / Boa noite, senhor. Em que posso ser útil?" | duas palmas     | `bom-dia.mp3`, `boa-tarde.mp3`, `boa-noite.mp3` |
| "Um momento, senhor. Vou verificar."           | quando ele começa a pesquisar  | `momento.mp3`         |
| "Pois não, senhor?"                            | chamado só pelo nome           | (voz normal)          |
| "Às suas ordens, senhor."                      | "tchau"                        | (voz normal)          |
| "Estarei por aqui, senhor. É só chamar."       | fim da conversa por silêncio   | (voz normal)          |
| "Perdão, senhor. Não consegui responder agora." | erro                          | (voz normal)          |
| "Alfred a postos, senhor. É só me chamar."     | ao abrir                       | (voz normal)          |

Para gravar as outras: gere a frase no ElevenLabs, salve o MP3 em `public/frases/` com um nome
simples (letras minúsculas, números e hífen) e coloque esse caminho no `file` da frase em `PHRASES`
(`public/voice.mjs`). Em **Frases gravadas** (menu, tecla M) você desliga as gravações e volta tudo
para a voz normal.

**Licença dos áudios:** os arquivos de `public/frases/` **não** estão cobertos pela licença MIT do
repositório. Eles foram gerados no plano grátis do ElevenLabs com uma voz da Voice Library e valem
só para uso pessoal, não comercial, nos termos do ElevenLabs (com o crédito acima). Para qualquer
outro uso, gere os seus próprios áudios.

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
   globo (libera o som e o microfone) e fale, ou diga "Alfred, …". Para abrir o menu no celular,
   segure o dedo no globo.

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
| `ALFRED_BRAIN`         | `auto`                       | `omniroute`, `local` (Ollama), `gemini`, `openai` ou `claude` (Claude Code) |
| `ALFRED_LOCAL_MODEL`   | `gemma3:4b`                  | Modelo do Ollama quando o cérebro é `local`      |
| `ALFRED_LOCAL_URL`     | `http://localhost:11434/v1`  | Endpoint OpenAI-compatível do Ollama             |
| `GEMINI_API_KEY`       | —                            | Chave grátis do Gemini (aistudio.google.com/apikey) |
| `ALFRED_GEMINI_MODEL`  | `gemini-flash-latest`        | Modelo quando o cérebro é o Gemini (sem internet) |
| `ALFRED_CLAUDE_MODEL`  | —                            | Modelo do Claude Code (`sonnet`, `opus`…)        |
| `ALFRED_OPENAI_MODEL`  | `gpt-4o-mini`                | Modelo quando o cérebro é a OpenAI (sem internet) |
| `ALFRED_WEB`           | `full`                       | Internet: `full`, `search` ou `off`             |
| `ALFRED_OPENAI_SEARCH_MODEL` | `gpt-5-search-api`     | Modelo da OpenAI com pesquisa na web            |
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
Navegador (voz ⇄ texto)  ──POST /api/chat──▶  server.mjs  ──stream──▶  brain.mjs → OmniRoute | Ollama | Gemini | OpenAI | claude -p
          ▲                                       │
          ├────────── SSE {text} ◀────────────────┘
          └── POST /api/tts (um trecho) ──▶ server.mjs ──▶ OpenAI ou OmniRoute /audio/speech (opcional)
```

- `lib.mjs` — funções puras (config, prompt de sistema, validação, parser SSE, comando do Claude
  Code, argumentos do sox); testadas em `tests/unit/alfred-lib.test.ts` e `alfred-brain.test.ts`.
- `brain.mjs` — o cérebro: escolhe e conversa com OmniRoute, Ollama (IA do PC), Gemini, OpenAI ou Claude Code, em streaming.
  O texto do usuário vai para o `claude` só pelo stdin, nunca pela linha de comando.
- `cli.mjs` — o Alfred do terminal (voz, microfone com sox, modo conversa).
- `public/hud.css` + `public/hud.mjs` — o visual e o globo de ~700 partículas: gira devagar em
  espera, fica amarelo e "respira" ouvindo, gira em faixas processando e se agita com a voz
  falando (pelo volume real da voz de IA, ou pelas palavras da voz do navegador).
- `server.mjs` — HTTP: serve a página, valida, injeta o prompt de sistema e repassa o stream.
- `public/clap.mjs` — detector de duas palmas (testado com áudio sintético em
  `tests/unit/alfred-clap.test.ts`), rodando num AudioWorklet para ouvir mesmo com a aba em segundo
  plano.
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
