import { createHash, randomUUID } from 'crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync
} from 'fs'
import { DatabaseSync } from 'node:sqlite'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep
} from 'path'
import type {
  AnalysisQuery,
  AnalysisResult,
  CodedPassage,
  DocumentPageText,
  DocumentPageSummary,
  EvidenceExcerpt,
  EvidenceExcerptDraft,
  Interview,
  InterviewMedia,
  Manuscript,
  ManuscriptSection,
  ManuscriptTrace,
  Person,
  ProjectDetail,
  ProjectDraft,
  ProjectFileImportSummary,
  ProjectGoal,
  ProjectManagedFile,
  ProjectNote,
  ProjectSummary,
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
  TranscriptSegment,
  WorkspaceInfo
} from '../shared/domain'
import { migrations } from './migrations'
import type { Lesson } from '../shared/teaching'
import {
  manuscriptRuleProposals,
  parseReviewerComments,
  reviewerCommentProposals,
  type RevisionProposal
} from './revision-analysis'

type Row = Record<string, string | number | null>
export type ManagedFileKind = 'source-file' | 'interview-media' | 'project-file'

export interface ManagedFileInventoryItem {
  kind: ManagedFileKind
  name: string
  relativePath: string
  byteSize: number
  sha256: string
}

function checksumFile(path: string): string {
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const descriptor = openSync(path, 'r')
  try {
    let bytesRead = 0
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead)
  } finally {
    closeSync(descriptor)
  }
  return hash.digest('hex')
}

export class WorkspaceDatabase {
  listLessons(): Lesson[] {
    return this.db
      .prepare('SELECT body FROM teaching_lessons ORDER BY updated_at DESC')
      .all()
      .map((row) => JSON.parse(String(row.body)) as Lesson)
  }

  saveLesson(lesson: Lesson): Lesson {
    this.db
      .prepare(
        'INSERT INTO teaching_lessons (id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at'
      )
      .run(lesson.id, JSON.stringify(lesson), new Date().toISOString())
    return lesson
  }

  private readonly db: DatabaseSync
  private readonly storageRoot: string

