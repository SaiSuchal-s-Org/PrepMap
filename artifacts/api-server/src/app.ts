import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const bodyLimit = process.env["API_BODY_LIMIT"] || "25mb";

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

type RateRule = {
  name: string;
  method: "GET" | "POST";
  testPath: (path: string) => boolean;
  maxRequests: number;
  windowMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const MINUTE_MS = 60 * 1000;
const rateRules: RateRule[] = [
  {
    name: "config-version",
    method: "GET",
    testPath: (path) => /^\/configs\/[^/]+\/version$/.test(path),
    maxRequests: 20,
    windowMs: MINUTE_MS,
  },
  {
    name: "config-completion-state",
    method: "GET",
    testPath: (path) => /^\/configs\/[^/]+\/completion-state$/.test(path),
    maxRequests: 12,
    windowMs: MINUTE_MS,
  },
  {
    name: "config-latest-interaction-state",
    method: "GET",
    testPath: (path) => /^\/configs\/[^/]+\/latest-interaction-state$/.test(path),
    maxRequests: 12,
    windowMs: MINUTE_MS,
  },
  {
    name: "events",
    method: "POST",
    testPath: (path) => path === "/events",
    maxRequests: 30,
    windowMs: MINUTE_MS,
  },
];

const rateBuckets = new Map<string, Bucket>();

function getClientIp(req: Request): string {
  const xff = String(req.headers["x-forwarded-for"] || "").trim();
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = String(req.headers["x-real-ip"] || "").trim();
  if (xri) return xri;
  return String(req.ip || req.socket.remoteAddress || "unknown");
}

function maybeCleanupBuckets(now: number) {
  // Lightweight cleanup to prevent map growth in long-lived processes.
  if (rateBuckets.size < 2000) return;
  for (const [key, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}

app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  const method = req.method.toUpperCase() as "GET" | "POST";
  const path = req.path;
  const rule = rateRules.find((r) => r.method === method && r.testPath(path));
  if (!rule) return next();

  const now = Date.now();
  maybeCleanupBuckets(now);
  const ip = getClientIp(req);
  const key = `${rule.name}:${ip}`;
  const current = rateBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return next();
  }

  if (current.count >= rule.maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    req.log.warn(
      {
        rule: rule.name,
        ip,
        path,
        method,
        maxRequests: rule.maxRequests,
        windowMs: rule.windowMs,
        retryAfterSec,
      },
      "Rate limit exceeded",
    );
    return res.status(429).json({
      error: "rate_limited",
      message: "Too many requests. Please try again shortly.",
    });
  }

  current.count += 1;
  return next();
});

app.use("/api", router);

app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      error: `Payload too large. Reduce JSON size or increase API_BODY_LIMIT (current: ${bodyLimit}).`,
    });
  }
  return next(err);
});

export default app;
