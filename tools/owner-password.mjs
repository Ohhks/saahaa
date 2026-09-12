/* SAAHAA · tools/owner-password.mjs — set a new owner password.
 *
 * THERE IS NO RESET LINK, AND THAT IS DELIBERATE. A "forgot password" flow on
 * the owner console is a second door into the one screen that can clear money,
 * and it would have to be reachable by whoever is standing in front of it.
 * So the way back in is this: you choose a password here, the script prints the
 * PBKDF2 hash of it, and you paste that into src/core/config.js. The plaintext
 * never reaches a file, a log, a commit or anybody else — not even the terminal
 * echo, which is switched off while you type.
 *
 * Run:  node tools/owner-password.mjs
 * Then: paste the printed block over ADMIN_BOOTSTRAP in src/core/config.js,
 *       rebuild (python tools/build.py --site) and deploy.
 *
 * Everyone already signed in stays signed in until their session expires; the
 * new password applies from the next sign-in.
 */
import { webcrypto as crypto } from 'node:crypto';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';

const ITER = 250000;
const USERNAME = (readFileSync(new URL('../src/core/config.js', import.meta.url), 'utf8')
  .match(/username:\s*'([^']+)'/) || [, 'siidhartha12'])[1];

/* read a line without echoing it back to the screen */
function secret(prompt) {
  return new Promise(resolve => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const onData = () => { stdout.write('\x1b[2K\r' + prompt); };
    stdout.write(prompt);
    stdin.on('data', onData);
    rl.question('', answer => { stdin.off('data', onData); rl.close(); stdout.write('\n'); resolve(answer); });
  });
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

const pass = await secret(`New password for "${USERNAME}": `);
if (pass.length < 10) {
  console.error('\n  Too short. The console is the only screen that can clear money — use at least 10 characters.\n');
  process.exit(1);
}
const again = await secret('Type it again: ');
if (again !== pass) { console.error('\n  Those do not match. Nothing was changed.\n'); process.exit(1); }

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256);

console.log(`
  Paste this over ADMIN_BOOTSTRAP in src/core/config.js:

export const ADMIN_BOOTSTRAP = {
  username: '${USERNAME}',
  salt: '${hex(salt)}',
  hash: '${hex(bits)}',
  iterations: ${ITER},
  version: 1,
};

  Then:  python tools/build.py --site && bash tools/preflight.sh
  The password itself is not in that block, is not in this repo, and was never
  written to disk. Nobody can recover it from what you just pasted — including
  you, so keep it where you keep the bank login.
`);
