#!/usr/bin/env python3
"""
SAAHAA build — inline every ES module into ONE self-contained HTML file.

Why this exists: native ES modules give us real SOLID boundaries, but a browser
refuses to fetch them over file://. Without this step, double-clicking
index.html shows a blank page. The bundle keeps that guarantee alive.

    python tools/build.py            -> dist/saahaa.html
    python tools/build.py --check    -> lint only, no output

Each module is wrapped in its own function scope and registered in a tiny
CommonJS-style table, so module-local names stay module-local. Naive
concatenation does NOT work here: `listBackups` exists in both persist.js and
migrate.js, and flat concatenation is a SyntaxError.

No npm, no bundler, no config. Run it before every release — step 9 of the
safe-update checklist in docs/ARCHITECTURE.md.
"""
import io, os, re, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
DIST = os.path.join(ROOT, 'dist')

read = lambda p: io.open(p, encoding='utf-8').read()
rel_of = lambda p: os.path.relpath(p, SRC).replace('\\', '/')

IMPORT_RE = re.compile(
    r"""^[ \t]*import\s+(?:(?P<clause>[^'"]+?)\s+from\s+)?['"](?P<path>[^'"]+)['"]\s*;?[ \t]*$""",
    re.M)


# ── dependency graph ───────────────────────────────────────────
def module_order(entry):
    """Post-order DFS: every dependency is emitted before its dependents."""
    seen, order = set(), []

    def visit(path):
        real = os.path.normpath(path)
        if real in seen:
            return
        seen.add(real)
        if not os.path.exists(real):
            raise SystemExit(f'missing module: {real}')
        for m in IMPORT_RE.finditer(read(real)):
            spec = m.group('path').split('?')[0]
            if spec.startswith('.'):
                visit(os.path.join(os.path.dirname(real), spec))
        order.append(real)

    visit(entry)
    return order


# ── module -> function body ────────────────────────────────────
def transform(code, path):
    """Rewrite one ES module into a CommonJS-ish factory body."""
    here = os.path.dirname(path)
    exports = []      # (exported_name, local_expr)

    def resolve(spec):
        # resolve inside the module-id space (posix, relative to src/), NOT on
        # disk — rel_of() expects absolute paths and would produce nonsense here.
        return os.path.normpath(os.path.join(here, spec.split('?')[0])).replace('\\', '/')

    def do_import(m):
        clause, spec = m.group('clause'), m.group('path')
        req = f"__req('{resolve(spec)}')"
        if not clause:                                   # import './x.js'
            return f'{req};'
        clause = clause.strip()
        if clause.startswith('*'):                       # import * as N from
            name = clause.split(' as ')[1].strip()
            return f'const {name} = {req};'
        if clause.startswith('{'):                       # import { a, b as c } from
            inner = clause.strip('{} \n')
            pairs = [p.strip() for p in inner.split(',') if p.strip()]
            binds = []
            for p in pairs:
                if ' as ' in p:
                    a, b = [x.strip() for x in p.split(' as ')]
                    binds.append(f'{a}: {b}')
                else:
                    binds.append(p)
            return 'const {' + ', '.join(binds) + '} = ' + req + ';'
        if ',' in clause:                                # import D, { a } from
            d, rest = clause.split(',', 1)
            inner = rest.strip().strip('{}')
            binds = ', '.join(p.strip() for p in inner.split(',') if p.strip())
            return f'const {d.strip()} = {req}.default; const {{{binds}}} = {req};'
        return f'const {clause} = {req}.default;'        # import D from

    code = IMPORT_RE.sub(do_import, code)

    # export default X;
    def do_default(m):
        exports.append(('default', '__default'))
        return 'const __default = '
    code = re.sub(r'^[ \t]*export\s+default\s+', do_default, code, flags=re.M)

    # export const|let|var NAME  /  export function NAME  /  export class NAME
    def do_decl(m):
        exports.append((m.group('name'), m.group('name')))
        return m.group('kw') + ' ' + m.group('name')
    code = re.sub(
        r'^[ \t]*export\s+(?P<kw>const|let|var|function\s*\*?|async\s+function|class)\s+(?P<name>[A-Za-z_$][\w$]*)',
        do_decl, code, flags=re.M)

    # export { a, b as c };
    def do_list(m):
        for p in [x.strip() for x in m.group(1).split(',') if x.strip()]:
            if ' as ' in p:
                local, ext = [x.strip() for x in p.split(' as ')]
                exports.append((ext, local))
            else:
                exports.append((p, p))
        return ''
    code = re.sub(r'^[ \t]*export\s*\{([^}]*)\}\s*;?', do_list, code, flags=re.M)

    tail = '\n'.join(f'  exports[{n!r}] = {expr};' for n, expr in exports)
    return code + ('\n\n/* exports */\n' + tail if tail else '')


