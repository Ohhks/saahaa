#!/usr/bin/env python3
"""SAAHAA · tools/deck-pdf.py — render a deck page to PDF.

Headless Chrome does the printing, so the PDF is exactly what the browser
shows: A4 landscape, one slide per page, vendored Archivo embedded.

    python tools/deck-pdf.py                     # docs/deck/workflows.html
    python tools/deck-pdf.py docs/deck/other.html

The output PDF imports cleanly into Canva (Create > Upload > it becomes an
editable design, one page per slide), Google Slides or Keynote if the deck
needs to be reworked by hand afterwards.
"""
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

CHROME_CANDIDATES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]


def find_chrome():
    for p in CHROME_CANDIDATES:
        if pathlib.Path(p).exists():
            return p
    return None


def main():
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'docs' / 'deck' / 'workflows.html'
    if not src.is_absolute():
        src = ROOT / src
    if not src.exists():
        sys.exit('deck-pdf: no such file: %s' % src)

    chrome = find_chrome()
    if not chrome:
        sys.exit('deck-pdf: no Chrome found — install it, or open the HTML and print to PDF by hand')

    out = src.with_suffix('.pdf')
    with tempfile.TemporaryDirectory() as profile:
        cmd = [
            chrome, '--headless', '--disable-gpu', '--no-sandbox',
            '--user-data-dir=%s' % profile,
            '--no-pdf-header-footer',
            '--print-to-pdf-no-header',
            '--virtual-time-budget=12000',
            '--print-to-pdf=%s' % out,
            src.as_uri(),
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)

    if not out.exists() or out.stat().st_size < 2048:
        sys.stderr.write(r.stderr[-1500:] if r.stderr else '')
        sys.exit('deck-pdf: FAILED — no usable PDF was produced')

    kb = out.stat().st_size / 1024
    print('deck-pdf: OK — %s (%.0f KB)' % (out.relative_to(ROOT), kb))
    print('          import into Canva with Create a design > Upload, for hand editing')


if __name__ == '__main__':
    main()
