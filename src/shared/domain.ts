import type {
  Lesson,
  TeachingSource,
  TeachingAiSettings,
  TeachingAiSettingsDraft,
  TeachingExportFormat
} from './teaching'
export const SOURCE_TYPES = [
  'article',
  'book',
  'chapter',
  'report',
  'thesis',
  'web',
  'other'
] as const
export const SOURCE_STATUSES = ['unread', 'reading', 'reviewed'] as const
export const ORIGINS = ['user', 'imported', 'ai'] as const

export type SourceType = (typeof SOURCE_TYPES)[number]
export type SourceStatus = (typeof SOURCE_STATUSES)[number]
export type Origin = (typeof ORIGINS)[number]

export interface Person {
  id: string
  displayName: string
  givenName: string | null
  familyName: string | null
  orcid: string | null
}

export interface SourceFile {
  id: string
  sourceId: string
  originalName: string
  relativePath: string
  mediaType: string
  byteSize: number
  sha256: string
  importedAt: string
  workerFileId: string | null
  workerJobId: string | null
  workerOriginalPath: string | null
  workerPreservedPath: string | null
  workerExtractionPath: string | null
  workerExtractionStatus: 'extracted' | 'needs-ocr' | 'failed' | null
  workerProcessedAt: string | null
  workerProcessor: string | null
  extractionText: string | null
}

export type SharedWorkerConnection =
  'connected' | 'not-configured' | 'unavailable' | 'invalid-state'

export interface SharedWorkerStatus {
  connection: SharedWorkerConnection
  root: string | null
  queuedJobs: number
  workingJobs: number
  completedJobs: number
  failedJobs: number
  processedFiles: number
  latestActivity: string | null
  message: string | null
}

export interface SharedWorkerDocument {
  fileId: string
  jobId: string | null
  filename: string
  extension: string
  byteSize: number
  sourcePath: string
  preservedSourcePath: string | null
  extractionStatus: 'extracted' | 'needs-ocr' | 'failed' | null
  extractedTextPath: string | null
  extractionRecordPath: string | null
  processedAt: string | null
  processor: string | null
  warnings: string[]
  jobStatus: 'queued' | 'working' | 'complete' | 'failed' | null
  jobError: string | null
  importedSourceId: string | null
}

export interface SharedWorkerImportResult {
  imported: boolean
  duplicate: boolean
  source: Source | null
  message: string
}

export interface Source {
  id: string
  title: string
  sourceType: SourceType
  status: SourceStatus
  authors: Person[]
  year: number | null
  publicationTitle: string | null
  publisher: string | null
  doi: string | null
  url: string | null
  abstract: string | null
  notes: string | null
  tags: string[]
  origin: Origin
  provenanceNote: string | null
  createdAt: string
  updatedAt: string
  files: SourceFile[]
}

export interface SourceDraft {
  id?: string
  title: string
  sourceType: SourceType
  status: SourceStatus
  authors: string[]
  year: number | null
  publicationTitle: string | null
  publisher: string | null
  doi: string | null
  url: string | null
  abstract: string | null
  notes: string | null
  tags: string[]
  origin: Exclude<Origin, 'ai'>
  provenanceNote: string | null
}

export interface SourceQuery {
  search?: string
  sourceType?: SourceType | 'all'
  status?: SourceStatus | 'all'
}

export interface WorkspaceInfo {
  id: string
  name: string
  path: string
  createdAt: string
  sourceCount: number
}

export type LibraryFormat = 'csl-json' | 'bibtex'

export interface ImportSummary {
  imported: number
  skipped: number
  fileName: string
}

export interface QualitativeCode {
  id: string
  name: string
  color: string | null
}

export interface EvidenceExcerpt {
  id: string
  sourceId: string
  sourceFileId: string
  text: string
  note: string | null
  page: number
  fileName: string
  fileSha256: string
  codes: QualitativeCode[]
  createdAt: string
  updatedAt: string
}

export interface EvidenceExcerptDraft {
  sourceId: string
  sourceFileId: string
  text: string
  note: string | null
  page: number
  codeNames: string[]
}

export type ProjectStatus = 'active' | 'paused' | 'complete'

export interface ProjectSummary {
  id: string
  title: string
  researchQuestion: string
  description: string | null
  status: ProjectStatus
  sourceCount: number
  evidenceCount: number
  openGoalCount: number
  createdAt: string
  updatedAt: string
}

