import { IAMService } from "@tidecloak/js";
import config from "../tidecloak.json";
import { createTideProvider } from "./providers/tide.js";
import { createDemoProvider } from "./providers/demo.js";
import { createIdleLock, parseLockMinutes } from "./lib/idle-lock.js";
import { describeError } from "./lib/errors.js";
import { findConfigProblems } from "./lib/config-check.js";
import { accessSummary, roleName } from "./lib/access.js";
import {
  MAX_BACKUP_BYTES, backupFileName, createBackup, createNote, filterNotes, mergeNotes,
  parseBackup, reviseNote, sanitizeNotes, sortNewestFirst,
} from "./lib/vault-store.js";

const BASE_TAG = "note";
const EXTRA_TAG = "sensitive";
const TOAST_MS = 6000;
const TOKEN_TICK_MS = 15000;
const MS_PER_MINUTE = 60000;
const LOCK_CHOICES_MIN = [0, 1, 5, 15];
const DEFAULT_LOCK_MIN = 5;
const LOCK_PREF_KEY = "tidevault:lock-minutes";
const ACTIVITY_EVENTS = ["pointerdown", "keydown"];
const CIPHER_PREVIEW_CHARS = 96;
const RAW_PREVIEW_CHARS = 48;

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove("hidden");
const hide = (id) => $(id).classList.add("hidden");
const SCREENS = ["loading", "setup", "error", "login", "dashboard"];
const goto = (id) => SCREENS.forEach((screen) => (screen === id ? show(screen) : hide(screen)));

// Builds elements with the DOM API only. Never innerHTML: notes can come from imported files.
function h(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// ---- provider ----
const wantsDemo = new URLSearchParams(location.search).get("demo") === "1";
const provider = wantsDemo ? createDemoProvider() : createTideProvider(config, { service: IAMService });

// ---- state: only ciphertext is ever persisted; plaintext lives in `opened` (memory) ----
let storeKey = "tidevault:notes";
let notes = [];
let editingId = null;
let tokenTimer = null;
const opened = new Map(); // note id -> { title, body }

function loadNotes() {
  try {
    return sanitizeNotes(JSON.parse(localStorage.getItem(storeKey) || "[]"));
  } catch (err) {
    console.error("Stored notes are unreadable and were ignored", err);
    toast("Stored notes were unreadable and were ignored.", "err");
    return [];
  }
}

/** Persists first, updates state only on success, so a full or blocked storage never desyncs the UI. */
function commit(next) {
  try {
    localStorage.setItem(storeKey, JSON.stringify(next));
  } catch (err) {
    console.error(err);
    toast("Could not save: browser storage is full or blocked.", "err");
    return false;
  }
  notes = next;
  render();
  return true;
}

function toast(text, kind = "ok") {
  const el = $("form-msg");
  el.textContent = text;
  el.className = `msg ${kind}`;
  setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, TOAST_MS);
}

// ---- crypto ----
async function encryptFields(title, body, tags) {
  const [encTitle, encBody] = await provider.doEncrypt([{ data: title, tags }, { data: body, tags }]);
  return { encTitle, encBody };
}

async function decryptNote(note) {
  const [title, body] = await provider.doDecrypt([
    { encrypted: note.encTitle, tags: note.tags },
    { encrypted: note.encBody, tags: note.tags },
  ]);
  return { title, body };
}

// ---- idle lock ----
function readLockPreference() {
  return parseLockMinutes(localStorage.getItem(LOCK_PREF_KEY), { choices: LOCK_CHOICES_MIN, fallback: DEFAULT_LOCK_MIN });
}

function lockVault() {
  if (opened.size === 0 && editingId === null) return;
  opened.clear();
  resetForm();
  render();
  toast("Vault locked: decrypted notes were cleared from memory.");
}

const idle = createIdleLock({ timeoutMs: readLockPreference() * MS_PER_MINUTE, onLock: lockVault });

// ---- rendering ----
const formatDate = (ms) => new Date(ms).toLocaleString();

function tagBadges(tags) {
  const wrap = h("div");
  tags.forEach((tag) => wrap.append(h("span", "tag", tag)));
  return wrap;
}

function permissionPill(allowed, tag, action) {
  const pill = h("span", `perm ${allowed ? "yes" : "no"}`, `${allowed ? "✓" : "✗"} ${action}`);
  pill.title = roleName(tag, action);
  return pill;
}

// Shows the same role check the SDK runs before encrypting or decrypting, so a revoked role is visible.
function renderAccess() {
  $("access-source").textContent = provider.demo ? "Demo mode: the local key opens everything" : "Read from your TideCloak token";
  const rows = accessSummary([BASE_TAG, EXTRA_TAG], provider.hasRole).map((row) => {
    const line = h("div", "access-row");
    line.append(
      h("span", "tag", row.tag),
      permissionPill(row.encrypt, row.tag, "encrypt"),
      permissionPill(row.decrypt, row.tag, "decrypt"),
      h("code", "role-names", `${roleName(row.tag, "encrypt")} · ${roleName(row.tag, "decrypt")}`),
    );
    return line;
  });
  $("access").replaceChildren(...rows);
}

