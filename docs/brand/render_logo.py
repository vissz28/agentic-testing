"""Renders plugins/quality-code/assets/logo.png from the same geometry as logo.svg.

There is no SVG rasteriser in the toolchain, so the shapes are drawn with Pillow at 4x and scaled
down for smooth edges. Keep the numbers in step with logo.svg.

    python3 docs/brand/render_logo.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'plugins/quality-code/assets/logo.png'
SIZE, SS = 512, 4
DARK, BLUE, LIGHT, WHITE = (0x00, 0x50, 0x75), (0x00, 0x90, 0xD1), (0x00, 0xC3, 0xEA), (255, 255, 255)


def s(v):
    return v * SS


def stroke(draw, points, colour, width):
    pts = [(s(x), s(y)) for x, y in points]
    draw.line(pts, fill=colour, width=s(width), joint='curve')
    r = s(width) / 2
    for x, y in pts:
        draw.ellipse((x - r, y - r, x + r, y + r), fill=colour)


def main():
    big = SIZE * SS
    # Diagonal gradient, top-left DARK to bottom-right BLUE, clipped to the rounded square.
    grad = Image.new('RGB', (big, big))
    px = grad.load()
    for y in range(big):
        for x in range(big):
            t = (x + y) / (2 * (big - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(DARK, BLUE))
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((s(16), s(16), s(496), s(496)), radius=s(112), fill=255)
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)
    draw = ImageDraw.Draw(img)
    stroke(draw, [(164, 148), (84, 256), (164, 364)], WHITE, 40)
    stroke(draw, [(348, 148), (428, 256), (348, 364)], WHITE, 40)
    stroke(draw, [(190, 262), (236, 310), (324, 206)], LIGHT, 44)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.resize((SIZE, SIZE), Image.LANCZOS).save(OUT, optimize=True)
    print(OUT)


if __name__ == '__main__':
    main()
