"""Download the audited GenAI-compatible IR, without executing model Python code."""
import os
from huggingface_hub import snapshot_download
MODEL='OpenVINO/LCM_Dreamshaper_v7-int8-ov'
REVISION='340a03e5488f36f7f222e6efa29819850ad7e4be'
root=os.environ.get('IMAGE_MODEL_DIR','/opt/enki-images/model-int8')
snapshot_download(MODEL,revision=REVISION,local_dir=root,ignore_patterns=['safety_checker/*','vae_encoder/*','*.safetensors'],max_workers=2)
print('Downloaded pinned OpenVINO GenAI LCM IR; ready for CPU validation')
