"""
Иконки для Windows: .ico приложения из мастер-картинки мак-версии и значки
трея — тот же фирменный знак, что в строке меню на маке: капля с круглым
вырезом. Контур считается по той же формуле, что blobPath в мак-версии.

    python3 scripts/make-icons.py
"""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "build", "icons")
TRAY = os.path.join(ROOT, "resources", "tray")
os.makedirs(TRAY, exist_ok=True)


def blob_points(cx, cy, radius, phase=0.6, wobble=0.8, points=20, steps=24):
    """Точки контура: две гармоники радиуса и квадратичные кривые через
    середины отрезков — как в мак-версии, только развёрнутые в ломаную
    с мелким шагом для растеризации."""
    pts = []
    for i in range(points):
        theta = i / points * 2 * math.pi
        r = radius * (1 + wobble * 0.11 * math.sin(3 * theta + phase)
                      + wobble * 0.06 * math.sin(5 * theta - phase * 2))
        pts.append((cx + r * math.cos(theta), cy + r * math.sin(theta)))

    def mid(a, b):
        return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)

    out = []
    start = mid(pts[-1], pts[0])
    for i in range(points):
        cur = pts[i]
        nxt = pts[(i + 1) % points]
        end = mid(cur, nxt)
        for s in range(steps):
            t = s / steps
            x = (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * cur[0] + t ** 2 * end[0]
            y = (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * cur[1] + t ** 2 * end[1]
            out.append((x, y))
        start = end
    return out


def mark(size, color, flip_y=True):
    """Знак на прозрачном фоне. Суперсэмплинг ×8, чтобы края были гладкими."""
    k = 8
    big = size * k
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    c = big / 2
    radius = big / 2 * 0.86
    pts = blob_points(c, c, radius)
    if flip_y:  # в мак-версии значок трея рисуется в системе координат с осью Y вверх
        pts = [(x, big - y) for x, y in pts]
    draw.polygon(pts, fill=255)

    hole_r = radius * 0.16
    hole_d = radius * 0.55
    angle = -55.0 * math.pi / 180
    # Вырез вверху справа — там же, где на значке в строке меню мака.
    hx = c + hole_d * math.cos(angle)
    hy = c + hole_d * math.sin(angle)
    draw.ellipse([hx - hole_r, hy - hole_r, hx + hole_r, hy + hole_r], fill=0)

    solid = Image.new("RGBA", (big, big), color)
    img.paste(solid, (0, 0), mask)
    return img.resize((size, size), Image.LANCZOS)


def tray_icons():
    variants = {
        "light": (255, 255, 255, 255),   # для тёмной панели задач
        "dark": (32, 32, 36, 255),       # для светлой панели задач
        "connected": (52, 199, 89, 255), # systemGreen, как на маке
    }
    for name, color in variants.items():
        for size, suffix in ((16, ""), (32, "@2x"), (24, "@1.5x")):
            mark(size, color).save(os.path.join(TRAY, f"tray-{name}{suffix}.png"))


def app_icon():
    master = Image.open(os.path.join(ICONS, "AppIcon-master.png")).convert("RGBA")
    sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
    master.save(os.path.join(ICONS, "icon.ico"), sizes=[(s, s) for s in sizes])
    master.resize((256, 256), Image.LANCZOS).save(os.path.join(ICONS, "icon.png"))
    master.resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, "resources", "app-icon.png"))


if __name__ == "__main__":
    tray_icons()
    app_icon()
    print("ok")
