@echo off
rem Faz o Alfred ligar sozinho, minimizado, sempre que voce entrar no Windows.
chcp 65001 >nul
cd /d "%~dp0.."
set "ALFRED_DIR=%CD%"
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\Alfred.cmd" echo @echo off
rem Pastas com acento no nome foram gravadas em UTF-8: o Alfred.cmd le o resto do arquivo assim.
>> "%STARTUP%\Alfred.cmd" echo chcp 65001 ^>nul
>> "%STARTUP%\Alfred.cmd" echo cd /d "%ALFRED_DIR%"
>> "%STARTUP%\Alfred.cmd" echo start "Alfred" /min "%NODE%" server.mjs
echo.
choice /c SN /n /m " Abrir o Alfred no Edge sempre que o PC ligar? E o que deixa as palmas prontas. [S/N] "
if errorlevel 2 goto sem_navegador
>> "%STARTUP%\Alfred.cmd" echo ping -n 6 127.0.0.1 ^>nul
>> "%STARTUP%\Alfred.cmd" echo start "" msedge --app=http://localhost:20140/ --user-data-dir="%%LOCALAPPDATA%%\Alfred\Edge" --autoplay-policy=no-user-gesture-required --no-first-run --start-maximized
:sem_navegador
echo.
echo  Pronto! O Alfred vai ligar sozinho quando voce entrar no Windows.
echo  Ele fica minimizado na barra de tarefas; o site e http://localhost:20140
echo  Ele ja abre ouvindo: diga "Alfred, ..." ou bata duas palmas.
echo  Para desfazer, rode desligar-com-o-windows.cmd
echo.
pause
