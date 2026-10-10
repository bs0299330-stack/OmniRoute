# Instala o Alfred neste PC (Windows) sem precisar de Git: baixa os arquivos do GitHub, instala o
# Node.js se faltar, cria o atalho "Alfred" na Area de Trabalho e abre o Alfred.
#
# Cole no PowerShell (uma linha so):
#   irm https://raw.githubusercontent.com/bs0299330-stack/OmniRoute/claude/alfred-virtual-assistant-awv48m/contrib/alfred/windows/instalar.ps1 | iex
#
# Rodar de novo atualiza os arquivos e mantem o seu alfred.env.
# Mensagens sem acento de proposito: o Windows PowerShell 5.1 pode embaralhar acentos.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # deixa o Invoke-WebRequest muito mais rapido no PS 5.1

$Branch = "claude/alfred-virtual-assistant-awv48m"
$Base = "https://raw.githubusercontent.com/bs0299330-stack/OmniRoute/$Branch/contrib/alfred"
$OnWindows = ($null -eq $IsWindows) -or $IsWindows # $IsWindows nao existe no PS 5.1 (so Windows)
$Dest = if ($env:ALFRED_INSTALL_DIR) { $env:ALFRED_INSTALL_DIR } else {
  Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Alfred"
}

# Mantenha em dia com a pasta contrib/alfred (um teste confere esta lista).
$Files = @(
  "README.md",
  "alfred.env.example",
  "brain.mjs",
  "cli.mjs",
  "lib.mjs",
  "server.mjs",
  "weblite.mjs",
  "public/clap.mjs",
  "public/frases/boa-noite.mp3",
  "public/frases/boa-tarde.mp3",
  "public/frases/bom-dia.mp3",
  "public/frases/momento.mp3",
  "public/hud.css",
  "public/hud.mjs",
  "public/index.html",
  "public/voice.mjs",
  "claude/build.mjs",
  "claude/index.html",
  "windows/alfred-celular.cmd",
  "windows/alfred-terminal.cmd",
  "windows/desligar-com-o-windows.cmd",
  "windows/diagnostico.cmd",
  "windows/iniciar-alfred.cmd",
  "windows/instalar.ps1",
  "windows/ligar-com-o-windows.cmd"
)

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }

# Grava NOME=valor no alfred.env: troca a linha que ja existe ou acrescenta no final.
# O valor precisa ser simples (letras, numeros, - _ . :), o que vale para chaves e modelos.
function Set-AlfredEnv($file, $name, $value) {
  if ($value -notmatch '^[A-Za-z0-9_.:\-]+$') { throw "valor invalido para $name" }
  $text = if (Test-Path $file) { [IO.File]::ReadAllText($file) } else { "" }
  $pattern = "(?m)^[ \t]*$name[ \t]*=.*$"
  if ($text -match $pattern) {
    $text = ([regex]$pattern).Replace($text, "$name=$value", 1)
  } else {
    if ($text -and -not $text.EndsWith("`n")) { $text += "`r`n" }
    $text += "$name=$value`r`n"
  }
  [IO.File]::WriteAllText($file, $text, (New-Object System.Text.UTF8Encoding $false))
}

function Get-AlfredEnv($file, $name) {
  if (-not (Test-Path $file)) { return "" }
  $m = [regex]::Match([IO.File]::ReadAllText($file), "(?m)^[ \t]*$name[ \t]*=[ \t]*(\S*)")
  if ($m.Success) { return $m.Groups[1].Value }
  return ""
}

Say ""
Say "  ALFRED - instalacao" "Yellow"
Say "  Pasta: $Dest"
Say ""

if ($PSVersionTable.PSVersion.Major -lt 6) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}

# 1. Arquivos
Say "  [1/3] Baixando os arquivos do Alfred..."
$Utf8 = New-Object System.Text.UTF8Encoding $false
foreach ($file in $Files) {
  $target = Join-Path $Dest ($file -replace "/", [IO.Path]::DirectorySeparatorChar)
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$file" -OutFile $target
  } catch {
    Say "  Nao consegui baixar $file. Confira a internet e rode de novo." "Red"
    Say "  Detalhe: $($_.Exception.Message)" "DarkGray"
    return
  }
  if ($file -like "*.cmd") {
    # O GitHub entrega os .cmd com quebra de linha LF; o cmd.exe prefere CRLF.
    $text = [IO.File]::ReadAllText($target) -replace "`r?`n", "`r`n"
    [IO.File]::WriteAllText($target, $text, $Utf8)
  }
}
Say "        $($Files.Count) arquivos prontos." "Green"

