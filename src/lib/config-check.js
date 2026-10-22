// Preflight check of tidecloak.json. The SDK's constructor throws when any of these are missing, but
// IAMService swallows the detail and only reports "Failed to load config", so problems are surfaced here.

const REQUIRED_KEYS = ["auth-server-url", "realm", "resource", "vendorId", "homeOrkUrl"];
const ORIGIN_KEY_PREFIX = "client-origin-auth-";

/** Returns a list of human-readable problems. An empty list means the config looks usable. */
export function findConfigProblems(config, origin) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return ["tidecloak.json is missing or is not a JSON object."];
  }
  if (config._note) {
    return ["tidecloak.json is still the placeholder. Replace it with the adapter config downloaded from your TideCloak admin console."];
  }

  const problems = REQUIRED_KEYS
    .filter((key) => !config[key])
    .map((key) => `Missing "${key}". Download the adapter config again from the admin console.`);

  const originKey = `${ORIGIN_KEY_PREFIX}${origin}`;
  if (!config[originKey]) {
    const known = Object.keys(config)
      .filter((key) => key.startsWith(ORIGIN_KEY_PREFIX))
      .map((key) => key.slice(ORIGIN_KEY_PREFIX.length));
    const knownHint = known.length ? ` The file only contains: ${known.join(", ")}.` : "";
    problems.push(
      `Missing "${originKey}": this page's origin (${origin}) is not registered for the client.${knownHint} ` +
        "Add the origin to the client's redirect URIs / web origins, then download the adapter config again.",
    );
  }
  return problems;
}
