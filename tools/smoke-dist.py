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
no browser found (CI runners have Chrome; a laptop without one gets a warning
from preflight, not a pass).
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
CHROME = os.environ.get('CHROME') or next((c for c in CANDIDATES if os.path.exists(c)), None)
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
try:
    dom = subprocess.run(cmd, capture_output=True, timeout=90).stdout.decode('utf-8', 'replace')
except subprocess.TimeoutExpired:
    print('smoke-dist: browser timed out')
    sys.exit(1)

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
