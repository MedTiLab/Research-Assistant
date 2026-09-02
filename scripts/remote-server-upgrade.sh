#!/usr/bin/env bash

# Install a signed MedHelp Linux release from app.medtimehelp.com.
# No source-control account or repository access is used.

set -Eeuo pipefail

INSTALL_ROOT="${MEDHELP_INSTALL_ROOT:-/opt/medhelp}"
RUN_USER="${MEDHELP_RUN_USER:-medhelp}"
SERVICE_NAME="${MEDHELP_SERVICE_NAME:-medhelp}"
HEALTH_URL="${MEDHELP_HEALTH_URL:-http://127.0.0.1:3001/health}"
HEALTH_ATTEMPTS="${MEDHELP_HEALTH_ATTEMPTS:-30}"
MANIFEST_URL="${MEDHELP_RELEASE_MANIFEST_URL:-https://app.medtimehelp.com/downloads/medhelp-server-release.json}"
PUBLIC_KEY="${MEDHELP_UPDATE_PUBLIC_KEY:-/etc/medhelp/update-ed25519-public.pem}"
UPDATER_INSTALL_PATH="${MEDHELP_UPDATER_INSTALL_PATH:-/usr/local/sbin/medhelp-upgrade}"
MAX_PACKAGE_BYTES="${MEDHELP_MAX_PACKAGE_BYTES:-1073741824}"
LOCK_PATH="${XDG_RUNTIME_DIR:-/tmp}/medhelp-remote-upgrade.lock"

say() { printf '[medhelp-upgrade] %s\n' "$*"; }
die() { printf '[medhelp-upgrade] error: %s\n' "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

as_app_user() {
  if [ "$(id -u)" -eq 0 ]; then
    runuser -u "$RUN_USER" -- "$@"
    return
  fi
  "$@"
}

restart_service() {
  [ -n "$SERVICE_NAME" ] || return 0
  systemctl restart "$SERVICE_NAME"
}

wait_for_health() {
  attempt=1
  while [ "$attempt" -le "$HEALTH_ATTEMPTS" ]; do
    if curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null; then
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  return 1
}

run_release_validation() {
  release_dir="$1"
  as_app_user npm --prefix "$release_dir" ci --include=dev --no-audit --no-fund
  as_app_user npm --prefix "$release_dir" run typecheck
  as_app_user npm --prefix "$release_dir" run build
}

need curl
need flock
need install
need node
need npm
need runuser
need sha256sum
need stat
need systemctl
need tar

[ "$(id -u)" -eq 0 ] || die "run this updater as root; app build commands are dropped to $RUN_USER"
id "$RUN_USER" >/dev/null 2>&1 || die "service user $RUN_USER does not exist"
[ -r "$PUBLIC_KEY" ] || die "trusted update public key is missing: $PUBLIC_KEY"

case "$(uname -m)" in
  x86_64|amd64) PLATFORM_KEY="linux-x64" ;;
  aarch64|arm64) PLATFORM_KEY="linux-arm64" ;;
  *) die "unsupported CPU architecture: $(uname -m)" ;;
esac

install -d -o "$RUN_USER" -g "$RUN_USER" "$INSTALL_ROOT" "$INSTALL_ROOT/releases"
exec 9>"$LOCK_PATH"
flock -n 9 || die "another MedHelp upgrade is already running"

STAGE_DIR="$(as_app_user mktemp -d "$INSTALL_ROOT/.upgrade.XXXXXX")"
MANIFEST_FILE="$STAGE_DIR/release.json"
PACKAGE_FILE="$STAGE_DIR/release.tar.gz"
ARCHIVE_LIST="$STAGE_DIR/archive.list"
ARCHIVE_VERBOSE="$STAGE_DIR/archive.verbose"
UNPACK_DIR="$STAGE_DIR/unpack"

cleanup() {
  if [ -d "$STAGE_DIR" ]; then
    rm -rf -- "$STAGE_DIR"
  fi
}
trap cleanup EXIT

