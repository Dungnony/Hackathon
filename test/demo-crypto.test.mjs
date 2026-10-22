import test from "node:test";
import assert from "node:assert/strict";
import { createDemoProvider } from "../src/providers/demo.js";

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const make = (storage = mem()) => createDemoProvider({ storage, session: mem() });

test("round-trips strings with tags (incl. unicode)", async () => {
  const p = make();
  const text = "Xin chào 🔐 – bí mật";
  const [c] = await p.doEncrypt([{ data: text, tags: ["note"] }]);
  assert.notEqual(c, text);
  const [d] = await p.doDecrypt([{ encrypted: c, tags: ["note"] }]);
  assert.equal(d, text);
});

test("round-trips Uint8Array as Uint8Array", async () => {
  const p = make();
  const bytes = Uint8Array.from([0, 1, 2, 250, 255]);
  const [c] = await p.doEncrypt([{ data: bytes, tags: ["file"] }]);
  const [d] = await p.doDecrypt([{ encrypted: c, tags: ["file"] }]);
  assert.ok(d instanceof Uint8Array);
  assert.deepEqual([...d], [...bytes]);
});

test("output order matches input order", async () => {
  const p = make();
  const cs = await p.doEncrypt([{ data: "a", tags: ["note"] }, { data: "b", tags: ["note"] }, { data: "c", tags: ["note"] }]);
  const ds = await p.doDecrypt(cs.map((encrypted) => ({ encrypted, tags: ["note"] })));
  assert.deepEqual(ds, ["a", "b", "c"]);
});

test("wrong tags are rejected (like a missing role)", async () => {
  const p = make();
  const [c] = await p.doEncrypt([{ data: "secret", tags: ["note", "sensitive"] }]);
  await assert.rejects(p.doDecrypt([{ encrypted: c, tags: ["note"] }]), /denied/i);
});

test("tag order does not matter", async () => {
  const p = make();
  const [c] = await p.doEncrypt([{ data: "x", tags: ["b", "a"] }]);
  const [d] = await p.doDecrypt([{ encrypted: c, tags: ["a", "b"] }]);
  assert.equal(d, "x");
});

test("tampered ciphertext is rejected", async () => {
  const p = make();
  const [c] = await p.doEncrypt([{ data: "secret", tags: ["note"] }]);
  const raw = Buffer.from(c, "base64"); raw[raw.length - 1] ^= 1;
  await assert.rejects(p.doDecrypt([{ encrypted: raw.toString("base64"), tags: ["note"] }]));
});

test("same plaintext gives different ciphertext (random IV)", async () => {
  const p = make();
  const [a, b] = await p.doEncrypt([{ data: "same", tags: ["note"] }, { data: "same", tags: ["note"] }]);
  assert.notEqual(a, b);
});

test("key persists across provider instances (same storage)", async () => {
  const storage = mem();
  const [c] = await make(storage).doEncrypt([{ data: "persist", tags: ["note"] }]);
  const [d] = await make(storage).doDecrypt([{ encrypted: c, tags: ["note"] }]);
  assert.equal(d, "persist");
});

test("invalid input is rejected", async () => {
  const p = make();
  await assert.rejects(p.doEncrypt([{ data: "x", tags: [] }]), /tag/i);
  await assert.rejects(p.doEncrypt([{ data: { a: 1 }, tags: ["note"] }]), /string or Uint8Array/);
});
