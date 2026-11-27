import { createServer, type Server } from "node:http";
import { z } from "zod";

/**
 * Mock-server contract (branded): a programmed route the mock target serves.
 * Every field is validated at the boundary — method uppercase, path shape
 * (exact | prefix/* | *), status 1xx-5xx — so malformed expectations fail at
 * parse time, never mid-scan.
 */
export const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "*"]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const MockRouteSchema = z.object({
  method: HttpMethodSchema,
  path: z
    .string()
    .min(1)
    .refine(
      (value) => value === "*" || value.startsWith("/") || value.endsWith("/*"),
      "path must be '*', '/*'-suffixed, or start with '/'",
    ),
  status: z.number().int().min(100).max(599).optional(),
  body: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type MockRouteInput = z.input<typeof MockRouteSchema>;
export type MockRoute = z.infer<typeof MockRouteSchema>;

/** Runtime-checked constructor: untyped route payload → branded MockRoute. */
export function mockRoute(raw: unknown): MockRoute {
  return MockRouteSchema.parse(raw);
}

export interface MockTarget {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export function benignProfile(): MockRoute[] {
  return [
    {
      method: "GET",
      path: "*",
      status: 200,
      body: [
        "<!DOCTYPE html>",
        "<html><head><title>Welcome to nginx!</title></head>",
        "<body><h1>Welcome to nginx!</h1>",
        "<p>If you see this page, the nginx web server is successfully installed.</p></body></html>",
      ].join("\n"),
      headers: { "Content-Type": "text/html", Server: "nginx/1.24.0" },
    },
  ];
}

function routeMatches(route: MockRoute, method: string, pathname: string): boolean {
  if (route.method !== "*" && route.method.toUpperCase() !== method.toUpperCase()) return false;
  if (route.path === "*") return true;
  if (route.path.endsWith("/*")) {
    const prefix = route.path.slice(0, -1);
    return pathname.startsWith(prefix);
  }
  return pathname === route.path;
}

export async function startMockTarget(routes: MockRoute[], host = "127.0.0.1"): Promise<MockTarget> {
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "mock.local"}`);
    const route = routes.find((candidate) => routeMatches(candidate, request.method ?? "GET", url.pathname));
    if (!route) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not Found");
      return;
    }
    response.writeHead(route.status ?? 200, route.headers ?? { "Content-Type": "text/plain" });
    response.end(route.body ?? "");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("mock target did not get a port"));
        return;
      }
      resolve({
        url: `http://${host}:${address.port}`,
        port: address.port,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}
