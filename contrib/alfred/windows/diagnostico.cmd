@echo off
rem Testa o cerebro (Claude, OpenAI, OmniRoute), a voz e o microfone e diz o que falta.
chcp 65001 >nul
title Alfred - diagnostico
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
"%NODE%" cli.mjs --diagnostico %*
echo.
pause
