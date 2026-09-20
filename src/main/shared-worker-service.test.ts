import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_ROOT_ENV } from './automation-config'
import { ensureSharedFolderStructure, manifestPath, sharedFolderPath } from './automation-fs'
import { processQueuedJobs } from './automation-processor'
import { scanInbox } from './automation-worker'
import { WorkspaceDatabase } from './database'
import { SharedWorkerService } from './shared-worker-service'
import { WorkspaceService } from './workspace-service'
import { idSchema } from './validation'
import { filesManifestSchema } from './automation-manifest'

const electronState = vi.hoisted(() => ({ userData: '', workspace: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => electronState.userData },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [electronState.workspace] })
  },
  shell: {},
  safeStorage: {}
}))

const paths: string[] = []

function temporary(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  paths.push(path)
  return path
}

function simplePdf(text = ''): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output))
    output += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output)
}

async function completedWorkerRoot(
  filename = 'shared.txt',
  content: string | Buffer = 'Worker text'
): Promise<string> {
  const root = temporary('research-studio-shared-worker-')
  scanInbox({ sharedDataRoot: root, dryRun: false })
  writeFileSync(join(sharedFolderPath(root, 'inbox'), filename), content)
  scanInbox({ sharedDataRoot: root, dryRun: false })
  await processQueuedJobs({ sharedDataRoot: root, dryRun: false })
  return root
}

function foreignRoot(platform: 'macos' | 'windows'): string {
  return platform === 'macos'
    ? '/Users/andrewpope/Library/CloudStorage/OneDrive-Personal/Research Studio Shared'
    : 'C:\\Users\\anjap\\OneDrive\\Research Studio Shared'
}

function foreignPath(platform: 'macos' | 'windows', ...segments: string[]): string {
  return `${foreignRoot(platform)}${platform === 'macos' ? '/' : '\\'}${segments.join(
    platform === 'macos' ? '/' : '\\'
  )}`
}

