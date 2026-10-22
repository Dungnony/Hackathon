// The TideCloak SDK throws plain strings (e.g. 'Not authenticated'), not Error objects,
// so everything is normalised here into one user-facing message.

const PERMISSION_PATTERN = /selfencrypt|selfdecrypt|permission|forbidden|denied|not been given any access|\brole\b/i;
const NOT_AUTHENTICATED_PATTERN = /not authenticated/i;

export const PERMISSION_MESSAGE =
  "Permission denied: this user needs the _tide_note.selfencrypt / selfdecrypt roles (and _tide_sensitive.* for sensitive notes).";
export const NOT_AUTHENTICATED_MESSAGE = "Your session is not authenticated. Please log out and sign in again.";

export function describeError(err) {
  const message = String(err?.message ?? err ?? "").trim();
  if (!message || message === "undefined") return "Unknown error. See the browser console for details.";
  if (NOT_AUTHENTICATED_PATTERN.test(message)) return NOT_AUTHENTICATED_MESSAGE;
  if (PERMISSION_PATTERN.test(message)) return PERMISSION_MESSAGE;
  return message;
}
