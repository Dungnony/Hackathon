// Mirrors the role check the TideCloak SDK runs before it encrypts or decrypts a tagged value,
// so the UI can show what the signed-in user is currently allowed to do.

/** TideCloak names tag roles `_tide_<tag>.selfencrypt` and `_tide_<tag>.selfdecrypt`. */
export const roleName = (tag, action) => `_tide_${tag}.self${action}`;

/** One row per tag: may this user encrypt and decrypt values carrying it? */
export function accessSummary(tags, hasRole) {
  return tags.map((tag) => ({
    tag,
    encrypt: Boolean(hasRole(roleName(tag, "encrypt"))),
    decrypt: Boolean(hasRole(roleName(tag, "decrypt"))),
  }));
}
