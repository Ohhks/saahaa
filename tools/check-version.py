#!/usr/bin/env python3
"""Assert the git tag, src/core/version.js and CHANGELOG.md all agree.
An untagged or undocumented release cannot be rolled back, so it is not
a release. CI fails rather than letting one through."""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda p: io.open(os.path.join(ROOT, p), encoding='utf-8').read()

ver = re.search(r"VERSION\s*=\s*'([^']+)'", read('src/core/version.js')).group(1)
want = sys.argv[1] if len(sys.argv) > 1 else ver

problems = []
if want != ver:
    problems.append(f"tag says {want} but src/core/version.js says {ver}")
if not re.search(r'^##+ *\[?' + re.escape(ver) + r'\]?', read('CHANGELOG.md'), re.M):
    problems.append(f"CHANGELOG.md has no section for {ver}")

for p in problems:
    print(f"::error::{p}")
print(f"version {ver} — {'OK' if not problems else 'MISMATCH'}")
sys.exit(1 if problems else 0)
