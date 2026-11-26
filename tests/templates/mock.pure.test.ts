import { request } from "node:http";
import { describe, expect, it } from "vitest";
import { benignProfile, type MockRoute, startMockTarget } from "../../src/templates/mock.ts";

function get(url: string, path: string): Promise<{ status: number; body: string; server: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { path, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        const server = res.headers.server;
        resolve({
          status: res.statusCode ?? 0,
          body,
          server: Array.isArray(server) ? (server[0] ?? "") : (server ?? ""),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("startMockTarget", () => {
  it("serves configured routes and 404s unknown paths", async () => {
    const routes: MockRoute[] = [
      {
        method: "GET",
        path: "/vulnerable",
        status: 200,
        body: "VulnApp Management Console v2.1.0",
        headers: { "Content-Type": "text/html" },
      },
    ];
    const target = await startMockTarget(routes);
    try {
      const hit = await get(target.url, "/vulnerable");
      expect(hit.status).toBe(200);
      expect(hit.body).toContain("VulnApp Management Console");
      const miss = await get(target.url, "/other");
      expect(miss.status).toBe(404);
    } finally {
      await target.close();
    }
  });

  it("supports wildcard routes and prefixes", async () => {
    const target = await startMockTarget([{ method: "GET", path: "*", status: 200, body: "any" }]);
    try {
      const anyPath = await get(target.url, "/whatever");
      expect(anyPath.status).toBe(200);
      expect(anyPath.body).toBe("any");
    } finally {
      await target.close();
    }
  });

  it("close() frees the port", async () => {
    const target = await startMockTarget([{ method: "GET", path: "*", body: "x" }]);
    await target.close();
    await expect(get(target.url, "/")).rejects.toThrow();
  });
});

describe("benignProfile", () => {
  it("returns a generic welcome page for every path", async () => {
    const target = await startMockTarget(benignProfile());
    try {
      const page = await get(target.url, "/anything");
      expect(page.status).toBe(200);
      expect(page.server).toBe("nginx/1.24.0");
      expect(page.body).toContain("Welcome to nginx");
    } finally {
      await target.close();
    }
  });
});
