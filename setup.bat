@echo off
chcp 65001 >nul
echo.
echo ═══════════════════════════════════════════════
echo   DentistCam — التنصيب التلقائي (Windows)
echo ═══════════════════════════════════════════════
echo.

REM ── التحقق من وجود Node.js ─────────────────
where node >nul 2>nul
if errorlevel 1 (
    echo [خطأ] Node.js غير مثبّت!
    echo حمّله من: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do echo [OK] Node.js %%i

REM ── الانتقال لمجلد الواجهة ─────────────────
cd /d "%~dp0frontend" || (
    echo [خطأ] لم يتم العثور على مجلد frontend
    pause
    exit /b 1
)

REM ── نسخ .env من النموذج إن لم يوجد ─────────
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [OK] تم إنشاء .env من النموذج — عدّله بمفتاح OpenAI الخاص بك
    )
)

REM ── تنصيب الحزم ─────────────────────────────
echo.
echo [...] تنصيب الحزم (قد يستغرق دقيقتين)...
call npm install
if errorlevel 1 (
    echo [خطأ] فشل npm install
    pause
    exit /b 1
)

echo.
echo ═══════════════════════════════════════════════
echo   ✓ التنصيب اكتمل بنجاح!
echo ═══════════════════════════════════════════════
echo.
echo لتشغيل الواجهة:
echo    cd frontend
echo    npm run dev
echo.
echo ثم افتح: http://localhost:5173
echo.
pause
