#!/usr/bin/env python3
"""SAAHAA · tools/admin-cred-read.py — read one field of ADMIN_BOOTSTRAP.

The owner console asks the Worker for the platform roster, and the Worker will
not hand a browser that list on its say-so. Rather than invent a second
password, both sides check the SAME PBKDF2 credential that src/core/config.js
already ships — so tools/deploy.sh has to read it out of that file.

It is read here rather than with sed because the alternative kept producing the
empty string: the value sits in a JS object literal, and a sed backreference is
one layer of shell quoting away from vanishing. An empty salt would then be set
as the Worker's owner credential and lock the console out of its own roster,
silently, with every command reporting success.

    python tools/admin-cred-read.py salt|hash|iterations
"""
import pathlib
import re
import sys

FIELDS = ('salt', 'hash', 'iterations')

if len(sys.argv) != 2 or sys.argv[1] not in FIELDS:
    sys.exit(f'usage: admin-cred-read.py [{"|".join(FIELDS)}]')

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'src' / 'core' / 'config.js').read_text(encoding='utf-8')

block = re.search(r'ADMIN_BOOTSTRAP\s*=\s*\{(.*?)\n\};', src, re.S)
if not block:
    sys.exit('ADMIN_BOOTSTRAP not found in src/core/config.js')

found = re.search(sys.argv[1] + r"\s*:\s*'?([A-Za-z0-9]+)'?", block.group(1))
if not found:
    sys.exit(f'{sys.argv[1]} not found inside ADMIN_BOOTSTRAP')

print(found.group(1))
