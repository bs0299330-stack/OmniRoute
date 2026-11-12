# Prepara o Alfred para o celular, pelo Tailscale: um endereco https fixo que so os seus aparelhos
# abrem (funciona no Wi-Fi de casa e no 4G). Rode uma vez no notebook, depois do instalador:
#
#   irm https://raw.githubusercontent.com/bs0299330-stack/OmniRoute/claude/alfred-virtual-assistant-awv48m/contrib/alfred/windows/celular.ps1 | iex
#
# (ou clique duas vezes em windows\configurar-celular.cmd, na pasta do Alfred)
#
# O que ele faz:
#   1. instala o Tailscale, se faltar, e espera voce entrar na conta (pode ser a do Google)
#   2. liga o endereco https do Alfred no Tailscale (tailscale serve)
#   3. grava no alfred.env a senha do celular (ALFRED_TOKEN), o endereco (ALFRED_HOSTS) e o canal
#      dos avisos no celular (ALFRED_NTFY), sem mexer no resto
#   4. reabre o Alfred e mostra o link para abrir no celular (ja copiado)
# Rodar de novo mostra o mesmo link (a senha e o canal so sao criados na primeira vez).
# Mensagens sem acento de proposito: o Windows PowerShell 5.1 pode embaralhar acentos.

& {
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Dest = if ($env:ALFRED_INSTALL_DIR) { $env:ALFRED_INSTALL_DIR } else {
  Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Alfred"
}
$EnvFile = Join-Path $Dest "alfred.env"

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }
function Open-Link($url) { try { Start-Process $url } catch { Say "  Abra no navegador: $url" "Yellow" } }

function Set-AlfredEnv($file, $name, $value) {
  if ($value -notmatch '^[A-Za-z0-9_.:,\-]+$') { throw "valor invalido para $name" }
  $text = if (Test-Path $file) { [IO.File]::ReadAllText($file) } else { "" }
  $pattern = "(?m)^[ \t]*#?[ \t]*$name[ \t]*=.*$"
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
  if ($m.Success) { return $m.Groups[1].Value.Trim('"', "'") }
  return ""
}

# Letras e numeros faceis de ler e digitar no celular (sem 0/o, 1/l/i).
function New-Secret($groups) {
  $chars = "abcdefghjkmnpqrstuvwxyz23456789".ToCharArray()
  $bytes = New-Object byte[] ($groups * 4)
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $out = for ($g = 0; $g -lt $groups; $g++) {
    -join (0..3 | ForEach-Object { $chars[$bytes[$g * 4 + $_] % $chars.Length] })
  }
  return ($out -join "-")
}

Say ""
Say "  ALFRED NO CELULAR (Tailscale)" "Yellow"
Say ""

if (-not (Test-Path $EnvFile)) {
  Say "  Nao achei o Alfred em $Dest. Rode o instalador primeiro." "Red"
  return
}

# ---------- 1. Tailscale ----------
$Ts = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
if (-not (Test-Path $Ts)) {
  Say "  [1/4] Instalando o Tailscale (o Windows pode pedir permissao)..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install -e --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements | Out-Null
  }
  if (-not (Test-Path $Ts)) {
    Say "  Nao consegui instalar o Tailscale sozinho. Baixe no site que vai abrir, instale e rode isto de novo." "Red"
    Open-Link "https://tailscale.com/download/windows"
    return
  }
} else {
  Say "  [1/4] Tailscale ja instalado." "Green"
}

function Get-TsStatus {
  $ErrorActionPreference = "Continue" # o PowerShell 5.1 trata as mensagens do Tailscale como erro
  try { return (& $Ts status --json 2>$null | Out-String | ConvertFrom-Json) } catch { return $null }
}

# Roda o tailscale.exe escondido, abre no navegador o link que ele pedir (entrar na conta, ligar o
# https) e espera ele terminar. Devolve o codigo de saida, ou $null se passou do tempo.
function Invoke-Ts($arguments, $seconds, $hint) {
  $out = Join-Path $env:TEMP "alfred-tailscale.txt"
  Remove-Item "$out", "$out.err" -ErrorAction SilentlyContinue
  $opts = @{ FilePath = $Ts; ArgumentList = $arguments; RedirectStandardOutput = $out; RedirectStandardError = "$out.err"; PassThru = $true }
  if ($IsWindows -ne $false) { $opts.WindowStyle = "Hidden" } # ($IsWindows nao existe no PS 5.1)
  $p = Start-Process @opts
  $null = $p.Handle # sem isto, o PowerShell 5.1 pode perder o codigo de saida
  $opened = $false
  for ($i = 0; $i -lt $seconds; $i += 2) {
    if ($p.HasExited) { break }
    $text = (Get-Content "$out", "$out.err" -Raw -ErrorAction SilentlyContinue) -join " "
    $link = [regex]::Match("$text", "https://login\.tailscale\.com/\S+").Value
    if ($link -and -not $opened) {
      $opened = $true
      Say "  $hint" "Yellow"
      Open-Link $link
    }
    Start-Sleep -Seconds 2
  }
  if (-not $p.HasExited) {
    try { $p.Kill() } catch {}
    return $null
  }
  return $p.ExitCode
}

