[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

**SealNote** is a private notebook where every note is encrypted in the writer's browser, and no administrator, server or vendor holds a key that can open it.

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

A hosted notes service people can trust with real secrets because the service itself cannot read them. Each note carries tags (`note`, optionally `sensitive`), and each tag needs its own role to decrypt, so access can be revoked without touching the data.

### 2. Trust constraint insight

Today someone always holds the key: a database admin, a cloud KMS or a backend secret. Breach or coerce that one party and every note is exposed, so journalists, clinicians and lawyers avoid hosted notes for sensitive work. Remove the key holder and a stolen database or backup reveals nothing.

### 3. Value & impact

A journalist keeps source contacts in SealNote. If the service is hacked or an insider goes rogue, the notes stay sealed: only the journalist's identity with the right roles opens them. The operator only ever stores ciphertext, never readable personal data.

### 4. Why TideCloak matters

TideCloak provides sign-in and roles, and `IAMService.doEncrypt` / `doDecrypt` encrypt each note in the browser under its tags. Decryption only happens when the user's identity and the `_tide_<tag>.selfdecrypt` role line up through the Tide network, so no single party holds the key. With ordinary login and backend permissions, someone would have to store that key.

### 5. Prototype & storytelling

Sign in with TideCloak, write a note, then open **What the storage sees**: only ciphertext and tags. Decrypt and edit the note. The key moment: remove `_tide_note.selfdecrypt` from the user in the admin console, sign in again and press Decrypt. Access is denied while the ciphertext is untouched.

## Setup

Requirements: [Node.js](https://nodejs.org) 18+, Docker, and `bash`, `curl` and `jq` for the realm script (Linux, macOS or WSL).

### 1. Start TideCloak

```bash
docker compose up -d     # tideorg/tidecloak-stg-dev on http://localhost:8080 (admin / password)
```

> We use Tide's staging image. On 22 October 2026 the production image (`tideorg/tidecloak-dev`) failed during license setup on Tide's side (`TIDE-IDPEXT-VENDOR-KEYGEN_FAILED`), while the staging image provisioned cleanly.

### 2. Provision the realm with Tide's official script

Tide's `tcinit.sh` (shipped in `@tidecloak/create-nextjs`) creates the realm, license, Tide identity provider and first admin. [`init/realm.json`](init/realm.json) adds SealNote's public client `tidevault` and makes `_tide_note.*` and `_tide_sensitive.*` default roles, so every user who signs in can encrypt and decrypt.

```bash
npm pack @tidecloak/create-nextjs && tar -xzf tidecloak-create-nextjs-*.tgz
TIDECLOAK_LOCAL_URL=http://localhost:8080 NEW_REALM_NAME=sealnote CLIENT_NAME=tidevault \
CLIENT_APP_URL=http://localhost:3000 REALM_JSON_PATH="$PWD/init/realm.json" \
ADAPTER_OUTPUT_PATH="$PWD/tidecloak.json" bash package/init/tcinit.sh
```

The script prints an enrollment link. Open it, create your Tide account, and the script finishes by writing `tidecloak.json`. The app checks that file at start-up for `auth-server-url`, `realm`, `resource`, `vendorId`, `homeOrkUrl` and `client-origin-auth-http://localhost:3000`; changing the dev port means a different origin, so provision again.

### 3. Run the app

```bash
npm install
npm run dev        # http://localhost:3000
```

Production build: `npm run build && npm run preview`.

### No server yet? Try demo mode

Open <http://localhost:3000/?demo=1>. This uses a local AES-GCM key stored in your browser so you can preview the whole UI. It is a stand-in, and it shows the exact single point of trust that TideCloak removes.

## Features

| | |
|---|---|
| 🔑 Login / logout | TideCloak SSO via `IAMService.doLogin / doLogout` |
| 🧩 Tag-based encryption | `IAMService.doEncrypt / doDecrypt`; every note carries the tag `note`, optionally also `sensitive` |
| 🛂 Per-tag access control | Needs roles `_tide_<tag>.selfencrypt` and `_tide_<tag>.selfdecrypt`; without them decrypt is denied |
| 👁️ Transparency panel | "What the storage sees" shows only ciphertext and tags |
| 🪪 Your access | Shows, per tag, whether the signed-in user holds `_tide_<tag>.selfencrypt` / `selfdecrypt` in their TideCloak token: the same check the SDK runs before it encrypts or decrypts, so a revoked role is visible at a glance |
| ✏️ Edit notes | Decrypt, edit, and re-encrypt in place; `updatedAt` is tracked |
| 🔍 Vault tools | Decrypt one / decrypt all, search decrypted titles, filter by tag, delete with confirmation |
| 💾 Encrypted backup | Export and import a JSON backup that holds **ciphertext only**; imports are validated and merged (newest edit wins) |
| ⏲️ Auto-lock | Decrypted notes are wiped from memory after 1 / 5 / 15 minutes of inactivity (default 5) |
| 🧼 Hygiene | Plaintext only in memory, wiped on logout; rendered with `textContent` (no XSS); session timer from token expiry |
| 🧪 Demo mode | `?demo=1` previews the UI offline with local AES-256-GCM (clearly labelled, **not** TideCloak) |
| 🛟 Friendly errors | Setup screen when `tidecloak.json` is unconfigured; error screen with Retry when the server is unreachable |

## Architecture

```
Browser (Vite SPA, vanilla JS)
 ├─ src/providers/tide.js ── @tidecloak/js ──login / token──▶ TideCloak server (Keycloak + Tide fabric)
 │                                   └── doEncrypt / doDecrypt ─▶ Tide decentralized key nodes
 ├─ src/providers/demo.js ── Web Crypto AES-GCM (offline preview only)
 ├─ src/main.js ─────────── UI, state, screens
 └─ localStorage ────────── stores ONLY ciphertext (swap for any backend API)
```

Both providers expose the same interface, so the UI does not care which one is active.

## Using the app

1. Click **Sign in with TideCloak** and authenticate.
2. Write a title and body, then **Encrypt & save**.
3. Check **What the storage sees**: only ciphertext and tags.
4. Click **Decrypt** (or **Decrypt all**) to read notes.
5. Remove `_tide_note.selfdecrypt` from the user in the admin console, log in again and try to decrypt: access is denied even though the ciphertext is still there. That is the point.

## Tests

```bash
npm test
```

60 deterministic unit tests (Node's built-in test runner, no extra dependencies):

- `demo-crypto`: the demo provider's contract: round-trips (Unicode, `Uint8Array`), output order, wrong or tampered tags, random IVs, key persistence.
- `vault-store`: note validation (including rejecting markup in tags), legacy-note upgrade, backup round-trip, hostile backup files, merge rules and limits, filtering and sorting.
- `idle-lock`: the auto-lock timer (with fake timers instead of real time) and reading the stored auto-lock choice.
- `tide-provider`: the TideCloak provider against a fake `IAMService` that reproduces the SDK's real behaviour (read from its source, v0.11.5): handlers receive `(eventName, payload)`, and a failed init emits `initError` and then still resolves `false`. Also covers timeouts and the SDK's string-typed errors.
- `config-check`: the start-up validation of `tidecloak.json`.
- `access`: the per-tag role summary behind the "Your access" panel.

What is **not** automated: the real login and encryption round trip against a running TideCloak server (verify manually with the steps above), and the DOM layer in `src/main.js`.

## Project structure

```
index.html                     UI shell and screens
src/main.js                    boot, screens, state, rendering
src/providers/tide.js          TideCloak provider (SSO + tag-based encryption)
src/providers/demo.js          offline demo provider (Web Crypto)
src/lib/vault-store.js         pure logic: validation, backup format, merge
src/lib/idle-lock.js           inactivity timer for auto-lock
src/lib/errors.js              maps SDK errors (thrown as strings) to friendly messages
src/lib/config-check.js        start-up validation of tidecloak.json
src/lib/access.js              per-tag role summary for the "Your access" panel
src/style.css                  styling
public/auth/redirect.html      login redirect target
public/silent-check-sso.html   silent SSO check
test/*.test.mjs                unit tests (demo-crypto, vault-store, idle-lock, tide-provider, config-check)
tidecloak.json                 adapter config (replace with yours)
init/realm.json                realm, client and default roles for Tide's tcinit.sh
docker-compose.yml             local TideCloak sandbox (staging image)
DEMO_SCRIPT.md                 storyboard for the demo video
.github/workflows/ci.yml       runs tests and build on every push
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "TideCloak is not configured yet" | The screen lists exactly what is wrong in `tidecloak.json`: still the placeholder, a missing `vendorId` / `homeOrkUrl`, or no `client-origin-auth-<this origin>` entry. Provision the realm again (Setup step 2) |
| Login completes but you land on the login screen again | Check `silent-check-sso.html` exists in `public/` and that the browser allows cookies for `localhost` |
| "Cannot reach TideCloak" | Server not running, wrong `auth-server-url`, or `http://localhost:3000` missing from the client's *Web origins* |
| Login loops or redirect error | Add `http://localhost:3000/*` to *Valid redirect URIs* |
| "Permission denied" on save/decrypt | Assign the `_tide_note.*` roles (and `_tide_sensitive.*`) to the user, then log out and in again |
| Encrypt fails right after setup | Make sure the Tide license is active and the user is linked to Tide |

## Security notes

- Notes are rendered with `textContent`, never `innerHTML`, to prevent XSS.
- No secrets are committed; `tidecloak.json` only holds public-client settings.
- Decrypted text lives only in memory and is wiped on logout and by auto-lock.
- Everything read from storage or an imported file is validated at the boundary: tags are limited to `[a-z0-9_-]`, notes are capped at 1000 and backups at 5 MB.
- A backup contains ciphertext only, but treat it like any other personal data: only users with the right TideCloak roles can decrypt it.
- Replacing `localStorage` with a real API only needs changes to `load/save` in `src/main.js`; the server would still receive ciphertext only.
- Demo mode keeps its key in `localStorage`. Never use it for real secrets.

## Tech stack

Vite · vanilla JS · [`@tidecloak/js`](https://www.npmjs.com/package/@tidecloak/js) · TideCloak (Keycloak + Tide Cybersecurity Fabric) · Node test runner

## Demo video

The submission video is `Video.mp4` in the repository root. Keep it under GitHub's 100 MB file limit (re-export at a lower bitrate if needed). Storyboard: [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md).

**Note on the recording:** the video uses preview mode (`?demo=1`). On 22 October 2026 realm provisioning with the production image (`tideorg/tidecloak-dev:latest`) failed on Tide's side during license setup (`TIDE-IDPEXT-VENDOR-KEYGEN_FAILED`, server log: `Midgard.FinalizeWallet ... Not enough orks returned an ok response`). We then provisioned the realm on Tide's staging image (Setup above) and verified real TideCloak sign-in, but too close to the deadline to re-record. The app code is the same in both modes; only the crypto provider differs (`src/providers/tide.js` versus `src/providers/demo.js`).

## Team

`RMIT_HNI_Androi17_C2`

Members: _add your names here_.
