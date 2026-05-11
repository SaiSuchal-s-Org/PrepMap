import { Router, type IRouter } from "express";
import { configsTable, eventsTable, usersTable, withRequestDbContext } from "../db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { getJwtRequestAuth } from "../lib/requestAuth";

const router: IRouter = Router();
const TOPIC_INTERACTION_PREFIX = "__topic__:";
const QUESTION_BANK_EVENT_PREFIX = "__qb__:";
const EVENTS_MAX_DB_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyErr = error as { code?: string; message?: string };
  const code = String(anyErr.code || "").trim();
  // Common transient connection/pool/network errors around cold starts.
  if (["57P01", "57P02", "57P03", "53300", "08000", "08003", "08006", "ECONNRESET", "ETIMEDOUT"].includes(code)) {
    return true;
  }
  const message = String(anyErr.message || "").toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("connection terminated") ||
    message.includes("connection reset") ||
    message.includes("too many clients")
  );
}

const TrackEventBody = z
  .object({
    // Legacy fields are accepted for backwards compatibility; identity comes from JWT.
    userId: z.string().trim().optional().nullable(),
    universityId: z.string().trim().optional().nullable(),
    year: z.string().trim().optional().nullable(),
    branch: z.string().trim().optional().nullable(),
    exam: z.string().trim().optional().nullable(),
    configId: z.string().trim().min(1),
    topicId: z.string().trim().optional().nullable(),
    subtopicId: z.string().trim().optional().nullable(),
    questionId: z.string().trim().optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const questionId = String(value.questionId || "").trim();
    const topicId = String(value.topicId || "").trim();
    const subtopicId = String(value.subtopicId || "").trim();

    if (questionId) {
      return;
    }

    if (!topicId || !subtopicId) {
      ctx.addIssue({
        code: "custom",
        message: "topicId and subtopicId are required when questionId is not provided.",
      });
    }
  });

