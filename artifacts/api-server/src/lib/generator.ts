import {
  db,
  pool,
  configsTable,
  nodesTable,
  configQuestionsTable,
  configUnitLinksTable,
  subjectsTable,
  unitLibraryTable,
  canonicalNodesTable,
} from "../db";
import { and, eq, inArray } from "drizzle-orm";
import { askAI, askAIWithImage } from "./ai";
import { extractTextFromPdf, isImageMimeType, isPdfMimeType } from "./pdfExtractor";
import { ObjectStorageService } from "./objectStorage";
import { downloadSupabaseObject, isSupabaseObjectPath } from "./supabaseStorage";
import { logger } from "./logger";
import { parseFirstModelJsonObject } from "./parseModelJson";
import { createHash, randomUUID } from "crypto";
import { repairBrokenFormulaBullets } from "./textFormatting";

interface GenerationProgress {
  configId: string;
  status: "idle" | "parsing" | "generating" | "complete" | "error";
  progress: number;
  total: number;
  currentStep: string;
  error: string | null;
}

const progressMap = new Map<string, GenerationProgress>();

export function getProgress(configId: string): GenerationProgress {
  return (
    progressMap.get(configId) || {
      configId,
      status: "idle",
      progress: 0,
      total: 0,
      currentStep: "Not started",
      error: null,
    }
  );
}

function setProgress(configId: string, updates: Partial<GenerationProgress>) {
  const current = getProgress(configId);
  progressMap.set(configId, { ...current, ...updates });
}

interface ParsedTopic {
  title: string;
  subtopics: string[];
}

interface ParsedSyllabus {
  units: {
    title: string;
    topics: ParsedTopic[];
  }[];
}

type UnitLibraryTopics = {
  title: string;
  subtopics: string[];
};

type QuestionLevel = "Foundational" | "Applied";
type QuestionOrigin = "replica" | "pattern" | "generated";

interface GeneratedQuestion {
  markType: QuestionLevel;
  question: string;
  answer: string;
  unitTitle: string;
  topicTitle: string;
  subtopicTitle: string;
  isStarred: boolean;
  starSource: "auto" | "none";
  origin: QuestionOrigin;
}

function isSubpartOnlyQuestionText(value: string): boolean {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return /^\([a-z]\)\s+/i.test(text);
}

function stripMainQuestionNumber(value: string): string {
  let text = String(value || "").trim();
  if (!text) return "";

  const patterns: RegExp[] = [
    /^\s*(?:q(?:uestion)?\.?\s*)?\d{1,3}\s*[\).:\-]\s*/i,
    /^\s*\(\s*\d{1,3}\s*\)\s*/i,
    /^\s*(?:q(?:uestion)?\.?\s*)?\d{1,3}\s+/i,
  ];

  for (const pattern of patterns) {
    text = text.replace(pattern, "");
  }

  return text.trim();
}

function mergeSubpartReplicaQuestions(questions: GeneratedQuestion[]): GeneratedQuestion[] {
  if (questions.length <= 1) return questions;

  const merged: GeneratedQuestion[] = [];
  for (const question of questions) {
    if (isSubpartOnlyQuestionText(question.question) && merged.length > 0) {
      const prev = merged[merged.length - 1];
      prev.question = `${prev.question}\n${question.question}`.trim();

      if (question.answer && question.answer.trim() && question.answer.trim() !== prev.answer.trim()) {
        prev.answer = `${prev.answer}\n${question.answer}`.trim();
      }

      if (question.markType === "Applied") prev.markType = "Applied";
      prev.isStarred = prev.isStarred || question.isStarred;
      continue;
    }
    merged.push({ ...question });
  }

  return merged;
}

interface SubtopicCatalogItem {
  nodeId: string;
  unitSubtopicId: string;
  unitTitle: string;
  topicTitle: string;
  subtopicTitle: string;
  normUnit: string;
  normTopic: string;
  normSubtopic: string;
}

export interface LaneAReplicaQuestion {
  markType: QuestionLevel;
  question: string;
  answer: string;
  unitTitle: string;
  topicTitle: string;
  subtopicTitle: string;
  isStarred: boolean;
}

export interface LaneAStructureUnit {
  title: string;
  topics: Array<{
    title: string;
    subtopics: string[];
  }>;
}

type FactType = "definition" | "rule" | "note" | "pitfall" | "insight" | "example_candidate";

export interface LaneAFact {
  factId: string;
  type: FactType;
  text: string;
  sourceSpan: string;
}

export interface LaneAFactGroundingUnit {
  title: string;
  topics: Array<{
    title: string;
    topicFacts: LaneAFact[];
    subtopics: Array<{
      title: string;
      facts: LaneAFact[];
    }>;
  }>;
}

export interface LaneAReplicaExtractionInfo {
  hasReplicaFile: boolean;
  extractedPaperTextLength: number;
  extractionMethod: "model" | "none";
}

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const LOW_QUOTA_MODE = String(process.env.LOW_QUOTA_MODE || "").toLowerCase() === "true";
const QUESTION_BATCH_SIZE = getEnvNumber("QUESTION_BATCH_SIZE", LOW_QUOTA_MODE ? 12 : 35);
const QUESTION_MIN_BATCH_SIZE = getEnvNumber("QUESTION_MIN_BATCH_SIZE", LOW_QUOTA_MODE ? 6 : 10);
const REPLICA_EXTRACTION_MAX_QUESTIONS = getEnvNumber("REPLICA_EXTRACTION_MAX_QUESTIONS", 500);

function getTargetsForExam(exam: string): { totalQuestions: number; totalStars: number } {
  const normalizedExam = String(exam || "").toLowerCase().trim();
  if (normalizedExam.startsWith("mid")) {
    return { totalQuestions: 50, totalStars: 20 };
  }
  return { totalQuestions: 75, totalStars: 25 };
}

function roundUpToNearestTen(value: number): number {
  const n = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return n === 0 ? 0 : Math.ceil(n / 10) * 10;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function toSlug(value: string): string {
  const n = normalizeText(value);
  return n ? n.replace(/\s+/g, "_") : "untitled";
}

function legacyUnitTopicId(unitLibraryId: string, topicTitle: string): string {
  return `utp_${unitLibraryId}_${toSlug(topicTitle)}`;
}

function legacyUnitSubtopicId(unitTopicId: string, subtopicTitle: string): string {
  return `ust_${unitTopicId}_${toSlug(subtopicTitle)}`;
}

function hash8(parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 8);
}

function canonicalUnitId(subjectId: string, unitTitle: string): string {
  return `${subjectId}_u_${hash8([subjectId, normalizeText(unitTitle)])}`;
}

function canonicalTopicId(subjectId: string, unitTitle: string, topicTitle: string): string {
  return `${subjectId}_t_${hash8([subjectId, normalizeText(unitTitle), normalizeText(topicTitle)])}`;
}

function canonicalSubtopicId(subjectId: string, unitTitle: string, topicTitle: string, subtopicTitle: string): string {
  return `${subjectId}_s_${hash8([subjectId, normalizeText(unitTitle), normalizeText(topicTitle), normalizeText(subtopicTitle)])}`;
}

function scopedNodeId(configId: string, canonicalId: string): string {
  return `${configId}_${canonicalId}`;
}

const allowedFactTypes = new Set<FactType>([
  "definition",
  "rule",
  "note",
  "pitfall",
  "insight",
  "example_candidate",
]);

function parseFactsField(raw: unknown): LaneAFact[] {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((f) => {
      const text = String((f as any)?.text || "").trim();
      if (!text) return null;
      const rawType = String((f as any)?.type || "").trim() as FactType;
      const type: FactType = allowedFactTypes.has(rawType) ? rawType : "note";
      return {
        factId: String((f as any)?.factId || `uf_${randomUUID().slice(0, 8)}`).trim(),
        type,
        text,
        sourceSpan: String((f as any)?.sourceSpan || "").trim(),
      } as LaneAFact;
    })
    .filter((f): f is LaneAFact => Boolean(f));
}

