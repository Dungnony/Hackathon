# Demo video script (about 90 seconds)

Record the **real TideCloak mode**, not `?demo=1`: the challenge is about TideCloak. Use `docker compose up -d`, a configured `tidecloak.json`, and a user that has the `_tide_note.*` roles. Screen-record at 1080p, mic on, browser zoom 110%.

## Before recording

- [ ] TideCloak running, license active, client `tidevault` created
- [ ] Two roles ready to toggle: `_tide_note.selfdecrypt` on your user
- [ ] Browser tab with the admin console open next to the app tab
- [ ] Vault is empty (clear site data) so the first note appears cleanly

## Storyboard

| Time | On screen | Say |
|---|---|---|
| 0:00 | Login screen | "SealNote keeps secret notes where nobody, not even the server admin, can read them. It is built on TideCloak." |
| 0:10 | Click Sign in, TideCloak login, land on the vault | "I sign in through TideCloak SSO. There is no password database for an attacker to steal." |
| 0:25 | Create a note, tick `sensitive`, press Encrypt & save | "The title and body are encrypted in my browser using TideCloak tag-based encryption. This note needs the `note` and `sensitive` tags." |
| 0:40 | Scroll to **What the storage sees** | "This is everything the storage holds: ciphertext and tags. No plaintext and no key." |
| 0:50 | Press Decrypt, then Edit, change a word, update | "Decrypting works because my user holds the matching roles. I can edit and re-encrypt in place." |
| 1:05 | Admin console: remove the `_tide_note.selfdecrypt` role, log out and in, press Decrypt | "Now I remove the decrypt role. The data is still there, but decryption is denied. Access is enforced by cryptography, not by trusting a server." |
| 1:20 | Export backup, show the JSON file | "Backups are ciphertext too, so they are safe to store anywhere." |
| 1:28 | Back to the app, mention Auto-lock | "The vault also locks itself after inactivity and wipes decrypted notes from memory. Thanks for watching." |

## Tips

- Keep it under two minutes; judges watch many videos.
- If decryption fails live, check the role assignment first, then log out and in again.
- Say what you built, why TideCloak matters, and show the "denied" moment: it is the strongest proof.