  constructor(
    readonly workspacePath: string,
    workspaceName = basename(workspacePath)
  ) {
    this.storageRoot = join(resolve(workspacePath), '.research-studio')
    mkdirSync(join(this.storageRoot, 'files'), { recursive: true })
    mkdirSync(join(this.storageRoot, 'interview-media'), { recursive: true })
    mkdirSync(join(this.storageRoot, 'project-files'), { recursive: true })
    this.db = new DatabaseSync(join(this.storageRoot, 'workspace.sqlite3'))
    try {
      this.db.exec('PRAGMA foreign_keys = ON')
      this.db.exec('PRAGMA journal_mode = WAL')
      this.migrate(workspaceName)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  close(): void {
    this.db.close()
  }

  info(): WorkspaceInfo {
    const workspace = this.db.prepare('SELECT * FROM workspace LIMIT 1').get() as Row
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM sources').get() as Row
    return {
      id: String(workspace.id),
      name: String(workspace.name),
      path: this.workspacePath,
      createdAt: String(workspace.created_at),
      sourceCount: Number(count.count)
    }
  }

  schemaVersion(): number {
    const row = this.db.prepare('SELECT schema_version FROM workspace LIMIT 1').get() as Row
    return Number(row.schema_version)
  }

  integrityCheck(): boolean {
    const rows = this.db.prepare('PRAGMA quick_check').all() as Row[]
    return rows.length === 1 && String(Object.values(rows[0])[0]).toLowerCase() === 'ok'
  }

  createSnapshot(targetPath: string): void {
    const target = resolve(targetPath)
    if (existsSync(target)) throw new Error('The snapshot destination already exists.')
    mkdirSync(dirname(target), { recursive: true })
    this.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  }

  managedFileInventory(): ManagedFileInventoryItem[] {
    const sourceFiles = this.db
      .prepare(
        'SELECT original_name, relative_path, byte_size, sha256 FROM source_files ORDER BY imported_at'
      )
      .all() as Row[]
    const interviewMedia = this.db
      .prepare(
        'SELECT original_name, relative_path, byte_size, sha256 FROM interview_media ORDER BY imported_at'
      )
      .all() as Row[]
    const projectFiles = this.db
      .prepare(
        'SELECT original_name, relative_path, byte_size, sha256 FROM project_managed_files ORDER BY imported_at'
      )
      .all() as Row[]
    return [
      ...sourceFiles.map((row) => ({
        kind: 'source-file' as const,
        name: String(row.original_name),
        relativePath: String(row.relative_path),
        byteSize: Number(row.byte_size),
        sha256: String(row.sha256)
      })),
      ...interviewMedia.map((row) => ({
        kind: 'interview-media' as const,
        name: String(row.original_name),
        relativePath: String(row.relative_path),
        byteSize: Number(row.byte_size),
        sha256: String(row.sha256)
      })),
      ...projectFiles.map((row) => ({
        kind: 'project-file' as const,
        name: String(row.original_name),
        relativePath: String(row.relative_path),
        byteSize: Number(row.byte_size),
        sha256: String(row.sha256)
      }))
    ]
  }

  resolveStoredFile(kind: ManagedFileKind, relativePath: string): string {
    if (kind === 'source-file') return this.resolveManagedPath(relativePath)
    if (kind === 'interview-media') return this.resolveInterviewMediaPath(relativePath)
    return this.resolveProjectFilePath(relativePath)
  }

  qualitativeExportData(): Record<string, unknown> {
    const interviews = this.listInterviews()
    return {
      format: 'research-studio-qualitative-data',
      version: 1,
      exportedAt: new Date().toISOString(),
      interviews,
      codes: this.listCodes(),
      synthesisMemos: this.listSynthesisMemos(null)
    }
  }

  listDocumentPageSummaries(sourceFileId: string): DocumentPageSummary[] {
    if (!this.db.prepare('SELECT id FROM source_files WHERE id = ?').get(sourceFileId)) {
      throw new Error('Attached PDF not found.')
    }
    const rows = this.db
      .prepare(
        `SELECT page_number, length(trim(text)) > 0 AS readable, extraction_method
       FROM document_pages WHERE source_file_id = ? ORDER BY page_number`
      )
      .all(sourceFileId) as Row[]
    return rows.map((row) => ({
      page: Number(row.page_number),
      readable: Boolean(row.readable),
      extractionMethod: row.extraction_method as DocumentPageSummary['extractionMethod']
    }))
  }

  saveDocumentPageText(input: {
    sourceFileId: string
    page: number
    text: string
    method: DocumentPageText['extractionMethod']
    confidence?: number
  }): DocumentPageText {
    const file = this.db
      .prepare('SELECT sha256 FROM source_files WHERE id = ?')
      .get(input.sourceFileId) as Row | undefined
    if (!file) throw new Error('Attached PDF not found.')
    const retained = this.getDocumentPageText(input.sourceFileId, input.page)
    // Empty extraction and reader visits must never erase previously recognized text.
    if (
      retained?.text.trim() &&
      (!input.text.trim() || (retained.extractionMethod === 'ocr' && input.method === 'pdf-text'))
    )
      return retained
    const existing = this.db
      .prepare(
        'SELECT id, extracted_at FROM document_pages WHERE source_file_id = ? AND page_number = ?'
      )
      .get(input.sourceFileId, input.page) as Row | undefined
    const id = existing ? String(existing.id) : randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO document_pages
           (id, source_file_id, page_number, text, extraction_method, language, confidence,
            file_sha256, extracted_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_file_id, page_number) DO UPDATE SET
             text=excluded.text, extraction_method=excluded.extraction_method,
             language=excluded.language, confidence=excluded.confidence,
             file_sha256=excluded.file_sha256, updated_at=excluded.updated_at`
      )
      .run(
        id,
        input.sourceFileId,
        input.page,
        input.text,
        input.method,
        input.method === 'ocr' ? 'eng' : null,
        input.confidence ?? null,
        file.sha256,
        existing?.extracted_at ?? now,
        now
      )
    return this.getDocumentPageText(input.sourceFileId, input.page)!
  }

  getDocumentPageText(sourceFileId: string, page: number): DocumentPageText | null {
    const row = this.db
      .prepare('SELECT * FROM document_pages WHERE source_file_id = ? AND page_number = ?')
      .get(sourceFileId, page) as Row | undefined
    if (!row) return null
    return {
      id: String(row.id),
      sourceFileId: String(row.source_file_id),
      page: Number(row.page_number),
      text: String(row.text),
      extractionMethod: row.extraction_method as DocumentPageText['extractionMethod'],
      language: row.language ? String(row.language) : null,
      confidence: row.confidence === null ? null : Number(row.confidence),
      fileSha256: String(row.file_sha256),
      extractedAt: String(row.extracted_at),
      updatedAt: String(row.updated_at)
    }
  }

  searchIndexStatus(): SearchIndexStatus {
    const state = this.db.prepare('SELECT * FROM search_index_state WHERE id = 1').get() as Row
    const pages = this.db
      .prepare(
        `SELECT COUNT(*) AS page_count,
            SUM(CASE WHEN extraction_method = 'ocr' THEN 1 ELSE 0 END) AS ocr_count
           FROM document_pages`
      )
      .get() as Row
    return {
      dirty: Boolean(state.dirty),
      indexedAt: state.indexed_at ? String(state.indexed_at) : null,
      itemCount: Number(state.item_count),
      pageCount: Number(pages.page_count),
      ocrPageCount: Number(pages.ocr_count ?? 0)
    }
  }

  rebuildSearchIndex(): SearchIndexStatus {
    const insert = this.db.prepare(
      `INSERT INTO search_index
         (entity_type, entity_id, parent_id, source_file_id, page, title, context, content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    let count = 0
    this.transaction(() => {
      this.db.exec('DELETE FROM search_index')
      for (const source of this.listSources()) {
        insert.run(
          'source',
          source.id,
          null,
          null,
          null,
          source.title,
          [source.authors.map((author) => author.displayName).join(', '), source.year]
            .filter(Boolean)
            .join(' · '),
          [
            source.title,
            source.authors.map((author) => author.displayName).join(' '),
            source.publicationTitle,
            source.publisher,
            source.abstract,
            source.notes,
            source.tags.join(' ')
          ]
            .filter(Boolean)
            .join('\n')
        )
        count += 1
      }
      const pages = this.db
        .prepare(
          `SELECT dp.*, sf.source_id, s.title AS source_title
             FROM document_pages dp
             JOIN source_files sf ON sf.id = dp.source_file_id
             JOIN sources s ON s.id = sf.source_id
             WHERE length(trim(dp.text)) > 0`
        )
        .all() as Row[]
      for (const page of pages) {
        insert.run(
          'pdf-page',
          page.id,
          page.source_id,
          page.source_file_id,
          page.page_number,
          page.source_title,
          `PDF page ${page.page_number} · ${page.extraction_method}`,
          page.text
        )
        count += 1
      }
      const evidence = this.db
        .prepare(
          `SELECT e.*, s.title AS source_title
             FROM evidence_excerpts e JOIN sources s ON s.id = e.source_id`
        )
        .all() as Row[]
      for (const item of evidence) {
        const locator = JSON.parse(String(item.locator_json)) as { page?: number }
        insert.run(
          'evidence',
          item.id,
          item.source_id,
          item.source_file_id,
          locator.page ?? null,
          item.source_title,
          `Evidence excerpt${locator.page ? ` · page ${locator.page}` : ''}`,
          [item.text, item.note].filter(Boolean).join('\n')
        )
        count += 1
      }
      const segments = this.db
        .prepare(
          `SELECT ts.*, i.id AS interview_id, i.title AS interview_title, i.participant_name
             FROM transcript_segments ts
             JOIN transcripts tr ON tr.id = ts.transcript_id
             JOIN interviews i ON i.id = tr.interview_id`
        )
        .all() as Row[]
      for (const segment of segments) {
        insert.run(
          'transcript',
          segment.id,
          segment.interview_id,
          null,
          null,
          segment.interview_title,
          `${segment.speaker} · ${segment.participant_name}`,
          segment.text
        )
        count += 1
      }
      const memos = this.db.prepare('SELECT * FROM synthesis_memos').all() as Row[]
      for (const memo of memos) {
        insert.run(
          'memo',
          memo.id,
          memo.project_id,
          null,
          null,
          memo.title,
          `Synthesis memo · ${memo.status}`,
          memo.body
        )
        count += 1
      }
      const sections = this.db
        .prepare(
          `SELECT ms.*, m.title AS manuscript_title
             FROM manuscript_sections ms JOIN manuscripts m ON m.id = ms.manuscript_id`
        )
        .all() as Row[]
      for (const section of sections) {
        insert.run(
          'manuscript',
          section.id,
          section.manuscript_id,
          null,
          null,
          section.manuscript_title,
          `Manuscript section · ${section.title}`,
          section.content
        )
        count += 1
      }
      this.db
        .prepare(
          'UPDATE search_index_state SET dirty = 0, indexed_at = ?, item_count = ? WHERE id = 1'
        )
        .run(new Date().toISOString(), count)
    })
    return this.searchIndexStatus()
  }

  search(query: string, types?: SearchResultType[]): SearchResult[] {
    if (this.searchIndexStatus().dirty) this.rebuildSearchIndex()
    const tokens = query.match(/[\p{L}\p{N}]+/gu) ?? []
    if (!tokens.length) return []
    const ftsQuery = tokens
      .slice(0, 20)
      .map((token) => `"${token.replace(/"/g, '""')}"*`)
      .join(' AND ')
    const typeClause = types?.length
      ? `AND entity_type IN (${types.map(() => '?').join(', ')})`
      : ''
    const rows = this.db
      .prepare(
        `SELECT entity_type, entity_id, parent_id, source_file_id, page, title, context,
            snippet(search_index, 7, '‹', '›', ' … ', 24) AS result_snippet,
            bm25(search_index, 0, 0, 0, 0, 4.0, 1.5, 1.0) AS score
           FROM search_index
           WHERE search_index MATCH ? ${typeClause}
           ORDER BY score LIMIT 100`
      )
      .all(ftsQuery, ...(types ?? [])) as Row[]
    return rows.map((row) => ({
      type: row.entity_type as SearchResultType,
      entityId: String(row.entity_id),
      parentId: row.parent_id ? String(row.parent_id) : null,
      sourceFileId: row.source_file_id ? String(row.source_file_id) : null,
      page: row.page === null ? null : Number(row.page),
      title: String(row.title),
      context: String(row.context),
      snippet: String(row.result_snippet),
      score: Number(row.score)
    }))
  }

  listSources(query: SourceQuery = {}): Source[] {
    const clauses: string[] = []
    const values: string[] = []
    if (query.search) {
      clauses.push(`(
        s.title LIKE ? ESCAPE '\\' OR s.publication_title LIKE ? ESCAPE '\\'
        OR s.doi LIKE ? ESCAPE '\\' OR s.notes LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM source_people sp JOIN people p ON p.id = sp.person_id
          WHERE sp.source_id = s.id AND p.display_name LIKE ? ESCAPE '\\'
        )
        OR EXISTS (
          SELECT 1 FROM source_tags st JOIN tags t ON t.id = st.tag_id
          WHERE st.source_id = s.id AND t.name LIKE ? ESCAPE '\\'
        )
      )`)
      const escaped = query.search.replace(/[\\%_]/g, '\\$&')
      values.push(...Array(6).fill(`%${escaped}%`))
    }
    if (query.sourceType && query.sourceType !== 'all') {
      clauses.push('s.source_type = ?')
      values.push(query.sourceType)
    }
    if (query.status && query.status !== 'all') {
      clauses.push('s.status = ?')
      values.push(query.status)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db
      .prepare(
        `SELECT s.* FROM sources s ${where} ORDER BY s.updated_at DESC, s.title COLLATE NOCASE`
      )
      .all(...values) as Row[]
    return rows.map((row) => this.hydrateSource(row))
  }

  getSource(id: string): Source {
    const row = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error('Source not found.')
    return this.hydrateSource(row)
  }

  saveSource(draft: SourceDraft): Source {
    const now = new Date().toISOString()
    const id = draft.id ?? randomUUID()
    const existing = draft.id
      ? (this.db.prepare('SELECT created_at FROM sources WHERE id = ?').get(id) as Row | undefined)
      : undefined
    if (draft.id && !existing) throw new Error('The source you tried to edit no longer exists.')

    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO sources (
            id, title, source_type, status, year, publication_title, publisher, doi, url,
            abstract, notes, origin, provenance_note, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, source_type=excluded.source_type, status=excluded.status,
            year=excluded.year, publication_title=excluded.publication_title,
            publisher=excluded.publisher, doi=excluded.doi, url=excluded.url,
            abstract=excluded.abstract, notes=excluded.notes, origin=excluded.origin,
            provenance_note=excluded.provenance_note, updated_at=excluded.updated_at`
        )
        .run(
          id,
          draft.title,
          draft.sourceType,
          draft.status,
          draft.year,
          draft.publicationTitle,
          draft.publisher,
          draft.doi,
          draft.url,
          draft.abstract,
          draft.notes,
          draft.origin,
          draft.provenanceNote,
          existing?.created_at ?? now,
          now
        )

      this.db.prepare('DELETE FROM source_people WHERE source_id = ?').run(id)
      const insertPerson = this.db.prepare(
        'INSERT INTO people (id, display_name, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      const linkPerson = this.db.prepare(
        'INSERT INTO source_people (source_id, person_id, role, position) VALUES (?, ?, ?, ?)'
      )
      draft.authors.forEach((displayName, position) => {
        const personId = randomUUID()
        insertPerson.run(personId, displayName, draft.origin, now, now)
        linkPerson.run(id, personId, 'author', position)
      })
      this.db
        .prepare('DELETE FROM people WHERE id NOT IN (SELECT person_id FROM source_people)')
        .run()

      this.db.prepare('DELETE FROM source_tags WHERE source_id = ?').run(id)
      const findTag = this.db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE')
      const insertTag = this.db.prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)')
      const linkTag = this.db.prepare('INSERT INTO source_tags (source_id, tag_id) VALUES (?, ?)')
      for (const name of [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))]) {
        const found = findTag.get(name) as Row | undefined
        const tagId = found ? String(found.id) : randomUUID()
        if (!found) insertTag.run(tagId, name, now)
        linkTag.run(id, tagId)
      }
      this.db.prepare('UPDATE workspace SET updated_at = ?').run(now)
    })

    return this.getSource(id)
  }

  removeSource(id: string): void {
    const trace = this.db
      .prepare('SELECT id FROM manuscript_traces WHERE source_id = ? LIMIT 1')
      .get(id)
    if (trace) {
      throw new Error(
        'This source is cited by a manuscript. Remove its manuscript trace before deleting it.'
      )
    }
    const annotation = this.db
      .prepare('SELECT id FROM annotations WHERE source_id = ? LIMIT 1')
      .get(id)
    if (annotation) {
      throw new Error('This source has linked annotations and cannot be deleted yet.')
    }
    const paths = this.db
      .prepare('SELECT relative_path FROM source_files WHERE source_id = ?')
      .all(id) as Row[]
    this.transaction(() => {
      this.db.prepare('DELETE FROM evidence_excerpts WHERE source_id = ?').run(id)
      const result = this.db.prepare('DELETE FROM sources WHERE id = ?').run(id)
      if (!result.changes) throw new Error('Source not found.')
      this.db
        .prepare('DELETE FROM people WHERE id NOT IN (SELECT person_id FROM source_people)')
        .run()
    })
    for (const row of paths) {
      const path = this.resolveManagedPath(String(row.relative_path))
      if (existsSync(path)) {
        try {
          unlinkSync(path)
        } catch (error) {
          console.error(
            `Source deleted, but its retired managed file could not be removed: ${path}`,
            error
          )
        }
      }
    }
  }

  attachPdf(sourceId: string, inputPath: string): SourceFile {
    this.getSource(sourceId)
    if (extname(inputPath).toLowerCase() !== '.pdf')
      throw new Error('Only PDF files can be attached.')
    const input = resolve(inputPath)
    if (!existsSync(input) || !statSync(input).isFile())
      throw new Error('The selected PDF is unavailable.')
    const id = randomUUID()
    const target = join(this.storageRoot, 'files', `${id}.pdf`)
    copyFileSync(input, target)
    const bytes = readFileSync(target)
    const record: SourceFile = {
      id,
      sourceId,
      originalName: basename(input),
      relativePath: normalize(relative(this.storageRoot, target)),
      mediaType: 'application/pdf',
      byteSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      importedAt: new Date().toISOString()
    }
    this.db
      .prepare(
        `INSERT INTO source_files
        (id, source_id, original_name, relative_path, media_type, byte_size, sha256, imported_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.sourceId,
        record.originalName,
        record.relativePath,
        record.mediaType,
        record.byteSize,
        record.sha256,
        record.importedAt
      )
    return record
  }

  filePath(fileId: string): string {
    const row = this.db
      .prepare('SELECT relative_path FROM source_files WHERE id = ?')
      .get(fileId) as Row | undefined
    if (!row) throw new Error('Attached file not found.')
    const candidate = this.resolveManagedPath(String(row.relative_path))
    if (!existsSync(candidate)) throw new Error('The attached file is missing from this workspace.')
    return candidate
  }

  pdfData(fileId: string): Uint8Array {
    const path = this.filePath(fileId)
    const size = statSync(path).size
    if (size > 100 * 1024 * 1024) {
      throw new Error('PDFs larger than 100 MB cannot be opened in the reader.')
    }
    const bytes = readFileSync(path)
    const file = this.db.prepare('SELECT sha256 FROM source_files WHERE id = ?').get(fileId) as Row
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error(
        'The managed PDF has changed. Restore the original copy or attach it as a new file before reading or preparing it.'
      )
    }
    return new Uint8Array(bytes)
  }

  listExcerpts(sourceId: string): EvidenceExcerpt[] {
    const rows = this.db
      .prepare(
        `SELECT e.*, f.original_name, f.sha256
         FROM evidence_excerpts e
         JOIN source_files f ON f.id = e.source_file_id
         WHERE e.source_id = ?
         ORDER BY e.created_at DESC`
      )
      .all(sourceId) as Row[]
    return rows.map((row) => this.hydrateExcerpt(row))
  }

  saveExcerpt(draft: EvidenceExcerptDraft): EvidenceExcerpt {
    const file = this.db
      .prepare('SELECT * FROM source_files WHERE id = ? AND source_id = ?')
      .get(draft.sourceFileId, draft.sourceId) as Row | undefined
    if (!file) throw new Error('The PDF is not attached to this source.')
    const id = randomUUID()
    const now = new Date().toISOString()
    const locator = JSON.stringify({ page: draft.page })
    const provenance = JSON.stringify({
      sourceFileId: draft.sourceFileId,
      fileName: file.original_name,
      sha256: file.sha256,
      capturedAt: now,
      method: 'user-selection'
    })
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO evidence_excerpts
          (id, source_id, source_file_id, text, note, locator_json, provenance_json, origin, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?, ?)`
        )
        .run(
          id,
          draft.sourceId,
          draft.sourceFileId,
          draft.text,
          draft.note,
          locator,
          provenance,
          now,
          now
        )
      const findCode = this.db.prepare(
        'SELECT id FROM qualitative_codes WHERE project_id IS NULL AND name = ? COLLATE NOCASE'
      )
      const insertCode = this.db.prepare(
        `INSERT INTO qualitative_codes
        (id, project_id, name, description, color, created_at, updated_at)
        VALUES (?, NULL, ?, NULL, NULL, ?, ?)`
      )
      const linkCode = this.db.prepare(
        'INSERT INTO evidence_excerpt_codes (excerpt_id, code_id) VALUES (?, ?)'
      )
      for (const name of [
        ...new Set(draft.codeNames.map((value) => value.trim()).filter(Boolean))
      ]) {
        const existing = findCode.get(name) as Row | undefined
        const codeId = existing ? String(existing.id) : randomUUID()
        if (!existing) insertCode.run(codeId, name, now, now)
        linkCode.run(id, codeId)
      }
    })
    const row = this.db
      .prepare(
        `SELECT e.*, f.original_name, f.sha256 FROM evidence_excerpts e
         JOIN source_files f ON f.id = e.source_file_id WHERE e.id = ?`
      )
      .get(id) as Row
    return this.hydrateExcerpt(row)
  }

  removeExcerpt(id: string): void {
    const result = this.db.prepare('DELETE FROM evidence_excerpts WHERE id = ?').run(id)
    if (!result.changes) throw new Error('Evidence excerpt not found.')
  }

  listCodes(): QualitativeCode[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, color FROM qualitative_codes
         WHERE project_id IS NULL ORDER BY name COLLATE NOCASE`
      )
      .all() as Row[]
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      color: row.color ? String(row.color) : null
    }))
  }

