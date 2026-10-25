"""Тёмные картинки для установщика NSIS: боковая панель (164x314) и шапка (150x57), BMP 24 бит.
Запуск: python scripts/gen-installer-art.py (нужен Pillow; шрифт Golos Text лежит в tools/readme/.font)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path

root = Path(__file__).resolve().parent.parent
out = root / "src-tauri" / "nsis"
font_dir = root / "tools" / "readme" / ".font"
BG = (11, 11, 15)
ACCENT = (47, 139, 255)

logo = Image.open(root / "assets" / "logo.png").convert("RGBA")

def glow(size, cx, cy, radius, color, strength):
    layer = Image.new("RGB", size, BG)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=int(255 * strength))
    mask = mask.filter(ImageFilter.GaussianBlur(radius / 1.4))
    layer.paste(Image.new("RGB", size, color), (0, 0), mask)
    return layer

def rounded(img, size, r):
    img = img.resize((size, size), Image.LANCZOS)
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), r, fill=255)
    img.putalpha(m)
    return img

S = 4  # рисуем в 4× и уменьшаем: гладкие края

def sidebar():
    w, h = 164 * S, 314 * S
    im = glow((w, h), w // 2, int(h * 0.34), 120 * S, ACCENT, 0.28)
    lg = rounded(logo, 92 * S, 22 * S)
    x, y = (w - lg.width) // 2, 58 * S
    sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x, y + 6 * S, x + lg.width, y + lg.height + 6 * S), 22 * S, fill=(0, 0, 0, 160))
    sh = sh.filter(ImageFilter.GaussianBlur(10 * S))
    im.paste(sh, (0, 0), sh)
    im.paste(lg, (x, y), lg)
    d = ImageDraw.Draw(im)
    f1 = ImageFont.truetype(str(font_dir / "golos.ttf"), 30 * S)
    f1.set_variation_by_axes([700]) if hasattr(f1, "set_variation_by_axes") else None
    f2 = ImageFont.truetype(str(font_dir / "golos.ttf"), 11 * S)
    d.text((w // 2, 182 * S), "Tobi", font=f1, fill=(255, 255, 255), anchor="mm")
    d.text((w // 2, 208 * S), "AI helper for Windows", font=f2, fill=(150, 155, 175), anchor="mm")
    d.rounded_rectangle((w // 2 - 14 * S, 228 * S, w // 2 + 14 * S, 230 * S), 1 * S, fill=ACCENT)
    return im.resize((164, 314), Image.LANCZOS)

def header():
    w, h = 150 * S, 57 * S
    im = Image.new("RGB", (w, h), BG)
    im.paste(glow((w, h), w - 22 * S, h // 2, 34 * S, ACCENT, 0.45), (0, 0))
    lg = rounded(logo, 40 * S, 10 * S)
    im.paste(lg, (w - 22 * S - 20 * S, (h - lg.height) // 2), lg)
    return im.resize((150, 57), Image.LANCZOS)

sidebar().save(out / "sidebar.bmp")
header().save(out / "header.bmp")
print("ok")
