#!/usr/bin/env python3
"""Reproducible edge-connected blue-screen matting; Pillow + NumPy only.

Run: python scripts/prepare-portrait.py
The first run snapshots the unmodified source to dev/portrait-source.png.
Subsequent runs always read that source, never an already-matted output.
Only border-connected blue is background; enclosed blue logos stay opaque.
No pretrained model or third-party artwork is downloaded by this script.
"""
from pathlib import Path
from collections import deque
import hashlib
import json
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'dev/portrait-source.png'
OUTPUT = ROOT / 'assets/kobe.png'


def flood_border(candidate):
    h, w = candidate.shape
    seen = np.zeros((h, w), dtype=bool)
    queue = deque()
    for y, x in [(0, x) for x in range(w)] + [(h-1, x) for x in range(w)] + [(y, 0) for y in range(h)] + [(y, w-1) for y in range(h)]:
        if candidate[y, x] and not seen[y, x]:
            seen[y, x] = True
            queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = y+dy, x+dx
            if 0 <= ny < h and 0 <= nx < w and candidate[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                queue.append((ny, nx))
    return seen


def erode(mask, size=5):
    return np.asarray(Image.fromarray(mask.astype('uint8')*255).filter(ImageFilter.MinFilter(size))) > 0


def extend_colors(rgb, seeds, steps=8):
    """Nearest trustworthy colors into a narrow trimap; no wraparound."""
    colors = rgb.copy()
    known = seeds.copy()
    h, w = seeds.shape
    for _ in range(steps):
        previous = known.copy()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1,-1), (1,1), (-1,1), (1,-1)):
            target = (slice(max(0,dy),min(h,h+dy)), slice(max(0,dx),min(w,w+dx)))
            source = (slice(max(0,-dy),min(h,h-dy)), slice(max(0,-dx),min(w,w-dx)))
            take = ~known[target] & previous[source]
            colors[target][take] = colors[source][take]
            known[target][take] = True
    return colors


def main():
    if not SOURCE.exists():
        original = Image.open(OUTPUT).convert('RGBA')
        if original.getextrema()[3] != (255, 255):
            raise RuntimeError('Missing original source; refusing to rematte transparent output.')
        original.convert('RGB').save(SOURCE)
    rgb = np.asarray(Image.open(SOURCE).convert('RGB')).astype(np.float32)
    r, g, b = rgb.transpose(2,0,1)
    # Deliberately broad blue test, but connectivity is mandatory. Internal label
    # blue and bottle/jersey colors cannot be erased by a global color key.
    blue = (b-r > 25) & (g-r > 12) & (b-g > 3)
    background = flood_border(blue)
    foreground = ~background
    sure_f = erode(foreground, 5)
    sure_b = erode(background, 5)
    trimap = ~sure_f & ~sure_b
    f = extend_colors(rgb, sure_f)
    back = extend_colors(rgb, sure_b)
    direction = f-back
    denominator = np.sum(direction*direction, axis=2)
    alpha = np.sum((rgb-back)*direction, axis=2) / np.maximum(denominator, 1)
    alpha = np.clip(alpha, 0, 1)
    alpha[sure_f] = 1
    alpha[sure_b] = 0
    # Kill near-zero compression noise; retain a real narrow antialiased edge.
    alpha[alpha < .06] = 0
    alpha[alpha > .97] = 1
    # Unmix blue screen only on the edge, never globally desaturate blue artwork.
    corrected = rgb.copy()
    partial = (alpha > 0) & (alpha < 1) & trimap
    unmixed = (rgb - (1-alpha[...,None])*back) / np.maximum(alpha[...,None], .08)
    corrected[partial] = np.clip(unmixed[partial], 0, 255)
    # A compressed low-resolution source also contains a dark cyan fringe
    # *inside* the binary outline. Remove it only within four silhouette pixels,
    # using a trustworthy inward color (not a global blue-channel operation).
    edge_band = foreground & ~erode(foreground, 9)
    inward = extend_colors(rgb, erode(foreground, 9), steps=12)
    blue_spill = (edge_band | partial) & (corrected[:,:,2] > corrected[:,:,0]) & (corrected[:,:,2] > corrected[:,:,1])
    corrected[blue_spill] = inward[blue_spill]
    corrected[alpha == 0] = 0
    rgba = np.dstack([np.rint(corrected).astype('uint8'), np.rint(alpha*255).astype('uint8')])
    result = Image.fromarray(rgba)
    result.save(OUTPUT, optimize=True)
    for name, color in [('white', (255,255,255,255)), ('black', (0,0,0,255))]:
        canvas = Image.new('RGBA', result.size, color)
        canvas.alpha_composite(result)
        canvas.convert('RGB').save(ROOT / f'dev/portrait-check-{name}.png')
    yy, xx = np.indices(alpha.shape)
    checker = np.where(((xx//20 + yy//20) % 2)[...,None], 225, 245).astype('uint8')
    checker = np.repeat(checker, 3, axis=2)
    canvas = Image.fromarray(checker).convert('RGBA')
    canvas.alpha_composite(result)
    canvas.convert('RGB').save(ROOT / 'dev/portrait-check-checker.png')
    Image.fromarray(rgba[:,:,3]).save(ROOT / 'dev/portrait-alpha.png')
    # Full-size paired checks, followed by 2x nearest-neighbor head details.
    white = Image.open(ROOT / 'dev/portrait-check-white.png')
    black = Image.open(ROOT / 'dev/portrait-check-black.png')
    checks = Image.new('RGB', (result.width*2, result.height+460), '#bdbdbd')
    checks.paste(white, (0,0))
    checks.paste(black, (result.width,0))
    for check, x in ((white,0), (black,result.width)):
        detail = check.crop((215,25,445,255)).resize((460,460), Image.Resampling.NEAREST)
        checks.paste(detail, (x+90,result.height))
    checks.save(ROOT / 'dev/portrait-check.png')
    # Blue foreground audit counts only pixels at least four pixels inside the
    # retained silhouette: all must be bit-identical and fully opaque.
    protected_blue = blue & erode(foreground, 9)
    a = rgba[:,:,3]
    stats = {
        'source': 'dev/portrait-source.png',
        'source_sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'output': 'assets/kobe.png',
        'output_sha256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
        'size': list(result.size), 'mode': result.mode,
        'total_pixels': int(a.size), 'transparent_pixels': int((a==0).sum()),
        'partial_alpha_pixels': int(((a>0)&(a<255)).sum()),
        'opaque_pixels': int((a==255).sum()),
        'alpha_min': int(a.min()), 'alpha_max': int(a.max()),
        'protected_interior_blue_pixels': int(protected_blue.sum()),
        'protected_interior_blue_changed_pixels': int(np.any(rgba[:,:,:3][protected_blue] != rgb.astype('uint8')[protected_blue], axis=1).sum()),
        'protected_interior_blue_transparency_pixels': int((a[protected_blue] != 255).sum()),
        'method': 'Border-connected blue segmentation, 5px trimap, local foreground/background color projection and edge-only decontamination.',
        'rights': 'Source photo/likeness and visible product trademarks are not licensed by this processing step. Confirm permissions before redistribution or commercial use.'
    }
    (ROOT / 'dev/portrait-stats.json').write_text(json.dumps(stats, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(stats, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
