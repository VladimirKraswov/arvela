#!/usr/bin/env python3
"""Offline transfer regressions with synthetic response streams; no book/network access."""
import importlib.util
import io
import sys
sys.dont_write_bytecode = True
import tempfile
import unittest
from pathlib import Path

script = Path(__file__).resolve().parents[1] / 'src-tauri/resources/skills/web-file-download/scripts/download.py'
spec = importlib.util.spec_from_file_location('download', script)
download = importlib.util.module_from_spec(spec)
spec.loader.exec_module(download)
DATA = b'%PDF-1.4\n' + b'synthetic testing bytes' * 100


class Response(io.BytesIO):
    def __init__(self, data, status=200, **headers):
        super().__init__(data)
        self.status = status
        self.headers = {'Content-Type': 'application/pdf', 'ETag': '"v1"', **headers}


class Transfer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dest = Path(self.tmp.name) / 'fixture.pdf'

    def test_interrupted_response_resumes_exact_bytes(self):
        calls = []
        def origin(req, timeout):
            calls.append(dict(req.header_items()))
            if len(calls) == 1:
                return Response(DATA[:43], **{'Content-Length': str(len(DATA))})
            self.assertEqual(req.get_header('Range'), 'bytes=43-')
            self.assertEqual(req.get_header('If-range'), '"v1"')
            return Response(DATA[43:], status=206, **{'Content-Range': f'bytes 43-{len(DATA)-1}/{len(DATA)}', 'Content-Length': str(len(DATA)-43)})
        result = download.transfer('https://fixture.invalid/book', self.dest, opener=origin)
        self.assertEqual(result['status'], 'transfer-complete')
        self.assertEqual(result['complete_book'], 'unknown')
        self.assertEqual(self.dest.read_bytes(), DATA)
        self.assertFalse(self.dest.with_name(self.dest.name+'.part').exists())

    def partial(self):
        r=download.transfer('https://fixture.invalid/book', self.dest, requests=1,
                            opener=lambda *a, **kw: Response(DATA[:43], **{'Content-Length': str(len(DATA))}))
        self.assertEqual(r['status'], 'partial')
        return self.dest.with_name(self.dest.name+'.part')

    def test_resume_across_invocations_and_request_budget(self):
        part=self.partial()
        self.assertEqual(part.read_bytes(), DATA[:43])
        def origin(req, timeout):
            start=int(req.get_header('Range').split('=')[1].split('-')[0])
            return Response(DATA[start:start+10],status=206,**{'Content-Range':f'bytes {start}-{len(DATA)-1}/{len(DATA)}'})
        r=download.transfer('https://fixture.invalid/book',self.dest,requests=2,opener=origin)
        self.assertEqual(r['requests'],2)
        self.assertEqual(r['status'],'partial')
        self.assertEqual(part.read_bytes(),DATA[:63])
        self.assertFalse(self.dest.exists())

    def test_ignored_range_never_concatenates_whole_response(self):
        part=self.partial()
        with self.assertRaisesRegex(ValueError,'ignored Range'):
            download.transfer('https://fixture.invalid/book',self.dest,opener=lambda *a,**kw:Response(DATA,**{'Content-Length':str(len(DATA))}))
        self.assertEqual(part.read_bytes(),DATA[:43])
        self.assertFalse(self.dest.exists())

    def test_entity_change_preserves_partial(self):
        part=self.partial()
        with self.assertRaisesRegex(ValueError,'entity changed'):
            download.transfer('https://fixture.invalid/book',self.dest,opener=lambda *a,**kw:Response(DATA[43:],status=206,**{'Content-Range':f'bytes 43-{len(DATA)-1}/{len(DATA)}','ETag':'"v2"'}))
        self.assertEqual(part.read_bytes(),DATA[:43])

    def test_existing_target_and_lock_are_preserved(self):
        self.dest.write_bytes(b'owner file')
        with self.assertRaises(ValueError):download.transfer('https://fixture.invalid/book',self.dest)
        self.assertEqual(self.dest.read_bytes(),b'owner file')
        self.dest.unlink()
        lock=self.dest.with_name(self.dest.name+'.download.lock');lock.write_text('other transfer')
        with self.assertRaises(FileExistsError):download.transfer('https://fixture.invalid/book',self.dest)
        self.assertEqual(lock.read_text(),'other transfer')

    def test_fake_pdf_and_oversize_are_not_published(self):
        for payload,size in [(b'<html>fake PDF</html>',20),(DATA,10**10)]:
            with self.subTest(size=size),self.assertRaises(ValueError):
                download.transfer('https://fixture.invalid/book',self.dest,opener=lambda *a,**kw:Response(payload,**{'Content-Length':str(size)}))
            self.assertFalse(self.dest.exists())
            for p in Path(self.tmp.name).glob('*.part*'):p.unlink()

    def test_unvalidated_partial_is_not_resumed(self):
        r=download.transfer('https://fixture.invalid/book',self.dest,requests=1,opener=lambda *a,**kw:Response(DATA[:43],**{'Content-Length':str(len(DATA)),'ETag':None}))
        self.assertEqual(r['status'],'partial')
        with self.assertRaisesRegex(ValueError,'no entity validator'):
            download.transfer('https://fixture.invalid/book',self.dest,opener=lambda *a,**kw:self.fail('Should not connect'))


if __name__=='__main__':unittest.main()
