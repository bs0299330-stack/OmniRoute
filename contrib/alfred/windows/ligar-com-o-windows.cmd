@echo off
rem Faz o Alfred ligar sozinho, minimizado, sempre que voce entrar no Windows.
chcp 65001 >nul
cd /d "%~dp0.."
set "ALFRED_DIR=%CD%"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\Alfred.cmd" echo @echo off
>> "%STARTUP%\Alfred.cmd" echo cd /d "%ALFRED_DIR%"
>> "%STARTUP%\Alfred.cmd" echo start "Alfred" /min node server.mjs
echo.
echo  Pronto! O Alfred vai ligar sozinho quando voce entrar no Windows.
echo  Ele fica minimizado na barra de tarefas; o site e http://localhost:20140
echo  Para desfazer, rode desligar-com-o-windows.cmd
echo.
pause
