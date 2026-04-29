#!/usr/bin/env bash
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/frontend"

# ── تنصيب تلقائي إذا لم يكن مثبّتاً ─────
if [ ! -d "node_modules" ]; then
    echo "[!] node_modules غير موجود — تنصيب تلقائي..."
    echo ""
    npm install
fi

# ── إنشاء .env من النموذج إذا لم يوجد ───
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp ".env.example" ".env"
    echo "[!] تم إنشاء .env من النموذج — افتحه وأضف مفتاح OpenAI"
    ${EDITOR:-nano} .env
fi

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✓ DentistCam — افتح المتصفح على:"
echo "    http://localhost:5173"
echo "═══════════════════════════════════════════════"
echo ""

npm run dev
