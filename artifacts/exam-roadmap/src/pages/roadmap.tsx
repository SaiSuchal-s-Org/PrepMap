import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Layers, BookOpen, FileText, MessageSquare,
  CheckCircle2, AlertCircle, ZoomIn, ZoomOut, X, List, Plus, Minus, Star, ChevronLeft, ChevronRight, Lightbulb, Info, PenLine, Pencil, Search
} from "lucide-react";
import {
  useGetAppMetadata,
  useGetConfigs,
  useGetConfigVersion,
  useGetLatestInteractionState,
  useGetCompletionState,
  useGetNodes,
  useGetQuestionBank,
  useGetTopicContentBundle,
  useUpdateSubtopicContent,
  useUpdateQuestionBankQuestion,
  useTrackEvent,
} from "@/api-client";
import { buildTree, type TreeNode } from "@/lib/utils";
import { getStoredUser } from "@/lib/auth";
import { parseStructuredExplanation, repairBrokenFormulaBullets, type StructuredExplanationParts } from "@/lib/text-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EXAM_TYPES, SEMESTERS, UNIVERSITIES } from "@/lib/constants";

const CLIENT_CACHE_BYPASS = String(import.meta.env.VITE_BYPASS_CLIENT_CACHE || "").trim().toLowerCase() === "true";

