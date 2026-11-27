import type { Express } from "express";
import { resolveStoragePath } from "../storage";

export function registerStorageProxy(app: Express) {
  app.get("/media/*key", (req, res) => {
    const keyParam = req.params.key;
    const rawKey = Array.isArray(keyParam) ? keyParam.join("/") : keyParam;
    if (!rawKey) {
      res.status(400).send("Missing media key");
      return;
    }

    try {
      const { absolutePath } = resolveStoragePath(rawKey);
      res.set("Cache-Control", "private, max-age=31536000, immutable");
      res.set("X-Content-Type-Options", "nosniff");
      res.sendFile(absolutePath, error => {
        if (!error || res.headersSent) return;
        const statusCode = (error as Error & { statusCode?: number }).statusCode;
        res.status(statusCode === 404 ? 404 : 500).send("Media file unavailable");
      });
    } catch {
      res.status(400).send("Invalid media key");
    }
  });
}
