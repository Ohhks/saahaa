#!/usr/bin/env python3
"""Refuse a migration that could destroy data on a free tier with no
point-in-time recovery. A dropped column is a business incident; a renamed
one is a five-second rollback."""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'supabase', 'migrations')

DESTRUCTIVE = [
    (r'\bdrop\s+table\b',            'DROP TABLE'),
    (r'\bdrop\s+column\b',           'DROP COLUMN'),
    (r'\btruncate\b',                'TRUNCATE'),
    (r'\bdelete\s+from\b(?![^;]*\bwhere\b)', 'DELETE without WHERE'),
    (r'\balter\s+column\b[^;]*\bset\s+not\s+null\b', 'SET NOT NULL on an existing column'),
]
APPROVAL = '-- destructive: approved'

problems, files = [], []
if os.path.isdir(DIR):
    files = sorted(f for f in os.listdir(DIR) if f.endswith('.sql'))

for f in files:
    body = io.open(os.path.join(DIR, f), encoding='utf-8').read()
    low = re.sub(r'--.*$', '', body, flags=re.M).lower()   # ignore comments
    for pat, name in DESTRUCTIVE:
        if re.search(pat, low) and APPROVAL not in body.lower():
            problems.append(f"{f}: contains {name} without an explicit "
                            f"'{APPROVAL}' comment")
    if not re.match(r'^\d{4}_[a-z0-9_]+\.sql$', f):
        problems.append(f"{f}: name must be NNNN_snake_case.sql so lexical order == apply order")

for p in problems:
    print(f"::error::{p}")
print(f"{len(files)} migration(s) checked, {len(problems)} problem(s)")
sys.exit(1 if problems else 0)
