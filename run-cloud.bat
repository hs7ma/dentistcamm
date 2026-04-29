@echo off
chcp 65001 >nul
title DentistCam - تشغيل السيرفر

cd /d "%~dp0"

REM ── تنصيب dependencies السيرفر ──────
if not exist "backend\node_modules" (
    echo [!] backend/node_modules غير موجود — تنصيب تلقائي...
    echo.
    cd backend
    call npm install
    if errorlevel 1 (
        echo.
        echo [خطأ] فشل تنصيب dependencies السيرفر
        pause
        exit /b 1
    )
    cd ..
)

REM ── بناء الواجهة ──────────────────────
if not exist "frontend\dist\index.html" (
    echo [!] الواجهة غير مبنية — بناء تلقائي...
    echo.
    cd frontend
    call npm install
    if errorlevel 1 (
        echo.
        echo [خطأ] فشل تنصيب dependencies الواجهة
        pause
        exit /b 1
    )
    call npm run build
    if errorlevel 1 (
        echo.
        echo [خطأ] فشل بناء الواجهة
        pause
        exit /b 1
    )
    cd ..
)

REM ── إنشاء .env من النموذج إذا لم يوجد ───
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [!] تم إنشاء .env من النموذج — افتحه وأضف المفاتيح
        notepad .env
    )
)

echo.
echo ═══════════════════════════════════════════════
echo   ✓ DentistCam Server — افتح المتصفح على:
echo     http://localhost:8000
echo.
echo   صيغة سحابية: ارفع على Railway
echo   صيغة محلية:  افتح http://localhost:5173
echo ═══════════════════════════════════════════════
echo.

cd backend
call npm start