@echo off
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
set "CARGO_TARGET_DIR=D:\cargo-target\pluely"
cd /d "%~dp0"
npm run tauri dev
