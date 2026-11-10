// Makes a login entry for the admin page.
//   node worker/make-user.mjs "Sandeep" staff 482913
//   node worker/make-user.mjs "Darshit" owner "a-long-password"
// Paste the printed lines (comma-separated, inside [ ]) as the USERS secret of the Worker.
import { webcrypto as crypto } from 'node:crypto';
import { hashPin } from './src/index.js';

const [name, role, pin] = process.argv.slice(2);
if (!name || !['owner', 'staff'].includes(role) || !pin) {
  console.error('usage: node worker/make-user.mjs "<name>" <owner|staff> <pin>');
  process.exit(1);
}
if (role === 'staff' && !/^\d{6}$/.test(pin)) { console.error('Staff PINs must be exactly 6 digits.'); process.exit(1); }
if (role === 'owner' && pin.length < 10) { console.error('The owner password must be at least 10 characters.'); process.exit(1); }
const salt = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
console.log(JSON.stringify({ name, role, salt, hash: await hashPin(salt, pin) }));
