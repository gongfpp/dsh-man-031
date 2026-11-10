"""Three review-only icon compositions. No image-generation API or runtime writes."""
from pathlib import Path
import hashlib
import json
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dev' / 'icon-concepts'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = ROOT / 'assets' / 'kobe.png'
ICON = ROOT / 'icon.png'
BEFORE = hashlib.sha256(ICON.read_bytes()).hexdigest()
PHOTO = Image.open(SOURCE).convert('RGBA')
S = 2
N = 512
INK = '#182232'
AMBER = '#FFB52B'
FONT = Path('C:/Windows/Fonts/arialbd.ttf')
ZH_FONT = Path('C:/Windows/Fonts/msyhbd.ttc')

def box(v):
    return tuple(round(x * S) for x in v)

def font(size, zh=False):
    return ImageFont.truetype(str(ZH_FONT if zh else FONT), round(size * S))

def line(d, pts, fill=INK, width=5):
    d.line([box(p) for p in pts], fill=fill, width=round(width * S), joint='curve')

def rounded(d, rect, radius=18, fill='white', outline=None, width=1):
    d.rounded_rectangle(box(rect), radius=round(radius * S), fill=fill, outline=outline, width=round(width * S))

def center(d, rect, text, size, fill=INK, stroke=0, stroke_fill=INK):
    f = font(size)
    while d.textbbox((0, 0), text, font=f, stroke_width=round(stroke * S))[2] > (rect[2]-rect[0]-14) * S:
        size -= 1
        f = font(size)
    b = d.textbbox((0, 0), text, font=f, stroke_width=round(stroke * S))
    x = (rect[0]+rect[2]) * S/2 - (b[0]+b[2])/2
    y = (rect[1]+rect[3]) * S/2 - (b[1]+b[3])/2
    d.text((x, y), text, font=f, fill=fill, stroke_width=round(stroke*S), stroke_fill=stroke_fill)

def canvas(top, bottom):
    img = Image.new('RGBA', (N*S, N*S))
    d = ImageDraw.Draw(img)
    a = tuple(bytes.fromhex(top.lstrip('#')))
    b = tuple(bytes.fromhex(bottom.lstrip('#')))
    for y in range(N*S):
        t = y / (N*S-1)
        c = tuple(round(a[i]*(1-t)+b[i]*t) for i in range(3))
        d.line((0, y, N*S, y), fill=c+(255,))
    return img

def portrait(img, width, pos, crop_bottom=680):
    p = PHOTO.crop((0, 0, 640, crop_bottom))
    p = p.resize((round(width*S), round(crop_bottom/640*width*S)), Image.Resampling.LANCZOS)
    img.alpha_composite(p, box(pos))

def finish(img):
    mask = Image.new('L', img.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width-1, img.height-1), radius=64*S, fill=255)
    img.putalpha(mask)
    return img.resize((512, 512), Image.Resampling.LANCZOS)

def receipt_badge(img, rect):
    x0, y0, x1, y1 = rect
    d = ImageDraw.Draw(img)
    rounded(d, (x0+3,y0+5,x1+3,y1+5), 12, '#16223555')
    pts = [(x0,y0),(x1,y0),(x1,y1-9)]
    step = (x1-x0)/8
    pts += [(x1-i*step, y1-(0 if i%2 else 9)) for i in range(9)]
    pts += [(x0,y0)]
    d.polygon([box(p) for p in pts], fill='white')
    line(d, pts, INK, 5)
    center(d, (x0+3,y0+7,x1-3,y0+56), '¥', 48)
    line(d, [(x0+13,y0+65),(x1-13,y0+65)], '#9BA9B9', 4)
    line(d, [(x0+13,y0+77),(x1-26,y0+77)], '#9BA9B9', 4)

# A: original photo, comic shout, compact receipt with a currency symbol.
a = canvas('#DFF5FF', '#A7DCF3')
ad = ImageDraw.Draw(a)
ad.ellipse(box((175,0,560,385)), fill='#FFFFFF55')
portrait(a, 500, (30,0))
ad = ImageDraw.Draw(a)
ad.polygon([box(p) for p in [(140,93),(188,131),(173,82)]], fill=AMBER)
line(ad, [(140,93),(188,131),(173,82)], INK, 7)
rounded(ad, (11,22,197,108), 20, AMBER, INK, 7)
center(ad, (13,22,194,106), 'MAN!', 61, 'white', 2.5)
receipt_badge(a, (398,386,493,496))
a = finish(a)