say "downloading release manifest"
as_app_user curl -fL --retry 3 --retry-all-errors --connect-timeout 15 \
  -o "$MANIFEST_FILE" "$MANIFEST_URL"

IFS=$'\t' read -r VERSION PACKAGE_URL EXPECTED_BYTES EXPECTED_SHA SIGNATURE ALGORITHM < <(
  node - "$MANIFEST_FILE" "$PLATFORM_KEY" <<'NODE'
const fs = require('fs');
const [manifestPath, platformKey] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const item = payload?.update?.[platformKey];
const values = [
  payload?.version,
  item?.packageUrl,
  item?.bytes,
  item?.sha256,
  item?.signature,
  item?.signatureAlgorithm,
];
if (values.some((value) => value === undefined || value === null || value === '')) process.exit(2);
process.stdout.write(values.map(String).join('\t') + '\n');
NODE
) || die "release manifest is invalid or has no $PLATFORM_KEY package"

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] \
  || die "invalid release version: $VERSION"
[[ "$EXPECTED_BYTES" =~ ^[0-9]+$ ]] || die "invalid package byte count"
[ "$EXPECTED_BYTES" -gt 0 ] && [ "$EXPECTED_BYTES" -le "$MAX_PACKAGE_BYTES" ] \
  || die "package byte count is outside the allowed range"
[[ "$EXPECTED_SHA" =~ ^[a-f0-9]{64}$ ]] || die "invalid SHA-256 in manifest"
[ "$ALGORITHM" = "ed25519-sha256" ] || die "unsupported signature algorithm: $ALGORITHM"

node - "$MANIFEST_URL" "$PACKAGE_URL" <<'NODE' || die "package URL is not an allowed same-origin HTTPS download"
const [manifestUrl, packageUrl] = process.argv.slice(2);
const manifest = new URL(manifestUrl);
const pkg = new URL(packageUrl, manifest);
if (manifest.protocol !== 'https:' || pkg.protocol !== 'https:') process.exit(2);
if (manifest.origin !== pkg.origin) process.exit(3);
if (!pkg.pathname.startsWith('/downloads/') || !pkg.pathname.endsWith('.tar.gz')) process.exit(4);
NODE

CURRENT_LINK="$INSTALL_ROOT/current"
CURRENT_VERSION="0.0.0"
PREVIOUS_TARGET=""
if [ -L "$CURRENT_LINK" ]; then
  PREVIOUS_TARGET="$(readlink "$CURRENT_LINK")"
  if [ -r "$CURRENT_LINK/package.json" ]; then
    CURRENT_VERSION="$(node -p "require('$CURRENT_LINK/package.json').version")"
  fi
fi

node - "$CURRENT_VERSION" "$VERSION" <<'NODE' || {
const [current, target] = process.argv.slice(2);
const parse = (value) => value.split(/[.-]/).slice(0, 3).map(Number);
const left = parse(current);
const right = parse(target);
for (let index = 0; index < 3; index += 1) {
  if (right[index] > left[index]) process.exit(0);
  if (right[index] < left[index]) process.exit(1);
}
process.exit(1);
NODE
  say "already current or newer: installed $CURRENT_VERSION, published $VERSION"
  exit 0
}

say "downloading MedHelp $VERSION for $PLATFORM_KEY"
as_app_user curl -fL --retry 3 --retry-all-errors --connect-timeout 15 \
  -o "$PACKAGE_FILE" "$PACKAGE_URL"

ACTUAL_BYTES="$(stat -c '%s' "$PACKAGE_FILE")"
[ "$ACTUAL_BYTES" = "$EXPECTED_BYTES" ] \
  || die "package size mismatch: expected $EXPECTED_BYTES, got $ACTUAL_BYTES"
ACTUAL_SHA="$(sha256sum "$PACKAGE_FILE" | awk '{print $1}')"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] \
  || die "SHA-256 mismatch: expected $EXPECTED_SHA, got $ACTUAL_SHA"

