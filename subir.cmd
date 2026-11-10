@echo off
rem Doble clic: pregunta que cambio y lo sube a GitHub. Tambien: subir.cmd "mensaje"
cd /d "%~dp0"

rem Al abrirlo desde el Explorador o desde otra app, Windows a veces no trae las carpetas de node, pnpm y git: se agregan.
set "PATH=%PATH%;%ProgramFiles%\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\pnpm;%ProgramFiles%\Git\cmd"

where node >nul 2>nul
if errorlevel 1 (
  echo No encuentro Node.js. Instalalo desde nodejs.org y vuelve a intentar.
  goto fin
)
if not exist "node_modules\tsx\dist\cli.mjs" (
  echo Faltan las dependencias. Abre una terminal en esta carpeta y corre: pnpm install
  goto fin
)

node "node_modules\tsx\dist\cli.mjs" "scripts\subir.ts" %*

:fin
echo.
pause
