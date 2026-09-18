import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { SourceDraft } from '../shared/domain'
import { WorkspaceDatabase } from './database'
import { migrations } from './migrations'
import { preparationPages, prepareDocument } from '../shared/document-preparation'

const temporaryPaths: string[] = []

function workspace(): { database: WorkspaceDatabase; path: string } {
  const path = mkdtempSync(join(tmpdir(), 'research-studio-'))
  temporaryPaths.push(path)
  return { database: new WorkspaceDatabase(path, 'Test Library'), path }
}

function draft(overrides: Partial<SourceDraft> = {}): SourceDraft {
  return {
    title: 'Situated Knowledges',
    sourceType: 'article',
    status: 'reading',
    authors: ['Donna Haraway'],
    year: 1988,
    publicationTitle: 'Feminist Studies',
    publisher: null,
    doi: '10.2307/3178066',
    url: null,
    abstract: null,
    notes: 'A note about partial perspectives.',
    tags: ['epistemology', 'methods'],
    origin: 'user',
    provenanceNote: 'Entered from the print copy.',
    ...overrides
  }
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('WorkspaceDatabase', () => {
  it('persists full-source preparation across reopen and exposes every readable page in search', async () => {
    const { database, path } = workspace()
    const source = database.saveSource(draft())
    const input = join(path, 'prepare.pdf')
    writeFileSync(input, '%PDF-1.4 preparation fixture')
    const file = database.attachPdf(source.id, input)
    const other = database.attachPdf(source.id, input)
    const report = await prepareDocument(
      preparationPages(3, []),
      'text',
      {
        getSaved: async (page) => database.getDocumentPageText(file.id, page),
        extract: async (page) => (page === 2 ? '' : `Unviewedpage${page} research`),
        recognize: async () => {
          throw new Error('OCR must be explicitly requested')
        },
        save: async (page, text, method, confidence) =>
          database.saveDocumentPageText({ sourceFileId: file.id, page, text, method, confidence })
      },
      new AbortController().signal,
      () => {}
    )
    expect(report.pages.map((item) => item.status)).toEqual(['readable', 'needs-ocr', 'readable'])
    const firstId = database.getDocumentPageText(file.id, 1)!.id
    database.saveDocumentPageText({
      sourceFileId: file.id,
      page: 1,
      text: 'Unviewedpage1 research',
      method: 'pdf-text'
    })
    expect(database.getDocumentPageText(file.id, 1)!.id).toBe(firstId)
    expect(database.listDocumentPageSummaries(other.id)).toEqual([])
    expect(database.search('Unviewedpage3', ['pdf-page'])).toEqual([
      expect.objectContaining({ parentId: source.id, sourceFileId: file.id, page: 3 })
    ])
    database.saveDocumentPageText({
      sourceFileId: file.id,
      page: 2,
      text: 'Opticalrecognition',
      method: 'ocr',
      confidence: 82
    })
    database.saveDocumentPageText({ sourceFileId: file.id, page: 2, text: '', method: 'pdf-text' })
    database.saveDocumentPageText({
      sourceFileId: file.id,
      page: 2,
      text: 'Footer only',
      method: 'pdf-text'
    })
    expect(database.getDocumentPageText(file.id, 2)).toMatchObject({
      text: 'Opticalrecognition',
      extractionMethod: 'ocr',
      confidence: 82,
      fileSha256: file.sha256
    })
    expect(database.search('Opticalrecognition', ['pdf-page'])).toHaveLength(1)
    database.close()
    const reopened = new WorkspaceDatabase(path)
    expect(reopened.listDocumentPageSummaries(file.id)).toHaveLength(3)
    expect(
      preparationPages(3, reopened.listDocumentPageSummaries(file.id)).every(
        (item) => item.status === 'readable'
      )
    ).toBe(true)
    expect(reopened.getDocumentPageText(file.id, 1)!.id).toBe(firstId)
    reopened.removeSource(source.id)
    expect(() => reopened.listDocumentPageSummaries(file.id)).toThrow('Attached PDF not found')
    expect(reopened.search('Unviewedpage3', ['pdf-page'])).toHaveLength(0)
    reopened.close()
  })

  it('rejects a changed managed PDF before assigning text its retained checksum', () => {
    const { database, path } = workspace()
    const source = database.saveSource(draft())
    const input = join(path, 'original.pdf')
    writeFileSync(input, '%PDF-1.4 original')
    const file = database.attachPdf(source.id, input)
    expect(database.pdfData(file.id).length).toBeGreaterThan(0)
    writeFileSync(database.filePath(file.id), '%PDF-1.4 modified')
    expect(() => database.pdfData(file.id)).toThrow('managed PDF has changed')
    expect(database.listDocumentPageSummaries(file.id)).toEqual([])
    database.close()
  })

  it('migrates a new workspace and retains stable source metadata', () => {
    const { database, path } = workspace()
    const created = database.saveSource(draft())
    database.close()

    const reopened = new WorkspaceDatabase(path)
    const restored = reopened.getSource(created.id)

    expect(restored.id).toBe(created.id)
    expect(restored.authors.map((author) => author.displayName)).toEqual(['Donna Haraway'])
    expect(restored.tags).toEqual(['epistemology', 'methods'])
    expect(restored.createdAt).toBe(created.createdAt)
    reopened.close()
  })

  it('upgrades an existing phase-one workspace without losing its source', () => {
    const path = mkdtempSync(join(tmpdir(), 'research-studio-v1-'))
    temporaryPaths.push(path)
    const storage = join(path, '.research-studio')
    const files = join(storage, 'files')
    mkdirSync(files, { recursive: true })
    const legacy = new DatabaseSync(join(storage, 'workspace.sqlite3'))
    legacy.exec(
      'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
    )
    legacy.exec(migrations[0].sql)
    const now = new Date().toISOString()
    legacy
      .prepare(
        'INSERT INTO workspace (id, name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, 1)'
      )
      .run('workspace-v1', 'Legacy Library', now, now)
    legacy
      .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, ?, ?)')
      .run(migrations[0].name, now)
    legacy
      .prepare(
        `INSERT INTO sources
        (id, title, source_type, status, origin, created_at, updated_at)
        VALUES (?, ?, 'article', 'unread', 'user', ?, ?)`
      )
      .run('source-v1', 'Legacy Source', now, now)
    legacy.close()

    const upgraded = new WorkspaceDatabase(path)

    expect(upgraded.getSource('source-v1').title).toBe('Legacy Source')
    expect(upgraded.listExcerpts('source-v1')).toEqual([])
    upgraded.close()
  })

  it('updates records and filters across title, author, tag, type, and status', () => {
    const { database } = workspace()
    const first = database.saveSource(draft())
    database.saveSource(
      draft({
        title: 'The Craft of Research',
        sourceType: 'book',
        status: 'reviewed',
        authors: ['Wayne Booth'],
        tags: ['writing']
      })
    )
    const updated = database.saveSource({ ...draft(), id: first.id, status: 'reviewed' })

    expect(updated.createdAt).toBe(first.createdAt)
    expect(database.listSources({ search: 'Haraway' })).toHaveLength(1)
    expect(database.listSources({ search: 'methods' })).toHaveLength(1)
    expect(database.listSources({ sourceType: 'book', status: 'reviewed' })).toHaveLength(1)
    database.close()
  })

  it('copies PDFs into managed storage with a checksum and removes them with the source', () => {
    const { database, path } = workspace()
    const source = database.saveSource(draft())
    const input = join(path, 'sample.pdf')
    writeFileSync(input, Buffer.from('%PDF-1.4 test'))

    const file = database.attachPdf(source.id, input)
    const managedPath = database.filePath(file.id)

    expect(file.sha256).toHaveLength(64)
    expect(existsSync(managedPath)).toBe(true)
    database.removeSource(source.id)
    expect(existsSync(managedPath)).toBe(false)
    database.close()
  })

  it('stores traceable page excerpts, notes, and reusable qualitative codes', () => {
    const { database, path } = workspace()
    const source = database.saveSource(draft())
    const input = join(path, 'evidence.pdf')
    writeFileSync(input, Buffer.from('%PDF-1.4 evidence'))
    const file = database.attachPdf(source.id, input)

    const excerpt = database.saveExcerpt({
      sourceId: source.id,
      sourceFileId: file.id,
      text: 'Knowledge is situated and partial.',
      note: 'Use to frame the methodological position.',
      page: 7,
      codeNames: ['epistemology', 'method']
    })

    expect(excerpt).toMatchObject({
      sourceId: source.id,
      sourceFileId: file.id,
      page: 7,
      fileName: 'evidence.pdf',
      fileSha256: file.sha256
    })
    expect(excerpt.codes.map((code) => code.name)).toEqual(['epistemology', 'method'])
    expect(database.listExcerpts(source.id)).toHaveLength(1)
    expect(database.listCodes().map((code) => code.name)).toEqual(['epistemology', 'method'])

    database.removeExcerpt(excerpt.id)
    expect(database.listExcerpts(source.id)).toEqual([])
    database.close()
  })

  it('removes evidence before deleting its source and managed PDF', () => {
    const { database, path } = workspace()
    const source = database.saveSource(draft())
    const input = join(path, 'linked.pdf')
    writeFileSync(input, Buffer.from('%PDF-1.4 linked'))
    const file = database.attachPdf(source.id, input)
    database.saveExcerpt({
      sourceId: source.id,
      sourceFileId: file.id,
      text: 'Linked evidence.',
      note: null,
      page: 1,
      codeNames: []
    })

    database.removeSource(source.id)

    expect(() => database.getSource(source.id)).toThrow('Source not found')
    database.close()
  })

  it('organizes sources, evidence, goals, and notes around a project question', () => {
    const { database, path } = workspace()
    const source = database.saveSource(draft())
    const input = join(path, 'project-evidence.pdf')
    writeFileSync(input, Buffer.from('%PDF-1.4 project evidence'))
    const file = database.attachPdf(source.id, input)
    database.saveExcerpt({
      sourceId: source.id,
      sourceFileId: file.id,
      text: 'Situated evidence for the project.',
      note: 'Supports the central claim.',
      page: 4,
      codeNames: ['framework']
    })
    const project = database.saveProject({
      title: 'Situated Methods',
      researchQuestion: 'How does positionality shape methodological claims?',
      description: 'A focused synthesis project.',
      status: 'active'
    })

    database.assignProjectSource(project.id, source.id, true)
    database.saveProjectGoal(project.id, {
      title: 'Synthesize core evidence',
      status: 'open',
      targetDate: '2026-10-01'
    })
    database.saveProjectNote(project.id, 'Compare the argument across disciplines.')
    const detail = database.getProject(project.id)

    expect(detail).toMatchObject({
      sourceCount: 1,
      evidenceCount: 1,
      openGoalCount: 1,
      sourceIds: [source.id]
    })
    expect(detail.evidence[0]).toMatchObject({
      sourceTitle: source.title,
      page: 4
    })
    expect(detail.goals[0].title).toBe('Synthesize core evidence')
    expect(detail.notes[0].body).toBe('Compare the argument across disciplines.')
    expect(database.projectExport(project.id)).toMatchObject({
      format: 'research-studio-project',
      version: 2,
      project: { id: project.id },
      sources: [{ id: source.id }],
      manuscripts: []
    })

    database.removeProject(project.id)
    expect(() => database.getProject(project.id)).toThrow('Project not found')
    expect(database.getSource(source.id).title).toBe(source.title)
    database.close()
  })

  it('copies, deduplicates, links, unlinks, and deletes managed project files safely', () => {
    const { database, path } = workspace()
    const firstProject = database.saveProject({
      title: 'Primary project',
      researchQuestion: 'What does the source material show?',
      description: null,
      status: 'active'
    })
    const secondProject = database.saveProject({
      title: 'Related project',
      researchQuestion: 'How does the same material apply elsewhere?',
      description: null,
      status: 'active'
    })
    const original = join(path, 'paper draft.md')
    writeFileSync(original, '# Original research notes')

    const imported = database.importProjectFiles(firstProject.id, [original])
    const file = imported.project.files[0]
    const managedPath = database.projectFilePath(file.id)
    expect(imported).toMatchObject({ imported: 1, linkedExisting: 0, duplicates: 0 })
    expect(file).toMatchObject({
      originalName: 'paper draft.md',
      extension: 'md',
      mediaType: 'text/markdown',
      linkCount: 1
    })
    expect(managedPath).toContain(join('project-files', firstProject.id))
    expect(existsSync(managedPath)).toBe(true)

    expect(database.importProjectFiles(firstProject.id, [original]).duplicates).toBe(1)
    expect(database.importProjectFiles(secondProject.id, [original]).linkedExisting).toBe(1)
    expect(database.getProject(firstProject.id).files[0].linkCount).toBe(2)

    database.removeProjectFile(firstProject.id, file.id, false)
    expect(database.getProject(firstProject.id).files).toEqual([])
    expect(existsSync(managedPath)).toBe(true)
    database.removeProjectFile(secondProject.id, file.id, true)
    expect(existsSync(managedPath)).toBe(false)
    expect(existsSync(original)).toBe(true)
    database.close()
  })

  it('autosaves manuscript sections and retains evidence trace links', () => {
    const { database, path } = workspace()
    const source = database.saveSource(draft())
    const input = join(path, 'manuscript.pdf')
    writeFileSync(input, Buffer.from('%PDF-1.4 manuscript'))
    const file = database.attachPdf(source.id, input)
    const excerpt = database.saveExcerpt({
      sourceId: source.id,
      sourceFileId: file.id,
      text: 'Knowledge is always situated.',
      note: null,
      page: 12,
      codeNames: ['claim']
    })
    const project = database.saveProject({
      title: 'Article project',
      researchQuestion: 'How is knowledge situated?',
      description: null,
      status: 'active'
    })
    database.assignProjectSource(project.id, source.id, true)
    const manuscript = database.saveManuscript(project.id, {
      title: 'Situated Arguments',
      status: 'draft'
    })
    const section = manuscript.sections[0]
    database.saveManuscriptSection(manuscript.id, {
      id: section.id,
      title: 'Opening argument',
      content: 'Knowledge claims are partial (Haraway, 1988, p. 12).',
      position: 0
    })
    database.addManuscriptTrace(section.id, excerpt.id, source.id, '(Haraway, 1988, p. 12)')
    const restored = database.getManuscript(manuscript.id)

    expect(restored.sections[0]).toMatchObject({
      title: 'Opening argument',
      content: 'Knowledge claims are partial (Haraway, 1988, p. 12).'
    })
    expect(restored.sections[0].traces[0]).toMatchObject({
      evidenceExcerptId: excerpt.id,
      sourceId: source.id,
      page: 12,
      fileSha256: file.sha256
    })
    const managedPath = database.filePath(file.id)
    expect(() => database.removeSource(source.id)).toThrow('cited by a manuscript')
    expect(existsSync(managedPath)).toBe(true)
    expect(database.getSource(source.id).id).toBe(source.id)
    database.close()
  })

  it('persists reviewer comments, local suggestions, and author decisions', () => {
    const { database } = workspace()
    const project = database.saveProject({
      title: 'Revision project',
      researchQuestion: 'How should this argument be strengthened?',
      description: null,
      status: 'active'
    })
    const manuscript = database.importManuscript(project.id, 'Article under review', [
      {
        title: 'Methods',
        content: 'We interviewed participants and analyzed their accounts.'
      }
    ])

    const imported = database.importReviewDocument(
      manuscript.id,
      'reviewer-2.md',
      'Please clarify the participant sample and methodology.\n\nAdd citations to support the central claim.'
    )

    expect(imported).toMatchObject({
      fileName: 'reviewer-2.md',
      importedComments: 2,
      duplicate: false,
      documents: [{ originalName: 'reviewer-2.md', commentCount: 2 }]
    })
    expect(imported.suggestions.map((suggestion) => suggestion.category).sort()).toEqual([
      'evidence',
      'methods'
    ])
    const methods = imported.suggestions.find((suggestion) => suggestion.category === 'methods')!
    expect(methods).toMatchObject({
      sectionId: manuscript.sections[0].id,
      sectionTitle: 'Methods',
      generatedBy: 'local-rules',
      status: 'open'
    })

    const decided = database.setRevisionSuggestionStatus(methods.id, 'addressed')
    expect(decided.suggestions.find((suggestion) => suggestion.id === methods.id)?.status).toBe(
      'addressed'
    )
    expect(
      database.importReviewDocument(
        manuscript.id,
        'same-content.txt',
        'Please clarify the participant sample and methodology.\n\nAdd citations to support the central claim.'
      )
    ).toMatchObject({ duplicate: true, importedComments: 0 })

    const analyzed = database.analyzeManuscriptRevision(manuscript.id)
    const reinterpreted = analyzed.suggestions.find((suggestion) => suggestion.id === methods.id)!
    expect(reinterpreted.status).toBe('addressed')
    expect(reinterpreted.rationale).toContain('needs enough methodological detail')
    expect(reinterpreted.proposedAction).toContain('reread the reviewer’s exact note')
    expect(
      analyzed.suggestions.some(
        (suggestion) =>
          suggestion.sourceType === 'manuscript-rule' && suggestion.category === 'structure'
      )
    ).toBe(true)
    const localSuggestion = analyzed.suggestions.find(
      (suggestion) => suggestion.sourceType === 'manuscript-rule'
    )!
    database.setRevisionSuggestionStatus(localSuggestion.id, 'deferred')
    expect(
      database
        .analyzeManuscriptRevision(manuscript.id)
        .suggestions.find((suggestion) => suggestion.id === localSuggestion.id)?.status
    ).toBe('deferred')
    expect(database.projectExport(project.id)).toMatchObject({
      version: 2,
      manuscripts: [
        {
          id: manuscript.id,
          revisions: {
            documents: [{ originalName: 'reviewer-2.md' }]
          }
        }
      ]
    })
    const cleared = database.removeReviewDocument(imported.documents[0].id)
    expect(cleared.documents).toEqual([])
    expect(cleared.suggestions.every((suggestion) => suggestion.reviewerCommentId === null)).toBe(
      true
    )
    database.close()
  })

  it('imports a manuscript and extracted inline reviewer notes together', () => {
    const { database } = workspace()
    const project = database.saveProject({
      title: 'Annotated manuscript',
      researchQuestion: 'How should the revision proceed?',
      description: null,
      status: 'active'
    })

    const imported = database.importManuscriptWithReviewNotes(
      project.id,
      'Article',
      [{ title: 'Discussion', content: 'Original author text.' }],
      'article.docx — inline annotations',
      ['Explain why this claim follows from the evidence.']
    )

    expect(imported.reviewerCommentsImported).toBe(1)
    expect(imported.manuscript.sections[0].content).toBe('Original author text.')
    expect(database.getRevisionWorkspace(imported.manuscript.id)).toMatchObject({
      documents: [{ originalName: 'article.docx — inline annotations', commentCount: 1 }],
      suggestions: [
        {
          reviewerComment: 'Explain why this claim follows from the evidence.',
          sourceType: 'reviewer-comment'
        }
      ]
    })
    database.close()
  })

  it('retains interview consent, managed media, transcript segments, and reusable codes', () => {
    const { database, path } = workspace()
    const project = database.saveProject({
      title: 'Field study',
      researchQuestion: 'How do practitioners learn?',
      description: null,
      status: 'active'
    })
    const interview = database.saveInterview({
      projectId: project.id,
      title: 'Participant 01',
      participantName: 'P01',
      occurredAt: '2026-04-10',
      consentNote: 'Consent covers analysis; use pseudonym in outputs.',
      status: 'recorded'
    })
    const input = join(path, 'recording.wav')
    writeFileSync(input, Buffer.from('local interview audio'))
    const media = database.attachInterviewMedia(interview.id, input)
    const imported = database.importTranscript(
      interview.id,
      'Interviewer: Tell me about your process.\n\nP01: I learn by testing ideas.'
    )
    const coded = database.saveTranscriptSegment(interview.id, {
      ...imported.segments[1],
      startSeconds: 12.5,
      endSeconds: 18,
      codeNames: ['Learning practice', 'Experimentation']
    })

    expect(coded).toMatchObject({
      projectId: project.id,
      participantName: 'P01',
      consentNote: 'Consent covers analysis; use pseudonym in outputs.',
      status: 'transcribed'
    })
    expect(coded.media[0]).toMatchObject({
      originalName: 'recording.wav',
      byteSize: 21,
      sha256: media.sha256
    })
    expect(existsSync(database.interviewMediaPath(media.id))).toBe(true)
    expect(coded.segments[1]).toMatchObject({
      speaker: 'P01',
      startSeconds: 12.5,
      endSeconds: 18,
      text: 'I learn by testing ideas.'
    })
    expect(coded.segments[1].codes.map((code) => code.name)).toEqual([
      'Experimentation',
      'Learning practice'
    ])

    database.removeProject(project.id)
    expect(database.getInterview(interview.id).projectId).toBeNull()
    const mediaPath = database.interviewMediaPath(media.id)
    database.removeInterview(interview.id)
    expect(existsSync(mediaPath)).toBe(false)
    expect(() => database.getInterview(interview.id)).toThrow('Interview not found')
    database.close()
  })

  it('analyzes codes across interviews and retains traceable synthesis memos', () => {
    const { database } = workspace()
    const project = database.saveProject({
      title: 'Learning practices',
      researchQuestion: 'How do practitioners develop expertise?',
      description: null,
      status: 'active'
    })
    const first = database.saveInterview({
      projectId: project.id,
      title: 'Interview A',
      participantName: 'P01',
      occurredAt: null,
      consentNote: null,
      status: 'transcribed'
    })
    const second = database.saveInterview({
      projectId: project.id,
      title: 'Interview B',
      participantName: 'P02',
      occurredAt: null,
      consentNote: null,
      status: 'transcribed'
    })
    const firstCoded = database.saveTranscriptSegment(first.id, {
      speaker: 'P01',
      startSeconds: 4,
      endSeconds: 11,
      text: 'I learned by trying small experiments.',
      position: 0,
      codeNames: ['Experimentation', 'Learning']
    })
    database.saveTranscriptSegment(second.id, {
      speaker: 'P02',
      startSeconds: null,
      endSeconds: null,
      text: 'A colleague showed me how the workflow fit together.',
      position: 0,
      codeNames: ['Learning', 'Peer support']
    })

    const analysis = database.analyzeInterviews({ projectId: project.id })
    expect(analysis).toMatchObject({
      availableCodedPassages: 2,
      totalCodedPassages: 2,
      interviewCount: 2
    })
    expect(analysis.codes.find((code) => code.name === 'Learning')).toMatchObject({
      passageCount: 2,
      interviewCount: 2
    })
    const experimentation = analysis.codes.find((code) => code.name === 'Experimentation')!
    expect(
      database.analyzeInterviews({
        projectId: project.id,
        codeId: experimentation.id,
        search: 'small'
      }).passages
    ).toHaveLength(1)

    const memo = database.saveSynthesisMemo({
      projectId: project.id,
      title: 'Learning through situated support',
      body: 'Participants described complementary individual and social learning practices.',
      status: 'working',
      segmentIds: analysis.passages.map((passage) => passage.segmentId)
    })
    expect(memo).toMatchObject({
      projectId: project.id,
      origin: 'user',
      status: 'working'
    })
    expect(memo.passages.map((passage) => passage.interviewTitle)).toEqual([
      'Interview A',
      'Interview B'
    ])
    const appended = database.importTranscript(first.id, 'P01: A later clarification.')
    expect(appended.segments).toHaveLength(2)
    expect(appended.segments[0].codes.map((code) => code.name)).toEqual([
      'Experimentation',
      'Learning'
    ])
    expect(database.getSynthesisMemo(memo.id).passages[0].segmentId).toBe(firstCoded.segments[0].id)
    const workspaceMemo = database.saveSynthesisMemo({
      projectId: null,
      title: 'Workspace pattern',
      body: '',
      status: 'working',
      segmentIds: []
    })
    expect(
      database
        .listSynthesisMemos(project.id)
        .map((item) => item.id)
        .sort()
    ).toEqual([workspaceMemo.id, memo.id].sort())

    database.removeInterview(first.id)
    expect(database.getSynthesisMemo(memo.id).passages).toHaveLength(1)
    expect(firstCoded.segments).toHaveLength(1)
    database.removeProject(project.id)
    expect(database.getSynthesisMemo(memo.id).projectId).toBeNull()
    database.removeSynthesisMemo(memo.id)
    database.removeSynthesisMemo(workspaceMemo.id)
    expect(() => database.getSynthesisMemo(memo.id)).toThrow('Synthesis memo not found')
    database.close()
  })

  it('indexes page text and searches across the local evidence trail', () => {
    const { database, path } = workspace()
    const source = database.saveSource(
      draft({
        title: 'Community learning systems',
        abstract: 'An account of collaborative apprenticeship.'
      })
    )
    const pdf = join(path, 'searchable.pdf')
    writeFileSync(pdf, Buffer.from('%PDF-1.4 searchable'))
    const file = database.attachPdf(source.id, pdf)
    const page = database.saveDocumentPageText({
      sourceFileId: file.id,
      page: 7,
      text: 'Tacit knowledge travels through repeated situated practice.',
      method: 'pdf-text'
    })
    database.saveExcerpt({
      sourceId: source.id,
      sourceFileId: file.id,
      text: 'Collaborative apprenticeship supports reflection.',
      note: 'Compare with interview descriptions.',
      page: 7,
      codeNames: ['Learning']
    })
    const interview = database.saveInterview({
      projectId: null,
      title: 'Practitioner interview',
      participantName: 'P03',
      occurredAt: null,
      consentNote: null,
      status: 'transcribed'
    })
    database.saveTranscriptSegment(interview.id, {
      speaker: 'P03',
      startSeconds: 10,
      endSeconds: 20,
      text: 'Mentoring made the tacit workflow visible.',
      position: 0,
      codeNames: ['Mentoring']
    })

    expect(database.searchIndexStatus()).toMatchObject({ dirty: true, pageCount: 1 })
    const results = database.search('tacit')
    expect(results.map((result) => result.type).sort()).toEqual(['pdf-page', 'transcript'])
    expect(results.find((result) => result.type === 'pdf-page')).toMatchObject({
      entityId: page.id,
      parentId: source.id,
      sourceFileId: file.id,
      page: 7
    })
    expect(database.search('mentoring', ['transcript'])).toMatchObject([
      { type: 'transcript', parentId: interview.id }
    ])
    expect(database.searchIndexStatus()).toMatchObject({
      dirty: false,
      pageCount: 1,
      itemCount: 4
    })

    database.saveDocumentPageText({
      sourceFileId: file.id,
      page: 7,
      text: 'Reflexive practice replaced the earlier wording.',
      method: 'ocr',
      confidence: 91
    })
    expect(database.searchIndexStatus().dirty).toBe(true)
    expect(database.search('reflexive', ['pdf-page'])).toMatchObject([
      { type: 'pdf-page', page: 7 }
    ])
    expect(database.getDocumentPageText(file.id, 7)).toMatchObject({
      extractionMethod: 'ocr',
      confidence: 91,
      fileSha256: file.sha256
    })
    database.close()
  })

  it('applies qualitative migrations to an existing manuscript workspace', () => {
    const path = mkdtempSync(join(tmpdir(), 'research-studio-v4-'))
    temporaryPaths.push(path)
    const storage = join(path, '.research-studio')
    mkdirSync(join(storage, 'files'), { recursive: true })
    const legacy = new DatabaseSync(join(storage, 'workspace.sqlite3'))
    legacy.exec(
      'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
    )
    migrations.slice(0, 4).forEach((migration) => legacy.exec(migration.sql))
    const now = new Date().toISOString()
    legacy
      .prepare(
        'INSERT INTO workspace (id, name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, 4)'
      )
      .run('workspace-v4', 'Manuscript Library', now, now)
    migrations
      .slice(0, 4)
      .forEach((migration) =>
        legacy
          .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, now)
      )
    legacy.close()

    const upgraded = new WorkspaceDatabase(path)
    const interview = upgraded.saveInterview({
      projectId: null,
      title: 'Legacy workspace interview',
      participantName: 'P02',
      occurredAt: null,
      consentNote: null,
      status: 'planned'
    })

    expect(interview.transcriptId).toBeTruthy()
    expect(interview.segments).toEqual([])
    upgraded.close()
    const migrated = new DatabaseSync(join(storage, 'workspace.sqlite3'))
    expect(
      Number(
        (
          migrated.prepare('SELECT schema_version FROM workspace LIMIT 1').get() as {
            schema_version: number
          }
        ).schema_version
      )
    ).toBe(11)
    migrated.close()
  })
})