function actionButton(label, action, style) {
  const button = h("button", `btn ${style}`, label);
  button.type = "button";
  button.dataset.act = action;
  return button;
}

function renderNote(note) {
  const plain = opened.get(note.id);
  const card = h("article", plain ? "note open" : "note");
  card.dataset.id = note.id;

  const head = h("div", "row between");
  head.append(h("h3", "", plain ? plain.title : "🔒 Encrypted note"), tagBadges(note.tags));

  const content = plain
    ? h("p", "body", plain.body)
    : h("code", "cipher", `${note.encBody.slice(0, CIPHER_PREVIEW_CHARS)}…`);

  const actions = h("span");
  actions.append(
    ...(plain
      ? [actionButton("Edit", "edit", "ghost"), actionButton("Hide", "hide", "ghost")]
      : [actionButton("Decrypt", "dec", "primary")]),
    actionButton("Delete", "del", "danger"),
  );
  const stamp = note.updatedAt > note.createdAt ? `edited ${formatDate(note.updatedAt)}` : formatDate(note.createdAt);
  const foot = h("div", "row between");
  foot.append(h("span", "muted small", stamp), actions);

  card.append(head, content, foot);
  return card;
}

function render() {
  const sorted = sortNewestFirst(notes);
  const query = $("search").value.trim().toLowerCase();
  const visible = filterNotes(sorted, $("tag-filter").value).filter((note) => {
    if (!query) return true;
    const plain = opened.get(note.id);
    return Boolean(plain) && plain.title.toLowerCase().includes(query);
  });

  $("count").textContent = String(notes.length);
  $("notes").replaceChildren(...visible.map(renderNote));
  $("empty").textContent = notes.length === 0
    ? "No notes yet. Create your first encrypted note."
    : visible.length === 0 ? "No notes match. Search only covers titles that are decrypted." : "";
  $("empty").classList.toggle("hidden", visible.length > 0);
  $("raw").textContent = JSON.stringify(
    sorted.map((note) => ({
      id: note.id.slice(0, 8),
      tags: note.tags,
      encTitle: `${note.encTitle.slice(0, RAW_PREVIEW_CHARS)}…`,
      encBody: `${note.encBody.slice(0, RAW_PREVIEW_CHARS)}…`,
    })),
    null,
    2,
  );
}

// ---- note form (create + edit) ----
function resetForm() {
  editingId = null;
  $("note-form").reset();
  $("form-title").textContent = "New secret note";
  $("submit-btn").textContent = "Encrypt & save";
  hide("cancel-edit");
}

function startEdit(note) {
  const plain = opened.get(note.id);
  if (!plain) return;
  editingId = note.id;
  $("note-title").value = plain.title;
  $("note-body").value = plain.body;
  $("tag-extra").checked = note.tags.includes(EXTRA_TAG);
  $("form-title").textContent = "Edit note";
  $("submit-btn").textContent = "Encrypt & update";
  show("cancel-edit");
  $("note-title").focus();
}

// Keeps any extra tags an imported note already has; only the `sensitive` tag is user-controlled here.
function tagsForSubmit(existing) {
  const kept = (existing?.tags ?? [BASE_TAG]).filter((tag) => tag !== EXTRA_TAG);
  return $("tag-extra").checked ? [...kept, EXTRA_TAG] : kept;
}

async function submitNote(event) {
  event.preventDefault();
  const title = $("note-title").value.trim();
  const body = $("note-body").value;
  if (!title || !body.trim()) return toast("Title and note cannot be empty.", "err");

  const button = event.submitter;
  button.disabled = true;
  try {
    const existing = notes.find((note) => note.id === editingId);
    const tags = tagsForSubmit(existing);
    const fields = await encryptFields(title, body, tags);
    const now = Date.now();
    const saved = existing
      ? reviseNote(existing, { tags, ...fields, now })
      : createNote({ id: crypto.randomUUID(), tags, ...fields, now });
    const next = existing ? notes.map((note) => (note.id === saved.id ? saved : note)) : [...notes, saved];
    if (!commit(next)) return;
    if (existing) opened.set(saved.id, { title, body });
    resetForm();
    render();
    toast(`${existing ? "Updated" : "Encrypted"} ${provider.demo ? "(demo)" : "with TideCloak"} and saved ✔`);
  } catch (err) {
    toast(describeError(err), "err");
  } finally {
    button.disabled = false;
  }
}

