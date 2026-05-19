@echo off
chcp 65001 >nul
title 打字比赛系统

cd /d "C:\Users\Administrator\Desktop\打字比赛网页系统"

echo.
echo ============================================
echo   南湾沙塘布学校 班级打字比赛系统
echo ============================================
echo.

echo [1/2] 检查依赖...
call npm install --silent 2>nul

echo [2/2] 启动服务...
echo.
echo  参赛端：http://localhost:3000/player.html
echo  管理端：http://localhost:3000/admin.html
echo  大屏页：http://localhost:3000/screen.html
echo.
echo  管理密码: admin123
echo.
echo  按 Ctrl+C 可停止服务
echo ============================================
echo.

node server.js

pause
