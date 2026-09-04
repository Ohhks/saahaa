#!/usr/bin/env python3
"""
SAAHAA dev server — static files with caching turned OFF.

WHY THIS EXISTS. `python -m http.server` sends no Cache-Control header, so the
browser falls back to heuristic caching and holds on to files for a while. The
app's cache-buster only stamps the ENTRY module (`src/app.js?v=...`); every
module that entry imports is fetched at its plain URL. So editing
`src/ui/views/home.js` and reloading showed the OLD view while the new
`app.js` ran around it — the exact half-updated-cache failure mode documented
in docs/ARCHITECTURE.md, hitting us in development.

Production is immune (GitHub Pages serves one inlined file), so the fix belongs
here rather than in the app.

    python tools/serve.py            -> http://localhost:8772
    python tools/serve.py 9000       -> a different port
"""
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8772


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # the whole point of this file
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        # mirror the production CSP closely enough to catch violations in dev
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, fmt, *args):
        # one line per request is enough; the default is noisy
        if '304' not in (args[1] if len(args) > 1 else ''):
            sys.stderr.write("  %s\n" % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with Server(('', PORT), NoCacheHandler) as httpd:
        print(f'SAAHAA dev server  http://localhost:{PORT}')
        print(f'  serving   {ROOT}')
        print('  caching   OFF (every reload fetches fresh modules)')
        print(f'  tests     http://localhost:{PORT}/?selftest=1')
        print(f'  admin     http://localhost:{PORT}/#/admin')
        print('  Ctrl+C to stop')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped')
