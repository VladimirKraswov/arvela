import tempfile
from pathlib import Path
import unittest
import numpy as np
import openvino as ov
from openvino import opset13 as ops
from compat import prepare_text_inputs

class ClipCompatibility(unittest.TestCase):
    def test_clip_input_matches_actual_tokenizer_dtype_without_changing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            part=Path(directory)/'text_encoder';part.mkdir()
            tokenizer=Path(directory)/'tokenizer';tokenizer.mkdir()
            token_ids=ops.parameter([1,3],np.int64,name='input_ids')
            token_ids.output(0).set_names({'input_ids'})
            ov.serialize(ov.Model([token_ids],[token_ids]),tokenizer/'openvino_tokenizer.xml')
            p=ops.parameter([1, 3], np.int32, name='input_ids')
            model=ov.Model([ops.convert(p, np.float32)], [p])
            ov.serialize(model, part/'openvino_model.xml')
            self.assertEqual(prepare_text_inputs(directory), ['text_encoder'])
            transformed=ov.Core().read_model(part/'openvino_model.xml')
            self.assertEqual(transformed.input(0).get_element_type(), ov.Type.i64)
            result=ov.Core().compile_model(transformed, 'CPU')([np.array([[1, 50, 49407]], np.int64)])[0]
            np.testing.assert_array_equal(result, [[1, 50, 49407]])
            self.assertEqual(prepare_text_inputs(directory), [])