router.get("/configs/:configId/latest-interaction-state", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "private, max-age=5");
    const auth = getJwtRequestAuth(req);
    const authUserId = auth?.userId || "";
    if (!authUserId) {
      res.status(401).json({ error: "Authentication required. Provide a valid bearer token." });
      return;
    }

    const configId = String(req.params.configId || "").trim();
    if (!configId) {
      res.status(400).json({ error: "configId is required." });
      return;
    }

    const latestEvents = await withRequestDbContext(auth.claims, async (tx) =>
      tx
        .select({
          topicId: eventsTable.topicId,
          subtopicId: eventsTable.subtopicId,
          questionId: eventsTable.questionId,
          timestamp: eventsTable.timestamp,
        })
        .from(eventsTable)
        .where(and(eq(eventsTable.userId, authUserId), eq(eventsTable.configId, configId)))
        .orderBy(desc(eventsTable.timestamp))
        .limit(25)
    );

    const row = latestEvents[0];
    const latest = latestEvents.find((e) => (
      !!String(e.questionId || "").trim() || !!String(e.subtopicId || "").trim()
    )) || null;
    const rawSubtopicId = String(latest?.subtopicId || "").trim();
    const rawQuestionId = String(latest?.questionId || "").trim();
    const isTopicInteraction = rawSubtopicId.startsWith(TOPIC_INTERACTION_PREFIX);
    const derivedTopicFromPrefix = isTopicInteraction
      ? rawSubtopicId.slice(TOPIC_INTERACTION_PREFIX.length).trim()
      : "";
    const mapNodeId = isTopicInteraction
      ? (derivedTopicFromPrefix || String(latest?.topicId || "").trim() || null)
      : null;
    const qbSubtopicId = isTopicInteraction ? null : (rawSubtopicId || null);
    const qbQuestionIdFromTopic = String(latest?.topicId || "").trim().startsWith(QUESTION_BANK_EVENT_PREFIX)
      ? Number(String(latest?.topicId || "").trim().slice(QUESTION_BANK_EVENT_PREFIX.length))
      : null;
    const qbQuestionId = rawQuestionId ? Number(rawQuestionId) : qbQuestionIdFromTopic;

    res.status(200).json({
      configId,
      userId: authUserId,
      mapNodeId,
      qbSubtopicId,
      qbQuestionId: Number.isFinite(qbQuestionId) ? qbQuestionId : null,
      eventAt: latest?.timestamp ? new Date(latest.timestamp).toISOString() : null,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch latest interaction state");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/configs/:configId/completion-state", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "private, max-age=5");
    const auth = getJwtRequestAuth(req);
    const authUserId = auth?.userId || "";
    if (!authUserId) {
      res.status(401).json({ error: "Authentication required. Provide a valid bearer token." });
      return;
    }

    const configId = String(req.params.configId || "").trim();
    if (!configId) {
      res.status(400).json({ error: "configId is required." });
      return;
    }

    const rows = await withRequestDbContext(auth.claims, async (tx) =>
      tx
        .select({
          subtopicId: eventsTable.subtopicId,
          topicId: eventsTable.topicId,
        })
        .from(eventsTable)
        .where(and(eq(eventsTable.userId, authUserId), eq(eventsTable.configId, configId)))
    );

    const doneSubtopicIds = Array.from(
      new Set(
        rows
          .map((r) => ({
            subtopicId: String(r.subtopicId || "").trim(),
            topicId: String(r.topicId || "").trim(),
          }))
          .filter((r) => {
            const id = r.subtopicId;
            const topicId = r.topicId;
            if (!id) return false;
            if (id.startsWith(TOPIC_INTERACTION_PREFIX)) return false;
            if (topicId.startsWith(QUESTION_BANK_EVENT_PREFIX)) return false;
            return true;
          })
          .map((r) => r.subtopicId),
      ),
    );

    res.status(200).json({
      configId,
      userId: authUserId,
      doneSubtopicIds,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch completion state");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/events", async (req, res) => {
  try {
    const auth = getJwtRequestAuth(req);
    const authUserId = auth?.userId || "";
    if (!authUserId) {
      // Emergency stabilization: avoid repeated 401 retry loops from clients/bots.
      res.status(200).json({ success: true, skipped: true, reason: "unauthenticated" });
      return;
    }

    const body = TrackEventBody.parse(req.body);
    const topicId = String(body.topicId || "").trim();
    const subtopicId = String(body.subtopicId || "").trim();
    const questionId = String(body.questionId || "").trim();

    const isQuestionEvent = !!questionId;
    const persistedTopicId = isQuestionEvent ? (topicId || `${QUESTION_BANK_EVENT_PREFIX}${questionId}`) : topicId;
    const persistedSubtopicId = isQuestionEvent ? (subtopicId || "") : subtopicId;

    let result:
      | { status: "invalid_user" }
      | { status: "skipped" }
      | { status: "invalid_event_payload" }
      | { status: "inserted" };

    for (let attempt = 0; attempt <= EVENTS_MAX_DB_RETRIES; attempt += 1) {
      try {
        result = await withRequestDbContext(auth.claims, async (tx) => {
          const [authUser] = await tx
            .select({
              id: usersTable.id,
              universityId: usersTable.universityId,
              batch: usersTable.batch,
              year: usersTable.year,
              branch: usersTable.branch,
              role: usersTable.role,
            })
            .from(usersTable)
            .where(eq(usersTable.id, authUserId))
            .limit(1);

          if (!authUser) {
            return { status: "invalid_user" as const };
          }

          // Admins can preview student flow, but must not pollute progress analytics.
          if (authUser.role === "admin") {
            return { status: "skipped" as const };
          }

          let resolvedExam = String(body.exam || "").trim();
          if (!resolvedExam) {
            const [config] = await tx
              .select({ exam: configsTable.exam })
              .from(configsTable)
              .where(eq(configsTable.id, body.configId))
              .limit(1);
            resolvedExam = String(config?.exam || "").trim();
          }
          if (!resolvedExam) {
            return { status: "invalid_event_payload" as const };
          }

          await tx.insert(eventsTable).values({
            userId: authUser.id,
            universityId: authUser.universityId,
            batch: String(authUser.batch || "").trim() || "2025",
            year: authUser.year,
            branch: authUser.branch,
            exam: resolvedExam,
            configId: body.configId,
            topicId: persistedTopicId || null,
            subtopicId: persistedSubtopicId,
            questionId: questionId || null,
          });

          return { status: "inserted" as const };
        });
        break;
      } catch (err) {
        const retryable = isRetryableDbError(err);
        const canRetry = retryable && attempt < EVENTS_MAX_DB_RETRIES;
        if (!canRetry) throw err;
        const delayMs = 150 * (attempt + 1);
        req.log.warn({ err, attempt: attempt + 1, delayMs }, "Retrying /events after transient DB error");
        await sleep(delayMs);
      }
    }

    if (!result) {
      throw new Error("Event insert did not produce a result.");
    }

    if (result.status === "invalid_user") {
      res.status(200).json({ success: true, skipped: true, reason: "invalid_user" });
      return;
    }
    if (result.status === "skipped") {
      res.status(200).json({ success: true, skipped: true });
      return;
    }
    if (result.status === "invalid_event_payload") {
      res.status(400).json({ error: "Invalid event payload." });
      return;
    }

    res.status(201).json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Invalid event payload.",
        issues: error.issues.map((issue) => issue.message),
      });
      return;
    }
    req.log.error({ err: error }, "Failed to track event");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

