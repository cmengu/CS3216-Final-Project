import { describe, expect, it } from "vitest";
import { resolveServiceUrl } from "./service-url";

describe("local API cookie site", () => {
  it("uses localhost API cookies for a localhost frontend, preserving its port and base path", () => {
    expect(resolveServiceUrl("http://127.0.0.1:8001", "localhost")).toBe("http://localhost:8001");
    expect(resolveServiceUrl("http://127.0.0.1:8001/api", "localhost")).toBe("http://localhost:8001/api");
  });

  it("uses IP API cookies for an IP frontend", () => {
    expect(resolveServiceUrl("http://localhost:8001", "127.0.0.1")).toBe("http://127.0.0.1:8001");
  });

  it("leaves server rendering, relative proxies and configured remote services unchanged", () => {
    expect(resolveServiceUrl("http://127.0.0.1:8001")).toBe("http://127.0.0.1:8001");
    expect(resolveServiceUrl("/api/invoice", "localhost")).toBe("/api/invoice");
    expect(resolveServiceUrl("http://100.68.189.117:8001", "localhost")).toBe("http://100.68.189.117:8001");
    expect(resolveServiceUrl("https://api.example.com", "localhost")).toBe("https://api.example.com");
    expect(resolveServiceUrl("http://127.0.0.1:8001", "app.example.com")).toBe("http://127.0.0.1:8001");
    expect(resolveServiceUrl("http://localhost:8001", "localhost")).toBe("http://localhost:8001");
  });
});