  listProjects(): ProjectSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.*,
          (SELECT COUNT(*) FROM project_sources ps WHERE ps.project_id = p.id) AS source_count,
          (SELECT COUNT(*) FROM evidence_excerpts e JOIN project_sources ps ON ps.source_id = e.source_id
            WHERE ps.project_id = p.id) AS evidence_count,
          (SELECT COUNT(*) FROM goals g WHERE g.project_id = p.id AND g.status = 'open') AS open_goal_count
         FROM projects p ORDER BY p.updated_at DESC, p.title COLLATE NOCASE`
      )
      .all() as Row[]
    return rows.map((row) => this.hydrateProjectSummary(row))
  }

  getProject(id: string): ProjectDetail {
    const row = this.db
      .prepare(
        `SELECT p.*,
          (SELECT COUNT(*) FROM project_sources ps WHERE ps.project_id = p.id) AS source_count,
          (SELECT COUNT(*) FROM evidence_excerpts e JOIN project_sources ps ON ps.source_id = e.source_id
            WHERE ps.project_id = p.id) AS evidence_count,
          (SELECT COUNT(*) FROM goals g WHERE g.project_id = p.id AND g.status = 'open') AS open_goal_count
         FROM projects p WHERE p.id = ?`
      )
      .get(id) as Row | undefined
    if (!row) throw new Error('Project not found.')
    const sourceIds = this.db
      .prepare('SELECT source_id FROM project_sources WHERE project_id = ? ORDER BY added_at')
      .all(id) as Row[]
    const goals = this.db
      .prepare('SELECT * FROM goals WHERE project_id = ? ORDER BY status, created_at DESC')
      .all(id) as Row[]
    const notes = this.db
      .prepare('SELECT * FROM project_notes WHERE project_id = ? ORDER BY created_at DESC')
      .all(id) as Row[]
    const evidence = this.db
      .prepare(
        `SELECT e.*, f.original_name, f.sha256, s.title AS source_title
         FROM evidence_excerpts e
         JOIN project_sources ps ON ps.source_id = e.source_id
         JOIN sources s ON s.id = e.source_id
         JOIN source_files f ON f.id = e.source_file_id
         WHERE ps.project_id = ? ORDER BY e.created_at DESC`
      )
      .all(id) as Row[]
    const files = this.db
      .prepare(
        `SELECT f.*,
          (SELECT COUNT(*) FROM project_file_links links WHERE links.file_id = f.id) AS link_count
         FROM project_managed_files f
         JOIN project_file_links link ON link.file_id = f.id
         WHERE link.project_id = ? ORDER BY link.linked_at DESC`
      )
      .all(id) as Row[]
    return {
      ...this.hydrateProjectSummary(row),
      sourceIds: sourceIds.map((item) => String(item.source_id)),
      goals: goals.map((goal) => this.hydrateGoal(goal)),
      notes: notes.map((note): ProjectNote => ({
        id: String(note.id),
        projectId: String(note.project_id),
        body: String(note.body),
        createdAt: String(note.created_at),
        updatedAt: String(note.updated_at)
      })),
      evidence: evidence.map((item) => ({
        ...this.hydrateExcerpt(item),
        sourceTitle: String(item.source_title)
      })),
      files: files.map((file) => this.hydrateProjectFile(file))
    }
  }

  saveProject(draft: ProjectDraft): ProjectDetail {
    const id = draft.id ?? randomUUID()
    const now = new Date().toISOString()
    const existing = draft.id
      ? (this.db.prepare('SELECT created_at FROM projects WHERE id = ?').get(id) as Row | undefined)
      : undefined
    if (draft.id && !existing) throw new Error('The project you tried to edit no longer exists.')
    this.db
      .prepare(
        `INSERT INTO projects
        (id, title, description, research_question, status, origin, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'user', ?, ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
          research_question=excluded.research_question, status=excluded.status,
          updated_at=excluded.updated_at`
      )
      .run(
        id,
        draft.title,
        draft.description,
        draft.researchQuestion,
        draft.status,
        existing?.created_at ?? now,
        now
      )
    return this.getProject(id)
  }

  removeProject(id: string): void {
    this.transaction(() => {
      this.db.prepare('UPDATE interviews SET project_id = NULL WHERE project_id = ?').run(id)
      this.db.prepare('DELETE FROM goals WHERE project_id = ?').run(id)
      const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      if (!result.changes) throw new Error('Project not found.')
    })
  }

  assignProjectSource(projectId: string, sourceId: string, assigned: boolean): ProjectDetail {
    this.getProject(projectId)
    this.getSource(sourceId)
    if (assigned) {
      this.db
        .prepare(
          'INSERT OR IGNORE INTO project_sources (project_id, source_id, added_at) VALUES (?, ?, ?)'
        )
        .run(projectId, sourceId, new Date().toISOString())
    } else {
      this.db
        .prepare('DELETE FROM project_sources WHERE project_id = ? AND source_id = ?')
        .run(projectId, sourceId)
    }
    this.touchProject(projectId)
    return this.getProject(projectId)
  }

  saveProjectGoal(
    projectId: string,
    goal: { id?: string; title: string; status: 'open' | 'complete'; targetDate: string | null }
  ): ProjectDetail {
    this.getProject(projectId)
    const id = goal.id ?? randomUUID()
    const now = new Date().toISOString()
    const existing = goal.id
      ? (this.db
          .prepare('SELECT created_at FROM goals WHERE id = ? AND project_id = ?')
          .get(id, projectId) as Row | undefined)
      : undefined
    if (goal.id && !existing) throw new Error('Project goal not found.')
    this.db
      .prepare(
        `INSERT INTO goals
        (id, project_id, title, horizon, status, target_date, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, status=excluded.status,
          target_date=excluded.target_date, updated_at=excluded.updated_at`
      )
      .run(
        id,
        projectId,
        goal.title,
        goal.status,
        goal.targetDate,
        existing?.created_at ?? now,
        now
      )
    this.touchProject(projectId)
    return this.getProject(projectId)
  }

  removeProjectGoal(id: string): void {
    const row = this.db.prepare('SELECT project_id FROM goals WHERE id = ?').get(id) as
      Row | undefined
    if (!row) throw new Error('Project goal not found.')
    this.db.prepare('DELETE FROM goals WHERE id = ?').run(id)
    this.touchProject(String(row.project_id))
  }

  saveProjectNote(projectId: string, body: string): ProjectDetail {
    this.getProject(projectId)
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO project_notes (id, project_id, body, origin, created_at, updated_at)
         VALUES (?, ?, ?, 'user', ?, ?)`
      )
      .run(randomUUID(), projectId, body, now, now)
    this.touchProject(projectId)
    return this.getProject(projectId)
  }

