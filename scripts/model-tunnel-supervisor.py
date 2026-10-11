#!/usr/bin/env python3
"""Supervise one owned SSH child and probe its actual HTTP forward, never inference."""
import argparse
import ipaddress
import json
import re
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone


def connection(config):
    host = config.get('ssh_host', '')
    if not isinstance(host, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,252}', host):
        raise ValueError('Use a configured SSH host alias.')
    forwards = config.get('forwards', [])
    if not isinstance(forwards, list) or not 1 <= len(forwards) <= 16:
        raise ValueError('Configure 1–16 loopback forwards.')
    ports = set()
    args = ['/usr/bin/ssh', '-n', '-N']
    for value in ['BatchMode=yes', 'ExitOnForwardFailure=yes', 'ConnectTimeout=10',
                  'ConnectionAttempts=1', 'ServerAliveInterval=10', 'ServerAliveCountMax=3',
                  'TCPKeepAlive=yes', 'StrictHostKeyChecking=yes', 'ControlMaster=no', 'ControlPath=none',
                  'ForkAfterAuthentication=no', 'PermitLocalCommand=no']:
        args += ['-o', value]
    for item in forwards:
        local, remote, target = item.get('local_port'), item.get('remote_port'), item.get('remote_host', '')
        if any(type(p) is not int or not 1 <= p <= 65535 for p in [local, remote]) or local in ports:
            raise ValueError('Forward ports must be unique, valid integers.')
        if not isinstance(target, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,252}', target):
            raise ValueError('Invalid remote host.')
        if ':' in target:
            target = '[' + str(ipaddress.IPv6Address(target)) + ']'
        ports.add(local)
        args += ['-L', '127.0.0.1:%d:%s:%d' % (local, target, remote)]
    args.append(host)
    health_port = config.get('health_port')
    path = config.get('health_path', '/health')
    if type(health_port) is not int or health_port not in ports:
        raise ValueError('Health port must belong to this tunnel.')
    if not isinstance(path, str) or len(path) > 512 or not re.fullmatch(r'/[A-Za-z0-9_./~-]*', path):
        raise ValueError('Health path must have no query or credentials.')
    return args, 'http://127.0.0.1:%d%s' % (health_port, path)


def reachable(url, timeout=5):
    # No environmental proxy or redirects: only this exact loopback endpoint.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(urllib.request.Request(url, method='GET'), timeout=timeout):
            return True
    except urllib.error.HTTPError:
        # Authentication, 503, etc. prove transport. Do not bounce SSH for server errors.
        return True
    except (OSError, urllib.error.URLError):
        return False


def terminate(child):
    if child.poll() is not None:
        return
    child.terminate()
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)


def supervise(args, url, stop, spawn=None, probe=reachable, interval=15, retry=10):
    spawn = spawn or (lambda: subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL))
    backoff = retry
    while not stop.is_set():
        child = spawn()
        failures = 0
        try:
            while not stop.wait(interval):
                if child.poll() is not None:
                    break
                healthy = probe(url)
                failures = 0 if healthy else failures + 1
                if healthy:
                    backoff = retry
                if failures >= 3:
                    print(datetime.now(timezone.utc).isoformat(), 'HTTP forward stalled; reconnecting owned SSH child.', flush=True)
                    break
        finally:
            terminate(child)
        if not stop.wait(backoff):
            backoff = min(60, backoff * 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', help='Private JSON configuration; no credentials')
    options = parser.parse_args()
    with open(options.config, encoding='utf-8') as file:
        args, url = connection(json.load(file))
    stop = threading.Event()
    for name in [signal.SIGINT, signal.SIGTERM]:
        signal.signal(name, lambda *_: stop.set())
    supervise(args, url, stop)


if __name__ == '__main__':
    main()
