// Real provider: TideCloak SSO + decentralized tag-based encryption.
// The IAMService singleton is injected (see main.js) so this module has no browser-only imports
// and can be unit tested with a fake service that mimics the SDK's real event behaviour.

const DEFAULT_TIMEOUT_MS = 15000;
const GENERIC_INIT_ERROR = "TideCloak initialization failed. Check the browser console and your tidecloak.json.";

// IAMService calls handlers as handler(eventName, payload), so the payload is the LAST argument.
const payloadOf = (args) => args[args.length - 1];

/** Normalises whatever the SDK or keycloak-js reports (Error, string, {error}, undefined) into an Error. */
export function toInitError(payload) {
  if (payload instanceof Error) return payload;
  if (typeof payload === "string" && payload && payload !== "initError") return new Error(payload);
  if (payload && typeof payload.message === "string" && payload.message) return new Error(payload.message);
  if (payload && typeof payload.error === "string") {
    const detail = payload.error_description ? `${payload.error}: ${payload.error_description}` : payload.error;
    return new Error(detail);
  }
  return new Error(GENERIC_INIT_ERROR);
}

export function createTideProvider(config, { service, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!service) throw new Error("createTideProvider requires an IAMService instance");

  // The SDK throws when there is no token yet (e.g. after logout), so reads are guarded.
  const safely = (read, fallback) => {
    try { return read(); } catch { return fallback; }
  };

  return {
    name: "TideCloak",
    demo: false,

    /** Resolves with `true` if the user is already authenticated, `false` otherwise. Rejects on failure. */
    init() {
      return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        const settle = (fn, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn(value);
        };
        timer = setTimeout(
          () => settle(reject, new Error(`No response from ${config["auth-server-url"]} after ${timeoutMs / 1000}s`)),
          timeoutMs,
        );
        // On failure the SDK emits "initError" first and then still resolves initIAM with false,
        // so the error has to win the race. The authenticated state comes from initIAM's return value.
        service.on("initError", (...args) => settle(reject, toInitError(payloadOf(args))));
        Promise.resolve()
          .then(() => service.initIAM(config))
          .then((authenticated) => settle(resolve, Boolean(authenticated)), (err) => settle(reject, toInitError(err)));
      });
    },

    login: () => service.doLogin(),
    logout: () => service.doLogout(),
    getName: () => safely(() => service.getName() || "", ""),
    getTokenExp: () => safely(() => { const s = service.getTokenExp(); return Number.isFinite(s) ? s : 0; }, 0),
    hasRole: (role) => safely(() => Boolean(service.hasRealmRole(role)), false),

    // items: [{ data: string | Uint8Array, tags: string[] }]  ->  string[]
    doEncrypt: (items) => service.doEncrypt(items),
    // items: [{ encrypted: string, tags: string[] }]          ->  (string | Uint8Array)[]
    doDecrypt: (items) => service.doDecrypt(items),
  };
}
