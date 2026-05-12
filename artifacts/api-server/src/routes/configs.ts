import { Router, type IRouter } from "express";
import { GetConfigsQueryParams, GetConfigsResponse } from "../api-zod";
import { db, configsTable, nodesTable, usersTable, configQuestionsTable, withRequestDbContext } from "../db";
import { eq, and, ne, or, sql, type SQL } from "drizzle-orm";
import { requireAdmin } from "../middleware/adminAuth";
import { getJwtRequestAuth } from "../lib/requestAuth";

const router: IRouter = Router();

function normalizeToken(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function parseYearNumber(value: string | null | undefined): number | null {
  const token = normalizeToken(value);
  const yearMatch = token.match(/year[^0-9]*([1-4])/);
  if (yearMatch) return Number(yearMatch[1]);
  const plainMatch = token.match(/^([1-4])$/);
  if (plainMatch) return Number(plainMatch[1]);
  return null;
}

function parseSemesterNumber(value: string | null | undefined): number | null {
  const token = normalizeToken(value);
  const semMatch = token.match(/sem(?:ester)?[^0-9]*([1-8])/);
  if (semMatch) return Number(semMatch[1]);
  const sMatch = token.match(/^s([1-8])$/);
  if (sMatch) return Number(sMatch[1]);
  const plainMatch = token.match(/^([1-8])$/);
  if (plainMatch) return Number(plainMatch[1]);
  return null;
}

function getAllowedConfigYearTokensForStudentYear(userYear: string | null | undefined): string[] {
  const normalized = normalizeToken(userYear);
  if (!normalized) return [];

  const tokens = new Set<string>();
  tokens.add(normalized);

  const yearNum = parseYearNumber(userYear);
  if (yearNum) {
    const sem1 = yearNum * 2 - 1;
    const sem2 = yearNum * 2;
    tokens.add(String(yearNum));
    tokens.add(`year${yearNum}`);
    tokens.add(`sem${sem1}`);
    tokens.add(`sem${sem2}`);
    tokens.add(`semester${sem1}`);
    tokens.add(`semester${sem2}`);
  }

  const semNum = parseSemesterNumber(userYear);
  if (semNum) {
    const mappedYear = Math.ceil(semNum / 2);
    tokens.add(`sem${semNum}`);
    tokens.add(`semester${semNum}`);
    tokens.add(String(mappedYear));
    tokens.add(`year${mappedYear}`);
  }

  return Array.from(tokens);
}

function doesStudentYearMatchConfigYear(
  userYear: string | null | undefined,
  configYear: string | null | undefined,
): boolean {
  const configToken = normalizeToken(configYear);
  if (!configToken) return false;
  const allowed = getAllowedConfigYearTokensForStudentYear(userYear);
  if (allowed.length === 0) return false;
  return allowed.includes(configToken);
}

function toIsoStringOrUndefined(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}

router.get("/configs", async (req, res) => {
  try {
    const { universityId, status } = GetConfigsQueryParams.parse(req.query);

    const auth = getJwtRequestAuth(req);
    const userId = auth?.userId || "";
    if (!userId) {
      res.status(401).json({ error: "Authentication required. Provide a valid bearer token." });
      return;
    }

    let isAdmin = false;
    let isSuperStudent = false;
    let userUniversityId: string | null = null;
    let userYear: string | null = null;
    let userBranch: string | null = null;
    const [user] = await db
      .select({
        id: usersTable.id,
        role: usersTable.role,
        universityId: usersTable.universityId,
        batch: usersTable.batch,
        year: usersTable.year,
        branch: usersTable.branch,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user) {
      res.status(401).json({ error: "Invalid user." });
      return;
    }
    isAdmin = user?.role === "admin";
    isSuperStudent = (user?.role || "").toLowerCase() === "super_student";
    userUniversityId = user?.universityId ?? null;
    userYear = user?.year ?? null;
    userBranch = user?.branch ?? null;

    const conditions: SQL[] = [];
    if (!isAdmin && userUniversityId) {
      conditions.push(eq(configsTable.universityId, userUniversityId));
      if (!isSuperStudent) {
        const userBatch = String((user as any)?.batch || "").trim() || "2025";
        conditions.push(eq(configsTable.batch, userBatch));
        const allowedYearTokens = getAllowedConfigYearTokensForStudentYear(userYear);
        if (allowedYearTokens.length > 0) {
          const normalizedConfigYear = sql<string>`regexp_replace(lower(${configsTable.year}), '\\s+', '', 'g')`;
          conditions.push(
            or(
              ...allowedYearTokens.map((token) => sql`${normalizedConfigYear} = ${token}`),
            ) as SQL,
          );
        }
        const normalizedUserBranch = normalizeToken(userBranch);
        if (normalizedUserBranch) {
          const normalizedConfigBranch = sql<string>`regexp_replace(lower(${configsTable.branch}), '\\s+', '', 'g')`;
          conditions.push(sql`${normalizedConfigBranch} = ${normalizedUserBranch}`);
        }
      }
    } else if (universityId) {
      conditions.push(eq(configsTable.universityId, universityId));
    }
    if (isAdmin && status) {
      conditions.push(eq(configsTable.status, status));
    } else if (!isAdmin) {
      conditions.push(eq(configsTable.status, "live"));
    } else {
      conditions.push(ne(configsTable.status, "deleted"));
    }

    const configs = await withRequestDbContext(auth.claims, async (tx) =>
      tx
        .select()
        .from(configsTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
    );

    const response = GetConfigsResponse.parse(
      configs.map((c) => ({
        id: c.id,
        universityId: c.universityId,
        batch: String(c.batch || "").trim() || "2025",
        year: c.year,
        branch: c.branch,
        subject: c.subject,
        exam: c.exam,
        status: c.status,
        createdBy: c.createdBy,
        createdAt: toIsoStringOrUndefined((c as any).createdAt),
        syllabusFileUrl: c.syllabusFileUrl ?? null,
        paperFileUrls: c.paperFileUrls ?? null,
      }))
    );

    res.json(response);
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch configs");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/configs/version", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "private, max-age=5");
    const universityId = String(req.query.universityId || "").trim();
    const auth = getJwtRequestAuth(req);
    const userId = auth?.userId || "";
    if (!userId) {
      res.status(401).json({ error: "Authentication required. Provide a valid bearer token." });
      return;
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        role: usersTable.role,
        universityId: usersTable.universityId,
        batch: usersTable.batch,
        year: usersTable.year,
        branch: usersTable.branch,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user) {
      res.status(401).json({ error: "Invalid user." });
      return;
    }

    const isAdmin = user?.role === "admin";
    const isSuperStudent = (user?.role || "").toLowerCase() === "super_student";
    const conditions: SQL[] = [];

    if (!isAdmin) {
      conditions.push(eq(configsTable.universityId, user.universityId));
      if (!isSuperStudent) {
        const userBatch = String((user as any)?.batch || "").trim() || "2025";
        conditions.push(eq(configsTable.batch, userBatch));
        const allowedYearTokens = getAllowedConfigYearTokensForStudentYear(user?.year ?? null);
        if (allowedYearTokens.length > 0) {
          const normalizedConfigYear = sql<string>`regexp_replace(lower(${configsTable.year}), '\\s+', '', 'g')`;
          conditions.push(or(...allowedYearTokens.map((token) => sql`${normalizedConfigYear} = ${token}`)) as SQL);
        }
        const normalizedUserBranch = normalizeToken(user?.branch ?? null);
        if (normalizedUserBranch) {
          const normalizedConfigBranch = sql<string>`regexp_replace(lower(${configsTable.branch}), '\\s+', '', 'g')`;
          conditions.push(sql`${normalizedConfigBranch} = ${normalizedUserBranch}`);
        }
      }
      conditions.push(eq(configsTable.status, "live"));
    } else {
      if (universityId) conditions.push(eq(configsTable.universityId, universityId));
      conditions.push(ne(configsTable.status, "deleted"));
    }

    const rows = await withRequestDbContext(auth.claims, async (tx) =>
      tx
        .select({
          maxUpdatedAt: sql<string | null>`max(${configsTable.updatedAt})`,
          total: sql<number>`count(*)`,
        })
        .from(configsTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
    );

    const row = rows[0];
    res.json({
      maxUpdatedAt: row?.maxUpdatedAt ?? null,
      total: Number(row?.total ?? 0),
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch configs version");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/configs/:id/version", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "private, max-age=5");
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "Config id is required" });
      return;
    }

    const auth = getJwtRequestAuth(req);
    const userId = auth?.userId || "";
    if (!userId) {
      res.status(401).json({ error: "Authentication required. Provide a valid bearer token." });
      return;
    }

    const [config] = await withRequestDbContext(auth.claims, async (tx) =>
      tx
        .select({
          id: configsTable.id,
          universityId: configsTable.universityId,
          batch: configsTable.batch,
          year: configsTable.year,
          branch: configsTable.branch,
          status: configsTable.status,
          updatedAt: configsTable.updatedAt,
        })
        .from(configsTable)
        .where(eq(configsTable.id, id))
        .limit(1)
    );
    if (!config) {
      res.status(404).json({ error: "Config not found" });
      return;
    }

    const [user] = await withRequestDbContext(auth.claims, async (tx) =>
      tx
        .select({
          id: usersTable.id,
          role: usersTable.role,
          universityId: usersTable.universityId,
          batch: usersTable.batch,
          year: usersTable.year,
          branch: usersTable.branch,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1)
    );
    if (!user) {
      res.status(401).json({ error: "Invalid user." });
      return;
    }

    if (user.role !== "admin") {
      if (config.status !== "live") {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      if (user.universityId !== config.universityId) {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      const isSuperStudent = (user.role || "").toLowerCase() === "super_student";
      if (!isSuperStudent) {
        if ((String((user as any).batch || "").trim() || "2025") !== (String((config as any).batch || "").trim() || "2025")) {
          res.status(403).json({ error: "Access denied." });
          return;
        }
      }
      const branchMismatch = normalizeToken(user.branch) !== normalizeToken(config.branch);
      if (!isSuperStudent && (!doesStudentYearMatchConfigYear(user.year, config.year) || branchMismatch)) {
        res.status(403).json({ error: "Access denied." });
        return;
      }
    }

    const [nodesAgg, questionsAgg] = await withRequestDbContext(auth.claims, async (tx) =>
      Promise.all([
        tx
          .select({
            nodesUpdatedAt: sql<string | null>`max(${nodesTable.updatedAt})`,
          })
          .from(nodesTable)
          .where(eq(nodesTable.configId, id))
          .limit(1),
        tx
          .select({
            questionBankUpdatedAt: sql<string | null>`max(${configQuestionsTable.updatedAt})`,
          })
          .from(configQuestionsTable)
          .where(eq(configQuestionsTable.configId, id))
          .limit(1),
      ])
    );

    res.json({
      configId: id,
      configUpdatedAt: config.updatedAt?.toISOString?.() ?? null,
      nodesUpdatedAt: nodesAgg?.[0]?.nodesUpdatedAt ?? null,
      questionBankUpdatedAt: questionsAgg?.[0]?.questionBankUpdatedAt ?? null,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch config version");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/configs/:id/question-bank", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "Config id is required" });
      return;
    }

    const auth = getJwtRequestAuth(req);
    const userId = auth?.userId || "";
    if (!userId) {
      res.status(401).json({ error: "Authentication required. Provide a valid bearer token." });
      return;
    }

    const [config] = await withRequestDbContext(auth.claims, async (tx) =>
      tx
      .select({
          id: configsTable.id,
          subject: configsTable.subject,
          universityId: configsTable.universityId,
          batch: configsTable.batch,
          year: configsTable.year,
          branch: configsTable.branch,
          status: configsTable.status,
        })
        .from(configsTable)
        .where(eq(configsTable.id, id))
        .limit(1)
    );

    if (!config) {
      res.status(404).json({ error: "Config not found" });
      return;
    }

    const [user] = await withRequestDbContext(auth.claims, async (tx) =>
      tx
      .select({
        id: usersTable.id,
        role: usersTable.role,
        universityId: usersTable.universityId,
        batch: usersTable.batch,
        year: usersTable.year,
        branch: usersTable.branch,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1)
    );

    if (!user) {
      res.status(401).json({ error: "Invalid user." });
      return;
    }

    if (user.role !== "admin") {
      if (config.status !== "live") {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      if (user.universityId !== config.universityId) {
        res.status(403).json({ error: "Access denied." });
        return;
      }
      const isSuperStudent = (user.role || "").toLowerCase() === "super_student";
      if (!isSuperStudent) {
        if ((String((user as any).batch || "").trim() || "2025") !== (String((config as any).batch || "").trim() || "2025")) {
          res.status(403).json({ error: "Access denied." });
          return;
        }
      }
      const branchMismatch = normalizeToken(user.branch) !== normalizeToken(config.branch);
      if (
        !isSuperStudent &&
        (!doesStudentYearMatchConfigYear(user.year, config.year) || branchMismatch)
      ) {
        res.status(403).json({ error: "Access denied." });
        return;
      }
    }

    const payload = await (async () => {
          const configNodes = (await withRequestDbContext(auth.claims, async (tx) =>
            tx
              .select({
                id: nodesTable.id,
                title: nodesTable.title,
                type: nodesTable.type,
                parentId: nodesTable.parentId,
                unitSubtopicId: nodesTable.unitSubtopicId,
              })
              .from(nodesTable)
              .where(eq(nodesTable.configId, id))
          )) as Array<{
            id: string;
            title: string;
            type: string;
            parentId: string | null;
            unitSubtopicId: string | null;
          }>;
          const nodeById = new Map(configNodes.map((n) => [n.id, n]));
          const subtopicNodeByCanonicalId = new Map<string, string[]>();
          for (const n of configNodes) {
            if (n.type !== "subtopic" || !n.unitSubtopicId) continue;
            const list = subtopicNodeByCanonicalId.get(n.unitSubtopicId) ?? [];
            list.push(n.id);
            subtopicNodeByCanonicalId.set(n.unitSubtopicId, list);
          }
          const canonicalQuestions = (await withRequestDbContext(auth.claims, async (tx) =>
            tx
              .select({
                id: configQuestionsTable.id,
                markType: configQuestionsTable.markType,
                question: configQuestionsTable.question,
                answer: configQuestionsTable.answer,
                isStarred: configQuestionsTable.isStarred,
                starSource: configQuestionsTable.starSource,
                unitSubtopicId: configQuestionsTable.unitSubtopicId,
              })
              .from(configQuestionsTable)
              .where(eq(configQuestionsTable.configId, id))
          )) as Array<{
            id: number;
            markType: string;
            question: string;
            answer: string;
            isStarred: boolean | null;
            starSource: string | null;
            unitSubtopicId: string | null;
          }>;
          const questions = canonicalQuestions.map((q) => {
            const mapped = q.unitSubtopicId ? (subtopicNodeByCanonicalId.get(q.unitSubtopicId) ?? []) : [];
            return {
              id: q.id,
              nodeId: mapped[0] ?? "",
              markType: q.markType,
              question: q.question,
              answer: q.answer,
              isStarred: q.isStarred,
              starSource: q.starSource,
            };
          });
          const filtered = questions.map((q) => {
            const subtopic = nodeById.get(q.nodeId);
            const topic = subtopic?.parentId ? nodeById.get(subtopic.parentId) : undefined;
            const unit = topic?.parentId ? nodeById.get(topic.parentId) : undefined;
            return {
              id: q.id,
              markType: q.markType === "2" ? "Foundational" : q.markType === "5" ? "Applied" : q.markType,
              question: q.question,
              answer: q.answer,
              isStarred: q.isStarred ?? false,
              starSource: q.starSource ?? "none",
              subtopicId: q.nodeId || "",
              subtopicTitle: subtopic?.title ?? "",
              topicTitle: topic?.title ?? "",
              unitTitle: unit?.title ?? "",
            };
          });
          return {
            configId: id,
            subject: config.subject,
            total: filtered.length,
            questions: filtered.sort((a, b) => {
              const starCmp = Number(b.isStarred) - Number(a.isStarred);
              if (starCmp !== 0) return starCmp;
              const markRank = (v: string) => (v === "Foundational" ? 0 : v === "Applied" ? 1 : 2);
              const markCmp = markRank(a.markType) - markRank(b.markType);
              if (markCmp !== 0) return markCmp;
              return a.id - b.id;
            }),
          };
      })();

    res.json(payload);
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch config question bank");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/configs/:configId/question-bank/questions/:questionId/star", requireAdmin, async (req, res) => {
  try {
    const configId = String(req.params.configId || "").trim();
    const questionId = Number(req.params.questionId);
    const isStarred = Boolean(req.body?.isStarred);
    const authClaims = ((req as any).authClaims ?? null) as import("../lib/jwt").AccessTokenPayload | null;

    if (!configId || !Number.isFinite(questionId)) {
      res.status(400).json({ error: "Invalid configId or questionId" });
      return;
    }

    const [question] = await withRequestDbContext(authClaims, async (tx) =>
      tx
        .select({
          id: configQuestionsTable.id,
          configId: configQuestionsTable.configId,
        })
        .from(configQuestionsTable)
        .where(eq(configQuestionsTable.id, questionId))
        .limit(1)
    );

    if (!question) {
      res.status(404).json({ error: "Question not found" });
      return;
    }

    if (question.configId !== configId) {
      res.status(400).json({ error: "Question does not belong to this config" });
      return;
    }

    await withRequestDbContext(authClaims, async (tx) =>
      tx
        .update(configQuestionsTable)
        .set({
          isStarred,
          starSource: isStarred ? "manual" : "none",
          updatedAt: new Date(),
        })
        .where(eq(configQuestionsTable.id, questionId))
    );
    res.json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, "Failed to update question star");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/configs/:configId/question-bank/questions/:questionId", requireAdmin, async (req, res) => {
  try {
    const configId = String(req.params.configId || "").trim();
    const questionId = Number(req.params.questionId);
    const question = String(req.body?.question || "").trim();
    const answer = String(req.body?.answer || "").trim();
    const authClaims = ((req as any).authClaims ?? null) as import("../lib/jwt").AccessTokenPayload | null;

    if (!configId || !Number.isFinite(questionId)) {
      res.status(400).json({ error: "Invalid configId or questionId" });
      return;
    }
    if (!question || !answer) {
      res.status(400).json({ error: "Question and answer are required" });
      return;
    }

    const [existing] = await withRequestDbContext(authClaims, async (tx) =>
      tx
        .select({
          id: configQuestionsTable.id,
          configId: configQuestionsTable.configId,
        })
        .from(configQuestionsTable)
        .where(eq(configQuestionsTable.id, questionId))
        .limit(1)
    );

    if (!existing) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    if (existing.configId !== configId) {
      res.status(400).json({ error: "Question does not belong to this config" });
      return;
    }

    await withRequestDbContext(authClaims, async (tx) =>
      tx
        .update(configQuestionsTable)
        .set({
          question,
          answer,
          updatedAt: new Date(),
        })
        .where(eq(configQuestionsTable.id, questionId))
    );
    res.json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, "Failed to update question text");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

