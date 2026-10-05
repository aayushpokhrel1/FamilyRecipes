"""Draws public/og.png, the 1200x630 link-preview card, in the Enamel Vault world.

Run it when the mark, the palette or the sign font changes, so the card that strangers see
stays the same product the app is. It was hand-made before, and it drifted: the card shipped
for weeks carrying the plate-and-dot mark that public/favicon.svg had already rejected as a
bullseye, because nothing tied the two together.

    python scripts/og-card.py <zilla-700.ttf> <zilla-600.ttf> <body-sans.ttf> public/og.png

The TTFs are not in the repo: the app ships Zilla Slab as woff2 (public/fonts), which Pillow
cannot read. Fetch the same OFL font as TTF from Google Fonts for this one job, and pass the
platform's UI sans for the body line (Segoe UI on Windows, Helvetica on macOS). The FONT is
the brand's, the file format is an implementation detail of this script.

Every colour below is a DESIGN.md token; none is invented here.
"""
from PIL import Image, ImageDraw, ImageFont
import sys

W, H = 1200, 630
SS = 2                      # supersample, then downscale: PIL has no antialiased shapes
w, h = W * SS, H * SS

WALL        = (31, 59, 52)
WALL_DEEP   = (22, 48, 42)
WALL_EDGE   = (16, 36, 32)
BONE        = (243, 237, 225)
BONE_SHADE  = (233, 225, 208)
RIM         = (22, 48, 42)
INK         = (24, 43, 37)
INK_SOFT    = (79, 96, 90)
VERMILION   = (181, 53, 20)
TIN         = (221, 210, 187)
TIN_INK     = (51, 48, 36)

ZILLA_700 = sys.argv[1]
ZILLA_600 = sys.argv[2]
SANS      = sys.argv[3]
OUT       = sys.argv[4]

def f(path, px):
    return ImageFont.truetype(path, px * SS)

def tracked(d, xy, text, font, fill, track=0, anchor_right=False):
    """PIL has no letter-spacing, and the Sign Rule needs tracked caps, so glyphs are set
    one at a time. Returns the advance so a caller can place something after it."""
    x, y = xy
    widths = [d.textlength(c, font=font) for c in text]
    total = sum(widths) + track * SS * (len(text) - 1)
    if anchor_right:
        x -= total
    for c, cw in zip(text, widths):
        d.text((x, y), c, font=font, fill=fill)
        x += cw + track * SS
    return total

img = Image.new("RGB", (w, h), WALL)
d = ImageDraw.Draw(img, "RGBA")

# The wall. A vertical fall from spruce to the deep shade, so the card has a top light like
# the app's own ground, plus a soft darkening into the bottom corners.
for y in range(h):
    t = y / h
    d.line([(0, y), (w, y)], fill=(
        round(WALL[0] + (WALL_EDGE[0] - WALL[0]) * t ** 1.3),
        round(WALL[1] + (WALL_EDGE[1] - WALL[1]) * t ** 1.3),
        round(WALL[2] + (WALL_EDGE[2] - WALL[2]) * t ** 1.3),
    ))

# The sign rail, the same chrome the app header wears.
RAIL = 96 * SS
d.rectangle([0, 0, w, RAIL], fill=WALL_DEEP)
d.rectangle([0, RAIL, w, RAIL + 1 * SS], fill=(243, 237, 225, 28))

# --- the mark: a bone pot with a vermilion lid, scaled from public/favicon.svg -------------
def mark(d, x, y, size):
    """favicon.svg at 32 units; every rect below is that geometry times size/32."""
    u = size / 32
    d.rounded_rectangle([x, y, x + 32 * u, y + 32 * u], radius=7 * u, fill=WALL)
    d.rounded_rectangle([x + 7 * u, y + 13 * u, x + 25 * u, y + 25 * u], radius=3 * u, fill=BONE)
    d.rounded_rectangle([x + 5.5 * u, y + 10 * u, x + 26.5 * u, y + 13.4 * u], radius=1.7 * u, fill=VERMILION)
    d.rounded_rectangle([x + 14.6 * u, y + 6.4 * u, x + 17.4 * u, y + 10.2 * u], radius=1.4 * u, fill=VERMILION)

MARK = 46 * SS
mark(d, 56 * SS, (RAIL - MARK) / 2, MARK)

rail_label = f(ZILLA_600, 21)
d_y = (RAIL - (rail_label.getbbox("H")[3] - rail_label.getbbox("H")[1])) / 2 - 4 * SS
tracked(d, (120 * SS, d_y), "THE ENAMEL VAULT", rail_label, (243, 237, 225, 200), track=3.4)
# A link preview should say where it goes.
tracked(d, (1144 * SS, d_y + 2 * SS), "RECIPES.ENAMELVAULT.COM", f(ZILLA_600, 18),
        (243, 237, 225, 130), track=2.6, anchor_right=True)

