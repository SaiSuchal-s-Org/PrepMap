import { Router, type IRouter } from "express";
import { GetNodesQueryParams, GetNodesResponse } from "../api-zod";
import { db, nodesTable, configsTable, usersTable, configUnitLinksTable, canonicalNodesTable, withRequestDbContext } from "../db";
import { eq, inArray } from "drizzle-orm";
import { getJwtRequestAuth } from "../lib/requestAuth";

const router: IRouter = Router();

function toOrder(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isLiveStatus(value: string | null | undefined): boolean {
  return String(value || "").trim().toLowerCase() === "live";
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

router.get("/nodes", async (req, res) => {
  try {
    const { configId } = GetNodesQueryParams.parse(req.query);
    const includeContent =
      String((req.query as Record<string, unknown>)?.includeContent || "")
        .trim()
        .toLowerCase() === "true" ||
      String((req.query as Record<string, unknown>)?.includeContent || "")
        .trim() === "1";
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

    const [config, selectedLinks] = await withRequestDbContext(auth.claims, async (tx) => {
      const [config] = await tx
        .select({
          id: configsTable.id,
          universityId: configsTable.universityId,
          year: configsTable.year,
          branch: configsTable.branch,
          status: configsTable.status,
        })
        .from(configsTable)
        .where(eq(configsTable.id, configId))
        .limit(1);

      const selectedLinks = await tx
        .select({ unitLibraryId: configUnitLinksTable.unitLibraryId })
        .from(configUnitLinksTable)
        .where(eq(configUnitLinksTable.configId, configId));

      return [config ?? null, selectedLinks] as const;
    });

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

    const buildNodesResponse = async () => {
      const loadedNodes = await withRequestDbContext(auth.claims, async (tx) =>
        tx
          .select()
          .from(nodesTable)
          .where(eq(nodesTable.configId, configId))
      );
      const selectedUnitIds = selectedLinks.map((l) => l.unitLibraryId);
      let nodes = loadedNodes;

      if (selectedUnitIds.length > 0) {
        nodes = nodes.filter((n) => selectedUnitIds.includes(String(n.unitLibraryId || "")));
      }

      const canonicalIds = nodes
        .map((n) => String(n.canonicalNodeId || "").trim())
        .filter(Boolean);
      const canonicalRows = canonicalIds.length > 0
        ? await db
            .select()
            .from(canonicalNodesTable)
            .where(inArray(canonicalNodesTable.id, canonicalIds))
        : [];
      const canonicalById = new Map(canonicalRows.map((c) => [c.id, c]));
      const scopedByCanonical = new Map<string, string>();
      for (const n of nodes) {
        const cId = String(n.canonicalNodeId || "").trim();
        if (cId) scopedByCanonical.set(cId, n.id);
      }

      const siblingMap = new Map<string, typeof nodes>();
      for (const n of nodes) {
        const key = String(n.parentId || "__root__");
        const arr = siblingMap.get(key) || [];
        arr.push(n);
        siblingMap.set(key, arr);
      }
      for (const [key, arr] of siblingMap.entries()) {
        arr.sort((a, b) => {
          const byOrder = toOrder(a.sortOrder) - toOrder(b.sortOrder);
          if (byOrder !== 0) return byOrder;
          return String(a.title || "").localeCompare(String(b.title || ""));
        });
        siblingMap.set(key, arr);
      }

      return GetNodesResponse.parse(
        nodes.map((n) => {
          const canonical = canonicalById.get(String(n.canonicalNodeId || "").trim());
          const siblings = siblingMap.get(String(n.parentId || "__root__")) || [];
          const idx = siblings.findIndex((s) => s.id === n.id);
          const prev = idx > 0 ? siblings[idx - 1] : null;
          const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
          const explicitPrereqTitles = parseTextArray(canonical?.prerequisiteTitles ?? n.prerequisiteTitles);
          const explicitPrereqCanonicalIds = parseTextArray(canonical?.prerequisiteNodeIds ?? n.prerequisiteNodeIds);
          const explicitNextTitles = parseTextArray(canonical?.nextRecommendedTitles ?? n.nextRecommendedTitles);
          const explicitNextCanonicalIds = parseTextArray(canonical?.nextRecommendedNodeIds ?? n.nextRecommendedNodeIds);
          const mappedPrereqNodeIds = explicitPrereqCanonicalIds
            .map((cid) => scopedByCanonical.get(cid) || cid)
            .filter(Boolean);
          const mappedNextNodeIds = explicitNextCanonicalIds
            .map((cid) => scopedByCanonical.get(cid) || cid)
            .filter(Boolean);
          return {
            id: n.id,
            configId: n.configId,
            title: n.title,
            type: n.type,
            parentId: n.parentId,
            explanation: includeContent ? (String(canonical?.explanation || n.explanation || "").trim() || null) : null,
            learningGoal: includeContent ? (String(canonical?.learningGoal || n.learningGoal || "").trim() || null) : null,
            exampleBlock: includeContent ? (String(canonical?.exampleBlock || n.exampleBlock || "").trim() || null) : null,
            supportNote: includeContent ? (String(canonical?.supportNote || n.supportNote || "").trim() || null) : null,
            prerequisiteTitles: explicitPrereqTitles.length > 0 ? explicitPrereqTitles : prev ? [prev.title] : [],
            prerequisiteNodeIds: mappedPrereqNodeIds.length > 0 ? mappedPrereqNodeIds : prev ? [prev.id] : [],
            nextRecommendedTitles: explicitNextTitles.length > 0 ? explicitNextTitles : next ? [next.title] : [],
            nextRecommendedNodeIds: mappedNextNodeIds.length > 0 ? mappedNextNodeIds : next ? [next.id] : [],
            sortOrder: n.sortOrder,
          };
        })
      );
    };

    const response = await buildNodesResponse();
    res.json(response);
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch nodes");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/nodes/topic-content", async (req, res) => {
  try {
    const configId = String((req.query as Record<string, unknown>)?.configId || "").trim();
    const topicId = String((req.query as Record<string, unknown>)?.topicId || "").trim();
    if (!configId || !topicId) {
      res.status(400).json({ error: "configId and topicId are required" });
      return;
    }

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

    const [config] = await withRequestDbContext(auth.claims, async (tx) => {
      const [config] = await tx
        .select({
          id: configsTable.id,
          universityId: configsTable.universityId,
          year: configsTable.year,
          branch: configsTable.branch,
          status: configsTable.status,
        })
        .from(configsTable)
        .where(eq(configsTable.id, configId))
        .limit(1);

      return [config ?? null] as const;
    });

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

    const buildTopicBundle = async () => {
      const loadedNodes = await withRequestDbContext(auth.claims, async (tx) =>
        tx
          .select()
          .from(nodesTable)
          .where(eq(nodesTable.configId, configId))
      );
      const topicNode = loadedNodes.find((n) => n.id === topicId && n.type === "topic");
      if (!topicNode) return null;

      const bundleNodes = [
        topicNode,
        ...loadedNodes.filter((n) => n.type === "subtopic" && n.parentId === topicNode.id),
      ].sort((a, b) => toOrder(a.sortOrder) - toOrder(b.sortOrder));

      const canonicalIds = bundleNodes
        .map((n) => String(n.canonicalNodeId || "").trim())
        .filter(Boolean);
      const canonicalRows = canonicalIds.length > 0
        ? await db
            .select()
            .from(canonicalNodesTable)
            .where(inArray(canonicalNodesTable.id, canonicalIds))
        : [];
      const canonicalById = new Map(canonicalRows.map((c) => [c.id, c]));
      const scopedByCanonical = new Map(
        loadedNodes
          .map((n) => [String(n.canonicalNodeId || ""), n.id] as const)
          .filter(([id]) => !!id)
      );

      const siblingMap = new Map<string, typeof loadedNodes>();
      for (const n of loadedNodes) {
        const key = String(n.parentId || "__root__");
        const arr = siblingMap.get(key) || [];
        arr.push(n);
        siblingMap.set(key, arr);
      }
      for (const [key, arr] of siblingMap.entries()) {
        arr.sort((a, b) => {
          const byOrder = toOrder(a.sortOrder) - toOrder(b.sortOrder);
          if (byOrder !== 0) return byOrder;
          return String(a.title || "").localeCompare(String(b.title || ""));
        });
        siblingMap.set(key, arr);
      }

      const toContentNode = (n: typeof loadedNodes[number]) => {
        const canonical = canonicalById.get(String(n.canonicalNodeId || "").trim());
        const siblings = siblingMap.get(String(n.parentId || "__root__")) || [];
        const idx = siblings.findIndex((s) => s.id === n.id);
        const prev = idx > 0 ? siblings[idx - 1] : null;
        const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
        const explicitPrereqTitles = parseTextArray(canonical?.prerequisiteTitles ?? n.prerequisiteTitles);
        const explicitPrereqCanonicalIds = parseTextArray(canonical?.prerequisiteNodeIds ?? n.prerequisiteNodeIds);
        const explicitNextTitles = parseTextArray(canonical?.nextRecommendedTitles ?? n.nextRecommendedTitles);
        const explicitNextCanonicalIds = parseTextArray(canonical?.nextRecommendedNodeIds ?? n.nextRecommendedNodeIds);
        return {
          id: n.id,
          title: n.title,
          type: n.type,
          parentId: n.parentId,
          sortOrder: n.sortOrder,
          explanation: String(canonical?.explanation || n.explanation || "").trim() || null,
          learningGoal: String(canonical?.learningGoal || n.learningGoal || "").trim() || null,
          exampleBlock: String(canonical?.exampleBlock || n.exampleBlock || "").trim() || null,
          supportNote: String(canonical?.supportNote || n.supportNote || "").trim() || null,
          prerequisiteTitles: explicitPrereqTitles.length > 0 ? explicitPrereqTitles : prev ? [prev.title] : [],
          prerequisiteNodeIds: explicitPrereqCanonicalIds
            .map((cid) => scopedByCanonical.get(cid) || cid)
            .filter(Boolean)
            .length > 0
            ? explicitPrereqCanonicalIds.map((cid) => scopedByCanonical.get(cid) || cid).filter(Boolean)
            : prev
              ? [prev.id]
              : [],
          nextRecommendedTitles: explicitNextTitles.length > 0 ? explicitNextTitles : next ? [next.title] : [],
          nextRecommendedNodeIds: explicitNextCanonicalIds
            .map((cid) => scopedByCanonical.get(cid) || cid)
            .filter(Boolean)
            .length > 0
            ? explicitNextCanonicalIds.map((cid) => scopedByCanonical.get(cid) || cid).filter(Boolean)
            : next
              ? [next.id]
              : [],
        };
      };

      return {
        configId,
        topic: toContentNode(topicNode),
        subtopics: bundleNodes.filter((n) => n.type === "subtopic").map(toContentNode),
      };
    };

    const payload = await buildTopicBundle();
    if (!payload) {
      res.status(404).json({ error: "Topic not found for this config" });
      return;
    }
    res.json(payload);
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch topic content bundle");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

