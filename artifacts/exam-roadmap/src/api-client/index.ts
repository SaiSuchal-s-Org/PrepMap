export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter, customFetch } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";

import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { SuccessResponse } from "./generated/api.schemas";
import type { ErrorType } from "./custom-fetch";
import { customFetch } from "./custom-fetch";

export const deleteConfig = async (id: string, options?: RequestInit) => {
  return customFetch<SuccessResponse>(`/api/configs/${id}`, {
    ...options,
    method: "DELETE",
  });
};

export const useDeleteConfig = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<SuccessResponse, TError, { id: string }, TContext>,
) => {
  return useMutation<SuccessResponse, TError, { id: string }, TContext>({
    mutationKey: ["deleteConfig"],
    mutationFn: ({ id }) => deleteConfig(id),
    ...options,
  });
};

export const updateQuestionBankQuestion = async (
  configId: string,
  questionId: number,
  payload: { question: string; answer: string },
  options?: RequestInit,
) => {
  return customFetch<SuccessResponse>(`/api/configs/${encodeURIComponent(configId)}/question-bank/questions/${questionId}`, {
    ...options,
    method: "PUT",
    body: JSON.stringify(payload),
  });
};

export const useUpdateQuestionBankQuestion = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<
    SuccessResponse,
    TError,
    { configId: string; questionId: number; question: string; answer: string },
    TContext
  >,
) => {
  return useMutation<
    SuccessResponse,
    TError,
    { configId: string; questionId: number; question: string; answer: string },
    TContext
  >({
    mutationKey: ["updateQuestionBankQuestion"],
    mutationFn: ({ configId, questionId, question, answer }) =>
      updateQuestionBankQuestion(configId, questionId, { question, answer }),
    ...options,
  });
};

export interface UniversityAnalyticsRow {
  universityId: string;
  totalStudents: number;
  latestConfig: {
    id: string;
    year: string;
    exam: string;
    subject: string;
    createdAt: string | null;
  } | null;
  startedStudents: number;
  startedPercent: number;
  avgProgressPercent: number;
  totalSubtopics: number;
}

export interface ConfigStudentProgressRow {
  userId: string;
  universityId: string;
  year: string;
  branch: string;
  role?: "student" | "super_student" | "admin" | string;
  doneSubtopics: number;
  totalSubtopics: number;
  progressPercent: number;
  questionBankInteractions: number;
  started: boolean;
  lastActiveAt: string | null;
  lastSuccessfulLoginAt?: string | null;
  lastPasswordResetAt?: string | null;
}

export interface ConfigStudentProgressResponse {
  config: {
    id: string;
    universityId: string;
    year: string;
    exam: string;
    subject: string;
  };
  totalStudents: number;
  students: ConfigStudentProgressRow[];
}

export interface QuestionBankInteractionSummary {
  questionBankInteractionCount: number;
}

export interface ExamConfigAnalyticsRow {
  universityId: string;
  config: {
    id: string;
    year: string;
    exam: string;
    subject: string;
    createdAt: string | null;
  };
  totalStudents: number;
  startedStudents: number;
  startedPercent: number;
  avgProgressPercent: number;
  totalSubtopics: number;
}

export interface QuestionBankInteractionBreakdownResponse {
  total: number;
  byUniversity: Array<{
    universityId: string;
    count: number;
  }>;
  byConfig: Array<{
    configId: string;
    universityId: string;
    subject: string;
    year: string;
    exam: string;
    count: number;
  }>;
}

export interface LiveConfigQuestionBankInteractionSummaryResponse {
  rows: Array<{
    configId: string;
    universityId: string;
    totalStudents: number;
    uniqueStudents: number;
    totalInteractions: number;
    interactionPercent: number;
  }>;
}

export interface ConfigsVersionResponse {
  maxUpdatedAt: string | null;
  total: number;
}

export interface ConfigVersionResponse {
  configId: string;
  configUpdatedAt: string | null;
  nodesUpdatedAt: string | null;
  questionBankUpdatedAt: string | null;
}

export interface AppMetadataResponse {
  universities: { id: string; name: string }[];
  commonBranch: string;
  semesters: { id: string; name: string }[];
  examTypes: { id: string; name: string }[];
}

export interface TopicContentBundleNode {
  id: string;
  title: string;
  type: "topic" | "subtopic";
  parentId: string | null;
  sortOrder?: number | null;
  explanation: string | null;
  learningGoal: string | null;
  exampleBlock: string | null;
  supportNote: string | null;
  prerequisiteTitles: string[];
  prerequisiteNodeIds: string[];
  nextRecommendedTitles: string[];
  nextRecommendedNodeIds: string[];
}

export interface TopicContentBundleResponse {
  configId: string;
  topic: TopicContentBundleNode;
  subtopics: TopicContentBundleNode[];
}

