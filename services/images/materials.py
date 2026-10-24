"""Deterministic CPU material maps from the SAME base image (approximate height)."""
import numpy as np
from PIL import Image

def make_material(image, strength=4.0, blur=1.0, roughness=0.7, metallic=0.0, convention='opengl', tileable=False, invert_height=False):
    rgb=np.asarray(image.convert('RGB'),dtype=np.float32)/255.0
    # Tileable inputs are generated with circular convolutions in BOTH UNet and
    # VAE. Border crossfades used to paint visible bands/squares into the albedo.
    # Preserve those model pixels; periodic neighbors need not be identical pixels.
    linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
    height=linear@np.array([.2126,.7152,.0722],dtype=np.float32)
    low,high=np.percentile(height,[2,98]);height=np.clip((height-low)/max(float(high-low),1e-6),0,1)
    if blur:
        if tileable:
            h,w=height.shape;fy=np.fft.fftfreq(h)[:,None];fx=np.fft.fftfreq(w)[None,:]
            height=np.fft.ifft2(np.fft.fft2(height)*np.exp(-2*np.pi*np.pi*blur*blur*(fx*fx+fy*fy))).real
        else:
            pad=max(1,int(np.ceil(blur*3)));padded=np.pad(height,pad,mode='reflect');h,w=padded.shape
            fy=np.fft.fftfreq(h)[:,None];fx=np.fft.fftfreq(w)[None,:]
            height=np.fft.ifft2(np.fft.fft2(padded)*np.exp(-2*np.pi*np.pi*blur*blur*(fx*fx+fy*fy))).real[pad:-pad,pad:-pad]
    if invert_height:height=1-height
    if tileable:
        dx=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))*.5
        dy=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))*.5
    else:dy,dx=np.gradient(height)
    # Image rows grow downward; OpenGL tangent V grows upward.
    normals=np.stack([-dx*strength,dy*strength,np.ones_like(height)],axis=-1)
    normals/=np.linalg.norm(normals,axis=-1,keepdims=True)
    # FFT roundoff around a mathematically flat derivative must not flip the
    # encoded neutral channel between 127 and 128 after a cyclic translation.
    normals[np.abs(normals)<1e-10]=0
    if convention=='directx':normals[:,:,1]*=-1
    elif convention!='opengl':raise ValueError('normal convention')
    normal=Image.fromarray(np.rint(np.clip(normals*.5+.5,0,1)*255).astype(np.uint8))
    # Preview always interprets the convention correctly; map files are linear data.
    shading_normals=normals.copy()
    if convention=='directx':shading_normals[:,:,1]*=-1
    light=np.array([-.6,.4,.7]);light/=np.linalg.norm(light)
    shade=.22+.78*np.maximum(0,shading_normals@light)
    lit=np.clip(linear*shade[:,:,None],0,1)
    lit=np.where(lit<=.0031308,12.92*lit,1.055*lit**(1/2.4)-.055)
    right_light=np.array([.6,-.4,.7]);right_light/=np.linalg.norm(right_light)
    right_shade=.22+.78*np.maximum(0,shading_normals@right_light)
    right_lit=np.clip(linear*right_shade[:,:,None],0,1)
    right_lit=np.where(right_lit<=.0031308,12.92*right_lit,1.055*right_lit**(1/2.4)-.055)
    h,w=height.shape
    maps={
        'image-01.png':Image.fromarray(np.rint(rgb*255).astype(np.uint8)),
        'normal.png':normal,
        'height.png':Image.fromarray(np.rint(np.clip(height,0,1)*65535).astype(np.uint16)),
        'roughness.png':Image.new('L',(w,h),round(roughness*255)),
        'metallic.png':Image.new('L',(w,h),round(metallic*255)),
        'relight.png':Image.fromarray(np.rint(lit*255).astype(np.uint8)),
        'relight-right.png':Image.fromarray(np.rint(right_lit*255).astype(np.uint8)),
    }
    if tileable:
        tile=Image.new('RGB',(w*2,h*2))
        for x,y in [(0,0),(w,0),(0,h),(w,h)]:tile.paste(maps['image-01.png'],(x,y))
        tile.thumbnail((768,768));maps['tile-preview.png']=tile
    return maps
