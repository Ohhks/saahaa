#!/usr/bin/env python3
"""
SAAHAA · tools/shots.py — photographs the real app for the presentation.

For every scene in docs/deck/manifest.json it starts headless Chrome on a
FRESH profile (so every scene begins from a clean seed), opens
http://localhost:8772/?shot=<scene>&demo=1, lets virtual time run so timers,
auctions and animations settle, and writes docs/deck/<scene>.png.

`demo=1` is what loads the example roster: the app itself starts with an empty
store, so without it every scene would photograph an empty screen. It is a
local capture switch and never ships to a device.

    python tools/shots.py              all scenes
    python tools/shots.py c06 a01      scenes whose id starts with these

Customer/partner scenes are shot at phone size (390×844); admin scenes at
desktop (1440×900), because that is where each is actually used.
"""
import io, json, os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECK = os.path.join(ROOT, 'docs', 'deck')
URL = 'http://localhost:8772'
CHROME = next((c for c in [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe'] if os.path.exists(c)), None)
if not CHROME:
    sys.exit('no Chrome/Edge found')

m = json.load(io.open(os.path.join(DECK, 'manifest.json'), encoding='utf-8'))
scenes = [os.path.splitext(os.path.basename(s['image']))[0] for sec in m['sections'] for s in sec['slides']]
# a manifest image named <scene>-d.png is the DESKTOP variant of <scene>: the --desktop pass makes it
# from the base scene; it is never a scene of its own (shooting it as one gave <scene>-d-d.png junk)
scenes = list(dict.fromkeys(s[:-2] if s.endswith('-d') else s for s in scenes))
DESKTOP = '--desktop' in sys.argv          # photograph everything at desktop size, suffixed -d
want = [a for a in sys.argv[1:] if not a.startswith('--')]
if want:
    scenes = [s for s in scenes if any(s.startswith(w) for w in want)]

def size(scene):
    return (1440, 900) if (DESKTOP or scene.startswith('a')) else (390, 844)

ok = 0
for scene in scenes:
    prof = os.path.join(tempfile.gettempdir(), 'saahaa-shot-' + scene)
    shutil.rmtree(prof, ignore_errors=True)
    w, h = size(scene)
    out = os.path.join(DECK, scene + ('-d' if DESKTOP and not scene.startswith('a') else '') + '.png')
    cmd = [CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--disable-extensions', '--force-prefers-reduced-motion',
           f'--window-size={w},{h}', '--virtual-time-budget=30000', f'--user-data-dir={prof}',
           f'--screenshot={out}', f'{URL}/?shot={scene}&demo=1']
    t = time.time()
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        good = os.path.exists(out) and os.path.getsize(out) > 20000
        print(f'  {"ok " if good else "?? "} {scene:18s} {w}x{h}  {time.time()-t:4.1f}s  {os.path.getsize(out) if os.path.exists(out) else 0:>8} B')
        ok += good
    except subprocess.TimeoutExpired:
        print(f'  TIMEOUT {scene}')
    shutil.rmtree(prof, ignore_errors=True)
print(f'{ok}/{len(scenes)} captured -> {DECK}')
