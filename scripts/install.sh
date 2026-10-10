#!/bin/sh
# Installs the Glade server on this machine, for use from a phone or another computer.
#
#   curl -fsSL https://github.com/berkinory/Glade/releases/latest/download/install.sh | sh
#
# Options: --version X.Y.Z  install that release instead of the latest
#          --lan            also accept devices on the local network (unencrypted)
#          --no-service     do not start Glade on boot
#          --update         update an existing install (what `glade update` runs)
#
# Everything lands in ~/.glade without root: the runtime in ~/.glade/remote/runtime, the `glade`
# command in ~/.glade/bin. The layout matches what the Glade desktop app installs over SSH, so the
# desktop reuses this install and this install reuses the desktop's.

set -eu

REPO="berkinory/Glade"
BASE="${GLADE_DOWNLOAD_BASE:-https://github.com/$REPO/releases}"
ROOT="$HOME/.glade/remote"
RUNTIMES="$ROOT/runtime"
BIN="$HOME/.glade/bin"

version="${GLADE_VERSION:-}"
lan=""
service="yes"
mode="install"
while [ $# -gt 0 ]; do
  case "$1" in
    --version) version="${2:-}"; shift ;;
    --version=*) version="${1#*=}" ;;
    --lan) lan="--lan" ;;
    --no-service) service="no" ;;
    --update) mode="update" ;;
    -h | --help) sed -n '2,13p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

# --- output -----------------------------------------------------------------------------------

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  tty="yes"
  B=$(printf '\033[1m'); D=$(printf '\033[2m'); C=$(printf '\033[36m')
  G=$(printf '\033[32m'); R=$(printf '\033[31m'); Y=$(printf '\033[33m'); N=$(printf '\033[0m')
else
  tty=""; B=""; D=""; C=""; G=""; R=""; Y=""; N=""
fi

say() { printf '  %s\n' "$*"; }
ok() {
  if [ -n "$tty" ]; then printf '\r\033[2K'; fi
  printf '  %s✓%s %s\n' "$G" "$N" "$*"
}
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
fail() {
  if [ -n "$tty" ]; then printf '\r\033[2K\033[?25h'; fi
  printf '  %s✗%s %s\n' "$R" "$N" "$*" >&2
  exit 1
}

# Draws one spinner frame; the caller loops while its own background job runs, so no extra
# spinner process exists.
frame=0
spin() {
  [ -n "$tty" ] || return 0
  case $((frame % 10)) in
    0) f="⠋" ;; 1) f="⠙" ;; 2) f="⠹" ;; 3) f="⠸" ;; 4) f="⠼" ;;
    5) f="⠴" ;; 6) f="⠦" ;; 7) f="⠧" ;; 8) f="⠇" ;; *) f="⠏" ;;
  esac
  frame=$((frame + 1))
  printf '\r\033[2K  %s%s%s %s' "$C" "$f" "$N" "$*"
}

# Runs a command in the background with a spinner, or plainly when output is not a terminal.
run() {
  label="$1"; shift
  if [ -z "$tty" ]; then
    say "$label…"
    "$@" >"$staging/step.log" 2>&1 || { cat "$staging/step.log" >&2; return 1; }
    return 0
  fi
  printf '\033[?25l'
  "$@" >"$staging/step.log" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do spin "$label…"; sleep 0.08; done
  printf '\033[?25h'
  wait "$pid" || { printf '\r\033[2K'; cat "$staging/step.log" >&2; return 1; }
}

printf '\n  %s◆%s %sglade%s %s\n\n' "$C" "$N" "$B" "$N" "${D}server installer$N"

# --- checks -----------------------------------------------------------------------------------

need() { command -v "$1" >/dev/null 2>&1; }

if need curl; then
  fetch() { curl -fsSL --proto "$proto" --tlsv1.2 --retry 3 -o "$2" "$1"; }
  final_url() { curl -fsSLI --proto "$proto" -o /dev/null -w '%{url_effective}' "$1"; }
elif need wget; then
  fetch() { wget -q -O "$2" "$1"; }
  final_url() { wget -S --spider "$1" 2>&1 | sed -n 's/^ *[Ll]ocation: *//p' | tail -n 1; }
else
  fail "Glade needs curl or wget to download itself."
fi
proto="=https"
case "$BASE" in http://*) proto="=http,https"; warn "Downloading over plain HTTP from $BASE" ;; esac

if need sha256sum; then
  digest() { sha256sum "$1" | cut -d' ' -f1; }
elif need shasum; then
  digest() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  fail "Glade needs sha256sum or shasum to verify the download."
fi
need tar || fail "Glade needs tar to unpack itself."

case "$(uname -s)" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) fail "Glade's server runs on Linux and macOS. On Windows, install the Glade app and turn on Remote access." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch="x64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *) fail "Glade's server does not run on $(uname -m)." ;;
esac
target="$os-$arch"

if [ "$os" = "linux" ]; then
  libc=$(getconf GNU_LIBC_VERSION 2>/dev/null | cut -d' ' -f2 || true)
  [ -n "$libc" ] || fail "Glade's server needs glibc; this system looks like musl (Alpine). Use a glibc distribution."
  major=${libc%%.*}; minor=${libc#*.}; minor=${minor%%.*}
  if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 31 ]; }; then
    fail "Glade's server needs glibc 2.31 or newer; this system has $libc."
  fi
