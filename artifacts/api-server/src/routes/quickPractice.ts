import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAdmin } from "../middleware/adminAuth";
import { askAI } from "../lib/ai";
import { parseFirstModelJsonObject } from "../lib/parseModelJson";
import { extractPaperText } from "../lib/generator";

/**
 * Quick Practice: a standalone "upload a paper, get N new practice questions
 * with answers back as flat JSON" endpoint. Unlike the main config/generation
 * pipeline, this does not touch the subject/unit/topic/subtopic taxonomy or
 * any config record — it is a self-contained, synchronous request/response
 * flow modeled on the exam_prep_ai MVP's /api/generate route:
 *   1. extract text from the uploaded paper(s)
 *   2. ask the model to analyze the paper's structure (subject, difficulty,
 *      question types, etc.)
 *   3. ask the model to generate exactly N new questions (with answers and
 *      explanations) using the original text + that analysis as context
 *   4. validate the shape and question count/IDs, retrying once if the
 *      model's output doesn't match
 *
 * Deliberately stateless: nothing is written to disk or to the database.
 * Vercel serverless instances don't share local disk or memory across
 * requests (see the cheap-import-progress fix), so persisting to a local
 * JSON file the way the MVP does would reintroduce that same class of bug.
 * The generated set is returned directly in the response; if a "save and
 * reload later" capability is wanted, that should be backed by a real
 * Postgres table (same pattern as cheap_import_progress), not local files.
 */

const router: IRouter = Router();