async function loadFactGroundingFromUnitFacts(
  unitIds: string[],
  structure: LaneAStructureUnit[],
  unitById: Map<string, { id: string; unitTitle: string }>,
): Promise<Map<string, { topicFacts: Map<string, LaneAFact[]>; subtopicFacts: Map<string, LaneAFact[]> }> | null> {
  if (unitIds.length === 0) return new Map();

  const exists = await pool.query<{ regclass: string | null }>(
    `SELECT to_regclass('public.unit_facts') AS regclass`,
  );
  if (!exists.rows[0]?.regclass) return null;

  const cols = await pool.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'unit_facts'
    `,
  );
  const colSet = new Set(cols.rows.map((r) => String(r.column_name || "").trim().toLowerCase()));
  const unitCol = ["unit_library_id", "unit_id", "library_unit_id"].find((c) => colSet.has(c));
  if (!unitCol) return null;

  const topicCol = ["topic_title", "topic", "topic_name"].find((c) => colSet.has(c));
  const subtopicCol = ["subtopic_title", "subtopic", "subtopic_name"].find((c) => colSet.has(c));
  const topicIdCol = ["unit_topic_id", "topic_id"].find((c) => colSet.has(c));
  const subtopicIdCol = ["unit_subtopic_id", "subtopic_id"].find((c) => colSet.has(c));
  const factTextCol = ["fact_text", "text", "fact", "content"].find((c) => colSet.has(c));
  const factTypeCol = ["fact_type", "type"].find((c) => colSet.has(c));
  const factIdCol = ["fact_id", "id"].find((c) => colSet.has(c));
  const sourceCol = ["source_span", "source", "source_text", "source_ref"].find((c) => colSet.has(c));

  const sql = `
    SELECT
      CAST(uf.${unitCol} AS text) AS unit_id
      ${topicCol ? `, CAST(uf.${topicCol} AS text) AS topic_title` : ", NULL::text AS topic_title"}
      ${subtopicCol ? `, CAST(uf.${subtopicCol} AS text) AS subtopic_title` : ", NULL::text AS subtopic_title"}
      ${topicIdCol ? `, CAST(uf.${topicIdCol} AS text) AS topic_id` : ", NULL::text AS topic_id"}
      ${subtopicIdCol ? `, CAST(uf.${subtopicIdCol} AS text) AS subtopic_id` : ", NULL::text AS subtopic_id"}
      ${factTextCol ? `, CAST(uf.${factTextCol} AS text) AS fact_text` : ", ''::text AS fact_text"}
      ${factTypeCol ? `, CAST(uf.${factTypeCol} AS text) AS fact_type` : ", 'note'::text AS fact_type"}
      ${factIdCol ? `, CAST(uf.${factIdCol} AS text) AS fact_id` : ", ''::text AS fact_id"}
      ${sourceCol ? `, CAST(uf.${sourceCol} AS text) AS source_span` : ", ''::text AS source_span"}
    FROM public.unit_facts uf
    WHERE CAST(uf.${unitCol} AS text) = ANY($1::text[])
  `;

  const rows = await pool.query<{
    unit_id: string;
    topic_title: string | null;
    subtopic_title: string | null;
    topic_id: string | null;
    subtopic_id: string | null;
    fact_text: string | null;
    fact_type: string | null;
    fact_id: string | null;
    source_span: string | null;
  }>(sql, [unitIds]);

  const allowed = new Set<FactType>([
    "definition",
    "rule",
    "note",
    "pitfall",
    "insight",
    "example_candidate",
  ]);
  const fallbackByUnitNorm = new Map<string, LaneAStructureUnit>();
  for (const unit of structure) fallbackByUnitNorm.set(normalizeText(unit.title), unit);
  const idLookupByUnitNorm = new Map<
    string,
    {
      topicTitleById: Map<string, string>;
      subtopicById: Map<string, { topicTitle: string; subtopicTitle: string }>;
    }
  >();
  for (const unit of structure) {
    const unitNorm = normalizeText(unit.title);
    const linkedUnit = Array.from(unitById.values()).find(
      (u) => normalizeText(String(u.unitTitle || "")) === unitNorm
    );
    if (!linkedUnit) continue;
    const topicTitleById = new Map<string, string>();
    const subtopicById = new Map<string, { topicTitle: string; subtopicTitle: string }>();
    for (const topic of unit.topics) {
      const topicId = legacyUnitTopicId(linkedUnit.id, topic.title);
      topicTitleById.set(topicId, topic.title);
      for (const subtopic of topic.subtopics) {
        const subId = legacyUnitSubtopicId(topicId, subtopic);
        subtopicById.set(subId, { topicTitle: topic.title, subtopicTitle: subtopic });
      }
    }
    idLookupByUnitNorm.set(unitNorm, { topicTitleById, subtopicById });
  }

  const out = new Map<string, { topicFacts: Map<string, LaneAFact[]>; subtopicFacts: Map<string, LaneAFact[]> }>();
  const pushTopicFact = (unitTitle: string, topicTitle: string, fact: LaneAFact) => {
    const key = normalizeText(unitTitle);
    const bucket = out.get(key) ?? { topicFacts: new Map(), subtopicFacts: new Map() };
    const topicKey = normalizeText(topicTitle);
    const list = bucket.topicFacts.get(topicKey) ?? [];
    list.push(fact);
    bucket.topicFacts.set(topicKey, list);
    out.set(key, bucket);
  };
  const pushSubtopicFact = (unitTitle: string, topicTitle: string, subtopicTitle: string, fact: LaneAFact) => {
    const key = normalizeText(unitTitle);
    const bucket = out.get(key) ?? { topicFacts: new Map(), subtopicFacts: new Map() };
    const subKey = `${normalizeText(topicTitle)}|${normalizeText(subtopicTitle)}`;
    const list = bucket.subtopicFacts.get(subKey) ?? [];
    list.push(fact);
    bucket.subtopicFacts.set(subKey, list);
    out.set(key, bucket);
  };

  for (const row of rows.rows) {
    const unit = unitById.get(String(row.unit_id || "").trim());
    if (!unit) continue;
    const unitNorm = normalizeText(unit.unitTitle);
    const unitStruct = fallbackByUnitNorm.get(unitNorm);
    if (!unitStruct) continue;

    const text = String(row.fact_text || "").trim();
    if (!text) continue;
    const rawType = String(row.fact_type || "").trim() as FactType;
    const fact: LaneAFact = {
      factId: String(row.fact_id || `uf_${randomUUID().slice(0, 8)}`).trim(),
      type: allowed.has(rawType) ? rawType : "note",
      text,
      sourceSpan: String(row.source_span || "").trim(),
    };

    let topicTitleResolved = String(row.topic_title || "").trim();
    let subtopicTitleResolved = String(row.subtopic_title || "").trim();
    const topicIdRaw = String(row.topic_id || "").trim();
    const subtopicIdRaw = String(row.subtopic_id || "").trim();
    const idLookup = idLookupByUnitNorm.get(unitNorm);

    if (!topicTitleResolved && topicIdRaw) {
      topicTitleResolved = idLookup?.topicTitleById.get(topicIdRaw) ?? "";
    }
    if (!subtopicTitleResolved && subtopicIdRaw) {
      const sub = idLookup?.subtopicById.get(subtopicIdRaw);
      if (sub) {
        topicTitleResolved = topicTitleResolved || sub.topicTitle;
        subtopicTitleResolved = sub.subtopicTitle;
      }
    }

    if (topicTitleResolved && subtopicTitleResolved) {
      pushSubtopicFact(unit.unitTitle, topicTitleResolved, subtopicTitleResolved, fact);
      continue;
    }
    if (topicTitleResolved) {
      pushTopicFact(unit.unitTitle, topicTitleResolved, fact);
      continue;
    }

    // If row is only unit-level, attach to first topic so model still gets grounding.
    const firstTopic = unitStruct.topics[0];
    if (firstTopic) {
      pushTopicFact(unit.unitTitle, firstTopic.title, fact);
    }
  }

  return out;
}

export function isLikelyQuestionText(value: string): boolean {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return false;

  const informationalPatterns = [
    /^part\s*-?\s*[a-z0-9]+\b/i,
    /^section\s*-?\s*[a-z0-9]+\b/i,
    /^answer\b/i,
    /^course outcomes?\b/i,
    /^knowledge level\b/i,
    /^blooms?\b/i,
    /^q\.?\s*no\b/i,
    /^time\b/i,
    /^marks?\b/i,
    /^or$/i,
    /^k[1-6]\s*-?\s*(remember|understand|apply|analy[sz]e|evaluate|create)\b/i,
  ];

  if (informationalPatterns.some((pattern) => pattern.test(text))) return false;

  if (
    /k1\s*-?\s*remember/i.test(text) &&
    /k2\s*-?\s*understand/i.test(text)
  ) {
    return false;
  }

  if (/\?$/.test(text)) return true;

  return /^(what|why|how|when|which|who|whom|whose|define|explain|list|state|create|write|describe|compare|differentiate|demonstrate|show|give|mention|outline|derive|implement)\b/i.test(
    text
  );
}

function explanationKey(unitTitle: string, topicTitle: string, subtopicTitle: string): string {
  return `${normalizeText(unitTitle)}|${normalizeText(topicTitle)}|${normalizeText(subtopicTitle)}`;
}

function topicExplanationKey(unitTitle: string, topicTitle: string): string {
  return `${normalizeText(unitTitle)}|${normalizeText(topicTitle)}`;
}

type ParsedReplicaQuestion = {
  qNo: number;
  text: string;
  marks: number | null;
};

type ParsedReplicaQuestionBlock = {
  qNo: number;
  variant: string | null;
  stemLines: string[];
  subparts: Array<{ label: string; lines: string[] }>;
  marks: number | null;
};

function markTypeFromMarks(marks: number | null, fallback: QuestionLevel = "Foundational"): QuestionLevel {
  if (marks == null) return fallback;
  return marks <= 3 ? "Foundational" : "Applied";
}

function parseMarksFromLine(line: string): number | null {
  const normalized = line.replace(/[–—]/g, "-");

  const xPattern = normalized.match(/(\d+)\s*[xX]\s*(\d+)/);
  if (xPattern) {
    const perQuestion = Number(xPattern[2]);
    if (Number.isFinite(perQuestion) && perQuestion > 0) return perQuestion;
  }

  const marksPattern = normalized.match(/(\d+)\s*marks?/i);
  if (marksPattern) {
    const value = Number(marksPattern[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const mPattern = normalized.match(/\b(\d+)\s*[mM]\b/);
  if (mPattern) {
    const value = Number(mPattern[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return null;
}

function parseReplicaQuestionsWithSections(paperText: string): ParsedReplicaQuestion[] {
  const lines = paperText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const blocks: ParsedReplicaQuestionBlock[] = [];
  let currentSectionMarks: number | null = null;
  let current: ParsedReplicaQuestionBlock | null = null;
  let activeSubpart: { label: string; lines: string[] } | null = null;

  const isSectionHeader = (line: string): boolean =>
    /(part|section)\s*[-:]?\s*[a-z0-9]+/i.test(line) ||
    /\b(short\s*answer|long\s*answer|essay|objective)\b/i.test(line);

  const isNoiseLine = (line: string): boolean => {
    const t = line.replace(/\s+/g, " ").trim();
    if (!t) return true;
    if (/^or$/i.test(t)) return true;
    if (/^(q\.?\s*no\.?|questions?|co|rbtl|blooms?|marks?|maximum|duration)\b/i.test(t)) return true;
    if (/^k[1-6]\b/i.test(t)) return true;
    if (/^\d+\s*$/.test(t)) return true;
    return false;
  };

  const flushCurrent = () => {
    if (!current) return;

    const stem = current.stemLines.join(" ").replace(/\s+/g, " ").trim();
    const renderedSubparts = current.subparts
      .map((sp) => {
        const spText = sp.lines.join(" ").replace(/\s+/g, " ").trim();
        if (!spText) return "";
        return `(${sp.label}) ${spText}`;
      })
      .filter(Boolean);

    const text = [stem, ...renderedSubparts].filter(Boolean).join("\n");
    if (text.length >= 8 && isLikelyQuestionText(text)) {
      blocks.push({
        qNo: current.qNo,
        variant: current.variant,
        stemLines: [...current.stemLines],
        subparts: current.subparts.map((sp) => ({ label: sp.label, lines: [...sp.lines] })),
        marks: current.marks,
      });
    }

    current = null;
    activeSubpart = null;
  };

  const startQuestion = (qNo: number, variant: string | null, initialText: string) => {
    flushCurrent();
    current = {
      qNo,
      variant,
      stemLines: initialText ? [initialText] : [],
      subparts: [],
      marks: currentSectionMarks,
    };
    activeSubpart = null;
  };

  const parseQuestionHeader = (
    line: string
  ): { qNo: number; variant: string | null; inlineText: string } | null => {
    const compact = line.replace(/\s+/g, " ").trim();
    const withVariantInline = compact.match(
      /^(?:q\.?\s*no\.?\s*)?(\d{1,3})\s*([a-z])[\)\.\-:\s]+(.+)$/i
    );
    if (withVariantInline) {
      return {
        qNo: Number(withVariantInline[1]),
        variant: withVariantInline[2].toLowerCase(),
        inlineText: withVariantInline[3].trim(),
      };
    }

    const plainInline = compact.match(/^(?:q\.?\s*no\.?\s*)?(\d{1,3})[\)\.\-:\s]+(.+)$/i);
    if (plainInline) {
      return {
        qNo: Number(plainInline[1]),
        variant: null,
        inlineText: plainInline[2].trim(),
      };
    }

    const onlyHeader = compact.match(/^(?:q\.?\s*no\.?\s*)?(\d{1,3})\s*([a-z])?[\)\.\-:]?$/i);
    if (onlyHeader) {
      return {
        qNo: Number(onlyHeader[1]),
        variant: onlyHeader[2] ? onlyHeader[2].toLowerCase() : null,
        inlineText: "",
      };
    }

    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isSectionHeader(line)) {
      const sameLineMarks = parseMarksFromLine(line);
      if (sameLineMarks != null) {
        currentSectionMarks = sameLineMarks;
      } else {
        const nextMarks = parseMarksFromLine(lines[i + 1] || "") ?? parseMarksFromLine(lines[i + 2] || "");
        if (nextMarks != null) currentSectionMarks = nextMarks;
      }
      continue;
    }

    const header = parseQuestionHeader(line);
    if (header) {
      startQuestion(header.qNo, header.variant, header.inlineText);
      continue;
    }

    if (!current) continue;
    if (isNoiseLine(line)) continue;

    const subpartMatch = line.match(/^\(([a-z])\)\s*(.*)$/i);
    if (subpartMatch) {
      const label = subpartMatch[1].toLowerCase();
      const text = subpartMatch[2].trim();
      const existing = current.subparts.find((sp) => sp.label === label);
      if (existing) {
        if (text) existing.lines.push(text);
        activeSubpart = existing;
      } else {
        const created = { label, lines: text ? [text] : [] };
        current.subparts.push(created);
        activeSubpart = created;
      }
      continue;
    }

    if (activeSubpart) {
      activeSubpart.lines.push(line);
    } else {
      current.stemLines.push(line);
    }
  }

  flushCurrent();

  return blocks
    .map((block) => {
      const stem = block.stemLines.join(" ").replace(/\s+/g, " ").trim();
      const renderedSubparts = block.subparts
        .map((sp) => {
          const spText = sp.lines.join(" ").replace(/\s+/g, " ").trim();
          if (!spText) return "";
          return `(${sp.label}) ${spText}`;
        })
        .filter(Boolean);
      return {
        qNo: block.qNo,
        text: [stem, ...renderedSubparts].filter(Boolean).join("\n").trim(),
        marks: block.marks,
      };
    })
    .filter((q) => q.text.length >= 8 && isLikelyQuestionText(q.text));
}

function inferMarkTypeFromParsedReplica(
  questionText: string,
  parsed: ParsedReplicaQuestion[],
  fallback: QuestionLevel = "Foundational"
): QuestionLevel {
  if (parsed.length === 0) return fallback;
  const qNorm = normalizeText(questionText);
  if (!qNorm) return fallback;

  let best: ParsedReplicaQuestion | null = null;
  let bestScore = -1;
  for (const p of parsed) {
    const pNorm = normalizeText(p.text);
    if (!pNorm) continue;
    let score = 0;
    if (qNorm === pNorm) score += 100;
    if (qNorm.includes(pNorm) || pNorm.includes(qNorm)) score += 30;
    const pTokens = pNorm.split(" ").filter((t) => t.length > 3);
    for (const t of pTokens.slice(0, 8)) {
      if (qNorm.includes(t)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  if (!best || bestScore < 6) return fallback;
  return markTypeFromMarks(best.marks, fallback);
}

async function askModelForJson<T>(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  label: string
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const strictUserPrompt =
      attempt === 1
        ? userPrompt
        : `${userPrompt}\n\nIMPORTANT:\nReturn ONLY one valid JSON object. Do not add markdown, prose, or code fences.`;
    const strictSystemPrompt =
      attempt === 1
        ? systemPrompt
        : `${systemPrompt}\nYou MUST return exactly one valid JSON object and nothing else.`;

    try {
      const response = await askAI(strictSystemPrompt, strictUserPrompt, maxTokens, { requireJson: true });
      return parseFirstModelJsonObject<T>(response);
    } catch (error) {
      lastError = error;
      logger.warn({ err: error, label, attempt }, "Model JSON parse failed, retrying");
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown model JSON parse error";
  throw new Error(`${label}: ${message}`);
}

function summarizeQuestionFocus(questionText: string, fallback = "the asked concept"): string {
  const text = String(questionText || "")
    .replace(/\s+/g, " ")
    .replace(/^\d+\s*[.)-]?\s*/, "")
    .trim();
  if (!text) return fallback;
  const lead = text.split(/[?.!]/)[0]?.trim() || text;
  const words = lead.split(" ").filter(Boolean).slice(0, 10);
  return words.join(" ") || fallback;
}

function buildFallbackReplicaAnswer(questionText: string, markType: QuestionLevel): string {
  const focus = summarizeQuestionFocus(questionText);
  if (markType === "Applied") {
    return [
      `This question is about ${focus}.`,
      "Apply the standard concept or formula in clear steps.",
      "Show the key intermediate result before the conclusion.",
      "State the final answer clearly with one tiny practical context.",
    ].join("\n");
  }
  return [
    `${focus} is the core concept asked here.`,
    "Write the key definition or formula and apply it directly.",
    "State the final result clearly in one exam-ready line.",
  ].join("\n");
}

function compactReadableExplanation(raw: string): string {
  const cleaned = repairBrokenFormulaBullets(String(raw || "").trim())
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return "";

  if (!cleaned.includes("\n")) {
    const sentenceParts = cleaned.match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
    if (sentenceParts.length >= 2) {
      const first = sentenceParts[0];
      const rest = sentenceParts.slice(1).join(" ").trim();
      if (first && rest) return `${first}\n\n${rest}`;
    }
  }
  return cleaned;
}

async function generateReplicaAnswersFromQuestions(
  subject: string,
  questions: Array<{ question: string; markType: QuestionLevel }>,
): Promise<Map<string, string>> {
  if (questions.length === 0) return new Map();

  const prompt = `Generate concise exam-ready answers for the following ${questions.length} questions in "${subject}".

Return ONLY valid JSON:
{
  "answers": [
    { "question": "<exact question text>", "answer": "<concise exam-ready answer>" }
  ]
}

Rules:
- Keep each answer short, direct, and readable.
- Foundational answers: 2-4 short lines.
- Applied answers: 4-7 short lines with brief steps.
- No instructional meta text like "Use a short exam answer" or "write definition first".
- If numerical values are missing, provide the best concise conceptual answer.
- Preserve the same question text in the output.

QUESTIONS:
${questions.map((q, idx) => `${idx + 1}. [${q.markType}] ${q.question}`).join("\n")}
`;

  try {
    const parsed = await askModelForJson<{ answers?: Array<{ question?: string; answer?: string }> }>(
      "You write concise exam-ready answers in strict JSON.",
      prompt,
      3200,
      "Replica answer generation failed",
    );

    const out = new Map<string, string>();
    for (const row of parsed.answers ?? []) {
      const question = String(row.question || "").trim();
      const answer = String(row.answer || "").trim();
      if (!question || !answer) continue;
      out.set(normalizeText(question), answer);
    }
    return out;
  } catch (error) {
    logger.warn({ err: error }, "Replica answer enrichment failed; using fallback answer text");
    return new Map();
  }
}

async function fetchFileContent(
  objectPath: string
): Promise<{ text?: string; imageBase64?: string; mediaType?: string; contentType?: string }> {
  let contentType = "application/octet-stream";
  let buffer: Buffer;
  if (isSupabaseObjectPath(objectPath)) {
    const downloaded = await downloadSupabaseObject(objectPath);
    contentType = downloaded.contentType;
    buffer = downloaded.buffer;
  } else {
    const storageService = new ObjectStorageService();
    const file = await storageService.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    contentType = (metadata.contentType as string) || "application/octet-stream";
    const [gcsBuffer] = await file.download();
    buffer = Buffer.from(gcsBuffer);
  }

  if (isPdfMimeType(contentType)) {
    const text = await extractTextFromPdf(buffer);
    return { text, contentType };
  }

  if (isImageMimeType(contentType)) {
    const base64 = buffer.toString("base64");
    return { imageBase64: base64, mediaType: contentType, contentType };
  }

  return { text: buffer.toString("utf-8"), contentType };
}

async function extractSyllabusText(config: {
  syllabusFileUrl: string | null;
}): Promise<string> {
  if (!config.syllabusFileUrl) throw new Error("No syllabus file URL");

  const content = await fetchFileContent(config.syllabusFileUrl);

  if (content.text) return content.text;

  if (content.imageBase64 && content.mediaType) {
    return askAIWithImage(
      "You are an OCR assistant. Extract all text from this image of a syllabus document. Return only the extracted text, preserving structure.",
      "Extract all text from this syllabus image.",
      content.imageBase64,
      content.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    );
  }

  throw new Error("Could not extract text from syllabus file");
}

export async function extractPaperText(paperFileUrls: string[]): Promise<string> {
  const texts: string[] = [];
  let pdfWithNoTextCount = 0;
  let failedCount = 0;
  for (const url of paperFileUrls) {
    try {
      const content = await fetchFileContent(url);
      if (content.text) {
        texts.push(content.text);
      } else if (content.contentType && isPdfMimeType(content.contentType)) {
        pdfWithNoTextCount += 1;
      } else if (content.imageBase64 && content.mediaType) {
        const text = await askAIWithImage(
          "You are an OCR assistant. Extract all text from this image of an exam question paper. Return only the extracted text.",
          "Extract all text from this question paper image.",
          content.imageBase64,
          content.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp"
        );
        texts.push(text);
      }
    } catch (err) {
      failedCount += 1;
      logger.warn({ err, url }, "Failed to extract text from paper file");
    }
  }
  if (texts.length === 0) {
    if (pdfWithNoTextCount > 0) {
      throw new Error("Replica extraction failed: uploaded PDF has no machine-readable text layer (likely scanned/image-only PDF). Paste text directly or upload a text-based PDF/image.");
    }
    if (failedCount > 0) {
      throw new Error("Replica extraction failed: unable to read uploaded file.");
    }
  }
  return texts.join("\n\n---\n\n");
}

async function parseSyllabus(
  syllabusText: string,
  subject: string
): Promise<ParsedSyllabus> {
  const prompt = `You are a syllabus parser for college exam prep. Given a syllabus for the subject "${subject}", extract its structure into units, topics, and subtopics.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "units": [
    {
      "title": "Unit 1: <unit title>",
      "topics": [
        {
          "title": "<topic title>",
          "subtopics": ["<subtopic 1>", "<subtopic 2>"]
        }
      ]
    }
  ]
}

