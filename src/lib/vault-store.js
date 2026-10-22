// Pure vault logic: validation, backup format, merging. No DOM, no TideCloak, no storage access,
// so every rule here can be unit tested deterministically.
// Notes only ever contain ciphertext and tags; plaintext never reaches this module.

export const SCHEMA_VERSION = 1;
export const BACKUP_APP = "tidevault";
export const MAX_NOTES = 1000;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

const MAX_TAGS = 8;
const MAX_ID_LENGTH = 64;
// Tags are rendered in the UI and imported from files, so they are restricted to a safe alphabet.
const TAG_PATTERN = /^[a-z0-9_-]{1,32}$/;

const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;

export function isValidNote(note) {
  return (
    note !== null &&
    typeof note === "object" &&
    isNonEmptyString(note.id) &&
    note.id.length <= MAX_ID_LENGTH &&
    isNonEmptyString(note.encTitle) &&
    isNonEmptyString(note.encBody) &&
    Array.isArray(note.tags) &&
    note.tags.length > 0 &&
    note.tags.length <= MAX_TAGS &&
    note.tags.every((tag) => typeof tag === "string" && TAG_PATTERN.test(tag)) &&
    Number.isFinite(note.createdAt)
  );
}

// Fills defaults so notes saved by older versions (no `v` / `updatedAt`) keep working.
function normalizeNote(note) {
  return {
    v: SCHEMA_VERSION,
    id: note.id,
    tags: [...note.tags],
    encTitle: note.encTitle,
    encBody: note.encBody,
    createdAt: note.createdAt,
    updatedAt: Number.isFinite(note.updatedAt) ? note.updatedAt : note.createdAt,
  };
}

function assertValid(note, action) {
  if (!isValidNote(note)) throw new Error(`Cannot ${action} note: invalid id, tags or ciphertext`);
  return normalizeNote(note);
}

export function createNote({ id, tags, encTitle, encBody, now }) {
  return assertValid({ id, tags, encTitle, encBody, createdAt: now }, "create");
}

export function reviseNote(note, { tags, encTitle, encBody, now }) {
  return assertValid({ ...note, tags, encTitle, encBody, updatedAt: now }, "update");
}

/** Keeps valid notes only, drops duplicates by id, caps the list at MAX_NOTES. */
export function sanitizeNotes(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const notes = [];
  for (const item of value) {
    if (!isValidNote(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    notes.push(normalizeNote(item));
  }
  return notes.slice(0, MAX_NOTES);
}

export function createBackup(notes, { now }) {
  return {
    app: BACKUP_APP,
    version: SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    notes: notes.map((note) => normalizeNote(note)),
  };
}

export function backupFileName(now) {
  return `${BACKUP_APP}-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
}

/** Parses an untrusted backup file. Throws an Error with a user-facing message on any problem. */
export function parseBackup(text) {
  if (typeof text !== "string" || text.length > MAX_BACKUP_BYTES) {
    throw new Error("Backup file is missing or larger than 5 MB");
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Backup is not valid JSON");
  }
  if (!data || data.app !== BACKUP_APP || !Array.isArray(data.notes)) {
    throw new Error("This is not a SealNote backup file");
  }
  if (!Number.isInteger(data.version) || data.version < 1 || data.version > SCHEMA_VERSION) {
    throw new Error(`Unsupported backup version: ${data.version}`);
  }
  const notes = sanitizeNotes(data.notes);
  if (data.notes.length > 0 && notes.length === 0) throw new Error("Backup contains no valid notes");
  return notes;
}

/** Adds unknown notes; for known ids the most recently updated copy wins. */
export function mergeNotes(existing, incoming) {
  const byId = new Map(existing.map((note) => [note.id, note]));
  let added = 0;
  let updated = 0;
  for (const note of incoming) {
    const current = byId.get(note.id);
    if (!current) {
      byId.set(note.id, note);
      added += 1;
    } else if (note.updatedAt > current.updatedAt) {
      byId.set(note.id, note);
      updated += 1;
    }
  }
  if (byId.size > MAX_NOTES) throw new Error(`Vault limit reached (${MAX_NOTES} notes)`);
  return { notes: [...byId.values()], added, updated };
}

export const filterNotes = (notes, tag) => (tag ? notes.filter((note) => note.tags.includes(tag)) : notes);

export const sortNewestFirst = (notes) => [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
