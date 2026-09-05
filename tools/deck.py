#!/usr/bin/env python3
"""
SAAHAA · tools/deck.py — builds docs/presentation.html from a manifest of
screenshots. One self-contained HTML file (images inlined as data URIs), so it
opens anywhere with a double-click and survives being emailed.

    python tools/deck.py docs/deck/manifest.json

Manifest shape:
{
  "title": "SAAHAA — how it works",
  "sections": [
    { "id": "customer", "title": "Customer", "intro": "…",
      "slides": [ { "title": "…", "caption": "…", "image": "docs/deck/c01.png", "note": "optional" } ] }
  ]
}
"""
import base64, io, json, os, sys, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
manifest_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'docs', 'deck', 'manifest.json')
m = json.load(io.open(manifest_path, encoding='utf-8'))

def data_uri(rel):
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        return ''
    ext = os.path.splitext(p)[1].lower().lstrip('.')
    mime = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'webp': 'image/webp', 'svg': 'image/svg+xml'}.get(ext, 'image/png')
    return f'data:{mime};base64,' + base64.b64encode(io.open(p, 'rb').read()).decode('ascii')

E = html.escape
slides = []
n = 0
slides.append(f'''<section class="slide cover" id="s0">
  <div class="cv"><div class="wm">SAAHAA</div>
  <h1>{E(m.get("title", "How SAAHAA works"))}</h1>
  <p class="sub">{E(m.get("subtitle", ""))}</p>
  <p class="meta">{E(m.get("date", ""))}</p>
  <nav class="toc">{"".join(f'<a href="#{E(s["id"])}">{E(s["title"])}</a>' for s in m["sections"])}</nav></div>
</section>''')
for sec in m['sections']:
    n += 1
    slides.append(f'''<section class="slide divider" id="{E(sec["id"])}">
  <div class="cv"><span class="eyebrow">Part {n}</span><h1>{E(sec["title"])}</h1><p class="sub">{E(sec.get("intro", ""))}</p></div>
</section>''')
    for i, sl in enumerate(sec['slides'], 1):
        img = data_uri(sl.get('image', ''))
        pic = f'<img src="{img}" alt="{E(sl["title"])}">' if img else '<div class="missing">screenshot pending</div>'
        slides.append(f'''<section class="slide step">
  <div class="shot">{pic}</div>
  <div class="txt"><span class="eyebrow">{E(sec["title"])} · step {i} of {len(sec["slides"])}</span>
    <h2>{E(sl["title"])}</h2><p>{E(sl.get("caption", ""))}</p>
    {f'<p class="note">{E(sl["note"])}</p>' if sl.get("note") else ""}</div>
</section>''')