export interface LibrarySubject {
  id: string;
  name: string;
  normalizedName: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface LibraryUnitTopic {
  title: string;
  subtopics: string[];
}

export interface LibraryUnit {
  id: string;
  subjectId: string;
  unitTitle: string;
  normalizedUnitTitle: string;
  topics: LibraryUnitTopic[];
  sourceText: string | null;
  canonicalNodeCount?: number;
  hasCanonicalNodes?: boolean;
  factsSummary?: {
    factAtomsCount: number;
    itemsWithFacts: number;
    itemsWithoutFacts: number;
    topicItems: number;
    subtopicItems: number;
    hasFacts: boolean;
  };
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ConfigUnitLinksResponse {
  configId: string;
  unitIds: string[];
}

export interface ExtractUnitsResponse {
  success: boolean;
  subjectId: string;
  extractedCount: number;
  units: { id: string; unitTitle: string }[];
}

export interface RegenerateUnitFactsResponse {
  success: boolean;
  unitId: string;
  factCount: number;
  replaced: boolean;
}

export interface CleanupUnitTitlesResponse {
  success: boolean;
  unitId: string;
  preview?: boolean;
  updated: boolean;
  topicCountBefore: number;
  topicCountAfter: number;
  subtopicCountBefore: number;
  subtopicCountAfter: number;
  topics: LibraryUnitTopic[];
}

export interface CheapLaneAResponse {
  success: boolean;
  configId: string;
  subject: string;
  mode?: "explanations_only" | "questions_only";
  structure: Array<{
    title: string;
    topics: Array<{
      title: string;
      subtopics: string[];
    }>;
  }>;
  replicaQuestions: Array<{
    markType: "Foundational" | "Applied";
    question: string;
    answer: string;
    unitTitle: string;
    topicTitle: string;
    subtopicTitle: string;
    isStarred: boolean;
  }>;
  warnings: string[];
  replicaExtraction: {
    hasReplicaFile: boolean;
    extractedPaperTextLength: number;
    extractionMethod: "model" | "none";
  };
  totalQuestionTarget: number;
  totalStarTarget: number;
  remainingQuestionsNeeded: number;
  remainingStarsNeeded: number;
  masterPrompt: string;
}

export interface SavedReplicaQuestion {
  markType: "Foundational" | "Applied";
  question: string;
  answer: string;
  unitTitle: string;
  topicTitle: string;
  subtopicTitle: string;
  isStarred: boolean;
}

export interface SavedReplicaQuestionsResponse {
  success: boolean;
  configId: string;
  questions: SavedReplicaQuestion[];
}

export interface SaveReplicaQuestionsResponse {
  success: boolean;
  configId: string;
  savedCount: number;
  replaced: boolean;
}

export interface CheapLaneBImportResponse {
  success: boolean;
  warnings: string[];
  saved: { units: number; questions: number };
}

export interface CheapLaneBImportStartResponse {
  success: boolean;
  configId: string;
  jobId: string;
}

export interface CheapLaneBImportStatusResponse {
  configId: string;
  status: "idle" | "processing" | "complete" | "error";
  stage: "validating" | "saving_structure" | "saving_questions" | "finalizing" | "done";
  processedQuestions: number;
  totalQuestions: number;
  message: string;
  warnings: string[];
  saved?: {
    units: number;
    questions: number;
    reusedExplanations: number;
    generatedExplanations: number;
  };
  error?: string;
  overwritePolicy?: "preserve_existing" | "force_overwrite";
}

export interface CheapGapReportResponse {
  success: boolean;
  configId: string;
  mode?: "explanations_only" | "questions_only";
  summary: {
    totalTopicTargets: number;
    totalSubtopicTargets: number;
    topicGapCount: number;
    subtopicGapCount: number;
    totalGapRows: number;
    includeExplanationGaps?: boolean;
    includeQuestionGaps?: boolean;
    expectedQuestionCount?: number;
    existingQuestionCount?: number;
    questionGapCount?: number;
  };
  rows: Array<{
    level: "topic" | "subtopic";
    unitTitle: string;
    topicTitle: string;
    subtopicTitle?: string;
    missing: string[];
  }>;
}

export interface CompletionStateResponse {
  configId: string;
  userId: string;
  doneSubtopicIds: string[];
}

export interface CloneConfigResponse {
  id: string;
  universityId: string;
  year: string;
  branch: string;
  subject: string;
  exam: string;
  status: string;
  createdBy: string;
  createdAt?: string;
  syllabusFileUrl?: string | null;
  paperFileUrls?: string[] | null;
  clonedFromConfigId: string;
  cloneOptions?: {
    includeQuestions: boolean;
    includeSyllabus: boolean;
    includeReplicaQuestions: boolean;
  };
}

export interface QuestionBankQuestion {
  id: number;
  markType: string;
  question: string;
  answer: string;
  isStarred?: boolean;
  starSource?: "none" | "auto" | "manual";
  subtopicId: string;
  subtopicTitle: string;
  topicTitle: string;
  unitTitle: string;
}

export interface QuestionBankResponse {
  configId: string;
  subject: string;
  total: number;
  questions: QuestionBankQuestion[];
}

export type CheapGenerationMode =
  | "explanations_only"
  | "questions_only";

export interface LatestInteractionStateResponse {
  configId: string;
  userId: string;
  mapNodeId: string | null;
  qbSubtopicId: string | null;
  qbQuestionId: number | null;
  eventAt: string | null;
}

export interface CompleteFirstLoginSetupRequest {
  collegeId: string;
  currentPassword: string;
  newPassword: string;
  securityQuestion: string;
  securityAnswer: string;
}

export interface SecurityQuestionResponse {
  collegeId: string;
  securityQuestion: string;
}

export interface ResetPasswordWithSecurityRequest {
  collegeId: string;
  securityAnswer: string;
  newPassword: string;
}

export const getUniversityAnalytics = async (options?: RequestInit) => {
  return customFetch<UniversityAnalyticsRow[]>(`/api/admin/analytics/universities`, {
    ...options,
    method: "GET",
  });
};

export const getConfigStudentProgress = async (configId: string, options?: RequestInit) => {
  return customFetch<ConfigStudentProgressResponse>(`/api/admin/analytics/configs/${configId}/students`, {
    ...options,
    method: "GET",
  });
};

export const getExamConfigAnalytics = async (exam: string, options?: RequestInit) => {
  return customFetch<ExamConfigAnalyticsRow[]>(
    `/api/admin/analytics/exam-configs?exam=${encodeURIComponent(exam)}`,
    {
      ...options,
      method: "GET",
    }
  );
};

export const getQuestionBankInteractionSummary = async (options?: RequestInit) => {
  return customFetch<QuestionBankInteractionSummary>(`/api/admin/analytics/question-bank-interactions`, {
    ...options,
    method: "GET",
  });
};

export const getQuestionBankInteractionBreakdown = async (options?: RequestInit) => {
  return customFetch<QuestionBankInteractionBreakdownResponse>(`/api/admin/analytics/question-bank-interactions/breakdown`, {
    ...options,
    method: "GET",
  });
};

export const getLiveConfigQuestionBankInteractionSummary = async (options?: RequestInit) => {
  return customFetch<LiveConfigQuestionBankInteractionSummaryResponse>(
    `/api/admin/analytics/question-bank-interactions/live-config-summary`,
    {
      ...options,
      method: "GET",
    }
  );
};

export const getConfigsVersion = async (universityId?: string | null, options?: RequestInit) => {
  const query = universityId ? `?universityId=${encodeURIComponent(universityId)}` : "";
  return customFetch<ConfigsVersionResponse>(`/api/configs/version${query}`, {
    ...options,
    method: "GET",
  });
};

export const getConfigVersion = async (configId: string, options?: RequestInit) => {
  return customFetch<ConfigVersionResponse>(`/api/configs/${encodeURIComponent(configId)}/version`, {
    ...options,
    method: "GET",
  });
};

export const getAppMetadata = async (options?: RequestInit) => {
  return customFetch<AppMetadataResponse>(`/api/metadata`, {
    ...options,
    method: "GET",
  });
};

export const getLibrarySubjects = async (options?: RequestInit) => {
  return customFetch<LibrarySubject[]>(`/api/admin/library/subjects`, {
    ...options,
    method: "GET",
  });
};

export const upsertLibrarySubject = async (
  payload: { name: string },
  options?: RequestInit,
) => {
  return customFetch<{ id: string; name: string; normalizedName: string }>(`/api/admin/library/subjects`, {
    ...options,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(payload),
  });
};

export const getLibraryUnits = async (subjectId: string, options?: RequestInit) => {
  return customFetch<LibraryUnit[]>(`/api/admin/library/units?subjectId=${encodeURIComponent(subjectId)}`, {
    ...options,
    method: "GET",
  });
};

export const upsertLibraryUnit = async (
  payload: {
    subjectId: string;
    unitTitle: string;
    topics: LibraryUnitTopic[];
    sourceText?: string | null;
  },
  options?: RequestInit,
) => {
  return customFetch<LibraryUnit>(`/api/admin/library/units/upsert`, {
    ...options,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(payload),
  });
};

export const updateLibraryUnit = async (
  unitId: string,
  payload: {
    unitTitle?: string;
    topics?: LibraryUnitTopic[];
    sourceText?: string | null;
  },
  options?: RequestInit,
) => {
  return customFetch<LibraryUnit>(`/api/admin/library/units/${encodeURIComponent(unitId)}`, {
    ...options,
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(payload),
  });
};

export const getConfigUnitLinks = async (configId: string, options?: RequestInit) => {
  return customFetch<ConfigUnitLinksResponse>(`/api/admin/library/config-units?configId=${encodeURIComponent(configId)}`, {
    ...options,
    method: "GET",
  });
};

export const saveConfigUnitLinks = async (
  configId: string,
  unitIds: string[],
  options?: RequestInit,
) => {
  return customFetch<{ success: boolean; configId: string; unitIds: string[] }>(
    `/api/admin/library/config-units/${encodeURIComponent(configId)}`,
    {
      ...options,
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(options?.headers || {}),
      },
      body: JSON.stringify({ unitIds }),
    },
  );
};

export const extractUnitsFromText = async (
  payload: {
    subjectId: string;
    materials: Array<{
      id: string;
      title?: string;
      readingText: string;
    }>;
  },
  options?: RequestInit,
) => {
  return customFetch<ExtractUnitsResponse>(`/api/admin/library/units/extract-from-text`, {
    ...options,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(payload),
  });
};

export const getQuestionBank = async (configId: string, options?: RequestInit) => {
  return customFetch<QuestionBankResponse>(`/api/configs/${configId}/question-bank`, {
    ...options,
    method: "GET",
  });
};

export const regenerateUnitFacts = async (
  unitId: string,
  options?: RequestInit,
) => {
  return customFetch<RegenerateUnitFactsResponse>(`/api/admin/library/units/${encodeURIComponent(unitId)}/generate-facts`, {
    ...options,
    method: "POST",
  });
};

export const cleanupUnitTitles = async (
  unitId: string,
  preview = false,
  options?: RequestInit,
) => {
  const query = preview ? "?preview=true" : "";
  return customFetch<CleanupUnitTitlesResponse>(`/api/admin/library/units/${encodeURIComponent(unitId)}/cleanup-titles${query}`, {
    ...options,
    method: "POST",
  });
};

export const purgeConfig = async (id: string, options?: RequestInit) => {
  return customFetch<SuccessResponse>(`/api/configs/${id}/permanent`, {
    ...options,
    method: "DELETE",
  });
};

export const cloneConfigToUniversity = async (
  configId: string,
  payload: {
    targetUniversityId: string;
    targetExam: string;
    includeQuestions?: boolean;
    includeSyllabus?: boolean;
    includeReplicaQuestions?: boolean;
  },
  options?: RequestInit,
) => {
  return customFetch<CloneConfigResponse>(`/api/configs/${configId}/clone`, {
    ...options,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(payload),
  });
};

export const usePurgeConfig = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<SuccessResponse, TError, { id: string }, TContext>,
) => {
  return useMutation<SuccessResponse, TError, { id: string }, TContext>({
    mutationKey: ["purgeConfig"],
    mutationFn: ({ id }) => purgeConfig(id),
    ...options,
  });
};

