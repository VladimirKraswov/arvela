#!/bin/sh
# Run inside the NEW dedicated LXC; never on the Proxmox host or an inference VM.
set -eu
ip=${1:?IPv4 address required}
case "$ip" in *[!0-9.]*|'') exit 1;; esac
getent passwd enki-hub >/dev/null || useradd --system --home-dir /var/lib/enki-hub --shell /usr/sbin/nologin enki-hub
install -d -m 700 -o enki-hub -g enki-hub /var/lib/enki-hub /etc/enki-hub
if [ ! -f /etc/enki-hub/server.key ]; then
 openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 825 -subj '/CN=enki-hub.local' -addext "subjectAltName=DNS:enki-hub.local,IP:$ip" -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature,keyEncipherment' -addext 'extendedKeyUsage=serverAuth' -keyout /etc/enki-hub/server.key -out /etc/enki-hub/server.crt 2>/dev/null
 chown enki-hub:enki-hub /etc/enki-hub/server.*
 chmod 600 /etc/enki-hub/server.key
 chmod 644 /etc/enki-hub/server.crt
fi
install -m 644 /opt/enki-hub/deploy/enki-hub.service /opt/enki-hub/deploy/enki-hub-maintain.service /opt/enki-hub/deploy/enki-hub-maintain.timer /etc/systemd/system/
# Credential files are private bootstrap receipts; only token hashes enter SQLite.
if [ ! -f /etc/enki-hub/admin.json ]; then
 runuser -u enki-hub -- python3 /opt/enki-hub/server.py --data /var/lib/enki-hub --provision Owner --admin > /etc/enki-hub/admin.json
 chmod 600 /etc/enki-hub/admin.json
fi
if [ ! -f /etc/enki-hub/mac.json ]; then
 runuser -u enki-hub -- python3 /opt/enki-hub/server.py --data /var/lib/enki-hub --provision 'Mac' --platform macos > /etc/enki-hub/mac.json
 chmod 600 /etc/enki-hub/mac.json
fi
systemctl daemon-reload
systemctl enable --now enki-hub.service enki-hub-maintain.timer
systemctl restart enki-hub.service
