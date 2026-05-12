import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, CheckCircle2, MessageSquare, BookOpen, AlertCircle, Lightbulb, Info, ChevronLeft, ChevronRight, PenLine } from "lucide-react";
import { useGetSubtopicContent, useTrackEvent } from "@/api-client";
import { Button } from "@/components/ui/button";
import { getStoredUser } from "@/lib/auth";
import { parseStructuredExplanation, repairBrokenFormulaBullets } from "@/lib/text-format";

function LearningGoalBlock({ learningGoal }: { learningGoal?: string | null }) {
  const goal = String(learningGoal || "").trim();
  if (!goal) return null;

  return (
    <section className="bg-secondary/20 rounded-2xl border border-border p-5 sm:p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Learning Goal</p>
        <p className="text-sm sm:text-base text-foreground leading-relaxed">{goal}</p>
      </div>
    </section>
  );
}

function PathNavBlock({
  prerequisiteTitles,
  nextRecommendedTitles,
  prerequisiteNodeIds,
  nextRecommendedNodeIds,
  onNavigate,
}: {
  prerequisiteTitles?: string[] | null;
  nextRecommendedTitles?: string[] | null;
  prerequisiteNodeIds?: string[] | null;
  nextRecommendedNodeIds?: string[] | null;
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
                data-nav-chip="v2"
                type="button"
                variant="outline"
                onClick={() => onNavigate?.(String(prerequisiteNodeIds?.[0] || ""))}
                disabled={!String(prerequisiteNodeIds?.[0] || "").trim()}
                title={String(prerequisiteNodeIds?.[0] || "").trim() ? `Open ${item}` : undefined}
                className="relative inline-flex h-9 max-w-full min-w-0 items-center rounded-full border border-blue-200 bg-white px-4 text-sm font-medium leading-5 antialiased text-slate-800 transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              >
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
                data-nav-chip="v2"
                type="button"
                variant="outline"
                onClick={() => onNavigate?.(String(nextRecommendedNodeIds?.[0] || ""))}
                disabled={!String(nextRecommendedNodeIds?.[0] || "").trim()}
                title={String(nextRecommendedNodeIds?.[0] || "").trim() ? `Open ${item}` : undefined}
                className="relative inline-flex h-9 max-w-full min-w-0 items-center rounded-full border border-blue-200 bg-white px-4 text-sm font-medium leading-5 antialiased text-slate-800 transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:ring-0 focus-visible:ring-offset-0"
              >
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
    <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 sm:p-6 space-y-2">
      <div className="flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-amber-700" />
        <h2 className="text-base font-bold text-amber-900">Quick Example</h2>
      </div>
      <p className="text-sm sm:text-base text-amber-950 whitespace-pre-line leading-relaxed">{repairBrokenFormulaBullets(value)}</p>
    </section>
  );
}

function SupportNoteBlock({ text }: { text?: string | null }) {
  const value = String(text || "").trim();
  if (!value) return null;

  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-5 sm:p-6 space-y-2">
      <div className="flex items-center gap-2">
        <Info className="w-4 h-4 text-sky-700" />
        <h2 className="text-base font-bold text-sky-900">Helpful Note</h2>
      </div>
      <p className="text-sm sm:text-base text-sky-950 whitespace-pre-line leading-relaxed">{repairBrokenFormulaBullets(value)}</p>
    </section>
  );
}