export const useCloneConfigToUniversity = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<
    CloneConfigResponse,
    TError,
    {
      configId: string;
      targetUniversityId: string;
      targetExam: string;
      includeQuestions?: boolean;
      includeSyllabus?: boolean;
      includeReplicaQuestions?: boolean;
    },
    TContext
  >,
) => {
  return useMutation<
    CloneConfigResponse,
    TError,
    {
      configId: string;
      targetUniversityId: string;
      targetExam: string;
      includeQuestions?: boolean;
      includeSyllabus?: boolean;
      includeReplicaQuestions?: boolean;
    },
    TContext
  >({
    mutationKey: ["clone-config-to-university"],
    mutationFn: ({
      configId,
      targetUniversityId,
      targetExam,
      includeQuestions,
      includeSyllabus,
      includeReplicaQuestions,
    }) =>
      cloneConfigToUniversity(configId, {
        targetUniversityId,
        targetExam,
        includeQuestions,
        includeSyllabus,
        includeReplicaQuestions,
      }),
    ...options,
  });
};

export const getLatestInteractionState = async (configId: string, options?: RequestInit) => {
  return customFetch<LatestInteractionStateResponse>(
    `/api/configs/${configId}/latest-interaction-state`,
    {
      ...options,
      method: "GET",
    },
  );
};

