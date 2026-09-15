"""
SAAHAA · tools/smoke-dist.py — open the BUILT bundle in a real browser and prove
it renders as an app, not as text.

Why this exists: on 2026-09-07 a test string containing "</script>" was inlined
into the single-file bundle; the HTML parser ended the script there and the
live site showed the rest of the JavaScript as page text (floating "${...}"
chips everywhere). Every static check passed. Only a browser could have seen it.

    python tools/smoke-dist.py            checks dist/saahaa.html (file://)
    python tools/smoke-dist.py <url>      checks a deployed site (post-deploy)

Exit 0 = the bundle boots and paints the app. Exit 1 = it does not. Exit 2 =
the question could not be asked: no browser, or the browser never answered.

WHY A TIMEOUT IS A 2 AND NOT A 1. It was a 1, which made the deploy gate
decorative in exactly the way deploy.yml's own header warns about — commit
2939dc2 passed CI and failed deploy, the same script over the same bytes,
because headless Chrome is launched thirteen times here and a loaded runner
can lose one of those to the budget. A gate must fail for the thing it is
about and nothing else; tools/schema-test.sh already draws this line for
docker and this is the same line. A browser that never answered proves
nothing. A browser that answered with a broken DOM still fails hard, below.
"""
import io, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE = os.path.join(ROOT, 'dist', 'saahaa.html')

CANDIDATES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/opt/google/chrome/chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
# A CHROME THAT WAS SET BUT POINTS NOWHERE IS STILL "NO BROWSER". The env var
# skipped the existence check every candidate below is subject to, so a stale
# path in somebody's shell profile came out as a Python traceback and a hard
# fail — the bundle blamed for the setting.
CHROME = os.environ.get('CHROME') or next((c for c in CANDIDATES if os.path.exists(c)), None)
if CHROME and not os.path.exists(CHROME):
    print(f'smoke-dist: CHROME is set to {CHROME}, which does not exist — '
          'cannot prove the bundle renders')
    sys.exit(2)
if not CHROME:
    print('smoke-dist: no Chrome/Edge found — cannot prove the bundle renders')
    sys.exit(2)
if not (len(sys.argv) > 1 and sys.argv[1].startswith('http')) and not os.path.exists(BUNDLE):
    print('smoke-dist: dist/saahaa.html missing — run tools/build.py first')
    sys.exit(1)

profile = tempfile.mkdtemp(prefix='saahaa-smoke-')
LIVE = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].startswith('http') else None
url = LIVE or 'file:///' + BUNDLE.replace('\\', '/').lstrip('/')
cmd = [CHROME, '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox', '--disable-extensions',
       '--allow-file-access-from-files', f'--user-data-dir={profile}',
       '--virtual-time-budget=6000', '--window-size=390,844', '--dump-dom', url]
# The bundle is ~1.8 MB of inlined modules and it grows with the product, so
# the budget is generous and overridable rather than a number chosen in 2026.
TIMEOUT = int(os.environ.get('SMOKE_TIMEOUT') or 180)


def dump(command):
    """Run headless Chrome once. Returns (dom, timed_out) — never raises."""
    try:
        return subprocess.run(command, capture_output=True, timeout=TIMEOUT
                              ).stdout.decode('utf-8', 'replace'), False
    except subprocess.TimeoutExpired:
        return '', True
    except OSError as e:
        # The browser could not be started at all. That is the same class of
        # answer as silence: we did not learn anything about the bundle.
        print(f'smoke-dist: could not start the browser: {e}')
        return '', True


dom, timed_out = dump(cmd)
if timed_out:
    print(f'::warning::smoke-dist: the browser did not answer in {TIMEOUT}s — '
          'the bundle was NOT proved to render (this is a skip, not a pass)')
    sys.exit(2)

# what the USER sees: the DOM minus scripts and styles
visible = re.sub(r'(?is)<(script|style)\b.*?</\1\s*>', '', dom)
text = re.sub(r'(?s)<[^>]+>', ' ', visible)

problems = []
if len(dom) < 20000:
    problems.append(f'DOM is only {len(dom)} bytes — the app did not boot')
if '${' in text:
    i = text.find('${')
    problems.append('raw template code is visible on the page: ' + text[i:i + 80].strip())
if 'data-act=' not in visible:
    problems.append('no data-act control rendered — the shell did not paint')
if re.search(r'(?i)</script', re.sub(r'(?is)<script\b.*?</script\s*>', '', dom)) and dom.count('<script') != len(re.findall(r'(?i)</script\s*>', dom)):
    problems.append('a stray </script> sits inside a script — the bundle would be cut in two')

if problems:
    print('smoke-dist: FAIL')
    for p in problems:
        print('  ·', p)
    sys.exit(1)
print(f'smoke-dist: OK — {"live site" if LIVE else "bundle"} boots and paints ({len(dom)//1024} KB DOM, {visible.count("data-act=")} controls)')

# ── EVERY ROUTE, NOT JUST THE ONE THE APP OPENS ON ───────────────────────────
# This file checked that the HOME shell paints, and stopped there. Twice that
# was not enough:
#
#   * `flags` used in ui/views/partner.js and never imported — the shop's
#     Payouts tab, the only screen with a withdraw button, threw on every render.
#   * `t` called 88 times in ui/views/ask.js and never imported — the entire
#     "ask several pros for a price" journey died with "t is not defined",
#     and a round-10 audit scored the product 4/10 largely because of it.
#
# Both are legal JavaScript, so the module parses. Neither is reachable from the
# domain tests or the money journeys, which never touch the DOM. And the bundle
# boots perfectly — on the home route. A free variable in a view is invisible
# until somebody opens that view, so this opens them.
ROUTES = ['#/shops', '#/cart', '#/orders', '#/account', '#/earn',
          '#/ask/none', '#/order/none', '#/pro/none', '#/shop/none',
          '#/legal/terms', '#/legal/refunds', '#/legal/privacy']
ERROR_MARK = 'This screen hit an error'
broken = []
unproven = []
for route in ROUTES:
    rcmd = [c for c in cmd]
    rcmd[-1] = url + ('&' if '?' in url else '?') + 'demo=1' + route
    rdom, timed_out = dump(rcmd)
    if timed_out:
        unproven.append(route)
        continue
    rvis = re.sub(r'(?is)<(script|style)\b.*?</\1\s*>', '', rdom)
    if ERROR_MARK in rvis:
        broken.append(route + ' — rendered the error page')
    elif len(rdom) < 20000:
        broken.append(route + f' — DOM only {len(rdom)} bytes')
    elif 'data-act=' not in rvis:
        broken.append(route + ' — nothing interactive rendered')

# A ROUTE THAT ACTUALLY RENDERED WRONG OUTRANKS EVERY SILENCE. Checked first
# and on its own, so a run that both found a broken screen and lost a browser
# still fails for the broken screen.
if broken:
    print('smoke-dist: FAIL — routes that do not render:')
    for b in broken:
        print('  x ' + b)
    print('    A view with a free variable parses, passes every test, and builds.')
    print('    It throws the first time somebody opens it.')
    sys.exit(1)
if unproven:
    print(f'::warning::smoke-dist: {len(unproven)} route(s) were never proved — '
          f'the browser did not answer in {TIMEOUT}s: ' + ', '.join(unproven))
    print(f'    {len(ROUTES) - len(unproven)} of {len(ROUTES)} routes rendered without throwing.')
    sys.exit(2)

print(f'smoke-dist: OK — {len(ROUTES)} more routes render without throwing')

