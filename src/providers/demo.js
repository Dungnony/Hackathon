// Offline DEMO provider. NOT a replacement for TideCloak.
// It mimics the same interface (doEncrypt / doDecrypt with tags) using the browser's Web Crypto API
// (AES-256-GCM). Tags are bound as Additional Authenticated Data, so decrypting with the wrong tags fails,
// like a missing role would on TideCloak. The key lives in this browser, which is exactly the single point
// of trust that TideCloak removes. Use it only to preview the UI when no TideCloak server is available.

const enc = new TextEncoder();
const dec = new TextDecoder();
const KEY_STORE = "tidevault:demo-key";
const USER_STORE = "tidevault:demo-user";

const b64 = (u8) => { let s = ""; u8.forEach((c) => (s += String.fromCharCode(c))); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const aad = (tags) => enc.encode([...tags].sort().join("|"));

export function createDemoProvider({ storage = globalThis.localStorage, session = globalThis.sessionStorage } = {}) {
  const subtle = globalThis.crypto.subtle;
  let keyPromise;

  async function getKey() {
    if (!keyPromise) {
      keyPromise = (async () => {
        const saved = storage.getItem(KEY_STORE);
        if (saved) return subtle.importKey("jwk", JSON.parse(saved), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
        const k = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
        storage.setItem(KEY_STORE, JSON.stringify(await subtle.exportKey("jwk", k)));
        return k;
      })();
    }
    return keyPromise;
  }

  async function encryptOne({ data, tags }) {
    if (!Array.isArray(tags) || tags.length === 0) throw new Error("At least one tag is required");
    const isBytes = data instanceof Uint8Array;
    if (!isBytes && typeof data !== "string") throw new Error("data must be a string or Uint8Array");
    const body = isBytes ? data : enc.encode(data);
    const plain = new Uint8Array(body.length + 1);
    plain[0] = isBytes ? 1 : 0;           // type flag so strings decrypt to strings
    plain.set(body, 1);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(tags) }, await getKey(), plain));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv); out.set(ct, iv.length);
    return b64(out);
  }

  async function decryptOne({ encrypted, tags }) {
    const raw = unb64(encrypted);
    const iv = raw.slice(0, 12);
    let plain;
    try {
      plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(tags) }, await getKey(), raw.slice(12)));
    } catch {
      throw new Error("Decryption denied: wrong tags or corrupted data (selfdecrypt permission missing)");
    }
    const body = plain.slice(1);
    return plain[0] === 1 ? body : dec.decode(body);
  }

  return {
    name: "Demo (local AES-GCM)",
    demo: true,
    async init() { return !!session.getItem(USER_STORE); },
    login(name) { session.setItem(USER_STORE, (name || "demo-user").trim() || "demo-user"); },
    logout() { session.removeItem(USER_STORE); location.reload(); },
    getName: () => session.getItem(USER_STORE) || "demo-user",
    getTokenExp: () => 0,
    // There are no roles offline: the local key can open everything, which is the point of the contrast.
    hasRole: () => true,
    doEncrypt: (items) => Promise.all(items.map(encryptOne)),
    doDecrypt: (items) => Promise.all(items.map(decryptOne)),
  };
}
