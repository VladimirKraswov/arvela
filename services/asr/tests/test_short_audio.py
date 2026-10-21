import importlib.util
import struct
import subprocess
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

class Model:
    arch = variant = backend = 'fixture'
    def __init__(self, *args, **kwargs): self.samples = []
    def session(self, **kwargs): return self
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def run(self, pcm, **kwargs):
        self.samples.append(pcm)
        return types.SimpleNamespace(text='слово', language='ru', timings=types.SimpleNamespace(mel_ms=0,encode_ms=0,decode_ms=0))

with patch.dict(sys.modules, {'transcribe_cpp': types.SimpleNamespace(Model=Model)}):
    spec = importlib.util.spec_from_file_location('asr_fixture', Path(__file__).parents[1] / 'server.py')
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)

class ShortAudioTests(unittest.TestCase):
    def test_short_valid_audio_preserves_every_sample_and_existing_model_padding(self):
        for count in (1, 160, 1600, 8000):
            raw = struct.pack('<f', 0.1) * count
            server.ENGINE.model.samples.clear()
            with patch.object(server.subprocess, 'run', return_value=subprocess.CompletedProcess([],0,raw,b'')):
                result = server.ENGINE.transcribe(b'encoded fixture')
            self.assertEqual(result['text'], 'слово')
            self.assertEqual(result['duration_seconds'], round(count/16000,3))
            [padded] = server.ENGINE.model.samples
            start = int(server.LEADING_PAD_SECONDS*16000)*4
            self.assertEqual(padded[start:start+len(raw)],raw)
            self.assertGreater(len(padded),len(raw))
    def test_zero_decoded_samples_are_empty_without_model_inference(self):
        server.ENGINE.model.samples.clear()
        with patch.object(server.subprocess, 'run', return_value=subprocess.CompletedProcess([],0,b'',b'')):
            result = server.ENGINE.transcribe(b'valid empty container')
        self.assertEqual(result['text'],'')
        self.assertEqual(result['chunks'],0)
        self.assertEqual(server.ENGINE.model.samples,[])
    def test_broken_container_and_pcm_remain_errors(self):
        for completed in [subprocess.CompletedProcess([],1,b'',b'invalid format'),subprocess.CompletedProcess([],0,b'x',b'')]:
            with patch.object(server.subprocess,'run',return_value=completed):
                with self.assertRaises(ValueError): server.ENGINE.transcribe(b'bad')

if __name__=='__main__':unittest.main()