export const completeFirstLoginSetup = async (
  payload: CompleteFirstLoginSetupRequest,
  options?: RequestInit,
) => {
  return customFetch<SuccessResponse>(`/api/auth/complete-first-login-setup`, {
    ...options,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(payload),
  });
};

export const getSecurityQuestion = async (collegeId: string, options?: RequestInit) => {
  return customFetch<SecurityQuestionResponse>(
    `/api/auth/security-question?collegeId=${encodeURIComponent(collegeId)}`,
    {
      ...options,
      method: "GET",
    },
  );
};

export const resetPasswordWithSecurity = async (
  payload: ResetPasswordWithSecurityRequest,
  options?: RequestInit,
) => {
  return customFetch<SuccessResponse>(`/api/auth/reset-password-with-security`, {
    ...options,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(payload),
  });
};

export const generateCheapLaneA = async (
  configId: string,
  mode: CheapGenerationMode,
  payloadOptions?: {
    ignoreSavedReplica?: boolean;
    includeFactsInMasterPrompt?: boolean;
  },
  requestOptions?: RequestInit,
) => {
  return customFetch<CheapLaneAResponse>(`/api/configs/${configId}/cheap/lane-a`, {
    ...requestOptions,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(requestOptions?.headers || {}),
    },
    body: JSON.stringify({
      mode,
      ignoreSavedReplica: payloadOptions?.ignoreSavedReplica,
      includeFactsInMasterPrompt: payloadOptions?.includeFactsInMasterPrompt,
    }),
  });
};

export const getSavedReplicaQuestions = async (configId: string, options?: RequestInit) => {
  return customFetch<SavedReplicaQuestionsResponse>(`/api/configs/${configId}/cheap/replica-questions`, {
    ...options,
    method: "GET",
  });
};

export const saveReplicaQuestions = async (
  configId: string,
  payload: { questions: SavedReplicaQuestion[] },
  options?: RequestInit,
) => {
  return customFetch<SaveReplicaQuestionsResponse>(`/api/configs/${configId}/cheap/replica-questions`, {
    ...options,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(payload),
  });
};

