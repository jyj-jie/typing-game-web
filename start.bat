@echo off
chcp 65001 >nul
title 打字比赛系统

cd /d "%~dp0"

echo.
echo ============================================
echo   南湾沙塘布学校 班级打字比赛系统
echo ============================================
echo.

echo [1/3] 检查 Node.js 版本...
node -e "var v=process.versions.node.split('.');if(+v[0]<14){console.log('ERROR: Node.js 版本过旧，需要 14+');process.exit(1)};console.log('Node.js ' + process.version + ' (' + process.arch + ') 就绪')" 2>nul
if %errorlevel% neq 0 (
  echo 未检测到 Node.js，请先安装 Node.js 14 或 16 LTS 版本。
  echo 32 位系统下载地址：https://nodejs.org/dist/v16.20.2/node-v16.20.2-x86.msi
  echo 64 位系统下载地址：https://nodejs.org/en/download
  pause
  exit /b 1
)

echo.
echo [2/3] 检查依赖...
call npm install 2>nul

echo.
echo [3/3] 启动服务...
echo.
echo  参赛端：http://localhost:3000/player.html
echo  管理端：http://localhost:3000/admin.html
echo  大屏页：http://localhost:3000/screen.html
echo.
echo  管理密码请设置环境变量 ADMIN_PASSWORD 或使用默认值
echo.
echo  按 Ctrl+C 可停止服务
echo ============================================
echo.

node server.js

pause
