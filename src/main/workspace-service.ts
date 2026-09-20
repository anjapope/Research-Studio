import { dialog, shell } from 'electron'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { readFileSync, statSync, writeFileSync } from 'fs'
import { basename, extname, resolve } from 'path'
import type {
  AnalysisQuery,
  AnalysisResult,
  DocumentPageText,
  DocumentPageSummary,
  EvidenceExcerpt,
  EvidenceExcerptDraft,
  ImportSummary,
  Interview,
  InterviewMedia,
  LibraryFormat,
  Manuscript,
  ManuscriptSection,
  ProjectDetail,
  ProjectDraft,
  ProjectFileImportSummary,
  ProjectSummary,
  QualitativeExportFormat,
  QualitativeCode,
  RevisionImportSummary,
  RevisionSuggestionStatus,
  RevisionWorkspace,
  Source,
  SourceDraft,
  SourceFile,
  SourceQuery,
  SearchIndexStatus,
  SearchResult,
  SearchResultType,
  SynthesisMemo,
  SynthesisMemoDraft,
  IntegrityReport,
  WorkspacePackageSummary,
  OcrResult,
  WorkspaceInfo
} from '../shared/domain'
import { WorkspaceDatabase } from './database'
import { exportLibrary, parseLibrary } from './interchange'
import {
  checkWorkspaceIntegrity,
  createWorkspacePackage,
  qualitativeCsv,
  restoreWorkspacePackage
} from './preservation'
import {
  analysisQuerySchema,
  documentPageTextSchema,
  evidenceExcerptDraftSchema,
  idSchema,
  interviewDraftSchema,
  manuscriptDraftSchema,
  manuscriptSectionSchema,
  manuscriptTraceSchema,
  projectDraftSchema,
  projectFilePathsSchema,
  projectGoalSchema,
  projectNoteSchema,
  revisionSuggestionStatusSchema,
  sourceDraftSchema,
  sourceQuerySchema,
  synthesisMemoDraftSchema,
  transcriptSegmentSchema
} from './validation'
import { recognizeEnglish } from './ocr-service'
import { extractManuscript } from './manuscript-import'
import type { Lesson, TeachingSource } from '../shared/teaching'
import { DiscoveryService } from './discovery-service'
import { TeachingService } from './teaching-service'
import { WorkspaceLifecycle } from './workspace-lifecycle'

export class WorkspaceService {
  private readonly lifecycle = new WorkspaceLifecycle()
  private readonly teaching = new TeachingService(() => this.requireDatabase())
  private readonly discovery = new DiscoveryService(() => this.requireDatabase())
  readonly teachingSettings = this.teaching.teachingSettings

  cancelTeachingSynthesis(): void {
    this.teaching.cancelTeachingSynthesis()
  }

  async synthesizeTeachingLesson(input: unknown): Promise<Lesson> {
    return this.teaching.synthesizeTeachingLesson(input)
  }
  listLessons(): Lesson[] {
    return this.teaching.listLessons()
  }

  saveLesson(input: unknown): Lesson {
    return this.teaching.saveLesson(input)
  }

  async importTeachingDocuments(): Promise<TeachingSource[]> {
    return this.teaching.importTeachingDocuments()
  }

  async exportLesson(input: unknown, format: unknown): Promise<boolean> {
    return this.teaching.exportLesson(input, format)
  }

  async choose(mode: 'create' | 'open'): Promise<WorkspaceInfo | null> {
    return this.lifecycle.choose(mode)
  }

  recent(): WorkspaceInfo | null {
    return this.lifecycle.recent()
  }

  close(): void {
    this.cancelTeachingSynthesis()
    this.lifecycle.close()
  }

  listSources(query?: SourceQuery): Source[] {
    return this.requireDatabase().listSources(sourceQuerySchema.parse(query))
  }

  getSource(id: string): Source {
    return this.requireDatabase().getSource(idSchema.parse(id))
  }

  saveSource(draft: SourceDraft): Source {
    return this.requireDatabase().saveSource(sourceDraftSchema.parse(draft))
  }

  removeSource(id: string): void {
    this.requireDatabase().removeSource(idSchema.parse(id))
  }

