import crypto from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";

const DESKTOP_COOKIE = "maf_desktop_session";
const TOKEN_PATTERN = /^[a-f\d]{64}$/i;
const CHALLENGE_PATTERN = /^[a-f\d]{64}$/i;

function secureEqual(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const left = Buffer.from(candidate, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 1) continue;
    if (entry.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function safeDesktopNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/setup?desktop=1";
  }
  if (value.includes("\\") || /[\r\n\0]/.test(value)) {
    return "/setup?desktop=1";
  }

  try {
    const base = new URL("http://maf-desktop.invalid");
    const parsed = new URL(value, base);
    return parsed.origin === base.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/setup?desktop=1";
  } catch {
    return "/setup?desktop=1";
  }
}

export function desktopHealthProof(token: string, challenge: string): string | null {
  if (!TOKEN_PATTERN.test(token) || !CHALLENGE_PATTERN.test(challenge)) return null;
  return crypto.createHmac("sha256", token).update(challenge).digest("hex");
}

/**
 * Protects the account-free desktop API from other local web pages and
 * processes. The launcher sends its random token once, receives an HttpOnly
 * session cookie, and immediately redirects to a token-free URL.
 */
export function registerDesktopAuth(app: Express): void {
  const desktopMode = process.env.MAF_DESKTOP === "1";
  if (!desktopMode) return;

  const expectedToken = process.env.MAF_DESKTOP_TOKEN?.trim() || "";
  if (!TOKEN_PATTERN.test(expectedToken)) {
    throw new Error("MAF_DESKTOP_TOKEN must be a fresh 32-byte hexadecimal token.");
  }
  const port = process.env.PORT?.trim();
  const host = process.env.HOST?.trim() || "127.0.0.1";
  if (!port || !/^\d{1,5}$/.test(port)) {
    throw new Error("Desktop mode requires an explicit loopback PORT.");
  }
  const expectedHost = `${host}:${port}`;
  const expectedOrigin = `http://${expectedHost}`;

  app.use((req, res, next) => {
    if (req.get("host") !== expectedHost) {
      res.set("Cache-Control", "no-store").status(421).type("text/plain").send("Unexpected desktop host");
      return;
    }
    next();
  });

  app.get("/desktop/health", (_req, res) => {
    const challenge = _req.get("x-maf-desktop-challenge")?.trim() || "";
    if (!CHALLENGE_PATTERN.test(challenge)) {
      res.set("Cache-Control", "no-store").status(403).type("text/plain").send("Desktop health rejected");
      return;
    }
    const proof = desktopHealthProof(expectedToken, challenge);
    if (!proof) {
      res.set("Cache-Control", "no-store").status(403).type("text/plain").send("Desktop health rejected");
      return;
    }
    res.set("Cache-Control", "no-store").status(200).type("text/plain").send(proof);
  });

  app.get("/desktop/bootstrap", (req, res) => {
    const presented = typeof req.query.token === "string" ? req.query.token : undefined;
    if (!secureEqual(presented, expectedToken)) {
      res.set("Cache-Control", "no-store").status(403).type("text/plain").send("Desktop session rejected");
      return;
    }

    res.cookie(DESKTOP_COOKIE, expectedToken, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    res.set("Cache-Control", "no-store").redirect(303, safeDesktopNext(req.query.next));
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!secureEqual(readCookie(req, DESKTOP_COOKIE), expectedToken)) {
      res.set("Cache-Control", "no-store").status(401).type("text/plain").send("Open MAF V3 from the desktop application.");
      return;
    }

    // SameSite does not distinguish loopback ports. Sec-Fetch-Site and Origin
    // checks prevent another local web app from submitting authenticated
    // requests through the desktop WebView's cookie.
    const fetchSite = req.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      res.set("Cache-Control", "no-store").status(403).type("text/plain").send("Cross-origin desktop request rejected");
      return;
    }

    const origin = req.get("origin");
    if (origin && origin !== expectedOrigin) {
      res.set("Cache-Control", "no-store").status(403).type("text/plain").send("Cross-origin desktop request rejected");
      return;
    }

    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && origin !== expectedOrigin) {
      res.set("Cache-Control", "no-store").status(403).type("text/plain").send("Desktop request origin is required");
      return;
    }

    next();
  });
}
