#!/usr/bin/env python3
"""Bounded, resumable HTTP transfer of an already authorised PDF; no access bypass."""
import argparse
import hashlib
import http.client
import json
import os
import re
import time
import urllib.request
from pathlib import Path


class TransferError(ValueError):
    """Safe diagnostic without URL, credentials or remote response body."""


def transfer(url, target, *, requests=8, seconds=45, timeout=5,
             max_bytes=1024 * 1024 * 1024, opener=urllib.request.urlopen):
    target = Path(target)
    part = target.with_name(target.name + '.part')
    meta = target.with_name(target.name + '.part.json')
    lock = target.with_name(target.name + '.download.lock')
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() or target.is_symlink():
        raise TransferError('Destination exists: choose a new name; nothing overwritten')
    if any(p.is_symlink() for p in (part, meta, lock)):
        raise TransferError('Refusing symlink checkpoint')
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    state = {'url_hash': hashlib.sha256(url.encode()).hexdigest(), 'total': None,
             'validator': None, 'validator_header': None}
    started = time.monotonic()
    attempts = 0
    error = None
    try:
        if part.exists() or meta.exists():
            if not (part.is_file() and meta.is_file()):
                raise TransferError('Incomplete checkpoint pair; preserve it and choose another name')
            old = json.loads(meta.read_text())
            if old.get('url_hash') != state['url_hash']:
                raise TransferError('Checkpoint belongs to another URL')
            state = old
        for _ in range(requests):
            if time.monotonic() - started >= seconds:
                break
            offset = part.stat().st_size if part.exists() else 0
            if state['total'] is not None and offset == state['total']:
                break
            if offset and not state['validator']:
                raise TransferError('Cannot safely resume: origin provided no entity validator')
            headers = {'Accept-Encoding': 'identity', 'User-Agent': 'VerifiedDocumentDownload/1.0'}
            if offset:
                headers.update({'Range': f'bytes={offset}-', 'If-Range': state['validator']})
            attempts += 1
            try:
                req = urllib.request.Request(url, headers=headers)
                with opener(req, timeout=min(timeout, max(0.1, seconds - (time.monotonic() - started)))) as response:
                    h = response.headers
                    if h.get('Content-Encoding', 'identity').lower() != 'identity':
                        raise TransferError('Encoded range response cannot be safely appended')
                    if 'application/pdf' not in h.get('Content-Type', '').lower():
                        raise TransferError('Origin did not return application/pdf')
                    etag = h.get('ETag')
                    validator = etag if etag and not etag.startswith('W/') else h.get('Last-Modified')
                    validator_header = 'ETag' if etag and not etag.startswith('W/') else 'Last-Modified'
                    if offset:
                        match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', h.get('Content-Range', ''))
                        if response.status != 206 or not match:
                            raise TransferError('Origin ignored Range; existing bytes preserved')
                        start, end, total = map(int, match.groups())
                        if start != offset or not start <= end < total:
                            raise TransferError('Unexpected Content-Range; existing bytes preserved')
                        if validator != state['validator'] or validator_header != state['validator_header']:
                            raise TransferError('Remote entity changed; existing bytes preserved')
                        if total != state['total']:
                            raise TransferError('Remote length changed; existing bytes preserved')
                        expected = end - start + 1
                        if h.get('Content-Length') and int(h['Content-Length']) != expected:
                            raise TransferError('Range length mismatch')
                    else:
                        if response.status != 200 or not h.get('Content-Length'):
                            raise TransferError('Expected 200 with Content-Length')
                        total = expected = int(h['Content-Length'])
                        state.update(total=total, validator=validator, validator_header=validator_header)
                    if total < 5 or total > max_bytes:
                        raise TransferError('Transfer size outside configured bounds')
                    meta.write_text(json.dumps(state))
                    received = 0
                    pending = b''
                    with part.open('ab') as stream:
                        while received < expected and time.monotonic() - started < seconds:
                            try:
                                chunk = response.read1(min(65536, expected - received))
                            except http.client.IncompleteRead as exc:
                                chunk = exc.partial
                            if not chunk:
                                break
                            if received + len(chunk) > expected:
                                raise TransferError('Response exceeds announced length')
                            received += len(chunk)
                            if not offset and stream.tell() == 0:
                                pending += chunk
                                if len(pending) < 5:
                                    continue
                                if not pending.startswith(b'%PDF-'):
                                    raise TransferError('Missing PDF signature; response not saved as PDF')
                                chunk, pending = pending, b''
                            stream.write(chunk)
                            stream.flush()
                    new_offset = part.stat().st_size
                    error = None if new_offset == total else 'Response ended before complete transfer'
                    if new_offset <= offset:
                        break
            except (OSError, http.client.HTTPException) as exc:
                error = type(exc).__name__  # No secret-bearing URLs or response bodies in diagnostics.
                if part.exists() and part.stat().st_size > offset:
                    continue
                break
        size = part.stat().st_size if part.exists() else 0
        if state['total'] is not None and size == state['total']:
            # Hard link is an exclusive publish: a concurrently created target is never replaced.
            os.link(part, target)
            part.unlink()
            meta.unlink()
            return {'status': 'transfer-complete', 'bytes': size, 'requests': attempts,
                    'file': str(target), 'complete_book': 'unknown'}
        return {'status': 'partial', 'bytes': size, 'expected_bytes': state['total'],
                'requests': attempts, 'part': str(part), 'error': error,
                'complete_book': 'unknown',
                'elapsed_seconds': round(time.monotonic() - started, 2)}
    finally:
        os.close(fd)
        lock.unlink()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url', required=True)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--requests', type=int, default=8)
    p.add_argument('--seconds', type=float, default=45)
    p.add_argument('--timeout', type=float, default=5)
    p.add_argument('--max-bytes', type=int, default=1024 * 1024 * 1024)
    a = p.parse_args()
    if not a.url.startswith(('https://', 'http://')) or min(a.requests, a.seconds, a.timeout, a.max_bytes) <= 0:
        p.error('Use HTTP(S) and positive limits')
    try:
        result = transfer(a.url, a.output, requests=a.requests, seconds=a.seconds,
                          timeout=a.timeout, max_bytes=a.max_bytes)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        reason = str(exc) if isinstance(exc, TransferError) else type(exc).__name__
        print(json.dumps({'status': 'failed', 'reason': reason, 'existing_files': 'preserved'}))
        return 1
    print(json.dumps(result))
    return 0 if result['status'] == 'transfer-complete' else 2


if __name__ == '__main__':
    raise SystemExit(main())
