import express from "express";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { desktopHealthProof, registerDesktopAuth } from "./desktopAuth";

const DESKTOP_TOKEN = "a".repeat(64);
const VALID_CHALLENGE = "b".repeat(64);

type HttpResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
};

type DesktopFixture = {
  server: Server;
  port: number;
  origin: string;
};

function sendRequest(
  fixture: DesktopFixture,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: fixture.port,
        path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function createDesktopFixture(): Promise<DesktopFixture> {
  const app = express();
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Test server did not bind to a TCP port.");
  }
  const port = (address as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  vi.stubEnv("MAF_DESKTOP", "1");
  vi.stubEnv("MAF_DESKTOP_TOKEN", DESKTOP_TOKEN);
  vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("PORT", String(port));

  registerDesktopAuth(app);
  app.use(express.json());
  app.get("/api/read", (_req, res) => res.status(200).json({ ok: true }));
  app.post("/api/write", (req, res) => res.status(200).json({ saved: req.body?.value }));
  app.get("/static/app.js", (_req, res) => res.status(200).type("javascript").send("app();"));

  return { server, port, origin };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

function sessionCookie(response: HttpResponse): string {
  const raw = response.headers["set-cookie"];
  const setCookie = Array.isArray(raw) ? raw[0] : raw;
  if (!setCookie) throw new Error("Expected the bootstrap response to set a cookie.");
  return setCookie.split(";", 1)[0];
}

describe("desktop loopback HTTP authentication", () => {
  let fixture: DesktopFixture;
  let cookie: string;

  beforeAll(async () => {
    fixture = await createDesktopFixture();
    const bootstrap = await sendRequest(
      fixture,
      `/desktop/bootstrap?token=${DESKTOP_TOKEN}&next=${encodeURIComponent("/setup?desktop=1")}`,
    );
    cookie = sessionCookie(bootstrap);
  });

  afterAll(async () => {
    if (fixture?.server) await closeServer(fixture.server);
    vi.unstubAllEnvs();
  });

  it("rejects requests carrying the wrong Host header before routing", async () => {
    const response = await sendRequest(fixture, "/api/read", {
      headers: { Host: "attacker.invalid" },
    });

    expect(response.status).toBe(421);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toBe("Unexpected desktop host");
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-64-character-hex-challenge"],
  ])("rejects a %s health challenge", async (_label, challenge) => {
    const response = await sendRequest(fixture, "/desktop/health", {
      headers: challenge ? { "X-MAF-Desktop-Challenge": challenge } : undefined,
    });

    expect(response.status).toBe(403);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toBe("Desktop health rejected");
  });

  it("returns the valid HMAC for a well-formed health challenge", async () => {
    const response = await sendRequest(fixture, "/desktop/health", {
      headers: { "X-MAF-Desktop-Challenge": VALID_CHALLENGE },
    });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toBe(desktopHealthProof(DESKTOP_TOKEN, VALID_CHALLENGE));
    expect(response.body).not.toBe(desktopHealthProof("c".repeat(64), VALID_CHALLENGE));
  });

  it("rejects an invalid bootstrap token without setting a session cookie", async () => {
    const response = await sendRequest(
      fixture,
      `/desktop/bootstrap?token=${"f".repeat(64)}&next=${encodeURIComponent("/setup")}`,
    );

    expect(response.status).toBe(403);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toBe("Desktop session rejected");
  });

  it("sets a hardened cookie and redirects to a token-free safe URL", async () => {
    const next = "/settings/integrations?desktop=1&firstRun=1";
    const response = await sendRequest(
      fixture,
      `/desktop/bootstrap?token=${DESKTOP_TOKEN}&next=${encodeURIComponent(next)}`,
    );
    const raw = response.headers["set-cookie"];
    const setCookie = Array.isArray(raw) ? raw[0] : raw;

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe(next);
    expect(response.headers.location).not.toContain(DESKTOP_TOKEN);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(setCookie).toMatch(/^maf_desktop_session=[^;]+;/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
    expect(response.body).not.toContain(DESKTOP_TOKEN);
  });

  it.each(["/api/read", "/static/app.js"])(
    "rejects an unauthenticated request to %s",
    async path => {
      const response = await sendRequest(fixture, path);

      expect(response.status).toBe(401);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toBe("Open MAF V3 from the desktop application.");
    },
  );

  it("rejects an authenticated cross-origin read", async () => {
    const response = await sendRequest(fixture, "/api/read", {
      headers: {
        Cookie: cookie,
        Origin: "http://127.0.0.1:65535",
        "Sec-Fetch-Site": "same-site",
      },
    });

    expect(response.status).toBe(403);
    expect(response.body).toBe("Cross-origin desktop request rejected");
  });

  it("rejects an authenticated mutation without the exact Origin", async () => {
    const response = await sendRequest(fixture, "/api/write", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: "blocked" }),
    });

    expect(response.status).toBe(403);
    expect(response.body).toBe("Desktop request origin is required");
  });

  it("allows an authenticated mutation from the exact desktop origin", async () => {
    const response = await sendRequest(fixture, "/api/write", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: fixture.origin,
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: "accepted" }),
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ saved: "accepted" });
  });
});
