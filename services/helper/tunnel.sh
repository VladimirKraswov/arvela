#!/bin/sh
# Reconnect the private localhost helper tunnel if CT205 gets a new DHCP lease.
set -u
child=""
cleanup() { if [ -n "$child" ]; then kill "$child" 2>/dev/null || :; wait "$child" 2>/dev/null || :; fi; }
trap 'cleanup; exit 0' INT TERM HUP
while :; do
  ct_ip=$(/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=5 pve 'pct exec 205 -- hostname -I' 2>/dev/null | /usr/bin/awk '{print $1}')
  case "$ct_ip" in
    192.168.31.[0-9]*) ;;
    *) /bin/sleep 10; continue ;;
  esac
  /usr/bin/ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=25 -o ServerAliveCountMax=3 \
    -N -L "127.0.0.1:18107:$ct_ip:8080" pve &
  child=$!
  while kill -0 "$child" 2>/dev/null; do
    /bin/sleep 30
    next_ip=$(/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=5 pve 'pct exec 205 -- hostname -I' 2>/dev/null | /usr/bin/awk '{print $1}')
    if [ "$next_ip" != "$ct_ip" ]; then break; fi
  done
  cleanup
  child=""
  /bin/sleep 5
done
