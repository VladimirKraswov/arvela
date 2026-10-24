import unittest
import numpy as np
import openvino as ov
from openvino import opset13 as ops
from periodic import circular_convolutions

class Periodic(unittest.TestCase):
    def test_convolution_uses_neighboring_tile_not_black_border(self):
        p = ops.parameter([1, 1, 8, 8], np.float32)
        c = ops.convolution(p, np.ones((1, 1, 3, 3), np.float32), [1, 1], [1, 1], [1, 1], [1, 1])
        m = ov.Model([c], [p])
        self.assertEqual(circular_convolutions(m), 1)
        compiled = ov.Core().compile_model(m, 'CPU')
        data = np.arange(64, dtype=np.float32).reshape(1, 1, 8, 8)
        expected = sum(np.roll(data, (y, x), (2, 3)) for y in (-1, 0, 1) for x in (-1, 0, 1))
        np.testing.assert_allclose(compiled([data])[0], expected)
        np.testing.assert_allclose(compiled([np.roll(data, (3, 2), (2, 3))])[0], np.roll(expected, (3, 2), (2, 3)))

    def test_dynamic_asymmetric_downsample_keeps_shape(self):
        p = ops.parameter([-1, 1, -1, -1], np.float32)
        c = ops.convolution(p, np.ones((1, 1, 3, 3), np.float32), [2, 2], [0, 0], [1, 1], [1, 1])
        m = ov.Model([c], [p]); circular_convolutions(m)
        f = ov.Core().compile_model(m, 'CPU')
        np.testing.assert_array_equal(f([np.ones((1, 1, 8, 8), np.float32)])[0], np.full((1, 1, 4, 4), 9))
