import { Router, type IRouter } from "express";
import { db, universitiesTable } from "../db";
import { COMMON_BRANCH, EXAM_TYPES, SEMESTERS } from "../lib/appMetadata";

const router: IRouter = Router();

router.get("/metadata", async (req, res) => {
  try {
    const universities = await db
      .select({
        id: universitiesTable.id,
        name: universitiesTable.name,
      })
      .from(universitiesTable);

    universities.sort((a, b) => a.id.localeCompare(b.id));

    res.json({
      universities,
      commonBranch: COMMON_BRANCH,
      semesters: SEMESTERS,
      examTypes: EXAM_TYPES,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch metadata");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
