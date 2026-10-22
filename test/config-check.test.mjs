import test from "node:test";
import assert from "node:assert/strict";
import { findConfigProblems } from "../src/lib/config-check.js";

const ORIGIN = "http://localhost:3000";
const good = () => ({
  realm: "myrealm",
  "auth-server-url": "http://localhost:8080/",
  resource: "tidevault",
  vendorId: "vendor-123",
  homeOrkUrl: "https://ork.example",
  [`client-origin-auth-${ORIGIN}`]: "signed-origin-token",
});

test("a complete adapter config has no problems", () => {
  assert.deepEqual(findConfigProblems(good(), ORIGIN), []);
});

test("the placeholder file is reported as such, and only that", () => {
  const problems = findConfigProblems({ realm: "myrealm", _note: "PLACEHOLDER" }, ORIGIN);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /placeholder/i);
});

test("each missing required key is named", () => {
  for (const key of ["auth-server-url", "realm", "resource", "vendorId", "homeOrkUrl"]) {
    const config = good();
    delete config[key];
    const problems = findConfigProblems(config, ORIGIN);
    assert.equal(problems.length, 1, key);
    assert.ok(problems[0].includes(`"${key}"`), key);
  }
});

test("a missing origin entry explains which origins the file does know", () => {
  const config = good();
  delete config[`client-origin-auth-${ORIGIN}`];
  config["client-origin-auth-http://localhost:5173"] = "x";
  const [problem] = findConfigProblems(config, ORIGIN);
  assert.match(problem, /client-origin-auth-http:\/\/localhost:3000/);
  assert.match(problem, /only contains: http:\/\/localhost:5173/);
});

test("a different port is a different origin", () => {
  assert.equal(findConfigProblems(good(), "http://localhost:3001").length, 1);
});

test("non-object configs are rejected", () => {
  for (const bad of [null, undefined, "x", 42, []]) {
    assert.match(findConfigProblems(bad, ORIGIN)[0], /not a JSON object/);
  }
});

test("reports several problems at once", () => {
  const config = good();
  delete config.vendorId;
  delete config.homeOrkUrl;
  delete config[`client-origin-auth-${ORIGIN}`];
  assert.equal(findConfigProblems(config, ORIGIN).length, 3);
});
