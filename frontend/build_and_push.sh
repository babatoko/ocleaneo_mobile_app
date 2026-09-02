#!/usr/bin/env bash
# Build APK Ocleaneo + renommage versionné + push Telegram.
# Usage : ./build_and_push.sh
set -euo pipefail

FRONTEND=/home/martial/ocleaneo_mobile_app_github/frontend
ANDROID=$FRONTEND/android
APK_DIR=$ANDROID/app/build/outputs/apk/debug
CHAT_ID=1244541240

cd "$FRONTEND"
VITE_ODOO_API_URL=https://www.entretien-maconnais.fr/api/mobile \
VITE_DATA_PROVIDER=odoo \
  npm run build

npx cap sync android >/dev/null

cd "$ANDROID"
./gradlew assembleDebug >/dev/null

VERSION=$(grep -oE '"versionName": "[^"]+"' "$APK_DIR/output-metadata.json" | head -1 | cut -d'"' -f4)
VCODE=$(grep -oE '"versionCode": [0-9]+' "$APK_DIR/output-metadata.json" | head -1 | grep -oE '[0-9]+')
NEW_NAME="ocleaneo-mobile-${VERSION}.apk"
cp "$APK_DIR/app-debug.apk" "/tmp/$NEW_NAME"

echo "Built: $NEW_NAME (code $VCODE)"
echo "Push Telegram..."
# hermes n'est pas toujours dans le PATH d'un shell non-interactif (cron,
# CI, background) — on le résout explicitement.
HERMES_BIN="$(command -v hermes || echo "$HOME/.local/bin/hermes")"
"$HERMES_BIN" send -t telegram:$CHAT_ID "ocleaneo-mobile $VERSION (code $VCODE)

MEDIA:/tmp/$NEW_NAME" "${@:-}"
