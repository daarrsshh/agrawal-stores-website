// Makes a login for the admin page. There are two: one shared staff PIN and the owner password.
//   node worker/make-user.mjs staff 482913
//   node worker/make-user.mjs owner "a-long-password"
// Put both printed lines inside [ ], separated by a comma, as the USERS secret of the Worker.
// Changing the staff PIN logs every staff phone out; they log in again with the new PIN.
import { webcrypto as crypto } from 'node:crypto';
import { hashPin } from './src/index.js';

const [role, pin] = process.argv.slice(2);
if (!['owner', 'staff'].includes(role) || !pin) {
  console.error('usage: node worker/make-user.mjs <staff|owner> <pin-or-password>');
  process.exit(1);
}
if (role === 'staff' && !/^\d{6}$/.test(pin)) { console.error('The staff PIN must be exactly 6 digits.'); process.exit(1); }
if (role === 'owner' && pin.length < 10) { console.error('The owner password must be at least 10 characters.'); process.exit(1); }
const salt = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
const name = role === 'owner' ? 'Owner' : 'Staff';
console.log(JSON.stringify({ name, role, salt, hash: await hashPin(salt, pin) }));
