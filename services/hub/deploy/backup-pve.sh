#!/bin/sh
# Proxmox host only. Consistent SQLite snapshot; rotates ONLY its own seven copies.
set -eu
ct=${1:-206}
dest=${2:-/mnt/nas-storage/arvela-hub}
case "$ct" in *[!0-9]*|'') exit 1;; esac
[ -d /mnt/nas-storage ] && mountpoint -q /mnt/nas-storage
free=$(df -Pk /mnt/nas-storage | awk 'NR==2{print $4}')
[ "$free" -ge 2097152 ] || { echo 'Arvela backup skipped: NAS has less than2GiB free' >&2; exit 1; }
umask 077
mkdir -p "$dest/daily"
chmod 700 "$dest" "$dest/daily"
stage=$(mktemp -d /var/tmp/arvela-hub-backup.XXXXXX)
trap 'rm -rf "$stage"' EXIT
pct exec "$ct" -- runuser -u arvela-hub -- python3 /opt/arvela-hub/server.py --data /var/lib/arvela-hub --backup /var/lib/arvela-hub/snapshot.sqlite
pct exec "$ct" -- python3 -c 'import sqlite3; c=sqlite3.connect("/var/lib/arvela-hub/snapshot.sqlite"); assert c.execute("PRAGMA integrity_check").fetchone()[0]=="ok"; c.close()'
pct pull "$ct" /var/lib/arvela-hub/snapshot.sqlite "$stage/hub.sqlite"
pct exec "$ct" -- rm /var/lib/arvela-hub/snapshot.sqlite
stamp=$(date -u +%Y%m%dT%H%M%SZ)
(cd "$stage" && sha256sum hub.sqlite > SHA256SUMS && tar -czf snapshot.tgz hub.sqlite SHA256SUMS)
install -m 600 "$stage/snapshot.tgz" "$dest/daily/$stamp.tgz.partial"
cmp "$stage/snapshot.tgz" "$dest/daily/$stamp.tgz.partial"
mv "$dest/daily/$stamp.tgz.partial" "$dest/daily/$stamp.tgz"
# Names contain no whitespace; only archives produced by this script are eligible.
find "$dest/daily" -maxdepth 1 -type f -name '????????T??????Z.tgz' -printf '%f\n' | sort -r | tail -n +8 | while IFS= read -r old; do rm -- "$dest/daily/$old"; done
printf 'Arvela snapshot verified: %s\n' "$stamp"
