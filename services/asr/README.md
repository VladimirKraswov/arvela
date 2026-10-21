# CPU GigaAM service

`server.py` tracks the deployed CPU-only service used by Enki dictation. It
requires the separately installed `transcribe_cpp`, its GigaAM model and ffmpeg;
these dependencies and model weights are not included in client updates.
Deployment supplies the existing model path, bind address and worker environment.

Valid decoded clips use the existing leading/trailing inference padding even
when shorter than 150 ms. No decoded sample is discarded. Zero decoded samples
returns empty text without inference; invalid containers and malformed PCM remain
errors. Enki permits empty results only for progressive dictation, saves failed
segments, and never interprets an arbitrary HTTP 400 as success.

Run `python3 -m unittest discover -s services/asr/tests`. Tests use a fixture
model and ffmpeg outputs, require no model weights/GPU, and are a canonical
release gate. Client source/hot publication does not deploy this service.

Service rollout: compare the live source digest to the reviewed baseline,
validate the candidate, keep a private rollback copy, verify no active ASR
connections, replace atomically and restart only the ASR unit. Preserve model,
CPU execution, environment and network routing. Verify synthetic short silence,
normal Russian speech and corrupt-container rejection through the actual API.
On startup failure restore the previous source and restart the unit. Never use
owner recordings as release fixtures or restart agent/inference services.
