#!/usr/bin/env bash
# Report which Tauri 2 build prerequisites are missing on this Linux host.
#
# Read-only on purpose: it prints the apt command instead of running it, so a build
# agent can stop cleanly at the system-package boundary instead of touching the
# machine. Exits 1 when something is missing.
set -uo pipefail

# pkg-config name -> Debian/Ubuntu development package providing it.
PKGS=(
  "glib-2.0:libglib2.0-dev"
  "gtk+-3.0:libgtk-3-dev"
  "gdk-3.0:libgtk-3-dev"
  "webkit2gtk-4.1:libwebkit2gtk-4.1-dev"
  "javascriptcoregtk-4.1:libwebkit2gtk-4.1-dev"
  "libsoup-3.0:libsoup-3.0-dev"
  "librsvg-2.0:librsvg2-dev"
  "openssl:libssl-dev"
)
# Optional: only needed for the tray/indicator and the `xdotool` based helpers.
OPTIONAL=(
  "ayatana-appindicator3-0.1:libayatana-appindicator3-dev"
  "xdo:libxdo-dev"
)

missing=()
optional_missing=()

check() {
  local entry=$1 store=$2
  local mod=${entry%%:*} pkg=${entry##*:}
  if pkg-config --exists "$mod" 2>/dev/null; then
    printf '  %-26s ok\n' "$mod"
  else
    printf '  %-26s MISSING (%s)\n' "$mod" "$pkg"
    if [ "$store" = required ]; then missing+=("$pkg"); else optional_missing+=("$pkg"); fi
  fi
}

if ! command -v pkg-config >/dev/null 2>&1; then
  echo "pkg-config is not installed."
  echo "  sudo apt install pkg-config build-essential"
  exit 1
fi

echo "Required Tauri 2 libraries:"
for entry in "${PKGS[@]}"; do check "$entry" required; done
echo "Optional:"
for entry in "${OPTIONAL[@]}"; do check "$entry" optional; done

echo
# Toolchains are reported separately: they are installed with rustup/nvm, not apt,
# and printing them in an `apt install` line would be actively wrong advice.
toolchain_missing=()
for tool in cargo rustc node npm; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '  %-26s %s\n' "$tool" "$("$tool" --version 2>&1 | head -1)"
  else
    printf '  %-26s MISSING\n' "$tool"
    toolchain_missing+=("$tool")
  fi
done

list() { printf '%s\n' "$@" | sort -u | tr '\n' ' '; }

echo
if [ ${#missing[@]} -gt 0 ]; then
  echo "Install the missing system packages, then re-run:"
  echo "  sudo apt install build-essential pkg-config $(list "${missing[@]}")"
fi
if [ ${#toolchain_missing[@]} -gt 0 ]; then
  echo "Missing toolchains: $(list "${toolchain_missing[@]}")"
  echo "  Rust:   https://rustup.rs        Node 24: https://github.com/nvm-sh/nvm"
  echo "  Do not install these from apt; the distribution versions are too old."
fi
if [ ${#optional_missing[@]} -gt 0 ]; then
  echo "Optional, only for a tray/indicator build:"
  echo "  sudo apt install $(list "${optional_missing[@]}")"
fi
if [ ${#missing[@]} -eq 0 ] && [ ${#toolchain_missing[@]} -eq 0 ]; then
  echo "All required prerequisites are present."
  exit 0
fi
exit 1
