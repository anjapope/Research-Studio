import { describe, expect, it } from 'vitest'
import type { Source } from '../shared/domain'
import { exportLibrary, parseLibrary, sourceToCsl } from './interchange'

const source: Source = {
  id: 'dc01547e-d57f-44e9-a555-b931b9d2dac8',
  title: 'Situated Knowledges',
  sourceType: 'article',
  status: 'reviewed',
  authors: [
    {
      id: 'e2f3832b-bbe5-45d8-b8dc-544432fa2e96',
      displayName: 'Donna Haraway',
      givenName: null,
      familyName: null,
      orcid: null
    }
  ],
  year: 1988,
  publicationTitle: 'Feminist Studies',
  publisher: null,
  doi: '10.2307/3178066',
  url: 'https://doi.org/10.2307/3178066',
  abstract: 'A partial perspective.',
  notes: 'Read closely.',
  tags: ['epistemology', 'methods'],
  origin: 'user',
  provenanceNote: 'Entered manually.',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  files: []
}

describe('citation interchange', () => {
  it('maps complete source metadata to portable CSL JSON', () => {
    expect(sourceToCsl(source)).toMatchObject({
      id: source.id,
      type: 'article-journal',
      title: source.title,
      DOI: source.doi,
      keyword: 'epistemology, methods'
    })
  })

  it('round-trips relevant metadata through CSL JSON', () => {
    const exported = exportLibrary([source], 'csl-json')
    const [draft] = parseLibrary(exported, 'csl-json', 'library.json')

    expect(draft).toMatchObject({
      title: source.title,
      sourceType: 'article',
      authors: ['Donna Haraway'],
      year: 1988,
      publicationTitle: 'Feminist Studies',
      doi: source.doi,
      tags: source.tags,
      origin: 'imported'
    })
  })

  it('imports BibTeX and exports a valid BibTeX entry', () => {
    const [draft] = parseLibrary(
      '@book{booth2008, title={The Craft of Research}, author={Booth, Wayne}, year={2008}, publisher={University of Chicago Press}}',
      'bibtex',
      'references.bib'
    )
    const bibtex = exportLibrary(
      [{ ...source, title: draft.title, sourceType: draft.sourceType }],
      'bibtex'
    )

    expect(draft.authors).toEqual(['Wayne Booth'])
    expect(draft.publisher).toBe('University of Chicago Press')
    expect(bibtex).toContain('{Craft}')
    expect(bibtex).toContain('@book')
  })
})
