/** Keep local API cookies on the same site as the browser's local frontend. */
export function resolveServiceUrl(configured: string, pageHostname?: string): string {
  const loopback = new Set(["localhost", "127.0.0.1"]);
  if (!pageHostname || !loopback.has(pageHostname)) return configured;
  try {
    const url = new URL(configured);
    if (!loopback.has(url.hostname) || url.hostname === pageHostname) return configured;
    url.hostname = pageHostname;
    return url.toString().replace(/\/$/, "");
  } catch {
    // Relative URLs, including same-origin API proxies, already use the browser's host.
    return configured;
  }
}
