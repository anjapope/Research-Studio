import { createHash } from 'crypto'
import type { Manuscript, RevisionCategory } from '../shared/domain'

export interface RevisionProposal {
  reviewerCommentPosition: number | null
  sectionId: string | null
  sourceType: 'reviewer-comment' | 'manuscript-rule'
  category: RevisionCategory
  fingerprint: string
  summary: string
  rationale: string
  proposedAction: string
}

export interface ParsedManuscriptDraft {
  title: string
  sections: Array<{ title: string; content: string }>
  reviewerComments?: string[]
}

const categoryTerms: Record<RevisionCategory, string[]> = {
  argument: ['argument', 'claim', 'thesis', 'theory', 'theoretical', 'concept', 'position'],
  evidence: [
    'evidence',
    'citation',
    'cite',
    'reference',
    'source',
    'data',
    'support',
    'substantiate',
    'literature'
  ],
  methods: [
    'method',
    'methodology',
    'sample',
    'participant',
    'analysis',
    'procedure',
    'validity',
    'reliability'
  ],
  structure: ['structure', 'organize', 'organisation', 'organization', 'section', 'flow', 'order'],
  clarity: ['unclear', 'clarify', 'confusing', 'define', 'explain', 'ambiguous', 'meaning'],
  style: ['grammar', 'style', 'tone', 'wording', 'sentence', 'concise', 'typo', 'readability']
}

const categoryActions: Record<RevisionCategory, string> = {
  argument:
    'State the claim explicitly, identify its scope, and explain how the section advances the manuscript’s central argument.',
  evidence:
    'Add or strengthen support for the claim. Check linked project sources and evidence excerpts before introducing a new citation.',
  methods:
    'Clarify the methodological choice, procedure, or limitation and explain why it is appropriate for the research question.',
  structure:
    'Reorder or divide the relevant material so each paragraph has one function and the progression is explicit.',
  clarity:
    'Define the key term or rewrite the passage so the subject, claim, and relationship between ideas are explicit.',
  style:
    'Revise for precision and concision while preserving the scholarly meaning and the author’s voice.'
}

const categoryInterpretations: Record<RevisionCategory, string> = {
  argument:
    'The reviewer likely cannot yet identify the precise claim, its boundaries, or its contribution to the larger argument.',
  evidence:
    'The reviewer likely sees a claim whose support, citation, or connection to the presented evidence is not yet visible.',
  methods:
    'The reviewer likely needs enough methodological detail to understand, evaluate, or reproduce the research decision.',
  structure:
    'The reviewer likely understands the individual points but is having difficulty following their order or function.',
  clarity:
    'The reviewer is signaling a reader-comprehension problem: an important term, relationship, or implication is underspecified.',
  style:
    'The reviewer appears to accept the underlying point but wants its expression made more precise, concise, or consistent.'
}

const stopWords = new Set([
  'about',
  'after',
  'also',
  'and',
  'are',
  'because',
  'been',
  'before',
  'being',
  'but',
  'can',
  'could',
  'does',
  'from',
  'have',
  'into',
  'more',
  'should',
  'that',
  'the',
  'their',
  'there',
  'these',
  'this',
  'those',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
  'your'
])

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function words(value: string): string[] {
  return (value.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).filter(
    (word) => !stopWords.has(word)
  )
}

