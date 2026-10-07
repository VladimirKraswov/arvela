#!/bin/sh
# Run inside the NEW dedicated LXC; never on the Proxmox host or an inference VM.
set -eu
ip=${1:?IPv4 address required}
case "$ip" in *[!0-9.]*|'') exit 1;; esac
getent passwd arvela-hub >/dev/null || useradd --system --home-dir /var/lib/arvela-hub --shell /usr/sbin/nologin arvela-hub
install -d -m 700 -o arvela-hub -g arvela-hub /var/lib/arvela-hub /etc/arvela-hub
if [ ! -f /etc/arvela-hub/server.key ]; then
 openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 825 -subj '/CN=arvela-hub.local' -addext "subjectAltName=DNS:arvela-hub.local,IP:$ip" -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature,keyEncipherment' -addext 'extendedKeyUsage=serverAuth' -keyout /etc/arvela-hub/server.key -out /etc/arvela-hub/server.crt 2>/dev/null
 chown arvela-hub:arvela-hub /etc/arvela-hub/server.*
 chmod 600 /etc/arvela-hub/server.key
 chmod 644 /etc/arvela-hub/server.crt
fi
install -m 644 /opt/arvela-hub/deploy/arvela-hub.service /opt/arvela-hub/deploy/arvela-hub-maintain.service /opt/arvela-hub/deploy/arvela-hub-maintain.timer /etc/systemd/system/
# Credential files are private bootstrap receipts; only token hashes enter SQLite.
if [ ! -f /etc/arvela-hub/admin.json ]; then
 runuser -u arvela-hub -- python3 /opt/arvela-hub/server.py --data /var/lib/arvela-hub --provision Owner --admin > /etc/arvela-hub/admin.json
 chmod 600 /etc/arvela-hub/admin.json
fi
if [ ! -f /etc/arvela-hub/mac.json ]; then
 runuser -u arvela-hub -- python3 /opt/arvela-hub/server.py --data /var/lib/arvela-hub --provision 'Mac' --platform macos > /etc/arvela-hub/mac.json
 chmod 600 /etc/arvela-hub/mac.json
fi
systemctl daemon-reload
systemctl enable --now arvela-hub.service arvela-hub-maintain.timer
systemctl restart arvela-hub.service
