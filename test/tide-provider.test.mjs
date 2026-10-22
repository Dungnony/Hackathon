import test from "node:test";
import assert from "node:assert/strict";
import { createTideProvider, toInitError } from "../src/providers/tide.js";
import { describeError, PERMISSION_MESSAGE, NOT_AUTHENTICATED_MESSAGE } from "../src/lib/errors.js";

const CONFIG = { "auth-server-url": "http://localhost:8080/", realm: "myrealm", resource: "tidevault" };

/**
 * Fake of the @tidecloak/js IAMService that reproduces the behaviour read from its source (v0.11.5):
 *  - handlers are invoked as handler(eventName, ...payload)  (event name FIRST)
 *  - on init failure it emits "initError" and then ALSO emits "ready"(false) and resolves initIAM with false
 */
function fakeService({ outcome = "anonymous", error } = {}) {
  const handlers = {};
  const calls = [];
  const emit = (event, ...args) => (handlers[event] || []).forEach((fn) => fn(event, ...args));
  return {
    calls,
    on(event, fn) { (handlers[event] ||= []).push(fn); return this; },
    async initIAM(config) {
      calls.push(["initIAM", config]);
      if (outcome === "hang") return new Promise(() => {});
      if (outcome === "throws") throw error;
      if (outcome === "initError") { emit("initError", error); emit("ready", false); return false; }
      const authenticated = outcome === "authenticated";
      emit("ready", authenticated);
      return authenticated;
    },
    doLogin: () => calls.push(["doLogin"]),
    doLogout: () => calls.push(["doLogout"]),
    getName: () => "alice",
    getTokenExp: () => 120,
    doEncrypt: async (items) => items.map((i) => `enc(${i.data})`),
    doDecrypt: async (items) => items.map((i) => i.encrypted.slice(4, -1)),
  };
}

test("init resolves true for an authenticated user (not the string 'ready')", async () => {
  const service = fakeService({ outcome: "authenticated" });
  assert.equal(await createTideProvider(CONFIG, { service }).init(), true);
  assert.deepEqual(service.calls[0], ["initIAM", CONFIG]);
});

test("init resolves false for an anonymous visitor", async () => {
  const provider = createTideProvider(CONFIG, { service: fakeService({ outcome: "anonymous" }) });
  assert.equal(await provider.init(), false);
});

test("init rejects with the real error object, not the event name", async () => {
  const boom = new Error("Failed to fetch");
  const provider = createTideProvider(CONFIG, { service: fakeService({ outcome: "initError", error: boom }) });
  await assert.rejects(provider.init(), (err) => err === boom);
});

test("init rejects with a helpful message when the SDK reports no error detail", async () => {
  // keycloak-js often rejects with undefined when the server is unreachable.
  const provider = createTideProvider(CONFIG, { service: fakeService({ outcome: "initError", error: undefined }) });
  await assert.rejects(provider.init(), (err) => /initialization failed/i.test(err.message) && err.message !== "initError");
});

test("init rejects when initIAM itself throws", async () => {
  const provider = createTideProvider(CONFIG, { service: fakeService({ outcome: "throws", error: "Failed to load config" }) });
  await assert.rejects(provider.init(), /Failed to load config/);
});

test("init times out when the server never answers", async () => {
  const provider = createTideProvider(CONFIG, { service: fakeService({ outcome: "hang" }), timeoutMs: 20 });
  await assert.rejects(provider.init(), /No response from http:\/\/localhost:8080\//);
});

test("toInitError normalises the shapes keycloak-js and the SDK produce", () => {
  const err = new Error("x");
  assert.equal(toInitError(err), err);
  assert.equal(toInitError("boom").message, "boom");
  assert.equal(toInitError({ message: "m" }).message, "m");
  assert.equal(toInitError({ error: "access_denied", error_description: "nope" }).message, "access_denied: nope");
  assert.match(toInitError("initError").message, /initialization failed/i);
  assert.match(toInitError(undefined).message, /initialization failed/i);
});

test("getName and getTokenExp fall back safely when there is no token", () => {
  const service = { ...fakeService(), getName() { throw new TypeError("tokenParsed is undefined"); }, getTokenExp() { throw new TypeError("x"); } };
  const provider = createTideProvider(CONFIG, { service });
  assert.equal(provider.getName(), "");
  assert.equal(provider.getTokenExp(), 0);
});

test("hasRole asks the SDK for the realm role", () => {
  const service = { ...fakeService(), hasRealmRole: (role) => role === "_tide_note.selfdecrypt" };
  const provider = createTideProvider(CONFIG, { service });
  assert.equal(provider.hasRole("_tide_note.selfdecrypt"), true);
  assert.equal(provider.hasRole("_tide_sensitive.selfdecrypt"), false);
});

test("hasRole is false when the SDK cannot read a token", () => {
  const service = { ...fakeService(), hasRealmRole() { throw new Error("Not authenticated"); } };
  assert.equal(createTideProvider(CONFIG, { service }).hasRole("_tide_note.selfencrypt"), false);
});

test("getTokenExp rejects NaN", () => {
  const provider = createTideProvider(CONFIG, { service: { ...fakeService(), getTokenExp: () => Number.NaN } });
  assert.equal(provider.getTokenExp(), 0);
});

test("encrypt and decrypt are passed straight through to the SDK", async () => {
  const provider = createTideProvider(CONFIG, { service: fakeService() });
  const items = [{ data: "a", tags: ["note"] }, { data: "b", tags: ["note"] }];
  const encrypted = await provider.doEncrypt(items);
  assert.deepEqual(encrypted, ["enc(a)", "enc(b)"]);
  assert.deepEqual(await provider.doDecrypt(encrypted.map((e) => ({ encrypted: e, tags: ["note"] }))), ["a", "b"]);
});

test("login and logout delegate to the SDK", () => {
  const service = fakeService();
  const provider = createTideProvider(CONFIG, { service });
  provider.login();
  provider.logout();
  assert.deepEqual(service.calls, [["doLogin"], ["doLogout"]]);
});

test("a service must be injected", () => {
  assert.throws(() => createTideProvider(CONFIG), /IAMService/);
});

test("describeError maps SDK string errors to friendly messages", () => {
  // Exact strings thrown by the SDK (tidecloak.js encrypt/decrypt):
  assert.equal(describeError("'User has not been given any access to 'note''"), PERMISSION_MESSAGE);
  assert.equal(describeError("Not authenticated"), NOT_AUTHENTICATED_MESSAGE);
  assert.equal(describeError(new Error("Decryption denied: wrong tags")), PERMISSION_MESSAGE);
  assert.equal(describeError(new Error("Vault limit reached (1000 notes)")), "Vault limit reached (1000 notes)");
  assert.match(describeError(undefined), /unknown error/i);
  assert.match(describeError(null), /unknown error/i);
});