Rules:
- Preserve original syllabus order
- Each topic should have 2-5 meaningful subtopics
- Subtopics should be specific and exam-relevant
- Keep unit/topic/subtopic titles concise`;

  return askModelForJson<ParsedSyllabus>(
    prompt,
    syllabusText,
    4000,
    "Syllabus parse failed"
  );
}

async function parseFromReusableUnits(configId: string): Promise<ParsedSyllabus | null> {
  const links = await db
    .select({
      unitLibraryId: configUnitLinksTable.unitLibraryId,
      sortOrder: configUnitLinksTable.sortOrder,
    })
    .from(configUnitLinksTable)
    .where(eq(configUnitLinksTable.configId, configId));

  if (links.length === 0) return null;

  links.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const unitIds = links.map((l) => l.unitLibraryId);
  const units = await db
    .select({
      id: unitLibraryTable.id,
      unitTitle: unitLibraryTable.unitTitle,
      topics: unitLibraryTable.topics,
    })
    .from(unitLibraryTable)
    .where(inArray(unitLibraryTable.id, unitIds));

  const unitById = new Map(units.map((u) => [u.id, u]));
  const parsedUnits = links
    .map((link) => unitById.get(link.unitLibraryId))
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map((u) => ({
      title: u.unitTitle,
      topics: (u.topics as UnitLibraryTopics[] | null | undefined)?.map((t) => ({
        title: String(t?.title || "").trim(),
        subtopics: Array.isArray(t?.subtopics)
          ? t.subtopics.map((s) => String(s).trim()).filter(Boolean)
          : [],
      })).filter((t) => t.title) ?? [],
    }))
    .filter((u) => u.topics.length > 0);

  if (parsedUnits.length === 0) return null;
  return { units: parsedUnits };
}

async function loadFactGroundingFromReusableUnits(
  configId: string,
  structure: LaneAStructureUnit[],
): Promise<LaneAFactGroundingUnit[]> {
  const links = await db
    .select({
      unitLibraryId: configUnitLinksTable.unitLibraryId,
      sortOrder: configUnitLinksTable.sortOrder,
    })
    .from(configUnitLinksTable)
    .where(eq(configUnitLinksTable.configId, configId));

  if (links.length === 0) {
    return structure.map((unit) => ({
      title: unit.title,
      topics: unit.topics.map((topic) => ({
        title: topic.title,
        topicFacts: [],
        subtopics: topic.subtopics.map((subtopic) => ({ title: subtopic, facts: [] })),
      })),
    }));
  }

  links.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const unitIds = links.map((l) => l.unitLibraryId);

  const units = await db
    .select({
      id: unitLibraryTable.id,
      unitTitle: unitLibraryTable.unitTitle,
    })
    .from(unitLibraryTable)
    .where(inArray(unitLibraryTable.id, unitIds));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const factsFromUnitFacts = await loadFactGroundingFromUnitFacts(unitIds, structure, unitById);
  if (factsFromUnitFacts) {
    return structure.map((unit) => {
      const unitBucket = factsFromUnitFacts.get(normalizeText(unit.title));
      return {
        title: unit.title,
        topics: unit.topics.map((topic) => {
          const topicFacts = (unitBucket?.topicFacts.get(normalizeText(topic.title)) ?? []);
          return {
            title: topic.title,
            topicFacts,
            subtopics: topic.subtopics.map((subtopic) => ({
              title: subtopic,
              facts:
                (unitBucket?.subtopicFacts.get(`${normalizeText(topic.title)}|${normalizeText(subtopic)}`) ?? []),
            })),
          };
        }),
      };
    });
  }

  return structure.map((unit) => {
    return {
      title: unit.title,
      topics: unit.topics.map((topic) => {
        return {
          title: topic.title,
          topicFacts: [],
          subtopics: topic.subtopics.map((subtopic) => ({
            title: subtopic,
            facts: [],
          })),
        };
      }),
    };
  });
}

async function loadReusableExplanationMap(
  subject: string,
  _currentConfigId: string
): Promise<Map<string, string>> {
  const normalizedSubject = normalizeText(subject);
  if (!normalizedSubject) return new Map();

  const [subjectRow] = await db
    .select({ id: subjectsTable.id })
    .from(subjectsTable)
    .where(eq(subjectsTable.normalizedName, normalizedSubject))
    .limit(1);
  if (!subjectRow) return new Map();

  const units = await db
    .select({
      id: unitLibraryTable.id,
      unitTitle: unitLibraryTable.unitTitle,
    })
    .from(unitLibraryTable)
    .where(eq(unitLibraryTable.subjectId, subjectRow.id));
  if (units.length === 0) return new Map();

  const unitById = new Map(units.map((u) => [u.id, u]));
  const unitIds = units.map((u) => u.id);
  const canonicalRows =
    unitIds.length > 0
      ? await db
          .select({
            id: canonicalNodesTable.id,
            unitLibraryId: canonicalNodesTable.unitLibraryId,
            title: canonicalNodesTable.title,
            type: canonicalNodesTable.type,
            parentCanonicalNodeId: canonicalNodesTable.parentCanonicalNodeId,
            explanation: canonicalNodesTable.explanation,
          })
          .from(canonicalNodesTable)
          .where(inArray(canonicalNodesTable.unitLibraryId, unitIds))
      : [];
  const canonicalById = new Map(canonicalRows.map((row) => [row.id, row]));

  const reuse = new Map<string, string>();
  for (const sub of canonicalRows) {
    if (sub.type !== "subtopic") continue;
    const explanation = String(sub.explanation || "").trim();
    if (!explanation) continue;
    const topic = sub.parentCanonicalNodeId ? canonicalById.get(sub.parentCanonicalNodeId) : null;
    if (!topic) continue;
    const unit = topic.unitLibraryId ? unitById.get(topic.unitLibraryId) : null;
    if (!unit) continue;

    const key = explanationKey(unit.unitTitle, topic.title, sub.title);
    if (!reuse.has(key)) reuse.set(key, explanation);
  }

  return reuse;
}

async function loadReusableTopicExplanationMap(
  subject: string,
  _currentConfigId: string
): Promise<Map<string, string>> {
  const normalizedSubject = normalizeText(subject);
  if (!normalizedSubject) return new Map();

  const [subjectRow] = await db
    .select({ id: subjectsTable.id })
    .from(subjectsTable)
    .where(eq(subjectsTable.normalizedName, normalizedSubject))
    .limit(1);
  if (!subjectRow) return new Map();

  const units = await db
    .select({
      id: unitLibraryTable.id,
      unitTitle: unitLibraryTable.unitTitle,
    })
    .from(unitLibraryTable)
    .where(eq(unitLibraryTable.subjectId, subjectRow.id));
  if (units.length === 0) return new Map();

  const unitById = new Map(units.map((u) => [u.id, u]));
  const unitIds = units.map((u) => u.id);
  const topics =
    unitIds.length > 0
      ? await db
          .select({
            unitLibraryId: canonicalNodesTable.unitLibraryId,
            title: canonicalNodesTable.title,
            explanation: canonicalNodesTable.explanation,
            type: canonicalNodesTable.type,
          })
          .from(canonicalNodesTable)
          .where(inArray(canonicalNodesTable.unitLibraryId, unitIds))
      : [];

  const reuse = new Map<string, string>();
  for (const topic of topics) {
    if (topic.type !== "topic") continue;
    const explanation = String(topic.explanation || "").trim();
    if (!explanation) continue;
    const unit = topic.unitLibraryId ? unitById.get(topic.unitLibraryId) : null;
    if (!unit) continue;
    const key = topicExplanationKey(unit.unitTitle, topic.title);
    if (!reuse.has(key)) reuse.set(key, explanation);
  }

  return reuse;
}

async function generateTopicExplanation(
  subject: string,
  unitTitle: string,
  topicTitle: string
): Promise<string> {
  const prompt = `You are an exam prep writer for "${subject}".

