// Local only: give a tablet or PC its own sync login. Needs the service-role key, which never goes in this repo.
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/add-device.mts <tenant> <store> <counter> "<label>"
//   e.g.  npx tsx scripts/add-device.mts true-spirits TSTS1 1 "TS1 counter 1"
// Back-office and owner devices use a counter from 9 down (they rarely bill, but a number must never clash).
// Prints the email and password to type once on the device's login screen.
import { randomBytes } from 'node:crypto';

const [tenant, store, counterText, label] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const counter = Number(counterText);
if (!url || !key || !tenant || !store || !label || !Number.isInteger(counter) || counter < 1 || counter > 9) {
  console.error('usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/add-device.mts <tenant> <store> <counter 1-9> "<label>"');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

interface AdminUser {
  email?: string;
  app_metadata?: { tenant?: string; store?: string; counter?: number };
}

// Two devices at one shop with the same counter would make the same bill numbers.
const list = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers });
if (!list.ok) throw new Error(`list users: ${list.status} ${await list.text()}`);
const { users } = (await list.json()) as { users: AdminUser[] };
const clash = users.find((u) => u.app_metadata?.tenant === tenant && u.app_metadata?.store === store && u.app_metadata?.counter === counter);
if (clash) {
  console.error(`${store} counter ${counter} is already ${clash.email}`);
  process.exit(1);
}

const email = `${tenant}.${store}.c${counter}@devices.truepos.app`.toLowerCase();
const password = randomBytes(18).toString('base64url');
const made = await fetch(`${url}/auth/v1/admin/users`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { tenant, store, counter, label } }),
});
if (!made.ok) throw new Error(`create user: ${made.status} ${await made.text()}`);
console.log(`${label}\n  email:    ${email}\n  password: ${password}`);