export interface ProjectDraft {
  id?: string
  title: string
  researchQuestion: string
  description: string | null
  status: ProjectStatus
}

export interface ProjectGoal {
  id: string
  projectId: string
  title: string
  status: 'open' | 'complete'
  targetDate: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectNote {
  id: string
  projectId: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface ProjectManagedFile {
  id: string
  originalName: string
  originalPath: string | null
  relativePath: string
  mediaType: string
  extension: string
  byteSize: number
  sha256: string
  importedAt: string
  linkCount: number
}

export interface ProjectFileImportSummary {
  project: ProjectDetail
  imported: number
  linkedExisting: number
  duplicates: number
}

export interface ProjectEvidence extends EvidenceExcerpt {
  sourceTitle: string
}

export interface ProjectDetail extends ProjectSummary {
  sourceIds: string[]
  goals: ProjectGoal[]
  notes: ProjectNote[]
  evidence: ProjectEvidence[]
  files: ProjectManagedFile[]
}

export interface ManuscriptTrace {
  id: string
  sectionId: string
  evidenceExcerptId: string | null
  sourceId: string
  marker: string
  sourceTitle: string
  page: number | null
  fileName: string | null
  fileSha256: string | null
}

export interface ManuscriptSection {
  id: string
  manuscriptId: string
  title: string
  content: string
  position: number
  updatedAt: string
  traces: ManuscriptTrace[]
}

export interface Manuscript {
  id: string
  projectId: string
  title: string
  status: 'draft' | 'revision' | 'complete'
  sections: ManuscriptSection[]
  createdAt: string
  updatedAt: string
}

export interface ManuscriptImportResult {
  manuscript: Manuscript
  reviewerCommentsImported: number
}

export type RevisionCategory =
  'argument' | 'evidence' | 'methods' | 'structure' | 'clarity' | 'style'
export type RevisionSuggestionStatus = 'open' | 'addressed' | 'deferred' | 'dismissed'

export interface ReviewDocument {
  id: string
  manuscriptId: string
  originalName: string
  sha256: string
  importedAt: string
  commentCount: number
}

export interface RevisionSuggestion {
  id: string
  manuscriptId: string
  reviewerCommentId: string | null
  sectionId: string | null
  sectionTitle: string | null
  sourceType: 'reviewer-comment' | 'manuscript-rule'
  category: RevisionCategory
  reviewerComment: string | null
  summary: string
  rationale: string
  proposedAction: string
  status: RevisionSuggestionStatus
  generatedBy: 'local-rules'
  createdAt: string
  updatedAt: string
}

export interface RevisionWorkspace {
  documents: ReviewDocument[]
  suggestions: RevisionSuggestion[]
}

export interface RevisionImportSummary extends RevisionWorkspace {
  fileName: string
  importedComments: number
  duplicate: boolean
}

export interface InterviewMedia {
  id: string
  interviewId: string
  originalName: string
  mediaType: string
  byteSize: number
  sha256: string
  importedAt: string
}

export interface TranscriptSegment {
  id: string
  transcriptId: string
  speaker: string
  startSeconds: number | null
  endSeconds: number | null
  text: string
  position: number
  codes: QualitativeCode[]
  updatedAt: string
}

export interface Interview {
  id: string
  projectId: string | null
  title: string
  participantName: string
  occurredAt: string | null
  consentNote: string | null
  status: 'planned' | 'recorded' | 'transcribed' | 'coded'
  media: InterviewMedia[]
  transcriptId: string
  segments: TranscriptSegment[]
  createdAt: string
  updatedAt: string
}

export interface AnalysisQuery {
  projectId: string | null
  codeId?: string
  search?: string
}

export interface CodedPassage {
  segmentId: string
  interviewId: string
  interviewTitle: string
  participantName: string
  projectId: string | null
  speaker: string
  startSeconds: number | null
  endSeconds: number | null
  text: string
  codes: QualitativeCode[]
  updatedAt: string
}

export interface CodeSummary extends QualitativeCode {
  passageCount: number
  interviewCount: number
}

export interface AnalysisResult {
  passages: CodedPassage[]
  codes: CodeSummary[]
  availableCodedPassages: number
  totalCodedPassages: number
  interviewCount: number
}

export interface SynthesisMemo {
  id: string
  projectId: string | null
  title: string
  body: string
  status: 'working' | 'developed'
  origin: Origin
  passages: CodedPassage[]
  createdAt: string
  updatedAt: string
}

export interface SynthesisMemoDraft {
  id?: string
  projectId: string | null
  title: string
  body: string
  status: SynthesisMemo['status']
  segmentIds: string[]
}

export interface IntegrityItem {
  kind: 'database' | 'source-file' | 'interview-media' | 'project-file'
  name: string
  relativePath: string
  status: 'ok' | 'missing' | 'modified'
  expectedSha256: string | null
  actualSha256: string | null
}

export interface IntegrityReport {
  checkedAt: string
  databaseStatus: 'ok' | 'error'
  items: IntegrityItem[]
  okCount: number
  missingCount: number
  modifiedCount: number
}

export interface WorkspacePackageSummary {
  path: string
  workspaceName: string
  exportedAt: string
  fileCount: number
  byteSize: number
}

export type QualitativeExportFormat = 'json' | 'csv'

export interface DocumentPageSummary {
  page: number
  readable: boolean
  extractionMethod: 'pdf-text' | 'ocr'
}

export interface DocumentPageText {
  id: string
  sourceFileId: string
  page: number
  text: string
  extractionMethod: 'pdf-text' | 'ocr'
  language: string | null
  confidence: number | null
  fileSha256: string
  extractedAt: string
  updatedAt: string
}

export type SearchResultType =
  'source' | 'pdf-page' | 'evidence' | 'transcript' | 'memo' | 'manuscript'

export interface SearchResult {
  type: SearchResultType
  entityId: string
  parentId: string | null
  sourceFileId: string | null
  page: number | null
  title: string
  context: string
  snippet: string
  score: number
}

export interface SearchIndexStatus {
  dirty: boolean
  indexedAt: string | null
  itemCount: number
  pageCount: number
  ocrPageCount: number
}

export interface OcrResult {
  text: string
  confidence: number
  language: string
}

export interface ResearchStudioApi {
  teaching: {
    aiSettings: () => Promise<TeachingAiSettings>
    saveAiSettings: (settings: TeachingAiSettingsDraft) => Promise<TeachingAiSettings>
    synthesize: (lesson: Lesson) => Promise<Lesson>
    cancelSynthesis: () => Promise<void>
    list: () => Promise<Lesson[]>
    save: (lesson: Lesson) => Promise<Lesson>
    importDocuments: () => Promise<TeachingSource[]>
    export: (lesson: Lesson, format: TeachingExportFormat) => Promise<boolean>
  }
  lifecycle: {
    setBeforeCloseHandler: (handler: (() => Promise<boolean>) | null) => void
    flushBeforeNavigation: () => Promise<boolean>
  }
  workspace: {
    choose: (mode: 'create' | 'open') => Promise<WorkspaceInfo | null>
    recent: () => Promise<WorkspaceInfo | null>
    close: () => Promise<void>
  }
  sources: {
    list: (query?: SourceQuery) => Promise<Source[]>
    get: (id: string) => Promise<Source>
    save: (draft: SourceDraft) => Promise<Source>
    remove: (id: string) => Promise<void>
    attachPdf: (sourceId: string) => Promise<SourceFile | null>
    openFile: (fileId: string) => Promise<void>
    importLibrary: () => Promise<ImportSummary | null>
    exportLibrary: (format: LibraryFormat) => Promise<number | null>
  }
  worker: {
    status: () => Promise<SharedWorkerStatus>
    documents: () => Promise<SharedWorkerDocument[]>
    importDocument: (fileId: string) => Promise<SharedWorkerImportResult>
  }
  reader: {
    listPageSummaries: (fileId: string) => Promise<DocumentPageSummary[]>
    pdfData: (fileId: string) => Promise<Uint8Array>
    listExcerpts: (sourceId: string) => Promise<EvidenceExcerpt[]>
    saveExcerpt: (draft: EvidenceExcerptDraft) => Promise<EvidenceExcerpt>
    removeExcerpt: (id: string) => Promise<void>
    listCodes: () => Promise<QualitativeCode[]>
    savePageText: (
      sourceFileId: string,
      page: number,
      text: string,
      method: DocumentPageText['extractionMethod'],
      confidence?: number
    ) => Promise<DocumentPageText>
    getPageText: (sourceFileId: string, page: number) => Promise<DocumentPageText | null>
    ocrPage: (image: Uint8Array) => Promise<OcrResult>
  }
  projects: {
    list: () => Promise<ProjectSummary[]>
    get: (id: string) => Promise<ProjectDetail>
    save: (draft: ProjectDraft) => Promise<ProjectDetail>
    remove: (id: string) => Promise<void>
    assignSource: (projectId: string, sourceId: string, assigned: boolean) => Promise<ProjectDetail>
    saveGoal: (
      projectId: string,
      goal: { id?: string; title: string; status: 'open' | 'complete'; targetDate: string | null }
    ) => Promise<ProjectDetail>
    removeGoal: (id: string) => Promise<void>
    saveNote: (projectId: string, body: string) => Promise<ProjectDetail>
    removeNote: (id: string) => Promise<void>
    importFiles: (projectId: string) => Promise<ProjectFileImportSummary | null>
    importDroppedFiles: (projectId: string, paths: string[]) => Promise<ProjectFileImportSummary>
    openFile: (fileId: string) => Promise<void>
    revealFile: (fileId: string) => Promise<void>
    removeFile: (
      projectId: string,
      fileId: string,
      deleteManagedCopy: boolean
    ) => Promise<ProjectDetail>
    export: (id: string) => Promise<boolean>
  }
  files: {
    pathForDrop: (file: File) => string
  }
  manuscripts: {
    list: (projectId: string) => Promise<Manuscript[]>
    get: (id: string) => Promise<Manuscript>
    save: (
      projectId: string,
      draft: { id?: string; title: string; status: Manuscript['status'] }
    ) => Promise<Manuscript>
    importDraft: (projectId: string) => Promise<ManuscriptImportResult | null>
    remove: (id: string) => Promise<void>
    saveSection: (
      manuscriptId: string,
      section: { id?: string; title: string; content: string; position: number }
    ) => Promise<Manuscript>
    removeSection: (id: string) => Promise<void>
    addTrace: (
      sectionId: string,
      evidenceExcerptId: string | null,
      sourceId: string,
      marker: string
    ) => Promise<ManuscriptSection>
    export: (id: string, format: 'markdown' | 'docx') => Promise<boolean>
  }
  revisions: {
    get: (manuscriptId: string) => Promise<RevisionWorkspace>
    importComments: (manuscriptId: string) => Promise<RevisionImportSummary | null>
    analyzeManuscript: (manuscriptId: string) => Promise<RevisionWorkspace>
    setStatus: (
      suggestionId: string,
      status: RevisionSuggestionStatus
    ) => Promise<RevisionWorkspace>
    removeDocument: (documentId: string) => Promise<RevisionWorkspace>
  }
  interviews: {
    list: () => Promise<Interview[]>
    get: (id: string) => Promise<Interview>
    save: (draft: {
      id?: string
      projectId: string | null
      title: string
      participantName: string
      occurredAt: string | null
      consentNote: string | null
      status: Interview['status']
    }) => Promise<Interview>
    remove: (id: string) => Promise<void>
    attachMedia: (id: string) => Promise<InterviewMedia | null>
    openMedia: (id: string) => Promise<void>
    importTranscript: (id: string) => Promise<Interview | null>
    saveSegment: (
      interviewId: string,
      segment: {
        id?: string
        speaker: string
        startSeconds: number | null
        endSeconds: number | null
        text: string
        position: number
        codeNames: string[]
      }
    ) => Promise<Interview>
    removeSegment: (id: string) => Promise<void>
  }
  analysis: {
    analyze: (query: AnalysisQuery) => Promise<AnalysisResult>
    listMemos: (projectId: string | null) => Promise<SynthesisMemo[]>
    saveMemo: (draft: SynthesisMemoDraft) => Promise<SynthesisMemo>
    removeMemo: (id: string) => Promise<void>
    exportMemo: (id: string) => Promise<boolean>
  }
  preservation: {
    checkIntegrity: () => Promise<IntegrityReport>
    createBackup: () => Promise<WorkspacePackageSummary | null>
    restoreBackup: () => Promise<WorkspaceInfo | null>
    exportQualitative: (format: QualitativeExportFormat) => Promise<number | null>
  }
  discovery: {
    search: (query: string, types?: SearchResultType[]) => Promise<SearchResult[]>
    status: () => Promise<SearchIndexStatus>
    rebuild: () => Promise<SearchIndexStatus>
  }
}
