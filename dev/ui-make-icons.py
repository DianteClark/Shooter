#!/usr/bin/env python3
"""Draws the app icon: a faceted crosshair around a stubby low-poly gun silhouette, on dusk steel.
Renders at 4x and downsamples for clean edges. Usage: python3 dev/ui-make-icons.py"""
import math, os, random
from PIL import Image, ImageDraw

S = 2048
DUSK_TOP, DUSK_LOW = (46, 44, 66), (150, 90, 86)
CHALK = (231, 234, 228)
SODIUM = (242, 166, 59)
STEEL = (47, 57, 68)
RED = (255, 77, 61)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def facet_background(draw):
    # Low-poly dusk: jittered triangles, darker overhead, glowing toward the south-east corner.
    random.seed(4417)
    n = 8
    cell = S / n
    pts = [[(c * cell + (0 if c in (0, n) else random.uniform(-.34, .34) * cell),
             r * cell + (0 if r in (0, n) else random.uniform(-.34, .34) * cell)) for c in range(n + 1)] for r in range(n + 1)]
    for r in range(n):
        for c in range(n):
            a, b, d, e = pts[r][c], pts[r][c + 1], pts[r + 1][c], pts[r + 1][c + 1]
            tris = [(a, b, d), (b, e, d)] if random.random() > .5 else [(a, b, e), (a, e, d)]
            for tri in tris:
                cx = sum(p[0] for p in tri) / 3 / S
                cy = sum(p[1] for p in tri) / 3 / S
                t = min(1, max(0, (cy * .85 + cx * .3 - .12) + random.uniform(-.05, .05)))
                draw.polygon(tri, fill=lerp(DUSK_TOP, DUSK_LOW, t))


def ring_polygon(cx, cy, r0, r1, sides, a0, a1):
    outer = [(cx + r1 * math.cos(a0 + (a1 - a0) * i / sides), cy + r1 * math.sin(a0 + (a1 - a0) * i / sides)) for i in range(sides + 1)]
    inner = [(cx + r0 * math.cos(a0 + (a1 - a0) * i / sides), cy + r0 * math.sin(a0 + (a1 - a0) * i / sides)) for i in range(sides, -1, -1)]
    return outer + inner


def main():
    bg = Image.new('RGB', (S, S), STEEL)
    facet_background(ImageDraw.Draw(bg))
    # The mark is drawn on its own layer, so the maskable icons can shrink it into Android's safe circle.
    fg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(fg)

    cx, cy = S * .5, S * .5
    R0, R1 = S * .33, S * .405
    # Faceted ring, broken into four arcs so the gaps read as a crosshair.
    gap = .22
    for q in range(4):
        a = q * math.pi / 2 + gap
        b = (q + 1) * math.pi / 2 - gap
        d.polygon(ring_polygon(cx, cy, R0, R1, 3, a, b), fill=CHALK)
    # Crosshair ticks, reaching in from the gaps.
    tw = S * .04
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        px, py = -dy, dx
        o0, o1 = R0 - S * .13, R1 + S * .05
        p = [(cx + dx * o0 + px * tw, cy + dy * o0 + py * tw), (cx + dx * o1 + px * tw, cy + dy * o1 + py * tw),
             (cx + dx * o1 - px * tw, cy + dy * o1 - py * tw), (cx + dx * o0 - px * tw, cy + dy * o0 - py * tw)]
        d.polygon(p, fill=SODIUM)

    # A chunky low-poly gun profile, facing east, sitting across the centre.
    g = S / 100
    ox, oy = cx - 37 * g, cy - 6 * g
    body = [(0, 2), (40, 2), (46, 5), (46, 12), (24, 14), (20, 22), (10, 22), (12, 14), (0, 12)]
    d.polygon([(ox + x * g * 1.05, oy + y * g * 1.05) for x, y in body], fill=(29, 35, 43))
    barrel = [(46, 5), (73, 5), (73, 10), (46, 11)]
    d.polygon([(ox + x * g * 1.05, oy + y * g * 1.05) for x, y in barrel], fill=(29, 35, 43))
    accent = [(8, 4), (34, 4), (32, 8), (6, 8)]
    d.polygon([(ox + x * g * 1.05, oy + y * g * 1.05) for x, y in accent], fill=RED)

    assets = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
    os.makedirs(assets, exist_ok=True)
    im = bg.copy()
    im.paste(fg, (0, 0), fg)
    for size in (180, 192, 512):
        im.resize((size, size), Image.LANCZOS).save(os.path.join(assets, f'icon-{size}.png'), optimize=True)
    # Maskable (Android adaptive icons): the launcher may crop to a circle of 80% of the width, so the mark is scaled
    # to fit inside it (the ring reaches 0.455 of the width from the centre; 0.78 of that is 0.355) over the full bleed.
    k = 0.78
    small = fg.resize((int(S * k), int(S * k)), Image.LANCZOS)
    mk = bg.copy()
    off = (S - small.width) // 2
    mk.paste(small, (off, off), small)
    for size in (192, 512):
        mk.resize((size, size), Image.LANCZOS).save(os.path.join(assets, f'icon-maskable-{size}.png'), optimize=True)


main()
