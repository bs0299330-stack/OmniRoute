@echo off
rem Inicia o Alfred neste PC e abre o site no navegador. Clique duas vezes para rodar.
rem Deixe esta janela aberta: fechar a janela desliga o Alfred.
chcp 65001 >nul
title Alfred
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
start "" /b cmd /c "ping -n 4 127.0.0.1 >nul && start http://localhost:20140/"
node server.mjs %*
echo.
pause