# --- the plate rack ------------------------------------------------------------------------
# Three plates, each higher and further right than the last, all running off the bottom edge.
# Cropping is what keeps this a photograph of a pantry wall rather than a slide: the rack
# continues past the frame.
def plate(base, x, y, pw, ph, letter, title, meta, signal, hidden_left=0):
    """hidden_left is how much of this plate the NEXT plate covers. Content centres on what
    stays VISIBLE, not on the plate: centring on the plate clipped the rear titles mid-word
    ("AL BHAT"), which reads as a mistake rather than as a crop."""
    # The shadow is drawn on its own layer so it can blur without smearing the plate.
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ds = ImageDraw.Draw(shadow)
    ds.rounded_rectangle([x - 6 * SS, y + 16 * SS, x + pw + 6 * SS, y + ph + 16 * SS],
                         radius=20 * SS, fill=(6, 18, 15, 150))
    from PIL import ImageFilter
    base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14 * SS)))

    dd = ImageDraw.Draw(base, "RGBA")
    dd.rounded_rectangle([x, y, x + pw, y + ph], radius=18 * SS, fill=BONE + (255,))
    # rim plus inner highlight: the two strokes that give every plate in this app its depth
    dd.rounded_rectangle([x, y, x + pw, y + ph], radius=18 * SS, outline=RIM + (255,), width=3 * SS)
    dd.arc([x + 4 * SS, y + 4 * SS, x + pw - 4 * SS, y + 4 * SS + 40 * SS],
           start=180, end=360, fill=(255, 255, 255, 150), width=2 * SS)

    # Centre on what is visible IN THE FRAME: the plate is cropped on the left by the plate
    # in front of it and on the right by the canvas edge, and ignoring the second one threw
    # the rear monogram half off the card.
    cx = (x + hidden_left + min(x + pw, w)) / 2
    mono = f(ZILLA_700, 104)
    mw = dd.textlength(letter, font=mono)
    dd.text((cx - mw / 2, y + 44 * SS), letter, font=mono,
            fill=(VERMILION if signal else INK_SOFT) + (255,))

    if not title:
        return
    tf = f(ZILLA_600, 19)
    tw = sum(dd.textlength(c, font=tf) for c in title) + 3.2 * SS * (len(title) - 1)
    tracked(dd, (cx - tw / 2, y + 186 * SS), title, tf, INK + (255,), track=3.2)

    # a tin label, the app's own chip
    mf = f(ZILLA_600, 14)
    mw2 = sum(dd.textlength(c, font=mf) for c in meta) + 2.4 * SS * (len(meta) - 1)
    chip_w, chip_h = mw2 + 26 * SS, 30 * SS
    dd.rounded_rectangle([cx - chip_w / 2, y + 226 * SS, cx + chip_w / 2, y + 226 * SS + chip_h],
                         radius=8 * SS, fill=TIN + (255,))
    tracked(dd, (cx - mw2 / 2, y + 233 * SS), meta, mf, TIN_INK + (255,), track=2.4)

base = img.convert("RGBA")
# Back to front. The last plate drawn is the nearest, and each one is covered on its left by
# the plate in front of it, which is what `hidden` tells it.
for x, y, letter, title, meta, signal, hidden in [
    (1052 * SS, 150 * SS, "A", "", "", False, 70 * SS),
    (864 * SS, 206 * SS, "D", "DAL BHAT", "EVERY DAY", False, 70 * SS),
    (676 * SS, 262 * SS, "M", "MOMO", "GRANDMA", True, 0),
]:
    plate(base, x, y, 258 * SS, 480 * SS, letter, title, meta, signal, hidden)
img = base.convert("RGB")
d = ImageDraw.Draw(img, "RGBA")

# --- the sign ------------------------------------------------------------------------------
sign = f(ZILLA_700, 118)
tracked(d, (56 * SS, 182 * SS), "FAMILY", sign, BONE, track=1.5)
tracked(d, (56 * SS, 302 * SS), "RECIPES", sign, BONE, track=1.5)

body = f(SANS, 27)
for i, line in enumerate([
    "Recipes, photos and the stories behind",
    "them, kept for the people who cook them.",
]):
    d.text((58 * SS, (452 + i * 38) * SS), line, font=body, fill=(243, 237, 225, 190))

img = img.resize((W, H), Image.LANCZOS)
img.save(OUT, optimize=True)
print("wrote", OUT)