  async attachPdf(sourceId: string): Promise<SourceFile | null> {
    idSchema.parse(sourceId)
    const result = await dialog.showOpenDialog({
      title: 'Attach a PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return this.requireDatabase().attachPdf(sourceId, result.filePaths[0])
  }

  async openFile(fileId: string): Promise<void> {
    const error = await shell.openPath(this.requireDatabase().filePath(idSchema.parse(fileId)))
    if (error) throw new Error(`Could not open the PDF: ${error}`)
  }

  pdfData(fileId: string): Uint8Array {
    return this.requireDatabase().pdfData(idSchema.parse(fileId))
  }

  listDocumentPageSummaries(fileId: string): DocumentPageSummary[] {
    return this.requireDatabase().listDocumentPageSummaries(idSchema.parse(fileId))
  }

  listExcerpts(sourceId: string): EvidenceExcerpt[] {
    return this.requireDatabase().listExcerpts(idSchema.parse(sourceId))
  }

  saveExcerpt(draft: EvidenceExcerptDraft): EvidenceExcerpt {
    return this.requireDatabase().saveExcerpt(evidenceExcerptDraftSchema.parse(draft))
  }

  removeExcerpt(id: string): void {
    this.requireDatabase().removeExcerpt(idSchema.parse(id))
  }

  saveDocumentPageText(
    sourceFileId: string,
    page: number,
    text: string,
    method: DocumentPageText['extractionMethod'],
    confidence?: number
  ): DocumentPageText {
    const parsed = documentPageTextSchema.parse({
      sourceFileId,
      page,
      text,
      method,
      confidence
    })
    return this.requireDatabase().saveDocumentPageText(parsed)
  }

  getDocumentPageText(sourceFileId: string, page: number): DocumentPageText | null {
    return this.requireDatabase().getDocumentPageText(
      idSchema.parse(sourceFileId),
      documentPageTextSchema.shape.page.parse(page)
    )
  }

  async ocrPage(image: Uint8Array): Promise<OcrResult> {
    if (!(image instanceof Uint8Array)) throw new Error('OCR requires a local page image.')
    return recognizeEnglish(image)
  }

  listCodes(): QualitativeCode[] {
    return this.requireDatabase().listCodes()
  }

  listProjects(): ProjectSummary[] {
    return this.requireDatabase().listProjects()
  }

  getProject(id: string): ProjectDetail {
    return this.requireDatabase().getProject(idSchema.parse(id))
  }

  saveProject(draft: ProjectDraft): ProjectDetail {
    return this.requireDatabase().saveProject(projectDraftSchema.parse(draft))
  }

  removeProject(id: string): void {
    this.requireDatabase().removeProject(idSchema.parse(id))
  }

  assignProjectSource(projectId: string, sourceId: string, assigned: boolean): ProjectDetail {
    return this.requireDatabase().assignProjectSource(
      idSchema.parse(projectId),
      idSchema.parse(sourceId),
      Boolean(assigned)
    )
  }

  saveProjectGoal(
    projectId: string,
    goal: { id?: string; title: string; status: 'open' | 'complete'; targetDate: string | null }
  ): ProjectDetail {
    return this.requireDatabase().saveProjectGoal(
      idSchema.parse(projectId),
      projectGoalSchema.parse(goal)
    )
  }

  removeProjectGoal(id: string): void {
    this.requireDatabase().removeProjectGoal(idSchema.parse(id))
  }

  saveProjectNote(projectId: string, body: string): ProjectDetail {
    return this.requireDatabase().saveProjectNote(
      idSchema.parse(projectId),
      projectNoteSchema.parse(body)
    )
  }

  removeProjectNote(id: string): void {
    this.requireDatabase().removeProjectNote(idSchema.parse(id))
  }

  async importProjectFiles(projectId: string): Promise<ProjectFileImportSummary | null> {
    idSchema.parse(projectId)
    const result = await dialog.showOpenDialog({
      title: 'Import project source material',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported research documents', extensions: ['pdf', 'txt', 'md'] },
        { name: 'PDF documents', extensions: ['pdf'] },
        { name: 'Text documents', extensions: ['txt', 'md'] }
      ]
    })
    if (result.canceled || !result.filePaths.length) return null
    return this.requireDatabase().importProjectFiles(
      projectId,
      projectFilePathsSchema.parse(result.filePaths)
    )
  }

  importDroppedProjectFiles(projectId: string, paths: string[]): ProjectFileImportSummary {
    return this.requireDatabase().importProjectFiles(
      idSchema.parse(projectId),
      projectFilePathsSchema.parse(paths)
    )
  }

  async openProjectFile(fileId: string): Promise<void> {
    const error = await shell.openPath(
      this.requireDatabase().projectFilePath(idSchema.parse(fileId))
    )
    if (error) throw new Error(`Could not open the project file: ${error}`)
  }

  revealProjectFile(fileId: string): void {
    shell.showItemInFolder(this.requireDatabase().projectFilePath(idSchema.parse(fileId)))
  }

  removeProjectFile(projectId: string, fileId: string, deleteManagedCopy: boolean): ProjectDetail {
    return this.requireDatabase().removeProjectFile(
      idSchema.parse(projectId),
      idSchema.parse(fileId),
      Boolean(deleteManagedCopy)
    )
  }

  async exportProject(id: string): Promise<boolean> {
    const database = this.requireDatabase()
    const project = database.getProject(idSchema.parse(id))
    const safeName = [...project.title]
      .map((character) =>
        '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32 ? '-' : character
      )
      .join('')
      .slice(0, 100)
    const result = await dialog.showSaveDialog({
      title: 'Export project',
      defaultPath: `${safeName || 'research-project'}.research-studio.json`,
      filters: [{ name: 'Research Studio project', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(
      result.filePath,
      `${JSON.stringify(database.projectExport(project.id), null, 2)}\n`
    )
    return true
  }

  listManuscripts(projectId: string): Manuscript[] {
    return this.requireDatabase().listManuscripts(idSchema.parse(projectId))
  }

  getManuscript(id: string): Manuscript {
    return this.requireDatabase().getManuscript(idSchema.parse(id))
  }

  saveManuscript(
    projectId: string,
    draft: { id?: string; title: string; status: Manuscript['status'] }
  ): Manuscript {
    return this.requireDatabase().saveManuscript(
      idSchema.parse(projectId),
      manuscriptDraftSchema.parse(draft)
    )
  }

  async importManuscript(
    projectId: string
  ): Promise<{ manuscript: Manuscript; reviewerCommentsImported: number } | null> {
    idSchema.parse(projectId)
    const result = await dialog.showOpenDialog({
      title: 'Import a manuscript draft',
      properties: ['openFile'],
      filters: [
        {
          name: 'Supported manuscripts (PDF, Word, text, Markdown)',
          extensions: ['pdf', 'docx', 'txt', 'md']
        },
        { name: 'PDF documents (*.pdf)', extensions: ['pdf'] },
        { name: 'Word documents (*.docx)', extensions: ['docx'] },
        { name: 'Text and Markdown (*.txt, *.md)', extensions: ['txt', 'md'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const path = resolve(result.filePaths[0])
    const extension = extname(path).toLowerCase()
    if (!['.pdf', '.docx', '.txt', '.md'].includes(extension)) {
      throw new Error('Choose a PDF, DOCX, TXT, or Markdown manuscript.')
    }
    const maximumSize =
      extension === '.pdf'
        ? 50 * 1024 * 1024
        : extension === '.docx'
          ? 25 * 1024 * 1024
          : 10 * 1024 * 1024
    if (statSync(path).size > maximumSize) {
      throw new Error(
        extension === '.pdf'
          ? 'PDF manuscripts larger than 50 MB are not supported.'
          : extension === '.docx'
            ? 'Word manuscripts larger than 25 MB are not supported.'
            : 'Text manuscripts larger than 10 MB are not supported.'
      )
    }
    const parsed = await extractManuscript(path)
    const database = this.requireDatabase()
    const reviewerComments = parsed.reviewerComments ?? []
    return database.importManuscriptWithReviewNotes(
      projectId,
      parsed.title,
      parsed.sections,
      `${basename(path)} — inline annotations`,
      reviewerComments
    )
  }

  removeManuscript(id: string): void {
    this.requireDatabase().removeManuscript(idSchema.parse(id))
  }

  saveManuscriptSection(
    manuscriptId: string,
    section: { id?: string; title: string; content: string; position: number }
  ): Manuscript {
    return this.requireDatabase().saveManuscriptSection(
      idSchema.parse(manuscriptId),
      manuscriptSectionSchema.parse(section)
    )
  }

  removeManuscriptSection(id: string): void {
    this.requireDatabase().removeManuscriptSection(idSchema.parse(id))
  }

  addManuscriptTrace(
    sectionId: string,
    evidenceExcerptId: string | null,
    sourceId: string,
    marker: string
  ): ManuscriptSection {
    const parsed = manuscriptTraceSchema.parse({
      sectionId,
      evidenceExcerptId,
      sourceId,
      marker
    })
    return this.requireDatabase().addManuscriptTrace(
      parsed.sectionId,
      parsed.evidenceExcerptId,
      parsed.sourceId,
      parsed.marker
    )
  }

  async exportManuscript(id: string, format: 'markdown' | 'docx'): Promise<boolean> {
    if (format !== 'markdown' && format !== 'docx')
      throw new Error('Unsupported manuscript format.')
    const manuscript = this.requireDatabase().getManuscript(idSchema.parse(id))
    const safeName = [...manuscript.title]
      .map((character) =>
        '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32 ? '-' : character
      )
      .join('')
      .slice(0, 100)
    const extension = format === 'markdown' ? 'md' : 'docx'
    const result = await dialog.showSaveDialog({
      title: 'Export manuscript',
      defaultPath: `${safeName || 'manuscript'}.${extension}`,
      filters: [
        { name: format === 'markdown' ? 'Markdown' : 'Microsoft Word', extensions: [extension] }
      ]
    })
    if (result.canceled || !result.filePath) return false
    if (format === 'markdown') {
      writeFileSync(result.filePath, this.manuscriptMarkdown(manuscript), 'utf8')
    } else {
      const document = new Document({
        sections: [
          {
            children: [
              new Paragraph({ text: manuscript.title, heading: HeadingLevel.TITLE }),
              ...manuscript.sections.flatMap((section) => [
                new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }),
                ...section.content
                  .split(/\n{2,}/)
                  .map((text) => new Paragraph({ children: [new TextRun(text)] })),
                ...section.traces.map(
                  (trace) =>
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: `${trace.marker} ${trace.sourceTitle}${trace.page ? `, p. ${trace.page}` : ''}`,
                          italics: true
                        })
                      ]
                    })
                )
              ])
            ]
          }
        ]
      })
      writeFileSync(result.filePath, await Packer.toBuffer(document))
    }
    return true
  }

  getRevisionWorkspace(manuscriptId: string): RevisionWorkspace {
    return this.requireDatabase().getRevisionWorkspace(idSchema.parse(manuscriptId))
  }

  async importReviewerComments(manuscriptId: string): Promise<RevisionImportSummary | null> {
    idSchema.parse(manuscriptId)
    const result = await dialog.showOpenDialog({
      title: 'Import reviewer comments',
      properties: ['openFile'],
      filters: [{ name: 'Reviewer comments', extensions: ['txt', 'md'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const path = resolve(result.filePaths[0])
    const extension = extname(path).toLowerCase()
    if (extension !== '.txt' && extension !== '.md') {
      throw new Error('Reviewer comments must be a plain-text or Markdown file.')
    }
    const size = statSync(path).size
    if (size > 5 * 1024 * 1024) {
      throw new Error('Reviewer comment files larger than 5 MB are not supported.')
    }
    return this.requireDatabase().importReviewDocument(
      manuscriptId,
      basename(path),
      readFileSync(path, 'utf8')
    )
  }

  analyzeManuscriptRevision(manuscriptId: string): RevisionWorkspace {
    return this.requireDatabase().analyzeManuscriptRevision(idSchema.parse(manuscriptId))
  }

  setRevisionSuggestionStatus(
    suggestionId: string,
    status: RevisionSuggestionStatus
  ): RevisionWorkspace {
    return this.requireDatabase().setRevisionSuggestionStatus(
      idSchema.parse(suggestionId),
      revisionSuggestionStatusSchema.parse(status)
    )
  }

  removeReviewDocument(documentId: string): RevisionWorkspace {
    return this.requireDatabase().removeReviewDocument(idSchema.parse(documentId))
  }

  listInterviews(): Interview[] {
    return this.requireDatabase().listInterviews()
  }

  getInterview(id: string): Interview {
    return this.requireDatabase().getInterview(idSchema.parse(id))
  }

  saveInterview(draft: Parameters<WorkspaceDatabase['saveInterview']>[0]): Interview {
    return this.requireDatabase().saveInterview(interviewDraftSchema.parse(draft))
  }

  removeInterview(id: string): void {
    this.requireDatabase().removeInterview(idSchema.parse(id))
  }

  async attachInterviewMedia(id: string): Promise<InterviewMedia | null> {
    idSchema.parse(id)
    const result = await dialog.showOpenDialog({
      title: 'Attach local interview media',
      properties: ['openFile'],
      filters: [
        { name: 'Audio and video', extensions: ['mp3', 'wav', 'm4a', 'mp4', 'webm', 'ogg', 'flac'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return this.requireDatabase().attachInterviewMedia(id, result.filePaths[0])
  }

  async openInterviewMedia(id: string): Promise<void> {
    const error = await shell.openPath(
      this.requireDatabase().interviewMediaPath(idSchema.parse(id))
    )
    if (error) throw new Error(`Could not open the media file: ${error}`)
  }

  async importTranscript(id: string): Promise<Interview | null> {
    idSchema.parse(id)
    const result = await dialog.showOpenDialog({
      title: 'Import transcript text',
      properties: ['openFile'],
      filters: [{ name: 'Text transcripts', extensions: ['txt', 'md'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    if (statSync(path).size > 10 * 1024 * 1024)
      throw new Error('Transcript files larger than 10 MB are not supported.')
    return this.requireDatabase().importTranscript(id, readFileSync(path, 'utf8'))
  }

  saveTranscriptSegment(
    interviewId: string,
    segment: Parameters<WorkspaceDatabase['saveTranscriptSegment']>[1]
  ): Interview {
    return this.requireDatabase().saveTranscriptSegment(
      idSchema.parse(interviewId),
      transcriptSegmentSchema.parse(segment)
    )
  }

  removeTranscriptSegment(id: string): void {
    this.requireDatabase().removeTranscriptSegment(idSchema.parse(id))
  }

  analyzeInterviews(query: AnalysisQuery): AnalysisResult {
    return this.requireDatabase().analyzeInterviews(analysisQuerySchema.parse(query))
  }

  listSynthesisMemos(projectId: string | null): SynthesisMemo[] {
    return this.requireDatabase().listSynthesisMemos(
      projectId === null ? null : idSchema.parse(projectId)
    )
  }

  saveSynthesisMemo(draft: SynthesisMemoDraft): SynthesisMemo {
    return this.requireDatabase().saveSynthesisMemo(synthesisMemoDraftSchema.parse(draft))
  }

  removeSynthesisMemo(id: string): void {
    this.requireDatabase().removeSynthesisMemo(idSchema.parse(id))
  }

  async exportSynthesisMemo(id: string): Promise<boolean> {
    const memo = this.requireDatabase().getSynthesisMemo(idSchema.parse(id))
    const safeName = [...memo.title]
      .map((character) =>
        '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32 ? '-' : character
      )
      .join('')
      .slice(0, 100)
    const result = await dialog.showSaveDialog({
      title: 'Export synthesis memo',
      defaultPath: `${safeName || 'synthesis-memo'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return false
    const passages = memo.passages
      .map((passage, index) => {
        const timing =
          passage.startSeconds === null
            ? ''
            : `, ${passage.startSeconds}s${passage.endSeconds === null ? '' : `-${passage.endSeconds}s`}`
        const codes = passage.codes.map((code) => code.name).join(', ')
        return `### Evidence ${index + 1}: ${passage.interviewTitle}\n\n> ${passage.text.replace(/\n/g, '\n> ')}\n\n— ${passage.speaker} (${passage.participantName}${timing})${codes ? `  \nCodes: ${codes}` : ''}`
      })
      .join('\n\n')
    const markdown = `# ${memo.title}\n\nStatus: ${memo.status}  \nExported: ${new Date().toISOString()}\n\n## Analytic memo\n\n${memo.body || '_No analytic text yet._'}\n\n## Linked transcript evidence\n\n${passages || '_No passages linked._'}\n`
    writeFileSync(result.filePath, markdown, 'utf8')
    return true
  }

  checkIntegrity(): IntegrityReport {
    return checkWorkspaceIntegrity(this.requireDatabase())
  }

  async createBackup(): Promise<WorkspacePackageSummary | null> {
    const result = await dialog.showOpenDialog({
      title: 'Choose where to save the workspace backup',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return createWorkspacePackage(this.requireDatabase(), result.filePaths[0])
  }

  async restoreBackup(): Promise<WorkspaceInfo | null> {
    const packageResult = await dialog.showOpenDialog({
      title: 'Choose a Research Studio backup folder',
      properties: ['openDirectory']
    })
    if (packageResult.canceled || !packageResult.filePaths[0]) return null
    const destinationResult = await dialog.showOpenDialog({
      title: 'Choose an empty folder for the restored workspace',
      properties: ['openDirectory', 'createDirectory']
    })
    if (destinationResult.canceled || !destinationResult.filePaths[0]) return null
    const destination = destinationResult.filePaths[0]
    restoreWorkspacePackage(packageResult.filePaths[0], destination)
    return this.lifecycle.open(destination)
  }

  async exportQualitative(format: QualitativeExportFormat): Promise<number | null> {
    if (format !== 'json' && format !== 'csv')
      throw new Error('Unsupported qualitative export format.')
    const database = this.requireDatabase()
    const result = await dialog.showSaveDialog({
      title: 'Export qualitative research data',
      defaultPath: `${database.info().name}-qualitative.${format}`,
      filters: [
        {
          name: format === 'json' ? 'Research Studio JSON' : 'Comma-separated values',
          extensions: [format]
        }
      ]
    })
    if (result.canceled || !result.filePath) return null
    const interviews = database.listInterviews()
    const codes = database.listCodes()
    const memos = database.listSynthesisMemos(null)
    if (format === 'json') {
      writeFileSync(
        result.filePath,
        `${JSON.stringify(database.qualitativeExportData(), null, 2)}\n`,
        'utf8'
      )
    } else {
      writeFileSync(result.filePath, qualitativeCsv(interviews, codes, memos), 'utf8')
    }
    return (
      interviews.reduce((total, interview) => total + interview.segments.length + 1, 0) +
      codes.length +
      memos.length
    )
  }

  search(query: string, types?: SearchResultType[]): SearchResult[] {
    return this.discovery.search(query, types)
  }

  searchIndexStatus(): SearchIndexStatus {
    return this.discovery.searchIndexStatus()
  }

  rebuildSearchIndex(): SearchIndexStatus {
    return this.discovery.rebuildSearchIndex()
  }

  async importLibrary(): Promise<ImportSummary | null> {
    const result = await dialog.showOpenDialog({
      title: 'Import a citation library',
      properties: ['openFile'],
      filters: [
        { name: 'Citation libraries', extensions: ['json', 'bib', 'bibtex'] },
        { name: 'CSL JSON', extensions: ['json'] },
        { name: 'BibTeX', extensions: ['bib', 'bibtex'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    if (statSync(path).size > 20 * 1024 * 1024) {
      throw new Error('Citation libraries larger than 20 MB are not supported.')
    }
    const extension = extname(path).toLowerCase()
    const format: LibraryFormat = extension === '.json' ? 'csl-json' : 'bibtex'
    const drafts = parseLibrary(readFileSync(path, 'utf8'), format, basename(path)).map((draft) =>
      sourceDraftSchema.parse(draft)
    )
    const existing = this.requireDatabase().listSources()
    const seen = new Set(
      existing.map((source) => this.citationIdentity(source.title, source.year, source.doi))
    )
    let imported = 0
    let skipped = 0
    for (const draft of drafts) {
      const identity = this.citationIdentity(draft.title, draft.year, draft.doi)
      if (seen.has(identity)) {
        skipped += 1
        continue
      }
      this.requireDatabase().saveSource(draft)
      seen.add(identity)
      imported += 1
    }
    return { imported, skipped, fileName: basename(path) }
  }

  async exportLibrary(format: LibraryFormat): Promise<number | null> {
    if (format !== 'csl-json' && format !== 'bibtex') throw new Error('Unsupported export format.')
    const database = this.requireDatabase()
    const sources = database.listSources()
    const extension = format === 'csl-json' ? 'json' : 'bib'
    const result = await dialog.showSaveDialog({
      title: 'Export citation library',
      defaultPath: `${database.info().name}-sources.${extension}`,
      filters: [
        {
          name: format === 'csl-json' ? 'CSL JSON' : 'BibTeX',
          extensions: [extension]
        }
      ]
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, exportLibrary(sources, format), 'utf8')
    return sources.length
  }

  private requireDatabase(): WorkspaceDatabase {
    return this.lifecycle.requireDatabase()
  }

  private citationIdentity(title: string, year: number | null, doi: string | null): string {
    return doi
      ? `doi:${doi
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}`
      : `title:${title.trim().toLowerCase()}|year:${year ?? ''}`
  }

  private manuscriptMarkdown(manuscript: Manuscript): string {
    const sections = manuscript.sections
      .map((section) => {
        const traces = section.traces
          .map(
            (trace) =>
              `- ${trace.marker} ${trace.sourceTitle}${trace.page ? `, p. ${trace.page}` : ''}${trace.fileSha256 ? ` (PDF SHA-256: ${trace.fileSha256})` : ''}`
          )
          .join('\n')
        return `## ${section.title}\n\n${section.content}${traces ? `\n\n### Trace notes\n\n${traces}` : ''}`
      })
      .join('\n\n')
    return `# ${manuscript.title}\n\n${sections}\n`
  }
}