export const importCheapLaneB = async (
  configId: string,
  payload: {
    forceOverwrite?: boolean;
    units: Array<{
      title: string;
      topics: Array<{
        title: string;
        explanation?: string;
        subtopics: Array<{ title: string; explanation: string }>;
      }>;
    }>;
    questions: Array<{
      markType: "Foundational" | "Applied";
      question: string;
      answer: string;
      unitTitle: string;
      topicTitle: string;
      subtopicTitle: string;
      isStarred?: boolean;
    }>;
  },
  options?: RequestInit,
) => {
  return customFetch<CheapLaneBImportResponse>(`/api/configs/${configId}/cheap/import`, {
    ...options,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(payload),
  });
};

export const startCheapLaneBImport = async (
  configId: string,
  payload: {
    forceOverwrite?: boolean;
    units: Array<{
      title: string;
      topics: Array<{
        title: string;
        explanation?: string;
        subtopics: Array<{ title: string; explanation: string }>;
      }>;
    }>;
    questions: Array<{
      markType: "Foundational" | "Applied";
      question: string;
      answer: string;
      unitTitle: string;
      topicTitle: string;
      subtopicTitle: string;
      isStarred?: boolean;
    }>;
  },
  options?: RequestInit,
) => {
  return customFetch<CheapLaneBImportStartResponse>(`/api/configs/${configId}/cheap/import/start`, {
    ...options,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(payload),
  });
};

export const getCheapLaneBImportStatus = async (configId: string, options?: RequestInit) => {
  return customFetch<CheapLaneBImportStatusResponse>(`/api/configs/${configId}/cheap/import-status`, {
    ...options,
    method: "GET",
  });
};

export const getCheapGapReport = async (
  configId: string,
  mode?: CheapGenerationMode,
  options?: RequestInit
) => {
  const modeQuery = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  return customFetch<CheapGapReportResponse>(`/api/configs/${configId}/cheap/gap-report${modeQuery}`, {
    ...options,
    method: "GET",
  });
};

export const getCompletionState = async (configId: string, options?: RequestInit) => {
  return customFetch<CompletionStateResponse>(`/api/configs/${configId}/completion-state`, {
    ...options,
    method: "GET",
  });
};

export const getTopicContentBundle = async (
  configId: string,
  topicId: string,
  options?: RequestInit,
) => {
  const query = `configId=${encodeURIComponent(configId)}&topicId=${encodeURIComponent(topicId)}`;
  return customFetch<TopicContentBundleResponse>(`/api/nodes/topic-content?${query}`, {
    ...options,
    method: "GET",
  });
};

export const useGetUniversityAnalytics = <
  TError = ErrorType<unknown>,
  TData = UniversityAnalyticsRow[],
>(
  options?: Omit<UseQueryOptions<UniversityAnalyticsRow[], TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<UniversityAnalyticsRow[], TError, TData>({
    queryKey: ["admin-analytics-universities"],
    queryFn: () => getUniversityAnalytics(),
    ...options,
  });
};

export const useGetConfigStudentProgress = <
  TError = ErrorType<unknown>,
  TData = ConfigStudentProgressResponse,
>(
  configId: string | null,
  options?: Omit<UseQueryOptions<ConfigStudentProgressResponse, TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<ConfigStudentProgressResponse, TError, TData>({
    queryKey: ["admin-analytics-config-students", configId],
    queryFn: () => getConfigStudentProgress(configId!),
    enabled: !!configId,
    ...options,
  });
};

export const useGetExamConfigAnalytics = <
  TError = ErrorType<unknown>,
  TData = ExamConfigAnalyticsRow[],
>(
  exam: string | null,
  options?: Omit<UseQueryOptions<ExamConfigAnalyticsRow[], TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<ExamConfigAnalyticsRow[], TError, TData>({
    queryKey: ["admin-analytics-exam-configs", exam],
    queryFn: () => getExamConfigAnalytics(exam!),
    enabled: !!exam,
    ...options,
  });
};

export const useGetQuestionBankInteractionSummary = <
  TError = ErrorType<unknown>,
  TData = QuestionBankInteractionSummary,
>(
  options?: Omit<UseQueryOptions<QuestionBankInteractionSummary, TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<QuestionBankInteractionSummary, TError, TData>({
    queryKey: ["admin-analytics-question-bank-interactions"],
    queryFn: () => getQuestionBankInteractionSummary(),
    ...options,
  });
};

export const useGetQuestionBankInteractionBreakdown = <
  TError = ErrorType<unknown>,
  TData = QuestionBankInteractionBreakdownResponse,
>(
  options?: Omit<UseQueryOptions<QuestionBankInteractionBreakdownResponse, TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<QuestionBankInteractionBreakdownResponse, TError, TData>({
    queryKey: ["admin-analytics-question-bank-interactions-breakdown"],
    queryFn: () => getQuestionBankInteractionBreakdown(),
    ...options,
  });
};

export const useGetLiveConfigQuestionBankInteractionSummary = <
  TError = ErrorType<unknown>,
  TData = LiveConfigQuestionBankInteractionSummaryResponse,
>(
  options?: Omit<UseQueryOptions<LiveConfigQuestionBankInteractionSummaryResponse, TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<LiveConfigQuestionBankInteractionSummaryResponse, TError, TData>({
    queryKey: ["admin-analytics-live-config-qb-summary"],
    queryFn: () => getLiveConfigQuestionBankInteractionSummary(),
    ...options,
  });
};

