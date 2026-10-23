/** Notify sibling tabs without storing any invoice or master-list data in the browser. */
export function broadcastServiceChange(key: string, version: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, `${version}:${Date.now()}:${Math.random()}`);
  } catch {
    // Focus/visibility refresh still works when browser storage is unavailable.
  }
}

export function listenForServiceChanges(key: string, refresh: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const visible = () => {
    if (document.visibilityState !== "hidden") refresh();
  };
  const changed = (event: StorageEvent) => {
    if (event.key === key || event.key === null) refresh();
  };
  window.addEventListener("focus", visible);
  window.addEventListener("storage", changed);
  document.addEventListener("visibilitychange", visible);
  return () => {
    window.removeEventListener("focus", visible);
    window.removeEventListener("storage", changed);
    document.removeEventListener("visibilitychange", visible);
  };
}