Write a crisp topic explanation for:
- Unit: ${unitTitle}
- Topic: ${topicTitle}

Requirements:
- 50-90 words
- Fast to revise, clear and practical
- Mention core idea + why it matters
- Include one tiny example or real use-case
- Use very simple English for first-year beginners
- Keep sentences short and direct
- Prefer 2 short paragraphs (no dense wall of text)
- Avoid jargon unless absolutely necessary
- Return plain text only.`;

  const response = await askAI(
    "You generate concise exam-ready topic explanations.",
    prompt,
    700
  );

  return compactReadableExplanation(response);
}

async function generateSubtopicExplanation(
  subject: string,
  unitTitle: string,
  topicTitle: string,
  subtopicTitle: string
): Promise<string> {
  const prompt = `You are an exam prep writer for "${subject}".

Write a crisp explanation for:
- Unit: ${unitTitle}
- Topic: ${topicTitle}
- Subtopic: ${subtopicTitle}

Requirements:
- 60-100 words
- Simple, clean, fast to revise
- Include: what it is, why it matters, one short example/use-case
- Prefer 2-3 short paragraphs (use bullets only if it is truly a list)
- Use very simple English for first-year beginners
- Keep sentences short and direct
- Avoid jargon unless absolutely necessary
- Return plain text only.`;

  const response = await askAI(
    "You generate concise exam-ready explanations.",
    prompt,
    900
  );

  return compactReadableExplanation(response);
}

async function extractReplicaQuestions(
  paperText: string,
  _catalog: SubtopicCatalogItem[],
  subject: string,
  maxQuestions: number
): Promise<{ questions: GeneratedQuestion[]; method: "model" | "none" }> {
  if (!paperText.trim()) return { questions: [], method: "none" };
  const cappedMaxQuestions = Math.max(1, Number.isFinite(maxQuestions) ? Math.floor(maxQuestions) : REPLICA_EXTRACTION_MAX_QUESTIONS);
  const paperForModel = paperText.slice(0, 52000);

  const buildExtractionPrompt = (textBlock: string, limit: number) => `Extract the COMPLETE mandatory question list from this replica exam paper for subject "${subject}".