fi

# --- install ----------------------------------------------------------------------------------

[ "$(id -u)" -eq 0 ] && warn "Running as root: agents started by Glade will have root access."

umask 077
mkdir -p "$RUNTIMES" "$BIN"
staging=$(mktemp -d "$RUNTIMES/.install.XXXXXX")
# The trap's last status becomes the script's, so it ends on a command that succeeds.
cleanup() {
  rm -rf "$staging"
  if [ -n "$tty" ]; then printf '\033[?25h'; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if [ -z "$version" ]; then
  case "$BASE" in https://github.com/*) ;; *) fail "Set --version when downloading from $BASE." ;; esac
  spin "Finding the latest release…"
  latest=$(final_url "$BASE/latest") || fail "Could not reach GitHub."
  version=${latest##*/v}
  case "$version" in [0-9]*) ;; *) fail "Could not find the latest Glade release." ;; esac
fi
version=${version#v}
name="glade-remote-server-$version-$target"
url="$BASE/download/v$version/$name.tar.gz"

spin "Checking Glade $version…"
fetch "$url.sha256" "$staging/sum" 2>/dev/null ||
  fail "Glade $version has no server for $target yet."
expected=$(cut -d' ' -f1 <"$staging/sum")
case "$expected" in
  *[!0-9a-f]* | "") fail "The published checksum for Glade $version is malformed." ;;
esac
[ ${#expected} -eq 64 ] || fail "The published checksum for Glade $version is malformed."
runtime="$name-$(printf '%.12s' "$expected")"

if [ -f "$RUNTIMES/$runtime/.glade-ready" ]; then
  ok "Glade $version is already installed"
else
  archive="$staging/bundle.tar.gz"
  if [ -n "$tty" ]; then
    printf '\033[?25l'
    fetch "$url" "$archive" 2>"$staging/fetch.log" &
    pid=$!
    while kill -0 "$pid" 2>/dev/null; do
      size=0
      [ -f "$archive" ] && size=$(($(wc -c <"$archive") / 1048576))
      spin "Downloading Glade $version ${D}${size} MB$N"
      sleep 0.08
    done
    printf '\033[?25h'
    wait "$pid" || { cat "$staging/fetch.log" >&2; fail "The download failed."; }
  else
    say "Downloading Glade $version…"
    fetch "$url" "$archive" || fail "The download failed."
  fi
  [ "$(digest "$archive")" = "$expected" ] || fail "The download does not match its published checksum."
  ok "Downloaded and verified ${D}sha256 $(printf '%.12s' "$expected")$N"

  mkdir "$staging/bundle"
  run "Unpacking" tar -xzf "$archive" -C "$staging/bundle" --strip-components=1 ||
    fail "Could not unpack Glade."
  rm -f "$archive"
  run "Checking it runs here" "$staging/bundle/bin/node" "$staging/bundle/dist/runtimeDependencySmoke.mjs" ||
    fail "Glade does not run on this system."
  touch "$staging/bundle/.glade-ready"
  rm -rf "${RUNTIMES:?}/$runtime"
  mv "$staging/bundle" "$RUNTIMES/$runtime"
  ok "Installed Glade $version ${D}$target$N"
fi

printf '%s\n' "$runtime" >"$ROOT/cli-runtime"

# The command resolves its runtime on every call: the desktop may later replace this build with a
# newer one and remove the old directory.
cat >"$BIN/glade" <<'SHIM'
#!/bin/sh
root="$HOME/.glade/remote/runtime"
runtime=$(cat "$HOME/.glade/remote/cli-runtime" 2>/dev/null || true)
if [ -z "$runtime" ] || [ ! -f "$root/$runtime/.glade-ready" ]; then
  runtime=""
  for dir in $(ls -t "$root" 2>/dev/null); do
    [ -f "$root/$dir/.glade-ready" ] && { runtime="$dir"; break; }
  done
fi
[ -n "$runtime" ] || { echo "glade: Glade is not installed. Reinstall it from https://github.com/berkinory/Glade" >&2; exit 1; }
exec "$root/$runtime/bin/node" "$root/$runtime/dist/glade.mjs" "$@"
SHIM
chmod 755 "$BIN/glade"
mkdir -p "$HOME/.local/bin"
ln -sf "$BIN/glade" "$HOME/.local/bin/glade"
glade="$BIN/glade"
# The installer draws its own header; the steps it runs continue under it.
export GLADE_NO_HEADER=1

if [ "$mode" = "update" ]; then
  if "$glade" status >/dev/null 2>&1; then "$glade" restart; fi
  printf '\n'
  say "${G}Glade is up to date.$N"
  printf '\n'
  exit 0
fi

if [ "$service" = "yes" ]; then
  "$glade" setup-service
else
  "$glade" start
fi
"$glade" remote on $lan

case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) warn "Add ~/.local/bin to your PATH to run ${C}glade$N from anywhere." ;;
esac
printf '\n'
if [ -n "$tty" ] && "$glade" status 2>/dev/null | grep -q "●.*://"; then
  # An expired or skipped code is not a failed install; `glade pair` makes a new one.
  "$glade" pair || true
  printf '\n'
else
  say "Pair a device with ${C}glade pair$N, or see everything with ${C}glade help$N."
  printf '\n'
fi