if (-not $OnWindows) {
  Say "  (fora do Windows: pulei Node.js, atalho e abertura)" "DarkGray"
  return
}

# 2. Node.js
Say "  [2/3] Conferindo o Node.js..."
function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $fallback = Join-Path $env:ProgramFiles "nodejs\node.exe"
  if (Test-Path $fallback) { return $fallback }
  return $null
}
$node = Find-Node
if (-not $node) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Say "        Instalando o Node.js (pode pedir permissao do Windows)..." "Yellow"
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    $node = Find-Node
  }
  if (-not $node) {
    Say "  Nao consegui instalar o Node.js sozinho." "Red"
    Say "  Baixe a versao LTS no site que vai abrir, instale e rode este comando de novo."
    Start-Process "https://nodejs.org/"
    return
  }
}
$major = [int]((& $node -p "process.versions.node.split('.')[0]") | Select-Object -First 1)
if ($major -lt 22) {
  Say "  Seu Node.js e antigo (versao $major). O Alfred precisa da 22 ou mais nova:" "Red"
  Say "      winget upgrade OpenJS.NodeJS.LTS"
  return
}
Say "        Node.js $major pronto." "Green"

# Cerebro: quem pensa pelo Alfred. Rodar o instalador de novo permite trocar.
$EnvFile = Join-Path $Dest "alfred.env"
if (-not (Test-Path $EnvFile)) { Copy-Item (Join-Path $Dest "alfred.env.example") $EnvFile }

function Find-Ollama {
  $cmd = Get-Command ollama -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $fallback = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
  if (Test-Path $fallback) { return $fallback }
  return $null
}

function Test-OllamaRunning {
  try { Invoke-RestMethod -Uri "http://localhost:11434/api/version" -TimeoutSec 3 | Out-Null; return $true } catch { return $false }
}

# 1) IA no PC: o Ollama roda um modelo aberto (Gemma 3) neste computador. Gratis, sem chave.
function Install-LocalBrain {
  $ollama = Find-Ollama
  if (-not $ollama) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      Say "        Instalando o Ollama (o programa que roda a IA no PC)..." "Yellow"
      winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
      $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
      $ollama = Find-Ollama
    }
    if (-not $ollama) {
      Say "  Nao consegui instalar o Ollama sozinho." "Red"
      Say "  Baixe no site que vai abrir, instale e rode este comando de novo."
      Start-Process "https://ollama.com/download"
      return
    }
  }
  if (-not (Test-OllamaRunning)) {
    $app = Join-Path (Split-Path $ollama) "ollama app.exe"
    if (Test-Path $app) { Start-Process $app } else { Start-Process $ollama -ArgumentList "serve" -WindowStyle Hidden }
    for ($i = 0; $i -lt 20 -and -not (Test-OllamaRunning); $i++) { Start-Sleep -Seconds 1 }
  }
  # Pouca memoria: o modelo menor (0,8 GB). Senao o de 4B (3,4 GB), bem melhor de conversa.
  $ramGB = 8
  try { $ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB) } catch {}
  $model = if ($ramGB -lt 8) { "gemma3:1b" } else { "gemma3:4b" }
  $size = if ($model -eq "gemma3:1b") { "0,8 GB" } else { "3,4 GB" }
  Say "        Baixando a IA $model ($size, so desta vez). Pode levar varios minutos..." "Yellow"
  & $ollama pull $model
  if ($LASTEXITCODE -ne 0) {
    Say "  O download da IA falhou. Confira a internet e rode este comando de novo." "Red"
    return
  }
  Set-AlfredEnv $EnvFile "ALFRED_LOCAL_MODEL" $model
  Set-AlfredEnv $EnvFile "ALFRED_BRAIN" "local"
  Say "        Pronto: o cerebro agora e a IA do seu PC (gratis, sem chave)." "Green"
}