Return ONLY valid JSON:
{
  "questions": [
    {
      "markType": "Foundational" | "Applied",
      "question": "<exact question text from paper>",
      "isStarred": true
    }
  ]
}

Rules:
- Keep question text faithful to paper wording.
- Include ALL actual questions present in this paper text.
- Important: ignore section instructions like "Answer any", "Choose any", "Attempt any", etc.
- Important: words like "OR" indicate alternative question statements; include BOTH alternatives as separate parent questions.
- Do NOT output subquestions as separate top-level questions.
- Keep subparts (a), (b), (i), (ii), etc. inside the same parent question text.
- Keep one clean readable block per parent question with simple line breaks.
- Do not include section headers, metadata, marks summary, or instructions.
- Star all extracted replica questions.
- Maximum ${limit} questions.

PAPER TEXT:
${textBlock}
`;

  const buildVerifyPrompt = (
    initialQuestions: Array<Partial<GeneratedQuestion>>,
    textBlock: string,
    options?: { compact?: boolean }
  ) => `You are verifying and finalizing extracted replica exam questions.

Return ONLY valid JSON:
{
  "questions": [
    {
      "markType": "Foundational" | "Applied",
      "question": "<question text>",
      "isStarred": true
    }
  ]
}

Task:
- Use PAPER TEXT as source of truth.
- Return the FINAL COMPLETE list of parent questions.
- Add missed questions.
- Remove non-question noise.
- Ignore "answer any / choose any" style instructions (they must not reduce extracted count).
- Keep BOTH branches for every "OR" alternative as separate parent questions.
- Keep subparts merged into their parent question.
- Keep wording faithful and formatting clean (readable line breaks; no markdown decorations).
- Maximum ${cappedMaxQuestions} questions.

INITIAL_EXTRACTED_QUESTIONS:
${initialQuestions
  .map((q, i) => `${i + 1}. ${String(q?.question || "").trim()}`)
  .filter((line) => !/^\d+\.\s*$/.test(line))
  .join("\n")}