export const useGetConfigsVersion = <
  TError = ErrorType<unknown>,
  TData = ConfigsVersionResponse,
>(
  universityId?: string | null,
  options?: Omit<UseQueryOptions<ConfigsVersionResponse, TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<ConfigsVersionResponse, TError, TData>({
    queryKey: ["configs-version", universityId || ""],
    queryFn: () => getConfigsVersion(universityId),
    ...options,
  });
};

export const useGetConfigVersion = <
  TError = ErrorType<unknown>,
  TData = ConfigVersionResponse,
>(
  configId: string | null,
  options?: Omit<UseQueryOptions<ConfigVersionResponse, TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<ConfigVersionResponse, TError, TData>({
    queryKey: ["config-version", configId || ""],
    queryFn: () => getConfigVersion(configId!),
    enabled: !!configId,
    ...options,
  });
};

export const useGetCheapGapReport = <
  TError = ErrorType<unknown>,
  TData = CheapGapReportResponse,
>(
  configId: string,
  mode?: CheapGenerationMode,
  options?: Omit<UseQueryOptions<CheapGapReportResponse, TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<CheapGapReportResponse, TError, TData>({
    queryKey: ["cheap-gap-report", configId, mode || "explanations_only"],
    queryFn: () => getCheapGapReport(configId, mode),
    ...options,
  });
};

export const useGetAppMetadata = <
  TError = ErrorType<unknown>,
  TData = AppMetadataResponse,
>(
  options?: Omit<UseQueryOptions<AppMetadataResponse, TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<AppMetadataResponse, TError, TData>({
    queryKey: ["app-metadata"],
    queryFn: () => getAppMetadata(),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    ...options,
  });
};

export const useGetLibrarySubjects = <
  TError = ErrorType<unknown>,
  TData = LibrarySubject[],
>(
  options?: Omit<UseQueryOptions<LibrarySubject[], TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<LibrarySubject[], TError, TData>({
    queryKey: ["library-subjects"],
    queryFn: () => getLibrarySubjects(),
    ...options,
  });
};

export const useUpsertLibrarySubject = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<
    { id: string; name: string; normalizedName: string },
    TError,
    { name: string },
    TContext
  >,
) => {
  return useMutation<
    { id: string; name: string; normalizedName: string },
    TError,
    { name: string },
    TContext
  >({
    mutationKey: ["library-upsert-subject"],
    mutationFn: (payload) => upsertLibrarySubject(payload),
    ...options,
  });
};

export const useGetLibraryUnits = <
  TError = ErrorType<unknown>,
  TData = LibraryUnit[],
>(
  subjectId: string | null,
  options?: Omit<UseQueryOptions<LibraryUnit[], TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<LibraryUnit[], TError, TData>({
    queryKey: ["library-units", subjectId],
    queryFn: () => getLibraryUnits(subjectId!),
    enabled: !!subjectId,
    ...options,
  });
};

export const useUpsertLibraryUnit = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<
    LibraryUnit,
    TError,
    {
      subjectId: string;
      unitTitle: string;
      topics: LibraryUnitTopic[];
      sourceText?: string | null;
    },
    TContext
  >,
) => {
  return useMutation<
    LibraryUnit,
    TError,
    {
      subjectId: string;
      unitTitle: string;
      topics: LibraryUnitTopic[];
      sourceText?: string | null;
    },
    TContext
  >({
    mutationKey: ["library-upsert-unit"],
    mutationFn: (payload) => upsertLibraryUnit(payload),
    ...options,
  });
};

export const useUpdateLibraryUnit = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<
    LibraryUnit,
    TError,
    {
      unitId: string;
      unitTitle?: string;
      topics?: LibraryUnitTopic[];
      sourceText?: string | null;
    },
    TContext
  >,
) => {
  return useMutation<
    LibraryUnit,
    TError,
    {
      unitId: string;
      unitTitle?: string;
      topics?: LibraryUnitTopic[];
      sourceText?: string | null;
    },
    TContext
  >({
    mutationKey: ["library-update-unit"],
    mutationFn: ({ unitId, ...payload }) => updateLibraryUnit(unitId, payload),
    ...options,
  });
};

export const useGetConfigUnitLinks = <
  TError = ErrorType<unknown>,
  TData = ConfigUnitLinksResponse,
>(
  configId: string | null,
  options?: Omit<UseQueryOptions<ConfigUnitLinksResponse, TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<ConfigUnitLinksResponse, TError, TData>({
    queryKey: ["library-config-unit-links", configId],
    queryFn: () => getConfigUnitLinks(configId!),
    enabled: !!configId,
    ...options,
  });
};

export const useSaveConfigUnitLinks = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<
    { success: boolean; configId: string; unitIds: string[] },
    TError,
    { configId: string; unitIds: string[] },
    TContext
  >,
) => {
  return useMutation<
    { success: boolean; configId: string; unitIds: string[] },
    TError,
    { configId: string; unitIds: string[] },
    TContext
  >({
    mutationKey: ["library-save-config-unit-links"],
    mutationFn: ({ configId, unitIds }) => saveConfigUnitLinks(configId, unitIds),
    ...options,
  });
};

