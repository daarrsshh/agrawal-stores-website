# Admin page setup (one time, about 15 minutes)

There are two admin pages:
- **agrawalstores.in/admin**: for staff. One shared 6-digit shop PIN; each person also types their first name, which is
  shown next to their changes.
- **agrawalstores.in/admin/owner/**: for the owner only, with a password. Not linked from anywhere. Only this page can
  publish, change the banner, and add or hide schools and sections.

Both need a small free service on Cloudflare that checks the PIN and password and saves changes.
Nothing reaches the live website until the owner presses **Publish**.

How it works:
- Every change is saved to a pending copy of the site (git branch `admin-pending`) with one pull request.
- New photos are cleaned up by GitHub (`.github/workflows/admin-pending.yml`): background, watermark, small copies, tests.
- The owner sees the list of changes and presses **Publish** (merges the pull request) or **Throw away**.

## 1. GitHub token (lets the service save changes)
1. github.com → your photo (top right) → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Name: `agrawal-stores-admin`. Expiration: 1 year (put a reminder to renew it).
3. Repository access: **Only select repositories** → `agrawal-stores-website`.
4. Permissions → Repository permissions:
   - **Contents**: Read and write
   - **Pull requests**: Read and write
   - **Actions**: Read-only
5. **Generate token** and copy it (starts with `github_pat_`). Keep it for step 2.4. Do not send it in chat.

## 2. Cloudflare service
1. cloudflare.com → sign up (free plan).
2. **Workers & Pages** → **Create** → **Create Worker** → name it `agrawal-stores-admin` → **Deploy**.
3. **Edit code** → delete everything → paste the whole of `worker/src/index.js` → **Deploy**.
4. Worker → **Settings** → **Variables and Secrets** → add:
   | Name | Type | Value |
   |---|---|---|
   | `REPO` | Text | `daarrsshh/agrawal-stores-website` |
   | `ALLOWED_ORIGIN` | Text | `https://agrawalstores.in,https://www.agrawalstores.in` |
   | `GITHUB_TOKEN` | Secret | the token from step 1 |
   | `SESSION_SECRET` | Secret | any long random text (40+ letters) |
   | `USERS` | Secret | the list of people (see below) |
5. Wrong-PIN lock (recommended): **Storage & Databases** → **KV** → **Create** → name `ATTEMPTS`.
   Then Worker → **Settings** → **Bindings** → **Add** → **KV namespace** → variable name `ATTEMPTS` → choose it.
6. Copy the Worker address (looks like `https://agrawal-stores-admin.<you>.workers.dev`) and put it in `admin/config.js`.

## Logins (USERS)
Two entries: the shared staff PIN and the owner password. Make them with:
```
node worker/make-user.mjs staff 482913
node worker/make-user.mjs owner "a-long-password"
```
Put both printed lines inside `[ ... ]`, separated by a comma, as the `USERS` secret.
- The staff PIN is exactly 6 digits. The owner password is at least 10 characters.
- **When someone leaves**, make a new staff PIN and replace the staff entry: every staff phone is logged out and
  needs the new PIN. Tell the remaining staff.
- 10 wrong staff PINs, or 5 wrong owner passwords, lock that login for 15 minutes (needs the ATTEMPTS store, step 2.5).

## Updating the service later
Paste the new `worker/src/index.js` into **Edit code** → **Deploy**. Settings and people stay as they are.