PAPER TEXT:
${options?.compact ? textBlock.slice(0, 18000) : textBlock}
`;

  const toGenerated = (rows: Array<Partial<GeneratedQuestion>>) =>
    rows
      .filter((q) => String(q?.question || "").trim().length > 0)
      .map((q) => ({
        markType: q?.markType === "Applied" ? "Applied" as const : "Foundational" as const,
        question: stripMainQuestionNumber(String(q?.question || "")),
        answer: "",
        unitTitle: "",
        topicTitle: "",
        subtopicTitle: "",
        isStarred: true,
        starSource: "auto" as const,
        origin: "replica" as const,
      }))
      .filter((q) => q.question.length > 0);

  const splitIntoChunks = (text: string, chunkSize = 14000, overlap = 900): string[] => {
    const source = String(text || "").trim();
    if (!source) return [];
    if (source.length <= chunkSize) return [source];
    const chunks: string[] = [];
    let start = 0;
    while (start < source.length) {
      const end = Math.min(source.length, start + chunkSize);
      chunks.push(source.slice(start, end));
      if (end >= source.length) break;
      start = Math.max(0, end - overlap);
    }
    return chunks;
  };
  const isLengthLimitedModelError = (err: unknown): boolean => {
    const message = err instanceof Error ? err.message : String(err || "");
    return /finish_reason\s*=\s*length/i.test(message) || /max[_\s-]?tokens?/i.test(message);
  };

  try {
    let initialRows: Array<Partial<GeneratedQuestion>> = [];
    try {
      const extracted = await askModelForJson<{ questions?: Array<Partial<GeneratedQuestion>> }>(
        "You extract replica exam questions into strict JSON only.",
        buildExtractionPrompt(paperForModel, cappedMaxQuestions),
        7800,
        "Replica question extraction failed"
      );
      initialRows = extracted.questions ?? [];
    } catch (firstErr) {
      logger.warn({ err: firstErr }, "Replica full-text extraction failed; switching to chunked extraction");
      const chunks = splitIntoChunks(paperForModel);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkLimit = Math.max(cappedMaxQuestions, 30);
        const extractedChunk = await askModelForJson<{ questions?: Array<Partial<GeneratedQuestion>> }>(
          "You extract replica exam questions into strict JSON only.",
          buildExtractionPrompt(chunk, chunkLimit),
          4200,
          `Replica question chunk extraction failed (${i + 1}/${chunks.length})`
        );
        initialRows.push(...(extractedChunk.questions ?? []));
      }
    }

    let finalRows = initialRows;
    try {
      const verified = await askModelForJson<{ questions?: Array<Partial<GeneratedQuestion>> }>(
        "You verify completeness and formatting of extracted replica exam questions and output strict JSON only.",
        buildVerifyPrompt(initialRows, paperForModel, { compact: true }),
        5200,
        "Replica extraction verification failed",
      );
      finalRows = verified.questions ?? initialRows;
    } catch (verifyErr) {
      if (initialRows.length > 0 && isLengthLimitedModelError(verifyErr)) {
        logger.warn({ err: verifyErr, extractedCount: initialRows.length }, "Replica verification hit length limit; retrying via chunked verification");
        try {
          const verifyChunks = splitIntoChunks(paperForModel, 9000, 700);
          const verifiedRows: Array<Partial<GeneratedQuestion>> = [];
          for (let i = 0; i < verifyChunks.length; i++) {
            const verifiedChunk = await askModelForJson<{ questions?: Array<Partial<GeneratedQuestion>> }>(
              "You verify completeness and formatting of extracted replica exam questions and output strict JSON only.",
              buildVerifyPrompt(initialRows, verifyChunks[i], { compact: true }),
              3200,
              `Replica extraction chunk verification failed (${i + 1}/${verifyChunks.length})`
            );
            verifiedRows.push(...(verifiedChunk.questions ?? []));
          }
          finalRows = verifiedRows.length > 0 ? verifiedRows : initialRows;
        } catch (chunkVerifyErr) {
          logger.warn(
            { err: chunkVerifyErr, extractedCount: initialRows.length },
            "Replica chunked verification failed; using initial extraction"
          );
          finalRows = initialRows;
        }
      } else {
        throw verifyErr;
      }
    }

    const finalQuestions = toGenerated(finalRows).slice(0, cappedMaxQuestions);

    return {
      questions: finalQuestions,
      method: "model",
    };
  } catch (err) {
    const modelError = err instanceof Error ? err.message : "Unknown model error";
    logger.warn({ err }, "Replica extraction via model failed");
    throw new Error(`Replica extraction failed: ${modelError}`);
  }
}

export async function buildLaneAConfigPackage(configId: string): Promise<{
  configId: string;
  subject: string;
  structure: LaneAStructureUnit[];
  factGrounding: LaneAFactGroundingUnit[];
  replicaQuestions: LaneAReplicaQuestion[];
  warnings: string[];
  replicaExtraction: LaneAReplicaExtractionInfo;
  totalQuestionTarget: number;
  totalStarTarget: number;
}> {
  const [config] = await db
    .select()
    .from(configsTable)
    .where(eq(configsTable.id, configId))
    .limit(1);

  if (!config) throw new Error("Config not found");
  const targets = getTargetsForExam(config.exam);

  let parsed = await parseFromReusableUnits(configId);
  if (!parsed) {
    let syllabusText = "";
    if (config.syllabusFileUrl) syllabusText = await extractSyllabusText(config);
    if (!syllabusText.trim()) {
      throw new Error("No reusable units selected and no syllabus uploaded");
    }
    parsed = await parseSyllabus(syllabusText, config.subject);
  }

  const catalog: SubtopicCatalogItem[] = [];
  for (const unit of parsed.units) {
    for (const topic of unit.topics) {
      for (const subtopic of topic.subtopics) {
        catalog.push({
          nodeId: "",
          unitSubtopicId: "",
          unitTitle: unit.title,
          topicTitle: topic.title,
          subtopicTitle: subtopic,
          normUnit: normalizeText(unit.title),
          normTopic: normalizeText(topic.title),
          normSubtopic: normalizeText(subtopic),
        });
      }
    }
  }

  let paperText = "";
  const warnings: string[] = [];
  let extractionMethod: LaneAReplicaExtractionInfo["extractionMethod"] = "none";
  if (config.paperFileUrls && config.paperFileUrls.length > 0) {
    paperText = await extractPaperText(config.paperFileUrls.slice(0, 1));
    if (!paperText.trim()) {
      warnings.push("Replica file exists but text extraction returned empty content.");
    }
  }

  let replicaQuestions: GeneratedQuestion[] = [];
  if (paperText.trim()) {
    const extracted = await extractReplicaQuestions(
      paperText,
      catalog,
      config.subject,
      REPLICA_EXTRACTION_MAX_QUESTIONS
    );
    replicaQuestions = extracted.questions
      .map((q) => ({ ...q, question: String(q.question || "").trim() }))
      .filter((q) => q.question.length > 0);
    extractionMethod = extracted.method;
    if (replicaQuestions.length === 0) {
      throw new Error("No mandatory replica questions could be extracted from the uploaded replica.");
    }
  } else if (config.paperFileUrls && config.paperFileUrls.length > 0) {
    warnings.push("Replica file is attached, but no readable text was detected.");
  }

  const factGrounding = await loadFactGroundingFromReusableUnits(configId, parsed.units);

  return {
    configId,
    subject: config.subject,
    structure: parsed.units,
    factGrounding,
    replicaQuestions: replicaQuestions.map((q) => ({
      markType: q.markType,
      question: q.question,
      answer: q.answer,
      unitTitle: q.unitTitle,
      topicTitle: q.topicTitle,
      subtopicTitle: q.subtopicTitle,
      isStarred: q.isStarred,
    })),
    warnings,
    replicaExtraction: {
      hasReplicaFile: Boolean(config.paperFileUrls && config.paperFileUrls.length > 0),
      extractedPaperTextLength: paperText.length,
      extractionMethod,
    },
    totalQuestionTarget: targets.totalQuestions,
    totalStarTarget: targets.totalStars,
  };
}

async function generateQuestionBatch(
  subject: string,
  catalog: SubtopicCatalogItem[],
  paperText: string,
  existingQuestions: string[],
  count: number,
  starCount: number,
  includeReplicaSeed: GeneratedQuestion[] = []
): Promise<GeneratedQuestion[]> {
  const catalogShort = catalog.slice(0, 180).map((c) => `${c.unitTitle} > ${c.topicTitle} > ${c.subtopicTitle}`);

  const prompt = `Generate ${count} exam questions for subject "${subject}".

Return ONLY valid JSON:
{
  "questions": [
    {
      "markType": "Foundational" | "Applied",
      "question": "...",
      "answer": "...",
      "unitTitle": "...",
      "topicTitle": "...",
      "subtopicTitle": "...",
      "isStarred": true | false,
      "origin": "pattern" | "generated"
    }
  ]
}

Rules:
- Mix pattern-based (from paper style) and syllabus-generated questions
- Keep answers concise: Foundational 25-55 words, Applied 60-110 words
- Make formatting clean with short bullets/steps where useful
- Use beginner-friendly English only (very simple words, short sentences)
- Avoid dense terms like "invocation context", "lexical binding", "introspection" unless explained in plain words
- Never return one dense paragraph answer.
- Foundational answers must be 2-4 short lines with clear line breaks and one tiny real-world example when it improves understanding.
- Applied answers must be 4-7 short lines with steps/bullets and optional mini example.
- Decide contextually:
  - If the subject/question is technical and code genuinely improves clarity, you may include a short fenced code block.
  - If the subject/question is non-technical, avoid code blocks and use short step-wise explanation with a tiny practical example.
- In this batch, exactly ${starCount} should have isStarred=true
- Avoid duplicates with these existing questions:
${existingQuestions.slice(0, 200).map((q) => `- ${q}`).join("\n") || "(none)"}
- Keep topic coverage broad and balanced
- Use only these syllabus paths:
${catalogShort.join("\n")}
${includeReplicaSeed.length > 0 ? `- You may adapt these replica seed questions (do not copy exactly):\n${includeReplicaSeed.map((q) => `  - ${q.question}`).join("\n")}` : ""}
${paperText ? `- Reference paper style context:\n${paperText.substring(0, 6000)}` : ""}`;

  let parsed: { questions?: Array<Partial<GeneratedQuestion>> };
  try {
    parsed = await askModelForJson<{ questions?: Array<Partial<GeneratedQuestion>> }>(
      "You generate strict JSON exam question banks with concise high-quality answers.",
      prompt,
      6200,
      "Question batch generation failed"
    );
  } catch (primaryErr) {
    logger.warn({ err: primaryErr, count }, "Primary question batch prompt failed; trying slim fallback prompt");
    const compactCatalog = catalog.slice(0, 60).map((c) => `${c.unitTitle} > ${c.topicTitle} > ${c.subtopicTitle}`);
    const slimPrompt = `Generate ${count} exam questions for "${subject}" and return STRICT JSON only.

Format:
{
  "questions": [
    {
      "markType": "Foundational" | "Applied",
      "question": "...",
      "answer": "...",
      "unitTitle": "...",
      "topicTitle": "...",
      "subtopicTitle": "...",
      "isStarred": true | false,
      "origin": "pattern" | "generated"
    }
  ]
}

Rules:
- Exactly ${count} questions.
- Exactly ${starCount} starred.
- Keep answers concise.
- Keep answers structured with line breaks (not a dense paragraph).
- Foundational: 2-4 short lines with one tiny real-world example when helpful.
- Applied: 4-7 short lines.
- Decide contextually:
  - If the subject/question is technical and code genuinely improves clarity, you may include a short fenced code block.
  - If the subject/question is non-technical, avoid code blocks and use short step-wise explanation with a tiny practical example.
