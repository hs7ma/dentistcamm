@echo off
chcp 65001 >nul
title DentistCam - تشغيل الواجهة

cd /d "%~dp0frontend"

REM ── تنصيب تلقائي إذا لم يكن مثبّتاً ─────
if not exist "node_modules" (
    echo [!] node_modules غير موجود — تنصيب تلقائي...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [خطأ] فشل التنصيب
        pause
        exit /b 1
    )
)

REM ── إنشاء .env من النموذج إذا لم يوجد ───
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [!] تم إنشاء .env من النموذج — افتحه وأضف مفتاح OpenAI
        notepad .env
    )
)

echo.
echo ═══════════════════════════════════════════════
echo   ✓ DentistCam — افتح المتصفح على:
echo     http://localhost:5173
echo ═══════════════════════════════════════════════
echo.

call npm run dev
