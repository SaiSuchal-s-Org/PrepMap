import { Router, type IRouter } from "express";
import {
  GetSubtopicContentParams,
  GetSubtopicContentResponse,
  UpdateSubtopicContentParams,
  UpdateSubtopicContentBody,
} from "../api-zod";
import {
  db,
  nodesTable,
  configsTable,
  usersTable,
  configQuestionsTable,
  canonicalNodesTable,
  withRequestDbContext,
} from "../db";
import { and, eq } from "drizzle-orm";
import { requireAdmin } from "../middleware/adminAuth";
import { getJwtRequestAuth } from "../lib/requestAuth";

const router: IRouter = Router();

function toOrder(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseTextArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v || "").trim()).filter(Boolean);
  }
  const text = String(raw ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => String(v || "").trim()).filter(Boolean);
    }
  } catch {
    // fall through
  }
  if (text.includes(",")) {
    return text.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [text];
}

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

router.get("/subtopics/:id", async (req, res) => {
  try {
    const { id } = GetSubtopicContentParams.parse(req.params);
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

    const [node, config] = await withRequestDbContext(auth.claims, async (tx) => {
      const [node] = await tx
        .select({
          id: nodesTable.id,
          configId: nodesTable.configId,
          parentId: nodesTable.parentId,
          explanation: nodesTable.explanation,
          learningGoal: nodesTable.learningGoal,
          exampleBlock: nodesTable.exampleBlock,
          supportNote: nodesTable.supportNote,
          prerequisiteTitles: nodesTable.prerequisiteTitles,
          prerequisiteNodeIds: nodesTable.prerequisiteNodeIds,
          nextRecommendedTitles: nodesTable.nextRecommendedTitles,
          nextRecommendedNodeIds: nodesTable.nextRecommendedNodeIds,
          unitSubtopicId: nodesTable.unitSubtopicId,
          canonicalNodeId: nodesTable.canonicalNodeId,
        })
        .from(nodesTable)
        .where(eq(nodesTable.id, id))
        .limit(1);

      const [config] = node
        ? await tx
            .select({
              id: configsTable.id,
              universityId: configsTable.universityId,
              year: configsTable.year,
              branch: configsTable.branch,
              status: configsTable.status,
            })
            .from(configsTable)
            .where(eq(configsTable.id, node.configId))
            .limit(1)
        : [];

      return [node ?? null, config ?? null] as const;
    });

    if (!node) {
      res.status(404).json({ error: "Subtopic not found" });
      return;
    }

    if (!config) {
      res.status(404).json({ error: "Config not found" });
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
      const yearMismatch = !doesStudentYearMatchConfigYear(user.year, config.year);
      const branchMismatch = normalizeToken(user.branch) !== normalizeToken(config.branch);
      if (!isSuperStudent && (yearMismatch || branchMismatch)) {
        res.status(403).json({ error: "Access denied." });
        return;
      }
    }

    if (!node.unitSubtopicId) {
      res.status(404).json({ error: "Subtopic content is not mapped to canonical tables." });
      return;
    }

    const { canonical, questions, allNodesForConfig } = await withRequestDbContext(auth.claims, async (tx) => {
      const [canonical] = node.canonicalNodeId
        ? await tx
            .select()
            .from(canonicalNodesTable)
            .where(eq(canonicalNodesTable.id, node.canonicalNodeId))
            .limit(1)
        : [];

      const questions = await tx
        .select({
          id: configQuestionsTable.id,
          markType: configQuestionsTable.markType,
          question: configQuestionsTable.question,
          answer: configQuestionsTable.answer,
          isStarred: configQuestionsTable.isStarred,
          starSource: configQuestionsTable.starSource,
        })
        .from(configQuestionsTable)
        .where(
          and(
            eq(configQuestionsTable.configId, node.configId),
            eq(configQuestionsTable.unitSubtopicId, node.unitSubtopicId),
          ),
        );

      const allNodesForConfig = await tx
        .select({
          id: nodesTable.id,
          title: nodesTable.title,
          parentId: nodesTable.parentId,
          sortOrder: nodesTable.sortOrder,
          canonicalNodeId: nodesTable.canonicalNodeId,
        })
        .from(nodesTable)
        .where(eq(nodesTable.configId, node.configId));

      return { canonical: canonical ?? null, questions, allNodesForConfig };
    });
    const siblings = allNodesForConfig
      .filter((n) => String(n.parentId || "") === String(node.parentId || ""))
      .sort((a, b) => {
        const byOrder = toOrder(a.sortOrder) - toOrder(b.sortOrder);
        if (byOrder !== 0) return byOrder;
        return String(a.title || "").localeCompare(String(b.title || ""));
      });
    const currentIndex = siblings.findIndex((n) => n.id === node.id);
    const prev = currentIndex > 0 ? siblings[currentIndex - 1] : null;
    const next = currentIndex >= 0 && currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

    const canonicalByScoped = new Map(allNodesForConfig.map((n) => [String(n.canonicalNodeId || ""), n.id]));
    const explicitPrereqTitles = parseTextArray(canonical?.prerequisiteTitles ?? node.prerequisiteTitles);
    const explicitPrereqNodeIds = parseTextArray(canonical?.prerequisiteNodeIds ?? node.prerequisiteNodeIds)
      .map((cid) => canonicalByScoped.get(cid) || cid);
    const explicitNextTitles = parseTextArray(canonical?.nextRecommendedTitles ?? node.nextRecommendedTitles);
    const explicitNextNodeIds = parseTextArray(canonical?.nextRecommendedNodeIds ?? node.nextRecommendedNodeIds)
      .map((cid) => canonicalByScoped.get(cid) || cid);
    const response = GetSubtopicContentResponse.parse({
      id: node.unitSubtopicId,
      nodeId: id,
      explanation: String(canonical?.explanation || node.explanation || "").trim(),
      learningGoal: String(canonical?.learningGoal || node.learningGoal || "").trim() || null,
      exampleBlock: String(canonical?.exampleBlock || node.exampleBlock || "").trim() || null,
      supportNote: String(canonical?.supportNote || node.supportNote || "").trim() || null,
      prerequisiteTitles: explicitPrereqTitles.length > 0 ? explicitPrereqTitles : prev ? [prev.title] : [],
      prerequisiteNodeIds: explicitPrereqNodeIds.length > 0 ? explicitPrereqNodeIds : prev ? [prev.id] : [],
      nextRecommendedTitles: explicitNextTitles.length > 0 ? explicitNextTitles : next ? [next.title] : [],
      nextRecommendedNodeIds: explicitNextNodeIds.length > 0 ? explicitNextNodeIds : next ? [next.id] : [],
      questions: questions.map((q) => ({
        id: q.id,
        markType: q.markType === "2" ? "Foundational" : q.markType === "5" ? "Applied" : q.markType,
        question: q.question,
        answer: q.answer,
        isStarred: q.isStarred,
        starSource: q.starSource,
      })),
    });

    res.json(response);
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch subtopic content");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/subtopics/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = UpdateSubtopicContentParams.parse(req.params);
    const body = UpdateSubtopicContentBody.parse(req.body);
    const authClaims = ((req as any).authClaims ?? null) as import("../lib/jwt").AccessTokenPayload | null;

    const [content] = await db
      .select()
      .from(nodesTable)
      .where(eq(nodesTable.id, id))
      .limit(1);

    if (!content) {
      res.status(404).json({ error: "Subtopic not found" });
      return;
    }

    const canonicalNodeId = String(content.canonicalNodeId || "").trim();
    if (canonicalNodeId) {
      await db
        .update(canonicalNodesTable)
        .set({
          explanation: body.explanation,
          updatedAt: new Date(),
        })
        .where(eq(canonicalNodesTable.id, canonicalNodeId));
    }

    await db
      .update(nodesTable)
      .set({
        explanation: body.explanation,
        updatedAt: new Date(),
      })
      .where(eq(nodesTable.id, id));

    if (content.unitSubtopicId && Array.isArray(body.questions)) {
      await withRequestDbContext(authClaims, async (tx) => {
        await tx
          .delete(configQuestionsTable)
          .where(
            and(
              eq(configQuestionsTable.configId, content.configId),
              eq(configQuestionsTable.unitSubtopicId, content.unitSubtopicId),
            ),
          );

        if (body.questions.length > 0) {
          await tx.insert(configQuestionsTable).values(
            body.questions.map((q) => ({
              configId: content.configId,
              unitSubtopicId: content.unitSubtopicId!,
              markType: q.markType,
              question: q.question,
              answer: q.answer,
              isStarred: q.isStarred ?? false,
              starSource: q.starSource ?? (q.isStarred ? "manual" : "none"),
            })),
          );
        }
      });
    }

    res.json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, "Failed to update subtopic content");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

