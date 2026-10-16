@echo off
rem Inicia o Alfred e cria um link https para usar no celular, com microfone.
rem Deixe esta janela aberta: fechar a janela desliga o Alfred e o link.
chcp 65001 >nul
title Alfred - link para o celular
cd /d "%~dp0.."
rem --- Node.js: usa o do PATH ou o da pasta padrao; se faltar, tenta instalar com o winget ---
set "NODE=node"
where node >nul 2>nul
if not errorlevel 1 goto node_found
set "NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%NODE%" goto node_found
echo.
echo  O Node.js nao esta instalado. Vou tentar instalar agora (o Windows pode pedir permissao)...
echo.
where winget >nul 2>nul
if errorlevel 1 goto node_manual
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if exist "%NODE%" goto node_found
:node_manual
echo.
echo  Nao consegui instalar o Node.js sozinho.
echo  Baixe a versao LTS no site que vai abrir, instale e rode este atalho de novo.
echo.
start https://nodejs.org/
pause
exit /b 1
:node_found
"%NODE%" -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)"
if not errorlevel 1 goto node_ok
echo.
echo  Seu Node.js e antigo. O Alfred precisa da versao 22 ou mais nova:
echo      winget upgrade OpenJS.NodeJS.LTS
echo.
pause
exit /b 1
:node_ok
if not exist "alfred.env" copy "alfred.env.example" "alfred.env" >nul
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta o cloudflared, que cria o link para o celular. Instale com:
  echo      winget install Cloudflare.cloudflared
  echo  Depois feche e abra esta janela de novo.
  echo.
  pause
  exit /b 1
)
"%NODE%" server.mjs --tunel %*
echo.
pause
