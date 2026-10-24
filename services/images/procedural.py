"""Explicit, deterministic PBR surface recipes; never presented as neural art."""
import re
import numpy as np
from PIL import Image

def resolve_surface(surface, prompt):
    if surface == 'image': return None
    if surface in ('brick', 'granite'): return surface
    if surface != 'auto': raise ValueError('Unknown material surface')
    p = prompt.lower()
    if re.search(r'\bbrick(?:s|work)?\b|кирпич', p) and not re.search(r'\b(?:no|without|avoid)\s+bricks?\b', p): return 'brick'
    if re.search(r'\bgranite\b|гранит', p) and not re.search(r'\b(?:no|without|avoid)\s+granite\b', p): return 'granite'
    return None

def noise(rng, height, width, sigma):
    values = rng.standard_normal((height, width))
    fy = np.fft.fftfreq(height)[:, None]; fx = np.fft.fftfreq(width)[None, :]
    values = np.fft.ifft2(np.fft.fft2(values) * np.exp(-2*np.pi*np.pi*sigma*sigma*(fx*fx+fy*fy))).real
    return values / max(float(values.std()), 1e-8)

def generate_surface(surface, width, height, seed):
    rng = np.random.default_rng(seed)
    grain = noise(rng, height, width, .6)
    broad = noise(rng, height, width, max(2, min(width, height)/32))
    fine = noise(rng, height, width, 2)
    if surface == 'brick':
        # Even row count makes the alternating half-brick offset periodic in Y.
        rows = 8; columns = 4
        y, x = np.mgrid[:height, :width]
        row = np.floor(y*rows/height).astype(int)
        u = (x*columns/width + (row % 2)*.5) % 1
        v = y*rows/height % 1
        col = np.floor(x*columns/width + (row % 2)*.5).astype(int) % columns
        edge = np.minimum(np.minimum(u,1-u)*width/columns, np.minimum(v,1-v)*height/rows)
        mortar_width = max(1.5, min(width,height)/160)
        bevel = np.clip((edge-mortar_width)/max(2,min(width,height)/90),0,1)
        variation = rng.uniform(-.12,.12,(rows,columns))[row,col]
        brick = np.array([.57,.22,.105])[None,None,:] * (1+variation[:,:,None])
        brick = brick + (.021*grain+.026*fine+.012*broad)[:,:,None]
        mortar = np.array([.48,.455,.405])[None,None,:] + (.012*grain)[:,:,None]
        mask = np.clip((edge-mortar_width)/1.2,0,1)
        rgb = mortar*(1-mask[:,:,None])+brick*mask[:,:,None]
        relief = .12 + .68*bevel + mask*(.014*grain+.025*fine)
    elif surface == 'granite':
        minerals = noise(rng,height,width,max(1,min(width,height)/220))
        flecks = np.clip((np.abs(grain)-1.2)*.10,0,.22)
        gray = .49+.075*minerals+.045*fine+.025*broad
        rgb = np.stack([gray+.022*broad,gray+.012*fine,gray-.018*broad],axis=-1)-flecks[:,:,None]
        relief = .5+.06*minerals+.035*fine+.018*grain
    else: raise ValueError('Unknown material recipe')
    image = Image.fromarray(np.rint(np.clip(rgb,0,1)*255).astype(np.uint8))
    image.info['enki_height'] = np.clip(relief,0,1)
    image.info['enki_surface'] = surface
    return image
