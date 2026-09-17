import { z } from 'zod'
import { ORIGINS, SOURCE_STATUSES, SOURCE_TYPES } from '../shared/domain'

const nullableText = z.string().trim().max(20_000).nullable()

export const sourceDraftSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Title is required').max(500),
  sourceType: z.enum(SOURCE_TYPES),
  status: z.enum(SOURCE_STATUSES),
  authors: z.array(z.string().trim().min(1).max(300)).max(100),
  year: z.number().int().min(1000).max(3000).nullable(),
  publicationTitle: nullableText,
  publisher: nullableText,
  doi: nullableText,
  url: z.union([z.url(), z.literal(''), z.null()]).transform((value) => value || null),
  abstract: nullableText,
  notes: nullableText,
  tags: z.array(z.string().trim().min(1).max(100)).max(100),
  origin: z.enum([ORIGINS[0], ORIGINS[1]]),
  provenanceNote: nullableText
})

export const sourceQuerySchema = z
  .object({
    search: z.string().trim().max(500).optional(),
    sourceType: z.enum([...SOURCE_TYPES, 'all']).optional(),
    status: z.enum([...SOURCE_STATUSES, 'all']).optional()
  })
  .optional()

export const idSchema = z.string().uuid()

export const evidenceExcerptDraftSchema = z.object({
  sourceId: z.string().uuid(),
  sourceFileId: z.string().uuid(),
  text: z.string().trim().min(1, 'Select text before saving an excerpt.').max(50_000),
  note: z.string().trim().max(20_000).nullable(),
  page: z.number().int().min(1).max(100_000),
  codeNames: z.array(z.string().trim().min(1).max(100)).max(50)
})

export const projectDraftSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Project title is required.').max(300),
  researchQuestion: z.string().trim().min(1, 'Research question is required.').max(2_000),
  description: z.string().trim().max(20_000).nullable(),
  status: z.enum(['active', 'paused', 'complete'])
})

export const projectGoalSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Goal title is required.').max(500),
  status: z.enum(['open', 'complete']),
  targetDate: z.union([z.iso.date(), z.literal(''), z.null()]).transform((value) => value || null)
})

export const projectNoteSchema = z.string().trim().min(1, 'Note cannot be empty.').max(20_000)

export const projectFilePathsSchema = z.array(z.string().min(1).max(32_000)).min(1).max(100)

export const manuscriptDraftSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Manuscript title is required.').max(500),
  status: z.enum(['draft', 'revision', 'complete'])
})

export const manuscriptSectionSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Section title is required.').max(500),
  content: z.string().max(500_000),
  position: z.number().int().min(0).max(10_000)
})

export const manuscriptTraceSchema = z.object({
  sectionId: z.string().uuid(),
  evidenceExcerptId: z.string().uuid().nullable(),
  sourceId: z.string().uuid(),
  marker: z.string().trim().min(1).max(2_000)
})

export const revisionSuggestionStatusSchema = z.enum(['open', 'addressed', 'deferred', 'dismissed'])

export const interviewDraftSchema = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid().nullable(),
  title: z.string().trim().min(1, 'Interview title is required.').max(500),
  participantName: z.string().trim().min(1, 'Participant name or pseudonym is required.').max(300),
  occurredAt: z.union([z.iso.date(), z.literal(''), z.null()]).transform((value) => value || null),
  consentNote: z.string().trim().max(20_000).nullable(),
  status: z.enum(['planned', 'recorded', 'transcribed', 'coded'])
})

export const transcriptSegmentSchema = z
  .object({
    id: z.string().uuid().optional(),
    speaker: z.string().trim().min(1).max(200),
    startSeconds: z.number().min(0).max(10_000_000).nullable(),
    endSeconds: z.number().min(0).max(10_000_000).nullable(),
    text: z.string().trim().min(1, 'Transcript text is required.').max(100_000),
    position: z.number().int().min(0).max(100_000),
    codeNames: z.array(z.string().trim().min(1).max(100)).max(50)
  })
  .refine(
    (value) =>
      value.startSeconds === null ||
      value.endSeconds === null ||
      value.endSeconds >= value.startSeconds,
    { message: 'Segment end time must be after its start time.' }
  )

export const analysisQuerySchema = z.object({
  projectId: z.string().uuid().nullable(),
  codeId: z.string().uuid().optional(),
  search: z.string().trim().max(500).optional()
})

export const synthesisMemoDraftSchema = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid().nullable(),
  title: z.string().trim().min(1, 'Memo title is required.').max(500),
  body: z.string().max(500_000),
  status: z.enum(['working', 'developed']),
  segmentIds: z
    .array(z.string().uuid())
    .max(1_000)
    .transform((ids) => [...new Set(ids)])
})

export const documentPageTextSchema = z.object({
  sourceFileId: z.string().uuid(),
  page: z.number().int().min(1).max(100_000),
  text: z.string().trim().max(500_000),
  method: z.enum(['pdf-text', 'ocr']),
  confidence: z.number().min(0).max(100).optional()
})

export const discoverySearchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  types: z
    .array(z.enum(['source', 'pdf-page', 'evidence', 'transcript', 'memo', 'manuscript']))
    .max(6)
    .optional()
})
