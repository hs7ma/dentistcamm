#!/usr/bin/env bash
set -e

echo ""
echo "═══════════════════════════════════════════════"
echo "  DentistCam — التنصيب التلقائي (Linux/macOS)"
echo "═══════════════════════════════════════════════"
echo ""

# ── التحقق من وجود Node.js ─────────────────
if ! command -v node >/dev/null 2>&1; then
    echo "[خطأ] Node.js غير مثبّت!"
    echo "حمّله من: https://nodejs.org/"
    exit 1
fi

echo "[OK] Node.js $(node --version)"

# ── الانتقال لمجلد الواجهة ─────────────────
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/frontend" || { echo "[خطأ] لم يتم العثور على مجلد frontend"; exit 1; }

# ── نسخ .env من النموذج إن لم يوجد ─────────
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp ".env.example" ".env"
    echo "[OK] تم إنشاء .env من النموذج — عدّله بمفتاح OpenAI الخاص بك"
fi

# ── تنصيب الحزم ─────────────────────────────
echo ""
echo "[...] تنصيب الحزم (قد يستغرق دقيقتين)..."
npm install

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✓ التنصيب اكتمل بنجاح!"
echo "═══════════════════════════════════════════════"
echo ""
echo "لتشغيل الواجهة:"
echo "   cd frontend"
echo "   npm run dev"
echo ""
echo "ثم افتح: http://localhost:5173"
echo ""
