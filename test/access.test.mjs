import test from "node:test";
import assert from "node:assert/strict";
import { roleName, accessSummary } from "../src/lib/access.js";

test("roleName follows TideCloak's _tide_<tag>.self<action> convention", () => {
  assert.equal(roleName("note", "encrypt"), "_tide_note.selfencrypt");
  assert.equal(roleName("sensitive", "decrypt"), "_tide_sensitive.selfdecrypt");
});

test("accessSummary reports encrypt and decrypt per tag from the role check", () => {
  const granted = new Set(["_tide_note.selfencrypt", "_tide_note.selfdecrypt", "_tide_sensitive.selfencrypt"]);
  assert.deepEqual(accessSummary(["note", "sensitive"], (role) => granted.has(role)), [
    { tag: "note", encrypt: true, decrypt: true },
    { tag: "sensitive", encrypt: true, decrypt: false },
  ]);
});

test("accessSummary coerces non-boolean role checks", () => {
  assert.deepEqual(accessSummary(["note"], () => undefined), [{ tag: "note", encrypt: false, decrypt: false }]);
});
