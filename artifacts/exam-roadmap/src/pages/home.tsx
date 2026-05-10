import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Calendar, GraduationCap, BookOpen, ChevronRight, Lock, Sparkles, Zap } from "lucide-react";
import { UNIVERSITIES, EXAM_TYPES, COMMON_BRANCH, SEMESTERS } from "@/lib/constants";
import { useGetAppMetadata, useGetConfigs, useGetConfigsVersion } from "@/api-client";
import { getStoredUser } from "@/lib/auth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CLIENT_CACHE_BYPASS = String(import.meta.env.VITE_BYPASS_CLIENT_CACHE || "").trim().toLowerCase() === "true";

function normalizeYearToken(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function parseYearNumber(value: string | null | undefined): number | null {
  const token = normalizeYearToken(value);
  const yearMatch = token.match(/year[^0-9]*([1-4])/);
  if (yearMatch) return Number(yearMatch[1]);
  const plainMatch = token.match(/^([1-4])$/);
  if (plainMatch) return Number(plainMatch[1]);
  return null;
}

function parseSemesterNumber(value: string | null | undefined): number | null {
  const token = normalizeYearToken(value);
  const semMatch = token.match(/sem(?:ester)?[^0-9]*([1-8])/);
  if (semMatch) return Number(semMatch[1]);
  const sMatch = token.match(/^s([1-8])$/);
  if (sMatch) return Number(sMatch[1]);
  const plainMatch = token.match(/^([1-8])$/);
  if (plainMatch) return Number(plainMatch[1]);
  return null;
}

function getEquivalentYearTokens(value: string | null | undefined): string[] {
  const token = normalizeYearToken(value);
  if (!token) return [];
  const tokens = new Set<string>([token]);

  const yearNum = parseYearNumber(value);
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

  const semNum = parseSemesterNumber(value);
  if (semNum) {
    const mappedYear = Math.ceil(semNum / 2);
    tokens.add(`sem${semNum}`);
    tokens.add(`semester${semNum}`);
    tokens.add(String(mappedYear));
    tokens.add(`year${mappedYear}`);
  }

  return Array.from(tokens);
}

function yearMatches(selectedYear: string, configYear: string): boolean {
  if (!selectedYear) return true;
  const selectedTokens = new Set(getEquivalentYearTokens(selectedYear));
  const configTokens = getEquivalentYearTokens(configYear);
  return configTokens.some((token) => selectedTokens.has(token));
}

function normalizeBranchToken(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export default function Home() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const user = getStoredUser();
  const isStudent = user?.role === "student" || user?.role === "super_student";
  const { data: metadata } = useGetAppMetadata();
  const universities = metadata?.universities?.length ? metadata.universities : UNIVERSITIES;
  const semesters = metadata?.semesters?.length ? metadata.semesters : SEMESTERS;
  const examTypes = metadata?.examTypes?.length ? metadata.examTypes : EXAM_TYPES;
  const commonBranch = metadata?.commonBranch || COMMON_BRANCH;

  const [selectedUni, setSelectedUni] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const selectedBranch = commonBranch;
  const [selectedSubject, setSelectedSubject] = useState("");

  useEffect(() => {
    if (isStudent && user?.universityId) {
      setSelectedUni(user.universityId);
      return;
    }
    if (!selectedUni && universities.length > 0) {
      setSelectedUni(universities[0].id);
    }
  }, [isStudent, selectedUni, universities, user?.universityId]);

  const { data: configs, isLoading } = useGetConfigs({ universityId: selectedUni }, {
    query: {
      queryKey: ["configs", "home", selectedUni],
      enabled: !!selectedUni,
      staleTime: CLIENT_CACHE_BYPASS ? 0 : 5 * 60 * 1000,
      gcTime: CLIENT_CACHE_BYPASS ? 0 : 30 * 60 * 1000,
      refetchOnWindowFocus: CLIENT_CACHE_BYPASS ? true : false,
      refetchOnMount: CLIENT_CACHE_BYPASS ? "always" : true,
    }
  });
  const { data: configsVersion } = useGetConfigsVersion(selectedUni || null, {
    enabled: !!selectedUni,
    refetchOnWindowFocus: false,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });
  const lastConfigsVersionRef = useRef<string | null>(null);
  useEffect(() => {
    const next = String(configsVersion?.maxUpdatedAt || "").trim() || null;
    if (next == null) return;
    if (lastConfigsVersionRef.current == null) {
      lastConfigsVersionRef.current = next;
      return;
    }
    if (lastConfigsVersionRef.current !== next) {
      lastConfigsVersionRef.current = next;
      void queryClient.invalidateQueries({ queryKey: ["configs", "home", selectedUni] });
    }
  }, [configsVersion?.maxUpdatedAt, queryClient, selectedUni]);

  const availableSubjects = useMemo(() =>
    Array.from(new Set(
      configs?.filter(c =>
        yearMatches(selectedYear, c.year) &&
        normalizeBranchToken(c.branch) === normalizeBranchToken(commonBranch)
      ).map(c => c.subject) || []
    )).sort(),
    [configs, selectedYear, commonBranch]
  );

  const examConfigs = useMemo(() => {
    if (!selectedSubject) return {};
    const map: Record<string, typeof configs extends (infer T)[] | undefined ? T : never> = {};
    configs?.filter(c =>
      yearMatches(selectedYear, c.year) &&
      normalizeBranchToken(c.branch) === normalizeBranchToken(selectedBranch) &&
      c.subject === selectedSubject
    ).forEach(c => {
      map[c.exam] = c;
    });
    return map;
  }, [configs, selectedYear, selectedBranch, selectedSubject]);

  useEffect(() => {
    setSelectedYear("");
    setSelectedSubject("");
  }, [selectedUni]);

  useEffect(() => {
    setSelectedSubject("");
  }, [selectedYear]);

  const handleExamClick = (examId: string) => {
    const config = examConfigs[examId];
    if (config) {
      setLocation(`/roadmap?configId=${config.id}&subject=${encodeURIComponent(config.subject)}&exam=${examId}`);
    }
  };

  const showExamNodes = selectedUni && selectedYear && selectedSubject;

  const examNodeData = useMemo(() => {
    const colorMap: Record<string, { icon: string; color: string; bg: string; border: string; text: string }> = {
      mid1: { icon: "1", color: "from-blue-500 to-blue-600", bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
      mid2: { icon: "2", color: "from-violet-500 to-violet-600", bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-700" },
      endsem: { icon: "E", color: "from-emerald-500 to-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700" },
    };
    return examTypes.map((e) => ({
      id: e.id,
      name: e.name,
      ...(colorMap[e.id] ?? { icon: e.name.slice(0, 1).toUpperCase(), color: "from-blue-500 to-blue-600", bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" }),
    }));
  }, [examTypes]);

  return (
    <div className="w-full max-w-4xl mx-auto pt-4 sm:pt-8 pb-20 px-4 sm:px-0">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8 sm:mb-12"
      >
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-semibold tracking-wide mb-4 border border-primary/20">
          <Sparkles className="w-4 h-4" /> Exam Roadmap
        </span>
        <h1 className="text-3xl sm:text-5xl font-display font-bold text-foreground mb-3 sm:mb-4 leading-tight">
          Your path to <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">exam success</span>
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
          Select your details below, then pick your exam to explore a structured topic roadmap.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-card rounded-2xl sm:rounded-3xl p-5 sm:p-10 shadow-xl shadow-black/5 border border-border relative overflow-hidden"
      >
        {isLoading && (
          <div className="absolute inset-0 bg-background/50 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8">
          <SelectField
            icon={<Building2 className="w-4 h-4 text-primary" />}
            label="University"
            value={selectedUni}
            onChange={setSelectedUni}
            options={universities.map(u => ({ value: u.id, label: u.name }))}
            disabled={isStudent}
          />
          <SelectField
            icon={<Calendar className="w-4 h-4 text-primary" />}
            label="Semester"
            value={selectedYear}
            onChange={setSelectedYear}
            options={semesters.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="Select Semester"
          />
          <SelectField
            icon={<GraduationCap className="w-4 h-4 text-primary" />}
            label="Branch"
            value={selectedBranch}
            onChange={() => {}}
            options={[{ value: commonBranch, label: commonBranch }]}
            disabled
          />
          <SelectField
            icon={<BookOpen className="w-4 h-4 text-primary" />}
            label="Subject"
            value={selectedSubject}
            onChange={setSelectedSubject}
            options={availableSubjects.map(s => ({ value: s, label: s }))}
            disabled={!selectedYear || !availableSubjects.length}
            placeholder="Select Subject"
          />
        </div>

        <AnimatePresence mode="wait">
          {showExamNodes && (
            <motion.div
              key="exam-nodes"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="mt-8 sm:mt-10 pt-6 sm:pt-8 border-t border-border">
                <h2 className="text-lg sm:text-xl font-display font-bold text-foreground mb-2 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-primary" />
                  Choose Your Exam
                </h2>
                <p className="text-sm text-muted-foreground mb-6">Click an exam to view its topic roadmap</p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {examNodeData.map((examNode, idx) => {
                    const config = examConfigs[examNode.id];
                    const isAvailable = !!config;

                    return (
                      <motion.button
                        key={examNode.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        onClick={() => isAvailable && handleExamClick(examNode.id)}
                        disabled={!isAvailable}
                        className={`
                          relative group rounded-2xl p-5 sm:p-6 text-left transition-all duration-200 border-2
                          ${isAvailable
                            ? `${examNode.bg} ${examNode.border} hover:shadow-lg hover:scale-[1.02] cursor-pointer`
                            : 'bg-muted/50 border-border/50 opacity-60 cursor-not-allowed'
                          }
                        `}
                      >
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${isAvailable ? examNode.color : 'from-gray-300 to-gray-400'} flex items-center justify-center text-white text-xl font-bold mb-4 shadow-lg`}>
                          {examNode.icon}
                        </div>
                        <h3 className={`text-lg font-display font-bold mb-1 ${isAvailable ? examNode.text : 'text-muted-foreground'}`}>
                          {examNode.name}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {isAvailable ? "Roadmap available" : "Not available yet"}
                        </p>
                        {isAvailable ? (
                          <ChevronRight className={`absolute top-1/2 right-4 -translate-y-1/2 w-5 h-5 ${examNode.text} opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all`} />
                        ) : (
                          <Lock className="absolute top-4 right-4 w-4 h-4 text-muted-foreground/50" />
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function SelectField({
  icon,
  label,
  value,
  onChange,
  options,
  disabled,
  placeholder,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2 sm:space-y-3">
      <label className="text-sm font-semibold text-foreground flex items-center gap-2">
        {icon} {label}
      </label>
      <Select
        value={value || undefined}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectTrigger className="w-full h-12 sm:h-14 rounded-xl border-2 border-border bg-background px-4 text-base focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none transition-all disabled:opacity-50 disabled:bg-muted">
          <SelectValue placeholder={placeholder ?? "Select option"} />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

