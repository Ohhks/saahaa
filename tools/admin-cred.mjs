#!/usr/bin/env node
/* Print a PBKDF2 credential block for src/core/config.js: node tools/admin-cred.mjs '<password>' */
import { webcrypto as c } from 'node:crypto';
const pw = process.argv[2]; if (!pw) { console.error('usage: node tools/admin-cred.mjs <password>'); process.exit(1); }
const salt = [...c.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
const key = await c.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
const bits = await c.subtle.deriveBits({ name: 'PBKDF2', salt: Uint8Array.from(salt.match(/../g).map(h => parseInt(h, 16))), iterations: 250000, hash: 'SHA-256' }, key, 256);
console.log(JSON.stringify({ salt, hash: [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join(''), iterations: 250000 }, null, 2));
