"""Regenerates the installer artwork (BMP files). Run: python make-assets.py  (needs Pillow). Colours match the app's brand blue + teal."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
HERE = os.path.dirname(os.path.abspath(__file__))
ICON = Image.open(os.path.join(HERE, '..', '..', 'app-icon.png')).convert('RGBA')
FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'
FONT_R = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf'
if not os.path.exists(FONT_B): FONT_B = FONT_R = None  # Windows: falls back to PIL's default font
def font(path, size): return ImageFont.truetype(path, size) if path else ImageFont.load_default()
BLUE_TOP, BLUE_BOT, TEAL = (74, 102, 240), (35, 56, 176), (20, 184, 166)

def panel(w, h):
    img = Image.new('RGB', (w, h)); px = img.load()
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(BLUE_TOP[i] + (BLUE_BOT[i] - BLUE_TOP[i]) * t) for i in range(3))
        for x in range(w): px[x, y] = c
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(glow)
    d.ellipse((-w * .4, h * .62, w * 1.4, h * 1.35), fill=TEAL + (150,))
    glow = glow.filter(ImageFilter.GaussianBlur(28))
    img.paste(glow, (0, 0), glow)
    return img

def logo(size):
    i = ICON.resize((size, size), Image.LANCZOS); return i

def sidebar(w=164, h=314):
    img = panel(w, h); d = ImageDraw.Draw(img)
    img.paste(logo(76), (w // 2 - 38, 34), logo(76))
    d.text((w // 2, 132), 'Library', font=font(FONT_B, 22), fill='white', anchor='mm')
    d.text((w // 2, 158), 'Medicine', font=font(FONT_B, 22), fill='white', anchor='mm')
    d.text((w // 2, 190), 'OFFLINE DATA COLLECTION', font=font(FONT_R, 8), fill=(214, 224, 255), anchor='mm')
    for i, t in enumerate(['Works without internet', 'Syncs automatically', 'Statistics & reports']):
        y = 238 + i * 20
        d.ellipse((16, y - 4, 24, y + 4), fill=(255, 255, 255)); d.text((32, y), t, font=font(FONT_R, 10), fill='white', anchor='lm')
    return img

def header(w=150, h=57):
    img = Image.new('RGB', (w, h), 'white'); d = ImageDraw.Draw(img)
    img.paste(logo(38), (10, 9), logo(38))
    d.text((56, 22), 'Library', font=font(FONT_B, 14), fill=(11, 27, 46), anchor='lm')
    d.text((56, 38), 'Medicine', font=font(FONT_B, 14), fill=(45, 75, 216), anchor='lm')
    return img

def banner(w=493, h=58):
    img = Image.new('RGB', (w, h), 'white'); d = ImageDraw.Draw(img)
    img.paste(logo(40), (w - 56, 9), logo(40))
    d.rectangle((0, h - 3, w, h), fill=(45, 75, 216))
    return img

def dialog(w=493, h=312):
    img = Image.new('RGB', (w, h), 'white'); img.paste(sidebar(164, h), (0, 0)); return img

for name, im in [('sidebar.bmp', sidebar()), ('header.bmp', header()), ('wix-banner.bmp', banner()), ('wix-dialog.bmp', dialog())]:
    im.save(os.path.join(HERE, name), 'BMP'); print(name, im.size)