$status = Get-TsStatus
if (-not $status -or $status.BackendState -ne "Running") {
  Say ""
  Say "  Agora entre na sua conta do Tailscale (pode ser com a conta Google). Eu espero ate 5 minutos." "Yellow"
  $gui = Join-Path $env:ProgramFiles "Tailscale\tailscale-ipn.exe"
  if (Test-Path $gui) { try { Start-Process -FilePath $gui } catch {} }
  Invoke-Ts @("up") 300 "Abriu uma pagina no navegador: entre na conta e volte aqui." | Out-Null
  $status = Get-TsStatus
  if (-not $status -or $status.BackendState -ne "Running") {
    Say "  O Tailscale ainda nao entrou na conta. Abra o Tailscale pelo icone perto do relogio, entre e rode isto de novo." "Red"
    return
  }
}
$Name = "$($status.Self.DNSName)".TrimEnd(".").ToLower()
if ($Name -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+$') {
  Say "  O Tailscale nao deu um nome para este PC. Abra o painel do Tailscale e ligue o MagicDNS." "Red"
  Open-Link "https://login.tailscale.com/admin/dns"
  return
}
Say "        Este notebook no Tailscale: $Name" "Green"

# ---------- 2. Endereco https ----------
$Port = Get-AlfredEnv $EnvFile "ALFRED_PORT"
if ("$Port" -notmatch "^\d{2,5}$") { $Port = 20140 }
Say "  [2/4] Ligando o endereco https do Alfred..."
# Na primeira vez o Tailscale pede para ligar o https na sua conta: um clique na pagina que abre.
$code = Invoke-Ts @("serve", "--bg", "$Port") 180 "O Tailscale pediu para liberar o https: na pagina que abriu, clique em Enable / Ativar."
$served = ($code -eq 0)
if (-not $served) {
  Say "  Nao consegui ligar o endereco https. Rode isto de novo; se continuar, me mande o que apareceu acima." "Red"
  return
}
Say "        https://$Name -> Alfred (porta $Port)" "Green"

# ---------- 3. alfred.env ----------
Say "  [3/4] Guardando a senha do celular e o canal dos avisos..."
$Token = Get-AlfredEnv $EnvFile "ALFRED_TOKEN"
if (-not $Token) {
  $Token = New-Secret 4
  Set-AlfredEnv $EnvFile "ALFRED_TOKEN" $Token
}
$hosts = @((Get-AlfredEnv $EnvFile "ALFRED_HOSTS") -split "," | Where-Object { $_ })
if ($hosts -notcontains $Name) { Set-AlfredEnv $EnvFile "ALFRED_HOSTS" ((@($Name) + $hosts) -join ",") }
$Ntfy = Get-AlfredEnv $EnvFile "ALFRED_NTFY"
if (-not $Ntfy) {
  $Ntfy = "alfred-" + (New-Secret 5)
  Set-AlfredEnv $EnvFile "ALFRED_NTFY" $Ntfy
}
Say "        Pronto (fica so no alfred.env deste notebook)." "Green"

# ---------- 4. Reabrir o Alfred ----------
Say "  [4/4] Reabrindo o Alfred com as configuracoes novas..."
try {
  foreach ($conn in @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)"
    if ($proc -and $proc.Name -eq "node.exe" -and "$($proc.CommandLine)" -match "server\.mjs") {
      Stop-Process -Id $proc.ProcessId -Force
      Start-Sleep -Seconds 1
    }
  }
} catch {}
$launcher = Join-Path $Dest "windows\iniciar-alfred.cmd"
if (Test-Path $launcher) { try { Start-Process -FilePath $launcher -WorkingDirectory $Dest } catch {} }

$Link = "https://$Name/#token=$Token"
try { Set-Clipboard -Value $Link } catch {}
Say ""
Say "  PRONTO! Agora no celular (Android):" "Green"
Say ""
Say "   1. Instale o app Tailscale (Play Store) e entre na MESMA conta. Deixe ele ligado."
Say "   2. Abra este link no Chrome do celular (ele ja esta copiado: cole numa conversa"
Say "      sua no WhatsApp ou mande por e-mail para voce mesmo):"
Say ""
Say "      $Link" "Yellow"
Say ""
Say "      Se o Alfred pedir a senha, digite: $Token" "Yellow"
Say "   3. No Chrome, toque nos 3 pontinhos e em 'Adicionar a tela inicial' (ou 'Instalar app')."
Say "      Pronto: o Alfred vira um icone, como um aplicativo."
Say "   4. Avisos (lembretes, despertador, alertas do tempo) mesmo com o Alfred fechado:"
Say "      instale o app ntfy (Play Store) e, no Alfred do celular, abra o menu (botao no canto)"
Say "      e toque em 'Receber avisos no celular'."
Say ""
Say "  O notebook precisa ficar ligado com o Alfred aberto para o celular falar com ele."
Say ""
} # fim do & {