node - "$PUBLIC_KEY" "$EXPECTED_SHA" "$SIGNATURE" <<'NODE' \
  || die "Ed25519 release signature verification failed"
const crypto = require('crypto');
const fs = require('fs');
const [keyPath, digest, signature] = process.argv.slice(2);
const valid = crypto.verify(
  null,
  Buffer.from(digest, 'hex'),
  fs.readFileSync(keyPath),
  Buffer.from(signature, 'base64'),
);
process.exit(valid ? 0 : 1);
NODE

tar -tzf "$PACKAGE_FILE" > "$ARCHIVE_LIST"
awk '
  /^\// { bad=1 }
  /(^|\/)\.\.($|\/)/ { bad=1 }
  END { exit bad ? 1 : 0 }
' "$ARCHIVE_LIST" || die "archive contains an unsafe path"
tar -tvzf "$PACKAGE_FILE" > "$ARCHIVE_VERBOSE"
awk '
  substr($0, 1, 1) == "l" { bad=1 }
  substr($0, 1, 1) == "h" { bad=1 }
  END { exit bad ? 1 : 0 }
' "$ARCHIVE_VERBOSE" || die "archive contains a symbolic or hard link"

as_app_user mkdir -p "$UNPACK_DIR"
as_app_user tar -xzf "$PACKAGE_FILE" -C "$UNPACK_DIR"

RELEASE_SOURCE="$UNPACK_DIR"
TOP_LEVEL_COUNT="$(find "$UNPACK_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"
if [ "$TOP_LEVEL_COUNT" = "1" ]; then
  ONLY_ENTRY="$(find "$UNPACK_DIR" -mindepth 1 -maxdepth 1 -print -quit)"
  if [ -d "$ONLY_ENTRY" ] && [ -f "$ONLY_ENTRY/package.json" ]; then
    RELEASE_SOURCE="$ONLY_ENTRY"
  fi
fi
[ -f "$RELEASE_SOURCE/package.json" ] || die "package.json is missing from release archive"
[ -f "$RELEASE_SOURCE/package-lock.json" ] || die "package-lock.json is missing from release archive"

PACKAGE_VERSION="$(node -p "require('$RELEASE_SOURCE/package.json').version")"
[ "$PACKAGE_VERSION" = "$VERSION" ] \
  || die "manifest version $VERSION does not match package version $PACKAGE_VERSION"

say "validating dependencies and production build"
run_release_validation "$RELEASE_SOURCE"

TARGET_DIR="$INSTALL_ROOT/releases/$VERSION"
[ ! -e "$TARGET_DIR" ] || die "release directory already exists: $TARGET_DIR"
as_app_user mv "$RELEASE_SOURCE" "$TARGET_DIR"

NEXT_LINK="$INSTALL_ROOT/.current-$VERSION"
as_app_user ln -s "releases/$VERSION" "$NEXT_LINK"
as_app_user mv -Tf "$NEXT_LINK" "$CURRENT_LINK"

rollback() {
  [ -n "$PREVIOUS_TARGET" ] || return 0
  say "rolling back current link to $PREVIOUS_TARGET"
  rollback_link="$INSTALL_ROOT/.current-rollback"
  rm -f -- "$rollback_link"
  as_app_user ln -s "$PREVIOUS_TARGET" "$rollback_link"
  as_app_user mv -Tf "$rollback_link" "$CURRENT_LINK"
  restart_service
}

if [ -n "$SERVICE_NAME" ]; then
  restart_service
  say "waiting for $HEALTH_URL"
  if ! wait_for_health; then
    rollback
    die "health check failed after $VERSION; previous release restored"
  fi
fi

if [ -n "$UPDATER_INSTALL_PATH" ]; then
  install -o root -g root -m 0755 \
    "$CURRENT_LINK/scripts/remote-server-upgrade.sh" "$UPDATER_INSTALL_PATH"
fi

say "upgrade complete: $CURRENT_VERSION -> $VERSION"
