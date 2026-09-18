import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { DATA_ROOT_ENV } from './automation-config'
import { manifestPath, sharedFolderPath } from './automation-fs'
import { processQueuedJobs } from './automation-processor'
import { scanInbox } from './automation-worker'
import { WorkspaceDatabase } from './database'
import { SharedWorkerService } from './shared-worker-service'

const paths: string[] = []

function temporary(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  paths.push(path)
  return path
}

function emptyPdf(): Buffer {
  const content = 'q Q'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
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

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('SharedWorkerService', () => {
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
    const root = await completedWorkerRoot('scan.pdf', emptyPdf())
    const document = new SharedWorkerService({ [DATA_ROOT_ENV]: root }).documents()[0]
    expect(document).toMatchObject({
      extractionStatus: 'needs-ocr',
      jobStatus: 'complete',
      warnings: expect.arrayContaining(['No embedded PDF text was found; OCR is required.'])
    })
    expect(existsSync(document.preservedSourcePath!)).toBe(true)
  })
})