  removeProjectNote(id: string): void {
    const row = this.db.prepare('SELECT project_id FROM project_notes WHERE id = ?').get(id) as
      Row | undefined
    if (!row) throw new Error('Project note not found.')
    this.db.prepare('DELETE FROM project_notes WHERE id = ?').run(id)
    this.touchProject(String(row.project_id))
  }

  importProjectFiles(projectId: string, inputPaths: string[]): ProjectFileImportSummary {
    this.getProject(projectId)
    const mediaTypes: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.md': 'text/markdown'
    }
    const inputs = inputPaths.map((inputPath) => {
      if (!isAbsolute(inputPath)) throw new Error('Project file paths must be absolute.')
      const input = resolve(inputPath)
      if (!existsSync(input) || !statSync(input).isFile()) {
        throw new Error(`The selected file is unavailable: ${basename(input)}`)
      }
      const extension = extname(input).toLowerCase()
      const mediaType = mediaTypes[extension]
      if (!mediaType) {
        throw new Error('Project files must be PDF, plain text, or Markdown documents.')
      }
      return {
        input,
        inputSize: statSync(input).size,
        extension,
        mediaType,
        sha256: checksumFile(input)
      }
    })
    let imported = 0
    let linkedExisting = 0
    let duplicates = 0
    for (const { input, inputSize, extension, mediaType, sha256 } of inputs) {
      const existing = this.db
        .prepare('SELECT id, relative_path FROM project_managed_files WHERE sha256 = ?')
        .get(sha256) as Row | undefined
      if (existing) {
        const existingPath = this.resolveProjectFilePath(String(existing.relative_path))
        if (!existsSync(existingPath)) {
          throw new Error(`The managed copy of ${basename(input)} is missing.`)
        }
        if (statSync(existingPath).size !== inputSize || checksumFile(existingPath) !== sha256) {
          throw new Error(
            `The managed copy of ${basename(input)} has changed. Resolve it in Preservation before importing.`
          )
        }
        const result = this.db
          .prepare(
            'INSERT OR IGNORE INTO project_file_links (project_id, file_id, linked_at) VALUES (?, ?, ?)'
          )
          .run(projectId, String(existing.id), new Date().toISOString())
        if (result.changes) linkedExisting += 1
        else duplicates += 1
        continue
      }
      const id = randomUUID()
      const directory = join(this.storageRoot, 'project-files', projectId)
      mkdirSync(directory, { recursive: true })
      const stem =
        [...basename(input, extension)]
          .map((character) =>
            '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32 ? '-' : character
          )
          .join('')
          .replace(/[. ]+$/g, '')
          .slice(0, 100) || 'document'
      const target = join(directory, `${id}-${stem}${extension}`)
      copyFileSync(input, target)
      try {
        const now = new Date().toISOString()
        this.transaction(() => {
          this.db
            .prepare(
              `INSERT INTO project_managed_files
              (id, owner_project_id, original_name, original_path, relative_path, media_type,
               extension, byte_size, sha256, imported_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              id,
              projectId,
              basename(input),
              input,
              normalize(relative(this.storageRoot, target)),
              mediaType,
              extension.slice(1),
              inputSize,
              sha256,
              now
            )
          this.db
            .prepare(
              'INSERT INTO project_file_links (project_id, file_id, linked_at) VALUES (?, ?, ?)'
            )
            .run(projectId, id, now)
        })
      } catch (error) {
        if (existsSync(target)) unlinkSync(target)
        throw error
      }
      imported += 1
    }
    if (imported || linkedExisting) this.touchProject(projectId)
    return { project: this.getProject(projectId), imported, linkedExisting, duplicates }
  }

  projectFilePath(fileId: string): string {
    const row = this.db
      .prepare('SELECT relative_path FROM project_managed_files WHERE id = ?')
      .get(fileId) as Row | undefined
    if (!row) throw new Error('Project file not found.')
    const path = this.resolveProjectFilePath(String(row.relative_path))
    if (!existsSync(path)) throw new Error('The managed project file is missing.')
    return path
  }

  removeProjectFile(projectId: string, fileId: string, deleteManagedCopy: boolean): ProjectDetail {
    const row = this.db
      .prepare(
        `SELECT f.relative_path FROM project_managed_files f
         JOIN project_file_links link ON link.file_id = f.id
         WHERE link.project_id = ? AND f.id = ?`
      )
      .get(projectId, fileId) as Row | undefined
    if (!row) throw new Error('This file is not linked to the project.')
    if (deleteManagedCopy) {
      this.db.prepare('DELETE FROM project_managed_files WHERE id = ?').run(fileId)
      const path = this.resolveProjectFilePath(String(row.relative_path))
      if (existsSync(path)) {
        try {
          unlinkSync(path)
        } catch (error) {
          console.error(
            `Project file record deleted, but its retired managed copy could not be removed: ${path}`,
            error
          )
        }
      }
    } else {
      this.db
        .prepare('DELETE FROM project_file_links WHERE project_id = ? AND file_id = ?')
        .run(projectId, fileId)
    }
    this.touchProject(projectId)
    return this.getProject(projectId)
  }

  projectExport(id: string): Record<string, unknown> {
    const project = this.getProject(id)
    const sources = project.sourceIds.map((sourceId) => this.getSource(sourceId))
    const manuscripts = this.listManuscripts(id).map((manuscript) => ({
      ...manuscript,
      revisions: this.getRevisionWorkspace(manuscript.id)
    }))
    return {
      format: 'research-studio-project',
      version: 2,
      exportedAt: new Date().toISOString(),
      project,
      sources,
      manuscripts
    }
  }

  listManuscripts(projectId: string): Manuscript[] {
    this.getProject(projectId)
    const rows = this.db
      .prepare('SELECT * FROM manuscripts WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as Row[]
    return rows.map((row) => this.hydrateManuscript(row))
  }

  getManuscript(id: string): Manuscript {
    const row = this.db.prepare('SELECT * FROM manuscripts WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error('Manuscript not found.')
    return this.hydrateManuscript(row)
  }

  saveManuscript(
    projectId: string,
    draft: { id?: string; title: string; status: Manuscript['status'] }
  ): Manuscript {
    this.getProject(projectId)
    const id = draft.id ?? randomUUID()
    const now = new Date().toISOString()
    const existing = draft.id
      ? (this.db
          .prepare('SELECT created_at FROM manuscripts WHERE id = ? AND project_id = ?')
          .get(id, projectId) as Row | undefined)
      : undefined
    if (draft.id && !existing) throw new Error('Manuscript not found.')
    this.db
      .prepare(
        `INSERT INTO manuscripts (id, project_id, title, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title, status=excluded.status,
             updated_at=excluded.updated_at`
      )
      .run(id, projectId, draft.title, draft.status, existing?.created_at ?? now, now)
    if (!draft.id) {
      this.db
        .prepare(
          `INSERT INTO manuscript_sections
             (id, manuscript_id, title, content, position, created_at, updated_at)
             VALUES (?, ?, 'Introduction', '', 0, ?, ?)`
        )
        .run(randomUUID(), id, now, now)
    }
    return this.getManuscript(id)
  }

  importManuscript(
    projectId: string,
    title: string,
    sections: Array<{ title: string; content: string }>
  ): Manuscript {
    this.getProject(projectId)
    const id = randomUUID()
    const now = new Date().toISOString()
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO manuscripts (id, project_id, title, status, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?)`
        )
        .run(id, projectId, title, now, now)
      const insert = this.db.prepare(
        `INSERT INTO manuscript_sections
         (id, manuscript_id, title, content, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      sections.forEach((section, position) =>
        insert.run(randomUUID(), id, section.title, section.content, position, now, now)
      )
    })
    return this.getManuscript(id)
  }

  importManuscriptWithReviewNotes(
    projectId: string,
    title: string,
    sections: Array<{ title: string; content: string }>,
    originalName: string,
    comments: string[]
  ): { manuscript: Manuscript; reviewerCommentsImported: number } {
    this.getProject(projectId)
    const manuscriptId = randomUUID()
    const now = new Date().toISOString()
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO manuscripts (id, project_id, title, status, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?)`
        )
        .run(manuscriptId, projectId, title, now, now)
      const insertSection = this.db.prepare(
        `INSERT INTO manuscript_sections
         (id, manuscript_id, title, content, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      sections.forEach((section, position) =>
        insertSection.run(
          randomUUID(),
          manuscriptId,
          section.title,
          section.content,
          position,
          now,
          now
        )
      )
      if (!comments.length) return
      const content = comments.map((comment) => `- ${comment}`).join('\n')
      const sha256 = createHash('sha256').update(content).digest('hex')
      const documentId = randomUUID()
      const manuscript = this.getManuscript(manuscriptId)
      const proposals = reviewerCommentProposals(manuscript, comments, sha256)
      this.db
        .prepare(
          `INSERT INTO review_documents
           (id, manuscript_id, original_name, content, sha256, imported_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(documentId, manuscriptId, originalName, content, sha256, now)
      comments.forEach((comment, position) => {
        const commentId = randomUUID()
        const proposal = proposals[position]
        this.db
          .prepare(
            `INSERT INTO reviewer_comments
             (id, review_document_id, manuscript_id, position, body, category, section_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            commentId,
            documentId,
            manuscriptId,
            position,
            comment,
            proposal.category,
            proposal.sectionId,
            now
          )
        this.insertRevisionProposal(manuscriptId, proposal, commentId, now)
      })
    })
    return {
      manuscript: this.getManuscript(manuscriptId),
      reviewerCommentsImported: comments.length
    }
  }

  removeManuscript(id: string): void {
    const result = this.db.prepare('DELETE FROM manuscripts WHERE id = ?').run(id)
    if (!result.changes) throw new Error('Manuscript not found.')
  }

  saveManuscriptSection(
    manuscriptId: string,
    section: { id?: string; title: string; content: string; position: number }
  ): Manuscript {
    this.getManuscript(manuscriptId)
    const id = section.id ?? randomUUID()
    const now = new Date().toISOString()
    const existing = section.id
      ? (this.db
          .prepare('SELECT created_at FROM manuscript_sections WHERE id = ? AND manuscript_id = ?')
          .get(id, manuscriptId) as Row | undefined)
      : undefined
    if (section.id && !existing) throw new Error('Manuscript section not found.')
    this.db
      .prepare(
        `INSERT INTO manuscript_sections
           (id, manuscript_id, title, content, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content,
             position=excluded.position, updated_at=excluded.updated_at`
      )
      .run(
        id,
        manuscriptId,
        section.title,
        section.content,
        section.position,
        existing?.created_at ?? now,
        now
      )
    this.db.prepare('UPDATE manuscripts SET updated_at = ? WHERE id = ?').run(now, manuscriptId)
    return this.getManuscript(manuscriptId)
  }

  removeManuscriptSection(id: string): void {
    const row = this.db
      .prepare('SELECT manuscript_id FROM manuscript_sections WHERE id = ?')
      .get(id) as Row | undefined
    if (!row) throw new Error('Manuscript section not found.')
    const count = this.db
      .prepare('SELECT COUNT(*) AS count FROM manuscript_sections WHERE manuscript_id = ?')
      .get(row.manuscript_id) as Row
    if (Number(count.count) <= 1) throw new Error('A manuscript must keep at least one section.')
    this.db.prepare('DELETE FROM manuscript_sections WHERE id = ?').run(id)
  }

  getRevisionWorkspace(manuscriptId: string): RevisionWorkspace {
    this.getManuscript(manuscriptId)
    const documents = this.db
      .prepare(
        `SELECT d.*,
          (SELECT COUNT(*) FROM reviewer_comments c WHERE c.review_document_id = d.id) AS comment_count
         FROM review_documents d
         WHERE d.manuscript_id = ?
         ORDER BY d.imported_at DESC`
      )
      .all(manuscriptId) as Row[]
    const suggestions = this.db
      .prepare(
        `SELECT s.*, c.body AS reviewer_comment, ms.title AS section_title
         FROM revision_suggestions s
         LEFT JOIN reviewer_comments c ON c.id = s.reviewer_comment_id
         LEFT JOIN manuscript_sections ms ON ms.id = s.section_id
         WHERE s.manuscript_id = ? AND s.current = 1
         ORDER BY
           CASE s.status WHEN 'open' THEN 0 WHEN 'deferred' THEN 1 ELSE 2 END,
           s.created_at DESC`
      )
      .all(manuscriptId) as Row[]
    return {
      documents: documents.map((document) => ({
        id: String(document.id),
        manuscriptId: String(document.manuscript_id),
        originalName: String(document.original_name),
        sha256: String(document.sha256),
        importedAt: String(document.imported_at),
        commentCount: Number(document.comment_count)
      })),
      suggestions: suggestions.map((suggestion) => ({
        id: String(suggestion.id),
        manuscriptId: String(suggestion.manuscript_id),
        reviewerCommentId: suggestion.reviewer_comment_id
          ? String(suggestion.reviewer_comment_id)
          : null,
        sectionId: suggestion.section_id ? String(suggestion.section_id) : null,
        sectionTitle: suggestion.section_title ? String(suggestion.section_title) : null,
        sourceType: suggestion.source_type as 'reviewer-comment' | 'manuscript-rule',
        category: suggestion.category as RevisionWorkspace['suggestions'][number]['category'],
        reviewerComment: suggestion.reviewer_comment ? String(suggestion.reviewer_comment) : null,
        summary: String(suggestion.summary),
        rationale: String(suggestion.rationale),
        proposedAction: String(suggestion.proposed_action),
        status: suggestion.status as RevisionSuggestionStatus,
        generatedBy: 'local-rules',
        createdAt: String(suggestion.created_at),
        updatedAt: String(suggestion.updated_at)
      }))
    }
  }

  importReviewDocument(
    manuscriptId: string,
    originalName: string,
    content: string
  ): RevisionImportSummary {
    const manuscript = this.getManuscript(manuscriptId)
    const sha256 = createHash('sha256').update(content).digest('hex')
    const existing = this.db
      .prepare('SELECT id FROM review_documents WHERE manuscript_id = ? AND sha256 = ?')
      .get(manuscriptId, sha256)
    if (existing) {
      return {
        ...this.getRevisionWorkspace(manuscriptId),
        fileName: originalName,
        importedComments: 0,
        duplicate: true
      }
    }
    const comments = parseReviewerComments(content)
    if (!comments.length) throw new Error('The reviewer comment file is empty.')
    const documentId = randomUUID()
    const now = new Date().toISOString()
    const proposals = reviewerCommentProposals(manuscript, comments, sha256)
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO review_documents
          (id, manuscript_id, original_name, content, sha256, imported_at)
          VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(documentId, manuscriptId, originalName, content, sha256, now)
      const commentIds = comments.map((comment, position) => {
        const id = randomUUID()
        const proposal = proposals[position]
        this.db
          .prepare(
            `INSERT INTO reviewer_comments
            (id, review_document_id, manuscript_id, position, body, category, section_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            documentId,
            manuscriptId,
            position,
            comment,
            proposal.category,
            proposal.sectionId,
            now
          )
        return id
      })
      proposals.forEach((proposal, position) =>
        this.insertRevisionProposal(manuscriptId, proposal, commentIds[position], now)
      )
    })
    return {
      ...this.getRevisionWorkspace(manuscriptId),
      fileName: originalName,
      importedComments: comments.length,
      duplicate: false
    }
  }

  analyzeManuscriptRevision(manuscriptId: string): RevisionWorkspace {
    const manuscript = this.getManuscript(manuscriptId)
    const proposals = manuscriptRuleProposals(manuscript)
    const reviewRows = this.db
      .prepare(
        `SELECT c.id, c.position, c.body, d.id AS document_id, d.sha256
         FROM reviewer_comments c
         JOIN review_documents d ON d.id = c.review_document_id
         WHERE c.manuscript_id = ?
         ORDER BY d.imported_at, d.id, c.position`
      )
      .all(manuscriptId) as Row[]
    const reviewGroups = new Map<string, Row[]>()
    for (const row of reviewRows) {
      const documentId = String(row.document_id)
      reviewGroups.set(documentId, [...(reviewGroups.get(documentId) ?? []), row])
    }
    const now = new Date().toISOString()
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE revision_suggestions SET current = 0, updated_at = ?
           WHERE manuscript_id = ? AND source_type = 'manuscript-rule' AND current = 1`
        )
        .run(now, manuscriptId)
      proposals.forEach((proposal) =>
        this.insertRevisionProposal(manuscriptId, proposal, null, now)
      )
      for (const rows of reviewGroups.values()) {
        const reviewerProposals = reviewerCommentProposals(
          manuscript,
          rows.map((row) => String(row.body)),
          String(rows[0].sha256)
        )
        reviewerProposals.forEach((proposal, position) => {
          const commentId = String(rows[position].id)
          this.db
            .prepare('UPDATE reviewer_comments SET category = ?, section_id = ? WHERE id = ?')
            .run(proposal.category, proposal.sectionId, commentId)
          this.insertRevisionProposal(manuscriptId, proposal, commentId, now)
        })
      }
    })
    return this.getRevisionWorkspace(manuscriptId)
  }

  setRevisionSuggestionStatus(id: string, status: RevisionSuggestionStatus): RevisionWorkspace {
    const row = this.db
      .prepare('SELECT manuscript_id FROM revision_suggestions WHERE id = ?')
      .get(id) as Row | undefined
    if (!row) throw new Error('Revision suggestion not found.')
    this.db
      .prepare('UPDATE revision_suggestions SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id)
    return this.getRevisionWorkspace(String(row.manuscript_id))
  }

  removeReviewDocument(id: string): RevisionWorkspace {
    const row = this.db
      .prepare('SELECT manuscript_id FROM review_documents WHERE id = ?')
      .get(id) as Row | undefined
    if (!row) throw new Error('Reviewer comment file not found.')
    this.db.prepare('DELETE FROM review_documents WHERE id = ?').run(id)
    return this.getRevisionWorkspace(String(row.manuscript_id))
  }

  addManuscriptTrace(
    sectionId: string,
    evidenceExcerptId: string | null,
    sourceId: string,
    marker: string
  ): ManuscriptSection {
    const section = this.db
      .prepare('SELECT manuscript_id FROM manuscript_sections WHERE id = ?')
      .get(sectionId) as Row | undefined
    if (!section) throw new Error('Manuscript section not found.')
    this.getSource(sourceId)
    if (evidenceExcerptId) {
      const excerpt = this.db
        .prepare('SELECT id FROM evidence_excerpts WHERE id = ? AND source_id = ?')
        .get(evidenceExcerptId, sourceId)
      if (!excerpt) throw new Error('Evidence excerpt does not belong to this source.')
    }
    this.db
      .prepare(
        `INSERT INTO manuscript_traces
         (id, section_id, evidence_excerpt_id, source_id, marker, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), sectionId, evidenceExcerptId, sourceId, marker, new Date().toISOString())
    return this.getManuscript(String(section.manuscript_id)).sections.find(
      (item) => item.id === sectionId
    )!
  }

  listInterviews(): Interview[] {
    const rows = this.db
      .prepare('SELECT * FROM interviews ORDER BY updated_at DESC, title COLLATE NOCASE')
      .all() as Row[]
    return rows.map((row) => this.hydrateInterview(row))
  }

  getInterview(id: string): Interview {
    const row = this.db.prepare('SELECT * FROM interviews WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error('Interview not found.')
    return this.hydrateInterview(row)
  }

  saveInterview(draft: {
    id?: string
    projectId: string | null
    title: string
    participantName: string
    occurredAt: string | null
    consentNote: string | null
    status: Interview['status']
  }): Interview {
    if (draft.projectId) this.getProject(draft.projectId)
    const id = draft.id ?? randomUUID()
    const now = new Date().toISOString()
    const existing = draft.id
      ? (this.db.prepare('SELECT created_at FROM interviews WHERE id = ?').get(id) as
          Row | undefined)
      : undefined
    if (draft.id && !existing) throw new Error('Interview not found.')
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO interviews
             (id, project_id, title, participant_name, occurred_at, consent_note, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, title=excluded.title,
               participant_name=excluded.participant_name, occurred_at=excluded.occurred_at,
               consent_note=excluded.consent_note, status=excluded.status, updated_at=excluded.updated_at`
        )
        .run(
          id,
          draft.projectId,
          draft.title,
          draft.participantName,
          draft.occurredAt,
          draft.consentNote,
          draft.status,
          existing?.created_at ?? now,
          now
        )
      if (!draft.id) {
        this.db
          .prepare(
            `INSERT INTO transcripts (id, interview_id, content, origin, created_at, updated_at)
               VALUES (?, ?, '', 'user', ?, ?)`
          )
          .run(randomUUID(), id, now, now)
      }
    })
    return this.getInterview(id)
  }

  removeInterview(id: string): void {
    const media = this.db
      .prepare('SELECT relative_path FROM interview_media WHERE interview_id = ?')
      .all(id) as Row[]
    const interview = this.db.prepare('SELECT id FROM interviews WHERE id = ?').get(id)
    if (!interview) throw new Error('Interview not found.')
    this.transaction(() => {
      const transcriptIds = this.db
        .prepare('SELECT id FROM transcripts WHERE interview_id = ?')
        .all(id) as Row[]
      for (const transcript of transcriptIds) {
        this.db
          .prepare('DELETE FROM transcript_segments WHERE transcript_id = ?')
          .run(transcript.id)
      }
      this.db.prepare('DELETE FROM transcripts WHERE interview_id = ?').run(id)
      this.db.prepare('DELETE FROM interviews WHERE id = ?').run(id)
    })
    for (const item of media) {
      const path = this.resolveInterviewMediaPath(String(item.relative_path))
      if (existsSync(path)) {
        try {
          unlinkSync(path)
        } catch (error) {
          console.error(
            `Interview deleted, but its retired managed media could not be removed: ${path}`,
            error
          )
        }
      }
    }
  }

  attachInterviewMedia(interviewId: string, inputPath: string): InterviewMedia {
    this.getInterview(interviewId)
    const input = resolve(inputPath)
    if (!existsSync(input) || !statSync(input).isFile())
      throw new Error('The selected media file is unavailable.')
    const allowed = new Set(['.mp3', '.wav', '.m4a', '.mp4', '.webm', '.ogg', '.flac'])
    const extension = extname(input).toLowerCase()
    if (!allowed.has(extension)) throw new Error('Choose a supported audio or video file.')
    const id = randomUUID()
    const target = join(this.storageRoot, 'interview-media', `${id}${extension}`)
    copyFileSync(input, target)
    const bytes = readFileSync(target)
    const mediaType = ['.mp4', '.webm'].includes(extension)
      ? `video/${extension.slice(1)}`
      : `audio/${extension === '.mp3' ? 'mpeg' : extension.slice(1)}`
    const record: InterviewMedia = {
      id,
      interviewId,
      originalName: basename(input),
      mediaType,
      byteSize: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      importedAt: new Date().toISOString()
    }
    this.db
      .prepare(
        `INSERT INTO interview_media
           (id, interview_id, original_name, relative_path, media_type, byte_size, sha256, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        interviewId,
        record.originalName,
        normalize(relative(this.storageRoot, target)),
        record.mediaType,
        record.byteSize,
        record.sha256,
        record.importedAt
      )
    return record
  }

  interviewMediaPath(id: string): string {
    const row = this.db
      .prepare('SELECT relative_path FROM interview_media WHERE id = ?')
      .get(id) as Row | undefined
    if (!row) throw new Error('Interview media not found.')
    const path = this.resolveInterviewMediaPath(String(row.relative_path))
    if (!existsSync(path)) throw new Error('The interview media file is missing.')
    return path
  }

  saveTranscriptSegment(
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
  ): Interview {
    const interview = this.getInterview(interviewId)
    const id = segment.id ?? randomUUID()
    const now = new Date().toISOString()
    const existing = segment.id
      ? (this.db.prepare('SELECT created_at FROM transcript_segments WHERE id = ?').get(id) as
          Row | undefined)
      : undefined
    if (segment.id && !existing) throw new Error('Transcript segment not found.')
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO transcript_segments
             (id, transcript_id, speaker, start_seconds, end_seconds, text, position, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET speaker=excluded.speaker,
               start_seconds=excluded.start_seconds, end_seconds=excluded.end_seconds,
               text=excluded.text, position=excluded.position, updated_at=excluded.updated_at`
        )
        .run(
          id,
          interview.transcriptId,
          segment.speaker,
          segment.startSeconds,
          segment.endSeconds,
          segment.text,
          segment.position,
          existing?.created_at ?? now,
          now
        )
      this.db.prepare('DELETE FROM transcript_segment_codes WHERE segment_id = ?').run(id)
      const findCode = this.db.prepare(
        'SELECT id FROM qualitative_codes WHERE project_id IS NULL AND name = ? COLLATE NOCASE'
      )
      const insertCode = this.db.prepare(
        `INSERT INTO qualitative_codes
           (id, project_id, name, description, color, created_at, updated_at)
           VALUES (?, NULL, ?, NULL, NULL, ?, ?)`
      )
      const link = this.db.prepare(
        'INSERT INTO transcript_segment_codes (segment_id, code_id) VALUES (?, ?)'
      )
      for (const name of [...new Set(segment.codeNames)]) {
        const found = findCode.get(name) as Row | undefined
        const codeId = found ? String(found.id) : randomUUID()
        if (!found) insertCode.run(codeId, name, now, now)
        link.run(id, codeId)
      }
      this.db
        .prepare("UPDATE transcripts SET content = '', updated_at = ? WHERE id = ?")
        .run(now, interview.transcriptId)
      this.db
        .prepare(
          "UPDATE interviews SET status = CASE WHEN status = 'planned' THEN 'transcribed' WHEN status = 'recorded' THEN 'transcribed' ELSE status END, updated_at = ? WHERE id = ?"
        )
        .run(now, interviewId)
    })
    return this.getInterview(interviewId)
  }

  removeTranscriptSegment(id: string): void {
    const result = this.db.prepare('DELETE FROM transcript_segments WHERE id = ?').run(id)
    if (!result.changes) throw new Error('Transcript segment not found.')
  }

  analyzeInterviews(query: AnalysisQuery): AnalysisResult {
    if (query.projectId) this.getProject(query.projectId)
    const projectClauses: string[] = []
    const projectValues: string[] = []
    if (query.projectId) {
      projectClauses.push('i.project_id = ?')
      projectValues.push(query.projectId)
    }
    const passageScopeClauses = [...projectClauses]
    const passageScopeValues = [...projectValues]
    if (query.search) {
      passageScopeClauses.push(
        `(ts.text LIKE ? ESCAPE '\\' OR ts.speaker LIKE ? ESCAPE '\\'
          OR i.title LIKE ? ESCAPE '\\' OR i.participant_name LIKE ? ESCAPE '\\')`
      )
      const search = `%${this.escapeLike(query.search)}%`
      passageScopeValues.push(search, search, search, search)
    }
    const passageClauses = [
      'EXISTS (SELECT 1 FROM transcript_segment_codes coded WHERE coded.segment_id = ts.id)',
      ...passageScopeClauses
    ]
    const passageValues = [...passageScopeValues]
    if (query.codeId) {
      passageClauses.push(
        'EXISTS (SELECT 1 FROM transcript_segment_codes selected WHERE selected.segment_id = ts.id AND selected.code_id = ?)'
      )
      passageValues.push(query.codeId)
    }
    const passageRows = this.db
      .prepare(
        `SELECT ts.*, i.id AS interview_id, i.title AS interview_title,
          i.participant_name, i.project_id
         FROM transcript_segments ts
         JOIN transcripts tr ON tr.id = ts.transcript_id
         JOIN interviews i ON i.id = tr.interview_id
         WHERE ${passageClauses.join(' AND ')}
         ORDER BY i.title COLLATE NOCASE, ts.position`
      )
      .all(...passageValues) as Row[]
    const codeRows = this.db
      .prepare(
        `SELECT c.id, c.name, c.color, COUNT(DISTINCT sc.segment_id) AS passage_count,
          COUNT(DISTINCT i.id) AS interview_count
         FROM qualitative_codes c
         JOIN transcript_segment_codes sc ON sc.code_id = c.id
         JOIN transcript_segments ts ON ts.id = sc.segment_id
         JOIN transcripts tr ON tr.id = ts.transcript_id
         JOIN interviews i ON i.id = tr.interview_id
         ${projectClauses.length ? `WHERE ${projectClauses.join(' AND ')}` : ''}
         GROUP BY c.id, c.name, c.color
         ORDER BY passage_count DESC, c.name COLLATE NOCASE`
      )
      .all(...projectValues) as Row[]
    const passages = passageRows.map((row) => this.hydrateCodedPassage(row))
    const available = this.db
      .prepare(
        `SELECT COUNT(DISTINCT ts.id) AS count
         FROM transcript_segments ts
         JOIN transcripts tr ON tr.id = ts.transcript_id
         JOIN interviews i ON i.id = tr.interview_id
         WHERE EXISTS (
           SELECT 1 FROM transcript_segment_codes coded WHERE coded.segment_id = ts.id
         )${projectClauses.length ? ` AND ${projectClauses.join(' AND ')}` : ''}`
      )
      .get(...projectValues) as Row
    return {
      passages,
      codes: codeRows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        color: row.color ? String(row.color) : null,
        passageCount: Number(row.passage_count),
        interviewCount: Number(row.interview_count)
      })),
      availableCodedPassages: Number(available.count),
      totalCodedPassages: passages.length,
      interviewCount: new Set(passages.map((passage) => passage.interviewId)).size
    }
  }

  listSynthesisMemos(projectId: string | null): SynthesisMemo[] {
    if (projectId) this.getProject(projectId)
    const rows = projectId
      ? (this.db
          .prepare(
            `SELECT * FROM synthesis_memos
             WHERE project_id = ? OR project_id IS NULL
             ORDER BY updated_at DESC, title COLLATE NOCASE`
          )
          .all(projectId) as Row[])
      : (this.db
          .prepare('SELECT * FROM synthesis_memos ORDER BY updated_at DESC, title COLLATE NOCASE')
          .all() as Row[])
    return rows.map((row) => this.hydrateSynthesisMemo(row))
  }

  getSynthesisMemo(id: string): SynthesisMemo {
    const row = this.db.prepare('SELECT * FROM synthesis_memos WHERE id = ?').get(id) as
      Row | undefined
    if (!row) throw new Error('Synthesis memo not found.')
    return this.hydrateSynthesisMemo(row)
  }

  saveSynthesisMemo(draft: SynthesisMemoDraft): SynthesisMemo {
    if (draft.projectId) this.getProject(draft.projectId)
    const id = draft.id ?? randomUUID()
    const now = new Date().toISOString()
    const existing = draft.id
      ? (this.db.prepare('SELECT created_at FROM synthesis_memos WHERE id = ?').get(id) as
          Row | undefined)
      : undefined
    if (draft.id && !existing) throw new Error('Synthesis memo not found.')
    for (const segmentId of draft.segmentIds) {
      const segment = this.db
        .prepare(
          `SELECT i.project_id FROM transcript_segments ts
           JOIN transcripts tr ON tr.id = ts.transcript_id
           JOIN interviews i ON i.id = tr.interview_id
           WHERE ts.id = ?`
        )
        .get(segmentId) as Row | undefined
      if (!segment) throw new Error('A linked transcript passage no longer exists.')
      if (draft.projectId && segment.project_id !== draft.projectId) {
        throw new Error('Linked passages must belong to the memo project.')
      }
    }
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO synthesis_memos
           (id, project_id, title, body, status, origin, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'user', ?, ?)
           ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, title=excluded.title,
             body=excluded.body, status=excluded.status, updated_at=excluded.updated_at`
        )
        .run(
          id,
          draft.projectId,
          draft.title,
          draft.body,
          draft.status,
          existing?.created_at ?? now,
          now
        )
      this.db.prepare('DELETE FROM synthesis_memo_segments WHERE memo_id = ?').run(id)
      const link = this.db.prepare(
        `INSERT INTO synthesis_memo_segments (memo_id, segment_id, position, linked_at)
         VALUES (?, ?, ?, ?)`
      )
      draft.segmentIds.forEach((segmentId, position) => link.run(id, segmentId, position, now))
    })
    return this.getSynthesisMemo(id)
  }

  removeSynthesisMemo(id: string): void {
    const result = this.db.prepare('DELETE FROM synthesis_memos WHERE id = ?').run(id)
    if (!result.changes) throw new Error('Synthesis memo not found.')
  }

  importTranscript(interviewId: string, content: string): Interview {
    const interview = this.getInterview(interviewId)
    const blocks = content
      .replace(/\r\n/g, '\n')
      .split(/\n\s*\n/)
      .map((value) => value.trim())
      .filter(Boolean)
    if (!blocks.length) throw new Error('The transcript file is empty.')
    this.transaction(() => {
      const insert = this.db.prepare(
        `INSERT INTO transcript_segments
           (id, transcript_id, speaker, start_seconds, end_seconds, text, position, created_at, updated_at)
           VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)`
      )
      const now = new Date().toISOString()
      const positionRow = this.db
        .prepare(
          'SELECT COALESCE(MAX(position), -1) AS max_position FROM transcript_segments WHERE transcript_id = ?'
        )
        .get(interview.transcriptId) as Row
      const firstPosition = Number(positionRow.max_position) + 1
      blocks.forEach((block, offset) => {
        const match = block.match(/^([^:\n]{1,100}):\s*([\s\S]+)$/)
        insert.run(
          randomUUID(),
          interview.transcriptId,
          match?.[1]?.trim() || 'Speaker',
          match?.[2]?.trim() || block,
          firstPosition + offset,
          now,
          now
        )
      })
      this.db
        .prepare("UPDATE interviews SET status = 'transcribed', updated_at = ? WHERE id = ?")
        .run(now, interviewId)
    })
    return this.getInterview(interviewId)
  }

  private resolveManagedPath(relativePath: string): string {
    const candidate = resolve(this.storageRoot, relativePath.replace(/[\\/]+/g, sep))
    const filesRoot = resolve(this.storageRoot, 'files')
    const prefix = `${filesRoot}${process.platform === 'win32' ? '\\' : '/'}`
    if (candidate !== filesRoot && !candidate.startsWith(prefix)) {
      throw new Error('The stored file path is invalid.')
    }
    return candidate
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&')
  }

  private resolveInterviewMediaPath(relativePath: string): string {
    const candidate = resolve(this.storageRoot, relativePath.replace(/[\\/]+/g, sep))
    const root = resolve(this.storageRoot, 'interview-media')
    const prefix = `${root}${process.platform === 'win32' ? '\\' : '/'}`
    if (candidate !== root && !candidate.startsWith(prefix))
      throw new Error('The stored media path is invalid.')
    return candidate
  }

  private resolveProjectFilePath(relativePath: string): string {
    const candidate = resolve(this.storageRoot, relativePath.replace(/[\\/]+/g, sep))
    const root = resolve(this.storageRoot, 'project-files')
    const prefix = `${root}${process.platform === 'win32' ? '\\' : '/'}`
    if (candidate !== root && !candidate.startsWith(prefix)) {
      throw new Error('The stored project file path is invalid.')
    }
    return candidate
  }

  private hydrateProjectFile(row: Row): ProjectManagedFile {
    return {
      id: String(row.id),
      originalName: String(row.original_name),
      originalPath: row.original_path ? String(row.original_path) : null,
      relativePath: String(row.relative_path),
      mediaType: String(row.media_type),
      extension: String(row.extension),
      byteSize: Number(row.byte_size),
      sha256: String(row.sha256),
      importedAt: String(row.imported_at),
      linkCount: Number(row.link_count)
    }
  }

  private insertRevisionProposal(
    manuscriptId: string,
    proposal: RevisionProposal,
    reviewerCommentId: string | null,
    now: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO revision_suggestions
        (id, manuscript_id, reviewer_comment_id, section_id, source_type, category, fingerprint,
         summary, rationale, proposed_action, status, current, generated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, 'local-rules', ?, ?)
        ON CONFLICT(manuscript_id, fingerprint) DO UPDATE SET
          reviewer_comment_id=excluded.reviewer_comment_id,
          section_id=excluded.section_id,
          category=excluded.category,
          summary=excluded.summary,
          rationale=excluded.rationale,
          proposed_action=excluded.proposed_action,
          current=1,
          updated_at=excluded.updated_at`
      )
      .run(
        randomUUID(),
        manuscriptId,
        reviewerCommentId,
        proposal.sectionId,
        proposal.sourceType,
        proposal.category,
        proposal.fingerprint,
        proposal.summary,
        proposal.rationale,
        proposal.proposedAction,
        now,
        now
      )
  }

  private touchProject(id: string): void {
    this.db
      .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id)
  }

  private migrate(workspaceName: string): void {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
    )
    const applied = new Set(
      (this.db.prepare('SELECT version FROM schema_migrations').all() as Row[]).map((row) =>
        Number(row.version)
      )
    )
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue
      this.transaction(() => {
        this.db.exec(migration.sql)
        const now = new Date().toISOString()
        if (migration.version === 1) {
          this.db
            .prepare(
              'INSERT INTO workspace (id, name, created_at, updated_at, schema_version) VALUES (?, ?, ?, ?, ?)'
            )
            .run(randomUUID(), workspaceName, now, now, migration.version)
        }
        this.db
          .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, now)
      })
    }
  }

  private transaction(action: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      action()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private hydrateSource(row: Row): Source {
    const id = String(row.id)
    const authors = this.db
      .prepare(
        `SELECT p.* FROM people p JOIN source_people sp ON sp.person_id = p.id
         WHERE sp.source_id = ? AND sp.role = 'author' ORDER BY sp.position`
      )
      .all(id) as Row[]
    const tags = this.db
      .prepare(
        'SELECT t.name FROM tags t JOIN source_tags st ON st.tag_id = t.id WHERE st.source_id = ? ORDER BY t.name COLLATE NOCASE'
      )
      .all(id) as Row[]
    const files = this.db
      .prepare('SELECT * FROM source_files WHERE source_id = ? ORDER BY imported_at DESC')
      .all(id) as Row[]
    return {
      id,
      title: String(row.title),
      sourceType: row.source_type as Source['sourceType'],
      status: row.status as Source['status'],
      authors: authors.map((person): Person => ({
        id: String(person.id),
        displayName: String(person.display_name),
        givenName: person.given_name ? String(person.given_name) : null,
        familyName: person.family_name ? String(person.family_name) : null,
        orcid: person.orcid ? String(person.orcid) : null
      })),
      year: row.year === null ? null : Number(row.year),
      publicationTitle: row.publication_title ? String(row.publication_title) : null,
      publisher: row.publisher ? String(row.publisher) : null,
      doi: row.doi ? String(row.doi) : null,
      url: row.url ? String(row.url) : null,
      abstract: row.abstract ? String(row.abstract) : null,
      notes: row.notes ? String(row.notes) : null,
      tags: tags.map((tag) => String(tag.name)),
      origin: row.origin as Source['origin'],
      provenanceNote: row.provenance_note ? String(row.provenance_note) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      files: files.map((file): SourceFile => ({
        id: String(file.id),
        sourceId: String(file.source_id),
        originalName: String(file.original_name),
        relativePath: String(file.relative_path),
        mediaType: String(file.media_type),
        byteSize: Number(file.byte_size),
        sha256: String(file.sha256),
        importedAt: String(file.imported_at)
      }))
    }
  }

  private hydrateExcerpt(row: Row): EvidenceExcerpt {
    const locator = JSON.parse(String(row.locator_json)) as { page: number }
    const codes = this.db
      .prepare(
        `SELECT c.id, c.name, c.color FROM qualitative_codes c
           JOIN evidence_excerpt_codes ec ON ec.code_id = c.id
           WHERE ec.excerpt_id = ? ORDER BY c.name COLLATE NOCASE`
      )
      .all(String(row.id)) as Row[]
    return {
      id: String(row.id),
      sourceId: String(row.source_id),
      sourceFileId: String(row.source_file_id),
      text: String(row.text),
      note: row.note ? String(row.note) : null,
      page: locator.page,
      fileName: String(row.original_name),
      fileSha256: String(row.sha256),
      codes: codes.map((code) => ({
        id: String(code.id),
        name: String(code.name),
        color: code.color ? String(code.color) : null
      })),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private hydrateProjectSummary(row: Row): ProjectSummary {
    return {
      id: String(row.id),
      title: String(row.title),
      researchQuestion: String(row.research_question),
      description: row.description ? String(row.description) : null,
      status: row.status as ProjectSummary['status'],
      sourceCount: Number(row.source_count),
      evidenceCount: Number(row.evidence_count),
      openGoalCount: Number(row.open_goal_count),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private hydrateGoal(row: Row): ProjectGoal {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      title: String(row.title),
      status: row.status as ProjectGoal['status'],
      targetDate: row.target_date ? String(row.target_date) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private hydrateManuscript(row: Row): Manuscript {
    const sections = this.db
      .prepare(
        'SELECT * FROM manuscript_sections WHERE manuscript_id = ? ORDER BY position, created_at'
      )
      .all(String(row.id)) as Row[]
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      title: String(row.title),
      status: row.status as Manuscript['status'],
      sections: sections.map((section) => this.hydrateManuscriptSection(section)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private hydrateManuscriptSection(row: Row): ManuscriptSection {
    const traces = this.db
      .prepare(
        `SELECT mt.*, s.title AS source_title, e.locator_json, f.original_name, f.sha256
           FROM manuscript_traces mt
           JOIN sources s ON s.id = mt.source_id
           LEFT JOIN evidence_excerpts e ON e.id = mt.evidence_excerpt_id
           LEFT JOIN source_files f ON f.id = e.source_file_id
           WHERE mt.section_id = ? ORDER BY mt.created_at`
      )
      .all(String(row.id)) as Row[]
    return {
      id: String(row.id),
      manuscriptId: String(row.manuscript_id),
      title: String(row.title),
      content: String(row.content),
      position: Number(row.position),
      updatedAt: String(row.updated_at),
      traces: traces.map((trace): ManuscriptTrace => {
        const locator = trace.locator_json
          ? (JSON.parse(String(trace.locator_json)) as { page?: number })
          : null
        return {
          id: String(trace.id),
          sectionId: String(trace.section_id),
          evidenceExcerptId: trace.evidence_excerpt_id ? String(trace.evidence_excerpt_id) : null,
          sourceId: String(trace.source_id),
          marker: String(trace.marker),
          sourceTitle: String(trace.source_title),
          page: locator?.page ?? null,
          fileName: trace.original_name ? String(trace.original_name) : null,
          fileSha256: trace.sha256 ? String(trace.sha256) : null
        }
      })
    }
  }

  private hydrateInterview(row: Row): Interview {
    const transcript = this.db
      .prepare('SELECT id FROM transcripts WHERE interview_id = ?')
      .get(String(row.id)) as Row
    const media = this.db
      .prepare('SELECT * FROM interview_media WHERE interview_id = ? ORDER BY imported_at DESC')
      .all(String(row.id)) as Row[]
    const segments = this.db
      .prepare('SELECT * FROM transcript_segments WHERE transcript_id = ? ORDER BY position')
      .all(String(transcript.id)) as Row[]
    return {
      id: String(row.id),
      projectId: row.project_id ? String(row.project_id) : null,
      title: String(row.title),
      participantName: String(row.participant_name),
      occurredAt: row.occurred_at ? String(row.occurred_at) : null,
      consentNote: row.consent_note ? String(row.consent_note) : null,
      status: row.status as Interview['status'],
      media: media.map((item) => ({
        id: String(item.id),
        interviewId: String(item.interview_id),
        originalName: String(item.original_name),
        mediaType: String(item.media_type),
        byteSize: Number(item.byte_size),
        sha256: String(item.sha256),
        importedAt: String(item.imported_at)
      })),
      transcriptId: String(transcript.id),
      segments: segments.map((segment) => this.hydrateTranscriptSegment(segment)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private hydrateTranscriptSegment(row: Row): TranscriptSegment {
    const codes = this.db
      .prepare(
        `SELECT c.id, c.name, c.color FROM qualitative_codes c
           JOIN transcript_segment_codes sc ON sc.code_id = c.id
           WHERE sc.segment_id = ? ORDER BY c.name COLLATE NOCASE`
      )
      .all(String(row.id)) as Row[]
    return {
      id: String(row.id),
      transcriptId: String(row.transcript_id),
      speaker: String(row.speaker),
      startSeconds: row.start_seconds === null ? null : Number(row.start_seconds),
      endSeconds: row.end_seconds === null ? null : Number(row.end_seconds),
      text: String(row.text),
      position: Number(row.position),
      codes: codes.map((code) => ({
        id: String(code.id),
        name: String(code.name),
        color: code.color ? String(code.color) : null
      })),
      updatedAt: String(row.updated_at)
    }
  }

  private hydrateCodedPassage(row: Row): CodedPassage {
    const segment = this.hydrateTranscriptSegment(row)
    return {
      segmentId: segment.id,
      interviewId: String(row.interview_id),
      interviewTitle: String(row.interview_title),
      participantName: String(row.participant_name),
      projectId: row.project_id ? String(row.project_id) : null,
      speaker: segment.speaker,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: segment.text,
      codes: segment.codes,
      updatedAt: segment.updatedAt
    }
  }

  private hydrateSynthesisMemo(row: Row): SynthesisMemo {
    const passages = this.db
      .prepare(
        `SELECT ts.*, i.id AS interview_id, i.title AS interview_title,
          i.participant_name, i.project_id
         FROM synthesis_memo_segments ms
         JOIN transcript_segments ts ON ts.id = ms.segment_id
         JOIN transcripts tr ON tr.id = ts.transcript_id
         JOIN interviews i ON i.id = tr.interview_id
         WHERE ms.memo_id = ? ORDER BY ms.position`
      )
      .all(String(row.id)) as Row[]
    return {
      id: String(row.id),
      projectId: row.project_id ? String(row.project_id) : null,
      title: String(row.title),
      body: String(row.body),
      status: row.status as SynthesisMemo['status'],
      origin: row.origin as SynthesisMemo['origin'],
      passages: passages.map((passage) => this.hydrateCodedPassage(passage)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }
}
