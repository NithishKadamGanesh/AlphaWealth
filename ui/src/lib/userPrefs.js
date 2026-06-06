// User preferences stored in localStorage.
//
// Centralised here so multiple components stay consistent. All getters
// return sensible defaults when the value is missing or invalid.

const KEYS = {
  displayName: "alphawealth.displayName",
  fireTarget:  "alphawealth.fireTarget",
  apiToken:    "alphawealth.apiToken",
  avatar:      "alphawealth.avatar",
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

/** Profile avatar, stored as a small base64 data URL (or "" if none). */
export function getAvatar() {
  const v = safeGet(KEYS.avatar);
  return v && v.startsWith("data:") ? v : "";
}

export function setAvatar(dataUrl) {
  safeSet(KEYS.avatar, dataUrl);
}

/** Two-letter initials derived from a name, for the avatar fallback. */
export function initialsFromName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
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
