import test from "node:test";
import assert from "node:assert/strict";
import {
  createNote, reviseNote, sanitizeNotes, createBackup, backupFileName, parseBackup, mergeNotes,
  filterNotes, sortNewestFirst, isValidNote, MAX_NOTES, MAX_BACKUP_BYTES, SCHEMA_VERSION,
} from "../src/lib/vault-store.js";

const make = (id, over = {}) => createNote({ id, tags: ["note"], encTitle: `T-${id}`, encBody: `B-${id}`, now: 1000, ...over });

test("createNote sets schema version and equal timestamps", () => {
  const note = make("a");
  assert.equal(note.v, SCHEMA_VERSION);
  assert.equal(note.createdAt, 1000);
  assert.equal(note.updatedAt, 1000);
});

test("createNote rejects empty tags, unsafe tags and missing ciphertext", () => {
  assert.throws(() => make("a", { tags: [] }), /invalid/i);
  assert.throws(() => make("a", { tags: ["<img src=x onerror=alert(1)>"] }), /invalid/i);
  assert.throws(() => make("a", { encBody: "" }), /invalid/i);
  assert.throws(() => make("", {}), /invalid/i);
});

test("reviseNote keeps identity, bumps updatedAt and does not mutate the original", () => {
  const original = make("a");
  const revised = reviseNote(original, { tags: ["note", "sensitive"], encTitle: "T2", encBody: "B2", now: 2000 });
  assert.equal(revised.id, "a");
  assert.equal(revised.createdAt, 1000);
  assert.equal(revised.updatedAt, 2000);
  assert.deepEqual(revised.tags, ["note", "sensitive"]);
  assert.equal(original.encTitle, "T-a");
  assert.equal(original.updatedAt, 1000);
});

test("sanitizeNotes upgrades legacy notes that have no v or updatedAt", () => {
  const legacy = { id: "old", tags: ["note"], encTitle: "t", encBody: "b", createdAt: 5 };
  const [note] = sanitizeNotes([legacy]);
  assert.equal(note.v, SCHEMA_VERSION);
  assert.equal(note.updatedAt, 5);
});

test("sanitizeNotes drops invalid entries and duplicate ids", () => {
  const good = make("a");
  const result = sanitizeNotes([good, good, { id: "x" }, null, "str", 42]);
  assert.deepEqual(result.map((n) => n.id), ["a"]);
});

test("sanitizeNotes returns [] for non-arrays and rejects markup in tags", () => {
  assert.deepEqual(sanitizeNotes(undefined), []);
  assert.deepEqual(sanitizeNotes({ notes: [] }), []);
  const evil = { ...make("a"), tags: ["<script>"] };
  assert.equal(isValidNote(evil), false);
  assert.deepEqual(sanitizeNotes([evil]), []);
});

test("backup round-trips through JSON", () => {
  const notes = [make("a"), make("b", { tags: ["note", "sensitive"], now: 3000 })];
  const backup = createBackup(notes, { now: Date.UTC(2026, 9, 22) });
  assert.equal(backup.exportedAt, "2026-10-22T00:00:00.000Z");
  assert.deepEqual(parseBackup(JSON.stringify(backup)), notes);
});

test("backupFileName uses the ISO date", () => {
  assert.equal(backupFileName(Date.UTC(2026, 9, 22, 23, 59)), "tidevault-backup-2026-10-22.json");
});

test("parseBackup rejects bad input with clear messages", () => {
  assert.throws(() => parseBackup("{nope"), /not valid JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ app: "other", version: 1, notes: [] })), /not a SealNote backup/);
  assert.throws(() => parseBackup(JSON.stringify({ app: "tidevault", version: 99, notes: [] })), /Unsupported backup version/);
  assert.throws(() => parseBackup(JSON.stringify({ app: "tidevault", version: 1, notes: [{ id: "x" }] })), /no valid notes/);
  assert.throws(() => parseBackup("x".repeat(MAX_BACKUP_BYTES + 1)), /larger than 5 MB/);
  assert.throws(() => parseBackup(undefined), /missing/);
});

test("parseBackup accepts an empty backup", () => {
  assert.deepEqual(parseBackup(JSON.stringify({ app: "tidevault", version: 1, notes: [] })), []);
});

test("mergeNotes adds unknown notes and keeps existing ones", () => {
  const existing = [make("a")];
  const { notes, added, updated } = mergeNotes(existing, [make("a"), make("b")]);
  assert.deepEqual(notes.map((n) => n.id).sort(), ["a", "b"]);
  assert.equal(added, 1);
  assert.equal(updated, 0);
});

test("mergeNotes lets the newer updatedAt win and ignores older copies", () => {
  const existing = [make("a", { now: 1000 })];
  const newer = reviseNote(existing[0], { tags: ["note"], encTitle: "new", encBody: "new", now: 5000 });
  const older = make("a", { encTitle: "stale", now: 10 });

  const first = mergeNotes(existing, [newer]);
  assert.equal(first.notes[0].encTitle, "new");
  assert.equal(first.updated, 1);

  const second = mergeNotes(first.notes, [older]);
  assert.equal(second.notes[0].encTitle, "new");
  assert.equal(second.updated, 0);
});

test("mergeNotes refuses to exceed the vault limit", () => {
  const many = Array.from({ length: MAX_NOTES }, (_, i) => make(`n${i}`));
  assert.throws(() => mergeNotes(many, [make("extra")]), /limit/i);
});

test("filterNotes filters by tag and returns everything for an empty tag", () => {
  const notes = [make("a"), make("b", { tags: ["note", "sensitive"] })];
  assert.deepEqual(filterNotes(notes, "sensitive").map((n) => n.id), ["b"]);
  assert.equal(filterNotes(notes, "").length, 2);
});

test("sortNewestFirst orders by updatedAt without mutating the input", () => {
  const notes = [make("old", { now: 1 }), make("new", { now: 9 }), make("mid", { now: 5 })];
  assert.deepEqual(sortNewestFirst(notes).map((n) => n.id), ["new", "mid", "old"]);
  assert.deepEqual(notes.map((n) => n.id), ["old", "new", "mid"]);
});