// ---- vault actions ----
async function onNoteAction(event) {
  const button = event.target.closest("[data-act]");
  const card = event.target.closest("[data-id]");
  if (!button || !card) return;
  const note = notes.find((item) => item.id === card.dataset.id);
  if (!note) return;

  switch (button.dataset.act) {
    case "dec":
      button.disabled = true;
      button.textContent = "Decrypting…";
      try { opened.set(note.id, await decryptNote(note)); } catch (err) { toast(describeError(err), "err"); }
      render();
      break;
    case "hide":
      opened.delete(note.id);
      if (editingId === note.id) resetForm();
      render();
      break;
    case "edit":
      startEdit(note);
      break;
    case "del":
      if (!confirm("Delete this note permanently?")) return;
      opened.delete(note.id);
      if (editingId === note.id) resetForm();
      commit(notes.filter((item) => item.id !== note.id));
      break;
  }
}

async function decryptAll(event) {
  const button = event.currentTarget;
  button.disabled = true;
  let failed = 0;
  for (const note of notes) {
    if (opened.has(note.id)) continue;
    try { opened.set(note.id, await decryptNote(note)); } catch { failed += 1; }
  }
  button.disabled = false;
  render();
  if (failed) toast(`${failed} note(s) could not be decrypted (missing role or tag).`, "err");
}

function exportBackup() {
  if (notes.length === 0) return toast("Nothing to export yet.", "err");
  const now = Date.now();
  const blob = new Blob([JSON.stringify(createBackup(notes, { now }), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = h("a");
  link.href = url;
  link.download = backupFileName(now);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Backup downloaded. It contains ciphertext only.");
}

async function importBackup(event) {
  const [file] = event.target.files;
  event.target.value = ""; // allows re-importing the same file
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error("Backup file is larger than 5 MB");
    const merged = mergeNotes(notes, parseBackup(await file.text()));
    if (commit(merged.notes)) toast(`Imported ${merged.added} new and ${merged.updated} updated note(s).`);
  } catch (err) {
    toast(describeError(err), "err");
  }
}

// ---- screens ----
function enterDashboard() {
  const user = provider.getName() || "user";
  storeKey = `${provider.demo ? "tidevault:demo" : "tidevault:notes"}:${user}`;
  notes = loadNotes();
  $("user-name").textContent = `👤 ${user}`;
  $("provider").textContent = provider.name;
  $("demo-banner").classList.toggle("hidden", !provider.demo);
  $("lock-select").value = String(readLockPreference());

  clearInterval(tokenTimer);
  const tick = () => {
    const seconds = provider.getTokenExp();
    $("token-exp").textContent = seconds > 0 ? `session ${Math.floor(seconds / 60)}m left` : "";
  };
  tick();
  tokenTimer = setInterval(tick, TOKEN_TICK_MS);

  renderAccess();
  goto("dashboard");
  render();
  idle.start();
}

function showLogin() {
  if (provider.demo) {
    show("demo-name");
    $("login-btn").textContent = "Enter demo vault";
  }
  goto("login");
}

async function boot() {
  const problems = wantsDemo ? [] : findConfigProblems(config, location.origin);
  if (problems.length > 0) {
    $("config-problems").replaceChildren(...problems.map((problem) => h("li", "", problem)));
    return goto("setup");
  }
  goto("loading");
  try {
    (await provider.init()) ? enterDashboard() : showLogin();
  } catch (err) {
    console.error(err);
    $("error-detail").textContent = String(err?.message || err);
    goto("error");
  }
}

// ---- wiring ----
$("login-btn").onclick = () => {
  if (!provider.demo) return provider.login();
  provider.login($("demo-name").value);
  enterDashboard();
};
$("demo-name").addEventListener("keydown", (event) => { if (event.key === "Enter") $("login-btn").click(); });
$("logout-btn").onclick = () => {
  idle.stop();
  opened.clear();
  provider.logout();
};
$("retry-btn").onclick = () => location.reload();

$("note-form").addEventListener("submit", submitNote);
$("cancel-edit").onclick = resetForm;
$("notes").addEventListener("click", onNoteAction);
$("search").addEventListener("input", render);
$("tag-filter").addEventListener("change", render);
$("decrypt-all").addEventListener("click", decryptAll);
$("export-btn").onclick = exportBackup;
$("import-btn").onclick = () => $("import-input").click();
$("import-input").addEventListener("change", importBackup);

$("lock-select").addEventListener("change", (event) => {
  const minutes = Number(event.target.value);
  if (!LOCK_CHOICES_MIN.includes(minutes)) return;
  localStorage.setItem(LOCK_PREF_KEY, String(minutes));
  idle.setTimeoutMs(minutes * MS_PER_MINUTE);
});
ACTIVITY_EVENTS.forEach((name) => document.addEventListener(name, () => idle.touch(), { passive: true }));

boot();
