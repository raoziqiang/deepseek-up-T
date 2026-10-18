"""Key the generated whale-girl artwork off its flat magenta background.

    python vendor/whale/key-whale-girl.py

Reads  vendor/whale/materials/whale-girl-raw.jpg
Writes plugins/dsh-whale-splash/assets/whale-girl.png (trimmed, 420 px tall, RGBA)
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "vendor/whale/materials/whale-girl-raw.jpg"
OUT = ROOT / "plugins/dsh-whale-splash/assets/whale-girl.png"
HEIGHT = 420

rgb = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)
h, w, _ = rgb.shape
edge = np.concatenate([rgb[:12].reshape(-1, 3), rgb[-12:].reshape(-1, 3),
                       rgb[:, :12].reshape(-1, 3), rgb[:, -12:].reshape(-1, 3)])
bg = np.median(edge, axis=0)

# Magenta is "high red, no green, mid blue"; the artwork is cyan/navy/white, so
# green is the channel that separates them. Pink highlights inside the cape keep
# some green and survive the key.
dist = np.linalg.norm(rgb - bg, axis=2)
alpha = np.clip((dist - 38) / (110 - 38), 0, 1)
alpha = np.maximum(alpha, np.clip((rgb[..., 1] - 30) / 70, 0, 1))

# Only background connected to the border is removed: flood the low-alpha mask
# from the edges so dark interior pixels never become holes.
from collections import deque
bgmask = alpha < 0.5
seen = np.zeros_like(bgmask)
q = deque()
for x in range(w):
    for y in (0, h - 1):
        if bgmask[y, x] and not seen[y, x]:
            seen[y, x] = True; q.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        if bgmask[y, x] and not seen[y, x]:
            seen[y, x] = True; q.append((y, x))
while q:
    y, x = q.popleft()
    for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
        if 0 <= ny < h and 0 <= nx < w and bgmask[ny, nx] and not seen[ny, nx]:
            seen[ny, nx] = True; q.append((ny, nx))
alpha = np.where(~seen & (alpha < 0.5), 1.0, alpha)

# Despill: un-mix the background from semi-transparent edge pixels.
a = np.clip(alpha, 1e-3, 1)[..., None]
fg = np.clip((rgb - bg * (1 - a)) / a, 0, 255)
fg[..., 0] = np.minimum(fg[..., 0], np.maximum(fg[..., 1], fg[..., 2]) + 40)

out = Image.fromarray(np.dstack([fg, alpha * 255]).astype(np.uint8), "RGBA")
a_img = out.getchannel("A").filter(ImageFilter.GaussianBlur(0.6))
out.putalpha(a_img)
out = out.crop(out.getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox())
out = out.resize((round(out.width * HEIGHT / out.height), HEIGHT), Image.LANCZOS)
OUT.parent.mkdir(parents=True, exist_ok=True)
out.save(OUT, optimize=True)
print(f"{OUT.relative_to(ROOT)} {out.size} bg={bg.round().tolist()}")
