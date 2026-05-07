import { Router, type IRouter } from "express";
import { db, universitiesTable } from "../db";
import { COMMON_BRANCH, EXAM_TYPES, SEMESTERS } from "../lib/appMetadata";
import { cacheGetOrSet, cacheTtlMs } from "../lib/serverCache";

const router: IRouter = Router();

router.get("/metadata", async (req, res) => {
  try {
    const payload = await cacheGetOrSet("metadata:v1", cacheTtlMs.metadata, async () => {
      const universities = await db
        .select({
          id: universitiesTable.id,
          name: universitiesTable.name,
        })
        .from(universitiesTable);

      universities.sort((a, b) => a.id.localeCompare(b.id));

      return {
        universities,
        commonBranch: COMMON_BRANCH,
        semesters: SEMESTERS,
        examTypes: EXAM_TYPES,
      };
    });
    res.json(payload);
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch metadata");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