# 2) Gemini do Google: gratis, com uma chave da conta Google.
function Set-GeminiBrain {
  if (-not (Get-AlfredEnv $EnvFile "GEMINI_API_KEY")) {
    Say "  Precisa de uma chave (gratis): entre com sua conta Google e clique em 'Create API key'."
    Start-Process "https://aistudio.google.com/apikey"
    $key = (Read-Host "  Cole a chave do Gemini (botao direito do mouse) e aperte Enter").Trim()
    if ($key -notmatch '^[A-Za-z0-9_.\-]{20,200}$') {
      Say "  Isso nao parece uma chave do Gemini. Rode o instalador de novo e cole a chave inteira." "Red"
      return
    }
    Set-AlfredEnv $EnvFile "GEMINI_API_KEY" $key
  }
  Set-AlfredEnv $EnvFile "ALFRED_BRAIN" "gemini"
  Say "        Pronto: o cerebro agora e o Gemini (gratis)." "Green"
}

# 3) Claude Code: usa o plano Pro ou Max da pessoa.
function Set-ClaudeBrain {
  $claudeExe = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
  if (-not ((Get-Command claude -ErrorAction SilentlyContinue) -or (Test-Path $claudeExe))) {
    try {
      Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
      Say "        Claude Code instalado. Falta entrar na sua conta (uma vez so):" "Green"
      Say "        abra um PowerShell NOVO, digite  claude  e siga o login no navegador."
    } catch {
      Say "  Nao consegui instalar o Claude Code: $($_.Exception.Message)" "Red"
      return
    }
  }
  Set-AlfredEnv $EnvFile "ALFRED_BRAIN" "claude"
  Say "        Pronto: o cerebro agora e o Claude." "Green"
}

$current = Get-AlfredEnv $EnvFile "ALFRED_BRAIN"
$names = @{ local = "IA do PC"; gemini = "Gemini"; claude = "Claude"; openai = "OpenAI"; omniroute = "OmniRoute" }
Say ""
Say "  Qual cerebro o Alfred vai usar?" "Yellow"
Say "    1) IA no seu PC   - gratis, sem chave e sem conta (download de 1 a 3 GB)"
Say "    2) Gemini         - gratis, precisa de uma chave da conta Google"
Say "    3) Claude Code    - usa o seu plano Pro ou Max"
$keep = if ($names[$current]) { "manter $($names[$current])" } else { "manter como esta" }
$choice = (Read-Host "  Digite 1, 2 ou 3 e aperte Enter (so Enter = $keep)").Trim()
switch ($choice) {
  "1" { Install-LocalBrain }
  "2" { Set-GeminiBrain }
  "3" { Set-ClaudeBrain }
}

# Voz do Fabio (ElevenLabs) em todas as respostas: fica para quando voce pedir. Ela precisa de
# plano pago no ElevenLabs. Uma chave colocada antes fica guardada, mas pausada (comentada), e o
# Alfred volta a voz de sempre. Para ligar depois: tire o "# " da linha no alfred.env.
if (Test-Path $EnvFile) {
  $envText = [IO.File]::ReadAllText($EnvFile)
  $paused = [regex]::Replace($envText, "(?m)^([ \t]*)ELEVENLABS_API_KEY[ \t]*=[ \t]*(\S+)", '$1# ELEVENLABS_API_KEY=$2')
  if ($paused -ne $envText) {
    [IO.File]::WriteAllText($EnvFile, $paused, (New-Object System.Text.UTF8Encoding $false))
    Say "        Voz do ElevenLabs pausada: o Alfred volta a voz de sempre (a chave ficou guardada)." "Green"
  }
}

# 3. Atalho e abertura
Say "  [3/3] Criando o atalho 'Alfred' na Area de Trabalho..."
$launcher = Join-Path $Dest "windows\iniciar-alfred.cmd"
try {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop "Alfred.lnk"))
  $shortcut.TargetPath = $launcher
  $shortcut.WorkingDirectory = $Dest
  $shortcut.Description = "Abrir o Alfred"
  $shortcut.Save()
  Say "        Atalho criado." "Green"
} catch {
  Say "        Nao consegui criar o atalho; use $launcher" "DarkGray"
}

Say ""
Say "  Pronto! Abrindo o Alfred..." "Yellow"
Say "  (Se o Alfred ja estava aberto, feche a janela preta antiga primeiro.)"
Say "  Da proxima vez, clique duas vezes no atalho 'Alfred' da Area de Trabalho."
Say "  Para a voz de IA, coloque sua chave em OPENAI_API_KEY no arquivo $Dest\alfred.env"
Say ""
Start-Process -FilePath $launcher -WorkingDirectory $Dest
