#!/usr/bin/env bash
# Local Android release build for Tamzit News (תמצית החדשות).
#
#   scripts/build-android.sh [--no-bump] [--no-clean] [--upload]
#
#   --no-bump    keep android.versionCode in app.json as is (default: +1 before building)
#   --no-clean   run prebuild without --clean (reuses android/, faster; default: clean)
#   --upload     run scripts/upload-apk.sh on the result
#
# Output: dist/tamzit-<version>-<versionCode>.apk (signed with the release keystore).
# Signing material lives OUTSIDE git in $TAMZIT_SIGNING_DIR (default /home/user/.tamzit-signing).
# If it is missing, it is fetched from the private Supabase bucket `app-private`,
# or generated once and uploaded there (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
set -euo pipefail

BUMP=1 CLEAN=1 UPLOAD=0
for arg in "$@"; do
  case "$arg" in
    --no-bump) BUMP=0 ;;
    --no-clean) CLEAN=0 ;;
    --upload) UPLOAD=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -d /home/user ]; then DEFAULT_SIGNING_DIR=/home/user/.tamzit-signing; else DEFAULT_SIGNING_DIR="$HOME/.tamzit-signing"; fi
SIGNING_DIR="${TAMZIT_SIGNING_DIR:-$DEFAULT_SIGNING_DIR}"
KEYSTORE="$SIGNING_DIR/tamzit-release.jks"
KEYPROPS="$SIGNING_DIR/keystore.properties"
PRIVATE_BUCKET="app-private"
PRIVATE_PREFIX="android/signing"
DIST="$MOBILE_DIR/dist"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | sort -V | tail -1)"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31merror: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
command -v node >/dev/null || die "node not found"
command -v java >/dev/null || die "java not found (JDK 17+ required)"
JAVA_MAJOR="$(java -XshowSettings:properties -version 2>&1 | awk -F'= ' '/java.specification.version/ {print $2}')"
[ "${JAVA_MAJOR:-0}" -ge 17 ] || die "JDK 17+ required, found $JAVA_MAJOR"
[ -d "$ANDROID_HOME/platforms" ] || die "Android SDK not found at $ANDROID_HOME"
[ -n "$BUILD_TOOLS" ] || die "no build-tools in $ANDROID_HOME"

cd "$MOBILE_DIR"
[ -d node_modules ] || { log "node_modules missing: npm ci"; npm ci; }
mkdir -p "$DIST"
START=$(date +%s)

