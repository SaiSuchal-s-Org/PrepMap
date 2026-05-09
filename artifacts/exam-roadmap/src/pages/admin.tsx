import { useEffect, useMemo, useState } from "react";
import {
  useGetConfigs,
  useCreateConfig,
  useDeleteConfig,
  useGetAppMetadata,
  useGetLiveConfigQuestionBankInteractionSummary,
  useGetServerCacheStats,
  useGetServerCacheHealth,
  useGetUniversityAnalytics,
  useGetConfigStudentProgress,
  useGetQuestionBank,
  useGetLibrarySubjects,
  useGetLibraryUnits,
  useUpsertLibrarySubject,
  useSaveConfigUnitLinks,
  usePurgeConfig,
  useCloneConfigToUniversity,
} from "@/api-client";
import { UNIVERSITIES, EXAM_TYPES, COMMON_BRANCH, SEMESTERS } from "@/lib/constants";
import { useLocation } from "wouter";
import {
  BarChart3, Users, Plus, Settings, FileText,
  CheckCircle2, Clock, ChevronRight, ChevronLeft, Search, Ban, Eye, SlidersHorizontal, ArrowUpDown,
  Copy,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";

function CreateConfigDialog({ onCreated }: { onCreated: () => void }) {
  type DisabledConfigMatch = {
    id: string;
    createdAt?: string;
    createdBy?: string;
    year: string;
    exam: string;
    branch: string;
    status: string;
  };

  type DisabledReusePrompt = {
    subject: string;
    matches: DisabledConfigMatch[];
    selectedId: string;
    resolve: (choice: { mode: "reuse"; id: string } | { mode: "new" }) => void;
  };

  const CUSTOM_SUBJECT_OPTION = "__create_new__";
  const [open, setOpen] = useState(false);
  const [universityId, setUniversityId] = useState("");
  const [year, setYear] = useState("");
  const [subject, setSubject] = useState("");
  const [subjectSelection, setSubjectSelection] = useState(CUSTOM_SUBJECT_OPTION);
  const [subjectDrafts, setSubjectDrafts] = useState<string[]>([]);
  const [exam, setExam] = useState("");
  const { data: metadata } = useGetAppMetadata();
  const universities = metadata?.universities?.length ? metadata.universities : UNIVERSITIES;
  const semesters = metadata?.semesters?.length ? metadata.semesters : SEMESTERS;
  const examTypes = metadata?.examTypes?.length ? metadata.examTypes : EXAM_TYPES;
  const semesterLabel = (id: string) => semesters.find((s) => s.id === id)?.name ?? id;
  const examLabel = (id: string) => examTypes.find((e) => e.id === id)?.name ?? id;
  const semExamLabel = (semesterId: string, examId: string) =>
    `${semesterLabel(semesterId)} - ${examLabel(examId)}`;
  const commonBranch = metadata?.commonBranch || COMMON_BRANCH;
  const [batch, setBatch] = useState("2025");
  const { data: existingConfigs } = useGetConfigs({}, { query: { queryKey: ["configs", "all"] } });
  const createConfig = useCreateConfig();
  const { data: librarySubjects } = useGetLibrarySubjects();
  const upsertLibrarySubject = useUpsertLibrarySubject();
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const saveConfigUnitLinks = useSaveConfigUnitLinks();
  const { toast } = useToast();
  const [disabledReusePrompt, setDisabledReusePrompt] = useState<DisabledReusePrompt | null>(null);

  const normalizeText = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

  const selectedLibrarySubject = useMemo(() => {
    const n = normalizeText(subject);
    return (librarySubjects ?? []).find((s) => s.normalizedName === n) ?? null;
  }, [librarySubjects, subject]);

  const { data: libraryUnits } = useGetLibraryUnits(selectedLibrarySubject?.id ?? null);

  useEffect(() => {
    setSelectedUnitIds([]);
  }, [subject]);

  const subjectOptions = useMemo(
    () =>
      Array.from(new Set((librarySubjects ?? []).map((s) => s.name.trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b)
      ),
    [librarySubjects]
  );

  const addSubjectDraft = () => {
    const trimmed = subject.trim();
    if (!trimmed) return;
    const normalized = normalizeText(trimmed);
    setSubjectDrafts((prev) => {
      if (prev.some((s) => normalizeText(s) === normalized)) return prev;
      return [...prev, trimmed];
    });
    setSubject("");
    setSubjectSelection(CUSTOM_SUBJECT_OPTION);
    setSelectedUnitIds([]);
  };

  const removeSubjectDraft = (index: number) => {
    setSubjectDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  const askDisabledReuseChoice = (subjectName: string, matches: DisabledConfigMatch[]) =>
    new Promise<{ mode: "reuse"; id: string } | { mode: "new" }>((resolve) => {
      setDisabledReusePrompt({
        subject: subjectName,
        matches,
        selectedId: matches[0]?.id ?? "",
        resolve,
      });
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedBatch = String(batch || "").trim() || "2025";
    const createdConfigs: Array<{ id: string; subject: string }> = [];
    try {
      const enteredSubject = subject.trim();
      const allSubjects = [...subjectDrafts, ...(enteredSubject ? [enteredSubject] : [])];
      const uniqueSubjects = Array.from(
        new Map(allSubjects.map((s) => [normalizeText(s), s.trim()])).values()
      ).filter(Boolean);

      if (uniqueSubjects.length === 0) {
        toast({
          title: "No subjects added",
          description: "Add at least one subject draft before creating configs.",
        });
        return;
      }

      const existingForCombo = new Set(
        (existingConfigs ?? [])
          .filter(
            (c) =>
              c.universityId === universityId &&
              String((c as any).batch || "2025").trim() === selectedBatch &&
              c.year === year &&
              c.branch === commonBranch &&
              c.exam === exam &&
              c.status !== "disabled" &&
              c.status !== "deleted"
          )
          .map((c) => normalizeText(c.subject))
      );

      const pendingSubjects = uniqueSubjects.filter((s) => !existingForCombo.has(normalizeText(s)));
      const skippedCount = uniqueSubjects.length - pendingSubjects.length;

      if (pendingSubjects.length === 0) {
        toast({
          title: "Nothing to create",
          description: `All selected subjects already have configs for this exam.`,
        });
        return;
      }

      let revivedCount = 0;
      for (const pendingSubject of pendingSubjects) {
        const normalizedPending = normalizeText(pendingSubject);
        const existingLibrarySubject =
          (librarySubjects ?? []).find((s) => s.normalizedName === normalizedPending) ?? null;
        if (!existingLibrarySubject) {
          await upsertLibrarySubject.mutateAsync({ name: pendingSubject });
        }

        const disabledMatches = (existingConfigs ?? [])
          .filter(
            (c) =>
              c.universityId === universityId &&
              String((c as any).batch || "2025").trim() === selectedBatch &&
              c.year === year &&
              c.branch === commonBranch &&
              c.exam === exam &&
              c.status === "disabled" &&
              normalizeText(c.subject) === normalizedPending
          )
          .map((c) => ({
            id: c.id,
            createdAt: c.createdAt,
            createdBy: c.createdBy,
            year: c.year,
            exam: c.exam,
            branch: c.branch,
            status: c.status,
          }));

        let createPayload: {
          universityId: string;
          batch?: string;
          year: string;
          branch: string;
          subject: string;
          exam: "mid1" | "mid2" | "endsem";
          reuseDisabledConfigId?: string;
          forceCreateNew?: boolean;
        } = {
          universityId,
          batch: selectedBatch,
          year,
          branch: commonBranch,
          subject: pendingSubject,
          exam: exam as "mid1" | "mid2" | "endsem",
        };

        if (disabledMatches.length > 0) {
          const choice = await askDisabledReuseChoice(pendingSubject, disabledMatches);
          if (choice.mode === "reuse") {
            createPayload = { ...createPayload, reuseDisabledConfigId: choice.id };
          } else {
            createPayload = { ...createPayload, forceCreateNew: true };
          }
        }

        const created = await createConfig.mutateAsync({ data: createPayload });
        if ((created as any)?.revived) revivedCount += 1;
        createdConfigs.push({ id: created.id, subject: created.subject });
      }

      const unitLinkFailures: Array<{ configId: string; reason: string }> = [];
      if (selectedUnitIds.length > 0 && uniqueSubjects.length === 1) {
        for (const cfg of createdConfigs) {
          try {
            const linkResult: any = await saveConfigUnitLinks.mutateAsync({
              configId: cfg.id,
              unitIds: selectedUnitIds,
            });
            if (linkResult?.nodesMaterialized === false) {
              const reason = String(linkResult?.warning || "Unit links saved, but nodes could not be materialized.");
              unitLinkFailures.push({ configId: cfg.id, reason });
            }
          } catch (err: any) {
            const reason =
              err?.response?.data?.error ||
              err?.message ||
              "Failed to apply selected units.";
            unitLinkFailures.push({ configId: cfg.id, reason: String(reason) });
          }
        }
      }

      setOpen(false);
      setUniversityId("");
      setYear("");
      setSubject("");
      setSubjectSelection(CUSTOM_SUBJECT_OPTION);
      setSubjectDrafts([]);
      setExam("");
      setBatch("2025");
      setSelectedUnitIds([]);
      onCreated();
      toast({
        title: "Configs created",
        description:
          skippedCount > 0
            ? `${createdConfigs.length} processed (${revivedCount} enabled, ${createdConfigs.length - revivedCount} new), ${skippedCount} skipped (already active).`
            : `${createdConfigs.length} processed (${revivedCount} enabled, ${createdConfigs.length - revivedCount} new).`,
      });
      if (unitLinkFailures.length > 0) {
        toast({
          title: "Config created, but unit linking failed",
          description: `${unitLinkFailures[0].reason}`,
          variant: "destructive",
        });
      }
    } catch (err: any) {
      const backendMessage =
        err?.response?.data?.error ||
        err?.message ||
        "Something went wrong. Please try again.";
      if (createdConfigs.length > 0) {
        toast({
          title: "Config created partially",
          description: `Created ${createdConfigs.length} config(s), but follow-up setup failed: ${backendMessage}`,
          variant: "destructive",
        });
        onCreated();
        return;
      }
      toast({ title: "Failed to create config", description: backendMessage, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          New Config
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[56rem] overflow-x-hidden sm:max-w-[56rem]">
        <DialogHeader>
          <DialogTitle>Create Exam Config</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label>University</Label>
            <Select value={universityId} onValueChange={setUniversityId}>
              <SelectTrigger className="w-full min-w-0 max-w-full">
                <span className="block min-w-0 truncate text-left">
                  <SelectValue placeholder="Select university" />
                </span>
              </SelectTrigger>
              <SelectContent>
                {universities.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Semester</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="w-full min-w-0 max-w-full">
                  <span className="block min-w-0 truncate text-left">
                    <SelectValue placeholder="Select semester" />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {semesters.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Branch</Label>
              <Input value={commonBranch} readOnly disabled />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Batch</Label>
            <Input
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              placeholder="e.g. 2025"
            />
          </div>

          <div className="space-y-2">
            <Label>Exam Type</Label>
            <Select value={exam} onValueChange={setExam}>
              <SelectTrigger className="w-full min-w-0 max-w-full">
                <span className="block min-w-0 truncate text-left">
                  <SelectValue placeholder="Select exam" />
                </span>
              </SelectTrigger>
              <SelectContent>
                {examTypes.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Add Subject</Label>
            <Select
              value={subjectSelection}
              onValueChange={(value) => {
                setSubjectSelection(value);
                if (value !== CUSTOM_SUBJECT_OPTION) {
                  setSubject(value);
                } else {
                  setSubject("");
                }
              }}
            >
              <SelectTrigger className="w-full min-w-0 max-w-full">
                <span className="block min-w-0 truncate text-left">
                  <SelectValue placeholder="Select/create subject" />
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CUSTOM_SUBJECT_OPTION}>Create new subject</SelectItem>
                {subjectOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {subjectSelection === CUSTOM_SUBJECT_OPTION && (
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Data Structures" />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={addSubjectDraft} disabled={!subject.trim()}>
                <Plus className="w-4 h-4 mr-1" />
                Add Subject
              </Button>
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                Add multiple subjects, then create all drafts in one go.
              </p>
            </div>
            {subjectDrafts.length > 0 && (
              <div className="rounded-md border border-border p-2 flex flex-wrap gap-2">
                {subjectDrafts.map((s, index) => (
                  <Badge key={`${s}-${index}`} variant="secondary" className="gap-2 pr-1">
                    <span>{s}</span>
                    <button
                      type="button"
                      className="text-xs leading-none px-1 py-0.5 rounded hover:bg-black/10"
                      onClick={() => removeSubjectDraft(index)}
                      aria-label={`Remove ${s}`}
                    >
                      x
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Reusable Units (optional)</Label>
            {subjectDrafts.length > 1 ? (
              <p className="text-xs text-muted-foreground">Reusable units are available when creating one subject at a time.</p>
            ) : !subject.trim() ? (
              <p className="text-xs text-muted-foreground">Select/enter subject to see reusable units.</p>
            ) : !selectedLibrarySubject ? (
              <p className="text-xs text-muted-foreground">No library subject yet for this name. It will be created on config creation.</p>
            ) : !libraryUnits || libraryUnits.length === 0 ? (
              <p className="text-xs text-muted-foreground">No units available yet for this subject.</p>
            ) : (
              <div className="max-h-36 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                {libraryUnits.map((u) => (
                  <label key={u.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedUnitIds.includes(u.id)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedUnitIds((prev) =>
                          checked ? (prev.includes(u.id) ? prev : [...prev, u.id]) : prev.filter((id) => id !== u.id)
                        );
                      }}
                    />
                    <span>{u.unitTitle}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          

          <Button
            type="submit"
            className="w-full"
            disabled={
              !universityId ||
              !year ||
              !String(batch || "").trim() ||
              !(subjectDrafts.length > 0 || subject.trim()) ||
              !exam ||
              createConfig.isPending ||
              upsertLibrarySubject.isPending ||
              saveConfigUnitLinks.isPending
            }
          >
            {createConfig.isPending || upsertLibrarySubject.isPending || saveConfigUnitLinks.isPending
              ? "Creating..."
              : "Create Config Drafts"}
          </Button>
        </form>
      </DialogContent>
      <Dialog
        open={Boolean(disabledReusePrompt)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && disabledReusePrompt) {
            disabledReusePrompt.resolve({ mode: "new" });
            setDisabledReusePrompt(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Matching Disabled Config Found</DialogTitle>
          </DialogHeader>
          {disabledReusePrompt && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Disabled config(s) already exist for <span className="font-medium text-foreground">{disabledReusePrompt.subject}</span>.
                Choose one to enable, or create a fresh config.
              </p>
              <div className="space-y-2 rounded-md border border-border p-3 max-h-52 overflow-y-auto">
                {disabledReusePrompt.matches.map((m) => (
                  <label key={m.id} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="disabledReusePick"
                      checked={disabledReusePrompt.selectedId === m.id}
                      onChange={() =>
                        setDisabledReusePrompt((prev) => (prev ? { ...prev, selectedId: m.id } : prev))
                      }
                    />
                    <span>
                      <span className="font-medium">{m.id}</span>
                      <span className="block text-xs text-muted-foreground">
                        {semExamLabel(m.year, m.exam)} &middot; {m.branch}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {m.createdAt ? `Created: ${new Date(m.createdAt).toLocaleString()}` : "Created: unknown"}
                        {m.createdBy ? ` · By: ${m.createdBy}` : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    disabledReusePrompt.resolve({ mode: "new" });
                    setDisabledReusePrompt(null);
                  }}
                >
                  Create New
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    disabledReusePrompt.resolve({
                      mode: "reuse",
                      id: disabledReusePrompt.selectedId,
                    });
                    setDisabledReusePrompt(null);
                  }}
                  disabled={!disabledReusePrompt.selectedId}
                >
                  Enable Selected
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function ConfigsTab() {
  const getUniversityIdFromSearch = () => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const value = (params.get("universityId") || "").trim();
    return value || null;
  };

  const { data: metadata } = useGetAppMetadata();
  const universities = metadata?.universities?.length ? metadata.universities : UNIVERSITIES;
  const semesters = metadata?.semesters?.length ? metadata.semesters : SEMESTERS;
  const examTypes = metadata?.examTypes?.length ? metadata.examTypes : EXAM_TYPES;
  const uniLabel = (id: string) => universities.find((u) => u.id === id)?.name ?? id;
  const semesterLabel = (id: string) => semesters.find((s) => s.id === id)?.name ?? id;
  const examLabel = (id: string) => examTypes.find((e) => e.id === id)?.name ?? id;
  const configBatchLabel = (batch?: string | null) => `Batch ${String(batch || "").trim() || "2025"}`;
  const semExamLabel = (semesterId: string, examId: string) => `${semesterLabel(semesterId)} - ${examLabel(examId)}`;
  const [, setLocation] = useLocation();
  const [selectedUniversityId, setSelectedUniversityId] = useState<string | null>(getUniversityIdFromSearch);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [examFilter, setExamFilter] = useState<string>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const { data: configs, isLoading, refetch } = useGetConfigs({}, { query: { queryKey: ["configs", "all"] } });
  const deleteConfig = useDeleteConfig();
  const purgeConfig = usePurgeConfig();
  const cloneConfig = useCloneConfigToUniversity();
  const enableConfig = useCreateConfig();
  const { toast } = useToast();
  const [disableTarget, setDisableTarget] = useState<{
    id: string;
    subject: string;
    year: string;
    exam: string;
  } | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<{
    id: string;
    subject: string;
    year: string;
    exam: string;
  } | null>(null);
  const [cloneTarget, setCloneTarget] = useState<{
    id: string;
    subject: string;
    year: string;
    exam: string;
    universityId: string;
  } | null>(null);
  const [cloneUniversityId, setCloneUniversityId] = useState<string>("");
  const [cloneTargetExam, setCloneTargetExam] = useState<string>("");
  const [cloneIncludeQuestions, setCloneIncludeQuestions] = useState(true);
  const [cloneIncludeSyllabus, setCloneIncludeSyllabus] = useState(true);
  const [cloneIncludeReplicaQuestions, setCloneIncludeReplicaQuestions] = useState(true);

  const sortedConfigs = [...(configs ?? [])].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  const universityCards = universities
    .map((u) => {
      const universityConfigs = sortedConfigs.filter((c) => c.universityId === u.id);
      return {
        id: u.id,
        name: u.name,
        total: universityConfigs.length,
        live: universityConfigs.filter((c) => c.status === "live").length,
        draft: universityConfigs.filter((c) => c.status !== "live").length,
      };
    })
    .filter((u) => {
      if (!search.trim()) return true;
      return u.name.toLowerCase().includes(search.toLowerCase());
    });

  const selectedUniversityConfigs = selectedUniversityId
    ? sortedConfigs.filter((c) => c.universityId === selectedUniversityId)
    : [];

  const yearOptions = Array.from(new Set(selectedUniversityConfigs.map((c) => c.year)));
  const branchOptions = Array.from(new Set(selectedUniversityConfigs.map((c) => c.branch))).sort((a, b) => a.localeCompare(b));
  const examOptions = Array.from(new Set(selectedUniversityConfigs.map((c) => c.exam)));
  const subjectOptions = Array.from(new Set(selectedUniversityConfigs.map((c) => c.subject))).sort((a, b) => a.localeCompare(b));

  const filteredConfigs = selectedUniversityConfigs.filter((c) => {
    if (yearFilter !== "all" && c.year !== yearFilter) return false;
    if (branchFilter !== "all" && c.branch !== branchFilter) return false;
    if (examFilter !== "all" && c.exam !== examFilter) return false;
    if (subjectFilter !== "all" && c.subject !== subjectFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.subject.toLowerCase().includes(q) ||
      c.branch.toLowerCase().includes(q) ||
      uniLabel(c.universityId).toLowerCase().includes(q)
    );
  });

  const activeConfigs = filteredConfigs.filter((c) => c.status !== "disabled");
  const disabledConfigs = filteredConfigs.filter((c) => c.status === "disabled");

  useEffect(() => {
    const syncFromSearch = () => {
      const fromSearch = getUniversityIdFromSearch();
      setSelectedUniversityId((prev) => (prev === fromSearch ? prev : fromSearch));
    };
    window.addEventListener("popstate", syncFromSearch);
    syncFromSearch();
    return () => window.removeEventListener("popstate", syncFromSearch);
  }, []);

  useEffect(() => {
    setYearFilter("all");
    setBranchFilter("all");
    setExamFilter("all");
    setSubjectFilter("all");
  }, [selectedUniversityId]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 flex-1 w-full sm:w-auto">
          {!selectedUniversityId ? (
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search universities..."
                className="pl-9"
              />
            </div>
          ) : (
            <div className="flex flex-col items-start gap-2 min-w-0">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  setSelectedUniversityId(null);
                  setSearch("");
                  setLocation("/admin");
                }}
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back to Universities</span>
              </Button>
              <span
                className="max-w-[14rem] sm:max-w-[24rem] truncate text-lg sm:text-xl font-bold uppercase tracking-wide text-foreground"
                title={uniLabel(selectedUniversityId)}
              >
                {uniLabel(selectedUniversityId)}
              </span>
            </div>
          )}
        </div>
        <div className="flex w-full sm:w-auto items-center justify-end gap-2 sm:gap-3">
          <CreateConfigDialog onCreated={() => refetch()} />
        </div>
      </div>
      {selectedUniversityId && (
        <div className="mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Year/Semester" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Semesters</SelectItem>
                  {yearOptions.map((yearId) => (
                    <SelectItem key={yearId} value={yearId}>
                      {semesterLabel(yearId)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Branch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branchOptions.map((branch) => (
                    <SelectItem key={branch} value={branch}>
                      {branch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Select value={examFilter} onValueChange={setExamFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Exam" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Exams</SelectItem>
                  {examOptions.map((examId) => (
                    <SelectItem key={examId} value={examId}>
                      {examLabel(examId)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Subject" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Subjects</SelectItem>
                  {subjectOptions.map((subject) => (
                    <SelectItem key={subject} value={subject}>
                      {subject}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 bg-card rounded-2xl border border-border animate-pulse" />
          ))}
        </div>
      ) : !selectedUniversityId && universityCards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-1">No universities found</h3>
          <p className="text-muted-foreground text-sm">Try a different search keyword.</p>
        </div>
      ) : selectedUniversityId && filteredConfigs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-1">No configs found</h3>
          <p className="text-muted-foreground text-sm">Create your first exam config for this university to get started.</p>
        </div>
      ) : !selectedUniversityId ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {universityCards.map((u, i) => (
              <motion.div
                key={u.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => {
                  if (u.total <= 0) return;
                  setSelectedUniversityId(u.id);
                  setLocation(`/admin?universityId=${encodeURIComponent(u.id)}`);
                }}
                className={`bg-card rounded-2xl border border-border p-5 transition-all ${
                  u.total > 0
                    ? "cursor-pointer hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
                    : "opacity-80"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <Badge variant="secondary" className="text-xs">
                    {u.total} Config{u.total === 1 ? "" : "s"}
                  </Badge>
                  {u.total > 0 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </div>
                <h3 className="font-semibold text-foreground text-lg mb-2 line-clamp-2">{u.name}</h3>
                <p className="text-sm text-muted-foreground mb-3">University-level configs</p>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Live: <span className="text-foreground font-medium">{u.live}</span></span>
                  <span className="text-muted-foreground">Draft: <span className="text-foreground font-medium">{u.draft}</span></span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="space-y-6">
          {activeConfigs.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-foreground mb-3">Active Configs</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <AnimatePresence>
                  {activeConfigs.map((config, i) => {
                    const hasFiles = Array.isArray(config.paperFileUrls) && config.paperFileUrls.length > 0;
                    return (
                      <motion.div
                        key={config.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        onClick={() =>
                          setLocation(
                            `/admin/config/${config.id}?universityId=${encodeURIComponent(config.universityId)}`
                          )
                        }
                        className="bg-card rounded-2xl border border-border p-5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all cursor-pointer group"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <Badge variant={config.status === "live" ? "default" : "secondary"} className="text-xs">
                            {config.status === "live" ? (
                              <><CheckCircle2 className="w-3 h-3 mr-1" /> Live</>
                            ) : (
                              <><Clock className="w-3 h-3 mr-1" /> Draft</>
                            )}
                          </Badge>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded-md">
                              {semExamLabel(config.year, config.exam)}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCloneTarget({
                                  id: config.id,
                                  subject: config.subject,
                                  year: config.year,
                                  exam: config.exam,
                                  universityId: config.universityId,
                                });
                                setCloneUniversityId("");
                                setCloneTargetExam(config.exam);
                                setCloneIncludeQuestions(true);
                                setCloneIncludeSyllabus(true);
                                setCloneIncludeReplicaQuestions(true);
                              }}
                              aria-label={`Clone ${config.subject}`}
                              title="Clone config"
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDisableTarget({
                                  id: config.id,
                                  subject: config.subject,
                                  year: config.year,
                                  exam: config.exam,
                                });
                              }}
                              disabled={deleteConfig.isPending || config.status !== "draft"}
                              aria-label={`Disable ${config.subject}`}
                              title={
                                config.status === "live"
                                  ? "Only draft configs can be disabled"
                                  : "Disable config"
                              }
                            >
                              <Ban className="w-4 h-4" />
                            </Button>
                            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                        </div>
                        <h3 className="font-semibold text-foreground text-lg mb-1 line-clamp-1">{config.subject}</h3>
                        <p className="text-sm text-muted-foreground mb-3">
                          {uniLabel(config.universityId)} &middot; {config.branch} &middot; {configBatchLabel((config as any).batch)}
                        </p>
                        <div className="flex items-center justify-between">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLocation(
                                `/roadmap?configId=${encodeURIComponent(config.id)}&subject=${encodeURIComponent(config.subject)}&exam=${encodeURIComponent(config.exam)}&returnTo=${encodeURIComponent(`/admin?universityId=${config.universityId}`)}`
                                );
                              }}
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Preview
                          </Button>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {hasFiles && <FileText className="w-3.5 h-3.5 text-green-500" />}
                            {config.createdAt && new Date(config.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>
          )}

          {disabledConfigs.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-foreground mb-3">Disabled Configs</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <AnimatePresence>
                  {disabledConfigs.map((config, i) => (
                    <motion.div
                      key={config.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="bg-card rounded-2xl border border-dashed border-border p-5"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <Badge variant="secondary" className="text-xs">Disabled</Badge>
                        <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded-md">
                          {semExamLabel(config.year, config.exam)}
                        </span>
                      </div>
                      <h3 className="font-semibold text-foreground text-lg mb-1 line-clamp-1">{config.subject}</h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        {uniLabel(config.universityId)} &middot; {config.branch} &middot; {configBatchLabel((config as any).batch)}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 text-xs"
                        disabled={enableConfig.isPending}
                        onClick={() => {
                          enableConfig.mutate(
                            {
                              data: {
                                universityId: config.universityId,
                                batch: String((config as any).batch || "").trim() || "2025",
                                year: config.year,
                                branch: config.branch,
                                subject: config.subject,
                                exam: config.exam as "mid1" | "mid2" | "endsem",
                                reuseDisabledConfigId: config.id,
                              },
                            },
                            {
                              onSuccess: () => {
                                refetch();
                                toast({
                                  title: "Config enabled",
                                  description: `${config.subject} has been enabled as draft.`,
                                });
                              },
                              onError: () => {
                                toast({
                                  title: "Enable failed",
                                  description: "Could not enable this config. Please try again.",
                                  variant: "destructive",
                                });
                              },
                            }
                          );
                        }}
                      >
                        Enable
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="h-8 text-xs ml-2"
                        disabled={purgeConfig.isPending}
                        onClick={() =>
                          setPurgeTarget({
                            id: config.id,
                            subject: config.subject,
                            year: config.year,
                            exam: config.exam,
                          })
                        }
                      >
                        Delete
                      </Button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={!!disableTarget} onOpenChange={(open) => !open && setDisableTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable Roadmap?</AlertDialogTitle>
            <AlertDialogDescription>
              {disableTarget
                ? `Disable "${disableTarget.subject}" (${semExamLabel(disableTarget.year, disableTarget.exam)})? Students will no longer see it, but units, explanations, and question bank data will be preserved.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!disableTarget) return;
                deleteConfig.mutate(
                  { id: disableTarget.id },
                  {
                    onSuccess: () => {
                      refetch();
                      toast({
                        title: "Roadmap disabled",
                        description: `${disableTarget.subject} has been disabled.`,
                      });
                      setDisableTarget(null);
                    },
                    onError: () => {
                      toast({
                        title: "Disable failed",
                        description: "Could not disable this roadmap. Please try again.",
                        variant: "destructive",
                      });
                    },
                  }
                );
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!cloneTarget}
        onOpenChange={(open) => {
          if (!open) {
            setCloneTarget(null);
            setCloneUniversityId("");
            setCloneTargetExam("");
            setCloneIncludeQuestions(true);
            setCloneIncludeSyllabus(true);
            setCloneIncludeReplicaQuestions(true);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Clone Config To University</DialogTitle>
          </DialogHeader>
          {cloneTarget && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Clone <span className="font-medium text-foreground">{cloneTarget.subject}</span> (
                {semExamLabel(cloneTarget.year, cloneTarget.exam)}) as a new
                <span className="font-medium text-foreground"> draft </span>
                config.
              </p>
              <div className="space-y-2">
                <Label>Target University</Label>
                <Select value={cloneUniversityId} onValueChange={setCloneUniversityId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select target university" />
                  </SelectTrigger>
                  <SelectContent>
                    {universities
                      .map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Target Exam</Label>
                <Select
                  value={cloneTargetExam}
                  onValueChange={setCloneTargetExam}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select target exam" />
                  </SelectTrigger>
                  <SelectContent>
                    {examTypes.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Clone Includes
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={cloneIncludeQuestions}
                    onCheckedChange={(v) => setCloneIncludeQuestions(Boolean(v))}
                  />
                  <span>Questions</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={cloneIncludeSyllabus}
                    onCheckedChange={(v) => setCloneIncludeSyllabus(Boolean(v))}
                  />
                  <span>Syllabus</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={cloneIncludeReplicaQuestions}
                    onCheckedChange={(v) => setCloneIncludeReplicaQuestions(Boolean(v))}
                  />
                  <span>Replica Questions</span>
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setCloneTarget(null);
                    setCloneUniversityId("");
                    setCloneTargetExam("");
                    setCloneIncludeQuestions(true);
                    setCloneIncludeSyllabus(true);
                    setCloneIncludeReplicaQuestions(true);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  disabled={!cloneUniversityId || !cloneTargetExam || cloneConfig.isPending}
                  onClick={() => {
                    if (!cloneTarget || !cloneUniversityId || !cloneTargetExam) return;
                    cloneConfig.mutate(
                      {
                        configId: cloneTarget.id,
                        targetUniversityId: cloneUniversityId,
                        targetExam: cloneTargetExam,
                        includeQuestions: cloneIncludeQuestions,
                        includeSyllabus: cloneIncludeSyllabus,
                        includeReplicaQuestions: cloneIncludeReplicaQuestions,
                      },
                      {
                        onSuccess: () => {
                          toast({
                            title: "Config cloned",
                            description: `${cloneTarget.subject} was cloned successfully.`,
                          });
                          setCloneTarget(null);
                          setCloneUniversityId("");
                          setCloneTargetExam("");
                          setCloneIncludeQuestions(true);
                          setCloneIncludeSyllabus(true);
                          setCloneIncludeReplicaQuestions(true);
                          refetch();
                        },
                        onError: (err: any) => {
                          const message =
                            err?.response?.data?.error ||
                            err?.message ||
                            "Could not clone config. Please try again.";
                          toast({
                            title: "Clone failed",
                            description: message,
                            variant: "destructive",
                          });
                        },
                      },
                    );
                  }}
                >
                  {cloneConfig.isPending ? "Cloning..." : "Clone Config"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!purgeTarget} onOpenChange={(open) => !open && setPurgeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Disabled Config Permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-3">
                <p>
                  You are deleting <b>{purgeTarget?.subject}</b> (
                  {purgeTarget ? semExamLabel(purgeTarget.year, purgeTarget.exam) : ""}).
                </p>
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-foreground">
                  <p className="font-medium mb-1">This will permanently remove:</p>
                  <p>- Config-scoped roadmap node rows for this config (not global canonical/unit content)</p>
                  <p>- Question bank entries linked to this config</p>
                  <p>- Interaction/progress events and related analytics for this config</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  This action cannot be undone. If you may need this config later, use <b>Enable</b> instead.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purgeConfig.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={purgeConfig.isPending}
              onClick={() => {
                if (!purgeTarget) return;
                purgeConfig.mutate(
                  { id: purgeTarget.id },
                  {
                    onSuccess: () => {
                      toast({
                        title: "Config deleted",
                        description: `${purgeTarget.subject} was permanently deleted.`,
                      });
                      setPurgeTarget(null);
                      refetch();
                    },
                    onError: () => {
                      toast({
                        title: "Delete failed",
                        description: "Could not permanently delete this config.",
                        variant: "destructive",
                      });
                    },
                  }
                );
              }}
            >
              {purgeConfig.isPending ? "Deleting..." : "Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AnalyticsTab() {
  const { data: metadata } = useGetAppMetadata();
  const universities = metadata?.universities?.length ? metadata.universities : UNIVERSITIES;
  const semesters = metadata?.semesters?.length ? metadata.semesters : SEMESTERS;
  const examTypes = metadata?.examTypes?.length ? metadata.examTypes : EXAM_TYPES;
  const uniLabel = (id: string) => universities.find((u) => u.id === id)?.name ?? id;
  const semesterLabel = (id: string) => semesters.find((s) => s.id === id)?.name ?? id;
  const examLabel = (id: string) => examTypes.find((e) => e.id === id)?.name ?? id;
  const {
    data: allConfigs,
    isLoading: configsLoading,
    isError: configsError,
    error: configsErrorDetails,
  } = useGetConfigs({}, {
    query: {
      queryKey: ["configs", "all"],
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  });
  const { data: liveConfigQbSummary } = useGetLiveConfigQuestionBankInteractionSummary({
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const {
    data: cacheStatsData,
    isLoading: cacheStatsLoading,
    refetch: refetchCacheStats,
    isFetching: cacheStatsFetching,
  } = useGetServerCacheStats({
    refetchInterval: 30000,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const {
    data: cacheHealthData,
    isLoading: cacheHealthLoading,
    refetch: refetchCacheHealth,
    isFetching: cacheHealthFetching,
  } = useGetServerCacheHealth({
    refetchInterval: 30000,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const { data: universityAnalytics } = useGetUniversityAnalytics({
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const allConfigsSafe = useMemo(() => allConfigs ?? [], [allConfigs]);
  const studentCountByUniversity = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of universityAnalytics ?? []) {
      map.set(row.universityId, row.totalStudents ?? 0);
    }
    return map;
  }, [universityAnalytics]);
  const universityRows = useMemo(
    () =>
      universities.map((u) => ({
        universityId: u.id,
        configs: allConfigsSafe.filter((cfg) => cfg.universityId === u.id),
      })),
    [universities, allConfigsSafe]
  );
  const [selectedUniversityId, setSelectedUniversityId] = useState<string | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const selectedUniversityRow = universityRows.find((row) => row.universityId === selectedUniversityId) ?? null;
  const selectedUniversityConfigs = selectedUniversityRow?.configs ?? [];
  const selectedConfig = selectedUniversityConfigs.find((cfg) => cfg.id === selectedConfigId) ?? null;
  const semesterOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    semesters.forEach((s, idx) => map.set(s.id, idx));
    return map;
  }, [semesters]);
  const examOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    examTypes.forEach((e, idx) => map.set(e.id, idx));
    return map;
  }, [examTypes]);
  const statusOrderMap = useMemo(
    () => new Map<string, number>([["live", 0], ["draft", 1], ["disabled", 2], ["deleted", 3]]),
    []
  );
  const [expandedSemesters, setExpandedSemesters] = useState<Record<string, boolean>>({});
  const [expandedExams, setExpandedExams] = useState<Record<string, boolean>>({});

  const groupedSelectedUniversityConfigs = useMemo(() => {
    const statusMap = new Map<
      string,
      {
        status: string;
        years: Map<
          string,
          {
            yearId: string;
            exams: Map<
              string,
              {
                examId: string;
                configs: typeof selectedUniversityConfigs;
              }
            >;
          }
        >;
      }
    >();

    for (const cfg of selectedUniversityConfigs) {
      const status = String(cfg.status || "unknown").toLowerCase();
      const yearId = cfg.year || "other";
      const examId = cfg.exam || "other";
      if (!statusMap.has(status)) {
        statusMap.set(status, { status, years: new Map() });
      }
      const statusEntry = statusMap.get(status)!;
      if (!statusEntry.years.has(yearId)) {
        statusEntry.years.set(yearId, { yearId, exams: new Map() });
      }
      const yearEntry = statusEntry.years.get(yearId)!;
      if (!yearEntry.exams.has(examId)) {
        yearEntry.exams.set(examId, { examId, configs: [] });
      }
      const examEntry = yearEntry.exams.get(examId)!;
      examEntry.configs = [...examEntry.configs, cfg];
    }

    const statuses = Array.from(statusMap.values())
      .map((statusGroup) => {
        const years = Array.from(statusGroup.years.values())
          .map((yearGroup) => {
            const exams = Array.from(yearGroup.exams.values())
              .map((examGroup) => ({
                examId: examGroup.examId,
                configs: [...examGroup.configs].sort(
                  (a, b) => a.subject.localeCompare(b.subject) || a.id.localeCompare(b.id)
                ),
              }))
              .sort(
                (a, b) =>
                  (examOrderMap.get(a.examId) ?? 99) - (examOrderMap.get(b.examId) ?? 99) ||
                  a.examId.localeCompare(b.examId)
              );
            return { yearId: yearGroup.yearId, exams };
          })
          .sort(
            (a, b) =>
              (semesterOrderMap.get(a.yearId) ?? 99) - (semesterOrderMap.get(b.yearId) ?? 99) ||
              a.yearId.localeCompare(b.yearId)
          );
        return { status: statusGroup.status, years };
      })
      .sort(
        (a, b) =>
          (statusOrderMap.get(a.status) ?? 99) - (statusOrderMap.get(b.status) ?? 99) ||
          a.status.localeCompare(b.status)
      );

    return statuses;
  }, [selectedUniversityConfigs, statusOrderMap, examOrderMap, semesterOrderMap]);

  const statusLabel = (status: string) => {
    switch (status) {
      case "live":
        return "Live";
      case "draft":
        return "Draft";
      case "disabled":
        return "Disabled";
      case "deleted":
        return "Deleted";
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

  const totalConfigsForSelectedUniversity = selectedUniversityConfigs.length;
  const qbSummaryByConfig = useMemo(() => {
    const map = new Map<string, {
      totalStudents: number;
      uniqueStudents: number;
      totalInteractions: number;
      interactionPercent: number;
    }>();
    for (const row of liveConfigQbSummary?.rows ?? []) {
      map.set(row.configId, {
        totalStudents: row.totalStudents,
        uniqueStudents: row.uniqueStudents,
        totalInteractions: row.totalInteractions,
        interactionPercent: row.interactionPercent,
      });
    }
    return map;
  }, [liveConfigQbSummary]);
  const { data: studentProgress, isLoading: studentsLoading } = useGetConfigStudentProgress(
    selectedConfigId,
    {
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    }
  );
  const { data: selectedConfigQuestionBank } = useGetQuestionBank(selectedConfigId, {
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const ratingOrder = ["Poor", "Average", "Good"] as const;
  const ratingTileOrder = ["Good", "Average", "Poor"] as const;
  type RatingBucket = (typeof ratingOrder)[number];
  type StudentSortKey = "student" | "subtopicCoverage" | "qbInteractions" | "lastActive";
  type SortDirection = "asc" | "desc";
  const [subtopicRatingFilter, setSubtopicRatingFilter] = useState<"all" | RatingBucket>("all");
  const [qbRatingFilter, setQbRatingFilter] = useState<"all" | RatingBucket>("all");
  const [studentSortKey, setStudentSortKey] = useState<StudentSortKey>("student");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const ratingSummaryClasses: Record<RatingBucket, string> = {
    Poor: "border-rose-200 bg-rose-50 text-rose-700",
    Average: "border-amber-200 bg-amber-50 text-amber-700",
    Good: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  const getMetricRating = (percent: number): "Poor" | "Average" | "Good" => {
    if (percent < 50) return "Poor";
    if (percent <= 75) return "Average";
    return "Good";
  };
  const selectedConfigSubtopicRatingCounts = useMemo(() => {
    const counts = { Poor: 0, Average: 0, Good: 0 };
    if (!studentProgress) return counts;

    for (const s of studentProgress.students) {
      const subtopicPercent = Math.round(s.progressPercent);
      const rating = getMetricRating(subtopicPercent);
      counts[rating] += 1;
    }
    return counts;
  }, [studentProgress]);
  const selectedConfigQbRatingCounts = useMemo(() => {
    const counts = { Poor: 0, Average: 0, Good: 0 };
    if (!studentProgress) return counts;

    const totalQuestions = selectedConfigQuestionBank?.total ?? 0;
    for (const s of studentProgress.students) {
      const rawQbInteractions = s.questionBankInteractions ?? 0;
      const normalizedQbInteractions =
        totalQuestions > 0 ? Math.min(rawQbInteractions, totalQuestions) : 0;
      const qbPercent =
        totalQuestions > 0 ? Math.round((normalizedQbInteractions / totalQuestions) * 100) : 0;
      const rating = getMetricRating(qbPercent);
      counts[rating] += 1;
    }
    return counts;
  }, [studentProgress, selectedConfigQuestionBank]);
  const cacheStats = cacheStatsData?.cache;
  const cacheHealth = cacheHealthData?.health;
  const cacheTotalLookups = (cacheStats?.hit ?? 0) + (cacheStats?.miss ?? 0);
  const cacheHitRate =
    cacheTotalLookups > 0 ? Math.round(((cacheStats?.hit ?? 0) / cacheTotalLookups) * 100) : 0;
  const redisTotalLookups = (cacheStats?.redisHit ?? 0) + (cacheStats?.redisMiss ?? 0);
  const redisHitRate =
    redisTotalLookups > 0 ? Math.round(((cacheStats?.redisHit ?? 0) / redisTotalLookups) * 100) : 0;
  const selectedConfigSubtopicRatingPercents = useMemo(() => {
    const total = studentProgress?.students.length ?? 0;
    const toPercent = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0);
    return {
      Poor: toPercent(selectedConfigSubtopicRatingCounts.Poor),
      Average: toPercent(selectedConfigSubtopicRatingCounts.Average),
      Good: toPercent(selectedConfigSubtopicRatingCounts.Good),
    };
  }, [studentProgress, selectedConfigSubtopicRatingCounts]);
  const selectedConfigQbRatingPercents = useMemo(() => {
    const total = studentProgress?.students.length ?? 0;
    const toPercent = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0);
    return {
      Poor: toPercent(selectedConfigQbRatingCounts.Poor),
      Average: toPercent(selectedConfigQbRatingCounts.Average),
      Good: toPercent(selectedConfigQbRatingCounts.Good),
    };
  }, [studentProgress, selectedConfigQbRatingCounts]);
  const getQbPercent = (s: {
    questionBankInteractions?: number;
  }) => {
    const totalQuestions = selectedConfigQuestionBank?.total ?? 0;
    const rawQbInteractions = s.questionBankInteractions ?? 0;
    const normalizedQbInteractions =
      totalQuestions > 0 ? Math.min(rawQbInteractions, totalQuestions) : 0;
    return totalQuestions > 0 ? Math.round((normalizedQbInteractions / totalQuestions) * 100) : 0;
  };
  const filteredStudents = useMemo(() => {
    if (!studentProgress) return [];
    return studentProgress.students
      .filter((s) => {
        const subtopicPercent = Math.round(s.progressPercent);
        const subtopicRating = getMetricRating(subtopicPercent);
        if (subtopicRatingFilter !== "all" && subtopicRating !== subtopicRatingFilter) return false;
        const qbRating = getMetricRating(getQbPercent(s));
        if (qbRatingFilter !== "all" && qbRating !== qbRatingFilter) return false;
        return true;
      })
      .sort((a, b) => {
        if (studentSortKey === "student") {
          const cmp = a.userId.localeCompare(b.userId);
          return sortDirection === "asc" ? cmp : -cmp;
        }
        if (studentSortKey === "subtopicCoverage") {
          const cmp = Math.round(a.progressPercent) - Math.round(b.progressPercent) || a.userId.localeCompare(b.userId);
          return sortDirection === "asc" ? cmp : -cmp;
        }
        if (studentSortKey === "qbInteractions") {
          const cmp = getQbPercent(a) - getQbPercent(b) || a.userId.localeCompare(b.userId);
          return sortDirection === "asc" ? cmp : -cmp;
        }
        const aTs = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
        const bTs = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
        const cmp = aTs - bTs || a.userId.localeCompare(b.userId);
        return sortDirection === "asc" ? cmp : -cmp;
      });
  }, [studentProgress, qbRatingFilter, selectedConfigQuestionBank, studentSortKey, sortDirection]);

  useEffect(() => {
    setSubtopicRatingFilter("all");
    setQbRatingFilter("all");
    setStudentSortKey("student");
    setSortDirection("asc");
  }, [selectedConfigId]);

  return (
    <div>
      <div className="mb-6 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Server Cache</h3>
            <p className="text-xs text-muted-foreground">Auto-refresh every 30s</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetchCacheStats()}
            disabled={cacheStatsFetching}
          >
            {cacheStatsFetching ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Hit Rate</p>
            <p className="text-lg font-semibold text-foreground">{cacheStatsLoading ? "-" : `${cacheHitRate}%`}</p>
          </div>
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cache Size</p>
            <p className="text-lg font-semibold text-foreground">{cacheStatsLoading ? "-" : (cacheStats?.size ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Hits / Misses</p>
            <p className="text-lg font-semibold text-foreground">
              {cacheStatsLoading ? "-" : `${cacheStats?.hit ?? 0} / ${cacheStats?.miss ?? 0}`}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Set / Del / Sweep</p>
            <p className="text-lg font-semibold text-foreground">
              {cacheStatsLoading
                ? "-"
                : `${cacheStats?.set ?? 0} / ${cacheStats?.del ?? 0} / ${cacheStats?.sweep ?? 0}`}
            </p>
          </div>
        </div>
      </div>
      <div className="mb-6 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Redis Cache</h3>
            <p className="text-xs text-muted-foreground">Auto-refresh every 30s</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refetchCacheHealth();
              void refetchCacheStats();
            }}
            disabled={cacheHealthFetching || cacheStatsFetching}
          >
            {cacheHealthFetching || cacheStatsFetching ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Backend Mode</p>
            <p className="text-lg font-semibold text-foreground">
              {cacheHealthLoading ? "-" : (cacheHealth?.backend ?? "memory-only")}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Redis Status</p>
            <p className="text-lg font-semibold text-foreground">
              {cacheHealthLoading
                ? "-"
                : cacheHealth?.redis?.enabled
                ? cacheHealth.redis.ready
                  ? "Connected"
                  : "Disconnected"
                : "Disabled"}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Redis Hit Rate</p>
            <p className="text-lg font-semibold text-foreground">
              {cacheStatsLoading ? "-" : `${redisHitRate}%`}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Redis H / M / E</p>
            <p className="text-lg font-semibold text-foreground">
              {cacheStatsLoading
                ? "-"
                : `${cacheStats?.redisHit ?? 0} / ${cacheStats?.redisMiss ?? 0} / ${cacheStats?.redisErr ?? 0}`}
            </p>
          </div>
        </div>
      </div>
      <div className="bg-card rounded-3xl border border-border shadow-lg shadow-black/5 overflow-hidden">
        <div className="px-6 py-5 border-b border-border bg-secondary/30">
          <h2 className="text-lg font-semibold text-foreground">Detailed Analytics By University</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-4 font-semibold">University</th>
                <th className="px-6 py-4 font-semibold text-right">Students</th>
                <th className="px-6 py-4 font-semibold text-right">Live Configs</th>
                <th className="px-6 py-4 font-semibold text-right">Total Configs</th>
                <th className="px-6 py-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 text-sm">
              {configsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-3/4" /></td>
                    <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-1/3 ml-auto" /></td>
                    <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-1/3 ml-auto" /></td>
                    <td className="px-6 py-4"><div className="h-5 bg-muted animate-pulse rounded w-1/3 ml-auto" /></td>
                    <td className="px-6 py-4"><div className="h-8 bg-muted animate-pulse rounded w-24 ml-auto" /></td>
                  </tr>
                ))
              ) : configsError ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-destructive">
                    Failed to load analytics: {configsErrorDetails instanceof Error ? configsErrorDetails.message : "Unknown error"}
                  </td>
                </tr>
              ) : (
                universityRows.map((row, i) => {
                  const liveConfigCount = row.configs.filter((cfg) => cfg.status === "live").length;
                  return (
                    <motion.tr
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      key={row.universityId}
                      className="hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-6 py-4 font-medium text-foreground">
                        {uniLabel(row.universityId)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="font-display font-bold text-foreground">
                          {studentCountByUniversity.get(row.universityId) ?? 0}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="font-display font-bold text-foreground">{liveConfigCount}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="font-display font-bold text-foreground">{row.configs.length}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={row.configs.length === 0}
                          onClick={() => {
                            setSelectedUniversityId(row.universityId);
                            setSelectedConfigId(null);
                          }}
                        >
                          Show All Configs
                        </Button>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog
        open={!!selectedUniversityId}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedUniversityId(null);
            setSelectedConfigId(null);
          }
        }}
      >
        <DialogContent className="flex flex-col w-[75vw] max-w-[75vw] h-[90vh] overflow-hidden p-0 gap-0">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-12">
            {selectedConfig ? (
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 shrink-0"
                  onClick={() => setSelectedConfigId(null)}
                  aria-label="Back to live configs"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="space-y-0.5">
                  <DialogTitle className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Student Progress
                  </DialogTitle>
                  <p className="text-base font-semibold text-foreground">
                    {`${uniLabel(selectedUniversityId || "")} | ${selectedConfig.subject} | ${semesterLabel(selectedConfig.year)} | ${examLabel(selectedConfig.exam)} | Batch ${String((selectedConfig as any).batch || "").trim() || "2025"}`}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-0.5">
                <DialogTitle className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Configs
                </DialogTitle>
                <p className="text-base font-semibold text-foreground">
                  {uniLabel(selectedUniversityId || "")}
                </p>
              </div>
            )}
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-hidden px-6 py-4">
          {!selectedConfig ? (
            <div className="h-full min-h-0 flex flex-col">
              {/* <div className="shrink-0 text-sm text-muted-foreground">
                Total configs: <span className="font-semibold text-foreground">{totalConfigsForSelectedUniversity}</span>
              </div> */}
              <div className="min-h-0 flex-1 overflow-auto border border-border rounded-xl">
              <table className="w-full min-w-[860px] text-left border-collapse">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Group</th>
                    <th className="px-4 py-3 font-semibold">Subject</th>
                    <th className="px-4 py-3 font-semibold">Semester</th>
                    <th className="px-4 py-3 font-semibold">Exam</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Branch</th>
                    <th className="px-4 py-3 font-semibold text-right">QB Reach</th>
                    <th className="px-4 py-3 font-semibold text-right sticky right-0 bg-card z-20 border-l border-border">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50 text-sm">
                  {groupedSelectedUniversityConfigs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                        No configs found for this university.
                      </td>
                    </tr>
                  ) : (
                    groupedSelectedUniversityConfigs.flatMap((statusGroup) => {
                      const statusKey = statusGroup.status;
                      const statusOpen = expandedSemesters[statusKey] ?? true;
                      const statusTotal = statusGroup.years.reduce(
                        (acc, year) => acc + year.exams.reduce((examAcc, exam) => examAcc + exam.configs.length, 0),
                        0
                      );
                      const statusRows = [
                        <tr key={`status-${statusKey}`} className="bg-muted/35">
                          <td className="px-4 py-3 font-semibold text-foreground" colSpan={8}>
                            <button
                              type="button"
                              className="inline-flex items-center gap-2"
                              onClick={() =>
                                setExpandedSemesters((prev) => ({ ...prev, [statusKey]: !statusOpen }))
                              }
                            >
                              <ChevronRight className={`w-4 h-4 transition-transform ${statusOpen ? "rotate-90" : ""}`} />
                              <span>Status: {statusLabel(statusGroup.status)}</span>
                              <Badge variant="secondary">{statusTotal}</Badge>
                            </button>
                          </td>
                        </tr>,
                      ];
                      if (!statusOpen) return statusRows;

                      for (const yearGroup of statusGroup.years) {
                        const yearKey = `${statusKey}::${yearGroup.yearId}`;
                        const yearOpen = expandedExams[yearKey] ?? true;
                        const yearTotal = yearGroup.exams.reduce((acc, exam) => acc + exam.configs.length, 0);
                        statusRows.push(
                          <tr key={`year-${yearKey}`} className="bg-muted/20">
                            <td className="px-4 py-3 pl-8 font-medium text-foreground" colSpan={8}>
                              <button
                                type="button"
                                className="inline-flex items-center gap-2"
                                onClick={() =>
                                  setExpandedExams((prev) => ({ ...prev, [yearKey]: !yearOpen }))
                                }
                              >
                                <ChevronRight className={`w-4 h-4 transition-transform ${yearOpen ? "rotate-90" : ""}`} />
                                <span>Year: {semesterLabel(yearGroup.yearId)}</span>
                                <Badge variant="outline">{yearTotal}</Badge>
                              </button>
                            </td>
                          </tr>
                        );
                        if (!yearOpen) continue;

                        for (const examGroup of yearGroup.exams) {
                          for (const cfg of examGroup.configs) {
                            const qb = qbSummaryByConfig.get(cfg.id);
                            const percent = Math.round(qb?.interactionPercent ?? 0);
                            const uniqueStudents = qb?.uniqueStudents ?? 0;
                            statusRows.push(
                              <tr key={cfg.id}>
                                <td className="px-4 py-3 pl-12 text-muted-foreground">{examLabel(examGroup.examId)}</td>
                                <td className="px-4 py-3 font-medium text-foreground">{cfg.subject}</td>
                                <td className="px-4 py-3 text-foreground">{semesterLabel(cfg.year)}</td>
                                <td className="px-4 py-3 text-foreground">{examLabel(cfg.exam)}</td>
                                <td className="px-4 py-3 text-foreground">
                                  <Badge variant={cfg.status === "live" ? "default" : "outline"}>
                                    {statusLabel(cfg.status)}
                                  </Badge>
                                </td>
                                <td className="px-4 py-3 text-foreground">{cfg.branch}</td>
                                <td className="px-4 py-3 text-right">
                                  <div className="inline-flex items-center gap-2">
                                    <span className="font-semibold text-foreground">{percent}%</span>
                                    <span className="text-xs text-muted-foreground">({uniqueStudents})</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-right sticky right-0 bg-card border-l border-border">
                                  <Button variant="outline" size="sm" onClick={() => setSelectedConfigId(cfg.id)}>
                                    Student Progress
                                  </Button>
                                </td>
                              </tr>
                            );
                          }
                        }
                      }
                      return statusRows;
                    })
                  )}
                </tbody>
              </table>
              </div>
            </div>
          ) : (
            <div className="h-full min-h-0 flex flex-col gap-3">
              {studentsLoading ? (
                <div className="py-8 text-center text-muted-foreground">Loading students...</div>
              ) : !studentProgress ? (
                <div className="py-8 text-center text-muted-foreground">No student progress data found.</div>
              ) : (
                <div className="min-h-0 flex-1 flex flex-col gap-3">
                  <div className="space-y-3 shrink-0">
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      <div className="rounded-xl border border-border bg-card/70 p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Sub-topic Ratings
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {ratingTileOrder.map((rating) => (
                            <div
                              key={`subtopic-${rating}`}
                              className={`rounded-lg border px-3 py-2 ${ratingSummaryClasses[rating]}`}
                            >
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-center">{rating}</div>
                              <div className="mt-1 flex items-baseline justify-center gap-2 text-center">
                                <span className="text-lg font-bold tabular-nums">
                                  {selectedConfigSubtopicRatingPercents[rating]}%
                                </span>
                                <span className="text-xs font-semibold tabular-nums opacity-90">
                                  {selectedConfigSubtopicRatingCounts[rating]}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border bg-card/70 p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          QB Ratings
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {ratingTileOrder.map((rating) => (
                            <div
                              key={`qb-${rating}`}
                              className={`rounded-lg border px-3 py-2 ${ratingSummaryClasses[rating]}`}
                            >
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-center">{rating}</div>
                              <div className="mt-1 flex items-baseline justify-center gap-2 text-center">
                                <span className="text-lg font-bold tabular-nums">
                                  {selectedConfigQbRatingPercents[rating]}%
                                </span>
                                <span className="text-xs font-semibold tabular-nums opacity-90">
                                  {selectedConfigQbRatingCounts[rating]}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                <div className="min-h-0 flex-1 flex flex-col">
                  <div className="border border-border rounded-xl min-h-0 flex-1 overflow-hidden flex flex-col">
                    <div className="shrink-0 px-4 py-3 border-b border-border bg-secondary/20 flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-foreground">Student Performance</span>
                      <div className="flex items-center gap-2">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2.5"
                              aria-label="Open sorting"
                            >
                              <ArrowUpDown className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-64 space-y-2 p-3">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Sort By
                            </Label>
                            <Select
                              value={studentSortKey}
                              onValueChange={(value) => setStudentSortKey(value as StudentSortKey)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="student">Student</SelectItem>
                                <SelectItem value="subtopicCoverage">Sub-topic Coverage</SelectItem>
                                <SelectItem value="qbInteractions">QB Interactions</SelectItem>
                                <SelectItem value="lastActive">Last Active</SelectItem>
                              </SelectContent>
                            </Select>
                            <Label className="pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Direction
                            </Label>
                            <RadioGroup
                              value={sortDirection}
                              onValueChange={(value) => setSortDirection(value as SortDirection)}
                              className="gap-2"
                            >
                              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                                <RadioGroupItem value="asc" id="sort-direction-asc" />
                                <span>Low to High</span>
                              </label>
                              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                                <RadioGroupItem value="desc" id="sort-direction-desc" />
                                <span>High to Low</span>
                              </label>
                            </RadioGroup>
                          </PopoverContent>
                        </Popover>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2.5"
                              aria-label="Open filters"
                            >
                              <SlidersHorizontal className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-72 space-y-3 p-3">
                            <div className="space-y-1">
                              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Sub-topic Rating Filter
                              </Label>
                              <Select
                                value={subtopicRatingFilter}
                                onValueChange={(value) =>
                                  setSubtopicRatingFilter(value as "all" | RatingBucket)
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">All</SelectItem>
                                  {ratingOrder.map((rating) => (
                                    <SelectItem key={`subtopic-filter-${rating}`} value={rating}>
                                      {rating}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                QB Rating Filter
                              </Label>
                              <Select
                                value={qbRatingFilter}
                                onValueChange={(value) =>
                                  setQbRatingFilter(value as "all" | RatingBucket)
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">All</SelectItem>
                                  {ratingOrder.map((rating) => (
                                    <SelectItem key={`qb-filter-${rating}`} value={rating}>
                                      {rating}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 z-20 bg-card">
                        <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-3 text-center">Student</th>
                          <th className="px-4 py-3 font-semibold text-center">Semester</th>
                          <th className="px-4 py-3 font-semibold text-center">Branch</th>
                          <th className="px-4 py-3 font-semibold text-center">Sub-topic Coverage</th>
                          <th className="px-4 py-3 font-semibold text-center">QB Interactions</th>
                          <th className="px-4 py-3 font-semibold text-center">Sub-topic Rating</th>
                          <th className="px-4 py-3 font-semibold text-center">QB Rating</th>
                          <th className="px-4 py-3 font-semibold text-center">Last Active</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50 text-sm">
                        {filteredStudents.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                              No students match the selected filters.
                            </td>
                          </tr>
                        ) : (
                          filteredStudents.map((s) => {
                            const pct = Math.round(s.progressPercent);
                            const totalQuestions = selectedConfigQuestionBank?.total ?? 0;
                            const rawQbInteractions = s.questionBankInteractions ?? 0;
                            const normalizedQbInteractions =
                              totalQuestions > 0 ? Math.min(rawQbInteractions, totalQuestions) : 0;
                            const qbPct = getQbPercent(s);
                            const subtopicRating = getMetricRating(pct);
                            const qbRating = getMetricRating(qbPct);
                            return (
                              <tr key={s.userId}>
                                <td className="px-4 py-3 font-medium text-foreground">{s.userId}</td>
                                <td className="px-4 py-3 text-foreground">{semesterLabel(s.year)}</td>
                                <td className="px-4 py-3 text-foreground">{s.branch}</td>
                                <td className="px-4 py-3 text-right">
                                  <div className="inline-flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">
                                      {s.doneSubtopics}/{s.totalSubtopics}
                                    </span>
                                    <span className="font-semibold text-foreground">{pct}%</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="inline-flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">
                                      {normalizedQbInteractions}/{totalQuestions}
                                    </span>
                                    <span className="font-semibold text-foreground">{qbPct}%</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <span
                                    className={
                                      subtopicRating === "Good"
                                        ? "inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"
                                        : subtopicRating === "Average"
                                        ? "inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"
                                        : "inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"
                                    }
                                  >
                                    {subtopicRating}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <span
                                    className={
                                      qbRating === "Good"
                                        ? "inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"
                                        : qbRating === "Average"
                                        ? "inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"
                                        : "inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"
                                    }
                                  >
                                    {qbRating}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right text-muted-foreground">
                                  {s.lastActiveAt ? new Date(s.lastActiveAt).toLocaleDateString() : "-"}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                    </div>
                  </div>
                </div>
                </div>
              )}
            </div>
          )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Admin() {
  return (
    <div className="w-full max-w-6xl mx-auto pt-4 pb-20 px-4 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
          <Settings className="w-8 h-8 text-primary" />
          Admin Dashboard
        </h1>
        <p className="text-muted-foreground mt-2">
          Manage exam configs, generate content, and monitor analytics.
        </p>
      </div>

      <Tabs defaultValue="configs">
        <TabsList className="mb-6">
          <TabsTrigger value="configs" className="gap-2">
            <FileText className="w-4 h-4" /> Configs
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="w-4 h-4" /> Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="configs">
          <ConfigsTab />
        </TabsContent>
        <TabsContent value="analytics">
          <AnalyticsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
