import importlib.util
from pathlib import Path
import unittest
import numpy as np
from PIL import Image
spec=importlib.util.spec_from_file_location('materials',Path(__file__).parents[1]/'materials.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Materials(unittest.TestCase):
 def test_flat_map_has_no_spurious_relief_and_roughness_is_data(self):
  maps=module.make_material(Image.new('RGB',(32,32),'grey'),roughness=.7)
  np.testing.assert_array_equal(np.asarray(maps['normal.png'])[0,0],[128,128,255])
  self.assertEqual(np.asarray(maps['roughness.png'])[0,0],178)
  self.assertEqual(np.asarray(maps['metallic.png'])[0,0],0)
  self.assertEqual(np.asarray(maps['height.png']).dtype,np.uint16)
 def test_conventions_flip_only_green_and_normals_are_unit_length(self):
  pixels=np.tile(np.arange(32,dtype=np.uint8)[:,None]*8,(1,32));image=Image.fromarray(pixels).convert('RGB')
  gl=np.asarray(module.make_material(image,blur=0,convention='opengl')['normal.png']).astype(float)
  dx=np.asarray(module.make_material(image,blur=0,convention='directx')['normal.png']).astype(float)
  np.testing.assert_array_equal(gl[:,:,0],dx[:,:,0]);np.testing.assert_array_equal(gl[:,:,2],dx[:,:,2]);self.assertTrue(np.all(abs(gl[:,:,1]+dx[:,:,1]-255)<=1))
  self.assertGreater(gl[16,16,1],128);self.assertLess(dx[16,16,1],128)
  n=gl/255*2-1;self.assertLess(np.max(abs(np.linalg.norm(n,axis=-1)-1)),.01)
 def test_periodic_material_preserves_albedo_without_painting_border_bands(self):
  rng=np.random.default_rng(42);image=Image.fromarray(rng.integers(0,255,(64,64,3),dtype=np.uint8))
  maps=module.make_material(image,tileable=True)
  # Old tests forced identical border pixels, allowing a destructive crossfade.
  # Circular inference now supplies the tile; derivation must preserve its pixels.
  np.testing.assert_array_equal(np.asarray(maps['image-01.png']),np.asarray(image))
  for name,img in maps.items():self.assertEqual(img.size,(128,128) if name=='tile-preview.png' else (64,64))
 def test_periodic_normals_are_translation_equivariant_across_both_borders(self):
  x=np.arange(64);a=np.rint(128+60*np.sin(x[None,:]*2*np.pi/64)+40*np.cos(x[:,None]*2*np.pi/64)).astype(np.uint8)
  source=Image.fromarray(a).convert('RGB')
  normal=np.asarray(module.make_material(source,tileable=True)['normal.png'])
  shifted=Image.fromarray(np.roll(np.asarray(source),(17,23),(0,1)))
  got=np.asarray(module.make_material(shifted,tileable=True)['normal.png'])
  np.testing.assert_array_equal(got,np.roll(normal,(17,23),(0,1)))
if __name__=='__main__':unittest.main()