export const useExtractUnitsFromText = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<
    ExtractUnitsResponse,
    TError,
    {
      subjectId: string;
      materials: Array<{
        id: string;
        title?: string;
        readingText: string;
      }>;
    },
    TContext
  >,
) => {
  return useMutation<
    ExtractUnitsResponse,
    TError,
    {
      subjectId: string;
      materials: Array<{
        id: string;
        title?: string;
        readingText: string;
      }>;
    },
    TContext
  >({
    mutationKey: ["library-extract-units-from-text"],
    mutationFn: (payload) => extractUnitsFromText(payload),
    ...options,
  });
};

export const useGetQuestionBank = <
  TError = ErrorType<unknown>,
  TData = QuestionBankResponse,
>(
  configId: string | null,
  options?: Omit<UseQueryOptions<QuestionBankResponse, TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<QuestionBankResponse, TError, TData>({
    queryKey: ["config-question-bank", configId],
    queryFn: () => getQuestionBank(configId!),
    enabled: !!configId,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    ...options,
  });
};

export const useRegenerateUnitFacts = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<
    RegenerateUnitFactsResponse,
    TError,
    { unitId: string },
    TContext
  >,
) => {
  return useMutation<
    RegenerateUnitFactsResponse,
    TError,
    { unitId: string },
    TContext
  >({
    mutationKey: ["library-regenerate-unit-facts"],
    mutationFn: ({ unitId }) => regenerateUnitFacts(unitId),
    ...options,
  });
};

export const useCleanupUnitTitles = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<
    CleanupUnitTitlesResponse,
    TError,
    { unitId: string; preview?: boolean },
    TContext
  >,
) => {
  return useMutation<
    CleanupUnitTitlesResponse,
    TError,
    { unitId: string; preview?: boolean },
    TContext
  >({
    mutationKey: ["library-cleanup-unit-titles"],
    mutationFn: ({ unitId, preview }) => cleanupUnitTitles(unitId, !!preview),
    ...options,
  });
};

export const useGetLatestInteractionState = <
  TError = ErrorType<unknown>,
  TData = LatestInteractionStateResponse,
>(
  configId: string | null,
  options?: Omit<
    UseQueryOptions<LatestInteractionStateResponse, TError, TData>,
    "queryKey" | "queryFn"
  >,
) => {
  return useQuery<LatestInteractionStateResponse, TError, TData>({
    queryKey: ["config-latest-interaction-state", configId],
    queryFn: () => getLatestInteractionState(configId!),
    enabled: !!configId,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    ...options,
  });
};

export const useGetCompletionState = <
  TError = ErrorType<unknown>,
  TData = CompletionStateResponse,
>(
  configId: string | null,
  options?: Omit<UseQueryOptions<CompletionStateResponse, TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<CompletionStateResponse, TError, TData>({
    queryKey: ["config-completion-state", configId],
    queryFn: () => getCompletionState(configId!),
    enabled: !!configId,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    ...options,
  });
};

export const useGetTopicContentBundle = <
  TError = ErrorType<unknown>,
  TData = TopicContentBundleResponse,
>(
  configId: string | null,
  topicId: string | null,
  options?: Omit<UseQueryOptions<TopicContentBundleResponse, TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<TopicContentBundleResponse, TError, TData>({
    queryKey: ["topic-content-bundle", configId, topicId],
    queryFn: () => getTopicContentBundle(configId!, topicId!),
    enabled: !!configId && !!topicId,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    ...options,
  });
};

export const useCompleteFirstLoginSetup = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<SuccessResponse, TError, CompleteFirstLoginSetupRequest, TContext>,
) => {
  return useMutation<SuccessResponse, TError, CompleteFirstLoginSetupRequest, TContext>({
    mutationKey: ["auth-complete-first-login-setup"],
    mutationFn: (payload) => completeFirstLoginSetup(payload),
    ...options,
  });
};

export const useGetSecurityQuestion = <
  TError = ErrorType<unknown>,
  TData = SecurityQuestionResponse,
>(
  collegeId: string | null,
  options?: Omit<UseQueryOptions<SecurityQuestionResponse, TError, TData>, "queryKey" | "queryFn">,
) => {
  return useQuery<SecurityQuestionResponse, TError, TData>({
    queryKey: ["auth-security-question", collegeId],
    queryFn: () => getSecurityQuestion(collegeId!),
    enabled: !!collegeId,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    ...options,
  });
};

export const useResetPasswordWithSecurity = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<SuccessResponse, TError, ResetPasswordWithSecurityRequest, TContext>,
) => {
  return useMutation<SuccessResponse, TError, ResetPasswordWithSecurityRequest, TContext>({
    mutationKey: ["auth-reset-password-with-security"],
    mutationFn: (payload) => resetPasswordWithSecurity(payload),
    ...options,
  });
};

export const useGenerateCheapLaneA = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<
    CheapLaneAResponse,
    TError,
    {
      configId: string;
      mode: CheapGenerationMode;
      ignoreSavedReplica?: boolean;
      includeFactsInMasterPrompt?: boolean;
    },
    TContext
  >,
) => {
  return useMutation<
    CheapLaneAResponse,
    TError,
    {
      configId: string;
      mode: CheapGenerationMode;
      ignoreSavedReplica?: boolean;
      includeFactsInMasterPrompt?: boolean;
    },
    TContext
  >({
    mutationKey: ["cheap-lane-a"],
    mutationFn: ({ configId, mode, ignoreSavedReplica, includeFactsInMasterPrompt }) =>
      generateCheapLaneA(configId, mode, { ignoreSavedReplica, includeFactsInMasterPrompt }),
    ...options,
  });
};

