export interface TranscriptionRequest {
  localMediaPath: string
  language?: string
}

export interface TranscriptionService {
  transcribe(
    request: TranscriptionRequest
  ): Promise<{ text: string; provenance: Record<string, string> }>
}

export interface ObservationRequest {
  subjectType: string
  subjectId: string
  evidenceIds: string[]
}

export interface GenerativeObservationService {
  observe(
    request: ObservationRequest
  ): Promise<{ body: string; provenance: Record<string, string> }>
}

export type MicrosoftLearningProduct =
  | 'microsoft-foundry'
  | 'azure-ai-tools'
  | 'fabric'
  | 'onelake'
  | 'power-bi'
  | 'copilot-studio'
  | 'purview'
  | 'entra'

export interface LearningContext {
  researchTask: string
  projectId?: string
  sourceIds: string[]
  evidenceExcerptIds: string[]
  proficiency: 'new' | 'practicing' | 'proficient'
}

export interface LearningGuide {
  id: string
  product: MicrosoftLearningProduct
  title: string
  outcome: string
  readyToUsePrompts: string[]
  steps: Array<{
    instruction: string
    rationale: string
    checkpoint: string
  }>
  concepts: string[]
  practiceTask: string
  officialSources: string[]
  contentVersion: string
  reviewedAt: string
}

export interface LearningGuideProvider {
  supports(product: MicrosoftLearningProduct): boolean
  createGuide(context: LearningContext, product: MicrosoftLearningProduct): Promise<LearningGuide>
}

// These contracts deliberately have no implementations yet. Future services must remain optional,
// explicitly invoked, provenance-aware, and isolated from the local research data boundary.