# ── lint ───────────────────────────────────────────────────────
def strip_comments(code):
    """Lint rules apply to code, not prose — a linter that fires on its own
    explanatory comment trains people to ignore it."""
    code = re.sub(r'/\*.*?\*/', '', code, flags=re.S)
    code = re.sub(r'(?<![:\'"\\])//.*$', '', code, flags=re.M)
    return code


LINT_RULES = [
    (r'\bprice\s*\*\s*1\.\d', 'raw float arithmetic on a price — use core/money.js',
     ('core/money.js', 'domain/pricing.js')),
    (r'\blocalStorage\.', 'direct localStorage access — go through core/persist.js',
     ('core/persist.js', 'core/id.js', 'core/adminauth.js', 'app.js', 'core/flags.js')),
    (r'\bBroadcastChannel\b', 'direct BroadcastChannel use — go through core/bus.js',
     ('core/bus.js',)),
    (r'\binnerHTML\s*=', 'direct innerHTML write — go through ui/dom.js mount()',
     ('ui/dom.js', 'app.js', 'ui/splash.js')),   # splash builds a fresh detached node
]


def lint():
    problems = []
    for base, _, files in os.walk(SRC):
        for f in sorted(files):
            if not f.endswith('.js'):
                continue
            rel = rel_of(os.path.join(base, f))
            body = strip_comments(read(os.path.join(base, f)))
            for pattern, why, allowed in LINT_RULES:
                if any(a in rel for a in allowed):
                    continue
                if re.search(pattern, body):
                    problems.append(f'{rel}: {why}')
    return problems


# ── build ──────────────────────────────────────────────────────
RUNTIME = """
/* ---- SAAHAA single-file module runtime ---------------------------------
   Each module keeps its own scope, exactly as the browser would give it.
   Modules are emitted in dependency order, so __req never recurses. */
var __MODULES = {}, __CACHE = {};
function __def(id, factory) { __MODULES[id] = factory; }
function __req(id) {
  if (__CACHE[id]) return __CACHE[id];
  var exports = __CACHE[id] = {};
  if (!__MODULES[id]) throw new Error('module not bundled: ' + id);
  __MODULES[id](exports);
  return exports;
}
"""


def stamp_index(build_id):
    """Sync every ?v= cache-buster in index.html to BUILD_ID.

    Failure mode #1 in docs/ARCHITECTURE.md is an old cached stylesheet paired
    with new modules. Doing this by hand guarantees someone forgets, so the
    build does it and reports what changed."""
    p = os.path.join(ROOT, 'index.html')
    src = read(p)
    out = re.sub(r'\?v=[0-9a-z]+', '?v=' + build_id, src)
    if out != src:
        io.open(p, 'w', encoding='utf-8').write(out)
    return out != src


def build():
    entry = os.path.join(SRC, 'app.js')
    mods = module_order(entry)

    ver = read(os.path.join(SRC, 'core/version.js'))
    version = re.search(r"VERSION\s*=\s*'([^']+)'", ver).group(1)
    build_id = re.search(r"BUILD_ID\s*=\s*'([^']+)'", ver).group(1)

    css = '\n'.join(read(os.path.join(SRC, 'ui', f)) for f in ('tokens.css', 'brand.css'))

    parts = [RUNTIME]
    for m in mods:
        rel = rel_of(m)
        body = transform(read(m), rel)
        parts.append(f"/* ==== {rel} ==== */\n__def({rel!r}, function(exports){{\n{body}\n}});")
    parts.append(f"__req('app.js');")
    js = '\n\n'.join(parts)

    html = read(os.path.join(ROOT, 'index.html'))
    html = re.sub(r'\s*<link rel="stylesheet" href="src/ui/[^"]*">', '', html)
    html = html.replace('</head>', f'<style>\n{css}\n</style>\n</head>')
    html = re.sub(r'<script type="module"[^>]*></script>',
                  lambda _: f'<script>\n{js}\n</script>', html)
    html = html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    html = html.replace('<title>SAAHAA',
                        f'<!-- built {datetime.datetime.now():%Y-%m-%d %H:%M} · '
                        f'v{version} · {build_id} · {len(mods)} modules -->\n<title>SAAHAA')

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, 'saahaa.html')
    io.open(out, 'w', encoding='utf-8').write(html)
    return out, len(mods), len(html)


if __name__ == '__main__':
    problems = lint()
    for p in problems:
        print('LINT:', p)
    if '--check' in sys.argv:
        print(f'{len(problems)} lint problem(s)')
        sys.exit(1 if problems else 0)
    bid = re.search(r"BUILD_ID\s*=\s*'([^']+)'", read(os.path.join(SRC, 'core/version.js'))).group(1)
    if stamp_index(bid):
        print(f'stamped index.html cache-busters -> ?v={bid}')
    out, n, size = build()
    print(f'built {out}')
    print(f'  {n} modules, {size / 1024:.0f} KB, {len(problems)} lint problem(s)')
    print('  double-click it to prove the file:// path still works')
