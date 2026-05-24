import { integer, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

export const configConsolidatedStatsTable = pgTable("config_consolidated_stats", {
  configId: text("config_id").primaryKey(),
  universityId: text("university_id").notNull(),
  batch: text("batch").notNull(),
  year: text("year").notNull(),
  branch: text("branch").notNull(),
  subject: text("subject").notNull(),
  exam: text("exam").notNull(),
  status: text("status").notNull(),
  totalEvents: integer("total_events").notNull().default(0),
  totalStudentsInBatch: integer("total_students_in_batch").notNull().default(0),
  eligibleStudentCount: integer("eligible_student_count").notNull().default(0),
  uniqueStudentsContent: integer("unique_students_content").notNull().default(0),
  uniqueStudentsQb: integer("unique_students_qb").notNull().default(0),
  avgContentConsumptionPct: real("avg_content_consumption_pct").notNull().default(0),
  avgQbConsumptionPct: real("avg_qb_consumption_pct").notNull().default(0),
  studentsCompletedContent: integer("students_completed_content").notNull().default(0),
  studentsCompletedQb: integer("students_completed_qb").notNull().default(0),
  studentsCompletedBoth: integer("students_completed_both").notNull().default(0),
  contentTotalTargets: integer("content_total_targets").notNull().default(0),
  qbTotalTargets: integer("qb_total_targets").notNull().default(0),
  snapshotVersion: text("snapshot_version").notNull().default("v1"),
  consolidatedAt: timestamp("consolidated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

