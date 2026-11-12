@echo off
rem Desfaz o ligar-com-o-windows.cmd.
chcp 65001 >nul
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%STARTUP%\Alfred.cmd" (
  del "%STARTUP%\Alfred.cmd"
  echo  O Alfred nao vai mais ligar sozinho com o Windows.
) else (
  echo  O Alfred nao estava configurado para ligar com o Windows.
)
pause
