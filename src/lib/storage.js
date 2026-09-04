// Polyfill for the `window.storage` API that Pundi was originally built against
// inside Claude.ai artifacts. Outside that environment (e.g. running locally via
// Vite/VS Code) there's no shared backend, so this falls back to the browser's
// localStorage. Everything is scoped to *this device/browser* — it will NOT sync
// between different computers or browsers the way the original claude.ai-hosted
// version could. Good enough for local development and personal use.

const NAMESPACE = "pundi";

function storageKey(key, shared) {
  // `shared` has no real meaning for a single local browser, but we keep the
  // parameter (and namespace by it) so behavior stays consistent with the
  // original API shape the app was written against.
  return `${NAMESPACE}:${shared ? "shared" : "local"}:${key}`;
}

async function get(key, shared = true) {
  try {
    const raw = window.localStorage.getItem(storageKey(key, shared));
    if (raw === null) return null;
    return { key, value: raw, shared };
  } catch (e) {
    console.error("storage.get failed", e);
    return null;
  }
}

async function set(key, value, shared = true) {
  try {
    window.localStorage.setItem(storageKey(key, shared), value);
    return { key, value, shared };
  } catch (e) {
    console.error("storage.set failed", e);
    return null;
  }
}

async function del(key, shared = true) {
  try {
    window.localStorage.removeItem(storageKey(key, shared));
    return { key, deleted: true, shared };
  } catch (e) {
    console.error("storage.delete failed", e);
    return null;
  }
}

async function list(prefix = "", shared = true) {
  try {
    const fullPrefix = storageKey(prefix, shared);
    const stripLen = `${NAMESPACE}:${shared ? "shared" : "local"}:`.length;
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const lk = window.localStorage.key(i);
      if (lk && lk.startsWith(fullPrefix)) keys.push(lk.slice(stripLen));
    }
    return { keys, prefix, shared };
  } catch (e) {
    console.error("storage.list failed", e);
    return null;
  }
}

if (typeof window !== "undefined" && !window.storage) {
  window.storage = { get, set, delete: del, list };
}
