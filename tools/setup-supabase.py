#!/usr/bin/env python3
"""SAAHAA · tools/setup-supabase.py — point this build at a Supabase project.

WHY THIS FILE EXISTS. src/core/config.js has told every reader since the first
release that BAKED is "filled in by `python tools/setup-supabase.py`". The
script was never written, so the one instruction the file gives about itself
was the one thing you could not do. Now you can.

WHAT IT WRITES. Exactly two strings into the BAKED block of
src/core/config.js: the project URL and the ANON key. Both are public by
design — the anon key authorises nothing on its own, Row Level Security
decides access. It REFUSES a service-role key, because that key bypasses all
RLS and a repo is not a secret store; that refusal is the point of the script
being a script rather than a paste.

  python tools/setup-supabase.py --url https://xxxx.supabase.co --anon eyJ...
  python tools/setup-supabase.py --show
  python tools/setup-supabase.py --clear
"""
import argparse
import json
import pathlib
import re
import sys
import base64

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'src' / 'core' / 'config.js'

URL_RE = re.compile(r'^https://[a-z0-9-]+\.supabase\.(co|in)$')
# The BAKED block, matched as a whole so we rewrite it rather than guess at
# line numbers. Non-greedy to the first closing brace — BAKED has no nesting.
BAKED_RE = re.compile(r'(const BAKED = \{)(.*?)(\n\};)', re.S)


def jwt_role(key):
    """The role a Supabase key carries, or None if it is not a readable JWT.

    A service-role key looks exactly like an anon key to the eye — same
    prefix, same length class, same shape. The difference is one claim in the
    payload, and pasting the wrong one publishes a master key to a public git
    history. So we read the claim instead of trusting the person pasting."""
    parts = str(key or '').split('.')
    if len(parts) != 3:
        return None
    try:
        pad = parts[1] + '=' * (-len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(pad)).get('role')
    except Exception:
        return None


def read():
    src = CONFIG.read_text(encoding='utf-8')
    m = BAKED_RE.search(src)
    if not m:
        sys.exit('could not find the BAKED block in src/core/config.js')
    url = re.search(r"url:\s*'([^']*)'", m.group(2))
    anon = re.search(r"anonKey:\s*'([^']*)'", m.group(2))
    return src, m, (url.group(1) if url else ''), (anon.group(1) if anon else '')


def write(url, anon):
    src, m, _, _ = read()
    block = (
        "\n  // Written by `python tools/setup-supabase.py`. Both values are public:\n"
        "  // the anon key authorises nothing on its own — RLS decides access.\n"
        f"  url: '{url}',\n"
        f"  anonKey: '{anon}',"
    )
    CONFIG.write_text(src[:m.start(2)] + block + src[m.end(2):], encoding='utf-8')


def main():
    ap = argparse.ArgumentParser(description='bake a Supabase project into the build')
    ap.add_argument('--url', help='https://<ref>.supabase.co')
    ap.add_argument('--anon', help='the anon (public) key')
    ap.add_argument('--show', action='store_true', help='print what is baked in now')
    ap.add_argument('--clear', action='store_true', help='unbake it (back to local-only)')
    a = ap.parse_args()

    if a.show:
        _, _, url, anon = read()
        print(f"url     : {url or '(none — the build is local-only)'}")
        print(f"anon key: {(anon[:24] + '…') if anon else '(none)'}")
        return

    if a.clear:
        write('', '')
        print('cleared — this build is local-only again')
        return

    if not a.url or not a.anon:
        ap.error('--url and --anon are both required (or use --show / --clear)')

    url = a.url.rstrip('/')
    if not URL_RE.match(url):
        sys.exit(f'that does not look like a Supabase project URL: {url}\n'
                 '  expected https://<ref>.supabase.co')

    role = jwt_role(a.anon)
    if role == 'service_role':
        sys.exit('REFUSED: that is the SERVICE ROLE key.\n'
                 '  It bypasses every row-level security policy, and this file is\n'
                 '  committed to a public repository. It belongs in `wrangler secret\n'
                 '  put SUPABASE_SERVICE_KEY` and nowhere else. Copy the *anon* key.')
    if role and role != 'anon':
        sys.exit(f'that key carries role "{role}", not "anon" — copy the anon key')
    if not role:
        print('warning: could not read a role claim from that key; continuing', file=sys.stderr)

    write(url, a.anon)
    print(f'baked {url} into src/core/config.js')
    print('next: python tools/build.py --site && bash tools/preflight.sh')


if __name__ == '__main__':
    main()