# ---------------------------------------------------------------- signing
supabase_ok() { [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; }
sb_curl() { curl -sS -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" "$@"; }

ensure_private_bucket() {
  local code
  code=$(sb_curl -o /dev/null -w '%{http_code}' "$SUPABASE_URL/storage/v1/bucket/$PRIVATE_BUCKET")
  if [ "$code" != 200 ]; then
    sb_curl -X POST "$SUPABASE_URL/storage/v1/bucket" -H 'Content-Type: application/json' \
      -d "{\"id\":\"$PRIVATE_BUCKET\",\"name\":\"$PRIVATE_BUCKET\",\"public\":false}" >/dev/null
  fi
  sb_curl "$SUPABASE_URL/storage/v1/bucket/$PRIVATE_BUCKET" | grep -q '"public":false' \
    || die "bucket $PRIVATE_BUCKET is missing or public"
}

ensure_keystore() {
  if [ -f "$KEYSTORE" ] && [ -f "$KEYPROPS" ]; then return; fi
  mkdir -p "$SIGNING_DIR" && chmod 700 "$SIGNING_DIR"
  if supabase_ok; then
    log "Keystore not found locally; trying $PRIVATE_BUCKET/$PRIVATE_PREFIX"
    local ok=1
    for f in tamzit-release.jks keystore.properties; do
      code=$(sb_curl -o "$SIGNING_DIR/$f.part" -w '%{http_code}' \
        "$SUPABASE_URL/storage/v1/object/authenticated/$PRIVATE_BUCKET/$PRIVATE_PREFIX/$f")
      if [ "$code" = 200 ]; then mv "$SIGNING_DIR/$f.part" "$SIGNING_DIR/$f"; else rm -f "$SIGNING_DIR/$f.part"; ok=0; fi
    done
    if [ $ok = 1 ]; then chmod 600 "$KEYSTORE" "$KEYPROPS"; echo "restored from Supabase"; return; fi
    if [ -f "$KEYSTORE" ] || [ -f "$KEYPROPS" ]; then die "partial signing material in $SIGNING_DIR; refusing to overwrite"; fi
  fi
  log "Generating a NEW release keystore in $SIGNING_DIR (alias tamzit)"
  local pass
  pass="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"
  [ ${#pass} -ge 32 ] || die "password generation failed"
  # PKCS12 keystores use one password for store and key.
  TAMZIT_KS_PASS="$pass" keytool -genkeypair -storetype PKCS12 -keystore "$KEYSTORE" \
    -alias tamzit -keyalg RSA -keysize 4096 -validity 10000 \
    -storepass:env TAMZIT_KS_PASS -keypass:env TAMZIT_KS_PASS \
    -dname "CN=Tamzit News, OU=Mobile, O=Lokchim Achrayut, C=IL" 2>&1 | grep -v 'Picked up' || true
  [ -s "$KEYSTORE" ] || die "keytool failed"
  : > "$KEYPROPS" && chmod 600 "$KEYPROPS"
  cat > "$KEYPROPS" <<EOF
# Tamzit release signing. Keep private. Backed up in Supabase bucket $PRIVATE_BUCKET/$PRIVATE_PREFIX.
storeFile=tamzit-release.jks
storePassword=$pass
keyAlias=tamzit
keyPassword=$pass
EOF
  chmod 600 "$KEYSTORE" "$KEYPROPS"
  if supabase_ok; then
    log "Backing up keystore to private bucket $PRIVATE_BUCKET"
    ensure_private_bucket
    for f in tamzit-release.jks keystore.properties; do
      code=$(sb_curl -o /dev/null -w '%{http_code}' -X POST -H 'x-upsert: false' \
        -H 'Content-Type: application/octet-stream' --data-binary "@$SIGNING_DIR/$f" \
        "$SUPABASE_URL/storage/v1/object/$PRIVATE_BUCKET/$PRIVATE_PREFIX/$f")
      [ "$code" = 200 ] || die "backup of $f failed (HTTP $code)"
    done
  else
    echo "WARNING: SUPABASE_* not set; keystore NOT backed up. Losing it means users must reinstall." >&2
  fi
}

prop() { grep -E "^$1=" "$KEYPROPS" | head -1 | cut -d= -f2-; }

log "Signing material"
ensure_keystore
export ORG_GRADLE_PROJECT_TAMZIT_UPLOAD_STORE_FILE="$SIGNING_DIR/$(prop storeFile)"
export ORG_GRADLE_PROJECT_TAMZIT_UPLOAD_STORE_PASSWORD="$(prop storePassword)"
export ORG_GRADLE_PROJECT_TAMZIT_UPLOAD_KEY_ALIAS="$(prop keyAlias)"
export ORG_GRADLE_PROJECT_TAMZIT_UPLOAD_KEY_PASSWORD="$(prop keyPassword)"
KS_SHA256="$(keytool -list -v -keystore "$ORG_GRADLE_PROJECT_TAMZIT_UPLOAD_STORE_FILE" \
  -storepass:env ORG_GRADLE_PROJECT_TAMZIT_UPLOAD_STORE_PASSWORD -alias "$ORG_GRADLE_PROJECT_TAMZIT_UPLOAD_KEY_ALIAS" 2>/dev/null \
  | awk '/SHA256:/ && !n {print $2; n=1}' | tr -d ':' | tr 'A-F' 'a-f')"
[ -n "$KS_SHA256" ] || die "cannot read keystore (wrong password?)"
echo "release cert SHA-256: $KS_SHA256"

# ---------------------------------------------------------------- version
if [ $BUMP = 1 ]; then
  node -e '
    const fs = require("fs"); const f = "app.json"; const s = fs.readFileSync(f, "utf8");
    const m = s.match(/"versionCode"\s*:\s*(\d+)/); if (!m) { console.error("no android.versionCode in app.json"); process.exit(1); }
    const next = Number(m[1]) + 1;
    fs.writeFileSync(f, s.replace(/("versionCode"\s*:\s*)\d+/, `$1${next}`));
    console.log(`versionCode ${m[1]} -> ${next}`);'
fi
read -r APP_VERSION VERSION_CODE < <(npx expo config --type public --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log(c.version, c.android.versionCode)})')
[ -n "${VERSION_CODE:-}" ] || die "could not read version from app config"
log "Building $APP_VERSION ($VERSION_CODE)"

# ---------------------------------------------------------------- prebuild
log "expo prebuild (android)"
PKG_SNAPSHOT="$(cat package.json)"
PREBUILD_ARGS=(--platform android --no-install)
[ $CLEAN = 1 ] && PREBUILD_ARGS+=(--clean)
CI=1 npx expo prebuild "${PREBUILD_ARGS[@]}"
# prebuild rewrites the "android"/"ios" npm scripts; put them back (package.json is not ours to change)
PKG_SNAPSHOT="$PKG_SNAPSHOT" node -e '
  const fs = require("fs"); const before = JSON.parse(process.env.PKG_SNAPSHOT);
  const cur = JSON.parse(fs.readFileSync("package.json", "utf8")); cur.scripts ??= {};
  for (const k of ["android", "ios"]) {
    const b = before.scripts?.[k];
    if (b === undefined) delete cur.scripts[k]; else cur.scripts[k] = b;
  }
  const same = JSON.stringify(cur) === JSON.stringify(before);
  fs.writeFileSync("package.json", same ? process.env.PKG_SNAPSHOT + (process.env.PKG_SNAPSHOT.endsWith("\n") ? "" : "\n") : JSON.stringify(cur, null, 2) + "\n");
  if (!same) console.warn("note: package.json differs from pre-prebuild snapshot beyond scripts (concurrent edit or prebuild dependency update)");'

# ---------------------------------------------------------------- native patches (android/ is generated)
log "Applying gradle tweaks + release signing"
set_prop() { # key value file
  if grep -qE "^$1=" "$3"; then sed -i "s|^$1=.*|$1=$2|" "$3"; return; fi
  if [ -n "$(tail -c1 "$3")" ]; then echo >> "$3"; fi  # generated file may lack a final newline
  printf '%s=%s\n' "$1" "$2" >> "$3"
}
GP=android/gradle.properties
set_prop org.gradle.jvmargs "-Xmx4g -XX:MaxMetaspaceSize=1g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8" $GP
set_prop kotlin.daemon.jvmargs "-Xmx2g" $GP
set_prop org.gradle.parallel true $GP
set_prop org.gradle.caching true $GP
set_prop org.gradle.workers.max "${TAMZIT_GRADLE_WORKERS:-4}" $GP
set_prop systemProp.org.gradle.internal.repository.max.retries 8 $GP
set_prop systemProp.org.gradle.internal.repository.initial.backoff 1500 $GP
grep -q '^reactNativeArchitectures=arm64-v8a,x86_64$' $GP || die "reactNativeArchitectures not restricted (expo-build-properties buildArchs?)"

# Maven Central rate-limits shared egress IPs (HTTP 429): resolve it via Google's official mirror.
cat > android/tamzit-maven-mirror.gradle <<'EOF'
def MIRROR = 'https://maven-central.storage-download.googleapis.com/maven2/'
def CENTRAL = ['https://repo.maven.apache.org/maven2', 'https://repo1.maven.org/maven2']
def rewrite = { RepositoryHandler repos ->
    repos.withType(MavenArtifactRepository).configureEach { repo ->
        if (CENTRAL.any { repo.url.toString().startsWith(it) }) { repo.url = MIRROR }
    }
}
beforeSettings { settings ->
    rewrite(settings.buildscript.repositories)
    rewrite(settings.pluginManagement.repositories)
    rewrite(settings.dependencyResolutionManagement.repositories)
    // the plugin portal redirects many artifacts to repo.maven.apache.org: try the mirror first
    def repos = settings.pluginManagement.repositories
    def m = repos.maven { url = MIRROR; name = 'MavenCentralMirror' }
    repos.remove(m); repos.addFirst(m)
    repos.gradlePluginPortal()
}
allprojects {
    rewrite(buildscript.repositories)
    rewrite(repositories)
}
EOF

node -e '
  const fs = require("fs"); const f = "android/app/build.gradle"; let s = fs.readFileSync(f, "utf8");
  if (!s.includes("TAMZIT_UPLOAD_STORE_FILE")) {
    const cfg = `signingConfigs {
        release {
            // Injected by scripts/build-android.sh (values from ORG_GRADLE_PROJECT_TAMZIT_* env vars)
            storeFile file(findProperty("TAMZIT_UPLOAD_STORE_FILE") ?: "tamzit-release-keystore-missing.jks")
            storePassword findProperty("TAMZIT_UPLOAD_STORE_PASSWORD")
            keyAlias findProperty("TAMZIT_UPLOAD_KEY_ALIAS")
            keyPassword findProperty("TAMZIT_UPLOAD_KEY_PASSWORD")
        }`;
    if (!/signingConfigs \{/.test(s)) throw new Error("signingConfigs block not found in app/build.gradle");
    s = s.replace(/signingConfigs \{/, cfg);
    const re = /(release \{[^{}]*?)signingConfig signingConfigs\.debug/;
    const bt = s.indexOf("buildTypes {");
    if (bt < 0) throw new Error("buildTypes block not found");
    const head = s.slice(0, bt), tail = s.slice(bt);
    if (!re.test(tail)) throw new Error("release buildType signingConfig not found");
    s = head + tail.replace(re, "$1signingConfig signingConfigs.release");
    fs.writeFileSync(f, s);
  }
  console.log("release signingConfig patched");'

# ---------------------------------------------------------------- gradle
log "gradle assembleRelease"
BUILD_LOG="$DIST/build-android.log"
if ! (cd android && ./gradlew --init-script tamzit-maven-mirror.gradle assembleRelease --console=plain) 2>&1 | tee "$BUILD_LOG"; then
  die "gradle failed (log: $BUILD_LOG)"
fi

APK_SRC=android/app/build/outputs/apk/release/app-release.apk
[ -f "$APK_SRC" ] || die "APK not found at $APK_SRC"

# ---------------------------------------------------------------- verify
log "Verifying APK"
CERT_SHA256="$("$BUILD_TOOLS/apksigner" verify --print-certs "$APK_SRC" 2>/dev/null \
  | awk -F': ' '/Signer #1 certificate SHA-256 digest/ {print $2}')"
"$BUILD_TOOLS/apksigner" verify "$APK_SRC" || die "apksigner verify failed"
[ "$CERT_SHA256" = "$KS_SHA256" ] || die "APK signed with $CERT_SHA256, expected release cert $KS_SHA256"
BADGING="$("$BUILD_TOOLS/aapt2" dump badging "$APK_SRC")"
grep -E "^package:|^native-code|^minSdkVersion|^targetSdkVersion|^application-label:" <<< "$BADGING" || true
echo "permissions: $(grep -oP "^uses-permission: name='android\.permission\.\K[A-Z_]+" <<< "$BADGING" | tr '\n' ' ')"
grep -q "name='il.org.tamzit.app' versionCode='$VERSION_CODE'" <<< "$BADGING" || die "unexpected package/versionCode"
grep -q "native-code: 'arm64-v8a' 'x86_64'" <<< "$BADGING" || die "unexpected ABIs"
if grep -q "application-debuggable" <<< "$BADGING"; then die "APK is debuggable"; fi
APK_LIST="$(unzip -l "$APK_SRC")"
grep -q 'assets/index.android.bundle' <<< "$APK_LIST" || die "JS bundle not embedded"
echo "JS bundle: $(awk '/assets\/index.android.bundle/ {print $1}' <<< "$APK_LIST") bytes (Hermes bytecode: $(unzip -p "$APK_SRC" assets/index.android.bundle | head -c 4 | od -An -tx1 | tr -d ' '))"

OUT="$DIST/tamzit-$APP_VERSION-$VERSION_CODE.apk"
cp "$APK_SRC" "$OUT"
END=$(date +%s)
log "Done in $(( (END - START) / 60 ))m$(( (END - START) % 60 ))s"
echo "APK:   $OUT"
echo "size:  $(du -h "$OUT" | cut -f1) ($(stat -c %s "$OUT") bytes)"
echo "cert:  $CERT_SHA256"

if [ $UPLOAD = 1 ]; then "$MOBILE_DIR/scripts/upload-apk.sh" "$OUT"; fi
