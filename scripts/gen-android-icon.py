"""Адаптивная иконка Android из assets/logo.png: фон — синий градиент, продолжающий синий цвет логотипа
(без белых краёв), передний план — сам логотип в безопасной зоне (70%). Запуск: python scripts/gen-android-icon.py"""
from PIL import Image, ImageFilter
import numpy as np
from pathlib import Path

root = Path(__file__).resolve().parent.parent
res = root / "android" / "app" / "src" / "main" / "res"
logo = Image.open(root / "assets" / "logo.png").convert("RGBA")
N = 432  # 108dp в xxxhdpi

# Фон: вертикальный градиент, подогнанный по синим пикселям логотипа (МНК), в координатах логотипа,
# чтобы на стыке с ним не было шва. Логотип стоит в безопасной зоне (70%).
SCALE = 0.70
size = int(N * SCALE)
off = (N - size) // 2
a = np.asarray(logo.resize((size, size), Image.LANCZOS)).astype(np.float32)
blue = (a[..., 3] > 250) & (a[..., 2] > 200) & (a[..., 0] < 90)
ys = np.nonzero(blue)[0] / size
cols = []
for c in range(3):
    k, m = np.polyfit(ys, a[..., c][blue], 1)
    cols.append((k, m))
bg = np.zeros((N, N, 3), np.uint8)
for row in range(N):
    y = min(1.0, max(0.0, (row - off) / size))
    bg[row, :, :] = [int(np.clip(k * y + m, 0, 255)) for k, m in cols]
Image.fromarray(bg).save(res / "mipmap-xxxhdpi" / "ic_launcher_background.png")

# Передний план: логотип 66% (безопасная зона адаптивной иконки).
fg = Image.new("RGBA", (N, N), (0, 0, 0, 0))
lg = logo.resize((size, size), Image.LANCZOS)
fg.paste(lg, ((N - size) // 2, (N - size) // 2), lg)
fg.save(res / "mipmap-xxxhdpi" / "ic_launcher_foreground.png")

(res / "mipmap-anydpi-v26").mkdir(exist_ok=True)
(res / "mipmap-anydpi-v26" / "ic_launcher.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
    '    <background android:drawable="@mipmap/ic_launcher_background" />\n'
    '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
    '</adaptive-icon>\n', encoding="utf-8")
# Preview для проверки глазами (круг и скруглённый квадрат)
