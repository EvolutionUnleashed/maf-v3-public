import "dotenv/config";
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { closeDatabase, initializeDatabase } from "../db";
import { createContext } from "./context";
import { registerDesktopAuth } from "./desktopAuth";
import { registerStorageProxy } from "./storageProxy";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen({ port, host, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort: number, host: string): Promise<number> {
  for (let port = startPort; port < Math.min(startPort + 20, 65_536); port++) {
    if (await isPortAvailable(port, host)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

function parsePort(value: string | undefined): number {
  const port = Number(value || "3000");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function registerSecurityHeaders(app: Express): void {
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({
      "Content-Security-Policy": [
        "default-src 'self'",
        "base-uri 'self'",
        "connect-src 'self'",
        "font-src 'self' data:",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "img-src 'self' data: blob:",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
      ].join("; "),
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    next();
  });
}

export type StartedServer = {
  app: Express;
  server: Server;
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
};

/**
 * Starts the HTTP application and returns a lifecycle handle. Desktop callers
 * use strict-port mode so the native shell always knows the exact origin.
 */
export async function startServer(): Promise<StartedServer> {
  const host = process.env.HOST?.trim() || "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host) && process.env.MAF_ALLOW_UNAUTHENTICATED_REMOTE !== "true") {
    throw new Error(
      "Refusing a non-loopback HOST because this edition has no login. Use a protected reverse proxy, then set MAF_ALLOW_UNAUTHENTICATED_REMOTE=true to acknowledge the risk.",
    );
  }

  const preferredPort = parsePort(process.env.PORT);
  const strictPort = process.env.MAF_STRICT_PORT === "1";
  const port = strictPort ? preferredPort : await findAvailablePort(preferredPort, host);

  await initializeDatabase();

  const app = express();
  const server = createServer(app);

  registerSecurityHeaders(app);
  registerDesktopAuth(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    const { serveStatic } = await import("./static");
    serveStatic(app);
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  const url = `http://${host}:${port}`;
  console.log(`Server running on ${url}/`);

  return {
    app,
    server,
    host,
    port,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => {
          closeDatabase();
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && pathToFileURL(path.resolve(entry)).href === import.meta.url);
}

if (isMainModule()) {
  startServer().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
