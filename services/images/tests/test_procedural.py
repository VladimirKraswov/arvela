import unittest
import numpy as np
from procedural import resolve_surface, generate_surface
from materials import make_material

class ProceduralSurfaces(unittest.TestCase):
    def test_recipes_are_explicit_or_unambiguous_not_all_images(self):
        self.assertEqual(resolve_surface('auto','red brick wall texture'),'brick')
        self.assertEqual(resolve_surface('auto','grey granite surface'),'granite')
        self.assertIsNone(resolve_surface('image','brick wall'))
        self.assertIsNone(resolve_surface('auto','stone, no bricks'))
        self.assertIsNone(resolve_surface('auto','forest painting'))
    def test_bricks_have_regular_staggered_rows_and_authored_mortar_depth(self):
        image=generate_surface('brick',512,512,42);h=image.info['enki_height']
        self.assertLess(h[32,0],h[32,64]);self.assertGreater(h[96,0],h[32,0])
        maps=make_material(image,height_map=h,tileable=True)
        np.testing.assert_array_equal(np.asarray(maps['image-01.png']),np.asarray(image))
        self.assertGreater(np.asarray(maps['height.png']).std(),1000)
        self.assertGreater(np.asarray(maps['normal.png'])[:,:,0].std(),1)
    def test_seeds_are_repeatable_and_recipe_has_no_boundary_crossfade_stripes(self):
        for surface in ('brick','granite'):
            a=np.asarray(generate_surface(surface,256,256,42)).astype(float)
            np.testing.assert_array_equal(a,np.asarray(generate_surface(surface,256,256,42)))
            self.assertGreater(np.abs(a-np.asarray(generate_surface(surface,256,256,43))).mean(),1)
            seam=np.abs(a[:,0]-a[:,-1]).mean()+np.abs(a[0]-a[-1]).mean()
            neighbors=np.abs(np.diff(a,axis=0)).mean()+np.abs(np.diff(a,axis=1)).mean()
            self.assertLess(seam,neighbors*2)