function QuestionBlock({ 
  label, 
  question, 
  answer 
}: { 
  label: string; 
  question: string; 
  answer: string; 
}) {
  const [isRevealed, setIsRevealed] = useState(false);

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm transition-all hover:shadow-md">
      <div className="p-5 sm:p-6 border-b border-border bg-secondary/30">
        <div className="flex items-start gap-3">
          <span className="shrink-0 mt-0.5 px-2.5 py-1 rounded-md bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider">
            {label}
          </span>
          <h3 className="text-base sm:text-lg font-semibold text-foreground leading-snug">
            {question}
          </h3>
        </div>
      </div>
      
      <div className="p-5 sm:p-6">
        <AnimatePresence initial={false} mode="wait">
          {!isRevealed ? (
            <motion.div
              key="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex justify-center py-4"
            >
              <Button 
                variant="outline" 
                onClick={() => setIsRevealed(true)}
                className="rounded-full px-6 font-medium shadow-sm hover:border-primary/50"
              >
                Reveal Answer
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="answer"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="prose prose-sm sm:prose-base prose-slate max-w-none prose-headings:font-display prose-p:leading-relaxed"
            >
              <div className="whitespace-pre-line">{repairBrokenFormulaBullets(answer)}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function Subtopic() {
  const [, params] = useRoute<{ id: string }>("/subtopic/:id");
  const id = params ? params.id : undefined;
  const [, setLocation] = useLocation();
  const user = getStoredUser();
  const observerRef = useRef<HTMLDivElement>(null);

  const searchParams = new URLSearchParams(window.location.search);
  const universityId = searchParams.get("universityId") || user?.universityId || "";
  const year = searchParams.get("year") || user?.year || "";
  const branch = searchParams.get("branch") || user?.branch || "";
  const examParam = searchParams.get("exam") || "";
  const configId = searchParams.get("configId") || "";
  const topicId = searchParams.get("topicId") || "";
  
  const { data: content, isLoading, isError } = useGetSubtopicContent(id || "", {
    query: { queryKey: ["subtopic-content", id || ""], enabled: !!id }
  });
  
  const trackEventMutation = useTrackEvent();
  const [isTracked, setIsTracked] = useState(false);

  useEffect(() => {
    if (id && sessionStorage.getItem(`tracked_${id}`)) {
      setIsTracked(true);
    }
  }, [id]);

  useEffect(() => {
    if (!content || !user || (user.role !== "student" && user.role !== "super_student") || !id || isTracked) return;

    let timeoutId: NodeJS.Timeout;
    
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        const occurredAt = new Date().toISOString();
        timeoutId = setTimeout(() => {
          if (!sessionStorage.getItem(`tracked_${id}`)) {
            trackEventMutation.mutate({
              data: {
                userId: user.id,
                universityId,
                year,
                branch,
                exam: examParam,
                configId,
                topicId,
                subtopicId: id,
                occurredAt,
              }
            }, {
              onSuccess: () => {
                sessionStorage.setItem(`tracked_${id}`, 'true');
                setIsTracked(true);
              }
            });
          }
        }, 2000);
      } else {
        clearTimeout(timeoutId);
      }
    }, { threshold: 0.5 });

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => {
      observer.disconnect();
      clearTimeout(timeoutId);
    };
  }, [content, id, user, isTracked, trackEventMutation]);

  if (!id) return null;

  const foundationalQuestions = content?.questions?.filter(q => q.markType === "Foundational") || [];
  const appliedQuestions = content?.questions?.filter(q => q.markType === "Applied") || [];
  const structured = parseStructuredExplanation(String((content as any)?.explanation || ""), {
    learningGoal: String((content as any)?.learningGoal || ""),
    exampleBlock: String((content as any)?.exampleBlock || ""),
    supportNote: String((content as any)?.supportNote || ""),
  });
  const prerequisiteNodeId = content?.prerequisiteNodeIds?.[0] || "";
  const prerequisiteTitle = content?.prerequisiteTitles?.[0] || "";
  const nextNodeId = content?.nextRecommendedNodeIds?.[0] || "";
  const nextTitle = content?.nextRecommendedTitles?.[0] || "";
  const querySuffix = window.location.search || "";

  const navigateToNode = (nodeId: string) => {
    if (!nodeId) return;
    setLocation(`/subtopic/${nodeId}${querySuffix}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="w-full max-w-3xl mx-auto pb-32">
      <div className="flex items-center justify-between mb-8">
        <Button variant="ghost" className="-ml-4 text-muted-foreground" onClick={() => window.history.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        
        {isTracked && (
          <div className="flex items-center gap-1.5 text-sm font-semibold text-green-600 bg-green-50 px-3 py-1.5 rounded-full border border-green-200">
            <CheckCircle2 className="w-4 h-4" /> Completed
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <div className="h-8 bg-muted animate-pulse rounded-md w-3/4 mb-8" />
          <div className="h-32 bg-muted animate-pulse rounded-2xl" />
          <div className="h-64 bg-muted animate-pulse rounded-2xl" />
        </div>
      ) : isError ? (
        <div className="p-8 text-center bg-destructive/5 text-destructive rounded-2xl border border-destructive/20">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-bold mb-2">Content Not Found</h3>
          <p>We couldn't load the study material for this subtopic.</p>
        </div>
      ) : content ? (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-10"
        >
          <PathNavBlock
            prerequisiteTitles={content.prerequisiteTitles}
            nextRecommendedTitles={content.nextRecommendedTitles}
            prerequisiteNodeIds={content.prerequisiteNodeIds}
            nextRecommendedNodeIds={content.nextRecommendedNodeIds}
            onNavigate={navigateToNode}
          />
          <LearningGoalBlock learningGoal={structured.learningGoal} />
          <div className="px-5 sm:px-6">
            <section className="space-y-3 mt-4">
              <div className="flex items-center gap-2">
                <PenLine className="w-4 h-4 text-primary" />
                <h1 className="text-lg sm:text-xl font-display font-bold text-foreground">Core Idea</h1>
              </div>
            <div className="prose prose-slate max-w-none prose-p:text-foreground prose-p:leading-relaxed prose-strong:text-foreground text-base sm:text-lg">
              <div className="whitespace-pre-line text-foreground/70">{repairBrokenFormulaBullets(structured.coreExplanation)}</div>
            </div>
            </section>
          </div>

          <ExampleBlock text={structured.exampleBlock} />
          <SupportNoteBlock text={structured.supportNote} />
          <PathNavBlock
            prerequisiteTitles={prerequisiteTitle ? [prerequisiteTitle] : []}
            nextRecommendedTitles={nextTitle ? [nextTitle] : []}
            prerequisiteNodeIds={prerequisiteNodeId ? [prerequisiteNodeId] : []}
            nextRecommendedNodeIds={nextNodeId ? [nextNodeId] : []}
            onNavigate={navigateToNode}
          />

          {(foundationalQuestions.length > 0 || appliedQuestions.length > 0) && (
            <section className="space-y-6">
              <div className="flex items-center gap-2 px-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                <h2 className="text-xl font-display font-bold text-foreground">Practice Questions</h2>
              </div>
              
              {foundationalQuestions.map((q) => (
                <QuestionBlock 
                  key={q.id}
                  label="Foundational" 
                  question={q.question} 
                  answer={q.answer} 
                />
              ))}
              
              {appliedQuestions.map((q) => (
                <QuestionBlock 
                  key={q.id}
                  label="Applied" 
                  question={q.question} 
                  answer={q.answer} 
                />
              ))}
            </section>
          )}

          <div ref={observerRef} className="h-10 w-full flex items-center justify-center">
             <div className="w-1/2 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          </div>
        </motion.div>
      ) : null}
    </div>
  );
}
