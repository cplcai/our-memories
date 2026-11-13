@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 20 或更新版本，然后重新打开管理台。
  pause
  exit /b 1
)
if not exist ".tools\photo-processing\node_modules\sharp\package.json" goto install
if not exist ".tools\photo-processing\node_modules\busboy\package.json" goto install
if not exist ".tools\photo-processing\node_modules\fflate\package.json" goto install
goto launch
:install
echo 正在准备管理台组件，请稍候。
call npm install --prefix .tools/photo-processing --no-audit --no-fund sharp@0.35.5 busboy@1.6.0 fflate@0.8.2
if errorlevel 1 (
  echo 组件安装失败，请检查网络后重试。
  pause
  exit /b 1
)
:launch
node manager/server.cjs --open
if errorlevel 1 pause
endlocal
