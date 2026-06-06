// User preferences stored in localStorage.
//
// Centralised here so multiple components stay consistent. All getters
// return sensible defaults when the value is missing or invalid.

const KEYS = {
  displayName: "alphawealth.displayName",
  fireTarget:  "alphawealth.fireTarget",
  apiToken:    "alphawealth.apiToken",
};

export const DEFAULTS = {
  displayName: "there",
  fireTarget:  2_500_000,
};

function safeGet(key) {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    if (typeof window === "undefined") return;
    if (value == null || value === "") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
  } catch {
    /* localStorage can be denied in private browsing; just no-op */
  }
}

export function getDisplayName() {
  const v = safeGet(KEYS.displayName);
  return v && v.trim() ? v.trim() : DEFAULTS.displayName;
}

export function setDisplayName(name) {
  safeSet(KEYS.displayName, name);
}

export function getFireTarget() {
  const v = safeGet(KEYS.fireTarget);
  if (!v) return DEFAULTS.fireTarget;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : DEFAULTS.fireTarget;
}

export function setFireTarget(value) {
  safeSet(KEYS.fireTarget, value);
}

export function getApiToken() {
  const v = safeGet(KEYS.apiToken);
  return v && v.trim() ? v.trim() : "";
}

export function setApiToken(token) {
  safeSet(KEYS.apiToken, token);
}

/** Greeting that adapts to local time-of-day. */
export function timeOfDayGreeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5)  return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good evening";
}