// Duplicated intentionally (not imported from routes/generation.ts) to keep
// this feature standalone/independent, matching how each route file in this
// codebase already defines its own small local helpers.
function normalizeUploadedObjectPath(rawPath: string): string {
  let path = rawPath.trim();
  if (path.startsWith("objects/")) {
    path = `/${path}`;
  }
  path = path.replace(/^\/objects\/+objects\//, "/objects/");
  path = path.replace(/^\/supabase\/+supabase\//, "/supabase/");
  return path;
}

function isSupportedStoragePath(path: string): boolean {
  return path.startsWith("/objects/") || path.startsWith("/supabase/");
}

const DEFAULT_QUESTION_COUNT = 30;
const MIN_QUESTION_COUNT = 1;
const MAX_QUESTION_COUNT = 50;

const QuickPracticeGenerateBody = z.object({
  paperFileUrls: z.array(z.string()).min(1, "At least one uploaded paper is required"),
  questionCount: z.number().int().min(MIN_QUESTION_COUNT).max(MAX_QUESTION_COUNT).optional(),
});

const QuickPracticeSectionSchema = z.object({
  name: z.string().default(""),
  questionStyle: z.string().default(""),
  marks: z.number().nullable().optional(),
});

const QuickPracticeAnalysisSchema = z.object({
  subject: z.string().nullable().optional(),
  examType: z.string().nullable().optional(),
  academicLevel: z.string().nullable().optional(),
  semester: z.string().nullable().optional(),
  totalMarks: z.number().nullable().optional(),
  duration: z.string().nullable().optional(),
  difficulty: z.string().nullable().optional(),
  sections: z.array(QuickPracticeSectionSchema).default([]),
  topics: z.array(z.string()).default([]),
  questionTypes: z.array(z.string()).default([]),
  shortLongDistribution: z.string().nullable().optional(),
  expectedAnswerDepth: z.string().nullable().optional(),
  styleNotes: z.array(z.string()).default([]),
});
type QuickPracticeAnalysis = z.infer<typeof QuickPracticeAnalysisSchema>;

const QuickPracticeQuestionSchema = z.object({
  id: z.number().int(),
  topic: z.string().default(""),
  type: z.string().default(""),
  difficulty: z.string().default(""),
  question: z.string(),
  options: z.array(z.string()).default([]),
  answer: z.string(),
  explanation: z.string().default(""),
});

const QuickPracticeGeneratedSchema = z.object({
  paper: z.object({
    subject: z.string().default(""),
    difficulty: z.string().default(""),
    source: z.string().default("Uploaded Question Paper"),
    totalQuestions: z.number().int(),
  }),
  questions: z.array(QuickPracticeQuestionSchema),
});
type QuickPracticeGenerated = z.infer<typeof QuickPracticeGeneratedSchema>;

function buildAnalyzePrompt(paperText: string): string {
  return `Analyze the question paper provided below. Use ONLY evidence available in the uploaded question paper. If metadata is unavailable, use null instead of inventing it.

Determine the subject, academic level, semester/class, examination type, total marks, duration, sections, major concepts, question formats, approximate difficulty, short/long question distribution, expected answer depth, and recurring examination patterns.

Return STRICT VALID JSON only, without markdown or commentary, using exactly these keys:
{
  "subject": null,
  "examType": null,
  "academicLevel": null,
  "semester": null,
  "totalMarks": null,
  "duration": null,
  "difficulty": null,
  "sections": [{"name": "", "questionStyle": "", "marks": null}],
  "topics": [],
  "questionTypes": [],
  "shortLongDistribution": null,
  "expectedAnswerDepth": null,
  "styleNotes": []
}

QUESTION PAPER:
${paperText}`;
}

function buildGeneratePrompt(paperText: string, analysisJson: string, questionCount: number): string {
  return `You are an expert examination question generator and student practice assistant.

Generate EXACTLY ${questionCount} NEW practice questions with answers using the uploaded paper as the ONLY academic reference. First study its concepts, formats, difficulty, answer depth, and distribution. Maintain approximately the same level and style. Do not copy any question word-for-word, and do not merely replace one noun or number. Do not introduce advanced concepts absent from the paper. Every question needs a correct answer and short explanation. For essays, dialogues, prompts, coding, mathematics, or descriptive questions, provide a suitable model answer or solution. Use a reasonable distribution of the source question types. Number questions exactly 1 through ${questionCount}.

Return STRICT JSON only, with no markdown, code fences, or commentary, using exactly this structure:
{
  "paper": {"subject": "", "difficulty": "", "source": "Uploaded Question Paper", "totalQuestions": ${questionCount}},
  "questions": [{"id": 1, "topic": "", "type": "", "difficulty": "", "question": "", "options": [], "answer": "", "explanation": ""}]
}

PAPER ANALYSIS:
${analysisJson}

ORIGINAL QUESTION PAPER:
${paperText}`;
}

function validateQuestionSet(parsed: QuickPracticeGenerated, expectedCount: number): void {
  if (parsed.questions.length !== expectedCount) {
    throw new Error(`Expected exactly ${expectedCount} questions, got ${parsed.questions.length}`);
  }
  const ids = parsed.questions.map((q) => q.id);
  const expectedIds = Array.from({ length: expectedCount }, (_, i) => i + 1);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
    throw new Error(`Question IDs must be exactly 1 through ${expectedCount}, in order`);
  }
}

async function requestAnalysis(paperText: string): Promise<QuickPracticeAnalysis> {
  const raw = await askAI(
    "You are an expert examination-paper analyzer. Return strict JSON only, no markdown or commentary.",
    buildAnalyzePrompt(paperText),
    3000,
    { requireJson: true }
  );
  return QuickPracticeAnalysisSchema.parse(parseFirstModelJsonObject(raw));
}

async function requestGeneratedQuestions(
  paperText: string,
  analysisJson: string,
  questionCount: number,
  correctionNote?: string
): Promise<QuickPracticeGenerated> {
  let prompt = buildGeneratePrompt(paperText, analysisJson, questionCount);
  if (correctionNote) {
    prompt += `\n\n${correctionNote}`;
  }
  const maxTokens = Math.min(16000, 3000 + questionCount * 350);
  const raw = await askAI(
    "You are an expert examination question generator. Return strict JSON only.",
    prompt,
    maxTokens,
    { requireJson: true }
  );
  const parsed = QuickPracticeGeneratedSchema.parse(parseFirstModelJsonObject(raw));
  validateQuestionSet(parsed, questionCount);
  return parsed;
}

/**
 * POST /quick-practice/generate
 *
 * Body: { paperFileUrls: string[], questionCount?: number (1-50, default 30) }
 * paperFileUrls must already be uploaded via /storage/uploads/request-url,
 * same as the existing replica-paper upload flow.
 *
 * Response: { analysis, paper, questions } — nothing persisted server-side.
 */
router.post("/quick-practice/generate", requireAdmin, async (req, res) => {
  try {
    const body = QuickPracticeGenerateBody.parse(req.body);
    const questionCount = body.questionCount ?? DEFAULT_QUESTION_COUNT;

    const paperFileUrls = body.paperFileUrls.map((url) => normalizeUploadedObjectPath(url));
    for (const url of paperFileUrls) {
      if (!isSupportedStoragePath(url)) {
        res.status(400).json({ error: "paperFileUrls must start with /objects/ or /supabase/" });
        return;
      }
    }

    const paperText = await extractPaperText(paperFileUrls);
    if (!paperText.trim()) {
      res.status(400).json({ error: "No readable text could be extracted from the uploaded file(s)." });
      return;
    }

    const analysis = await requestAnalysis(paperText);
    const analysisJson = JSON.stringify(analysis);

    let generated: QuickPracticeGenerated;
    try {
      generated = await requestGeneratedQuestions(paperText, analysisJson, questionCount);
    } catch (firstErr) {
      req.log.warn({ err: firstErr }, "Quick practice generation failed validation; retrying once");
      generated = await requestGeneratedQuestions(
        paperText,
        analysisJson,
        questionCount,
        "Your previous response was invalid JSON, or did not match the required question count/ID sequence exactly. Return only corrected strict JSON matching the schema exactly."
      );
    }

    res.json({ analysis, ...generated });
  } catch (error) {
    req.log.error({ err: error }, "Quick practice generation failed");
    const detail = error instanceof Error ? error.message : "Unknown error";
    res.status(error instanceof z.ZodError ? 400 : 500).json({
      error: "Unable to generate practice questions from the uploaded file.",
      ...(process.env.NODE_ENV !== "production" ? { detail } : {}),
    });
  }
});

export default router;