const NODE_COLORS = {
  unit: { bg: "bg-blue-500", border: "border-blue-400", light: "bg-blue-50 border-blue-200", text: "text-blue-700", line: "#3b82f6" },
  topic: { bg: "bg-violet-500", border: "border-violet-400", light: "bg-violet-50 border-violet-200", text: "text-violet-700", line: "#8b5cf6" },
  subtopic: { bg: "bg-emerald-500", border: "border-emerald-400", light: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", line: "#10b981" },
};

const NODE_W = 220;
const NODE_H = 64;
const NODE_W_TOPIC = 210;
const NODE_H_TOPIC = 58;
const NODE_W_SUBTOPIC = 190;
const NODE_H_SUBTOPIC = 52;
const V_GAP = 18;
const CANVAS_PAD = 48;
const TOPIC_GAP = 28;
const UNIT_GAP = 64;
const LAYOUT_W = 1400;
const QUESTION_BANK_LANE_H = 88;
const QUESTION_BANK_EVENT_PREFIX = "__qb__:";
const ZOOM_STEP = 1.1;
const MAX_AUTO_FOCUS_ZOOM = 1.1;
const COLLAPSED_GRID_VISIBLE_COLUMNS = 3.5;

function getSubtopicTrackSessionKey(configId: string, userId: string, subtopicId: string): string {
  return `tracked_subtopic_${configId}_${userId}_${subtopicId}`;
}

function estimateSubtopicWidth(title: string, maxWidth: number): number {
  // Heuristic width estimate so longer titles can grow and use lane space.
  const desired = 140 + Math.min(title.length, 90) * 6;
  return Math.max(NODE_W_SUBTOPIC, Math.min(maxWidth, desired));
}

type AnswerSegment =
  | { type: "text"; value: string }
  | { type: "code"; language: string; code: string };

type CodeStyle = "none" | "inline" | "block" | "both";

function LearningGoalBlock({ learningGoal }: { learningGoal?: string | null }) {
  const goal = String(learningGoal || "").trim();
  if (!goal) return null;

  return (
    <section className="rounded-xl border border-border bg-secondary/20 p-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="w-3.5 h-3.5 text-primary" />
          <p className="text-xs font-semibold uppercase tracking-wider ">Learning Goal</p>
        </div>
        <div className="text-sm text-foreground leading-relaxed">
          <AnswerRenderer answer={repairBrokenFormulaBullets(goal)} />
        </div>
      </div>
    </section>
  );
}

function PathNavBlock({
  prerequisiteTitles,
  nextRecommendedTitles,
  prerequisiteNodeIds,
  nextRecommendedNodeIds,
  isNodeCompleted,
  onNavigate,
}: {
  prerequisiteTitles?: string[] | null;
  nextRecommendedTitles?: string[] | null;
  prerequisiteNodeIds?: string[] | null;
  nextRecommendedNodeIds?: string[] | null;
  isNodeCompleted?: (nodeId: string) => boolean;
  onNavigate?: (nodeId: string) => void;
}) {
  const prereqs = Array.isArray(prerequisiteTitles)
    ? prerequisiteTitles.map((p) => String(p || "").trim()).filter(Boolean)
    : [];
  const nextItems = Array.isArray(nextRecommendedTitles)
    ? nextRecommendedTitles.map((p) => String(p || "").trim()).filter(Boolean)
    : [];
  if (prereqs.length === 0 && nextItems.length === 0) return null;
  const hasPrereq = prereqs.length > 0;
  const hasNext = nextItems.length > 0;

  return (
    <section className="grid grid-cols-2 items-start gap-2">
      <div className="min-w-0">
        {hasPrereq ? (
          <div className="flex flex-wrap justify-start gap-2">
            {prereqs.map((item) => (
              <Button
                key={item}
                type="button"
                data-nav-chip="v2"
                variant="outline"
                onClick={() => onNavigate?.(String(prerequisiteNodeIds?.[0] || ""))}
                disabled={!String(prerequisiteNodeIds?.[0] || "").trim()}
                title={String(prerequisiteNodeIds?.[0] || "").trim() ? `Open ${item}` : undefined}
                className="relative inline-flex h-9 max-w-full min-w-0 items-center rounded-full border border-blue-200 bg-white px-4 text-sm font-medium leading-5 antialiased text-slate-800 transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              >
                {isNodeCompleted?.(String(prerequisiteNodeIds?.[0] || "")) ? (
                  <span className="absolute -top-1 -right-1 rounded-full bg-white p-0.5 border border-green-200">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                  </span>
                ) : null}
                <ChevronLeft className="w-4 h-4 mr-2 shrink-0 text-primary/70" />
                <span className="min-w-0 truncate leading-5">{item}</span>
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="min-w-0">
        {hasNext ? (
          <div className="flex flex-wrap justify-end gap-2">
            {nextItems.map((item) => (
              <Button
                key={item}
                type="button"
                data-nav-chip="v2"
                variant="outline"
                onClick={() => onNavigate?.(String(nextRecommendedNodeIds?.[0] || ""))}
                disabled={!String(nextRecommendedNodeIds?.[0] || "").trim()}
                title={String(nextRecommendedNodeIds?.[0] || "").trim() ? `Open ${item}` : undefined}
                className="relative inline-flex h-9 max-w-full min-w-0 items-center rounded-full border border-blue-200 bg-white px-4 text-sm font-medium leading-5 antialiased text-slate-800 transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              >
                {isNodeCompleted?.(String(nextRecommendedNodeIds?.[0] || "")) ? (
                  <span className="absolute -top-1 -left-1 rounded-full bg-white p-0.5 border border-green-200">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                  </span>
                ) : null}
                <span className="min-w-0 truncate leading-5">{item}</span>
                <ChevronRight className="w-4 h-4 ml-2 shrink-0 text-primary/70" />
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ExampleBlock({ text }: { text?: string | null }) {
  const value = String(text || "").trim();
  if (!value) return null;

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-amber-700" />
        <h3 className="text-sm font-bold text-amber-900 uppercase tracking-wider">Quick Example</h3>
      </div>
      <div className="text-sm text-amber-950 leading-relaxed">
        <AnswerRenderer answer={repairBrokenFormulaBullets(value)} />
      </div>
    </section>
  );
}

function SupportNoteBlock({ text }: { text?: string | null }) {
  const value = String(text || "").trim();
  if (!value) return null;

  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Info className="w-4 h-4 text-sky-700" />
        <h3 className="text-sm font-bold text-sky-900 uppercase tracking-wider">Helpful Note</h3>
      </div>
      <div className="text-sm text-sky-950 leading-relaxed">
        <AnswerRenderer answer={repairBrokenFormulaBullets(value)} />
      </div>
    </section>
  );
}

function parseAnswerSegments(answer: string): AnswerSegment[] {
  const src = String(answer || "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n");
  const regex = /```[ \t]*([a-zA-Z0-9_-]+)?[ \t]*\n([\s\S]*?)```/g;
  const segments: AnswerSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(src)) !== null) {
    const before = src.slice(lastIndex, match.index);
    if (before.trim()) segments.push({ type: "text", value: before.trim() });
    segments.push({
      type: "code",
      language: (match[1] || "text").toLowerCase(),
      code: String(match[2] || "")
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\r\n/g, "\n"),
    });
    lastIndex = regex.lastIndex;
  }

  const tail = src.slice(lastIndex);
  if (tail.trim()) segments.push({ type: "text", value: tail.trim() });

  if (segments.length === 0) {
    return [{ type: "text", value: src }];
  }
  return segments;
}

function hasCodeBlock(answer: string): boolean {
  return /```[\s\S]*?```/.test(String(answer || ""));
}

function hasInlineCode(answer: string): boolean {
  return /`[^`\n]+`/.test(String(answer || ""));
}

function detectCodeStyle(answer: string): CodeStyle {
  const block = hasCodeBlock(answer);
  const inline = hasInlineCode(answer);
  if (block && inline) return "both";
  if (block) return "block";
  if (inline) return "inline";
  return "none";
}

function codeStyleBadgeText(style: CodeStyle): string | null {
  if (style === "block") return "Stand-alone Example";
  if (style === "inline") return "Inline Example";
  if (style === "both") return "Inline + Stand-alone";
  return null;
}

function isLikelyQuestionText(value: string): boolean {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return false;

  const informationalPatterns = [
    /^part\s*[-?]?\s*[abc]\b/i,
    /^answer\b/i,
    /^course outcomes?\b/i,
    /^knowledge level\b/i,
    /^time\b/i,
    /^marks?\b/i,
    /^q\.?\s*no\b/i,
    /^or$/i,
    /^k[1-6]\s*[-?]?\s*(remember|understand|apply|analy[sz]e|evaluate|create)\b/i,
  ];

  if (informationalPatterns.some((pattern) => pattern.test(text))) {
    return false;
  }

  // Common Bloom's-level listing accidentally extracted as "questions".
  if (
    /k1\s*[-?]?\s*remember/i.test(text) &&
    /k2\s*[-?]?\s*understand/i.test(text)
  ) {
    return false;
  }

  if (/\?$/.test(text)) return true;

  return /^(what|why|how|when|which|who|whom|whose|define|explain|list|state|create|write|describe|compare|differentiate|demonstrate|show|give|mention|outline|derive|implement)\b/i.test(
    text
  );
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightCode(code: string, language: string): string {
  let html = escapeHtml(code);
  const protectedTokens = new Map<string, string>();
  const tokenChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const toToken = (idx: number) => {
    let n = idx;
    let out = "";
    do {
      out = tokenChars[n % tokenChars.length] + out;
      n = Math.floor(n / tokenChars.length) - 1;
    } while (n >= 0);
    return `?${out}?`;
  };
  let tokenIndex = 0;

  // Protect comments first so inner tokens are not re-highlighted.
  html = html.replace(/(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/g, (m) => {
    const token = toToken(tokenIndex++);
    protectedTokens.set(token, `<span class="text-slate-400">${m}</span>`);
    return token;
  });

  // Protect strings next for the same reason.
  html = html.replace(/("[^"\n]*"|'[^'\n]*'|`[^`\n]*`)/g, (m) => {
    const token = toToken(tokenIndex++);
    protectedTokens.set(token, `<span class="text-emerald-300">${m}</span>`);
    return token;
  });

  if (["js", "javascript", "ts", "typescript"].includes(language)) {
    html = html.replace(
      /\b(const|let|var|function|return|if|else|for|while|new|class|extends|import|from|export|async|await|try|catch|throw)\b/g,
      `<span class="text-sky-300">$1</span>`
    );
  } else if (["py", "python"].includes(language)) {
    html = html.replace(
      /\b(def|return|if|elif|else|for|while|import|from|as|class|try|except|finally|raise|with|lambda|pass)\b/g,
      `<span class="text-sky-300">$1</span>`
    );
  } else if (["sql"].includes(language)) {
    html = html.replace(
      /\b(SELECT|FROM|WHERE|GROUP|BY|ORDER|INSERT|INTO|UPDATE|DELETE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|AS|LIMIT|CREATE|TABLE)\b/gi,
      `<span class="text-sky-300">$1</span>`
    );
  }

  // Restore protected comments/strings after all other highlighting.
  for (const [token, value] of protectedTokens.entries()) {
    html = html.split(token).join(value);
  }
  return html;
}

function renderInlineCodeText(raw: string) {
  const parts = raw.split(/(`[^`\n]+`)/g);
  const out: React.ReactNode[] = [];
  let keyIndex = 0;

  for (const part of parts) {
    if (!part) continue;
    if (/^`[^`\n]+`$/.test(part)) {
      const code = part.slice(1, -1);
      out.push(
        <code
          key={`ic-${keyIndex++}`}
          className="rounded bg-slate-200/70 text-slate-900 px-1 py-0.5 text-[0.9em] font-mono"
        >
          {code}
        </code>
      );
      continue;
    }

    const boldSegments = part.split(/(\*\*[^*\n][\s\S]*?\*\*)/g);
    for (const seg of boldSegments) {
      if (!seg) continue;
      if (/^\*\*[^*\n][\s\S]*\*\*$/.test(seg)) {
        out.push(<strong key={`bd-${keyIndex++}`}>{seg.slice(2, -2)}</strong>);
      } else {
        out.push(<span key={`tx-${keyIndex++}`}>{seg}</span>);
      }
    }
  }

  return out;
}

function buildStructuredExplanationText(parts: StructuredExplanationParts): string {
  const sections: string[] = [];
  if (String(parts.learningGoal || "").trim()) {
    sections.push(`Learning Goal:\n${String(parts.learningGoal).trim()}`);
  }
  if (String(parts.coreExplanation || "").trim()) {
    sections.push(`Core Idea:\n${String(parts.coreExplanation).trim()}`);
  }
  if (String(parts.exampleBlock || "").trim()) {
    sections.push(`Quick Example:\n${String(parts.exampleBlock).trim()}`);
  }
  if (String(parts.supportNote || "").trim()) {
    sections.push(`Helpful Note:\n${String(parts.supportNote).trim()}`);
  }
  return sections.join("\n\n").trim();
}

function AnswerRenderer({ answer }: { answer: string }) {
  const segments = parseAnswerSegments(repairBrokenFormulaBullets(answer));
  return (
    <div className="space-y-3">
      {segments.map((seg, idx) => {
        if (seg.type === "text") {
          const raw = seg.value.trim();
          const hasLineBreaks = /\r?\n/.test(raw);
          const sentences = raw
            .split(/(?<=[.!?])\s+/)
            .map((s) => s.trim())
            .filter(Boolean);
          const numberedItemPattern = /(?:^|\s)(?:\d+[.)]|[ivxlcdm]+[.)])\s+/im;
          const bulletMarkerPattern = /(?:^|\n)\s*[-*?]\s+/m;
          const listCuePattern = /\b(steps?|advantages?|disadvantages?|differences?|types?|uses?|key points?|points?)\b/i;
          const listConnectorPattern = /\b(first|second|third|next|finally)\b/i;
          const explicitListSignals =
            numberedItemPattern.test(raw) ||
            bulletMarkerPattern.test(raw) ||
            (listCuePattern.test(raw) && (listConnectorPattern.test(raw) || raw.includes(":")));
          const shouldAutoBullet = !hasLineBreaks && explicitListSignals && sentences.length >= 2;
          const shouldAutoParagraph = !hasLineBreaks && !explicitListSignals && sentences.length >= 2 && raw.length > 80;

          if (shouldAutoBullet) {
            return (
              <ul key={`txt-${idx}`} className="space-y-1.5 pl-5 list-disc text-sm text-foreground/85 leading-relaxed">
                {sentences.map((line, lineIdx) => (
                  <li key={`txt-${idx}-${lineIdx}`}>{renderInlineCodeText(line)}</li>
                ))}
              </ul>
            );
          }

          if (shouldAutoParagraph) {
            const paragraphs: string[] = [];
            for (let i = 0; i < sentences.length; i += 2) {
              paragraphs.push(sentences.slice(i, i + 2).join(" "));
            }
            return (
              <div key={`txt-${idx}`} className="space-y-2">
                {paragraphs.map((p, pIdx) => (
                  <p key={`txt-${idx}-${pIdx}`} className="text-sm text-foreground/85 leading-relaxed">
                    {renderInlineCodeText(p)}
                  </p>
                ))}
              </div>
            );
          }

          return (
            <div
              key={`txt-${idx}`}
              className="text-sm text-foreground/85 whitespace-pre-line leading-relaxed"
            >
              {renderInlineCodeText(raw)}
            </div>
          );
        }

        const languageLabel = (seg.language || "code").toUpperCase();
        return (
          <div key={`code-${idx}`} className="rounded-lg overflow-hidden border border-slate-700/70 bg-slate-950">
            <div className="px-3 py-1.5 text-[11px] font-semibold tracking-wide text-slate-300 bg-slate-900 border-b border-slate-700/70">
              Stand-alone Example ? {languageLabel}
            </div>
            <pre className="p-4 overflow-x-auto text-[13px] leading-6 font-mono text-slate-100">
              <code dangerouslySetInnerHTML={{ __html: highlightCode(seg.code, seg.language) }} />
            </pre>
          </div>
        );
      })}
    </div>
  );
}

type LayoutNode = TreeNode & {
  x: number;
  y: number;
  w: number;
  h: number;
  layoutChildren: LayoutNode[];
};

function computeLayout(units: TreeNode[]): { laid: LayoutNode[]; totalHeight: number; totalWidth: number } {
  if (units.length === 0) return { laid: [], totalHeight: 0, totalWidth: LAYOUT_W };

  // Collapsed-all mode: render units as a horizontal grid with 4 rows per column,
  // so we use the available right-side space better before switching back to tree layout.
  const isCollapsedUnitsOnly = units.every((u) => u.children.filter((c) => c.type === "topic").length === 0);
  if (isCollapsedUnitsOnly) {
    const rowsPerColumn = 4;
    const startX = CANVAS_PAD + 24;
    const startY = CANVAS_PAD + QUESTION_BANK_LANE_H;
    const colGap = 56;
    const rowGap = UNIT_GAP;
    const unitW = NODE_W + 20;
    const unitH = NODE_H;

    const laidUnits: LayoutNode[] = units.map((unit, idx) => {
      const col = Math.floor(idx / rowsPerColumn);
      const row = idx % rowsPerColumn;
      return {
        ...unit,
        x: startX + col * (unitW + colGap),
        y: startY + row * (unitH + rowGap),
        w: unitW,
        h: unitH,
        layoutChildren: [],
        children: unit.children,
      };
    });

    const columns = Math.max(1, Math.ceil(units.length / rowsPerColumn));
    const totalWidth = Math.max(LAYOUT_W, startX + columns * unitW + (columns - 1) * colGap + CANVAS_PAD);
    const visibleRows = Math.min(rowsPerColumn, units.length);
    const totalHeight = startY + visibleRows * unitH + (visibleRows - 1) * rowGap + CANVAS_PAD;

    return { laid: laidUnits, totalHeight, totalWidth };
  }

  const innerWidth = LAYOUT_W - CANVAS_PAD * 2;
  const unitLaneWidth = innerWidth * 0.3;
  const topicLaneWidth = innerWidth * 0.3;
  const subtopicLaneWidth = innerWidth - unitLaneWidth - topicLaneWidth; // 40%
  const unitX = CANVAS_PAD + 24;
  const topicX = CANVAS_PAD + unitLaneWidth + 24;
  const subtopicX = CANVAS_PAD + unitLaneWidth + topicLaneWidth + 24;
  const subtopicMaxW = subtopicLaneWidth - 48;

  const laidUnits: LayoutNode[] = [];
  let cursorY = CANVAS_PAD + QUESTION_BANK_LANE_H;
  let maxRight = 0;

  for (const unit of units) {
    const laidTopics: LayoutNode[] = [];
    const unitTopics = unit.children.filter((c) => c.type === "topic");

    const unitStartY = cursorY;

    if (unitTopics.length === 0) {
      laidUnits.push({
        ...unit,
        x: unitX,
        y: cursorY,
        w: NODE_W,
        h: NODE_H,
        layoutChildren: [],
        children: unit.children,
      });
      cursorY += NODE_H + UNIT_GAP;
      maxRight = Math.max(maxRight, unitX + NODE_W);
      continue;
    }

    for (const topic of unitTopics) {
      const subs = topic.children.filter((c) => c.type === "subtopic");
      const subBlockHeight =
        subs.length > 0
          ? subs.length * NODE_H_SUBTOPIC + (subs.length - 1) * V_GAP
          : NODE_H_TOPIC;

      const topicY = cursorY + (subBlockHeight - NODE_H_TOPIC) / 2;
      let subCursorY = cursorY;
      const laidSubs: LayoutNode[] = subs.map((sub) => {
        const subW = estimateSubtopicWidth(sub.title, subtopicMaxW);
        const laidSub: LayoutNode = {
          ...sub,
          x: subtopicX,
          y: subCursorY,
          w: subW,
          h: NODE_H_SUBTOPIC,
          layoutChildren: [],
          children: sub.children,
        };
        subCursorY += NODE_H_SUBTOPIC + V_GAP;
        return laidSub;
      });

      laidTopics.push({
        ...topic,
        x: topicX,
        y: topicY,
        w: NODE_W_TOPIC,
        h: NODE_H_TOPIC,
        layoutChildren: laidSubs,
        children: topic.children,
      });

      cursorY += subBlockHeight + TOPIC_GAP;
      maxRight = Math.max(maxRight, subtopicX + NODE_W_SUBTOPIC, topicX + NODE_W_TOPIC);
    }

    cursorY -= TOPIC_GAP;
    const unitBlockHeight = cursorY - unitStartY;
    const unitY = unitStartY + (unitBlockHeight - NODE_H) / 2;

    laidUnits.push({
      ...unit,
      x: unitX,
      y: unitY,
      w: NODE_W,
      h: NODE_H,
      layoutChildren: laidTopics,
      children: unit.children,
    });

    cursorY += UNIT_GAP;
    maxRight = Math.max(maxRight, unitX + NODE_W);
  }

  return {
    laid: laidUnits,
    totalHeight: cursorY + CANVAS_PAD,
    totalWidth: Math.max(LAYOUT_W, maxRight + CANVAS_PAD),
  };
}

function flattenLayout(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  for (const n of nodes) {
    result.push(n);
    result.push(...flattenLayout(n.layoutChildren));
  }
  return result;
}

function getLines(nodes: LayoutNode[]): { x1: number; y1: number; x2: number; y2: number; color: string }[] {
  const lines: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
  for (const n of nodes) {
    for (const child of n.layoutChildren) {
      lines.push({
        x1: n.x + n.w,
        y1: n.y + n.h / 2,
        x2: child.x,
        y2: child.y + child.h / 2,
        color: NODE_COLORS[child.type as keyof typeof NODE_COLORS]?.line || "#94a3b8",
      });
    }
    lines.push(...getLines(n.layoutChildren));
  }
  return lines;
}

function pruneTreeForCollapsedTopics(
  nodes: TreeNode[],
  collapsedTopicIds: Set<string>,
  collapsedUnitIds: Set<string>,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.type === "unit" && collapsedUnitIds.has(node.id)) {
      return { ...node, children: [] };
    }
    if (node.type === "topic" && collapsedTopicIds.has(node.id)) {
      return { ...node, children: [] };
    }
    if (node.children.length === 0) return node;
    return { ...node, children: pruneTreeForCollapsedTopics(node.children, collapsedTopicIds, collapsedUnitIds) };
  });
}

export default function Roadmap() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const searchParams = new URLSearchParams(window.location.search);
  const configId = searchParams.get("configId");
  const subject = searchParams.get("subject") || "Roadmap";
  const examParam = searchParams.get("exam") || "";
  const returnToParam = (searchParams.get("returnTo") || "").trim();
  const backPath = returnToParam || "/home";
  const { data: metadata } = useGetAppMetadata({
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const { data: configs, isLoading: isConfigsLoading } = useGetConfigs(
    {},
    {
      query: {
        queryKey: ["configs", "roadmap", configId],
        enabled: !!configId,
        staleTime: CLIENT_CACHE_BYPASS ? 0 : 5 * 60 * 1000,
        gcTime: CLIENT_CACHE_BYPASS ? 0 : 5 * 60 * 1000,
        refetchOnWindowFocus: CLIENT_CACHE_BYPASS ? true : false,
        refetchOnMount: CLIENT_CACHE_BYPASS ? "always" : true,
      },
    }
  );
  const examTypes = metadata?.examTypes?.length ? metadata.examTypes : EXAM_TYPES;
  const universities = metadata?.universities?.length ? metadata.universities : UNIVERSITIES;
  const semesters = metadata?.semesters?.length ? metadata.semesters : SEMESTERS;
  const examLabel = examTypes.find(e => e.id === examParam)?.name || examParam;
  const activeConfig = useMemo(
    () => (configs ?? []).find((c) => c.id === configId),
    [configs, configId]
  );
  const isConfigReady = !!configId && !!activeConfig;
  const universityLabel = activeConfig
    ? (universities.find((u) => u.id === activeConfig.universityId)?.name ?? activeConfig.universityId)
    : "";
  const semesterLabel = activeConfig
    ? (semesters.find((s) => s.id === activeConfig.year)?.name ?? activeConfig.year)
    : "";
  const branchLabel = activeConfig?.branch ?? "";
  const batchLabel = activeConfig ? `Batch ${String((activeConfig as any)?.batch || "").trim() || "2025"}` : "";
  const subtitleMeta = [universityLabel, branchLabel, semesterLabel, examLabel, batchLabel].filter(Boolean).join(" | ");

  const { data: nodes, isLoading, isError } = useGetNodes(
    { configId: configId! },
    {
      query: {
        queryKey: ["nodes", "roadmap", configId],
        enabled: isConfigReady,
        staleTime: CLIENT_CACHE_BYPASS ? 0 : 6 * 60 * 60 * 1000,
        gcTime: CLIENT_CACHE_BYPASS ? 0 : 6 * 60 * 60 * 1000,
        refetchOnWindowFocus: CLIENT_CACHE_BYPASS ? true : false,
        refetchOnMount: CLIENT_CACHE_BYPASS ? "always" : true,
      },
    }
  );
  const { data: configVersion } = useGetConfigVersion(isConfigReady ? configId : null, {
    enabled: isConfigReady,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });
  const lastConfigVersionRef = useRef<string | null>(null);
  useEffect(() => {
    const parts = [
      String(configVersion?.configUpdatedAt || "").trim(),
      String(configVersion?.nodesUpdatedAt || "").trim(),
      String(configVersion?.questionBankUpdatedAt || "").trim(),
    ];
    const next = parts.join("|");
    if (!next.replace(/\|/g, "")) return;
    if (lastConfigVersionRef.current == null) {
      lastConfigVersionRef.current = next;
      return;
    }
    if (lastConfigVersionRef.current !== next) {
      lastConfigVersionRef.current = next;
      void queryClient.invalidateQueries({ queryKey: ["nodes", "roadmap", configId] });
      void queryClient.invalidateQueries({ queryKey: ["topic-content-bundle"] });
      void queryClient.invalidateQueries({ queryKey: ["config-question-bank", configId] });
    }
  }, [
    configId,
    configVersion?.configUpdatedAt,
    configVersion?.nodesUpdatedAt,
    configVersion?.questionBankUpdatedAt,
    queryClient,
  ]);

  const tree = useMemo(() => (nodes ? buildTree(nodes) : []), [nodes]);
  const [collapsedTopicIds, setCollapsedTopicIds] = useState<Set<string>>(new Set());
  const [collapsedUnitIds, setCollapsedUnitIds] = useState<Set<string>>(new Set());
  const allTopicIds = useMemo(() => {
    if (!nodes) return [] as string[];
    return nodes.filter((n) => n.type === "topic").map((n) => n.id);
  }, [nodes]);
  const allUnitIds = useMemo(() => {
    if (!nodes) return [] as string[];
    return nodes.filter((n) => n.type === "unit").map((n) => n.id);
  }, [nodes]);
  const topicChildCountById = useMemo(() => {
    const map = new Map<string, number>();
    if (!nodes) return map;
    const subtopicCounts = new Map<string, number>();
    for (const n of nodes) {
      if (n.type === "subtopic" && n.parentId) {
        subtopicCounts.set(n.parentId, (subtopicCounts.get(n.parentId) ?? 0) + 1);
      }
    }
    for (const n of nodes) {
      if (n.type === "topic") {
        map.set(n.id, subtopicCounts.get(n.id) ?? 0);
      }
    }
    return map;
  }, [nodes]);
  const unitChildCountById = useMemo(() => {
    const map = new Map<string, number>();
    if (!nodes) return map;
    const topicCounts = new Map<string, number>();
    for (const n of nodes) {
      if (n.type === "topic" && n.parentId) {
        topicCounts.set(n.parentId, (topicCounts.get(n.parentId) ?? 0) + 1);
      }
    }
    for (const n of nodes) {
      if (n.type === "unit") {
        map.set(n.id, topicCounts.get(n.id) ?? 0);
      }
    }
    return map;
  }, [nodes]);
  const mapTree = useMemo(
    () => pruneTreeForCollapsedTopics(tree, collapsedTopicIds, collapsedUnitIds),
    [tree, collapsedTopicIds, collapsedUnitIds]
  );
  const unitNumberById = useMemo(() => {
    const map = new Map<string, number>();
    tree.forEach((unit, idx) => map.set(unit.id, idx + 1));
    return map;
  }, [tree]);
  const firstTopicByUnitId = useMemo(() => {
    const map = new Map<string, string>();
    for (const unit of tree) {
      const firstTopic = unit.children.find((child) => child.type === "topic");
      if (firstTopic) map.set(unit.id, firstTopic.id);
    }
    return map;
  }, [tree]);

  const { laid, totalHeight, totalWidth } = useMemo(() => computeLayout(mapTree), [mapTree]);
  const allNodes = useMemo(() => flattenLayout(laid), [laid]);
  const lines = useMemo(() => getLines(laid), [laid]);

  const canvasW = useMemo(() => {
    const maxRight = allNodes.reduce((m, n) => Math.max(m, n.x + n.w), 0);
    return Math.max(totalWidth, maxRight + CANVAS_PAD);
  }, [allNodes, totalWidth]);
  const canvasH = Math.max(totalHeight + CANVAS_PAD * 2, 220);

  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isPinching, setIsPinching] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const pinchStart = useRef({ distance: 0, zoom: 1 });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [questionBankOpen, setQuestionBankOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "map">("map");
  const viewer = getStoredUser();
  const isStudentViewer = !!viewer && (viewer.role === "student" || viewer.role === "super_student");
  const { data: latestInteractionState, isLoading: isLatestInteractionLoading } = useGetLatestInteractionState(
    isStudentViewer && isConfigReady ? configId : null
  );
  const { data: completionState } = useGetCompletionState(
    isStudentViewer && isConfigReady ? configId : null
  );
  const [expandedListUnitIds, setExpandedListUnitIds] = useState<Set<string>>(new Set());
  const [expandedListTopicIds, setExpandedListTopicIds] = useState<Set<string>>(new Set());
  const [expandedMobileUnitIds, setExpandedMobileUnitIds] = useState<Set<string>>(new Set());
  const [expandedMobileTopicIds, setExpandedMobileTopicIds] = useState<Set<string>>(new Set());
  const [bootStage, setBootStage] = useState<"idle" | "collapsing" | "resuming" | "camera" | "done">("idle");
  const [bootTargetNodeId, setBootTargetNodeId] = useState<string | null>(null);
  const [bootFocusRootId, setBootFocusRootId] = useState<string | null>(null);
  const [completionVersion, setCompletionVersion] = useState(0);
  const pendingStructureCameraRef = useRef(false);
  const pendingTopicFocusRef = useRef<string | null>(null);
  const instantCameraForLayoutSwitchRef = useRef(false);
  const prevAllUnitsCollapsedRef = useRef<boolean | null>(null);
  const panAnimRafRef = useRef<number | null>(null);
  const bootCameraStartedRef = useRef(false);
  const bootCameraRaf1Ref = useRef<number | null>(null);
  const bootCameraRaf2Ref = useRef<number | null>(null);
  const bootCameraTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDesktopMapView = viewMode === "map" && !isMobileViewport;
  const globalSearchRef = useRef<HTMLDivElement>(null);

  const clearBootCameraSequence = useCallback(() => {
    if (bootCameraRaf1Ref.current) {
      window.cancelAnimationFrame(bootCameraRaf1Ref.current);
      bootCameraRaf1Ref.current = null;
    }
    if (bootCameraRaf2Ref.current) {
      window.cancelAnimationFrame(bootCameraRaf2Ref.current);
      bootCameraRaf2Ref.current = null;
    }
    if (bootCameraTimerRef.current) {
      clearTimeout(bootCameraTimerRef.current);
      bootCameraTimerRef.current = null;
    }
  }, []);

  const nodeById = useMemo(() => {
    const map = new Map<string, { id: string; parentId: string | null; type: "unit" | "topic" | "subtopic" }>();
    for (const n of nodes ?? []) {
      map.set(n.id, { id: n.id, parentId: n.parentId ?? null, type: n.type });
    }
    return map;
  }, [nodes]);
  const nodeSearchIndex = useMemo(() => {
    const map = new Map<string, { id: string; title: string; parentId: string | null; type: "unit" | "topic" | "subtopic" }>();
    for (const n of nodes ?? []) {
      map.set(n.id, {
        id: n.id,
        title: String(n.title || "").trim(),
        parentId: n.parentId ?? null,
        type: n.type as "unit" | "topic" | "subtopic",
      });
    }
    return map;
  }, [nodes]);
  const searchableNodes = useMemo(() => {
    const items: Array<{
      id: string;
      type: "unit" | "topic" | "subtopic";
      title: string;
      path: string;
      searchable: string;
    }> = [];
    for (const n of nodes ?? []) {
      const curr = nodeSearchIndex.get(n.id);
      if (!curr) continue;
      const currentTitle = curr.title || n.id;
      let unitTitle = "";
      let topicTitle = "";
      if (curr.type === "unit") {
        unitTitle = currentTitle;
      } else if (curr.type === "topic") {
        topicTitle = currentTitle;
        const parent = curr.parentId ? nodeSearchIndex.get(curr.parentId) : null;
        unitTitle = parent?.title || "";
      } else {
        const topic = curr.parentId ? nodeSearchIndex.get(curr.parentId) : null;
        topicTitle = topic?.title || "";
        const unit = topic?.parentId ? nodeSearchIndex.get(topic.parentId) : null;
        unitTitle = unit?.title || "";
      }
      const pathParts =
        curr.type === "unit"
          ? [currentTitle]
          : curr.type === "topic"
            ? [unitTitle, currentTitle]
            : [unitTitle, topicTitle, currentTitle];
      const path = pathParts.map((p) => String(p || "").trim()).filter(Boolean).join(" > ");
      items.push({
        id: curr.id,
        type: curr.type,
        title: currentTitle,
        path,
        searchable: `${currentTitle} ${curr.id} ${curr.type} ${path}`.toLowerCase(),
      });
    }
    return items;
  }, [nodes, nodeSearchIndex]);
  const globalSearchResults = useMemo(() => {
    const q = globalSearchQuery.trim().toLowerCase();
    if (!q) return [] as typeof searchableNodes;
    const typePriority = (type: "unit" | "topic" | "subtopic") =>
      type === "unit" ? 0 : type === "topic" ? 1 : 2;
    return searchableNodes
      .map((item) => {
        let score = 0;
        if (item.id.toLowerCase() === q) score += 400;
        if (item.title.toLowerCase() === q) score += 300;
        if (item.title.toLowerCase().startsWith(q)) score += 200;
        if (item.title.toLowerCase().includes(q)) score += 120;
        if (item.id.toLowerCase().includes(q)) score += 90;
        if (item.path.toLowerCase().includes(q)) score += 60;
        if (item.searchable.includes(q)) score += 20;
        return { item, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) =>
        typePriority(a.item.type) - typePriority(b.item.type) ||
        b.score - a.score ||
        a.item.title.localeCompare(b.item.title)
      )
      .map((entry) => entry.item);
  }, [searchableNodes, globalSearchQuery]);

  const expandPathForNode = useCallback((nodeId: string, options?: { skipCamera?: boolean; focusTopicId?: string | null }) => {
    const target = nodeById.get(nodeId);
    if (!target) return;

    let topicId: string | null = null;
    let unitId: string | null = null;
    if (target.type === "subtopic") {
      topicId = target.parentId || null;
      if (topicId) {
        const topicNode = nodeById.get(topicId);
        unitId = topicNode?.parentId || null;
      }
    } else if (target.type === "topic") {
      topicId = target.id;
      unitId = target.parentId || null;
    } else if (target.type === "unit") {
      unitId = target.id;
    }

    if (topicId) {
      setCollapsedTopicIds(() => {
        const next = new Set(allTopicIds);
        next.delete(topicId!);
        return next;
      });
      setExpandedMobileTopicIds(new Set([topicId]));
      setExpandedListTopicIds(new Set([topicId]));
    }
    if (unitId) {
      pendingStructureCameraRef.current = !(options?.skipCamera ?? false);
      pendingTopicFocusRef.current = options?.focusTopicId ?? null;
      setCollapsedUnitIds(() => {
        const next = new Set(allUnitIds);
        next.delete(unitId!);
        return next;
      });
      setExpandedMobileUnitIds(new Set([unitId]));
      setExpandedListUnitIds(new Set([unitId]));
    }
  }, [nodeById, allUnitIds, allTopicIds]);

  const openNodeDetail = useCallback((nodeId: string) => {
    const target = nodeById.get(nodeId);
    // Clicking a topic should open explanation only; subtopic expansion
    // is controlled explicitly via +/- buttons.
    if (target?.type !== "topic") {
      expandPathForNode(nodeId, {
        skipCamera: false,
        focusTopicId: target?.type === "subtopic" ? (target.parentId || null) : null,
      });
    }
    setQuestionBankOpen(false);
    setSelectedNodeId(nodeId);
  }, [expandPathForNode, nodeById]);
  const handleGlobalSearchSelect = useCallback((nodeId: string) => {
    const nextId = String(nodeId || "").trim();
    if (!nextId) return;
    const target = nodeById.get(nextId);
    if (target?.type === "unit") {
      const firstTopicId = firstTopicByUnitId.get(nextId);
      if (firstTopicId) {
        const firstTopicTarget = nodeById.get(firstTopicId);
        if (firstTopicTarget) {
          expandPathForNode(firstTopicId, {
            skipCamera: false,
            focusTopicId:
              firstTopicTarget.type === "subtopic"
                ? (firstTopicTarget.parentId || null)
                : firstTopicTarget.type === "topic"
                  ? firstTopicTarget.id
                  : null,
          });
        }
        setQuestionBankOpen(false);
        setSelectedNodeId(firstTopicId);
      } else {
        expandPathForNode(nextId, { skipCamera: false, focusTopicId: null });
        setQuestionBankOpen(false);
        setSelectedNodeId(null);
      }
    } else {
      expandPathForNode(nextId, {
        skipCamera: false,
        focusTopicId: target?.type === "subtopic" ? (target.parentId || null) : target?.type === "topic" ? target.id : null,
      });
      setQuestionBankOpen(false);
      setSelectedNodeId(nextId);
    }
    setGlobalSearchQuery("");
    setIsGlobalSearchOpen(false);
  }, [nodeById, firstTopicByUnitId, expandPathForNode]);

  const openQuestionBank = useCallback(() => {
    setSelectedNodeId(null);
    setQuestionBankOpen(true);
  }, []);
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    const laidNode = allNodes.find((n) => n.id === selectedNodeId);
    if (laidNode) return laidNode;
    const rawNode = (nodes ?? []).find((n) => n.id === selectedNodeId);
    if (!rawNode) return null;
    return {
      ...rawNode,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      layoutChildren: [],
      children: [],
    } as LayoutNode;
  }, [selectedNodeId, allNodes, nodes]);
  const selectedTopicId = useMemo(() => {
    if (!selectedNode) return null;
    if (selectedNode.type === "topic") return selectedNode.id;
    if (selectedNode.type === "subtopic") return selectedNode.parentId || null;
    return null;
  }, [selectedNode]);
  const { data: selectedTopicBundle } = useGetTopicContentBundle(
    isConfigReady ? configId : null,
    selectedTopicId,
    {
      staleTime: CLIENT_CACHE_BYPASS ? 0 : 60 * 60 * 1000,
      gcTime: CLIENT_CACHE_BYPASS ? 0 : 60 * 60 * 1000,
      refetchOnWindowFocus: CLIENT_CACHE_BYPASS ? true : false,
      refetchOnMount: CLIENT_CACHE_BYPASS ? "always" : true,
    }
  );

  const navigateToNodeDetail = useCallback((nodeId: string) => {
    const nextId = String(nodeId || "").trim();
    if (!nextId) return;
    const target = nodeById.get(nextId);
    if (target) {
      expandPathForNode(nextId, {
        skipCamera: false,
        focusTopicId: target.type === "subtopic" ? (target.parentId || null) : target.type === "topic" ? target.id : null,
      });
    }
    setQuestionBankOpen(false);
    setSelectedNodeId(nextId);
  }, [expandPathForNode, nodeById]);

  const completion = useMemo(() => {
    const doneSubtopics = new Set<string>(
      Array.isArray(completionState?.doneSubtopicIds)
        ? completionState.doneSubtopicIds.map((id) => String(id || "").trim()).filter(Boolean)
        : []
    );
    const subtopicsByTopic = new Map<string, string[]>();
    const topicsByUnit = new Map<string, string[]>();

    for (const n of nodes ?? []) {
      if (n.type === "subtopic") {
        if (viewer?.id && configId) {
          const key = getSubtopicTrackSessionKey(configId, viewer.id, n.id);
          if (sessionStorage.getItem(key)) doneSubtopics.add(n.id);
        }
        if (n.parentId) {
          subtopicsByTopic.set(n.parentId, [...(subtopicsByTopic.get(n.parentId) ?? []), n.id]);
        }
      }
      if (n.type === "topic" && n.parentId) {
        topicsByUnit.set(n.parentId, [...(topicsByUnit.get(n.parentId) ?? []), n.id]);
      }
    }

    const doneTopics = new Set<string>();
    for (const [topicId, subIds] of subtopicsByTopic.entries()) {
      if (subIds.length > 0 && subIds.every((id) => doneSubtopics.has(id))) {
        doneTopics.add(topicId);
      }
    }

    const doneUnits = new Set<string>();
    for (const [unitId, topicIds] of topicsByUnit.entries()) {
      if (topicIds.length > 0 && topicIds.every((id) => doneTopics.has(id))) {
        doneUnits.add(unitId);
      }
    }

    return { doneSubtopics, doneTopics, doneUnits };
  }, [nodes, completionVersion, completionState?.doneSubtopicIds, viewer?.id, configId]);

  const isNodeCompleted = useCallback((nodeId: string) => {
    const id = String(nodeId || "").trim();
    if (!id) return false;
    const nodeMeta = nodeById.get(id);
    if (!nodeMeta) return false;
    if (nodeMeta.type === "subtopic") return completion.doneSubtopics.has(id);
    if (nodeMeta.type === "topic") return completion.doneTopics.has(id);
    return completion.doneUnits.has(id);
  }, [nodeById, completion]);

  const clampPan = useCallback((x: number, y: number, zoomValue: number) => {
    if (!containerRef.current) return { x, y };
    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;
    const scaledW = canvasW * zoomValue;
    const scaledH = canvasH * zoomValue;
    const margin = 24;

    let clampedX = x;
    let clampedY = y;

    const minX = Math.min(margin, containerW - scaledW - margin);
    const maxX = Math.max(margin, containerW - scaledW - margin);
    clampedX = Math.min(maxX, Math.max(minX, x));

    const minY = Math.min(margin, containerH - scaledH - margin);
    const maxY = Math.max(margin, containerH - scaledH - margin);
    clampedY = Math.min(maxY, Math.max(minY, y));

    return { x: clampedX, y: clampedY };
  }, [canvasW, canvasH]);

  useEffect(() => {
    zoomRef.current = zoom;
    panRef.current = pan;
  }, [zoom, pan]);

  useEffect(() => {
    if (selectedNodeId && !allNodes.some((n) => n.id === selectedNodeId)) {
      if (!(nodes ?? []).some((n) => n.id === selectedNodeId)) {
        setSelectedNodeId(null);
      }
    }
  }, [selectedNodeId, allNodes, nodes]);

  useEffect(() => {
    if (!configId) return;
    setExpandedListUnitIds(new Set());
    setExpandedListTopicIds(new Set());
    setExpandedMobileUnitIds(new Set());
    setExpandedMobileTopicIds(new Set());
    pendingStructureCameraRef.current = false;
    setBootTargetNodeId(null);
    setBootFocusRootId(null);
    setBootStage("collapsing");
  }, [configId]);
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!globalSearchRef.current || !target) return;
      if (!globalSearchRef.current.contains(target)) {
        setIsGlobalSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const getVisibleBounds = useCallback(() => {
    if (allNodes.length === 0) return null;
    const minX = Math.min(...allNodes.map((n) => n.x));
    const maxX = Math.max(...allNodes.map((n) => n.x + n.w));
    const minY = Math.min(...allNodes.map((n) => n.y));
    const maxY = Math.max(...allNodes.map((n) => n.y + n.h));
    return { minX, maxX, minY, maxY };
  }, [allNodes]);

  const getSubtreeBounds = useCallback((rootId: string) => {
    if (!rootId || allNodes.length === 0) return null;
    const visibleById = new Map(allNodes.map((n) => [n.id, n]));
    const childrenByParent = new Map<string, string[]>();
    for (const n of allNodes) {
      if (!n.parentId) continue;
      const list = childrenByParent.get(n.parentId) ?? [];
      list.push(n.id);
      childrenByParent.set(n.parentId, list);
    }

    const root = visibleById.get(rootId);
    if (!root) return null;

    const queue = [rootId];
    const visited = new Set<string>();
    const cluster: LayoutNode[] = [];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      const node = visibleById.get(curr);
      if (!node) continue;
      cluster.push(node);
      const kids = childrenByParent.get(curr) ?? [];
      for (const k of kids) queue.push(k);
    }
    if (cluster.length === 0) return null;

    return {
      minX: Math.min(...cluster.map((n) => n.x)),
      maxX: Math.max(...cluster.map((n) => n.x + n.w)),
      minY: Math.min(...cluster.map((n) => n.y)),
      maxY: Math.max(...cluster.map((n) => n.y + n.h)),
    };
  }, [allNodes]);

  const getExpandedUnitId = useCallback(() => {
    if (allUnitIds.length === 0) return null;
    for (const unitId of allUnitIds) {
      if (!collapsedUnitIds.has(unitId)) return unitId;
    }
    return null;
  }, [allUnitIds, collapsedUnitIds]);

  const getPreferredFocusBounds = useCallback(() => {
    const expandedUnitId = getExpandedUnitId();
    if (!expandedUnitId) return getVisibleBounds();
    return getSubtreeBounds(expandedUnitId) ?? getVisibleBounds();
  }, [getExpandedUnitId, getSubtreeBounds, getVisibleBounds]);

  const areAllUnitsCollapsed = useMemo(
    () => allUnitIds.length > 0 && collapsedUnitIds.size === allUnitIds.length,
    [allUnitIds, collapsedUnitIds],
  );

  const getCollapsedGridPreviewBounds = useCallback(() => {
    if (!areAllUnitsCollapsed) return null;
    const unitNodes = allNodes.filter((n) => n.type === "unit");
    if (unitNodes.length === 0) return null;

    const minY = Math.min(...unitNodes.map((n) => n.y));
    const maxY = Math.max(...unitNodes.map((n) => n.y + n.h));
    const minX = Math.min(...unitNodes.map((n) => n.x));
    const maxX = Math.max(...unitNodes.map((n) => n.x + n.w));
    const sortedColumns = Array.from(new Set(unitNodes.map((n) => n.x))).sort((a, b) => a - b);
    const fullColumns = Math.max(1, Math.floor(COLLAPSED_GRID_VISIBLE_COLUMNS));
    const fractionalColumn = Math.max(0, COLLAPSED_GRID_VISIBLE_COLUMNS - fullColumns);
    const firstColumnX = sortedColumns[0] ?? minX;
    const sampleUnitWidth = unitNodes.find((n) => n.x === firstColumnX)?.w ?? NODE_W;
    const sampleColumnStep =
      sortedColumns.length > 1
        ? Math.max(sampleUnitWidth, sortedColumns[1]! - sortedColumns[0]!)
        : sampleUnitWidth + 56;
    const virtualPreviewMaxX =
      firstColumnX + fullColumns * sampleColumnStep + sampleUnitWidth * fractionalColumn;

    // Keep a consistent 3.5-column frame even when there are fewer real columns.
    // If there are more real columns, we still preview only up to the 3.5-column window.
    const boundedPreviewMaxX =
      sortedColumns.length <= Math.ceil(COLLAPSED_GRID_VISIBLE_COLUMNS)
        ? Math.max(maxX, virtualPreviewMaxX)
        : Math.min(maxX, virtualPreviewMaxX);

    return { minX: firstColumnX, maxX: boundedPreviewMaxX, minY, maxY };
  }, [areAllUnitsCollapsed, allNodes]);

  useEffect(() => {
    const prev = prevAllUnitsCollapsedRef.current;
    if (prev !== null && prev !== areAllUnitsCollapsed) {
      // Tree <-> grid layout mode changed. Avoid animated camera here to prevent jitter.
      instantCameraForLayoutSwitchRef.current = true;
    }
    prevAllUnitsCollapsedRef.current = areAllUnitsCollapsed;
  }, [areAllUnitsCollapsed]);

  const getUnitAncestorId = useCallback((nodeId: string) => {
    const start = nodeById.get(nodeId);
    if (!start) return null;
    if (start.type === "unit") return start.id;
    if (start.type === "topic") return start.parentId || null;
    const topicId = start.parentId;
    if (!topicId) return null;
    return nodeById.get(topicId)?.parentId || null;
  }, [nodeById]);

  const toggleTopicCollapse = useCallback((topicId: string) => {
    pendingStructureCameraRef.current = true;
    const willExpand = collapsedTopicIds.has(topicId);
    pendingTopicFocusRef.current = willExpand ? topicId : null;
    setCollapsedTopicIds((prev) => {
      const isCurrentlyCollapsed = prev.has(topicId);
      if (isCurrentlyCollapsed) {
        const next = new Set(allTopicIds);
        next.delete(topicId); // expand only this topic
        return next;
      }
      return new Set(allTopicIds); // collapse all topics
    });
    if (willExpand) {
      setExpandedMobileTopicIds(new Set([topicId]));
      setExpandedListTopicIds(new Set([topicId]));
    } else {
      setExpandedMobileTopicIds(new Set());
      setExpandedListTopicIds(new Set());
    }
  }, [collapsedTopicIds, allTopicIds]);

  const toggleUnitCollapse = useCallback((unitId: string) => {
    pendingStructureCameraRef.current = true;
    pendingTopicFocusRef.current = null;
    // Accordion behavior: at most one expanded unit at a time (0 or 1 expanded).
    setCollapsedUnitIds((prev) => {
      const isCurrentlyCollapsed = prev.has(unitId);
      if (isCurrentlyCollapsed) {
        const next = new Set(allUnitIds);
        next.delete(unitId); // expand this one
        return next;
      }
      return new Set(allUnitIds); // collapse all units
    });
  }, [allUnitIds]);

  const collapseAllTopics = useCallback(() => {
    pendingStructureCameraRef.current = true;
    pendingTopicFocusRef.current = null;
    setCollapsedUnitIds(new Set(allUnitIds));
    setCollapsedTopicIds(new Set(allTopicIds));
  }, [allUnitIds, allTopicIds]);

  const animateCameraTo = useCallback(
    (targetZoom: number, targetPan: { x: number; y: number }, durationMs?: number) => {
      if (panAnimRafRef.current) {
        window.cancelAnimationFrame(panAnimRafRef.current);
        panAnimRafRef.current = null;
      }
      const startPan = { ...panRef.current };
      const startZoom = zoomRef.current;
      const panDistance = Math.hypot(targetPan.x - startPan.x, targetPan.y - startPan.y);
      const zoomDistance = Math.abs(targetZoom - startZoom);
      const computedDuration = Math.round(
        Math.max(
          260,
          Math.min(560, panDistance * 0.28 + zoomDistance * 520 + 220),
        ),
      );
      const totalDuration = durationMs ?? computedDuration;
      const startTs = performance.now();
      const easeInOutCubic = (t: number) =>
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const step = (ts: number) => {
        const elapsed = ts - startTs;
        const rawT = Math.max(0, Math.min(1, elapsed / totalDuration));
        const t = easeInOutCubic(rawT);
        const z = startZoom + (targetZoom - startZoom) * t;
        const x = startPan.x + (targetPan.x - startPan.x) * t;
        const y = startPan.y + (targetPan.y - startPan.y) * t;
        setZoom(z);
        setPan(clampPan(x, y, z));
        if (rawT < 1) {
          panAnimRafRef.current = window.requestAnimationFrame(step);
        } else {
          panAnimRafRef.current = null;
        }
      };

      panAnimRafRef.current = window.requestAnimationFrame(step);
    },
    [clampPan],
  );

  const fitCameraToBounds = useCallback((
    bounds: { minX: number; maxX: number; minY: number; maxY: number } | null,
    options?: { animate?: boolean; maxZoom?: number; minZoom?: number; strategy?: "contain" | "width"; durationMs?: number },
  ) => {
    if (!containerRef.current || !bounds) return;
    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;
    const pad = 24;
    const contentW = Math.max(1, bounds.maxX - bounds.minX);
    const contentH = Math.max(1, bounds.maxY - bounds.minY);
    const fitZoomX = (containerW - pad * 2) / contentW;
    const fitZoomY = (containerH - pad * 2) / contentH;
    const strategy = options?.strategy ?? "contain";
    const targetZoomByStrategy = strategy === "width" ? fitZoomX : Math.min(fitZoomX, fitZoomY);
    const maxZoom = options?.maxZoom ?? 2;
    const minZoom = options?.minZoom ?? 0.2;
    const fitZoom = Math.max(minZoom, Math.min(maxZoom, targetZoomByStrategy));
    const centerX = bounds.minX + contentW / 2;
    const centerY = bounds.minY + contentH / 2;
    const targetPan = clampPan(
      containerW / 2 - centerX * fitZoom,
      containerH / 2 - centerY * fitZoom,
      fitZoom,
    );
    if (options?.animate === false) {
      setZoom(fitZoom);
      setPan(targetPan);
      return;
    }
    animateCameraTo(fitZoom, targetPan, options?.durationMs);
  }, [animateCameraTo, clampPan]);

  const fitToWidth = useCallback(() => {
    if (areAllUnitsCollapsed) {
      const collapsedPreviewBounds = getCollapsedGridPreviewBounds() ?? getPreferredFocusBounds();
      fitCameraToBounds(collapsedPreviewBounds, { strategy: "width", minZoom: 0.4 });
      return;
    }
    const bounds = getPreferredFocusBounds();
    fitCameraToBounds(bounds);
  }, [fitCameraToBounds, getPreferredFocusBounds, areAllUnitsCollapsed, getCollapsedGridPreviewBounds]);

  const getMinVisibleZoom = useCallback(() => {
    if (!containerRef.current || allNodes.length === 0) return 0.2;
    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;
    const scaleX = containerW / (canvasW + 60);
    const scaleY = containerH / (canvasH + 60);
    return Math.max(0.2, Math.min(1, Math.min(scaleX, scaleY)));
  }, [allNodes.length, canvasW, canvasH]);

  useEffect(() => {
    const onResize = () => setIsMobileViewport(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (isMobileViewport && viewMode === "list") {
      setViewMode("map");
    }
  }, [isMobileViewport, viewMode]);

  useEffect(() => {
    if (bootStage !== "collapsing" || !configId) return;
    if (allTopicIds.length === 0 && allUnitIds.length === 0) return;
    setCollapsedUnitIds(new Set(allUnitIds));
    setCollapsedTopicIds(new Set(allTopicIds));
    setBootStage("resuming");
  }, [bootStage, configId, allTopicIds, allUnitIds]);

  useEffect(() => {
    if (bootStage !== "resuming" || !configId || !nodes || nodes.length === 0) return;
    if (isStudentViewer && isLatestInteractionLoading) return;

    const resumedNodeId = (() => {
      if (!latestInteractionState) return "";
      const mapNodeId = String(latestInteractionState.mapNodeId || "").trim();
      if (mapNodeId && nodeById.has(mapNodeId)) return mapNodeId;
      const qbSubtopicId = String(latestInteractionState.qbSubtopicId || "").trim();
      if (qbSubtopicId && nodeById.has(qbSubtopicId)) return qbSubtopicId;
      return "";
    })();

    if (!resumedNodeId) {
      pendingStructureCameraRef.current = true;
      setBootStage("done");
      return;
    }

    expandPathForNode(resumedNodeId, { skipCamera: true });
    setQuestionBankOpen(false);
    setSelectedNodeId(resumedNodeId);
    setBootTargetNodeId(resumedNodeId);
    setBootFocusRootId(getUnitAncestorId(resumedNodeId) ?? resumedNodeId);
    bootCameraStartedRef.current = false;
    clearBootCameraSequence();
    setBootStage("camera");
  }, [
    bootStage,
    latestInteractionState,
    isLatestInteractionLoading,
    nodes,
    configId,
    nodeById,
    expandPathForNode,
    isStudentViewer,
    getUnitAncestorId,
    clearBootCameraSequence,
  ]);

  useEffect(() => {
    if (bootStage !== "camera" || viewMode !== "map" || allNodes.length === 0) return;
    if (bootCameraStartedRef.current) return;
    const focusRootId = bootFocusRootId || bootTargetNodeId;
    if (!focusRootId) {
      bootCameraStartedRef.current = false;
      setBootStage("done");
      return;
    }
    bootCameraStartedRef.current = true;
    pendingStructureCameraRef.current = false;

    bootCameraRaf1Ref.current = window.requestAnimationFrame(() => {
      bootCameraRaf2Ref.current = window.requestAnimationFrame(() => {
        const unitBounds = getSubtreeBounds(focusRootId);
        if (unitBounds && containerRef.current) {
          const currentZoom = zoomRef.current;
          const centerX = unitBounds.minX + (unitBounds.maxX - unitBounds.minX) / 2;
          const centerY = unitBounds.minY + (unitBounds.maxY - unitBounds.minY) / 2;
          const centeredPan = clampPan(
            containerRef.current.clientWidth / 2 - centerX * currentZoom,
            containerRef.current.clientHeight / 2 - centerY * currentZoom,
            currentZoom,
          );
          panRef.current = centeredPan;
          setPan(centeredPan);
        }
        fitCameraToBounds(unitBounds, { animate: true, maxZoom: MAX_AUTO_FOCUS_ZOOM, durationMs: 1000 });
        const targetNodeId = String(bootTargetNodeId || "").trim();
        let topicFocusId: string | null = null;
        if (targetNodeId) {
          const target = nodeById.get(targetNodeId);
          topicFocusId =
            target?.type === "subtopic"
              ? (target.parentId || null)
              : target?.type === "topic"
              ? target.id
              : null;
        }
        if (topicFocusId) {
          bootCameraTimerRef.current = setTimeout(() => {
            const topicBounds = getSubtreeBounds(topicFocusId!);
            if (topicBounds) {
              fitCameraToBounds(topicBounds, { animate: true, maxZoom: 2, durationMs: 1200 });
            }
            pendingStructureCameraRef.current = false;
            bootCameraStartedRef.current = false;
            setBootStage("done");
          }, 1500);
        } else {
          pendingStructureCameraRef.current = false;
          bootCameraStartedRef.current = false;
          setBootStage("done");
        }
      });
    });
  }, [
    bootStage,
    viewMode,
    allNodes.length,
    bootFocusRootId,
    bootTargetNodeId,
    fitCameraToBounds,
    getSubtreeBounds,
    nodeById,
  ]);

  useEffect(() => {
    if (bootStage !== "camera") {
      clearBootCameraSequence();
      bootCameraStartedRef.current = false;
    }
  }, [bootStage, clearBootCameraSequence]);

  useEffect(() => {
    return () => {
      clearBootCameraSequence();
      bootCameraStartedRef.current = false;
    };
  }, [clearBootCameraSequence]);

  useEffect(() => {
    if (!pendingStructureCameraRef.current) return;
    if (bootStage !== "done" || viewMode !== "map" || allNodes.length === 0) return;

    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        const topicFocusId = pendingTopicFocusRef.current;
        const topicFocusBounds = topicFocusId ? getSubtreeBounds(topicFocusId) : null;
        const fallbackBounds = getPreferredFocusBounds();
        const collapsedPreviewBounds = getCollapsedGridPreviewBounds();
        const shouldSnapCamera = instantCameraForLayoutSwitchRef.current;
        const cameraOptions = shouldSnapCamera ? { animate: false as const } : undefined;
        if (!topicFocusBounds && areAllUnitsCollapsed) {
          fitCameraToBounds(collapsedPreviewBounds ?? fallbackBounds, {
            strategy: "width",
            minZoom: 0.4,
            ...(cameraOptions ?? {}),
          });
        } else {
          fitCameraToBounds(topicFocusBounds ?? fallbackBounds, cameraOptions);
        }
        instantCameraForLayoutSwitchRef.current = false;
        pendingTopicFocusRef.current = null;
        pendingStructureCameraRef.current = false;
      });
    });

    return () => {
      if (raf1) window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [bootStage, viewMode, allNodes, collapsedTopicIds, collapsedUnitIds, areAllUnitsCollapsed, fitCameraToBounds, getPreferredFocusBounds, getSubtreeBounds, getCollapsedGridPreviewBounds]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (panAnimRafRef.current) {
      window.cancelAnimationFrame(panAnimRafRef.current);
      panAnimRafRef.current = null;
    }
    if ((e.target as HTMLElement).closest("[data-node]")) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan(
      clampPan(
        dragStart.current.panX + (e.clientX - dragStart.current.x),
        dragStart.current.panY + (e.clientY - dragStart.current.y),
        zoom
      )
    );
  }, [isDragging, clampPan, zoom]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (panAnimRafRef.current) {
      window.cancelAnimationFrame(panAnimRafRef.current);
      panAnimRafRef.current = null;
    }
    if ((e.target as HTMLElement).closest("[data-node]")) return;
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dx = b.clientX - a.clientX;
      const dy = b.clientY - a.clientY;
      pinchStart.current = { distance: Math.hypot(dx, dy), zoom };
      setIsPinching(true);
      setIsDragging(false);
      return;
    }
    const touch = e.touches[0];
    setIsDragging(true);
    dragStart.current = { x: touch.clientX, y: touch.clientY, panX: pan.x, panY: pan.y };
  }, [pan, zoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isPinching && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dx = b.clientX - a.clientX;
      const dy = b.clientY - a.clientY;
      const distance = Math.hypot(dx, dy);
      const ratio = pinchStart.current.distance > 0 ? distance / pinchStart.current.distance : 1;
      const minZoom = getMinVisibleZoom();
      const nextZoom = Math.max(minZoom, Math.min(2.2, pinchStart.current.zoom * ratio));
      setZoom(nextZoom);
      return;
    }

    if (!isDragging) return;
    const touch = e.touches[0];
    setPan(
      clampPan(
        dragStart.current.panX + (touch.clientX - dragStart.current.x),
        dragStart.current.panY + (touch.clientY - dragStart.current.y),
        zoom
      )
    );
  }, [isDragging, isPinching, clampPan, zoom, getMinVisibleZoom]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2 && isPinching) {
      setIsPinching(false);
    }
    if (e.touches.length === 0) {
      setIsDragging(false);
    }
  }, [isPinching]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || viewMode !== "map") return;

    const onWheelNative = (event: WheelEvent) => {
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation();
      if (panAnimRafRef.current) {
        window.cancelAnimationFrame(panAnimRafRef.current);
        panAnimRafRef.current = null;
      }
      setPan((prev) => clampPan(prev.x - event.deltaX, prev.y - event.deltaY, zoomRef.current));
    };

    container.addEventListener("wheel", onWheelNative, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheelNative);
    };
  }, [viewMode, clampPan]);

  const resetView = useCallback(() => {
    const bounds =
      (areAllUnitsCollapsed ? getCollapsedGridPreviewBounds() : null) ??
      getVisibleBounds();
    fitCameraToBounds(bounds, { animate: false });
  }, [fitCameraToBounds, getVisibleBounds, areAllUnitsCollapsed, getCollapsedGridPreviewBounds]);

  const handleZoomOut = useCallback(() => {
    const minZoom = getMinVisibleZoom();
    const nextZoom = zoom / ZOOM_STEP;
    if (nextZoom <= minZoom) {
      resetView();
      return;
    }
    setZoom(nextZoom);
  }, [zoom, getMinVisibleZoom, resetView]);

  useEffect(() => {
    setPan((prev) => {
      const clamped = clampPan(prev.x, prev.y, zoom);
      if (clamped.x === prev.x && clamped.y === prev.y) return prev;
      return clamped;
    });
  }, [zoom, canvasW, canvasH, clampPan]);

  if (!configId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-background to-blue-50">
        <div className="max-w-4xl mx-auto p-6">
          <Button variant="outline" onClick={() => setLocation(backPath)} className="rounded-full px-5 mb-6">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-foreground">Config missing</h2>
            <p className="text-sm text-muted-foreground mt-1">No configId was provided for this roadmap.</p>
          </div>
        </div>
      </div>
    );
  }

  if (isConfigsLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-background to-blue-50">
        <div className="max-w-4xl mx-auto p-6">
          <div className="rounded-2xl border border-border bg-card p-8">
            <div className="h-6 w-48 bg-muted rounded animate-pulse mb-4" />
            <div className="h-4 w-72 bg-muted rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!activeConfig) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-background to-blue-50">
        <div className="max-w-4xl mx-auto p-6">
          <Button variant="outline" onClick={() => setLocation(backPath)} className="rounded-full px-5 mb-6">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-foreground">Config unavailable</h2>
            <p className="text-sm text-muted-foreground mt-1">
              This config may be deleted, disabled, or not accessible for your account.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <div className="relative grid grid-cols-[auto_1fr_auto] items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setLocation(backPath)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-display font-bold text-foreground truncate flex items-center gap-1.5 sm:gap-2">
                <Layers className="w-5 h-5 text-primary shrink-0" />
                {subject}
              </h1>
              {subtitleMeta && <p className="text-[11px] sm:text-xs text-muted-foreground truncate">{subtitleMeta}</p>}
            </div>
          </div>
          <div ref={globalSearchRef} className="flex items-center justify-center gap-2 min-w-0">
            <div className="relative hidden md:block w-[14rem] lg:w-[18rem] xl:w-[20rem]">
              <div className="relative">
                <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={globalSearchQuery}
                  onFocus={() => setIsGlobalSearchOpen(true)}
                  onChange={(e) => {
                    setGlobalSearchQuery(e.target.value);
                    setIsGlobalSearchOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && globalSearchResults.length > 0) {
                      e.preventDefault();
                      handleGlobalSearchSelect(globalSearchResults[0]!.id);
                    }
                    if (e.key === "Escape") {
                      setIsGlobalSearchOpen(false);
                    }
                  }}
                  placeholder="Search units, topics, subtopics, or node id..."
                  className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              {isGlobalSearchOpen && (
                <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-xl border border-border bg-card shadow-xl max-h-80 overflow-y-auto">
                  {globalSearchQuery.trim().length === 0 ? (
                    <p className="px-3 py-2.5 text-xs text-muted-foreground">
                      Type to search across all units, topics, and subtopics.
                    </p>
                  ) : globalSearchResults.length === 0 ? (
                    <p className="px-3 py-2.5 text-xs text-muted-foreground">
                      No matching roadmap nodes found.
                    </p>
                  ) : (
                    <div className="py-1">
                      {globalSearchResults.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleGlobalSearchSelect(item.id)}
                          className="w-full px-3 py-2 text-left hover:bg-secondary/60 transition-colors border-b border-border/40 last:border-0"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-semibold text-foreground truncate">{item.title}</span>
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                item.type === "unit"
                                  ? "bg-blue-100 text-blue-700"
                                  : item.type === "topic"
                                    ? "bg-violet-100 text-violet-700"
                                    : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {item.type}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{item.path}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {isMobileViewport && (
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 rounded-full border-border/70 bg-background/90 p-0 shadow-sm"
                  onClick={() => setIsGlobalSearchOpen((prev) => !prev)}
                  aria-label="Search roadmap nodes"
                  title="Search roadmap nodes"
                >
                  <Search className="w-4 h-4 text-slate-600" />
                </Button>
                {isGlobalSearchOpen && (
                  <div className="absolute right-0 top-full mt-2 z-50 w-[min(92vw,22rem)] rounded-xl border border-border bg-card shadow-xl max-h-[65vh] overflow-y-auto">
                    <div className="p-2 border-b border-border/70">
                      <div className="relative">
                        <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={globalSearchQuery}
                          autoFocus
                          onChange={(e) => setGlobalSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && globalSearchResults.length > 0) {
                              e.preventDefault();
                              handleGlobalSearchSelect(globalSearchResults[0]!.id);
                            }
                            if (e.key === "Escape") {
                              setIsGlobalSearchOpen(false);
                            }
                          }}
                          placeholder="Search units, topics, subtopics..."
                          className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/40"
                        />
                      </div>
                    </div>
                    {globalSearchQuery.trim().length === 0 ? (
                      <p className="px-3 py-2.5 text-xs text-muted-foreground">
                        Type to search across all units, topics, and subtopics.
                      </p>
                    ) : globalSearchResults.length === 0 ? (
                      <p className="px-3 py-2.5 text-xs text-muted-foreground">
                        No matching roadmap nodes found.
                      </p>
                    ) : (
                      <div className="py-1">
                        {globalSearchResults.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleGlobalSearchSelect(item.id)}
                            className="w-full px-3 py-2 text-left hover:bg-secondary/60 transition-colors border-b border-border/40 last:border-0"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-semibold text-foreground truncate">{item.title}</span>
                              <span
                                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                  item.type === "unit"
                                    ? "bg-blue-100 text-blue-700"
                                    : item.type === "topic"
                                      ? "bg-violet-100 text-violet-700"
                                      : "bg-emerald-100 text-emerald-700"
                                }`}
                              >
                                {item.type}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{item.path}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {!isMobileViewport && (
              <Button
                variant="default"
                size="sm"
                className="h-10 rounded-lg px-4 gap-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm border border-emerald-700"
                onClick={openQuestionBank}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Question Bank
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isMobileViewport ? null : (
              <>
                <Button
                  variant={viewMode === "list" ? "default" : "outline"}
                  size="sm"
                  className="h-8 px-3 gap-1.5"
                  onClick={() => setViewMode("list")}
                >
                  <List className="w-3.5 h-3.5" />
                  List
                </Button>
                <Button
                  variant={viewMode === "map" ? "default" : "outline"}
                  size="sm"
                  className="h-8 px-3 gap-1.5"
                  onClick={() => setViewMode("map")}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Map
                </Button>
                {viewMode === "map" && (
                  <>
                    <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={collapseAllTopics}>
                      Collapse all
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={fitToWidth}>
                      Fit width
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {viewMode === "list" ? (
        <div className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6">
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                <p className="text-sm text-muted-foreground">Loading roadmap...</p>
              </div>
            </div>
          ) : isError ? (
            <div className="h-full flex items-center justify-center p-4">
              <div className="p-6 bg-destructive/10 text-destructive rounded-xl border border-destructive/20 text-center max-w-sm">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-60" />
                <p className="font-medium">Failed to load roadmap</p>
              </div>
            </div>
          ) : tree.length === 0 ? (
            <div className="h-full flex items-center justify-center p-4 text-center">
              <div>
                <Layers className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-20" />
                <p className="text-muted-foreground">No content available yet.</p>
              </div>
            </div>
          ) : (
            <div className="max-w-6xl mx-auto space-y-4">
              {tree.map((unit) => {
                const unitExpanded = expandedListUnitIds.has(unit.id);
                const topicCount = unit.children.length;
                const subtopicCount = unit.children.reduce((acc, t) => acc + t.children.length, 0);
                const unitNumber = unitNumberById.get(unit.id);
                return (
                  <section key={unit.id} className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-sm">
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() =>
                        setExpandedListUnitIds((prev) => {
                          if (prev.has(unit.id)) return new Set<string>();
                          return new Set<string>([unit.id]);
                        })
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h2 className="text-base sm:text-lg font-semibold text-foreground">
                              <span className="text-blue-700">{unitNumber ?? "?"}.</span>{" "}
                              {unit.title}
                            </h2>
                            {completion.doneUnits.has(unit.id) && (
                              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {topicCount} topics | {subtopicCount} subtopics
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] sm:text-xs uppercase tracking-wider px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                            Unit
                          </span>
                          <span className="text-xs text-blue-700 font-semibold">{unitExpanded ? "Hide" : "Show"}</span>
                        </div>
                      </div>
                    </button>

                    {unitExpanded && (
                      <div className="space-y-3 mt-4">
                        {unit.children.map((topic) => {
                          const topicExpanded = expandedListTopicIds.has(topic.id);
                          return (
                            <div key={topic.id} className="rounded-xl border border-border bg-secondary/20 p-3">
                              <div className="flex items-center justify-between gap-3 mb-2">
                                <button
                                  type="button"
                                  onClick={() => openNodeDetail(topic.id)}
                                  className="flex items-center gap-2 min-w-0 text-left"
                                >
                                  <h3 className="text-sm font-semibold text-foreground">{topic.title}</h3>
                                  {completion.doneTopics.has(topic.id) && (
                                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                                  )}
                                </button>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-200">
                                    Topic
                                  </span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 w-7 p-0"
                                    onClick={() =>
                                      setExpandedListTopicIds((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(topic.id)) next.delete(topic.id);
                                        else next.add(topic.id);
                                        return next;
                                      })
                                    }
                                    title={topicExpanded ? "Collapse subtopics" : "Expand subtopics"}
                                    aria-label={topicExpanded ? "Collapse subtopics" : "Expand subtopics"}
                                  >
                                    <ChevronRight
                                      className={`w-3.5 h-3.5 transition-transform ${topicExpanded ? "rotate-90" : "rotate-0"}`}
                                    />
                                  </Button>
                                </div>
                              </div>
                              {topicExpanded && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                  {topic.children.map((sub) => {
                                    const done = completion.doneSubtopics.has(sub.id);
                                    return (
                                      <button
                                        key={sub.id}
                                        type="button"
                                        onClick={() => openNodeDetail(sub.id)}
                                        className="text-left rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors p-2.5"
                                      >
                                        <div className="flex items-start gap-2">
                                          <FileText className="w-3.5 h-3.5 text-emerald-700 mt-0.5 shrink-0" />
                                          <span className="text-xs font-medium text-emerald-800 leading-snug flex-1 break-words">
                                            {sub.title}
                                          </span>
                                          {done && <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : isMobileViewport ? (
        <div className="flex-1 overflow-y-auto bg-slate-50 p-3 space-y-3">
          <button
            type="button"
            onClick={openQuestionBank}
            className="w-full rounded-xl border border-blue-300 bg-blue-50 px-3 py-3 text-left shadow-sm"
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-blue-500 flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm font-semibold text-blue-700">Question Bank</span>
            </div>
          </button>

          <div className="rounded-xl border border-border bg-card px-3 py-2.5">
            <h2 className="text-sm font-semibold text-foreground">Units</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Click on topics/subtopics to view explanations. Use Expand to reveal subtopics.
            </p>
          </div>

          {isLoading ? (
            <div className="h-[50vh] flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                <p className="text-sm text-muted-foreground">Loading roadmap...</p>
              </div>
            </div>
          ) : isError ? (
            <div className="p-6 bg-destructive/10 text-destructive rounded-xl border border-destructive/20 text-center">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-60" />
              <p className="font-medium">Failed to load roadmap</p>
            </div>
          ) : tree.length === 0 ? (
            <div className="p-6 rounded-xl border border-border bg-card text-center">
              <Layers className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-20" />
              <p className="text-muted-foreground">No content available yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tree.map((unit) => {
                const unitExpanded = expandedMobileUnitIds.has(unit.id);
                const topicCount = unit.children.length;
                const subtopicCount = unit.children.reduce((acc, t) => acc + t.children.length, 0);
                const unitNumber = unitNumberById.get(unit.id);
                return (
                  <section key={unit.id} className="bg-card border border-blue-200 rounded-xl overflow-hidden shadow-sm">
                    <button
                      type="button"
                      className="w-full px-3 py-3 text-left bg-blue-50/50 border-b border-blue-100"
                      onClick={() =>
                        setExpandedMobileUnitIds((prev) => {
                          if (prev.has(unit.id)) return new Set<string>();
                          return new Set<string>([unit.id]);
                        })
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground break-words">
                              <span className="text-blue-700">{unitNumber ?? "?"}.</span>{" "}
                              {unit.title}
                            </span>
                            {completion.doneUnits.has(unit.id) && (
                              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {topicCount} topics | {subtopicCount} subtopics
                          </p>
                        </div>
                        <span className="text-xs text-blue-700 font-semibold">{unitExpanded ? "Hide" : "Show"}</span>
                      </div>
                    </button>

                    {unitExpanded && (
                      <div className="p-2 space-y-2">
                        {unit.children.map((topic) => {
                          const topicExpanded = expandedMobileTopicIds.has(topic.id);
                          return (
                            <div key={topic.id} className="rounded-lg border border-violet-200 bg-violet-50/50 overflow-hidden">
                              <div className="px-2.5 py-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  className="flex-1 text-left min-w-0"
                                  onClick={() => openNodeDetail(topic.id)}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-violet-800 break-words">{topic.title}</span>
                                    {completion.doneTopics.has(topic.id) && (
                                      <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                                    )}
                                  </div>
                                </button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() =>
                                    setExpandedMobileTopicIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(topic.id)) next.delete(topic.id);
                                      else next.add(topic.id);
                                      return next;
                                    })
                                  }
                                  title={topicExpanded ? "Collapse subtopics" : "Expand subtopics"}
                                  aria-label={topicExpanded ? "Collapse subtopics" : "Expand subtopics"}
                                >
                                  <ChevronRight
                                    className={`w-3.5 h-3.5 transition-transform ${topicExpanded ? "rotate-90" : "rotate-0"}`}
                                  />
                                </Button>
                              </div>
                              {topicExpanded && (
                                <div className="px-2.5 pb-2 space-y-1.5">
                                  {topic.children.map((sub) => {
                                    const done = completion.doneSubtopics.has(sub.id);
                                    return (
                                      <button
                                        key={sub.id}
                                        type="button"
                                        onClick={() => openNodeDetail(sub.id)}
                                        className="w-full text-left rounded-md border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-2 py-2"
                                      >
                                        <div className="flex items-start gap-2">
                                          <FileText className="w-3.5 h-3.5 text-emerald-700 mt-0.5 shrink-0" />
                                          <span className="text-xs font-medium text-emerald-800 leading-snug flex-1 break-words">
                                            {sub.title}
                                          </span>
                                          {done && <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex bg-slate-50 overflow-hidden">
          <div
            ref={containerRef}
            className="basis-[55%] w-[55%] max-w-[55%] grow-0 shrink-0 min-w-0 overflow-hidden overscroll-contain bg-[#f8fafc] relative select-none border-r border-border/70"
          style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] bg-[length:24px_24px] opacity-50" />

          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                <p className="text-sm text-muted-foreground">Loading roadmap...</p>
              </div>
            </div>
          ) : isError ? (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="p-6 bg-destructive/10 text-destructive rounded-xl border border-destructive/20 text-center max-w-sm">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-60" />
                <p className="font-medium">Failed to load roadmap</p>
              </div>
            </div>
          ) : allNodes.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="text-center">
                <Layers className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-20" />
                <p className="text-muted-foreground">No content available yet.</p>
              </div>
            </div>
          ) : (
            <div
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "0 0",
                width: canvasW,
                height: canvasH,
                position: "relative",
              }}
            >
              <svg
                width={canvasW}
                height={canvasH}
                className="absolute inset-0 pointer-events-none"
              >
                {lines.map((line, i) => {
                  const elbow1 = line.x1 + 18;
                  const elbow2 = line.x2 - 18;
                  return (
                    <path
                      key={i}
                      d={`M ${line.x1} ${line.y1} L ${elbow1} ${line.y1} L ${elbow2} ${line.y2} L ${line.x2} ${line.y2}`}
                      fill="none"
                      stroke={line.color}
                      strokeWidth={1.8}
                      strokeOpacity={0.55}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                })}
              </svg>

              {allNodes.map(node => {
                const colors = NODE_COLORS[node.type as keyof typeof NODE_COLORS] || NODE_COLORS.topic;
                const isDone =
                  node.type === "subtopic"
                    ? completion.doneSubtopics.has(node.id)
                    : node.type === "topic"
                      ? completion.doneTopics.has(node.id)
                      : completion.doneUnits.has(node.id);
                const isClickable = node.type === "topic" || node.type === "subtopic";
                const isTopic = node.type === "topic";
                const isUnit = node.type === "unit";
                const isTopicCollapsed = isTopic && collapsedTopicIds.has(node.id);
                const isUnitCollapsed = isUnit && collapsedUnitIds.has(node.id);
                const isGridUnit = isUnit && areAllUnitsCollapsed;
                const unitNumber = isUnit ? unitNumberById.get(node.id) : null;
                const subtopicCount = topicChildCountById.get(node.id) ?? 0;
                const topicCount = unitChildCountById.get(node.id) ?? 0;

                return (
                  <div
                    key={node.id}
                    data-node
                    className={`
                    absolute rounded-xl border-2 flex items-center gap-2 px-3 transition-[box-shadow,transform] duration-500 ease-in-out
                    ${colors.light}
                    ${isClickable ? 'cursor-pointer hover:shadow-lg hover:scale-105' : ''}
                    ${isGridUnit ? 'cursor-pointer hover:shadow-lg hover:scale-[1.25] hover:z-10' : ''}
                    ${selectedNodeId === node.id ? 'ring-2 ring-primary ring-offset-2 shadow-lg' : 'shadow-sm'}
                  `}
                    style={{
                      left: node.x,
                      top: node.y,
                      width: node.w,
                      height: node.h,
                    }}
                    title={isClickable ? "Click on the node to see the explanation" : undefined}
                    onClick={() => isClickable && openNodeDetail(node.id)}
                  >
                    <div className={`relative ${node.type === "unit" ? "w-7 h-7 bg-blue-600" : `w-6 h-6 ${colors.bg}`} rounded-md flex items-center justify-center shrink-0`}>
                      {node.type === "unit" && <Layers className="w-4 h-4 text-white" />}
                      {node.type === "topic" && <BookOpen className="w-3.5 h-3.5 text-white" />}
                      {node.type === "subtopic" && <FileText className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <span
                      className={`text-xs font-semibold ${colors.text} whitespace-normal break-words leading-tight flex-1 overflow-hidden`}
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {isUnit ? (
                        <>
                          <span className="text-blue-700">{unitNumber ?? "?"}.</span>{" "}
                          {node.title}
                        </>
                      ) : (
                        node.title
                      )}
                    </span>
                    {isUnit && topicCount > 0 && (
                      <button
                        type="button"
                        className="h-5 w-5 rounded-full border border-blue-300 bg-white/90 text-blue-700 flex items-center justify-center shrink-0 hover:bg-blue-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleUnitCollapse(node.id);
                        }}
                        title={isUnitCollapsed ? "Expand topics" : "Collapse topics"}
                      >
                        {isUnitCollapsed ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                      </button>
                    )}
                    {isTopic && subtopicCount > 0 && (
                      <button
                        type="button"
                        className="h-5 w-5 rounded-full border border-violet-300 bg-white/90 text-violet-700 flex items-center justify-center shrink-0 hover:bg-violet-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTopicCollapse(node.id);
                        }}
                        title={isTopicCollapsed ? "Expand subtopics" : "Collapse subtopics"}
                      >
                        {isTopicCollapsed ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                      </button>
                    )}
                    {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />}
                  </div>
                );
              })}

            </div>
          )}

          {viewMode === "map" && (
            <>
              {areAllUnitsCollapsed && (
                <div className="absolute left-3 bottom-3 z-20 pointer-events-none">
                  <div className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 shadow-sm">
                    <Info className="w-3.5 h-3.5" />
                    Scroll horizontally to view more units
                  </div>
                </div>
              )}
              <div className="absolute right-3 bottom-3 z-20 flex flex-col gap-2 rounded-xl border border-border/80 bg-card/95 backdrop-blur p-2 shadow-lg">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setZoom((z) => Math.min(2.2, z * ZOOM_STEP))}
                  title="Zoom in"
                >
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={handleZoomOut}
                  title="Zoom out"
                >
                  <ZoomOut className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
          </div>

          <div className="basis-[45%] w-[45%] max-w-[45%] grow-0 shrink-0 min-w-0 bg-card h-full overflow-hidden">
            {questionBankOpen ? (
              <QuestionBankPane
                configId={configId}
                examParam={examParam}
                initialQuestionId={latestInteractionState?.qbQuestionId ?? null}
                onClose={() => setQuestionBankOpen(false)}
              />
            ) : selectedNode ? (
              <ContentModal
                node={selectedNode}
                configId={configId}
                examParam={examParam}
                topicBundle={selectedTopicBundle || null}
                allNodesData={nodes ?? []}
                onTracked={() => setCompletionVersion((v) => v + 1)}
                isNodeCompleted={isNodeCompleted}
                onNavigate={navigateToNodeDetail}
                onClose={() => setSelectedNodeId(null)}
                embedded
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center mb-3">
                  <BookOpen className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Details Pane</h3>
                <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                  Click any topic/subtopic on the map, or open Question Bank, to view details here.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {!isDesktopMapView && selectedNode && (
          <ContentModal
            node={selectedNode}
            configId={configId}
            examParam={examParam}
            topicBundle={selectedTopicBundle || null}
            allNodesData={nodes ?? []}
            onTracked={() => setCompletionVersion((v) => v + 1)}
            isNodeCompleted={isNodeCompleted}
            onNavigate={navigateToNodeDetail}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!isDesktopMapView && questionBankOpen && (
          <QuestionBankModal
            configId={configId}
            examParam={examParam}
            initialQuestionId={latestInteractionState?.qbQuestionId ?? null}
            onClose={() => setQuestionBankOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ContentModal({
  node,
  configId,
  examParam,
  topicBundle,
  allNodesData,
  onTracked,
  isNodeCompleted,
  onNavigate,
  onClose,
  embedded = false,
}: {
  node: LayoutNode;
  configId: string;
  examParam: string;
  topicBundle: {
    configId: string;
    topic: {
      id: string;
      explanation: string | null;
      learningGoal: string | null;
      exampleBlock: string | null;
      supportNote: string | null;
      prerequisiteTitles: string[];
      prerequisiteNodeIds: string[];
      nextRecommendedTitles: string[];
      nextRecommendedNodeIds: string[];
    };
    subtopics: Array<{
      id: string;
      explanation: string | null;
      learningGoal: string | null;
      exampleBlock: string | null;
      supportNote: string | null;
      prerequisiteTitles: string[];
      prerequisiteNodeIds: string[];
      nextRecommendedTitles: string[];
      nextRecommendedNodeIds: string[];
    }>;
  } | null;
  allNodesData?: Array<{
    id: string;
    type: string;
    title: string;
    parentId?: string | null;
    sortOrder?: number;
    nextRecommendedNodeIds?: string[];
    nextRecommendedTitles?: string[];
  }>;
  onTracked?: () => void;
  isNodeCompleted?: (nodeId: string) => boolean;
  onNavigate: (nodeId: string) => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  const isTopic = node.type === "topic";
  const isSubtopic = node.type === "subtopic";
  const bundleSubtopicMap = useMemo(
    () => new Map((topicBundle?.subtopics || []).map((sub) => [sub.id, sub])),
    [topicBundle]
  );
  const content = isSubtopic ? (bundleSubtopicMap.get(node.id) ?? null) : null;
  const bundleTopic = isTopic ? topicBundle?.topic ?? null : null;
  const isLoading = (isTopic || isSubtopic) && !topicBundle;

  const user = getStoredUser();
  const isAdminViewer = (user?.role || "").toLowerCase() === "admin";
  const queryClient = useQueryClient();
  const updateSubtopicContentMutation = useUpdateSubtopicContent();
  const trackSessionKey =
    isSubtopic && user?.id
      ? getSubtopicTrackSessionKey(configId, user.id, node.id)
      : "";
  const trackEventMutation = useTrackEvent();
  const [isEditingExplanation, setIsEditingExplanation] = useState(false);
  const [explanationDraft, setExplanationDraft] = useState("");
  const [showExplanationPreview, setShowExplanationPreview] = useState(false);
  const [isTracked, setIsTracked] = useState(
    isSubtopic && !!trackSessionKey ? !!sessionStorage.getItem(trackSessionKey) : false
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isSubtopic && trackSessionKey) {
      setIsTracked(!!sessionStorage.getItem(trackSessionKey));
      return;
    }
    setIsTracked(false);
  }, [isSubtopic, trackSessionKey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, 500);
    return () => clearTimeout(timer);
  }, [node.id]);

  useEffect(() => {
    if (!isSubtopic || !user || (user.role !== "student" && user.role !== "super_student")) {
      return;
    }
    if (!content) return;
    const dedupeKey = trackSessionKey;
    if (sessionStorage.getItem(dedupeKey)) return;
    if (isTracked) return;
    if (trackTimerRef.current) return;

    // QB-like interaction condition: once content is opened for enough time,
    // count it as interacted without requiring scroll-to-bottom.
    trackTimerRef.current = setTimeout(() => {
      trackTimerRef.current = null;
      if (sessionStorage.getItem(dedupeKey)) return;

      trackEventMutation.mutate({
        data: {
          userId: user.id,
          universityId: user.universityId,
          year: user.year,
          branch: user.branch,
          exam: examParam,
          configId,
          topicId: node.parentId || "",
          subtopicId: node.id,
        }
      }, {
        onSuccess: () => {
          sessionStorage.setItem(dedupeKey, "true");
          sessionStorage.setItem(trackSessionKey, "true");
          setIsTracked(true);
          onTracked?.();
        }
      });
    }, 5000);

    return () => {
      if (trackTimerRef.current) {
        clearTimeout(trackTimerRef.current);
        trackTimerRef.current = null;
      }
    };
  }, [content, node.id, user, isTracked, isSubtopic, trackEventMutation, configId, examParam, node.parentId, onTracked, trackSessionKey]);

  const showDoneBadge = isTopic
    ? (isNodeCompleted?.(node.id) ?? false)
    : isSubtopic
    ? isTracked
    : false;

  const colors = NODE_COLORS[node.type as keyof typeof NODE_COLORS] || NODE_COLORS.topic;
  const guidanceSource = isSubtopic ? content : (bundleTopic ?? node);
  const currentTopicId = isTopic ? node.id : isSubtopic ? String(node.parentId || "").trim() : "";
  const topicParts = parseStructuredExplanation(String(bundleTopic?.explanation || ""), {
    learningGoal: String((bundleTopic as any)?.learningGoal || ""),
    exampleBlock: String((bundleTopic as any)?.exampleBlock || ""),
    supportNote: String((bundleTopic as any)?.supportNote || ""),
  });
  const subtopicParts = parseStructuredExplanation(String((content as any)?.explanation || ""), {
    learningGoal: String((content as any)?.learningGoal || ""),
    exampleBlock: String((content as any)?.exampleBlock || ""),
    supportNote: String((content as any)?.supportNote || ""),
  });
  const toOrder = (value: string | number | undefined) => {
    const n = Number(String(value || "").trim());
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };
  const fullNodes = allNodesData ?? [];
  const fullNodeById = new Map(fullNodes.map((n) => [String(n.id || ""), n]));
  const topicSubtopics = isTopic
    ? fullNodes
        .filter((n) => n.type === "subtopic" && String(n.parentId || "") === node.id)
        .sort((a, b) => toOrder(a.sortOrder) - toOrder(b.sortOrder))
    : [];
  const firstSubtopicId = isTopic ? String(topicSubtopics[0]?.id || "").trim() : "";
  const siblingTopics = isTopic
    ? fullNodes
        .filter((n) => n.type === "topic" && String(n.parentId || "") === String(node.parentId || ""))
        .sort((a, b) => toOrder(a.sortOrder) - toOrder(b.sortOrder))
    : [];
  const topicIndex = isTopic ? siblingTopics.findIndex((t) => t.id === node.id) : -1;
  const fallbackPrevTopic = topicIndex > 0 ? siblingTopics[topicIndex - 1] : null;
  const fallbackNextTopic = topicIndex >= 0 && topicIndex < siblingTopics.length - 1
    ? siblingTopics[topicIndex + 1]
    : null;

  const siblingSubtopics = isSubtopic
    ? fullNodes
        .filter((n) => n.type === "subtopic" && String(n.parentId || "") === String(node.parentId || ""))
        .sort((a, b) => toOrder(a.sortOrder) - toOrder(b.sortOrder))
    : [];
  const subtopicIndex = isSubtopic ? siblingSubtopics.findIndex((s) => s.id === node.id) : -1;
  const fallbackPrevSub = subtopicIndex > 0 ? siblingSubtopics[subtopicIndex - 1] : null;
  const fallbackNextSub =
    subtopicIndex >= 0 && subtopicIndex < siblingSubtopics.length - 1
      ? siblingSubtopics[subtopicIndex + 1]
      : null;
  const isValidTopicNeighbor = (candidateId: string) => {
    const target = fullNodeById.get(candidateId);
    return !!target && target.type === "topic" && String(target.parentId || "") === String(node.parentId || "");
  };
  const isValidSubtopicNeighbor = (candidateId: string) => {
    const target = fullNodeById.get(candidateId);
    return !!target && target.type === "subtopic" && String(target.parentId || "") === String(node.parentId || "");
  };

  const rawPrerequisiteTitle = String(guidanceSource?.prerequisiteTitles?.[0] || "").trim();
  const rawPrerequisiteNodeId = String(guidanceSource?.prerequisiteNodeIds?.[0] || "").trim();
  const rawNextTitle = String(guidanceSource?.nextRecommendedTitles?.[0] || "").trim();
  const rawNextNodeId = String(guidanceSource?.nextRecommendedNodeIds?.[0] || "").trim();

  const topicPrereqNodeId = isTopic
    ? (isValidTopicNeighbor(rawPrerequisiteNodeId) ? rawPrerequisiteNodeId : String(fallbackPrevTopic?.id || "").trim())
    : "";
  const topicNextNodeId = isTopic
    ? (isValidTopicNeighbor(rawNextNodeId) ? rawNextNodeId : String(fallbackNextTopic?.id || "").trim())
    : "";
  const topicPrereqTitle = isTopic
    ? (topicPrereqNodeId ? String(fullNodeById.get(topicPrereqNodeId)?.title || rawPrerequisiteTitle).trim() : "")
    : "";
  const topicNextTitle = isTopic
    ? (topicNextNodeId ? String(fullNodeById.get(topicNextNodeId)?.title || rawNextTitle).trim() : "")
    : "";

  const subtopicPrereqNodeId = isSubtopic
    ? (isValidSubtopicNeighbor(rawPrerequisiteNodeId) ? rawPrerequisiteNodeId : String(fallbackPrevSub?.id || "").trim())
    : "";
  const subtopicNextNodeId = isSubtopic
    ? (isValidSubtopicNeighbor(rawNextNodeId) ? rawNextNodeId : String(fallbackNextSub?.id || "").trim())
    : "";
  const subtopicPrereqTitle = isSubtopic
    ? (subtopicPrereqNodeId ? String(fullNodeById.get(subtopicPrereqNodeId)?.title || rawPrerequisiteTitle).trim() : "")
    : "";
  const subtopicNextTitle = isSubtopic
    ? (subtopicNextNodeId ? String(fullNodeById.get(subtopicNextNodeId)?.title || rawNextTitle).trim() : "")
    : "";

  const prerequisiteTitle = isTopic ? topicPrereqTitle : subtopicPrereqTitle;
  const prerequisiteNodeId = isTopic ? topicPrereqNodeId : subtopicPrereqNodeId;
  const nextTitle = isTopic ? topicNextTitle : subtopicNextTitle;
  const nextNodeId = isTopic ? topicNextNodeId : subtopicNextNodeId;
  const showExploreAction = isTopic && !!firstSubtopicId;
  const subtopicPathPrereqTitles = prerequisiteTitle ? [prerequisiteTitle] : [];
  const subtopicPathPrereqIds = prerequisiteNodeId ? [prerequisiteNodeId] : [];
  const subtopicPathNextTitles = nextTitle ? [nextTitle] : [];
  const subtopicPathNextIds = nextNodeId ? [nextNodeId] : [];

  const currentExplanationDraft = buildStructuredExplanationText(
    isSubtopic ? subtopicParts : topicParts
  );
  const editPreviewParts = parseStructuredExplanation(explanationDraft);

  useEffect(() => {
    setIsEditingExplanation(false);
    setShowExplanationPreview(false);
    setExplanationDraft(currentExplanationDraft);
  }, [node.id, currentExplanationDraft]);

  const handleSaveExplanation = () => {
    const normalizedExplanation = String(explanationDraft || "")
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
    updateSubtopicContentMutation.mutate(
      {
        id: node.id,
        data: {
          explanation: normalizedExplanation,
        },
      },
      {
        onSuccess: () => {
          setIsEditingExplanation(false);
          setShowExplanationPreview(false);
          queryClient.invalidateQueries({ queryKey: ["subtopic-content", node.id] });
          if (currentTopicId) {
            queryClient.invalidateQueries({ queryKey: ["topic-content-bundle", configId, currentTopicId] });
          }
          queryClient.invalidateQueries({ queryKey: ["config-question-bank", configId] });
        },
      }
    );
  };

  if (embedded) {
    return (
      <div className="h-full flex flex-col border border-border bg-card overflow-hidden">
        <div className={`flex items-center justify-between px-5 py-4 border-b border-border shrink-0 ${colors.light}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-8 h-8 rounded-lg ${colors.bg} flex items-center justify-center shrink-0`}>
              {isTopic ? <BookOpen className="w-4 h-4 text-white" /> : <FileText className="w-4 h-4 text-white" />}
            </div>
            <div className="min-w-0">
              <h2 className="font-display font-bold text-foreground truncate text-base">{node.title}</h2>
              <p className="text-xs text-muted-foreground capitalize">{node.type}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showExploreAction && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate(firstSubtopicId)}
                className="h-8 rounded-full border-blue-300 bg-blue-50 px-3 text-blue-800 hover:bg-blue-100"
                title="Explore subtopics"
              >
                Explore
              </Button>
            )}
            {showDoneBadge && (
              <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-full border border-green-200 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Done
              </span>
            )}
            {isAdminViewer && (
              <>
                {!isEditingExplanation ? (
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setIsEditingExplanation(true)}>
                    <Pencil className="w-3 h-3 mr-1" /> Edit
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowExplanationPreview((p) => !p)}>
                      Preview
                    </Button>
                    <Button size="sm" className="h-8 text-xs" onClick={handleSaveExplanation} disabled={updateSubtopicContentMutation.isPending}>
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => {
                        setIsEditingExplanation(false);
                        setShowExplanationPreview(false);
                        setExplanationDraft(currentExplanationDraft);
                      }}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-6">
          {isTopic && (
            <>
              <PathNavBlock
                prerequisiteTitles={topicPrereqTitle ? [topicPrereqTitle] : []}
                nextRecommendedTitles={topicNextTitle ? [topicNextTitle] : []}
                prerequisiteNodeIds={topicPrereqNodeId ? [topicPrereqNodeId] : []}
                nextRecommendedNodeIds={topicNextNodeId ? [topicNextNodeId] : []}
                isNodeCompleted={isNodeCompleted}
                onNavigate={onNavigate}
              />
              {isAdminViewer && isEditingExplanation && (
                <section className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
                  <Textarea
                    value={explanationDraft}
                    onChange={(e) => setExplanationDraft(e.target.value)}
                    rows={16}
                    className="text-sm bg-background font-mono"
                  />
                  {showExplanationPreview && (
                    <div className="space-y-4 rounded-lg border border-border bg-background p-3">
                      <LearningGoalBlock learningGoal={editPreviewParts.learningGoal} />
                      <div className="prose prose-sm prose-slate max-w-none prose-p:text-foreground/70">
                        <div className="flex items-center gap-2 mb-2">
                          <PenLine className="w-3.5 h-3.5 text-primary" />
                          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Core Idea</h3>
                        </div>
                        <div className="text-foreground/70 font-medium">
                          <AnswerRenderer answer={editPreviewParts.coreExplanation} />
                        </div>
                      </div>
                      <ExampleBlock text={editPreviewParts.exampleBlock} />
                      <SupportNoteBlock text={editPreviewParts.supportNote} />
                    </div>
                  )}
                </section>
              )}
              {!isEditingExplanation && (
                <>
                  <LearningGoalBlock learningGoal={topicParts.learningGoal} />
                  <div className="px-4">
                    <div className="prose prose-sm prose-slate max-w-none prose-p:text-foreground/70">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                        <PenLine className="w-3.5 h-3.5 text-primary" />
                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Core Idea</h3>
                        </div>
                      </div>
                      {isLoading ? (
                        <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-5 min-h-[240px]">
                          <div className="h-6 bg-muted animate-pulse rounded w-11/12" />
                          <div className="h-6 bg-muted animate-pulse rounded w-10/12" />
                          <div className="h-6 bg-muted animate-pulse rounded w-9/12" />
                          <div className="h-6 bg-muted animate-pulse rounded w-8/12" />
                          <div className="h-6 bg-muted animate-pulse rounded w-7/12" />
                          <div className="h-6 bg-muted animate-pulse rounded w-6/12" />
                        </div>
                      ) : topicParts.coreExplanation ? (
                        <div className="text-foreground/70 font-medium">
                          <AnswerRenderer answer={topicParts.coreExplanation} />
                        </div>
                      ) : (
                        <p className="text-muted-foreground italic">No explanation available for this topic.</p>
                      )}
                    </div>
                  </div>
                  <ExampleBlock text={topicParts.exampleBlock} />
                  <SupportNoteBlock text={topicParts.supportNote} />
                </>
              )}
              <PathNavBlock
                prerequisiteTitles={prerequisiteTitle ? [prerequisiteTitle] : []}
                nextRecommendedTitles={nextTitle ? [nextTitle] : []}
                prerequisiteNodeIds={prerequisiteNodeId ? [prerequisiteNodeId] : []}
                nextRecommendedNodeIds={nextNodeId ? [nextNodeId] : []}
                isNodeCompleted={isNodeCompleted}
                onNavigate={onNavigate}
              />
            </>
          )}

          {isSubtopic && (
            <>
              {isLoading ? (
                <div className="space-y-4">
                  <div className="h-6 bg-muted animate-pulse rounded w-1/2" />
                  <div className="h-24 bg-muted animate-pulse rounded-xl" />
                  <div className="h-40 bg-muted animate-pulse rounded-xl" />
                </div>
              ) : content ? (
                <>
                  <section>
                    <div className="space-y-6">
                      {isAdminViewer && isEditingExplanation && (
                        <section className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
                          <Textarea
                            value={explanationDraft}
                            onChange={(e) => setExplanationDraft(e.target.value)}
                            rows={16}
                            className="text-sm bg-background font-mono"
                          />
                          {showExplanationPreview && (
                            <div className="space-y-4 rounded-lg border border-border bg-background p-3">
                              <LearningGoalBlock learningGoal={editPreviewParts.learningGoal} />
                              <div className="prose prose-sm prose-slate max-w-none prose-p:text-foreground/70">
                                <div className="flex items-center gap-2 mb-2">
                                  <PenLine className="w-3.5 h-3.5 text-primary" />
                                  <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Core Idea</h3>
                                </div>
                                <div className="text-foreground/70 font-medium">
                                  <AnswerRenderer answer={editPreviewParts.coreExplanation} />
                                </div>
                              </div>
                              <ExampleBlock text={editPreviewParts.exampleBlock} />
                              <SupportNoteBlock text={editPreviewParts.supportNote} />
                            </div>
                          )}
                        </section>
                      )}
                      <PathNavBlock
                        prerequisiteTitles={subtopicPathPrereqTitles}
                        nextRecommendedTitles={subtopicPathNextTitles}
                        prerequisiteNodeIds={subtopicPathPrereqIds}
                        nextRecommendedNodeIds={subtopicPathNextIds}
                        isNodeCompleted={isNodeCompleted}
                        onNavigate={onNavigate}
                      />
                      {!isEditingExplanation && (
                        <LearningGoalBlock learningGoal={subtopicParts.learningGoal} />
                      )}
                    </div>
                    {!isEditingExplanation && (
                      <div className="px-4">
                        <div className="prose prose-sm prose-slate max-w-none mt-4 prose-p:text-foreground/70">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                            <PenLine className="w-3.5 h-3.5 text-primary" />
                            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Core Idea</h3>
                            </div>
                          </div>
                          <div className="text-foreground/70 font-medium">
                            <AnswerRenderer answer={subtopicParts.coreExplanation} />
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
                  {!isEditingExplanation && (
                    <>
                      <ExampleBlock text={subtopicParts.exampleBlock} />
                      <SupportNoteBlock text={subtopicParts.supportNote} />
                    </>
                  )}
                  <PathNavBlock
                    prerequisiteTitles={prerequisiteTitle ? [prerequisiteTitle] : []}
                    nextRecommendedTitles={nextTitle ? [nextTitle] : []}
                    prerequisiteNodeIds={prerequisiteNodeId ? [prerequisiteNodeId] : []}
                    nextRecommendedNodeIds={nextNodeId ? [nextNodeId] : []}
                    isNodeCompleted={isNodeCompleted}
                    onNavigate={onNavigate}
                  />
                </>
              ) : (
                <div className="text-center py-8">
                  <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                  <p className="text-muted-foreground text-sm">Content not available.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.97 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="relative bg-card rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl h-[92dvh] sm:h-auto max-h-[92dvh] sm:max-h-[80vh] min-h-[55vh] sm:min-h-[40vh] flex flex-col shadow-2xl border border-border overflow-hidden pb-[max(env(safe-area-inset-bottom),0.5rem)]"
      >
        <div className={`flex items-center justify-between px-5 sm:px-6 py-4 border-b border-border shrink-0 ${colors.light}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-8 h-8 rounded-lg ${colors.bg} flex items-center justify-center shrink-0`}>
              {isTopic ? <BookOpen className="w-4 h-4 text-white" /> : <FileText className="w-4 h-4 text-white" />}
            </div>
            <div className="min-w-0">
              <h2 className="font-display font-bold text-foreground truncate text-base sm:text-lg">{node.title}</h2>
              <p className="text-xs text-muted-foreground capitalize">{node.type}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showExploreAction && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate(firstSubtopicId)}
                className="h-8 rounded-full border-blue-300 bg-blue-50 px-3 text-blue-800 hover:bg-blue-100"
                title="Explore subtopics"
              >
                Explore
              </Button>
            )}
            {showDoneBadge && (
              <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-full border border-green-200 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Done
              </span>
            )}
            {isAdminViewer && (
              <>
                {!isEditingExplanation ? (
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setIsEditingExplanation(true)}>
                    <Pencil className="w-3 h-3 mr-1" /> Edit
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowExplanationPreview((p) => !p)}>
                      Preview
                    </Button>
                    <Button size="sm" className="h-8 text-xs" onClick={handleSaveExplanation} disabled={updateSubtopicContentMutation.isPending}>
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => {
                        setIsEditingExplanation(false);
                        setShowExplanationPreview(false);
                        setExplanationDraft(currentExplanationDraft);
                      }}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {isTopic && (
            <>
              <PathNavBlock
                prerequisiteTitles={topicPrereqTitle ? [topicPrereqTitle] : []}
                nextRecommendedTitles={topicNextTitle ? [topicNextTitle] : []}
                prerequisiteNodeIds={topicPrereqNodeId ? [topicPrereqNodeId] : []}
                nextRecommendedNodeIds={topicNextNodeId ? [topicNextNodeId] : []}
                isNodeCompleted={isNodeCompleted}
                onNavigate={onNavigate}
              />
              {isAdminViewer && isEditingExplanation && (
                <section className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
                  <Textarea
                    value={explanationDraft}
                    onChange={(e) => setExplanationDraft(e.target.value)}
                    rows={16}
                    className="text-sm bg-background font-mono"
                  />
                  {showExplanationPreview && (
                    <div className="space-y-4 rounded-lg border border-border bg-background p-3">
                      <LearningGoalBlock learningGoal={editPreviewParts.learningGoal} />
                      <div className="prose prose-sm prose-slate max-w-none prose-p:text-foreground/70">
                        <div className="flex items-center gap-2 mb-2">
                          <PenLine className="w-3.5 h-3.5 text-primary" />
                          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Core Idea</h3>
                        </div>
                        <AnswerRenderer answer={editPreviewParts.coreExplanation} />
                      </div>
                      <ExampleBlock text={editPreviewParts.exampleBlock} />
                      <SupportNoteBlock text={editPreviewParts.supportNote} />
                    </div>
                  )}
                </section>
              )}
              {!isEditingExplanation && (
                <>
                  <LearningGoalBlock learningGoal={topicParts.learningGoal} />
                  <div className="prose prose-sm sm:prose-base prose-slate max-w-none">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <PenLine className="w-3.5 h-3.5 text-primary" />
                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Core Idea</h3>
                      </div>
                    </div>
                    {isLoading ? (
                      <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-5 min-h-[240px]">
                        <div className="h-6 bg-muted animate-pulse rounded w-11/12" />
                        <div className="h-6 bg-muted animate-pulse rounded w-10/12" />
                        <div className="h-6 bg-muted animate-pulse rounded w-9/12" />
                        <div className="h-6 bg-muted animate-pulse rounded w-8/12" />
                        <div className="h-6 bg-muted animate-pulse rounded w-7/12" />
                        <div className="h-6 bg-muted animate-pulse rounded w-6/12" />
                      </div>
                    ) : topicParts.coreExplanation ? (
                      <AnswerRenderer answer={topicParts.coreExplanation} />
                    ) : (
                      <p className="text-muted-foreground italic">No explanation available for this topic.</p>
                    )}
                  </div>
                  <ExampleBlock text={topicParts.exampleBlock} />
                  <SupportNoteBlock text={topicParts.supportNote} />
                </>
              )}
              <PathNavBlock
                prerequisiteTitles={prerequisiteTitle ? [prerequisiteTitle] : []}
                nextRecommendedTitles={nextTitle ? [nextTitle] : []}
                prerequisiteNodeIds={prerequisiteNodeId ? [prerequisiteNodeId] : []}
                nextRecommendedNodeIds={nextNodeId ? [nextNodeId] : []}
                isNodeCompleted={isNodeCompleted}
                onNavigate={onNavigate}
              />
            </>
          )}

          {isSubtopic && (
            <>
              {isLoading ? (
                <div className="space-y-4">
                  <div className="h-6 bg-muted animate-pulse rounded w-1/2" />
                  <div className="h-24 bg-muted animate-pulse rounded-xl" />
                  <div className="h-40 bg-muted animate-pulse rounded-xl" />
                </div>
              ) : content ? (
                <>
                  <section>
                    {isAdminViewer && isEditingExplanation && (
                      <section className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
                        <Textarea
                          value={explanationDraft}
                          onChange={(e) => setExplanationDraft(e.target.value)}
                          rows={16}
                          className="text-sm bg-background font-mono"
                        />
                        {showExplanationPreview && (
                          <div className="space-y-4 rounded-lg border border-border bg-background p-3">
                            <LearningGoalBlock learningGoal={editPreviewParts.learningGoal} />
                            <div className="prose prose-sm prose-slate max-w-none prose-p:text-foreground/70">
                              <div className="flex items-center gap-2 mb-2">
                                <PenLine className="w-3.5 h-3.5 text-primary" />
                                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Core Idea</h3>
                              </div>
                              <AnswerRenderer answer={editPreviewParts.coreExplanation} />
                            </div>
                            <ExampleBlock text={editPreviewParts.exampleBlock} />
                            <SupportNoteBlock text={editPreviewParts.supportNote} />
                          </div>
                        )}
                      </section>
                    )}
                    <div className="space-y-6">
                      <PathNavBlock
                        prerequisiteTitles={subtopicPathPrereqTitles}
                        nextRecommendedTitles={subtopicPathNextTitles}
                        prerequisiteNodeIds={subtopicPathPrereqIds}
                        nextRecommendedNodeIds={subtopicPathNextIds}
                        isNodeCompleted={isNodeCompleted}
                        onNavigate={onNavigate}
                      />
                      {!isEditingExplanation && (
                        <LearningGoalBlock learningGoal={subtopicParts.learningGoal} />
                      )}
                    </div>
                    {!isEditingExplanation && (
                      <div className="prose prose-sm prose-slate max-w-none bg-secondary/30 rounded-xl p-4 border border-border">
                        <div className="font-medium">
                          <AnswerRenderer answer={subtopicParts.coreExplanation} />
                        </div>
                      </div>
                    )}
                  </section>
                  {!isEditingExplanation && (
                    <>
                      <ExampleBlock text={subtopicParts.exampleBlock} />
                      <SupportNoteBlock text={subtopicParts.supportNote} />
                    </>
                  )}
                  <PathNavBlock
                    prerequisiteTitles={prerequisiteTitle ? [prerequisiteTitle] : []}
                    nextRecommendedTitles={nextTitle ? [nextTitle] : []}
                    prerequisiteNodeIds={prerequisiteNodeId ? [prerequisiteNodeId] : []}
                    nextRecommendedNodeIds={nextNodeId ? [nextNodeId] : []}
                    isNodeCompleted={isNodeCompleted}
                    onNavigate={onNavigate}
                  />

                  <div className="h-6 w-full flex items-center justify-center">
                    <div className="w-1/2 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                  <p className="text-muted-foreground text-sm">Content not available.</p>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function QuestionCard({ label, question, answer }: { label: string; question: string; answer: string }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      <div className="p-4 border-b border-border bg-secondary/20">
        <div className="flex items-start gap-2">
          <span className="shrink-0 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider">
            {label}
          </span>
          <p className="text-sm font-semibold text-foreground leading-snug whitespace-pre-line">{renderInlineCodeText(question)}</p>
        </div>
      </div>
      <div className="p-4">
        <div className="text-sm text-foreground/80 leading-relaxed">
          <AnswerRenderer answer={repairBrokenFormulaBullets(answer)} />
        </div>
      </div>
    </div>
  );
}

function QuestionBankModal({
  configId,
  examParam,
  initialQuestionId,
  onClose,
}: {
  configId: string;
  examParam: string;
  initialQuestionId: number | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useGetQuestionBank(configId, {
    staleTime: CLIENT_CACHE_BYPASS ? 0 : 60 * 60 * 1000,
    gcTime: CLIENT_CACHE_BYPASS ? 0 : 60 * 60 * 1000,
    refetchOnWindowFocus: CLIENT_CACHE_BYPASS ? true : false,
    refetchOnMount: CLIENT_CACHE_BYPASS ? "always" : true,
  });
  const validQuestions = useMemo(
    () => data?.questions ?? [],
    [data?.questions]
  );
  const seededHash = useCallback((value: string) => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }, []);

  const distributeStarred = useCallback(
    <T extends { id: number; isStarred?: boolean }>(items: T[]): T[] => {
      if (items.length <= 2) return items;

      const starred = items
        .filter((q) => !!q.isStarred)
        .slice()
        .sort((a, b) => seededHash(`${configId}:${a.id}`) - seededHash(`${configId}:${b.id}`));
      const nonStarred = items
        .filter((q) => !q.isStarred)
        .slice()
        .sort((a, b) => seededHash(`${configId}:${a.id}`) - seededHash(`${configId}:${b.id}`));

      if (starred.length === 0 || nonStarred.length === 0) {
        return [...items].sort(
          (a, b) => seededHash(`${configId}:${a.id}`) - seededHash(`${configId}:${b.id}`),
        );
      }

      const total = items.length;
      const out: T[] = new Array(total);
      const starredSlots = new Set<number>();
      for (let i = 0; i < starred.length; i++) {
        const slot = Math.min(total - 1, Math.floor(((i + 0.5) * total) / starred.length));
        let s = slot;
        while (starredSlots.has(s) && s < total - 1) s++;
        while (starredSlots.has(s) && s > 0) s--;
        starredSlots.add(s);
      }

      let si = 0;
      let ni = 0;
      for (let i = 0; i < total; i++) {
        if (starredSlots.has(i) && si < starred.length) {
          out[i] = starred[si++];
        } else if (ni < nonStarred.length) {
          out[i] = nonStarred[ni++];
        } else if (si < starred.length) {
          out[i] = starred[si++];
        }
      }
      return out.filter(Boolean);
    },
    [configId, seededHash],
  );

  const foundational = useMemo(
    () => distributeStarred(validQuestions.filter((q) => q.markType === "Foundational")),
    [validQuestions, distributeStarred],
  );
  const applied = useMemo(
    () => distributeStarred(validQuestions.filter((q) => q.markType === "Applied")),
    [validQuestions, distributeStarred],
  );
  const foundationalNumberById = useMemo(
    () => new Map(foundational.map((q, idx) => [q.id, idx + 1])),
    [foundational]
  );
  const appliedNumberById = useMemo(
    () => new Map(applied.map((q, idx) => [q.id, idx + 1])),
    [applied]
  );
  const [selectedQuestion, setSelectedQuestion] = useState<{
    id: number;
    number: number;
    label: string;
    starred: boolean;
    codeStyle: CodeStyle;
    question: string;
    context: string;
    answer: string;
    subtopicId: string;
  } | null>(null);
  const [qbSectionFilter, setQbSectionFilter] = useState<"all" | "foundational" | "applied">("all");
  const [highlightedQuestionId, setHighlightedQuestionId] = useState<number | null>(null);
  const resumeAppliedRef = useRef(false);
  const user = getStoredUser();
  const isAdminViewer = (user?.role || "").toLowerCase() === "admin";
  const queryClient = useQueryClient();
  const trackEventMutation = useTrackEvent();
  const updateQuestionBankQuestionMutation = useUpdateQuestionBankQuestion();
  const answerTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const [questionInteractionVersion, setQuestionInteractionVersion] = useState(0);
  const [expandedEditMode, setExpandedEditMode] = useState(false);
  const [expandedEditPreview, setExpandedEditPreview] = useState(false);
  const [expandedQuestionDraft, setExpandedQuestionDraft] = useState("");
  const [expandedAnswerDraft, setExpandedAnswerDraft] = useState("");
  const listScrollRef = useRef<HTMLDivElement>(null);
  const listScrollTopRef = useRef(0);

  const questionSessionKey = useCallback(
    (questionId: number) => `tracked_qb_${configId}_${questionId}`,
    [configId]
  );

  const hasQuestionInteraction = useCallback(
    (questionId: number) => !!sessionStorage.getItem(questionSessionKey(questionId)),
    [questionSessionKey, questionInteractionVersion]
  );

  useEffect(() => {
    resumeAppliedRef.current = false;
    setHighlightedQuestionId(null);
    setQbSectionFilter("all");
  }, [configId]);

  useEffect(() => {
    if (resumeAppliedRef.current) return;
    if (!Number.isFinite(initialQuestionId ?? NaN) || validQuestions.length === 0) return;
    resumeAppliedRef.current = true;
    const qid = Number(initialQuestionId);
    if (!Number.isFinite(qid) || !validQuestions.some((q) => q.id === qid)) return;
    setHighlightedQuestionId(qid);
    const el = document.getElementById(`qb-card-modal-${qid}`);
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    window.setTimeout(() => setHighlightedQuestionId((curr) => (curr === qid ? null : curr)), 6000);
  }, [initialQuestionId, validQuestions]);

  useEffect(() => {
    return () => {
      for (const timer of answerTimersRef.current.values()) {
        clearTimeout(timer);
      }
      answerTimersRef.current.clear();
    };
  }, []);

  const clearQuestionInteractionTrack = (questionId: number) => {
    const timer = answerTimersRef.current.get(questionId);
    if (timer) {
      clearTimeout(timer);
      answerTimersRef.current.delete(questionId);
    }
  };

  const scheduleQuestionInteractionTrack = (
    questionId: number,
    subtopicId?: string | null,
    delayMs: number = 10000
  ) => {
    if (!user || (user.role !== "student" && user.role !== "super_student")) return;
    const sessionKey = questionSessionKey(questionId);
    if (sessionStorage.getItem(sessionKey)) return;
    if (answerTimersRef.current.has(questionId)) return;

    const timer = setTimeout(() => {
      answerTimersRef.current.delete(questionId);
      if (sessionStorage.getItem(sessionKey)) return;

      trackEventMutation.mutate(
        {
          data: {
            userId: user.id,
            universityId: user.universityId,
            year: user.year,
            branch: user.branch,
            exam: examParam,
            configId,
            topicId: `${QUESTION_BANK_EVENT_PREFIX}${questionId}`,
            subtopicId: String(subtopicId || "").trim() || undefined,
            questionId: String(questionId),
          },
        },
        {
          onSuccess: () => {
            sessionStorage.setItem(sessionKey, "true");
            setQuestionInteractionVersion((v) => v + 1);
          },
        },
      );
    }, delayMs);

    answerTimersRef.current.set(questionId, timer);
  };

  useEffect(() => {
    if (!selectedQuestion) return;
    scheduleQuestionInteractionTrack(selectedQuestion.id, selectedQuestion.subtopicId, 5000);
    return () => {
      clearQuestionInteractionTrack(selectedQuestion.id);
    };
  }, [selectedQuestion]);
  useEffect(() => {
    if (!selectedQuestion) {
      setExpandedEditMode(false);
      setExpandedEditPreview(false);
      setExpandedQuestionDraft("");
      setExpandedAnswerDraft("");
      return;
    }
    setExpandedQuestionDraft(selectedQuestion.question);
    setExpandedAnswerDraft(selectedQuestion.answer);
  }, [selectedQuestion]);

  const saveQuestionEdit = async (
    q: { id: number },
    next: { question: string; answer: string },
  ) => {
    await updateQuestionBankQuestionMutation.mutateAsync({
      configId,
      questionId: q.id,
      question: next.question,
      answer: next.answer,
    });
    await queryClient.invalidateQueries({ queryKey: ["config-question-bank", configId] });
    setSelectedQuestion((prev) =>
      prev && prev.id === q.id
        ? { ...prev, question: next.question, answer: next.answer }
        : prev
    );
  };

  const openQuestionDetail = useCallback(
    (
      q: (typeof validQuestions)[number],
      label: "Foundational" | "Applied",
      number: number,
    ) => {
      listScrollTopRef.current = listScrollRef.current?.scrollTop ?? 0;
      setSelectedQuestion({
        id: q.id,
        number,
        label,
        starred: !!q.isStarred,
        codeStyle: detectCodeStyle(q.answer),
        question: q.question,
        context: formatQuestionContext(q.unitTitle, q.topicTitle, q.subtopicTitle),
        answer: q.answer,
        subtopicId: q.subtopicId,
      });
    },
    [validQuestions],
  );

  const displayedOrderedQuestions = useMemo(
    () =>
      [
        ...(qbSectionFilter === "all" || qbSectionFilter === "foundational"
          ? foundational.map((q) => ({
              q,
              label: "Foundational" as const,
              number: foundationalNumberById.get(q.id) ?? 0,
            }))
          : []),
        ...(qbSectionFilter === "all" || qbSectionFilter === "applied"
          ? applied.map((q) => ({
              q,
              label: "Applied" as const,
              number: appliedNumberById.get(q.id) ?? 0,
            }))
          : []),
      ],
    [qbSectionFilter, foundational, applied, foundationalNumberById, appliedNumberById],
  );

  const selectedQuestionIndex = useMemo(
    () => displayedOrderedQuestions.findIndex((row) => row.q.id === selectedQuestion?.id),
    [displayedOrderedQuestions, selectedQuestion?.id],
  );
  const previousDisplayedQuestion =
    selectedQuestionIndex > 0 ? displayedOrderedQuestions[selectedQuestionIndex - 1] : null;
  const nextDisplayedQuestion =
    selectedQuestionIndex >= 0 && selectedQuestionIndex < displayedOrderedQuestions.length - 1
      ? displayedOrderedQuestions[selectedQuestionIndex + 1]
      : null;

  useEffect(() => {
    if (selectedQuestion !== null) return;
    requestAnimationFrame(() => {
      if (listScrollRef.current) {
        listScrollRef.current.scrollTop = listScrollTopRef.current;
      }
    });
  }, [selectedQuestion]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.97 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="relative bg-card rounded-t-2xl sm:rounded-2xl w-full sm:max-w-4xl h-[92dvh] sm:h-auto max-h-[92dvh] sm:max-h-[88vh] min-h-[55vh] flex flex-col shadow-2xl border border-border overflow-hidden pb-[max(env(safe-area-inset-bottom),0.5rem)]"
      >
        <div className="px-5 sm:px-6 py-4 border-b border-border shrink-0 bg-blue-50">
          <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-foreground truncate text-base sm:text-lg flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-600" />
              Question Bank
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {data ? `${validQuestions.length} total questions` : "Loading questions..."}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {selectedQuestion === null && validQuestions.length > 0 && (
              <div className="hidden sm:flex items-center gap-2">
                <Button
                  variant={qbSectionFilter === "all" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs font-medium"
                  onClick={() => setQbSectionFilter("all")}
                >
                  All ({validQuestions.length})
                </Button>
                <Button
                  variant={qbSectionFilter === "foundational" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs font-medium"
                  onClick={() => setQbSectionFilter("foundational")}
                >
                  Foundational ({foundational.length})
                </Button>
                <Button
                  variant={qbSectionFilter === "applied" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs font-medium"
                  onClick={() => setQbSectionFilter("applied")}
                >
                  Applied ({applied.length})
                </Button>
              </div>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="w-4 h-4" />
            </Button>
          </div>
          </div>
          {selectedQuestion === null && validQuestions.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 sm:hidden">
              <Button
                variant={qbSectionFilter === "all" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs font-medium"
                onClick={() => setQbSectionFilter("all")}
              >
                All ({validQuestions.length})
              </Button>
              <Button
                variant={qbSectionFilter === "foundational" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs font-medium"
                onClick={() => setQbSectionFilter("foundational")}
              >
                Foundational ({foundational.length})
              </Button>
              <Button
                variant={qbSectionFilter === "applied" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs font-medium"
                onClick={() => setQbSectionFilter("applied")}
              >
                Applied ({applied.length})
              </Button>
            </div>
          )}
        </div>

        <div ref={listScrollRef} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {selectedQuestion ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => setSelectedQuestion(null)}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back to Question List
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={!previousDisplayedQuestion}
                    onClick={() =>
                      previousDisplayedQuestion &&
                      openQuestionDetail(
                        previousDisplayedQuestion.q,
                        previousDisplayedQuestion.label,
                        previousDisplayedQuestion.number,
                      )
                    }
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={!nextDisplayedQuestion}
                    onClick={() =>
                      nextDisplayedQuestion &&
                      openQuestionDetail(
                        nextDisplayedQuestion.q,
                        nextDisplayedQuestion.label,
                        nextDisplayedQuestion.number,
                      )
                    }
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
              <div className="relative bg-card border border-blue-200 rounded-xl overflow-hidden shadow-sm">
                {selectedQuestion.codeStyle !== "none" && (
                  <div
                    className="absolute top-0 right-0 z-20 bg-rose-200 text-black text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-bl-md"
                    title="Contains code example"
                  >
                    {codeStyleBadgeText(selectedQuestion.codeStyle)}
                  </div>
                )}
                <div className="p-4 border-b border-blue-100 bg-blue-50/60">
                  <div className="sm:hidden space-y-3">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="shrink-0 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider">
                        Q{selectedQuestion.number}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wider">
                        {selectedQuestion.label}
                      </span>
                      {hasQuestionInteraction(selectedQuestion.id) && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider">
                          Interacted
                        </span>
                      )}
                      {selectedQuestion.starred && (
                        <Star
                          className="shrink-0 w-3.5 h-3.5 mt-0.5 text-amber-500 fill-amber-400"
                          aria-label="Starred question"
                        />
                      )}
                      {isAdminViewer && (
                        <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => setExpandedEditMode(true)}>
                          <Pencil className="w-3 h-3 mr-1" /> Edit
                        </Button>
                      )}
                    </div>
                    <div className="w-full rounded-lg border border-blue-100 bg-white/70 p-3">
                      <p className="text-sm font-semibold text-foreground leading-snug whitespace-pre-line">{renderInlineCodeText(selectedQuestion.question)}</p>
                      {selectedQuestion.context && (
                        <p className="text-xs text-muted-foreground mt-1 break-words">{renderInlineCodeText(selectedQuestion.context)}</p>
                      )}
                    </div>
                  </div>

                  <div className="hidden sm:flex items-start gap-2">
                    <span className="shrink-0 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider">
                      Q{selectedQuestion.number}
                    </span>
                    <div className="shrink-0 flex flex-col items-start gap-1">
                      <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wider">
                        {selectedQuestion.label}
                      </span>
                      {hasQuestionInteraction(selectedQuestion.id) && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider">
                          Interacted
                        </span>
                      )}
                    </div>
                    {selectedQuestion.starred && (
                      <Star
                        className="shrink-0 w-3.5 h-3.5 mt-0.5 text-amber-500 fill-amber-400"
                        aria-label="Starred question"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground leading-snug whitespace-pre-line">{renderInlineCodeText(selectedQuestion.question)}</p>
                      {selectedQuestion.context && (
                        <p className="text-xs text-muted-foreground mt-1 break-words">{renderInlineCodeText(selectedQuestion.context)}</p>
                      )}
                    </div>
                    {isAdminViewer && (
                      <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs shrink-0" onClick={() => setExpandedEditMode(true)}>
                        <Pencil className="w-3 h-3 mr-1" /> Edit
                      </Button>
                    )}
                  </div>
                </div>
                <div className="p-4">
                  {isAdminViewer && expandedEditMode ? (
                    <div className="space-y-3">
                      <Textarea value={expandedQuestionDraft} onChange={(e) => setExpandedQuestionDraft(e.target.value)} rows={4} className="text-sm" />
                      <Textarea value={expandedAnswerDraft} onChange={(e) => setExpandedAnswerDraft(e.target.value)} rows={8} className="text-sm font-mono" />
                      {expandedEditPreview && (
                        <div className="rounded-lg border border-border bg-secondary/20 p-3">
                          <AnswerRenderer answer={expandedAnswerDraft} />
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setExpandedEditPreview((p) => !p)}>
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          onClick={async () => {
                            await saveQuestionEdit(
                              { id: selectedQuestion.id },
                              { question: expandedQuestionDraft, answer: expandedAnswerDraft }
                            );
                            setExpandedEditMode(false);
                            setExpandedEditPreview(false);
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => {
                            setExpandedEditMode(false);
                            setExpandedEditPreview(false);
                            setExpandedQuestionDraft(selectedQuestion.question);
                            setExpandedAnswerDraft(selectedQuestion.answer);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <AnswerRenderer answer={selectedQuestion.answer} />
                  )}
                </div>
              </div>
            </section>
          ) : (
          isLoading ? (
            <div className="space-y-4">
              <div className="h-6 bg-muted animate-pulse rounded w-1/3" />
              <div className="h-24 bg-muted animate-pulse rounded-xl" />
              <div className="h-24 bg-muted animate-pulse rounded-xl" />
            </div>
          ) : isError ? (
            <div className="text-center py-8">
              <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-muted-foreground text-sm">Failed to load question bank.</p>
            </div>
          ) : validQuestions.length ? (
            <>
              {(qbSectionFilter === "all" || qbSectionFilter === "foundational") && (
                <section className="space-y-3">
                  {foundational.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No foundational questions yet.</p>
                  ) : (
                    foundational.map((q) => (
                        <QuestionBankCard
                          key={q.id}
                        onOpenDetail={() => openQuestionDetail(q, "Foundational", foundationalNumberById.get(q.id) ?? 0)}
                        cardId={`qb-card-modal-${q.id}`}
                        highlighted={highlightedQuestionId === q.id}
                        questionNumber={foundationalNumberById.get(q.id) ?? 0}
                        interacted={hasQuestionInteraction(q.id)}
                        label="Foundational"
                        starred={!!q.isStarred}
                          codeStyle={detectCodeStyle(q.answer)}
                          question={q.question}
                          answer={q.answer}
                          context={formatQuestionContext(q.unitTitle, q.topicTitle, q.subtopicTitle)}
                        />
                    ))
                  )}
                </section>
              )}

              {(qbSectionFilter === "all" || qbSectionFilter === "applied") && (
                <section className="space-y-3">
                  {applied.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No applied questions yet.</p>
                  ) : (
                    applied.map((q) => (
                        <QuestionBankCard
                          key={q.id}
                        onOpenDetail={() => openQuestionDetail(q, "Applied", appliedNumberById.get(q.id) ?? 0)}
                        cardId={`qb-card-modal-${q.id}`}
                        highlighted={highlightedQuestionId === q.id}
                        questionNumber={appliedNumberById.get(q.id) ?? 0}
                        interacted={hasQuestionInteraction(q.id)}
                        label="Applied"
                        starred={!!q.isStarred}
                          codeStyle={detectCodeStyle(q.answer)}
                          question={q.question}
                          answer={q.answer}
                          context={formatQuestionContext(q.unitTitle, q.topicTitle, q.subtopicTitle)}
                        />
                    ))
                  )}
                </section>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-muted-foreground text-sm">No questions generated yet for this roadmap.</p>
            </div>
          )
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function QuestionBankPane({
  configId,
  examParam,
  initialQuestionId,
  onClose,
}: {
  configId: string;
  examParam: string;
  initialQuestionId: number | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useGetQuestionBank(configId, {
    staleTime: CLIENT_CACHE_BYPASS ? 0 : 60 * 60 * 1000,
    gcTime: CLIENT_CACHE_BYPASS ? 0 : 60 * 60 * 1000,
    refetchOnWindowFocus: CLIENT_CACHE_BYPASS ? true : false,
    refetchOnMount: CLIENT_CACHE_BYPASS ? "always" : true,
  });
  const validQuestions = useMemo(
    () => data?.questions ?? [],
    [data?.questions]
  );
  const seededHash = useCallback((value: string) => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }, []);

  const distributeStarred = useCallback(
    <T extends { id: number; isStarred?: boolean }>(items: T[]): T[] => {
      if (items.length <= 2) return items;
      const starred = items
        .filter((q) => !!q.isStarred)
        .slice()
        .sort((a, b) => seededHash(`${configId}:${a.id}`) - seededHash(`${configId}:${b.id}`));
      const nonStarred = items
        .filter((q) => !q.isStarred)
        .slice()
        .sort((a, b) => seededHash(`${configId}:${a.id}`) - seededHash(`${configId}:${b.id}`));

      if (starred.length === 0 || nonStarred.length === 0) {
        return [...items].sort(
          (a, b) => seededHash(`${configId}:${a.id}`) - seededHash(`${configId}:${b.id}`),
        );
      }

      const total = items.length;
      const out: T[] = new Array(total);
      const starredSlots = new Set<number>();
      for (let i = 0; i < starred.length; i++) {
        const slot = Math.min(total - 1, Math.floor(((i + 0.5) * total) / starred.length));
        let s = slot;
        while (starredSlots.has(s) && s < total - 1) s++;
        while (starredSlots.has(s) && s > 0) s--;
        starredSlots.add(s);
      }

      let si = 0;
      let ni = 0;
      for (let i = 0; i < total; i++) {
        if (starredSlots.has(i) && si < starred.length) out[i] = starred[si++];
        else if (ni < nonStarred.length) out[i] = nonStarred[ni++];
        else if (si < starred.length) out[i] = starred[si++];
      }
      return out.filter(Boolean);
    },
    [configId, seededHash],
  );

  const foundational = useMemo(
    () => distributeStarred(validQuestions.filter((q) => q.markType === "Foundational")),
    [validQuestions, distributeStarred],
  );
  const applied = useMemo(
    () => distributeStarred(validQuestions.filter((q) => q.markType === "Applied")),
    [validQuestions, distributeStarred],
  );
  const foundationalNumberById = useMemo(
    () => new Map(foundational.map((q, idx) => [q.id, idx + 1])),
    [foundational]
  );
  const appliedNumberById = useMemo(
    () => new Map(applied.map((q, idx) => [q.id, idx + 1])),
    [applied]
  );
  const [selectedQuestion, setSelectedQuestion] = useState<{
    id: number;
    number: number;
    label: string;
    starred: boolean;
    codeStyle: CodeStyle;
    question: string;
    context: string;
    answer: string;
    subtopicId: string;
  } | null>(null);
  const [qbSectionFilter, setQbSectionFilter] = useState<"all" | "foundational" | "applied">("all");
  const [highlightedQuestionId, setHighlightedQuestionId] = useState<number | null>(null);
  const resumeAppliedRef = useRef(false);
  const user = getStoredUser();
  const isAdminViewer = (user?.role || "").toLowerCase() === "admin";
  const queryClient = useQueryClient();
  const trackEventMutation = useTrackEvent();
  const updateQuestionBankQuestionMutation = useUpdateQuestionBankQuestion();
  const answerTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const [questionInteractionVersion, setQuestionInteractionVersion] = useState(0);
  const [expandedEditMode, setExpandedEditMode] = useState(false);
  const [expandedEditPreview, setExpandedEditPreview] = useState(false);
  const [expandedQuestionDraft, setExpandedQuestionDraft] = useState("");
  const [expandedAnswerDraft, setExpandedAnswerDraft] = useState("");
  const listScrollRef = useRef<HTMLDivElement>(null);
  const listScrollTopRef = useRef(0);

  const questionSessionKey = useCallback(
    (questionId: number) => `tracked_qb_${configId}_${questionId}`,
    [configId]
  );
  const hasQuestionInteraction = useCallback(
    (questionId: number) => !!sessionStorage.getItem(questionSessionKey(questionId)),
    [questionSessionKey, questionInteractionVersion]
  );

  useEffect(() => {
    resumeAppliedRef.current = false;
    setHighlightedQuestionId(null);
    setQbSectionFilter("all");
  }, [configId]);

  useEffect(() => {
    if (resumeAppliedRef.current) return;
    if (!Number.isFinite(initialQuestionId ?? NaN) || validQuestions.length === 0) return;
    resumeAppliedRef.current = true;
    const qid = Number(initialQuestionId);
    if (!Number.isFinite(qid) || !validQuestions.some((q) => q.id === qid)) return;
    setHighlightedQuestionId(qid);
    const el = document.getElementById(`qb-card-pane-${qid}`);
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    window.setTimeout(() => setHighlightedQuestionId((curr) => (curr === qid ? null : curr)), 6000);
  }, [initialQuestionId, validQuestions]);

  useEffect(() => {
    return () => {
      for (const timer of answerTimersRef.current.values()) clearTimeout(timer);
      answerTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!selectedQuestion) return;
    if (!user || (user.role !== "student" && user.role !== "super_student")) return;
    const sessionKey = questionSessionKey(selectedQuestion.id);
    if (sessionStorage.getItem(sessionKey)) return;
    const existing = answerTimersRef.current.get(selectedQuestion.id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      answerTimersRef.current.delete(selectedQuestion.id);
      if (sessionStorage.getItem(sessionKey)) return;
      trackEventMutation.mutate(
        {
          data: {
            userId: user.id,
            universityId: user.universityId,
            year: user.year,
            branch: user.branch,
            exam: examParam,
            configId,
            topicId: `${QUESTION_BANK_EVENT_PREFIX}${selectedQuestion.id}`,
            subtopicId: String(selectedQuestion.subtopicId || "").trim() || undefined,
            questionId: String(selectedQuestion.id),
          },
        },
        {
          onSuccess: () => {
            sessionStorage.setItem(sessionKey, "true");
            setQuestionInteractionVersion((v) => v + 1);
          },
        },
      );
    }, 5000);

    answerTimersRef.current.set(selectedQuestion.id, timer);
    return () => {
      const t = answerTimersRef.current.get(selectedQuestion.id);
      if (t) {
        clearTimeout(t);
        answerTimersRef.current.delete(selectedQuestion.id);
      }
    };
  }, [selectedQuestion, configId, examParam, questionSessionKey, trackEventMutation, user]);
  useEffect(() => {
    if (!selectedQuestion) {
      setExpandedEditMode(false);
      setExpandedEditPreview(false);
      setExpandedQuestionDraft("");
      setExpandedAnswerDraft("");
      return;
    }
    setExpandedQuestionDraft(selectedQuestion.question);
    setExpandedAnswerDraft(selectedQuestion.answer);
  }, [selectedQuestion]);

  const saveQuestionEdit = async (
    q: { id: number },
    next: { question: string; answer: string },
  ) => {
    await updateQuestionBankQuestionMutation.mutateAsync({
      configId,
      questionId: q.id,
      question: next.question,
      answer: next.answer,
    });
    await queryClient.invalidateQueries({ queryKey: ["config-question-bank", configId] });
    setSelectedQuestion((prev) =>
      prev && prev.id === q.id
        ? { ...prev, question: next.question, answer: next.answer }
        : prev
    );
  };

  const openQuestionDetail = useCallback(
    (
      q: (typeof validQuestions)[number],
      label: "Foundational" | "Applied",
      number: number,
    ) => {
      listScrollTopRef.current = listScrollRef.current?.scrollTop ?? 0;
      setSelectedQuestion({
        id: q.id,
        number,
        label,
        starred: !!q.isStarred,
        codeStyle: detectCodeStyle(q.answer),
        question: q.question,
        context: formatQuestionContext(q.unitTitle, q.topicTitle, q.subtopicTitle),
        answer: q.answer,
        subtopicId: q.subtopicId,
      });
    },
    [validQuestions],
  );

  const displayedOrderedQuestions = useMemo(
    () =>
      [
        ...(qbSectionFilter === "all" || qbSectionFilter === "foundational"
          ? foundational.map((q) => ({
              q,
              label: "Foundational" as const,
              number: foundationalNumberById.get(q.id) ?? 0,
            }))
          : []),
        ...(qbSectionFilter === "all" || qbSectionFilter === "applied"
          ? applied.map((q) => ({
              q,
              label: "Applied" as const,
              number: appliedNumberById.get(q.id) ?? 0,
            }))
          : []),
      ],
    [qbSectionFilter, foundational, applied, foundationalNumberById, appliedNumberById],
  );

  const selectedQuestionIndex = useMemo(
    () => displayedOrderedQuestions.findIndex((row) => row.q.id === selectedQuestion?.id),
    [displayedOrderedQuestions, selectedQuestion?.id],
  );
  const previousDisplayedQuestion =
    selectedQuestionIndex > 0 ? displayedOrderedQuestions[selectedQuestionIndex - 1] : null;
  const nextDisplayedQuestion =
    selectedQuestionIndex >= 0 && selectedQuestionIndex < displayedOrderedQuestions.length - 1
      ? displayedOrderedQuestions[selectedQuestionIndex + 1]
      : null;

  useEffect(() => {
    if (selectedQuestion !== null) return;
    requestAnimationFrame(() => {
      if (listScrollRef.current) {
        listScrollRef.current.scrollTop = listScrollTopRef.current;
      }
    });
  }, [selectedQuestion]);

  return (
    <div className="h-full flex flex-col border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border shrink-0 bg-blue-50">
        <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display font-bold text-foreground truncate text-base flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-600" />
            Question Bank
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {data ? `${validQuestions.length} total questions` : "Loading questions..."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {selectedQuestion === null && validQuestions.length > 0 && (
            <div className="hidden sm:flex items-center gap-2">
              <Button
                variant={qbSectionFilter === "all" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs font-medium"
                onClick={() => setQbSectionFilter("all")}
              >
                All ({validQuestions.length})
              </Button>
              <Button
                variant={qbSectionFilter === "foundational" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs font-medium"
                onClick={() => setQbSectionFilter("foundational")}
              >
                Foundational ({foundational.length})
              </Button>
              <Button
                variant={qbSectionFilter === "applied" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs font-medium"
                onClick={() => setQbSectionFilter("applied")}
              >
                Applied ({applied.length})
              </Button>
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="w-4 h-4" />
          </Button>
        </div>
        </div>
        {selectedQuestion === null && validQuestions.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 sm:hidden">
            <Button
              variant={qbSectionFilter === "all" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs font-medium"
              onClick={() => setQbSectionFilter("all")}
            >
              All ({validQuestions.length})
            </Button>
            <Button
              variant={qbSectionFilter === "foundational" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs font-medium"
              onClick={() => setQbSectionFilter("foundational")}
            >
              Foundational ({foundational.length})
            </Button>
            <Button
              variant={qbSectionFilter === "applied" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs font-medium"
              onClick={() => setQbSectionFilter("applied")}
            >
              Applied ({applied.length})
            </Button>
          </div>
        )}
      </div>

      <div ref={listScrollRef} className="flex-1 overflow-y-auto p-5 space-y-6">
        {selectedQuestion ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelectedQuestion(null)}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back to Question List
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={!previousDisplayedQuestion}
                  onClick={() =>
                    previousDisplayedQuestion &&
                    openQuestionDetail(
                      previousDisplayedQuestion.q,
                      previousDisplayedQuestion.label,
                      previousDisplayedQuestion.number,
                    )
                  }
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={!nextDisplayedQuestion}
                  onClick={() =>
                    nextDisplayedQuestion &&
                    openQuestionDetail(
                      nextDisplayedQuestion.q,
                      nextDisplayedQuestion.label,
                      nextDisplayedQuestion.number,
                    )
                  }
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
            <div className="relative bg-card border border-blue-200 rounded-xl overflow-hidden shadow-sm">
              {selectedQuestion.codeStyle !== "none" && (
                <div className="absolute top-0 right-0 z-20 bg-rose-200 text-black text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-bl-md">
                  {codeStyleBadgeText(selectedQuestion.codeStyle)}
                </div>
              )}
              <div className="p-4 border-b border-blue-100 bg-blue-50/60">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="shrink-0 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider">
                    Q{selectedQuestion.number}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wider">
                    {selectedQuestion.label}
                  </span>
                  {hasQuestionInteraction(selectedQuestion.id) && (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider">
                      Interacted
                    </span>
                  )}
                  {selectedQuestion.starred && (
                    <Star className="shrink-0 w-3.5 h-3.5 mt-0.5 text-amber-500 fill-amber-400" aria-label="Starred question" />
                  )}
                  {isAdminViewer && (
                    <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => setExpandedEditMode(true)}>
                      <Pencil className="w-3 h-3 mr-1" /> Edit
                    </Button>
                  )}
                </div>
              </div>
              <div className="p-4 border-b border-blue-100 bg-white/70">
                <p className="text-sm font-semibold text-foreground leading-snug whitespace-pre-line">{renderInlineCodeText(selectedQuestion.question)}</p>
                {selectedQuestion.context && (
                  <p className="text-xs text-muted-foreground mt-1 break-words">{renderInlineCodeText(selectedQuestion.context)}</p>
                )}
              </div>
              <div className="p-4">
                {isAdminViewer && expandedEditMode ? (
                  <div className="space-y-3">
                    <Textarea value={expandedQuestionDraft} onChange={(e) => setExpandedQuestionDraft(e.target.value)} rows={4} className="text-sm" />
                    <Textarea value={expandedAnswerDraft} onChange={(e) => setExpandedAnswerDraft(e.target.value)} rows={8} className="text-sm font-mono" />
                    {expandedEditPreview && (
                      <div className="rounded-lg border border-border bg-secondary/20 p-3">
                        <AnswerRenderer answer={expandedAnswerDraft} />
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setExpandedEditPreview((p) => !p)}>
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        onClick={async () => {
                          await saveQuestionEdit(
                            { id: selectedQuestion.id },
                            { question: expandedQuestionDraft, answer: expandedAnswerDraft }
                          );
                          setExpandedEditMode(false);
                          setExpandedEditPreview(false);
                        }}
                      >
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          setExpandedEditMode(false);
                          setExpandedEditPreview(false);
                          setExpandedQuestionDraft(selectedQuestion.question);
                          setExpandedAnswerDraft(selectedQuestion.answer);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <AnswerRenderer answer={selectedQuestion.answer} />
                )}
              </div>
            </div>
          </section>
        ) : isLoading ? (
          <div className="space-y-4">
            <div className="h-6 bg-muted animate-pulse rounded w-1/3" />
            <div className="h-24 bg-muted animate-pulse rounded-xl" />
            <div className="h-24 bg-muted animate-pulse rounded-xl" />
          </div>
        ) : isError ? (
          <div className="text-center py-8">
            <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-muted-foreground text-sm">Failed to load question bank.</p>
          </div>
        ) : validQuestions.length ? (
          <>
            {(qbSectionFilter === "all" || qbSectionFilter === "foundational") && (
              <section className="space-y-3">
                {foundational.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No foundational questions yet.</p>
                ) : (
                  foundational.map((q) => (
                    <QuestionBankCard
                      key={q.id}
                      onOpenDetail={() => openQuestionDetail(q, "Foundational", foundationalNumberById.get(q.id) ?? 0)}
                      cardId={`qb-card-pane-${q.id}`}
                      highlighted={highlightedQuestionId === q.id}
                      questionNumber={foundationalNumberById.get(q.id) ?? 0}
                      interacted={hasQuestionInteraction(q.id)}
                      label="Foundational"
                      starred={!!q.isStarred}
                      codeStyle={detectCodeStyle(q.answer)}
                      question={q.question}
                      answer={q.answer}
                      context={formatQuestionContext(q.unitTitle, q.topicTitle, q.subtopicTitle)}
                    />
                  ))
                )}
              </section>
            )}
            {(qbSectionFilter === "all" || qbSectionFilter === "applied") && (
              <section className="space-y-3">
                {applied.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No applied questions yet.</p>
                ) : (
                  applied.map((q) => (
                    <QuestionBankCard
                      key={q.id}
                      onOpenDetail={() => openQuestionDetail(q, "Applied", appliedNumberById.get(q.id) ?? 0)}
                      cardId={`qb-card-pane-${q.id}`}
                      highlighted={highlightedQuestionId === q.id}
                      questionNumber={appliedNumberById.get(q.id) ?? 0}
                      interacted={hasQuestionInteraction(q.id)}
                      label="Applied"
                      starred={!!q.isStarred}
                      codeStyle={detectCodeStyle(q.answer)}
                      question={q.question}
                      answer={q.answer}
                      context={formatQuestionContext(q.unitTitle, q.topicTitle, q.subtopicTitle)}
                    />
                  ))
                )}
              </section>
            )}
          </>
        ) : (
          <div className="text-center py-8">
            <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-muted-foreground text-sm">No questions generated yet for this roadmap.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionBankCard({
  cardId,
  highlighted,
  questionNumber,
  interacted,
  label,
  starred,
  codeStyle,
  question,
  answer,
  context,
  onOpenDetail,
}: {
  cardId: string;
  highlighted: boolean;
  questionNumber: number;
  interacted: boolean;
  label: string;
  starred?: boolean;
  codeStyle: CodeStyle;
  question: string;
  answer: string;
  context: string;
  onOpenDetail: () => void;
}) {
  const codeBadge = codeStyleBadgeText(codeStyle);
  const hasContext = String(context || "").trim().length > 0;

  return (
    <div
      id={cardId}
      className={`relative bg-card border rounded-xl overflow-hidden shadow-sm ${
        highlighted ? "border-amber-400 ring-2 ring-amber-200" : "border-blue-200"
      }`}
    >
      {codeBadge && (
        <div
          className="absolute top-0 right-0 z-20 bg-rose-200 text-black text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-bl-md"
          title="Contains code example"
        >
          {codeBadge}
        </div>
      )}
      <div className="p-4 border-b border-blue-100 bg-blue-50/60">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="shrink-0 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider">
            Q{questionNumber}
          </span>
          <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wider">
            {label}
          </span>
          {interacted && (
            <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider">
              Interacted
            </span>
          )}
          {starred && (
            <Star
              className="shrink-0 w-3.5 h-3.5 mt-0.5 text-amber-500 fill-amber-400"
              aria-label="Starred question"
            />
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-b border-blue-100 bg-white/70">
        <p className="text-[13px] font-medium text-foreground leading-snug whitespace-pre-line">{renderInlineCodeText(question)}</p>
        {hasContext && <p className="text-[11px] text-muted-foreground mt-1 break-words">{renderInlineCodeText(context)}</p>}
      </div>

      <div className="px-4 py-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 text-xs w-full"
          onClick={onOpenDetail}
          title="Open answer in focused view"
        >
          Show Answer
        </Button>
      </div>
    </div>
  );
}

function formatQuestionContext(unitTitle?: string, topicTitle?: string, subtopicTitle?: string): string {
  return [unitTitle, topicTitle, subtopicTitle]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(" -> ");
}
