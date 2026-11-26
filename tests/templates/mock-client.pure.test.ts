import { describe, expect, it } from "vitest";
import { withSpawnedMock } from "../../src/templates/mock-client.ts";

function get(url: string, path: string): Promise<{ status: number; body: string }> {
  return fetch(`${url}${path}`).then(async (response) => ({ status: response.status, body: await response.text() }));
}

describe("withSpawnedMock (child-process mock server)", () => {
  it("starts a child server, serves routes, and closes it (callback-driven)", async () => {
    const outcome = await withSpawnedMock(
      [{ method: "GET", path: "/exec", status: 200, body: "ACME_PANEL_EXEC_OK" }],
      async (url) => {
        expect(url.startsWith("http://127.0.0.1:")).toBe(true);
        const hit = await get(url, "/exec");
        expect(hit.status).toBe(200);
        expect(hit.body).toBe("ACME_PANEL_EXEC_OK");
        return "scanned";
      },
    );
    expect(outcome).toBe("scanned");
  });

  it("closes the child even when the body throws", async () => {
    await expect(
      withSpawnedMock([{ method: "GET", path: "*", body: "x" }], async () => {
        throw new Error("scan failed");
      }),
    ).rejects.toThrow("scan failed");
  });

  it("404s unknown paths on the child server", async () => {
    await withSpawnedMock([{ method: "GET", path: "/known", body: "y" }], async (url) => {
      const miss = await get(url, "/unknown");
      expect(miss.status).toBe(404);
    });
  });
});
