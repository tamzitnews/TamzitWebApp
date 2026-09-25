#!/usr/bin/env bash
# Upload a built APK to the public Supabase bucket `app-builds`.
#
#   scripts/upload-apk.sh [path/to/tamzit-<version>-<versionCode>.apk]
#
# Default: newest dist/tamzit-*.apk. Uploads (upsert):
#   app-builds/android/tamzit-<version>-<versionCode>.apk   (versioned)
#   app-builds/android/tamzit-latest.apk                     (short cache)
#   app-builds/android/latest.json                           (version, versionCode, size, sha256, urls)
# and prints the public URLs. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
set -euo pipefail

BUCKET="app-builds"
PREFIX="android"
MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
die() { printf '\033[1;31merror: %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || die "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set"
SUPABASE_URL="${SUPABASE_URL%/}"

APK="${1:-$(ls -t "$MOBILE_DIR"/dist/tamzit-*.apk 2>/dev/null | head -1 || true)}"
[ -n "$APK" ] && [ -f "$APK" ] || die "no APK found (build first: scripts/build-android.sh)"
NAME="$(basename "$APK")"
[[ "$NAME" =~ ^tamzit-(.+)-([0-9]+)\.apk$ ]] || die "unexpected file name $NAME (want tamzit-<version>-<versionCode>.apk)"
VERSION="${BASH_REMATCH[1]}" VERSION_CODE="${BASH_REMATCH[2]}"
SIZE="$(stat -c %s "$APK")"
SHA256="$(sha256sum "$APK" | cut -d' ' -f1)"

sb_curl() { curl -sS -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" "$@"; }

# bucket (public) — create if missing
code=$(sb_curl -o /dev/null -w '%{http_code}' "$SUPABASE_URL/storage/v1/bucket/$BUCKET")
if [ "$code" != 200 ]; then
  echo "creating public bucket $BUCKET"
  sb_curl -X POST "$SUPABASE_URL/storage/v1/bucket" -H 'Content-Type: application/json' \
    -d "{\"id\":\"$BUCKET\",\"name\":\"$BUCKET\",\"public\":true}" >/dev/null
fi

upload() { # local-file object-path content-type max-age
  local out code
  out="$(mktemp)"
  code=$(sb_curl -o "$out" -w '%{http_code}' -X POST \
    -H "x-upsert: true" -H "Content-Type: $3" -H "cache-control: max-age=$4" \
    --data-binary "@$1" "$SUPABASE_URL/storage/v1/object/$BUCKET/$2")
  if [ "$code" != 200 ]; then
    cat "$out" >&2; rm -f "$out"
    die "upload of $2 failed (HTTP $code)"
  fi
  rm -f "$out"
}

PUBLIC="$SUPABASE_URL/storage/v1/object/public/$BUCKET/$PREFIX"
APK_TYPE="application/vnd.android.package-archive"
echo "uploading $NAME ($(( SIZE / 1024 / 1024 )) MB)"
upload "$APK" "$PREFIX/$NAME" "$APK_TYPE" 31536000
upload "$APK" "$PREFIX/tamzit-latest.apk" "$APK_TYPE" 60

META="$(mktemp)"
cat > "$META" <<EOF
{
  "version": "$VERSION",
  "versionCode": $VERSION_CODE,
  "size": $SIZE,
  "sha256": "$SHA256",
  "url": "$PUBLIC/$NAME",
  "latestUrl": "$PUBLIC/tamzit-latest.apk",
  "builtAt": "$(date -u -r "$APK" +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
upload "$META" "$PREFIX/latest.json" "application/json" 60
rm -f "$META"

# verify the public copies are served with the right size and type
for obj in "$NAME" tamzit-latest.apk; do
  hdr="$(curl -sSI "$PUBLIC/$obj")"
  grep -qi "^content-length: $SIZE" <<< "$hdr" || die "public $obj has unexpected size"
  grep -qi "^content-type: $APK_TYPE" <<< "$hdr" || die "public $obj has unexpected content-type"
done

echo "versioned: $PUBLIC/$NAME"
echo "latest:    $PUBLIC/tamzit-latest.apk"
echo "metadata:  $PUBLIC/latest.json"
echo "sha256:    $SHA256"
