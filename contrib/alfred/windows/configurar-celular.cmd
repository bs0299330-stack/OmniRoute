@echo off
rem Prepara o Alfred para o celular (Tailscale). Clique duas vezes; rode uma vez so.
chcp 65001 >nul
title Alfred - celular
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0celular.ps1"
echo.
pause
