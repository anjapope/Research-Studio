import { describe, expect, it } from 'vitest'
import type { Manuscript } from '../shared/domain'
import {
  classifyReviewerComment,
  manuscriptRuleProposals,
  parseManuscriptDraft,
  parseReviewerComments,
  reviewerCommentProposals
} from './revision-analysis'

function manuscript(content: string): Manuscript {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    title: 'Learning in practice',
    status: 'revision',
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
    sections: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        manuscriptId: '11111111-1111-4111-8111-111111111111',
        title: 'Methods',
        content,
        position: 0,
        updatedAt: '2026-09-04T00:00:00.000Z',
        traces: []
      }
    ]
  }
}

describe('revision analysis', () => {
  it('parses common reviewer formats and classifies transparent concern categories', () => {
    const comments = parseReviewerComments(
      '1. Please clarify the central claim.\n2. Add citations to support the evidence.\n3. Explain the sample selection.'
    )

    expect(comments).toEqual([
      'Please clarify the central claim.',
      'Add citations to support the evidence.',
      'Explain the sample selection.'
    ])
    expect(comments.map(classifyReviewerComment)).toEqual(['argument', 'evidence', 'methods'])
    expect(
      parseReviewerComments(
        '1. Clarify the argument.\nThis applies to the introduction.\n2. Add evidence.'
      )
    ).toEqual(['Clarify the argument. This applies to the introduction.', 'Add evidence.'])
    expect(
      parseReviewerComments(
        '1. Clarify the argument.\n\n   This applies to the introduction.\n\n2. Add evidence.'
      )
    ).toEqual(['Clarify the argument. This applies to the introduction.', 'Add evidence.'])
  })

  it('links reviewer suggestions to a likely section and creates stable local-rule guidance', () => {
    const draft = manuscript(
      'The methods section explains participant recruitment and the analytic procedure.'
    )
    const proposals = reviewerCommentProposals(
      draft,
      ['Please clarify the participant sample and methodology.'],
      'a'.repeat(64)
    )

    expect(proposals[0]).toMatchObject({
      sectionId: draft.sections[0].id,
      sourceType: 'reviewer-comment',
      category: 'methods'
    })
    expect(proposals[0].fingerprint).toHaveLength(64)
    expect(proposals[0].proposedAction).toContain('methodological')
    expect(proposals[0].rationale).toContain('needs enough methodological detail')
    expect(proposals[0].rationale).toContain('direct revision request')
  })

  it('interprets questions and advisory reviewer language without overstating intent', () => {
    const draft = manuscript('The methods section describes the analysis.')
    const [question, advisory] = reviewerCommentProposals(
      draft,
      [
        'Why is this sample appropriate for the research question?',
        'You might consider adding a citation for this claim.'
      ],
      'b'.repeat(64)
    )

    expect(question.rationale).toContain('unresolved reader uncertainty')
    expect(advisory.rationale).toContain('advisory rather than mandatory')
    expect(advisory.proposedAction).toContain('reread the reviewer’s exact note')
  })

  it('flags underdeveloped sections without claiming an AI-generated rewrite', () => {
    const proposals = manuscriptRuleProposals(manuscript('A brief methodological note.'))

    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({
      sourceType: 'manuscript-rule',
      category: 'structure',
      summary: 'Develop “Methods”'
    })
  })

  it('imports Markdown headings as editable manuscript sections', () => {
    expect(
      parseManuscriptDraft(
        '# Submitted article\n\n## Introduction\nOpening argument.\n\n## Methods\nStudy design.',
        'fallback'
      )
    ).toEqual({
      title: 'Submitted article',
      sections: [
        { title: 'Introduction', content: 'Opening argument.' },
        { title: 'Methods', content: 'Study design.' }
      ]
    })
    expect(parseManuscriptDraft('# Outline\n## Introduction\n## Methods', 'fallback')).toEqual({
      title: 'Outline',
      sections: [
        { title: 'Introduction', content: '' },
        { title: 'Methods', content: '' }
      ]
    })
  })
})
