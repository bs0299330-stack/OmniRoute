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
  "public/clap.mjs",
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
# O valor precisa ser simples (letras, numeros, - _ .), o que vale para as chaves de API.
function Set-AlfredEnv($file, $name, $value) {
  if ($value -notmatch '^[A-Za-z0-9_.\-]+$') { throw "valor invalido para $name" }
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

# Cerebro gratis: o Gemini do Google (nao gasta o plano do Claude).
$EnvFile = Join-Path $Dest "alfred.env"
if (-not (Test-Path $EnvFile)) { Copy-Item (Join-Path $Dest "alfred.env.example") $EnvFile }
$hasGemini = [bool](Get-AlfredEnv $EnvFile "GEMINI_API_KEY")
if (-not $hasGemini) {
  Say ""
  Say "  Cerebro gratis: o Gemini do Google responde sem gastar o seu plano do Claude." "Yellow"
  Say "  Precisa de uma chave (gratis): entre com sua conta Google e clique em 'Create API key'."
  $answer = Read-Host "  Abrir o site da chave agora? (S/N)"
  if ($answer -match "^[sSyY]") { Start-Process "https://aistudio.google.com/apikey" }
  $key = (Read-Host "  Cole a chave do Gemini (botao direito do mouse) e aperte Enter, ou so Enter para pular").Trim()
  if ($key -match '^[A-Za-z0-9_.\-]{20,200}$') {
    Set-AlfredEnv $EnvFile "GEMINI_API_KEY" $key
    Set-AlfredEnv $EnvFile "ALFRED_BRAIN" "gemini"
    $hasGemini = $true
    Say "        Pronto: o cerebro agora e o Gemini (gratis)." "Green"
  } elseif ($key) {
    Say "  Isso nao parece uma chave do Gemini. Rode o instalador de novo e cole a chave inteira." "Red"
  }
}

# Sem Gemini: o mais simples e o Claude Code deste PC.
$claudeExe = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
$hasClaude = (Get-Command claude -ErrorAction SilentlyContinue) -or (Test-Path $claudeExe)
if (-not $hasClaude -and -not $hasGemini) {
  Say ""
  Say "  O Alfred precisa de um 'cerebro'. O mais simples e o Claude Code (plano Pro ou Max)." "Yellow"
  $answer = Read-Host "  Instalar o Claude Code agora? (S/N)"
  if ($answer -match "^[sSyY]") {
    try {
      Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
      Say "        Claude Code instalado. Falta entrar na sua conta (uma vez so):" "Green"
      Say "        abra um PowerShell NOVO, digite  claude  e siga o login no navegador."
    } catch {
      Say "  Nao consegui instalar o Claude Code: $($_.Exception.Message)" "Red"
    }
  } else {
    Say "  Tudo bem. Outra opcao: coloque OPENAI_API_KEY no arquivo $Dest\alfred.env" "DarkGray"
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