out = f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(m.get("title", "SAAHAA presentation"))}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Manrope:wght@400;600;800&display=swap" rel="stylesheet">
<style>
:root{{--plum:#2E1065;--plum2:#4C1D95;--violet:#7C3AED;--gold:#E0B558;--gold2:#FBE8B8;--ivory:#F8F5FE;--ink:#1E1033;--ink3:#6B5A87}}
*{{box-sizing:border-box}}html{{scroll-snap-type:y mandatory;scroll-behavior:smooth}}
body{{margin:0;font:500 16px/1.5 Manrope,system-ui,sans-serif;background:var(--ivory);color:var(--ink)}}
.slide{{min-height:100vh;scroll-snap-align:start;display:grid;place-items:center;padding:48px 6vw;position:relative}}
.cover,.divider{{background:radial-gradient(1200px 600px at 20% 0%,rgba(224,181,88,.18),transparent 60%),linear-gradient(150deg,#2E1065,#4C1D95 55%,#6D28D9);color:#fff}}
.cv{{max-width:900px;text-align:center}}
.wm{{font:700 20px Playfair Display,serif;letter-spacing:.22em;background:linear-gradient(180deg,#FFF4D8,#F4D68E);-webkit-background-clip:text;background-clip:text;color:transparent}}
h1{{font:700 clamp(32px,5vw,58px)/1.1 Playfair Display,serif;margin:12px 0 10px}}
h2{{font:700 clamp(22px,2.6vw,32px)/1.15 Playfair Display,serif;margin:6px 0 10px}}
.sub{{font-size:clamp(16px,1.6vw,20px);opacity:.85;max-width:62ch;margin:0 auto}}
.meta{{opacity:.6;letter-spacing:.16em;text-transform:uppercase;font-size:12px;margin-top:22px}}
.eyebrow{{display:inline-block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:800;color:var(--gold);margin-bottom:8px}}
.divider .eyebrow{{color:var(--gold2)}}
.toc{{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:28px}}
.toc a{{color:#fff;text-decoration:none;border:1px solid rgba(255,255,255,.35);padding:8px 16px;border-radius:999px;font-weight:600;background:rgba(255,255,255,.08)}}
.step{{display:grid;grid-template-columns:minmax(280px,440px) minmax(280px,560px);gap:6vw;align-items:center;justify-content:center}}
.shot img{{width:100%;max-height:82vh;object-fit:contain;border-radius:28px;border:1px solid #E2D8F2;box-shadow:0 28px 64px rgba(46,16,101,.18),0 8px 16px rgba(46,16,101,.08);background:#fff}}
.missing{{aspect-ratio:9/16;display:grid;place-items:center;border:2px dashed #C3B2E4;border-radius:28px;color:var(--ink3)}}
.txt p{{color:#4A3A66;font-size:clamp(15px,1.4vw,18px)}}
.note{{border-left:3px solid var(--gold);padding-left:12px;color:var(--ink3);font-size:14px}}
@media (max-width:760px){{.step{{grid-template-columns:1fr;gap:20px}}.shot img{{max-height:60vh}}}}
.hint{{position:fixed;right:16px;bottom:14px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);background:rgba(248,245,254,.8);padding:6px 10px;border-radius:999px}}
@media print{{.slide{{min-height:auto;page-break-after:always}}.hint{{display:none}}}}
</style></head><body>
{"".join(slides)}
<div class="hint">scroll · ↓ ↑ · print for PDF</div>
<script>
document.addEventListener('keydown',e=>{{const s=[...document.querySelectorAll('.slide')];const y=scrollY;const i=s.findIndex(x=>x.offsetTop>y+10);
if(e.key==='ArrowDown'||e.key==='PageDown'||e.key===' '){{e.preventDefault();(s[i]||s[s.length-1]).scrollIntoView();}}
if(e.key==='ArrowUp'||e.key==='PageUp'){{e.preventDefault();const j=s.findIndex(x=>x.offsetTop>=y-10)-1;(s[Math.max(0,j)]).scrollIntoView();}}}});
</script></body></html>'''
outp = os.path.join(ROOT, 'docs', 'presentation.html')
os.makedirs(os.path.dirname(outp), exist_ok=True)
io.open(outp, 'w', encoding='utf-8').write(out)
print(f'built {outp} · {len(slides)} slides · {sum(len(s["slides"]) for s in m["sections"])} screenshots')

if '--artifact' in sys.argv:
    # the Artifact host supplies doctype/html/head/body; hand it title + style + content only
    head_end = out.index('</head>'); body_start = out.index('<body>') + len('<body>'); body_end = out.rindex('</body>')
    head = out[out.index('<title>'):head_end]
    frag = head.replace(f'<title>{E(m.get("title", "SAAHAA presentation"))}</title>', f'<title>{E(m.get("name", "How SAAHAA Works"))}</title>') + out[body_start:body_end]
    frag = frag.replace('html{scroll-snap-type:y mandatory;scroll-behavior:smooth}', 'html{scroll-behavior:smooth}')
    ap = os.path.join(ROOT, 'docs', 'deck', 'presentation-artifact.html')
    io.open(ap, 'w', encoding='utf-8').write(frag)
    print(f'artifact fragment {ap} · {len(frag)//1024} KB')
