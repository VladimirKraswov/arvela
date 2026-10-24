"""Circular spatial padding for diffusion AND VAE decoding, before inference.

Unlike blending opposite output borders, this lets the network see the adjacent
tile throughout denoising. Attention/normalization remain unchanged. No weights
are trained or replaced. The generated IR is a local cache, never downloaded code.
"""
from pathlib import Path
import json
import hashlib
import shutil
import openvino as ov
from openvino import opset13 as ops

VERSION = 1

def circular_convolutions(model):
    count = 0
    for node in list(model.get_ordered_ops()):
        if node.get_type_name() != 'Convolution':
            continue
        a = node.get_attributes()
        before, after = a['pads_begin'], a['pads_end']
        if not any(before + after):
            continue
        if a['auto_pad'].lower() != 'explicit' or len(before) != 2:
            raise ValueError('Periodic conversion requires explicit 2D padding')
        data = node.input_value(0)
        for axis, left, right in zip((2, 3), before, after):
            pieces = []
            if left:
                pieces.append(ops.slice(data, [-left], [2**63-1], [1], [axis]))
            pieces.append(data)
            if right:
                pieces.append(ops.slice(data, [0], [right], [1], [axis]))
            if len(pieces) > 1:
                data = ops.concat(pieces, axis)
        replacement = ops.convolution(data, node.input_value(1), a['strides'],
                                      [0, 0], [0, 0], a['dilations'])
        replacement.set_friendly_name(node.get_friendly_name())
        replacement.output(0).set_names(node.output(0).get_names())
        node.output(0).replace(replacement.output(0))
        count += 1
    model.validate_nodes_and_infer_types()
    if not count:
        raise ValueError('No padded convolutions found; refusing fake tileability')
    return count

def prepare_periodic(source, cache):
    source, cache = Path(source), Path(cache)
    marker = cache / 'periodic.json'
    fingerprint = hashlib.sha256(b''.join((source / part).read_bytes() for part in
        ('model_index.json', 'unet/openvino_model.xml', 'vae_decoder/openvino_model.xml')) +
        ((source / 'enki-model.json').read_bytes() if (source / 'enki-model.json').exists() else b'')).hexdigest()
    if marker.exists() and json.loads(marker.read_text()).get('version') == VERSION and json.loads(marker.read_text()).get('source') == fingerprint:
        return cache
    # Called by the single serialized image worker; incomplete caches are never used.
    staging = cache.with_name(cache.name + '.preparing')
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(source, staging, copy_function=shutil.copy2,
                    ignore=shutil.ignore_patterns('.cache', '*.py', '*.safetensors'))
    counts = {}
    for part in ('unet', 'vae_decoder'):
        src = source / part / 'openvino_model.xml'
        model = ov.Core().read_model(src)
        counts[part] = circular_convolutions(model)
        # Serialize only into the private copy; original pinned weights stay immutable.
        for suffix in ('xml', 'bin'):
            (staging / part / ('openvino_model.' + suffix)).unlink()
        ov.serialize(model, staging / part / 'openvino_model.xml',
                     staging / part / 'openvino_model.bin')
    (staging / 'periodic.json').write_text(json.dumps({'version': VERSION, 'source': fingerprint, 'convolutions': counts}))
    if cache.exists():
        shutil.rmtree(cache)
    staging.rename(cache)
    return cache
