@echo off
echo ========================================
echo    AI Music Video Generator
echo ========================================
echo.
echo [1/2] 启动 Python 后端...
start cmd /k "cd backend && pip install -r requirements.txt -q && python main.py"

echo [2/2] 等待后端启动...
timeout /t 3 /nobreak > nul

echo [3/3] 启动前端开发服务器...
npm run dev