#!/usr/bin/env python3
"""Turn a raw shop photo into a website photo: remove the background, tidy the edges,
put the item on a cream background with a soft shadow and the Agrawal Stores badge.

usage: python3 scripts/studio.py <input.jpg> <output.webp> [--loose]
  --loose  skip the straight-edge clean-up (use for blazers, jackets and other items that are not in a plastic bag)
  --whole  keep the whole photo, no background removal (use when the item fills the photo, e.g. photo frames,
           wall pieces, boxed items; background removal would cut the frame away)

needs: pip install rembg onnxruntime opencv-python-headless pillow numpy
"""
import os, sys
import cv2, numpy as np
from PIL import Image, ImageOps, ImageFilter, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, '..', 'assets', 'fonts', 'inter-latin.woff2')


def cut_out(path):
    from rembg import remove, new_session
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    im.thumbnail((1400, 1400), Image.LANCZOS)
    return remove(im, session=new_session('u2net')).convert('RGBA')


def quad_clean(rgba, inset=0.0):
    a = np.array(rgba)
    m = (a[..., 3] > 128).astype(np.uint8)
    h, w = m.shape
    k = max(5, int(min(h, w) * 0.035)) | 1
    o = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(o)
    if n < 2:
        return rgba, m
    o = (lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
    cs, _ = cv2.findContours(o, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    hull = cv2.convexHull(max(cs, key=cv2.contourArea))
    per = cv2.arcLength(hull, True)
    poly = None
    for e in np.linspace(0.01, 0.12, 45):
        p = cv2.approxPolyDP(hull, e * per, True)
        if len(p) <= 4:
            poly = p
            break
    if poly is None or len(poly) < 4:
        poly = cv2.boxPoints(cv2.minAreaRect(hull)).reshape(-1, 1, 2)
    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [poly.astype(np.int32)], 255)
    return rgba, (mask > 0).astype(np.uint8), m


def grabcut_clean(rgba):
    a = np.array(rgba)
    rgb = cv2.cvtColor(a[..., :3], cv2.COLOR_RGB2BGR)
    h, w = a.shape[:2]
    _, quad, _ = quad_clean(rgba)
    orig = a[..., 3] > 128
    mask = np.full((h, w), cv2.GC_BGD, np.uint8)
    mask[quad > 0] = cv2.GC_PR_FGD
    k = max(9, int(min(h, w) * 0.12)) | 1
    core = cv2.erode(quad, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    mask[core > 0] = cv2.GC_FGD
    mask[~orig] = cv2.GC_BGD
    s = 1000.0 / max(h, w)
    r = cv2.resize(rgb, None, fx=s, fy=s)
    mk = cv2.resize(mask, (r.shape[1], r.shape[0]), interpolation=cv2.INTER_NEAREST)
    cv2.grabCut(r, mk, None, np.zeros((1, 65)), np.zeros((1, 65)), 6, cv2.GC_INIT_WITH_MASK)
    fg = ((mk == cv2.GC_FGD) | (mk == cv2.GC_PR_FGD)).astype(np.uint8)
    fg = cv2.resize(fg, (w, h), interpolation=cv2.INTER_NEAREST)
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg)
    if n > 1:
        fg = (lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
    k2 = max(5, int(min(h, w) * 0.02)) | 1
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k2, k2))
    fg = cv2.morphologyEx(cv2.morphologyEx(fg, cv2.MORPH_CLOSE, ker), cv2.MORPH_OPEN, ker)
    cs, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    m = np.zeros((h, w), np.uint8)
    cv2.drawContours(m, [cv2.convexHull(max(cs, key=cv2.contourArea))], -1, 255, -1)
    a[..., 3] = cv2.GaussianBlur(m, (0, 0), 1.2)
    return Image.fromarray(a)


def compose(cut, out):
    W, H, pad = 1000, 1250, 70
    a = cut.getchannel('A').point(lambda v: 0 if v < 70 else (255 if v > 200 else v))
    cut.putalpha(a)
    cut = cut.crop(a.getbbox())
    cut.thumbnail((W - 2 * pad, H - 2 * pad - 60), Image.LANCZOS)
    bg = Image.new('RGBA', (W, H), (255, 250, 242, 255))
    x, y = (W - cut.width) // 2, (H - 60 - cut.height) // 2
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sh.paste((87, 43, 31, 255), (x + 10, y + 18), cut.getchannel('A').point(lambda v: 70 if v > 0 else 0))
    bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
    bg.alpha_composite(cut, (x, y))
    d = ImageDraw.Draw(bg)
    f = ImageFont.truetype(FONT, 30); f.set_variation_by_axes([700])
    f2 = ImageFont.truetype(FONT, 22); f2.set_variation_by_axes([500])
    t1, t2 = 'Agrawal Stores', 'agrawalstores.in · Rajendra Nagar, Indore'
    bw = max(d.textlength(t1, font=f), d.textlength(t2, font=f2)) + 48
    bx, by = (W - bw) / 2, H - 100
    d.rounded_rectangle((bx, by, bx + bw, by + 80), radius=40, fill=(156, 74, 46, 235))
    d.text((W / 2, by + 26), t1, font=f, fill='white', anchor='mm')
    d.text((W / 2, by + 58), t2, font=f2, fill=(251, 239, 223), anchor='mm')
    bg.convert('RGB').save(out, 'WEBP', quality=80, method=6)


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    if '--whole' in sys.argv:
        im = ImageOps.exif_transpose(Image.open(src)).convert('RGBA')
        im.thumbnail((1400, 1400), Image.LANCZOS)
        t = int(min(im.size) * 0.015)  # trim the very edge, where the shop background peeks in
        cut = im.crop((t, t, im.width - t, im.height - t))
    else:
        cut = cut_out(src)
        if '--loose' not in sys.argv:
            cut = grabcut_clean(cut)
    compose(cut, out)
    print(out, os.path.getsize(out))
