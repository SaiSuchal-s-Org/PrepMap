import { Router, type IRouter, type Request } from "express";
import { GetAdminStatsResponse } from "../api-zod";
import { db, eventsTable, nodesTable, usersTable, configsTable, withRequestDbContext } from "../db";
import { eq, count, inArray } from "drizzle-orm";
import { requireAdmin } from "../middleware/adminAuth";
import type { AccessTokenPayload } from "../lib/jwt";

const router: IRouter = Router();
const QUESTION_BANK_EVENT_PREFIX = "__qb__:";
const isQuestionBankEvent = (topicId: string | null | undefined, questionId: string | null | undefined): boolean =>
  !!String(questionId || "").trim() || String(topicId || "").startsWith(QUESTION_BANK_EVENT_PREFIX);
const isLearnerRole = (role: string | null | undefined) => {
  const normalized = (role || "").toLowerCase();
  return normalized === "student" || normalized === "super_student";
};
const getAdminClaims = (req: Request): AccessTokenPayload | null =>
  ((req as any).authClaims ?? null) as AccessTokenPayload | null;

router.get("/admin/stats", requireAdmin, async (req, res) => {
  try {
    const stats = await withRequestDbContext(getAdminClaims(req), async (tx) =>
      tx
        .select({
          subtopicId: nodesTable.id,
          subtopicTitle: nodesTable.title,
          eventCount: count(eventsTable.id),
        })
        .from(nodesTable)
        .leftJoin(eventsTable, eq(nodesTable.id, eventsTable.subtopicId))
        .where(eq(nodesTable.type, "subtopic"))
        .groupBy(nodesTable.id, nodesTable.title)
    );

    const response = GetAdminStatsResponse.parse(
      stats.map((s) => ({
        subtopicId: s.subtopicId,
        subtopicTitle: s.subtopicTitle,
        eventCount: Number(s.eventCount),
      }))
    );

    res.json(response);
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch admin stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/analytics/universities", requireAdmin, async (req, res) => {
  try {
    const allUsers = await db
      .select({
        id: usersTable.id,
        universityId: usersTable.universityId,
        role: usersTable.role,
      })
      .from(usersTable);
    const students = allUsers.filter((u) => isLearnerRole(u.role));

    const liveConfigs = await db
      .select({
        id: configsTable.id,
        universityId: configsTable.universityId,
        year: configsTable.year,
        exam: configsTable.exam,
        subject: configsTable.subject,
        createdAt: configsTable.createdAt,
      })
      .from(configsTable)
      .where(eq(configsTable.status, "live"));

    const latestConfigByUniversity = new Map<string, (typeof liveConfigs)[number]>();
    for (const cfg of liveConfigs) {
      const existing = latestConfigByUniversity.get(cfg.universityId);
      if (!existing || (cfg.createdAt?.getTime() ?? 0) > (existing.createdAt?.getTime() ?? 0)) {
        latestConfigByUniversity.set(cfg.universityId, cfg);
      }
    }

    const latestConfigIds = Array.from(new Set(Array.from(latestConfigByUniversity.values()).map((c) => c.id)));

    const subtopicCountByConfig = new Map<string, number>();
    if (latestConfigIds.length > 0) {
      const subtopicCounts = await db
        .select({
          configId: nodesTable.configId,
          total: count(nodesTable.id),
        })
        .from(nodesTable)
        .where(inArray(nodesTable.configId, latestConfigIds))
        .groupBy(nodesTable.configId);
      for (const row of subtopicCounts) {
        subtopicCountByConfig.set(row.configId, Number(row.total));
      }
    }

    type ProgressKey = string;
    const progressMap = new Map<ProgressKey, Set<string>>();
    if (latestConfigIds.length > 0) {
      const rows = await withRequestDbContext(getAdminClaims(req), async (tx) =>
        tx
          .select({
            configId: eventsTable.configId,
            userId: eventsTable.userId,
            topicId: eventsTable.topicId,
            subtopicId: eventsTable.subtopicId,
          })
          .from(eventsTable)
          .where(inArray(eventsTable.configId, latestConfigIds))
      );

      for (const row of rows) {
        if (isQuestionBankEvent(row.topicId, null)) continue;
        const key = `${row.configId}::${row.userId}`;
        if (!progressMap.has(key)) progressMap.set(key, new Set<string>());
        const subtopicId = String(row.subtopicId || "").trim();
        if (subtopicId) {
          progressMap.get(key)!.add(subtopicId);
        }
      }
    }

    const studentsByUniversity = new Map<string, string[]>();
    for (const s of students) {
      studentsByUniversity.set(s.universityId, [...(studentsByUniversity.get(s.universityId) ?? []), s.id]);
    }

    const universityIds = Array.from(
      new Set([
        ...students.map((s) => s.universityId),
        ...liveConfigs.map((c) => c.universityId),
      ])
    );
    const summary = universityIds.map((universityId) => {
      const studentIds = studentsByUniversity.get(universityId) ?? [];
      const totalStudents = studentIds.length;
      const latestConfig = latestConfigByUniversity.get(universityId) ?? null;

      if (!latestConfig) {
        return {
          universityId,
          totalStudents,
          latestConfig: null,
          startedStudents: 0,
          startedPercent: 0,
          avgProgressPercent: 0,
          totalSubtopics: 0,
        };
      }

      const totalSubtopics = subtopicCountByConfig.get(latestConfig.id) ?? 0;
      let startedStudents = 0;
      let totalProgress = 0;

      for (const studentId of studentIds) {
        const key = `${latestConfig.id}::${studentId}`;
        const doneCount = progressMap.get(key)?.size ?? 0;
        if (doneCount > 0) startedStudents += 1;
        const pct = totalSubtopics > 0 ? (doneCount / totalSubtopics) * 100 : 0;
        totalProgress += pct;
      }

      const startedPercent = totalStudents > 0 ? (startedStudents / totalStudents) * 100 : 0;
      const avgProgressPercent = totalStudents > 0 ? totalProgress / totalStudents : 0;

      return {
        universityId,
        totalStudents,
        latestConfig: {
          id: latestConfig.id,
          year: latestConfig.year,
          exam: latestConfig.exam,
          subject: latestConfig.subject,
          createdAt: latestConfig.createdAt?.toISOString() ?? null,
        },
        startedStudents,
        startedPercent,
        avgProgressPercent,
        totalSubtopics,
      };
    });

    res.json(summary);
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch university analytics summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/analytics/exam-configs", requireAdmin, async (req, res) => {
  try {
    const exam = String(req.query.exam || "").trim();
    if (!exam) {
      res.status(400).json({ error: "exam query param is required" });
      return;
    }

    const allUsers = await db
      .select({
        id: usersTable.id,
        universityId: usersTable.universityId,
        role: usersTable.role,
      })
      .from(usersTable);
    const students = allUsers.filter((u) => isLearnerRole(u.role));

    const liveConfigs = await db
      .select({
        id: configsTable.id,
        universityId: configsTable.universityId,
        year: configsTable.year,
        exam: configsTable.exam,
        subject: configsTable.subject,
        createdAt: configsTable.createdAt,
      })
      .from(configsTable)
      .where(eq(configsTable.status, "live"));

    const examConfigs = liveConfigs.filter((cfg) => cfg.exam === exam);
    const latestByUniversitySubject = new Map<string, (typeof examConfigs)[number]>();
    for (const cfg of examConfigs) {
      const key = `${cfg.universityId}::${cfg.subject.toLowerCase().trim()}`;
      const existing = latestByUniversitySubject.get(key);
      if (!existing || (cfg.createdAt?.getTime() ?? 0) > (existing.createdAt?.getTime() ?? 0)) {
        latestByUniversitySubject.set(key, cfg);
      }
    }

    const selectedConfigs = Array.from(latestByUniversitySubject.values());
    const selectedConfigIds = selectedConfigs.map((c) => c.id);

    const subtopicCountByConfig = new Map<string, number>();
    if (selectedConfigIds.length > 0) {
      const subtopicCounts = await db
        .select({
          configId: nodesTable.configId,
          total: count(nodesTable.id),
        })
        .from(nodesTable)
        .where(inArray(nodesTable.configId, selectedConfigIds))
        .groupBy(nodesTable.configId);
      for (const row of subtopicCounts) {
        subtopicCountByConfig.set(row.configId, Number(row.total));
      }
    }

    const progressMap = new Map<string, Set<string>>();
    if (selectedConfigIds.length > 0) {
      const rows = await withRequestDbContext(getAdminClaims(req), async (tx) =>
        tx
          .select({
            configId: eventsTable.configId,
            userId: eventsTable.userId,
            topicId: eventsTable.topicId,
            subtopicId: eventsTable.subtopicId,
          })
          .from(eventsTable)
          .where(inArray(eventsTable.configId, selectedConfigIds))
      );

      for (const row of rows) {
        if (isQuestionBankEvent(row.topicId, null)) continue;
        const key = `${row.configId}::${row.userId}`;
        if (!progressMap.has(key)) progressMap.set(key, new Set<string>());
        const subtopicId = String(row.subtopicId || "").trim();
        if (subtopicId) {
          progressMap.get(key)!.add(subtopicId);
        }
      }
    }

    const studentsByUniversity = new Map<string, string[]>();
    for (const s of students) {
      studentsByUniversity.set(s.universityId, [...(studentsByUniversity.get(s.universityId) ?? []), s.id]);
    }

    const rows = selectedConfigs
      .map((cfg) => {
        const studentIds = studentsByUniversity.get(cfg.universityId) ?? [];
        const totalStudents = studentIds.length;
        const totalSubtopics = subtopicCountByConfig.get(cfg.id) ?? 0;

        let startedStudents = 0;
        let totalProgress = 0;

        for (const studentId of studentIds) {
          const key = `${cfg.id}::${studentId}`;
          const doneCount = progressMap.get(key)?.size ?? 0;
          if (doneCount > 0) startedStudents += 1;
          const pct = totalSubtopics > 0 ? (doneCount / totalSubtopics) * 100 : 0;
          totalProgress += pct;
        }

        const startedPercent = totalStudents > 0 ? (startedStudents / totalStudents) * 100 : 0;
        const avgProgressPercent = totalStudents > 0 ? totalProgress / totalStudents : 0;

        return {
          universityId: cfg.universityId,
          config: {
            id: cfg.id,
            year: cfg.year,
            exam: cfg.exam,
            subject: cfg.subject,
            createdAt: cfg.createdAt?.toISOString() ?? null,
          },
          totalStudents,
          startedStudents,
          startedPercent,
          avgProgressPercent,
          totalSubtopics,
        };
      })
      .sort((a, b) =>
        a.universityId.localeCompare(b.universityId) ||
        a.config.subject.localeCompare(b.config.subject)
      );

    res.json(rows);
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch exam config analytics");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/analytics/question-bank-interactions", requireAdmin, async (req, res) => {
  try {
    const rows = await withRequestDbContext(getAdminClaims(req), async (tx) =>
      tx
        .select({ topicId: eventsTable.topicId, questionId: eventsTable.questionId })
        .from(eventsTable)
    );

    const questionBankInteractionCount = rows.reduce((acc, row) => (
      isQuestionBankEvent(row.topicId, row.questionId) ? acc + 1 : acc
    ), 0);

    res.json({ questionBankInteractionCount });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch question bank interaction count");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/analytics/question-bank-interactions/breakdown", requireAdmin, async (req, res) => {
  try {
    const rows = await withRequestDbContext(getAdminClaims(req), async (tx) =>
      tx
        .select({
          configId: eventsTable.configId,
          universityId: eventsTable.universityId,
          topicId: eventsTable.topicId,
          questionId: eventsTable.questionId,
        })
        .from(eventsTable)
    );

    const questionBankRows = rows.filter((row) => isQuestionBankEvent(row.topicId, row.questionId));

    const byUniversityMap = new Map<string, number>();
    const byConfigMap = new Map<string, { configId: string; universityId: string; count: number }>();

    for (const row of questionBankRows) {
      byUniversityMap.set(row.universityId, (byUniversityMap.get(row.universityId) ?? 0) + 1);

      const existing = byConfigMap.get(row.configId);
      if (existing) {
        existing.count += 1;
      } else {
        byConfigMap.set(row.configId, {
          configId: row.configId,
          universityId: row.universityId,
          count: 1,
        });
      }
    }

    const byConfigIds = Array.from(byConfigMap.keys());
    const configRows = byConfigIds.length > 0
      ? await db
          .select({
            id: configsTable.id,
            subject: configsTable.subject,
            year: configsTable.year,
            exam: configsTable.exam,
          })
          .from(configsTable)
          .where(inArray(configsTable.id, byConfigIds))
      : [];
    const configById = new Map(configRows.map((cfg) => [cfg.id, cfg]));

    const byUniversity = Array.from(byUniversityMap.entries())
      .map(([universityId, count]) => ({ universityId, count }))
      .sort((a, b) => b.count - a.count);

    const byConfig = Array.from(byConfigMap.values())
      .map((row) => {
        const cfg = configById.get(row.configId);
        return {
          configId: row.configId,
          universityId: row.universityId,
          subject: cfg?.subject ?? "Unknown",
          year: cfg?.year ?? "",
          exam: cfg?.exam ?? "",
          count: row.count,
        };
      })
      .sort((a, b) => b.count - a.count);

    res.json({
      total: questionBankRows.length,
      byUniversity,
      byConfig,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch question bank interaction breakdown");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/analytics/question-bank-interactions/live-config-summary", requireAdmin, async (req, res) => {
  try {
    const configs = await db
      .select({
        id: configsTable.id,
        universityId: configsTable.universityId,
      })
      .from(configsTable);

    const configIds = configs.map((cfg) => cfg.id);

    const students = await db
      .select({
        id: usersTable.id,
        universityId: usersTable.universityId,
        role: usersTable.role,
      })
      .from(usersTable);
    const studentRows = students.filter((u) => isLearnerRole(u.role));
    const studentsByUniversity = new Map<string, Set<string>>();
    for (const s of studentRows) {
      if (!studentsByUniversity.has(s.universityId)) {
        studentsByUniversity.set(s.universityId, new Set<string>());
      }
      studentsByUniversity.get(s.universityId)!.add(s.id);
    }

    const interactionSetsByConfig = new Map<string, Set<string>>();
    const interactionCountByConfig = new Map<string, number>();

    if (configIds.length > 0) {
      const rows = await withRequestDbContext(getAdminClaims(req), async (tx) =>
        tx
          .select({
            configId: eventsTable.configId,
            userId: eventsTable.userId,
            topicId: eventsTable.topicId,
            questionId: eventsTable.questionId,
          })
          .from(eventsTable)
          .where(inArray(eventsTable.configId, configIds))
      );

      for (const row of rows) {
        if (!isQuestionBankEvent(row.topicId, row.questionId)) continue;
        interactionCountByConfig.set(row.configId, (interactionCountByConfig.get(row.configId) ?? 0) + 1);
        if (!interactionSetsByConfig.has(row.configId)) {
          interactionSetsByConfig.set(row.configId, new Set<string>());
        }
        interactionSetsByConfig.get(row.configId)!.add(row.userId);
      }
    }

    const rows = configs.map((cfg) => {
      const totalStudents = studentsByUniversity.get(cfg.universityId)?.size ?? 0;
      const uniqueStudents = interactionSetsByConfig.get(cfg.id)?.size ?? 0;
      const totalInteractions = interactionCountByConfig.get(cfg.id) ?? 0;
      const interactionPercent = totalStudents > 0 ? (uniqueStudents / totalStudents) * 100 : 0;
      return {
        configId: cfg.id,
        universityId: cfg.universityId,
        totalStudents,
        uniqueStudents,
        totalInteractions,
        interactionPercent,
      };
    });

    res.json({ rows });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch config QB interaction summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/analytics/configs/:configId/students", requireAdmin, async (req, res) => {
  try {
    const configId = String(req.params.configId || "").trim();
    if (!configId) {
      res.status(400).json({ error: "configId is required" });
      return;
    }

    const [config] = await db
      .select({
        id: configsTable.id,
        universityId: configsTable.universityId,
        year: configsTable.year,
        exam: configsTable.exam,
        subject: configsTable.subject,
      })
      .from(configsTable)
      .where(eq(configsTable.id, configId))
      .limit(1);

    if (!config) {
      res.status(404).json({ error: "Config not found" });
      return;
    }

    const totalSubtopicsRow = await db
      .select({ total: count(nodesTable.id) })
      .from(nodesTable)
      .where(eq(nodesTable.configId, configId));
    const totalSubtopics = Number(totalSubtopicsRow[0]?.total ?? 0);

    const students = await db
      .select({
        id: usersTable.id,
        role: usersTable.role,
        universityId: usersTable.universityId,
        year: usersTable.year,
        branch: usersTable.branch,
        lastSuccessfulLoginAt: usersTable.lastSuccessfulLoginAt,
        lastPasswordResetAt: usersTable.lastPasswordResetAt,
      })
      .from(usersTable);
    const learnerRows = students.filter((u) => isLearnerRole(u.role));

    const relevantStudents = learnerRows.filter((s) => s.universityId === config.universityId);
    const studentIds = relevantStudents.map((s) => s.id);
    const studentIdSet = new Set(studentIds);

    const progressMap = new Map<string, Set<string>>();
    const questionBankInteractionsByUser = new Map<string, number>();
    const lastActiveMap = new Map<string, Date>();
    if (studentIds.length > 0) {
      const rows = await withRequestDbContext(getAdminClaims(req), async (tx) =>
        tx
          .select({
            userId: eventsTable.userId,
            topicId: eventsTable.topicId,
            subtopicId: eventsTable.subtopicId,
            questionId: eventsTable.questionId,
            timestamp: eventsTable.timestamp,
          })
          .from(eventsTable)
          .where(eq(eventsTable.configId, configId))
      );

      for (const row of rows) {
        if (!studentIdSet.has(row.userId)) continue;
        const isQuestionBankInteraction = isQuestionBankEvent(row.topicId, row.questionId);
        if (isQuestionBankInteraction) {
          questionBankInteractionsByUser.set(
            row.userId,
            (questionBankInteractionsByUser.get(row.userId) ?? 0) + 1
          );
        } else {
          if (!progressMap.has(row.userId)) progressMap.set(row.userId, new Set<string>());
          const subtopicId = String(row.subtopicId || "").trim();
          if (subtopicId) {
            progressMap.get(row.userId)!.add(subtopicId);
          }
        }
        const last = lastActiveMap.get(row.userId);
        if (!last || (row.timestamp?.getTime() ?? 0) > last.getTime()) {
          lastActiveMap.set(row.userId, row.timestamp ?? new Date());
        }
      }
    }

    const studentsProgress = relevantStudents
      .map((s) => {
        const done = progressMap.get(s.id)?.size ?? 0;
        const progressPercent = totalSubtopics > 0 ? (done / totalSubtopics) * 100 : 0;
        return {
          userId: s.id,
          universityId: s.universityId,
          year: s.year,
          branch: s.branch,
          role: s.role,
          doneSubtopics: done,
          totalSubtopics,
          progressPercent,
          questionBankInteractions: questionBankInteractionsByUser.get(s.id) ?? 0,
          started: done > 0,
          lastActiveAt: lastActiveMap.get(s.id)?.toISOString() ?? null,
          lastSuccessfulLoginAt: s.lastSuccessfulLoginAt ? s.lastSuccessfulLoginAt.toISOString() : null,
          lastPasswordResetAt: s.lastPasswordResetAt ? s.lastPasswordResetAt.toISOString() : null,
        };
      })
      .sort((a, b) => b.progressPercent - a.progressPercent || a.userId.localeCompare(b.userId));

    res.json({
      config: {
        id: config.id,
        universityId: config.universityId,
        year: config.year,
        exam: config.exam,
        subject: config.subject,
      },
      totalStudents: relevantStudents.length,
      students: studentsProgress,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch per-student config analytics");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