# B: tilted physical receipt with a smaller photo and a clear accounting footer.
b = canvas('#FFDC8D', '#F4A548')
paper = Image.new('RGBA', (N*S,N*S))
pd = ImageDraw.Draw(paper)
paper_pts = [(54,17),(458,17),(458,470)]
paper_pts += [(458-i*(404/14),482 if i%2 else 470) for i in range(15)]
paper_pts += [(54,17)]
pd.polygon([box(p) for p in paper_pts], fill='#FFFEF8')
line(pd,paper_pts,INK,6)
rounded(pd,(85,33,425,108),14,AMBER)
center(pd,(87,32,423,108),'MAN!',77)
# The Chinese tea print remains above the footer.
portrait(paper, 320, (94,108),655)
pd = ImageDraw.Draw(paper)
line(pd,[(78,428),(434,428)],'#D0D5DA',3)
center(pd,(83,433,159,477),'¥',48, '#CC7100')
line(pd,[(176,446),(414,446)],INK,6)
line(pd,[(176,462),(341,462)],'#87929D',5)
paper = paper.rotate(5,Image.Resampling.BICUBIC,center=(256*S,256*S))
shadow = Image.new('RGBA',paper.size,(0,0,0,0))
shadow.putalpha(paper.getchannel('A').point(lambda p: round(p*.20)))
shadow = shadow.filter(ImageFilter.GaussianBlur(6*S))
b.alpha_composite(shadow,(4*S,8*S))
b.alpha_composite(paper)
b = finish(b)

# C: the largest negative space, a punchy shout and an audio/currency coin badge.
c = canvas('#E6F7FF', '#B0E4ED')
cd = ImageDraw.Draw(c)
cd.ellipse(box((95,47,494,448)),fill='#FFFFFF77')
portrait(c,460,(18,10),715)
cd = ImageDraw.Draw(c)
points = []
for i in range(24):
    angle = math.radians(-90+i*15)
    radius = 90 if i%2 == 0 else 77
    points.append((103+math.cos(angle)*radius,79+math.sin(angle)*radius*.70))
cd.polygon([box(p) for p in points],fill='#FF8A29')
line(cd,points+[points[0]],INK,5)
center(cd,(13,36,193,117),'MAN!',59,'white',2.5)
# Two outward broadcast arcs, clear of the face and central tea lettering.
cd.arc(box((392,323,490,421)),220,310,fill=INK,width=5*S)
cd.arc(box((377,308,505,436)),220,310,fill=INK,width=5*S)
cd.ellipse(box((377,392,503,518)),fill='#18304444')
cd.ellipse(box((374,380,500,506)),fill='#EE991C',outline=INK,width=5*S)
cd.ellipse(box((384,390,490,496)),fill='#FFD458',outline='#FFF1B5',width=4*S)
center(cd,(388,392,486,491),'¥',78)
c = finish(c)

files = [('A-comic-receipt.png',a),('B-receipt-sticker.png',b),('C-coin-broadcast.png',c)]
for name, img in files:
    img.save(OUT/name,optimize=True)

# Design comparison only, not a fabricated application screenshot.
board = Image.new('RGB',(1536,730),'#F1F4F8')
bd = ImageDraw.Draw(board)
labels = ['A  漫画到账','B  账单贴纸','C  金币播报']
for i, ((name,img),label) in enumerate(zip(files,labels)):
    x = i*512
    bd.text((x+36,23),label,font=ImageFont.truetype(str(ZH_FONT),30),fill=INK)
    thumb = img.resize((440,440),Image.Resampling.LANCZOS)
    board.paste(thumb,(x+36,80),thumb)
    bd.text((x+39,554),'64 px',font=ImageFont.truetype(str(FONT),18),fill='#576779')
    bd.text((x+174,554),'32 px',font=ImageFont.truetype(str(FONT),18),fill='#576779')
    bd.text((x+294,554),'深色底',font=ImageFont.truetype(str(ZH_FONT),18),fill='#576779')
    for px,size,dark in [(x+36,64,False),(x+176,32,False),(x+293,64,True)]:
        tile=(px,588,px+94,682)
        bd.rounded_rectangle(tile,radius=14,fill='#202939' if dark else '#FFFFFF')
        tiny=img.resize((size,size),Image.Resampling.LANCZOS)
        board.paste(tiny,(px+(94-size)//2,588+(94-size)//2),tiny)
board.save(OUT/'comparison.png',optimize=True)
assert hashlib.sha256(ICON.read_bytes()).hexdigest() == BEFORE, 'Runtime icon was modified'
report={'method':'Pillow local photo composition; no image-generation API','sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'runtimeIconUnchanged':True,'runtimeIconSha256':BEFORE,'outputs':[{'file':name,'size':[512,512],'sha256':hashlib.sha256((OUT/name).read_bytes()).hexdigest()} for name,_ in files]}
(OUT/'render.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(report,ensure_ascii=False))
