"""CPU-only image profiles. A single pipeline is resident; switches are serialized."""
import gc
import math
import os
from pathlib import Path
from procedural import resolve_surface, generate_surface

PROFILES = {
    'sdxl-lightning': {'folder': 'sdxl-lightning', 'steps': 2, 'guidance': 0.0, 'title': 'SDXL Lightning'},
    'lcm-dreamshaper-v7': {'folder': None, 'steps': None, 'guidance': 8.0, 'title': 'LCM Dreamshaper · черновик'},
}

def resolve_profile(model, prompt, material=False):
    if model == 'enki-image-auto':
        return 'sdxl-lightning'
    if model not in PROFILES:
        raise ValueError('Неизвестная модель изображений')
    return model

def render_size(width, height, model):
    if model == 'lcm-dreamshaper-v7':
        return width, height
    # SDXL was trained at ~1 megapixel. Rendering at 512 caused poor small faces.
    scale = min(math.sqrt(1048576 / (width * height)), 1536 / max(width, height))
    return max(256, round(width * scale / 64) * 64), max(256, round(height * scale / 64) * 64)

def output_image(image, size, tileable):
    from PIL import Image
    if image.size == size:
        return image
    if not tileable:
        return image.resize(size, Image.Resampling.LANCZOS)
    # Resampling also needs periodic neighbors; clamped resize would add a seam.
    w, h = image.size
    tiled = Image.new('RGB', (w * 3, h * 3))
    for y in range(3):
        for x in range(3): tiled.paste(image, (x * w, y * h))
    ow, oh = size
    return tiled.resize((ow * 3, oh * 3), Image.Resampling.LANCZOS).crop((ow, oh, ow * 2, oh * 2))

class ImageRuntime:
    def __init__(self):
        self.pipeline = None
        self.key = None

    def __call__(self, prompt, body, callback):
        surface = resolve_surface(body.material.surface, prompt) if body.material else None
        phase = getattr(callback, 'phase', lambda *a, **kw: None)
        if surface:
            phase('generating', 'Создаю процедурный PBR-материал · ' + surface, inference={
                'model': 'procedural-' + surface + '-v1', 'steps': 0,
                'width': body.width, 'height': body.height,
                'tile_method': 'procedural-periodic-v1', 'height_source': 'authored procedural relief'})
            return generate_surface(surface, body.width, body.height, body.seed)
        import openvino_genai as genai
        from PIL import Image
        from periodic import prepare_periodic
        model = resolve_profile(body.model, prompt, body.material is not None)
        profile = PROFILES[model]
        tileable = bool(body.material and body.material.tileable)
        key = (model, tileable)
        if self.key != key:
            self.pipeline = None
            self.key = None
            gc.collect()
            phase('loading_model', 'Загружаю ' + profile['title'] + (' с периодической обработкой текстуры' if tileable else ''))
            root = Path(os.getenv('IMAGE_MODELS_DIR', '/opt/enki-images/models'))
            source = root / profile['folder'] if profile['folder'] else Path(os.environ['IMAGE_MODEL_DIR'])
            if tileable:
                source = prepare_periodic(source, Path(os.getenv('IMAGE_CACHE_DIR', '/var/lib/enki-images/cache')) / ('periodic-' + model))
            pipeline = genai.Text2ImagePipeline(source, 'CPU', INFERENCE_NUM_THREADS=int(os.getenv('IMAGE_THREADS', '12')),
                NUM_STREAMS=1, INFERENCE_PRECISION_HINT='f32', CACHE_DIR=str(Path(os.getenv('IMAGE_CACHE_DIR', '/var/lib/enki-images/cache')) / (model + ('-tile' if tileable else ''))))
            self.pipeline = pipeline
            self.key = key
        width, height = render_size(body.width, body.height, model)
        steps = profile['steps'] or body.steps
        phase('generating', 'Создаю изображение · ' + profile['title'], inference={
            'model': model, 'steps': steps, 'guidance': profile['guidance'], 'width': width, 'height': height,
            'tile_method': 'periodic-convolutions-unet-and-vae-v1' if tileable else None})
        image = Image.fromarray(self.pipeline.generate(prompt, width=width, height=height,
            num_inference_steps=steps, guidance_scale=profile['guidance'], rng_seed=body.seed, callback=callback).data[0])
        return output_image(image, (body.width, body.height), tileable)
