@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem --- Node.js の存在チェック ---
where node >nul 2>nul
if errorlevel 1 (
    echo [エラー] Node.js が見つかりません。
    echo https://nodejs.org から LTS 版をインストールしてから再実行してください。
    pause
    exit /b 1
)

rem --- 依存パッケージがなければ自動インストール ---
if not exist node_modules (
    echo 初回セットアップ: 依存パッケージをインストールしています...
    call npm install
    if errorlevel 1 (
        echo [エラー] npm install に失敗しました。上のログを確認してください。
        pause
        exit /b 1
    )
)

echo アプリを起動しています...
call npm start
if errorlevel 1 pause