function writeForeignCompletedManifest(root: string, platform: 'macos' | 'windows'): string {
  const now = '2026-09-20T12:00:00.000Z'
  const fileId = `file-${platform}-portable`
  const jobId = `job-${platform}-portable`
  const text = `Portable ${platform} extraction text`
  ensureSharedFolderStructure(root, false)
  writeFileSync(join(sharedFolderPath(root, 'inbox'), 'portable.txt'), 'Portable source')
  writeFileSync(join(sharedFolderPath(root, 'sourceData'), 'portable.txt'), 'Portable source')
  writeFileSync(join(sharedFolderPath(root, 'outputExtracts'), `${fileId}.txt`), text)
  writeFileSync(
    join(sharedFolderPath(root, 'outputExtracts'), `${fileId}.json`),
    JSON.stringify({
      extractionStatus: 'extracted',
      normalizedText: text,
      extractor: 'fixture/1',
      pageCount: null,
      warnings: [],
      outputLocation: foreignPath(platform, 'Outputs', 'Extracts', `${fileId}.json`),
      textOutputLocation: foreignPath(platform, 'Outputs', 'Extracts', `${fileId}.txt`)
    })
  )
  writeFileSync(
    manifestPath(root, 'files.json'),
    JSON.stringify({
      format: 'research-studio-file-manifest',
      version: 1,
      updatedAt: now,
      files: [
        {
          id: fileId,
          filename: 'portable.txt',
          extension: 'txt',
          byteSize: 15,
          discoveredAt: now,
          lastSeenAt: now,
          modifiedAt: now,
          sourcePath: foreignPath(platform, 'Inbox', 'portable.txt'),
          sha256: 'a'.repeat(64),
          processingStatus: 'complete',
          associatedProject: null,
          preservedSourcePath: foreignPath(platform, 'Sources', 'Data', 'portable.txt'),
          extractionStatus: 'extracted',
          extractedTextPath: foreignPath(platform, 'Outputs', 'Extracts', `${fileId}.txt`),
          extractionRecordPath: foreignPath(platform, 'Outputs', 'Extracts', `${fileId}.json`),
          processedAt: now,
          processedBy: 'fixture/1',
          processingJobId: jobId,
          warnings: []
        }
      ]
    })
  )
  writeFileSync(
    manifestPath(root, 'jobs.json'),
    JSON.stringify({
      format: 'research-studio-job-manifest',
      version: 1,
      updatedAt: now,
      jobs: [
        {
          id: jobId,
          sourceFileId: fileId,
          sourcePath: foreignPath(platform, 'Inbox', 'portable.txt'),
          jobType: 'ingest-inbox-file',
          createdAt: now,
          updatedAt: now,
          queuedAt: now,
          workingAt: now,
          completedAt: now,
          status: 'complete',
          processor: 'fixture/1',
          inputLocation: foreignPath(platform, 'Inbox', 'portable.txt'),
          outputLocation: foreignPath(platform, 'Outputs', 'Extracts', `${fileId}.json`),
          warnings: [],
          error: null
        }
      ]
    })
  )
  return fileId
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('SharedWorkerService', () => {
  it.each(['macos', 'windows'] as const)(
    'consumes a %s-produced legacy manifest with local portable paths',
    (platform) => {
      const root = temporary(`research-studio-${platform}-consumer-`)
      const fileId = writeForeignCompletedManifest(root, platform)
      const database = new WorkspaceDatabase(temporary(`research-studio-${platform}-workspace-`))
      const service = new SharedWorkerService({ [DATA_ROOT_ENV]: root })
      try {
        expect(service.status()).toMatchObject({ connection: 'connected', completedJobs: 1 })
        const document = service.documents()[0]
        expect(document).toMatchObject({
          fileId,
          sourcePath: join(sharedFolderPath(root, 'inbox'), 'portable.txt'),
          producerSourcePath: foreignPath(platform, 'Inbox', 'portable.txt'),
          preservedSourcePath: join(sharedFolderPath(root, 'sourceData'), 'portable.txt'),
          extractionRecordPath: join(sharedFolderPath(root, 'outputExtracts'), `${fileId}.json`)
        })
        const imported = service.importDocument(fileId, database)
        expect(imported).toMatchObject({ imported: true, duplicate: false })
        const source = imported.source!
        expect(source.files[0]).toMatchObject({
          workerFileId: fileId,
          workerOriginalPath: foreignPath(platform, 'Inbox', 'portable.txt'),
          workerPreservedPath: join(sharedFolderPath(root, 'sourceData'), 'portable.txt'),
          extractionText: `Portable ${platform} extraction text`
        })
        expect(database.search(`Portable ${platform}`, ['source'])).toMatchObject([
          { entityId: source.id }
        ])
        expect(service.importDocument(fileId, database)).toMatchObject({
          imported: false,
          duplicate: true,
          source: { id: source.id }
        })
      } finally {
        database.close()
      }
    }
  )

  it('imports a deterministic worker ID through WorkspaceService with separate source identity', async () => {
    const text = '# Imported\n\nCanonical text'
    const root = await completedWorkerRoot('import.md', text)
    vi.stubEnv(DATA_ROOT_ENV, root)
    electronState.userData = temporary('research-studio-preferences-')
    electronState.workspace = temporary('research-studio-workspace-')
    const service = new WorkspaceService()
    try {
      await service.choose('create')
      const document = service.workerDocuments()[0]
      const fileId = document.fileId
      // Use the actual Stage B/C-generated identity, not a UUID fixture.
      expect(fileId).toMatch(/^file-[a-f0-9]{64}$/)
      expect(idSchema.safeParse(fileId).success).toBe(false)
      const metadata = filesManifestSchema.parse(
        JSON.parse(readFileSync(manifestPath(root, 'files.json'), 'utf8'))
      ).files[0]

      const imported = service.importWorkerDocument(fileId)
      expect(imported).toMatchObject({ imported: true, duplicate: false })
      const source = imported.source!
      expect(idSchema.parse(source.id)).toBe(source.id)
      expect(source.id).not.toBe(fileId)
      expect(source.notes).toBe(text)
      expect(source.files).toHaveLength(1)
      expect(source.files[0]).toMatchObject({
        sourceId: source.id,
        sha256: metadata.sha256,
        workerFileId: fileId,
        workerJobId: document.jobId,
        workerOriginalPath: document.sourcePath,
        workerPreservedPath: document.preservedSourcePath,
        workerExtractionPath: metadata.extractionRecordPath,
        workerExtractionStatus: 'extracted',
        workerProcessedAt: document.processedAt,
        workerProcessor: document.processor,
        extractionText: text
      })
      expect(document.jobId).toEqual(expect.any(String))
      expect(document.processedAt).toEqual(expect.any(String))
      expect(document.processor).toEqual(expect.any(String))
      expect(document.extractionRecordPath).toEqual(expect.any(String))
      expect(document.preservedSourcePath).toEqual(expect.any(String))
      // Search must consume structured extraction, independently of editable notes.
      const edited = service.saveSource({
        ...source,
        origin: 'imported',
        authors: source.authors.map((author) => author.displayName),
        notes: null
      })
      const results = service.search('Canonical text', ['source'])
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({ type: 'source', entityId: source.id, title: 'import.md' })
      expect(results[0].snippet).toContain('Canonical')
      expect(JSON.stringify(results)).not.toContain(root)
      service.rebuildSearchIndex()
      service.rebuildSearchIndex()
      expect(service.search('Canonical text', ['source'])).toHaveLength(1)
      expect(service.searchIndexStatus().itemCount).toBe(1)
      expect(service.importWorkerDocument(fileId)).toMatchObject({
        imported: false,
        duplicate: true,
        source: { id: source.id, files: source.files }
      })
      expect(service.workerDocuments()[0].importedSourceId).toBe(source.id)
      rmSync(root, { recursive: true, force: true })
      expect(service.workerStatus().connection).toBe('unavailable')
      // Reopen to prove both provenance and duplicate detection survive persistence.
      service.close()
      await service.choose('open')
      expect(service.getSource(source.id)).toEqual(edited)
      service.rebuildSearchIndex()
      expect(service.search('Canonical text', ['source'])).toMatchObject([{ entityId: source.id }])
      expect(service.listSources()).toHaveLength(1)
    } finally {
      service.close()
    }
  })

  it('keeps changed content with the same filename independently searchable', async () => {
    const root = await completedWorkerRoot('same.txt', 'Amberquartz first edition')
    const service = new SharedWorkerService({ [DATA_ROOT_ENV]: root })
    const database = new WorkspaceDatabase(temporary('research-studio-editions-'))
    try {
      const first = service.importDocument(service.documents()[0].fileId, database).source!
      writeFileSync(
        join(sharedFolderPath(root, 'inbox'), 'same.txt'),
        'Violetquartz second edition'
      )
      scanInbox({ sharedDataRoot: root, dryRun: false })
      await processQueuedJobs({ sharedDataRoot: root, dryRun: false })
      const next = service.documents().find((item) => item.fileId !== first.files[0].workerFileId)!
      const second = service.importDocument(next.fileId, database).source!
      for (const source of [first, second]) {
        database.saveSource({ ...source, origin: 'imported', authors: [], notes: null })
      }
      expect(first.title).toBe(second.title)
      expect(first.id).not.toBe(second.id)
      expect(first.files[0].sha256).not.toBe(second.files[0].sha256)
      expect(first.files[0].workerFileId).not.toBe(second.files[0].workerFileId)
      expect(database.search('Amberquartz')).toMatchObject([{ entityId: first.id }])
      expect(database.search('Violetquartz')).toMatchObject([{ entityId: second.id }])
      expect(service.importDocument(next.fileId, database)).toMatchObject({ duplicate: true })
    } finally {
      database.close()
    }
  })

  it('keeps OCR-required imports metadata-only and rejects failed jobs', async () => {
    const root = await completedWorkerRoot('scan.pdf', simplePdf())
    const service = new SharedWorkerService({ [DATA_ROOT_ENV]: root })
    const database = new WorkspaceDatabase(temporary('research-studio-ocr-search-'))
    try {
      const source = service.importDocument(service.documents()[0].fileId, database).source!
      expect(source.files[0]).toMatchObject({
        workerExtractionStatus: 'needs-ocr',
        extractionText: null,
        mediaType: 'application/pdf'
      })
      expect(database.search('scan', ['source'])).toMatchObject([{ entityId: source.id }])
      expect(database.search('fabricatedbody')).toEqual([])
      expect(database.searchIndexStatus()).toMatchObject({ itemCount: 1, pageCount: 0 })
      writeFileSync(join(sharedFolderPath(root, 'inbox'), 'unsupported.bin'), 'Failedbody')
      scanInbox({ sharedDataRoot: root, dryRun: false })
      await processQueuedJobs({ sharedDataRoot: root, dryRun: false })
      const failed = service.documents().find((item) => item.filename === 'unsupported.bin')!
      expect(failed.jobStatus).toBe('failed')
      expect(service.importDocument(failed.fileId, database)).toMatchObject({
        imported: false,
        source: null
      })
      expect(database.search('Failedbody')).toEqual([])
    } finally {
      database.close()
    }
  })

  it('searches canonical PDF text while retaining the managed PDF reader attachment', async () => {
    const root = await completedWorkerRoot('embedded.pdf', simplePdf('Luminous archival passage'))
    const service = new SharedWorkerService({ [DATA_ROOT_ENV]: root })
    const database = new WorkspaceDatabase(temporary('research-studio-pdf-search-'))
    try {
      const source = service.importDocument(service.documents()[0].fileId, database).source!
      database.saveSource({ ...source, origin: 'imported', authors: [], notes: null })
      rmSync(root, { recursive: true, force: true })
      expect(database.search('Luminous archival', ['source'])).toMatchObject([
        { entityId: source.id, sourceFileId: null, page: null }
      ])
      expect(database.getSource(source.id).files[0]).toMatchObject({
        mediaType: 'application/pdf',
        extractionText: expect.stringContaining('Luminous archival passage')
      })
      expect(Buffer.from(database.pdfData(source.files[0].id)).subarray(0, 5).toString()).toBe(
        '%PDF-'
      )
      expect(database.searchIndexStatus().pageCount).toBe(0)
    } finally {
      database.close()
    }
  })

  it('reports not-configured and unavailable without blocking the app', () => {
    expect(new SharedWorkerService({}).status()).toMatchObject({
      connection: 'not-configured',
      root: null
    })
    const missing = join(temporary('research-studio-missing-'), 'does-not-exist')
    expect(new SharedWorkerService({ [DATA_ROOT_ENV]: missing }).status()).toMatchObject({
      connection: 'unavailable',
      root: missing
    })
  })

  it('discovers valid documents and reports job counts', async () => {
    const root = await completedWorkerRoot()
    const service = new SharedWorkerService({ [DATA_ROOT_ENV]: root })
    expect(service.status()).toMatchObject({
      connection: 'connected',
      queuedJobs: 0,
      workingJobs: 0,
      completedJobs: 1,
      failedJobs: 0,
      processedFiles: 1
    })
    expect(service.documents()[0]).toMatchObject({
      filename: 'shared.txt',
      extension: 'txt',
      extractionStatus: 'extracted',
      jobStatus: 'complete',
      preservedSourcePath: expect.any(String),
      extractedTextPath: expect.any(String)
    })
    expect(service.status().latestActivity).toContain('job-completed')
  })

  it('returns invalid-state for malformed manifests and rejects traversal paths', async () => {
    const root = temporary('research-studio-invalid-worker-')
    scanInbox({ sharedDataRoot: root, dryRun: false })
    writeFileSync(manifestPath(root, 'files.json'), '{malformed')
    expect(new SharedWorkerService({ [DATA_ROOT_ENV]: root }).status()).toMatchObject({
      connection: 'invalid-state'
    })

    const validRoot = await completedWorkerRoot()
    const filesPath = manifestPath(validRoot, 'files.json')
    const files = JSON.parse(readFileSync(filesPath, 'utf8')) as { files: { sourcePath: string }[] }
    files.files[0].sourcePath = join(validRoot, '..', 'outside.txt')
    writeFileSync(filesPath, JSON.stringify(files))
    expect(new SharedWorkerService({ [DATA_ROOT_ENV]: validRoot }).documents()).toEqual([])
  })

  it('imports canonical extraction text into a normal source and prevents duplicates', async () => {
    const root = await completedWorkerRoot('import.md', '# Imported\n\nCanonical text')
    const database = new WorkspaceDatabase(temporary('research-studio-import-'), 'Import test')
    const service = new SharedWorkerService({ [DATA_ROOT_ENV]: root })
    const fileId = service.documents()[0].fileId

    const imported = service.importDocument(fileId, database)
    expect(imported).toMatchObject({
      imported: true,
      duplicate: false,
      source: { title: 'import.md' }
    })
    const source = imported.source!
    expect(source.origin).toBe('imported')
    expect(source.provenanceNote).toContain(fileId)
    expect(source.files[0]).toMatchObject({
      workerFileId: fileId,
      workerJobId: expect.any(String),
      workerExtractionStatus: 'extracted',
      extractionText: '# Imported\n\nCanonical text'
    })
    expect(service.importDocument(fileId, database)).toMatchObject({
      imported: false,
      duplicate: true,
      source: { id: source.id }
    })
    database.close()
  })

  it('keeps needs-ocr visible and does not make it an import failure', async () => {
    const root = await completedWorkerRoot('scan.pdf', simplePdf())
    const document = new SharedWorkerService({ [DATA_ROOT_ENV]: root }).documents()[0]
    expect(document).toMatchObject({
      extractionStatus: 'needs-ocr',
      jobStatus: 'complete',
      warnings: expect.arrayContaining(['No embedded PDF text was found; OCR is required.'])
    })
    expect(existsSync(document.preservedSourcePath!)).toBe(true)
  })
})
