@echo off
chcp 65001 >nul
title NERI LIVE - Inicializador
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo NERI LIVE precisa do Node.js instalado.
  echo Baixe a versao LTS em https://nodejs.org/
  echo Depois execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)
echo.
echo ===================================
echo            NERI LIVE
 echo ===================================
echo.
echo Iniciando o servidor local...
start "NERI LIVE - Servidor" cmd /k "node server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:4747"
echo.
echo NERI LIVE aberto no navegador.
echo Para encerrar, feche a janela NERI LIVE - Servidor.
exit /b 0