export const useGetSavedReplicaQuestions = <
  TData = Awaited<ReturnType<typeof getSavedReplicaQuestions>>,
  TError = ErrorType<unknown>,
>(
  configId: string | null,
  options?: {
    query?: Partial<
      UseQueryOptions<
        Awaited<ReturnType<typeof getSavedReplicaQuestions>>,
        TError,
        TData
      >
    >;
  },
) => {
  return useQuery<Awaited<ReturnType<typeof getSavedReplicaQuestions>>, TError, TData>({
    queryKey: ["cheap-saved-replica-questions", configId],
    queryFn: () => getSavedReplicaQuestions(configId as string),
    enabled: Boolean(configId),
    ...(options?.query || {}),
  });
};

export const useSaveReplicaQuestions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<
    SaveReplicaQuestionsResponse,
    TError,
    { configId: string; questions: SavedReplicaQuestion[] },
    TContext
  >,
) => {
  return useMutation<
    SaveReplicaQuestionsResponse,
    TError,
    { configId: string; questions: SavedReplicaQuestion[] },
    TContext
  >({
    mutationKey: ["cheap-save-replica-questions"],
    mutationFn: ({ configId, questions }) => saveReplicaQuestions(configId, { questions }),
    ...options,
  });
};

export const useImportCheapLaneB = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<
    CheapLaneBImportResponse,
    TError,
    {
      configId: string;
      payload: {
        forceOverwrite?: boolean;
        units: Array<{
          title: string;
          topics: Array<{
            title: string;
            explanation?: string;
            subtopics: Array<{ title: string; explanation: string }>;
          }>;
        }>;
        questions: Array<{
          markType: "Foundational" | "Applied";
          question: string;
          answer: string;
          unitTitle: string;
          topicTitle: string;
          subtopicTitle: string;
          isStarred?: boolean;
        }>;
      };
    },
    TContext
  >,
) => {
  return useMutation<
    CheapLaneBImportResponse,
    TError,
    {
      configId: string;
      payload: {
        forceOverwrite?: boolean;
        units: Array<{
          title: string;
          topics: Array<{
            title: string;
            explanation?: string;
            subtopics: Array<{ title: string; explanation: string }>;
          }>;
        }>;
        questions: Array<{
          markType: "Foundational" | "Applied";
          question: string;
          answer: string;
          unitTitle: string;
          topicTitle: string;
          subtopicTitle: string;
          isStarred?: boolean;
        }>;
      };
    },
    TContext
  >({
    mutationKey: ["cheap-lane-b-import"],
    mutationFn: ({ configId, payload }) => importCheapLaneB(configId, payload),
    ...options,
  });
};

export const useStartCheapLaneBImport = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(
  options?: UseMutationOptions<
    CheapLaneBImportStartResponse,
    TError,
    {
      configId: string;
      payload: {
        forceOverwrite?: boolean;
        units: Array<{
          title: string;
          topics: Array<{
            title: string;
            explanation?: string;
            subtopics: Array<{ title: string; explanation: string }>;
          }>;
        }>;
        questions: Array<{
          markType: "Foundational" | "Applied";
          question: string;
          answer: string;
          unitTitle: string;
          topicTitle: string;
          subtopicTitle: string;
          isStarred?: boolean;
        }>;
      };
    },
    TContext
  >,
) => {
  return useMutation<
    CheapLaneBImportStartResponse,
    TError,
    {
      configId: string;
      payload: {
        forceOverwrite?: boolean;
        units: Array<{
          title: string;
          topics: Array<{
            title: string;
            explanation?: string;
            subtopics: Array<{ title: string; explanation: string }>;
          }>;
        }>;
        questions: Array<{
          markType: "Foundational" | "Applied";
          question: string;
          answer: string;
          unitTitle: string;
          topicTitle: string;
          subtopicTitle: string;
          isStarred?: boolean;
        }>;
      };
    },
    TContext
  >({
    mutationKey: ["cheap-lane-b-import-start"],
    mutationFn: ({ configId, payload }) => startCheapLaneBImport(configId, payload),
    ...options,
  });
};

export const useGetCheapLaneBImportStatus = <
  TData = Awaited<ReturnType<typeof getCheapLaneBImportStatus>>,
  TError = ErrorType<unknown>,
>(
  configId: string | null,
  options?: {
    query?: Partial<
      UseQueryOptions<
        Awaited<ReturnType<typeof getCheapLaneBImportStatus>>,
        TError,
        TData
      >
    >;
  },
) => {
  return useQuery<Awaited<ReturnType<typeof getCheapLaneBImportStatus>>, TError, TData>({
    queryKey: ["cheap-lane-b-import-status", configId],
    queryFn: () => getCheapLaneBImportStatus(configId as string),
    enabled: Boolean(configId),
    ...(options?.query || {}),
  });
};
