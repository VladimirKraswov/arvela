# CPU image generation for Enki

Resident **OpenVINO GenAI + LCM Dreamshaper v7 INT8** on CPU. No CUDA, GPU offload or second language-agent loop. One worker keeps the pipeline loaded; an authenticated API exposes readiness, bounded durable jobs, progress, cancellation and immutable job identifiers. ASR remains a separate higher-priority service.

## Proven deployment

CT201 `cpu-inference`, `192.168.31.59`, Xeon E5-2698 v4 (AVX2). Existing nginx exposes `/api/images/` on its existing ports8080/8443; Python listens only127.0.0.1:18084. `enki-images.service` uses a dedicated system user,12 inference threads, CPU affinity20–31,1200% CPU quota, Nice10, CPUWeight20 and16GiB cap. No ASR/GPU/Hub model lifecycle changes.

Pinned model: [OpenVINO/LCM_Dreamshaper_v7-int8-ov](https://huggingface.co/OpenVINO/LCM_Dreamshaper_v7-int8-ov), revision `340a03e5488f36f7f222e6efa29819850ad7e4be`. This is the GenAI-compatible export; the older rupeshs2023 export was rejected after it produced noise despite technically completing inference. [OpenVINO GenAI samples](https://openvinotoolkit.github.io/openvino.genai/docs/samples/cpp/image_generation/) describe pipeline callbacks and the model card supplies the inference contract. These are few-step raster assets, not a promise of premium drawing quality or exact geometry/text.

Measured with12-thread CPU quota:512×512 /4 steps ~11.7–12.2s,800×60024.44s; three512px icons35.45s. These are measured examples, not an SLA. Service cgroup memory after warm512/800px jobs ~10–11.6GB including compiled graphs/cache. ASR health continued returning200 (~1ms); this does not constitute a simultaneous speech-load benchmark.

## Install / upgrade

Use a dedicated venv; install `requirements.txt`. Run `HF_HUB_DISABLE_XET=1 IMAGE_MODEL_DIR=/opt/enki-images/model-int8 python prepare_model.py`. Downloads happen directly in CPU Inference. The HF HTTP transport was used because Xet stalled on this network. Do not convert/serialize IR over mmap-backed input files.

Install `server.py` and `materials.py` under `/opt/enki-images`; create a system user`enki-images`, writable `/var/lib/enki-images/{jobs,cache}`, and a random >=32-character API token in `/etc/enki-images/token` (root:enki-images0640, parent0750). Model/code/venv are read-only to the service. Install the supplied systemd unit and include `nginx-location.conf` **inside** the existing nginx server; `nginx -t` before reload. Back up the existing nginx file. Never restart ASR to deploy images. Check authoritative image jobs are idle before restarting this service.

Tests: `venv/bin/python -m unittest discover -s services/images/tests` (or deploy the tests under `/opt/enki-images/tests`). They cover idempotency, queue bound, cancellation/partial outputs, restart without replay, authorization/validation, normal conventions/unit vectors/flat surfaces and matching tile boundaries. Run real PNG/ZIP/MCP acceptance separately; mocks do not prove image quality.

## HTTP contract

All routes require `Authorization: Bearer …`; no keys in URLs. Never disable TLS validation. HTTP is permitted only on the user's private LAN; external endpoints require HTTPS.

- `GET /health`: loading/ready/error, model and queue length. It does not generate.
- `POST /jobs` + stable `Idempotency-Key`: `{prompt, model:"lcm-dreamshaper-v7", width:512, height:512, steps:4, seed:42, items:[]}`. Returns202 with a durable id. Same key and body returns the same job; changed body409. Queued jobs max8, images per pack max8, dimensions256–832 in multiples of8, area<=640000px, steps2–8. English visual prompts should be short (CLIP text encoder context).
- Optional `material` object selects the material workflow below; it cannot be combined with icon `items`.
- `GET /jobs/{id}`: state, completed images, current denoising step and result files. `DELETE /jobs/{id}` cancels; it does not erase completed results.
- `GET /jobs/{id}/files/{name}`: PNG / images.zip / manifest.json. Preview route`/jobs/{id}/preview/{name}` returns <=256px PNGs.
- `POST /v1/images/generations`: compatibility path, `n=1`, `response_format=b64_json`, `size:"512x512"`; accepts Idempotency-Key. Enki uses asynchronous jobs so a long HTTP call does not hide progress. A lost acknowledgement never triggers an automatic POST replay.

SQLite commits state/progress; results retained7days, pruned at new submissions; at most200 retained job records. On service restart unfinished jobs become`interrupted`, and are **not** silently repeated. Ready files remain retrievable. A full queue returns429; startup returns503. Job computation has a20min deadline checked between denoising steps. This is a trusted private-service token, not per-tenant isolation.

## Material / normal mapping

`material:{strength:4,blur:1,roughness:0.7,metallic:0,convention:"opengl",tileable:false,invert_height:false}` produces:

- `image-01.png`: basecolor, sRGB;
- `height.png`:16-bit grayscale, **approximate height from that same image's luminance**, not measured geometry;
- `normal.png`: normalized tangent-space normals from the height gradient;
- `roughness.png`, `metallic.png`: uniform **explicitly chosen** scalar maps, not invented estimates from albedo;
- `relight.png`, `relight-right.png`: opposite side-light previews using the actual normals;
- optional`tile-preview.png`:2×2 repetition; ZIP and manifest include all outputs and import/color-space instructions.

Normal/height/roughness/metallic are **linear/non-color data**, never sRGB. OpenGL and DirectX differ by green-channel sign; the chosen convention is recorded. Strength controls the baked gradient; blur suppresses grain; invert_height swaps bumps/depressions. Relight handles the selected convention correctly. `tileable` matches opposing albedo/height/normal boundaries and uses periodic derivatives, but repeated features and semantic seams still require inspection. Do not generate independent unrelated images for normal and albedo maps.

Describe a surface swatch, not a whole scene. Diffusion can still introduce perspective, objects or painted lighting; Vision should inspect basecolor, side-light and tile previews and correct the prompt at most twice. Without Vision report that semantic review was not performed. For measured/production materials a real authored height/scan or a specialist material workflow is still preferable.
