#!/usr/bin/env python3
"""Builds the two faces used by the whole interface and inlines them in css/fonts.css.

Railyard Stencil: heavy, with the bridges a freight-car stencil plate needs. Headings and big numerals.
Railyard Plate:   the same skeleton, lighter and unbroken. Everything that has to stay legible at 11 px.

Glyphs are centre-line polylines on a 7-high grid, so every corner is a deliberate 45-ish degree chamfer.
Digits share one advance width, which keeps the timer and ammo counter from jittering.

Run with fonttools, shapely and brotli available:  python dev/ui-make-font.py
"""
import base64, io, os, sys
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from shapely.geometry import LineString, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOF = [(0, 5.5), (1.2, 7), (2.8, 7), (4, 5.5)]
OVAL = [(1, 0), (3, 0), (4, 1), (4, 6), (3, 7), (1, 7), (0, 6), (0, 1), (1, 0)]

# name: (grid width, [polylines], [stencil cuts as (x, y, 'v'|'h')])
G = {
 'A': (4, [[(0, 0)] + ROOF + [(4, 0)], [(0, 3), (4, 3)]], [(2, 7, 'v'), (1.2, 3, 'v')]),
 'B': (4, [[(0, 0), (0, 7), (3, 7), (4, 6), (4, 4.6), (3, 3.6), (0, 3.6)], [(3, 3.6), (4, 2.6), (4, 1), (3, 0), (0, 0)]], [(1.6, 7, 'v'), (1.6, 3.6, 'v'), (1.6, 0, 'v')]),
 'C': (4, [[(4, 5.4), (4, 6), (3, 7), (1, 7), (0, 6), (0, 1), (1, 0), (3, 0), (4, 1), (4, 1.6)]], [(2, 7, 'v'), (2, 0, 'v')]),
 'D': (4, [[(0, 0), (0, 7), (2.8, 7), (4, 5.8), (4, 1.2), (2.8, 0), (0, 0)]], [(1.6, 7, 'v'), (1.6, 0, 'v')]),
 'E': (3.7, [[(3.7, 7), (0, 7), (0, 0), (3.7, 0)], [(0, 3.6), (3, 3.6)]], [(1, 7, 'v'), (1, 3.6, 'v'), (1, 0, 'v')]),
 'F': (3.7, [[(3.7, 7), (0, 7), (0, 0)], [(0, 3.6), (3, 3.6)]], [(1, 7, 'v'), (1, 3.6, 'v')]),
 'G': (4, [[(4, 5.4), (4, 6), (3, 7), (1, 7), (0, 6), (0, 1), (1, 0), (4, 0), (4, 3.2), (2.2, 3.2)]], [(2, 7, 'v'), (2, 0, 'v')]),
 'H': (4, [[(0, 0), (0, 7)], [(4, 0), (4, 7)], [(0, 3.6), (4, 3.6)]], [(1, 3.6, 'v'), (3, 3.6, 'v')]),
 'I': (0, [[(0, 0), (0, 7)]], []),
 'J': (3.6, [[(3.6, 7), (3.6, 1), (2.6, 0), (1, 0), (0, 1), (0, 2)]], [(1.8, 0, 'v')]),
 'K': (4, [[(0, 0), (0, 7)], [(0, 3.4), (1.4, 3.4), (4, 7)], [(1.4, 3.4), (4, 0)]], [(0.8, 3.4, 'v')]),
 'L': (3.5, [[(0, 7), (0, 0), (3.5, 0)]], [(1, 0, 'v')]),
 'M': (5, [[(0, 0), (0, 7), (2.5, 3), (5, 7), (5, 0)]], []),
 'N': (4, [[(0, 0), (0, 7), (4, 0), (4, 7)]], []),
 'O': (4, [OVAL], [(2, 7, 'v'), (2, 0, 'v')]),
 'P': (4, [[(0, 0), (0, 7), (3, 7), (4, 6), (4, 4), (3, 3), (0, 3)]], [(1.6, 7, 'v'), (1.6, 3, 'v')]),
 'Q': (4, [OVAL, [(2.5, 1.5), (4, 0)]], [(2, 7, 'v')]),
 'R': (4, [[(0, 0), (0, 7), (3, 7), (4, 6), (4, 4), (3, 3), (0, 3)], [(2.4, 3), (4, 0)]], [(1.6, 7, 'v'), (1.6, 3, 'v')]),
 'S': (4, [[(4, 5.5), (4, 6), (3, 7), (1, 7), (0, 6), (0, 4.6), (1, 3.6), (3, 3.6), (4, 2.6), (4, 1), (3, 0), (1, 0), (0, 1), (0, 1.5)]], [(2, 7, 'v'), (2, 3.6, 'v'), (2, 0, 'v')]),
 'T': (4, [[(0, 7), (4, 7)], [(2, 7), (2, 0)]], [(2, 5.6, 'h')]),
 'U': (4, [[(0, 7), (0, 1), (1, 0), (3, 0), (4, 1), (4, 7)]], [(2, 0, 'v')]),
 'V': (4, [[(0, 7), (0, 2.6), (2, 0), (4, 2.6), (4, 7)]], [(2, 0.5, 'v')]),
 'W': (5, [[(0, 7), (0, 0), (2.5, 4), (5, 0), (5, 7)]], []),
 'X': (4, [[(0, 7), (4, 0)], [(4, 7), (0, 0)]], []),
 'Y': (4, [[(0, 7), (2, 3.4), (4, 7)], [(2, 3.4), (2, 0)]], [(2, 2.4, 'h')]),
 'Z': (4, [[(0, 7), (4, 7), (0, 0), (4, 0)]], []),
 '0': (4, [OVAL, [(2, 2.5), (2, 4.5)]], [(2, 7, 'v'), (2, 0, 'v')]),
 '1': (4, [[(0.6, 5.6), (2.2, 7), (2.2, 0)], [(0.4, 0), (4, 0)]], [(2.2, 1.2, 'h')]),
 '2': (4, [[(0, 5.5), (0, 6), (1, 7), (3, 7), (4, 6), (4, 4.4), (0, 0), (4, 0)]], [(2, 7, 'v')]),
 '3': (4, [[(0, 6), (1, 7), (3, 7), (4, 6), (4, 4.6), (3, 3.6), (1.4, 3.6)], [(3, 3.6), (4, 2.6), (4, 1), (3, 0), (1, 0), (0, 1)]], [(2, 7, 'v'), (2, 0, 'v')]),
 '4': (4, [[(3, 0), (3, 7), (0, 2.2), (4, 2.2)]], [(3, 1.2, 'h')]),
 '5': (4, [[(4, 7), (0, 7), (0, 3.8), (3, 3.8), (4, 2.8), (4, 1), (3, 0), (1, 0), (0, 1)]], [(1.6, 7, 'v'), (2, 0, 'v')]),
 '6': (4, [[(4, 6), (3, 7), (1, 7), (0, 6), (0, 1), (1, 0), (3, 0), (4, 1), (4, 2.8), (3, 3.8), (0, 3.8)]], [(2, 7, 'v'), (2, 3.8, 'v'), (2, 0, 'v')]),
 '7': (4, [[(0, 7), (4, 7), (1.4, 0)]], [(2.6, 3.6, 'h')]),
 '8': (4, [[(1, 3.6), (0, 4.6), (0, 6), (1, 7), (3, 7), (4, 6), (4, 4.6), (3, 3.6), (1, 3.6), (0, 2.6), (0, 1), (1, 0), (3, 0), (4, 1), (4, 2.6), (3, 3.6)]], [(2, 7, 'v'), (2, 3.6, 'v'), (2, 0, 'v')]),
 '9': (4, [[(0, 1), (1, 0), (3, 0), (4, 1), (4, 6), (3, 7), (1, 7), (0, 6), (0, 4.2), (1, 3.2), (4, 3.2)]], [(2, 7, 'v'), (2, 3.2, 'v'), (2, 0, 'v')]),
 'period': (0, [[(0, 0), (0, 0.9)]], []),
 'comma': (0.6, [[(0.6, 0.9), (0.6, 0), (0, -1)]], []),
 'hyphen': (2.4, [[(0, 3.2), (2.4, 3.2)]], []),
 'underscore': (3.4, [[(0, 0), (3.4, 0)]], []),
 'exclam': (0, [[(0, 2.2), (0, 7)], [(0, 0), (0, 0.9)]], []),
 'question': (3.6, [[(0, 5.5), (0, 6), (1, 7), (2.6, 7), (3.6, 6), (3.6, 4.6), (1.8, 3), (1.8, 2)], [(1.8, 0), (1.8, 0.9)]], []),
 'quotesingle': (0, [[(0, 5), (0, 7)]], []),
 'quotedbl': (1.4, [[(0, 5), (0, 7)], [(1.4, 5), (1.4, 7)]], []),
 'colon': (0, [[(0, 4.4), (0, 5.4)], [(0, 1.2), (0, 2.2)]], []),
 'slash': (3, [[(0, 0), (3, 7)]], []),
 'plus': (3.4, [[(0, 3.4), (3.4, 3.4)], [(1.7, 1.7), (1.7, 5.1)]], []),
 'equal': (3.4, [[(0, 4.4), (3.4, 4.4)], [(0, 2.4), (3.4, 2.4)]], []),
 'asterisk': (2.8, [[(1.4, 2.8), (1.4, 7)], [(0, 3.8), (2.8, 6)], [(2.8, 3.8), (0, 6)]], []),
 'percent': (5, [[(0, 0), (5, 7)], [(0, 7), (1.6, 7), (1.6, 4.8), (0, 4.8), (0, 7)], [(3.4, 2.2), (5, 2.2), (5, 0), (3.4, 0), (3.4, 2.2)]], []),
 'numbersign': (4, [[(1.3, 0), (1.3, 7)], [(2.8, 0), (2.8, 7)], [(0, 4.7), (4, 4.7)], [(0, 2.3), (4, 2.3)]], []),
 'parenleft': (1.5, [[(1.5, 7.5), (0, 6), (0, 1), (1.5, -0.5)]], []),
 'parenright': (1.5, [[(0, 7.5), (1.5, 6), (1.5, 1), (0, -0.5)]], []),
 'bracketleft': (1.5, [[(1.5, 7.4), (0, 7.4), (0, -0.4), (1.5, -0.4)]], []),
 'bracketright': (1.5, [[(0, 7.4), (1.5, 7.4), (1.5, -0.4), (0, -0.4)]], []),
 'greater': (3, [[(0, 6), (3, 3.5), (0, 1)]], []),
 'less': (3, [[(3, 6), (0, 3.5), (3, 1)]], []),
 'ampersand': (4.4, [[(4.4, 0), (0.6, 4.8), (0.6, 6), (1.6, 7), (2.6, 7), (3.4, 6), (3.4, 5), (0, 2.6), (0, 1), (1, 0), (2.8, 0), (4.4, 2.6)]], []),
}
CHARS = {c: c for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'}
CHARS.update({str(d): str(d) for d in range(10)})
PUNCT = {'.': 'period', ',': 'comma', '-': 'hyphen', '_': 'underscore', '!': 'exclam', '?': 'question', "'": 'quotesingle',
         '"': 'quotedbl', ':': 'colon', '/': 'slash', '+': 'plus', '=': 'equal', '*': 'asterisk', '%': 'percent', '#': 'numbersign',
         '(': 'parenleft', ')': 'parenright', '[': 'bracketleft', ']': 'bracketright', '>': 'greater', '<': 'less', '&': 'ampersand'}

CAP = 700


def build(family, stroke, gap, side, tracking_width):
    unit = (CAP - stroke) / 7
    # The stencil face is display-only and heavy; its zero loses the inner tick that the plate face uses to stay
    # distinct from O, and digits keep only top and bottom bridges so they stay open at HUD sizes.
    defs = dict(G)
    if gap:
        defs['0'] = (4, [OVAL], [])
        for d in '689':
            w, lines, cuts = defs[d]
            defs[d] = (w, lines, [c for c in cuts if c[1] in (7, 0)])
    glyphs, advance = {}, {}
    pen = TTGlyphPen(None)
    glyphs['.notdef'] = pen.glyph(); advance['.notdef'] = (300, 0)
    pen = TTGlyphPen(None)
    glyphs['space'] = pen.glyph(); advance['space'] = (int(unit * 2.2) , 0)

    for name, (w, lines, cuts) in defs.items():
        ox = stroke / 2
        oy = stroke / 2
        pts = lambda line: [(ox + x * unit * tracking_width, oy + y * unit) for x, y in line]
        shapes = []
        for line in lines:
            shapes.append(LineString(pts(line)).buffer(stroke / 2, cap_style='flat', join_style='mitre', mitre_limit=3))
            # Flat caps leave the stroke ends short of the box: extend them so terminals land on the cap line and baseline.
            for end in (line[0], line[-1]):
                ex, ey = pts([end])[0]
                shapes.append(box(ex - stroke / 2, ey - stroke / 2, ex + stroke / 2, ey + stroke / 2))
        shape = unary_union(shapes)
        # Mitred diagonals overshoot; clipping to the box keeps the cap line razor flat.
        width = w * unit * tracking_width + stroke
        depth = -stroke if name == 'comma' else (-unit * 0.6 if name in ('parenleft', 'parenright', 'bracketleft', 'bracketright') else 0)
        top = CAP + (unit * 0.6 if name in ('parenleft', 'parenright', 'bracketleft', 'bracketright') else 0)
        shape = shape.intersection(box(0, depth, width, top))
        if gap:
            for cx, cy, kind in cuts:
                x, y = ox + cx * unit * tracking_width, oy + cy * unit
                if kind == 'v':
                    shape = shape.difference(box(x - gap / 2, y - stroke, x + gap / 2, y + stroke))
                else:
                    shape = shape.difference(box(x - stroke, y - gap / 2, x + stroke, y + gap / 2))
        shape = shape.simplify(0.5)
        pen = TTGlyphPen(None)
        polys = list(shape.geoms) if shape.geom_type == 'MultiPolygon' else [shape]
        for poly in polys:
            poly = orient(poly, sign=-1.0)
            for ring in [poly.exterior] + list(poly.interiors):
                coords = [(round(x), round(y)) for x, y in ring.coords[:-1]]
                pen.moveTo(coords[0])
                for c in coords[1:]:
                    pen.lineTo(c)
                pen.closePath()
        glyphs[name] = pen.glyph()
        advance[name] = (int(round(width + side * 2)), 0)
        # Shift outline by the left side bearing.
        g = glyphs[name]
        if g.numberOfContours > 0:
            g.coordinates.translate((side, 0))

    cmap = {32: 'space', 0xA0: 'space'}
    for c, g in {**CHARS, **PUNCT}.items():
        cmap[ord(c)] = g
        if c.isalpha():
            cmap[ord(c.lower())] = g

    order = ['.notdef', 'space'] + [g for g in G]
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf({g: glyphs[g] for g in order})
    meta = {g: (advance[g][0], glyphs[g].xMin if glyphs[g].numberOfContours else 0) for g in order}
    fb.setupHorizontalMetrics(meta)
    fb.setupHorizontalHeader(ascent=860, descent=-180)
    fb.setupNameTable({'familyName': family, 'styleName': 'Regular'})
    fb.setupOS2(sTypoAscender=860, sTypoDescender=-180, usWinAscent=880, usWinDescent=200, sCapHeight=700, sxHeight=700)
    fb.setupPost()
    fb.font.flavor = 'woff2'
    buf = io.BytesIO()
    fb.font.save(buf)
    return buf.getvalue()


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    faces = [('Railyard Stencil', build('Railyard Stencil', 158, 40, 34, 0.92)),
             ('Railyard Plate', build('Railyard Plate', 96, 0, 38, 0.86))]
    css = ['/* Generated by dev/ui-make-font.py. Do not edit. */']
    for family, data in faces:
        b64 = base64.b64encode(data).decode()
        css.append(f"@font-face{{font-family:'{family}';src:url(data:font/woff2;base64,{b64}) format('woff2');font-display:block}}")
        print(family, len(data), 'bytes', file=sys.stderr)
    with open(os.path.join(root, 'css', 'fonts.css'), 'w') as f:
        f.write('\n'.join(css) + '\n')


main()
