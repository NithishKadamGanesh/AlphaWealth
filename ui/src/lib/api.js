// Central API auth helper.
//
// The backend services accept an optional API token (env API_TOKEN). When the
// user sets that token in Settings, every request from the UI to a backend
// service must carry `Authorization: Bearer <token>`.
//
// Rather than edit every fetch() call site across hooks and pages, we install a
// one-time global fetch interceptor that injects the header for requests aimed
// at our own backend ports. Requests to third parties (or with an explicit
// Authorization header already set) are left untouched.

import { getApiToken } from "./userPrefs";

// Ports used by AlphaWealth backend services (Java + Python + Ollama).
const BACKEND_PORTS = new Set([
  "8088", "8089", "8090", "8091", "8092", "8093",
  "8094", "8095", "8096", "8097", "8098", "9000", "11434",
]);

function isBackendUrl(url) {
  try {
    const u = new URL(url, window.location.href);
    // Same-host backend service on a known port, or any localhost service.
    if (BACKEND_PORTS.has(u.port)) return true;
    if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.port) return true;
    return false;
  } catch {
    return false;
  }
}

let _installed = false;

/** Install the global fetch interceptor exactly once. */
export function installFetchAuth() {
  if (_installed || typeof window === "undefined" || !window.fetch) return;
  _installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init = {}) => {
    const token = getApiToken();
    if (!token) return originalFetch(input, init);

    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!isBackendUrl(url)) return originalFetch(input, init);

    // Merge headers without clobbering an explicit Authorization.
    const headers = new Headers(
      (init && init.headers) || (typeof input !== "string" && input.headers) || {}
    );
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return originalFetch(input, { ...init, headers });
  };
}

/** Convenience for code that wants to build headers explicitly. */
export function authHeaders(extra = {}) {
  const token = getApiToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}