- Use only these syllabus paths:
${compactCatalog.join("\n")}
- Avoid duplicates with:
${existingQuestions.slice(0, 40).map((q) => `- ${q}`).join("\n") || "(none)"}
`;

    parsed = await askModelForJson<{ questions?: Array<Partial<GeneratedQuestion>> }>(
      "Return one valid JSON object only.",
      slimPrompt,
      4200,
      "Question batch generation failed (fallback)"
    );
  }
  const questions = parsed.questions ?? [];

  return questions
    .filter((q) => q.question && q.answer && isLikelyQuestionText(String(q.question)))
    .slice(0, count)
    .map((q) => ({
      markType: q.markType === "Applied" ? "Applied" : "Foundational",
      question: String(q.question || "").trim(),
      answer: String(q.answer || "").trim(),
      unitTitle: String(q.unitTitle || "").trim(),
      topicTitle: String(q.topicTitle || "").trim(),
      subtopicTitle: String(q.subtopicTitle || "").trim(),
      isStarred: Boolean(q.isStarred),
      starSource: q.isStarred ? "auto" : "none",
      origin: q.origin === "pattern" ? "pattern" : "generated",
    }));
}

function dedupeQuestions(questions: GeneratedQuestion[]): GeneratedQuestion[] {
  const seen = new Set<string>();
  const out: GeneratedQuestion[] = [];
  for (const q of questions) {
    const key = normalizeText(q.question);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

function rebalanceStars(questions: GeneratedQuestion[], targetStars: number): GeneratedQuestion[] {
  const prioritized = [...questions].sort((a, b) => {
    const originRank = (o: QuestionOrigin) => (o === "replica" ? 0 : o === "pattern" ? 1 : 2);
    const markRank = (m: QuestionLevel) => (m === "Foundational" ? 0 : 1);
    return originRank(a.origin) - originRank(b.origin) || markRank(a.markType) - markRank(b.markType);
  });

  let stars = prioritized.filter((q) => q.isStarred).length;
  if (stars < targetStars) {
    for (const q of prioritized) {
      if (stars >= targetStars) break;
      if (!q.isStarred) {
        q.isStarred = true;
        q.starSource = "auto";
        stars += 1;
      }
    }
  } else if (stars > targetStars) {
    for (let i = prioritized.length - 1; i >= 0 && stars > targetStars; i--) {
      const q = prioritized[i];
      if (q.isStarred && q.origin !== "replica") {
        q.isStarred = false;
        q.starSource = "none";
        stars -= 1;
      }
    }
    for (let i = prioritized.length - 1; i >= 0 && stars > targetStars; i--) {
      const q = prioritized[i];
      if (q.isStarred) {
        q.isStarred = false;
        q.starSource = "none";
        stars -= 1;
      }
    }
  }

  return prioritized;
}

function pickBestSubtopicMatch(
  question: GeneratedQuestion,
  catalog: SubtopicCatalogItem[],
): SubtopicCatalogItem | null {
  if (catalog.length === 0) return null;

  const qUnit = normalizeText(question.unitTitle);
  const qTopic = normalizeText(question.topicTitle);
  const qSubtopic = normalizeText(question.subtopicTitle);
  const qText = normalizeText(question.question);

  let best = catalog[0];
  let bestScore = -1;

  for (const item of catalog) {
    let score = 0;
    if (qSubtopic && (item.normSubtopic.includes(qSubtopic) || qSubtopic.includes(item.normSubtopic))) score += 6;
    if (qTopic && (item.normTopic.includes(qTopic) || qTopic.includes(item.normTopic))) score += 4;
    if (qUnit && (item.normUnit.includes(qUnit) || qUnit.includes(item.normUnit))) score += 3;

    const subTokens = item.normSubtopic.split(" ").filter((t) => t.length > 3);
    for (const token of subTokens.slice(0, 5)) {
      if (qText.includes(token)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return best;
}

async function buildQuestionBank(
  subject: string,
  catalog: SubtopicCatalogItem[],
  paperText: string,
  totalQuestions: number,
  totalStars: number
): Promise<GeneratedQuestion[]> {
  let TOTAL = totalQuestions;
  let STAR_TARGET = Math.min(totalStars, TOTAL);

  let replica: GeneratedQuestion[] = [];
  try {
    replica = (await extractReplicaQuestions(paperText, catalog, subject, REPLICA_EXTRACTION_MAX_QUESTIONS)).questions;
  } catch (err) {
    logger.warn({ err }, "Replica question extraction failed; continuing without replica questions");
  }
  if (replica.length > TOTAL) {
    TOTAL = roundUpToNearestTen(replica.length);
    STAR_TARGET = Math.max(totalStars, replica.filter((q) => q.isStarred).length);
  }
  if (replica.length === 0) {
    STAR_TARGET = 0;
  }
  let questions = dedupeQuestions(replica);

  let dynamicBatchSize = Math.max(QUESTION_MIN_BATCH_SIZE, QUESTION_BATCH_SIZE);
  const maxAttempts = 12;
  let attempts = 0;

  while (questions.length < TOTAL && attempts < maxAttempts) {
    attempts++;
    const remaining = TOTAL - questions.length;
    const count = Math.min(dynamicBatchSize, remaining);
    const starsRemaining = Math.max(0, STAR_TARGET - questions.filter((q) => q.isStarred).length);
    const starCount = Math.min(starsRemaining, count);

    try {
      const generated = await generateQuestionBatch(
        subject,
        catalog,
        paperText,
        questions.map((q) => q.question),
        count,
        starCount,
        attempts === 1 ? replica : []
      );

      const before = questions.length;
      questions = dedupeQuestions([...questions, ...generated]);
      const added = questions.length - before;

      if (added <= Math.floor(count / 3) && dynamicBatchSize > QUESTION_MIN_BATCH_SIZE) {
        dynamicBatchSize = Math.max(QUESTION_MIN_BATCH_SIZE, dynamicBatchSize - 2);
      }
    } catch (err) {
      logger.warn({ err, attempts, dynamicBatchSize }, "Question batch failed; shrinking batch and retrying");
      if (dynamicBatchSize > QUESTION_MIN_BATCH_SIZE) {
        dynamicBatchSize = Math.max(QUESTION_MIN_BATCH_SIZE, dynamicBatchSize - 2);
      }
    }
  }

  questions = questions.slice(0, TOTAL);
  questions = rebalanceStars(questions, STAR_TARGET);

  return questions;
}

export async function runGeneration(configId: string) {
  try {
    setProgress(configId, {
      configId,
      status: "parsing",
      progress: 0,
      total: 1,
      currentStep: "Fetching config...",
      error: null,
    });

    const [config] = await db
      .select()
      .from(configsTable)
      .where(eq(configsTable.id, configId))
      .limit(1);

    if (!config) throw new Error(`Config ${configId} not found`);
    const targets = getTargetsForExam(config.exam);

    let paperText = "";
    if (config.paperFileUrls && config.paperFileUrls.length > 0) {
      setProgress(configId, { currentStep: "Extracting replica paper text..." });
      paperText = await extractPaperText(config.paperFileUrls.slice(0, 1));
    }

    setProgress(configId, { currentStep: "Loading reusable unit structure..." });
    let parsed = await parseFromReusableUnits(configId);
    if (!parsed) {
      let syllabusText = "";
      if (config.syllabusFileUrl) {
        setProgress(configId, { currentStep: "Extracting syllabus text..." });
        syllabusText = await extractSyllabusText(config);
      }
      if (!syllabusText.trim()) {
        throw new Error("No reusable units selected and no syllabus uploaded");
      }

      setProgress(configId, { currentStep: "Parsing syllabus structure..." });
      parsed = await parseSyllabus(syllabusText, config.subject);
    }

    const existingNodes = await db
      .select({ id: nodesTable.id })
      .from(nodesTable)
      .where(eq(nodesTable.configId, configId));

    if (existingNodes.length > 0) {
      await db.delete(configQuestionsTable).where(eq(configQuestionsTable.configId, configId));
      await db.delete(nodesTable).where(eq(nodesTable.configId, configId));
    }

    const normalizedSubject = normalizeText(config.subject);
    let [subjectRow] = await db
      .select({ id: subjectsTable.id })
      .from(subjectsTable)
      .where(eq(subjectsTable.normalizedName, normalizedSubject))
      .limit(1);

    if (!subjectRow) {
      const subjectId = `sub_${randomUUID().substring(0, 8)}`;
      await db.insert(subjectsTable).values({
        id: subjectId,
        name: config.subject,
        normalizedName: normalizedSubject,
        createdBy: config.createdBy,
      });
      subjectRow = { id: subjectId };
    }

    const unitLibraryIdByNormTitle = new Map<string, string>();
    for (const unit of parsed.units) {
      const normalizedUnitTitle = normalizeText(unit.title);
      if (!normalizedUnitTitle) continue;
      const topics: UnitLibraryTopics[] = unit.topics.map((t) => ({
        title: t.title,
        subtopics: t.subtopics,
      }));

      const [existingUnit] = await db
        .select({ id: unitLibraryTable.id })
        .from(unitLibraryTable)
        .where(
          and(
            eq(unitLibraryTable.subjectId, subjectRow.id),
            eq(unitLibraryTable.normalizedUnitTitle, normalizedUnitTitle),
          ),
        )
        .limit(1);

      const selectedUnitId = existingUnit?.id ?? `unit_${randomUUID().substring(0, 8)}`;

      if (existingUnit) {
        await db
          .update(unitLibraryTable)
          .set({
            unitTitle: unit.title,
            topics,
            updatedAt: new Date(),
          })
          .where(eq(unitLibraryTable.id, existingUnit.id));
      } else {
        await db.insert(unitLibraryTable).values({
          id: selectedUnitId,
          subjectId: subjectRow.id,
          unitTitle: unit.title,
          normalizedUnitTitle,
          topics,
          sourceText: null,
          createdBy: config.createdBy,
        });
      }

      unitLibraryIdByNormTitle.set(normalizedUnitTitle, selectedUnitId);
    }

    let totalSubtopics = 0;
    let totalTopics = 0;
    for (const unit of parsed.units) {
      for (const topic of unit.topics) {
        totalTopics += 1;
        totalSubtopics += topic.subtopics.length;
      }
    }

    const totalSteps = totalSubtopics + totalTopics + targets.totalQuestions;

    setProgress(configId, {
      status: "generating",
      progress: 0,
      total: totalSteps,
      currentStep: "Creating roadmap and explanations...",
    });

    let subtopicCount = 0;
    let topicCount = 0;
    const catalog: SubtopicCatalogItem[] = [];
    setProgress(configId, { currentStep: "Loading reusable explanations..." });
    const reusableExplanationMap = await loadReusableExplanationMap(config.subject, configId);
    const reusableTopicExplanationMap = await loadReusableTopicExplanationMap(config.subject, configId);

    for (let ui = 0; ui < parsed.units.length; ui++) {
      const unit = parsed.units[ui];
      const unitLibraryId = unitLibraryIdByNormTitle.get(normalizeText(unit.title));
      if (!unitLibraryId) continue;
      const canonUnitId = canonicalUnitId(subjectRow.id, unit.title);
      const unitId = scopedNodeId(configId, canonUnitId);

      await db
        .insert(canonicalNodesTable)
        .values({
          id: canonUnitId,
          subjectId: subjectRow.id,
          unitLibraryId,
          title: unit.title,
          normalizedTitle: normalizeText(unit.title),
          type: "unit",
          parentCanonicalNodeId: null,
          sortOrder: ui + 1,
        })
        .onConflictDoUpdate({
          target: [canonicalNodesTable.id],
          set: {
            title: unit.title,
            normalizedTitle: normalizeText(unit.title),
            unitLibraryId,
            sortOrder: ui + 1,
            updatedAt: new Date(),
          },
        });

      await db.insert(nodesTable).values({
        id: unitId,
        configId,
        canonicalNodeId: canonUnitId,
        subjectId: subjectRow.id,
        unitLibraryId,
        title: unit.title,
        normalizedTitle: normalizeText(unit.title),
        type: "unit",
        parentId: null,
        sortOrder: ui + 1,
      });

      for (let ti = 0; ti < unit.topics.length; ti++) {
        const topic = unit.topics[ti];
        const canonTopicId = canonicalTopicId(subjectRow.id, unit.title, topic.title);
        const topicId = scopedNodeId(configId, canonTopicId);
        const topicKey = topicExplanationKey(unit.title, topic.title);
        let topicExplanation = reusableTopicExplanationMap.get(topicKey) || "";
        if (!topicExplanation) {
          try {
            topicExplanation = await generateTopicExplanation(
              config.subject,
              unit.title,
              topic.title
            );
          } catch (err) {
            logger.warn({ err, topicTitle: topic.title }, "Failed to generate topic explanation");
            topicExplanation = "Topic summary will be updated soon.";
          }
        }
        const repairedTopicExplanation = repairBrokenFormulaBullets(topicExplanation);

        const unitTopicId = canonTopicId;

        await db
          .insert(canonicalNodesTable)
          .values({
            id: canonTopicId,
            subjectId: subjectRow.id,
            unitLibraryId,
            title: topic.title,
            normalizedTitle: normalizeText(topic.title),
            type: "topic",
            parentCanonicalNodeId: canonUnitId,
            explanation: repairedTopicExplanation,
            sortOrder: ti + 1,
          })
          .onConflictDoUpdate({
            target: [canonicalNodesTable.id],
            set: {
              title: topic.title,
              normalizedTitle: normalizeText(topic.title),
              unitLibraryId,
              parentCanonicalNodeId: canonUnitId,
              explanation: repairedTopicExplanation,
              sortOrder: ti + 1,
              updatedAt: new Date(),
            },
          });

        await db.insert(nodesTable).values({
          id: topicId,
          configId,
          canonicalNodeId: canonTopicId,
          subjectId: subjectRow.id,
          unitLibraryId,
          title: topic.title,
          normalizedTitle: normalizeText(topic.title),
          type: "topic",
          parentId: unitId,
          explanation: repairedTopicExplanation,
          unitTopicId,
          sortOrder: ti + 1,
        });
        topicCount++;

        for (let si = 0; si < topic.subtopics.length; si++) {
          const subtopicTitle = topic.subtopics[si];
          const canonSubtopicId = canonicalSubtopicId(subjectRow.id, unit.title, topic.title, subtopicTitle);
          const subtopicId = scopedNodeId(configId, canonSubtopicId);

          await db.insert(nodesTable).values({
            id: subtopicId,
            configId,
            canonicalNodeId: canonSubtopicId,
            subjectId: subjectRow.id,
            unitLibraryId,
            title: subtopicTitle,
            normalizedTitle: normalizeText(subtopicTitle),
            type: "subtopic",
            parentId: topicId,
            sortOrder: si + 1,
          });

          setProgress(configId, {
            progress: topicCount + subtopicCount,
            currentStep: `Writing explanation: ${subtopicTitle}`,
          });

          let explanation = "";
          try {
            const reusedExplanation = reusableExplanationMap.get(
              explanationKey(unit.title, topic.title, subtopicTitle)
            );
            explanation = reusedExplanation
              ? reusedExplanation
              : await generateSubtopicExplanation(
                  config.subject,
                  unit.title,
                  topic.title,
                  subtopicTitle,
                );
          } catch (err) {
            logger.error({ err, subtopicTitle }, "Failed to generate explanation for subtopic");
            explanation = "Content will be updated soon.";
          }
          const repairedSubtopicExplanation = repairBrokenFormulaBullets(explanation);

          const unitSubtopicId = canonSubtopicId;

          await db
            .insert(canonicalNodesTable)
            .values({
              id: canonSubtopicId,
              subjectId: subjectRow.id,
              unitLibraryId,
              title: subtopicTitle,
              normalizedTitle: normalizeText(subtopicTitle),
              type: "subtopic",
              parentCanonicalNodeId: canonTopicId,
              explanation: repairedSubtopicExplanation,
              sortOrder: si + 1,
            })
            .onConflictDoUpdate({
              target: [canonicalNodesTable.id],
              set: {
                title: subtopicTitle,
                normalizedTitle: normalizeText(subtopicTitle),
                unitLibraryId,
                parentCanonicalNodeId: canonTopicId,
                explanation: repairedSubtopicExplanation,
                sortOrder: si + 1,
                updatedAt: new Date(),
              },
            });

          await db
            .update(nodesTable)
            .set({
              unitTopicId,
              unitSubtopicId,
              updatedAt: new Date(),
            })
            .where(eq(nodesTable.id, subtopicId));

          catalog.push({
            nodeId: subtopicId,
            unitSubtopicId,
            unitTitle: unit.title,
            topicTitle: topic.title,
            subtopicTitle,
            normUnit: normalizeText(unit.title),
            normTopic: normalizeText(topic.title),
            normSubtopic: normalizeText(subtopicTitle),
          });

          subtopicCount++;
        }
      }
    }

    setProgress(configId, {
      progress: topicCount + subtopicCount,
      currentStep: `Generating ${targets.totalQuestions}-question bank...`,
    });

    const questionBank = await buildQuestionBank(
      config.subject,
      catalog,
      paperText,
      targets.totalQuestions,
      targets.totalStars
    );

    let insertedQuestions = 0;
    for (const q of questionBank) {
      const mapped = pickBestSubtopicMatch(q, catalog);
      if (!mapped) continue;

      await db.insert(configQuestionsTable).values({
        configId,
        unitSubtopicId: mapped.unitSubtopicId,
        markType: q.markType,
        question: q.question,
        answer: repairBrokenFormulaBullets(q.answer),
        isStarred: q.isStarred,
        starSource: q.isStarred ? "auto" : "none",
      });

      insertedQuestions++;
      setProgress(configId, {
        progress: topicCount + subtopicCount + insertedQuestions,
        currentStep: `Building question bank (${insertedQuestions}/${targets.totalQuestions})`
      });
    }

    setProgress(configId, {
      status: "complete",
      progress: topicCount + subtopicCount + insertedQuestions,
      total: totalSteps,
      currentStep: "Generation complete!",
    });

    logger.info({ configId, subtopicCount: totalSubtopics, questionCount: insertedQuestions }, "Generation complete");
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, configId }, "Generation failed");
    setProgress(configId, {
      status: "error",
      currentStep: "Generation failed",
      error: errorMsg,
    });
  }
}


