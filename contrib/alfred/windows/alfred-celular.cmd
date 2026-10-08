@echo off
rem Inicia o Alfred e cria um link https para usar no celular, com microfone.
rem Deixe esta janela aberta: fechar a janela desliga o Alfred e o link.
chcp 65001 >nul
title Alfred - link para o celular
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado.
  echo  Instale a versao LTS em https://nodejs.org  ou rode no terminal:
  echo      winget install OpenJS.NodeJS.LTS
  echo  Depois feche e abra esta janela de novo.
  echo.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)"
if errorlevel 1 (
  echo.
  echo  Seu Node.js e antigo. O Alfred precisa da versao 22 ou mais nova:
  echo      winget upgrade OpenJS.NodeJS.LTS
  echo.
  pause
  exit /b 1
)
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
node server.mjs --tunel %*
echo.
pause