export function parseReviewerComments(content: string): string[] {
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []
  let blocks = normalized.split(/\n\s*\n+/)
  if (normalized.split('\n').filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line)).length > 1) {
    blocks = []
    let current = ''
    for (const line of normalized.split('\n')) {
      const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/)
      if (item) {
        if (current.trim()) blocks.push(current)
        current = item[1]
      } else if (!current && /^\s*#{1,6}\s+/.test(line)) {
        continue
      } else if (line.trim()) {
        current = `${current} ${line.trim()}`.trim()
      }
    }
    if (current.trim()) blocks.push(current)
  }

  return blocks
    .map((block) =>
      block
        .replace(/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .slice(0, 500)
}

export function parseManuscriptDraft(
  content: string,
  fallbackTitle: string,
  sectionHeadingLevels: readonly number[] = [2, 3]
): ParsedManuscriptDraft {
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  if (!normalized) throw new Error('The manuscript file is empty.')
  const lines = normalized.split('\n')
  let title = fallbackTitle.trim() || 'Imported manuscript'
  if (/^#\s+/.test(lines[0])) title = lines.shift()!.replace(/^#\s+/, '').trim() || title
  const sections: ParsedManuscriptDraft['sections'] = []
  let sectionTitle: string | null = null
  let sectionLines: string[] = []
  const pushSection = (preserveEmpty: boolean): void => {
    const body = sectionLines.join('\n').trim()
    if (body || preserveEmpty) {
      sections.push({ title: sectionTitle ?? 'Imported draft', content: body })
    }
  }
  for (const line of lines) {
    const heading = line.match(/^(#{2,6})\s+(.+)$/)
    if (heading && sectionHeadingLevels.includes(heading[1].length)) {
      pushSection(sectionTitle !== null)
      sectionTitle = heading[2].trim()
      sectionLines = []
    } else {
      sectionLines.push(line)
    }
  }
  pushSection(true)
  return { title, sections }
}

export function classifyReviewerComment(comment: string): RevisionCategory {
  const lower = comment.toLowerCase()
  const scores = (Object.keys(categoryTerms) as RevisionCategory[]).map((category) => ({
    category,
    score: categoryTerms[category].reduce(
      (total, term) => total + (lower.includes(term) ? 1 : 0),
      0
    )
  }))
  scores.sort((left, right) => right.score - left.score)
  return scores[0].score > 0 ? scores[0].category : 'clarity'
}

function targetSection(
  manuscript: Manuscript,
  text: string,
  category: RevisionCategory
): string | null {
  const terms = new Set([...words(text), ...categoryTerms[category]])
  let best: { id: string; score: number } | null = null
  for (const section of manuscript.sections) {
    const title = section.title.toLowerCase()
    const content = section.content.toLowerCase()
    let score = 0
    for (const term of terms) {
      if (title.includes(term)) score += 4
      else if (content.includes(term)) score += 1
    }
    if (!best || score > best.score) best = { id: section.id, score }
  }
  return best && best.score >= 4 ? best.id : null
}

export function reviewerCommentProposals(
  manuscript: Manuscript,
  comments: string[],
  documentSha256: string
): RevisionProposal[] {
  return comments.map((comment, position) => {
    const category = classifyReviewerComment(comment)
    const sectionId = targetSection(manuscript, comment, category)
    const section = manuscript.sections.find((item) => item.id === sectionId)
    const lower = comment.toLowerCase()
    const requestSignal = /\?/.test(comment)
      ? 'Because the note is phrased as a question, treat it as an unresolved reader uncertainty that the revision should answer explicitly.'
      : /\b(?:consider|could|might|perhaps|suggest)\b/.test(lower)
        ? 'The wording is advisory rather than mandatory; preserve the manuscript’s purpose while addressing the underlying concern.'
        : /\b(?:please|add|clarify|explain|define|revise|expand|show|state)\b/.test(lower)
          ? 'The wording contains a direct revision request, so the response should produce a visible change rather than only an author note.'
          : 'Treat the note as evidence about how a careful reader experienced the current passage.'
    const location = section
      ? `The language most closely matches “${section.title}”; verify that location before revising.`
      : 'No section matched with enough confidence, so first identify the passage that prompted the concern.'
    return {
      reviewerCommentPosition: position,
      sectionId,
      sourceType: 'reviewer-comment',
      category,
      fingerprint: hash(`review:${documentSha256}:${position}:${comment}`),
      summary: `Interpret reviewer’s ${category} concern`,
      rationale: `${categoryInterpretations[category]} ${requestSignal} ${location}`,
      proposedAction: `${categoryActions[category]} After revising, reread the reviewer’s exact note and confirm that a reader can now find the answer in the manuscript itself.`
    }
  })
}

export function manuscriptRuleProposals(manuscript: Manuscript): RevisionProposal[] {
  const proposals: RevisionProposal[] = []
  for (const section of manuscript.sections) {
    const content = section.content.trim()
    const wordCount = words(content).length
    if (wordCount < 40) {
      proposals.push({
        reviewerCommentPosition: null,
        sectionId: section.id,
        sourceType: 'manuscript-rule',
        category: 'structure',
        fingerprint: hash(`rule:underdeveloped:${section.id}:${content}`),
        summary: `Develop “${section.title}”`,
        rationale: `This section currently contains approximately ${wordCount} substantive words, which may be too short to establish and support its purpose.`,
        proposedAction:
          'Add the section’s governing claim, the evidence or reasoning that supports it, and a transition explaining its role in the larger argument.'
      })
    }
    const paragraphs = content.split(/\n\s*\n/).filter(Boolean)
    const longestParagraph = Math.max(0, ...paragraphs.map((paragraph) => words(paragraph).length))
    if (longestParagraph > 180) {
      proposals.push({
        reviewerCommentPosition: null,
        sectionId: section.id,
        sourceType: 'manuscript-rule',
        category: 'clarity',
        fingerprint: hash(`rule:long-paragraph:${section.id}:${content}`),
        summary: `Review a long paragraph in “${section.title}”`,
        rationale: `The section contains a paragraph of approximately ${longestParagraph} substantive words, which can obscure shifts in claim or evidence.`,
        proposedAction:
          'Split the paragraph at the point where its function changes, then add a clear topic sentence to each resulting paragraph.'
      })
    }
    const hasCitation =
      /\([^)]+,\s*(?:19|20)\d{2}[^)]*\)/.test(content) || section.traces.length > 0
    if (wordCount > 250 && !hasCitation) {
      proposals.push({
        reviewerCommentPosition: null,
        sectionId: section.id,
        sourceType: 'manuscript-rule',
        category: 'evidence',
        fingerprint: hash(`rule:evidence-gap:${section.id}:${content}`),
        summary: `Check support in “${section.title}”`,
        rationale:
          'This developed section has no detected citation marker or Research Studio evidence trace. This is a prompt to inspect support, not proof that a citation is required.',
        proposedAction:
          'Identify the section’s externally verifiable claims and link appropriate project evidence or explain why the passage is interpretive rather than evidentiary.'
      })
    }
  }
  return proposals
}
