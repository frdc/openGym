@echo off
cd /d "%~dp0..\.."
echo Editor do relogio: http://127.0.0.1:5178/tools/wear-layout/index.html
echo Mantenha esta janela aberta enquanto usar a previa.
node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5178 --strictPort
pause
