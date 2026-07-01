@echo off
echo ========================================
echo    AI Music Video Generator
echo ========================================
echo.
echo [1/3] 启动 Python 后端...
start "Music Video Backend" /D "%~dp0" cmd /k "npm run backend"

echo [2/3] 等待后端启动...
timeout /t 3 /nobreak > nul

echo [3/3] 启动前端开发服务器...
npm run dev
