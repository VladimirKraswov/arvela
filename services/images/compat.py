"""Align older CLIP inputs with their tokenizer IR, without changing model math."""
from pathlib import Path
import xml.etree.ElementTree as ET
import openvino as ov

def prepare_text_inputs(root):
    changes = []
    for part, tokenizer in (('text_encoder','tokenizer'), ('text_encoder_2','tokenizer_2')):
        xml = Path(root) / part / 'openvino_model.xml'
        if not xml.exists(): continue
        # Inspect only typed IR metadata: parsing tokenizer operators with Core
        # would unnecessarily require its custom tokenizer extension at provision time.
        tokens = ET.parse(Path(root) / tokenizer / 'openvino_tokenizer.xml')
        layers = {n.get('id'): n for n in tokens.findall('./layers/layer')}
        def names(node):
            values = node.get('output_names', '').split(',')
            for edge in tokens.findall('./edges/edge'):
                if edge.get('to-layer') == node.get('id'):
                    source = layers.get(edge.get('from-layer'))
                    if source is not None:
                        for port in source.findall('output/port'):
                            if port.get('id') == edge.get('from-port'):
                                values += port.get('names', '').split(',')
            return values
        result = next((n for n in layers.values()
                       if n.get('type') == 'Result' and 'input_ids' in names(n)), None)
        port = result.find('input/port') if result is not None else None
        dtype = {'I32': ov.Type.i32, 'I64': ov.Type.i64}.get(port.get('precision') if port is not None else None)
        if dtype is None: raise ValueError('Invalid tokenizer IDs dtype')
        model = ov.Core().read_model(xml)
        if all(p.get_element_type() == dtype for p in model.inputs): continue
        processor = ov.preprocess.PrePostProcessor(model)
        for i, p in enumerate(model.inputs):
            original = p.get_element_type()
            if original not in (ov.Type.i32, ov.Type.i64):
                raise ValueError('Unsupported CLIP input dtype: ' + str(p.get_element_type()))
            processor.input(i).tensor().set_element_type(dtype)
            processor.input(i).preprocess().convert_element_type(original)
        model = processor.build()
        temporary = xml.with_name('compatible.xml')
        ov.serialize(model, temporary, temporary.with_suffix('.bin'))
        temporary.with_suffix('.bin').replace(xml.with_suffix('.bin'))
        temporary.replace(xml)
        changes.append(part)
    return changes
