/* SAAHAA · tools/figma-tokens.mjs — the design system, in the one format every
   design tool imports.

   The Figma connector needs an OAuth login this session cannot do. It does not
   need to: what a designer actually wants from a codebase is the TOKENS, and
   the W3C Design Tokens format is what Figma Variables, Tokens Studio, Style
   Dictionary and Penpot all read.

   So this exports src/ui/tokens.css as design-tokens.json, which means the
   source of truth stays the CSS the product actually ships — not a Figma file
   somebody has to remember to update. Design imports FROM the code.

   Run: node tools/figma-tokens.mjs > docs/design-tokens.json */

import { readFile } from 'node:fs/promises';
const css = await readFile(new URL('../src/ui/tokens.css', import.meta.url), 'utf8');

const GROUP = v =>
  /^#|^rgb|^hsl|color-mix/.test(v) ? 'color'
  : /^\d+(\.\d+)?(px|rem|em)$/.test(v) ? 'dimension'
  : /^\d+(\.\d+)?m?s$/.test(v) ? 'duration'
  : /cubic-bezier|ease|linear/.test(v) ? 'cubicBezier'
  : 'other';

const out = {};
for (const m of css.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
  const [, name, raw] = m;
  const value = raw.trim();
  const type = GROUP(value);
  if (type === 'other') continue;                 // shadows, fonts: not variables
  const path = name.split('-');
  let node = out;
  path.slice(0, -1).forEach(k => { node[k] = node[k] || {}; node = node[k]; });
  node[path[path.length - 1]] = { $type: type, $value: value };
}
console.log(JSON.stringify({
  $description: 'SAAHAA design tokens, generated from src/ui/tokens.css. The CSS is the source of truth; regenerate rather than edit.',
  ...out,
}, null, 2));
