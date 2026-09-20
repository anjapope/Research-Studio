import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceDatabase } from './database'
import {
  checkWorkspaceIntegrity,
  createWorkspacePackage,
  qualitativeCsv,
  readWorkspacePackage,
  restoreWorkspacePackage
} from './preservation'

const paths: string[] = []

function temporary(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name))
  paths.push(path)
  return path
}

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('workspace preservation', () => {
  it('creates a verified package and restores complete research into an empty workspace', () => {
    const sourcePath = temporary('research-studio-source-')
    const packageRoot = temporary('research-studio-packages-')
    const restorePath = temporary('research-studio-restore-')
    const database = new WorkspaceDatabase(sourcePath, 'Preserved Study')
    const source = database.saveSource({
      title: 'Local evidence',
      sourceType: 'report',
      status: 'reviewed',
      authors: ['Researcher'],
      year: 2026,
      publicationTitle: null,
      publisher: null,
      doi: null,
      url: null,
      abstract: null,
      notes: null,
      tags: ['preservation'],
      origin: 'user',
      provenanceNote: 'Created locally.'
    })
    const pdf = join(sourcePath, 'evidence.pdf')
    writeFileSync(pdf, '%PDF-1.4 preserved evidence')
    const sourceFile = database.attachPdf(source.id, pdf)
    const interview = database.saveInterview({
      projectId: null,
      title: 'Preservation interview',
      participantName: 'P01',
      occurredAt: null,
      consentNote: 'Local analysis only.',
      status: 'recorded'
    })
    const audio = join(sourcePath, 'recording.wav')
    writeFileSync(audio, 'preserved interview recording')
    const media = database.attachInterviewMedia(interview.id, audio)
    const project = database.saveProject({
      title: 'Preservation project',
      researchQuestion: 'Can all managed files be restored?',
      description: null,
      status: 'active'
    })
    const notes = join(sourcePath, 'field-notes.md')
    writeFileSync(notes, '# Durable project notes')
    const projectFile = database.importProjectFiles(project.id, [notes]).project.files[0]
    database.saveTranscriptSegment(interview.id, {
      speaker: 'P01',
      startSeconds: 1,
      endSeconds: 5,
      text: 'This evidence should survive restoration.',
      position: 0,
      codeNames: ['Durability']
    })

    database.saveLesson({ id: 'lesson-test', title: 'Next week', audience: 'Class', duration: 60,
      objectives: 'Compare readings', sources: [{ id: 'reading', title: 'Reading', text: 'Source text' }],
      synthesis: 'Synthesis', notes: 'Lecture notes', slides: '# Slides' })
    const created = createWorkspacePackage(database, packageRoot)
    const manifest = readWorkspacePackage(created.path)
    expect(manifest).toMatchObject({
      format: 'research-studio-workspace',
      version: 1,
      workspace: { name: 'Preserved Study', schemaVersion: 12 }
    })
    expect(manifest.files).toHaveLength(4)
    expect(checkWorkspaceIntegrity(database)).toMatchObject({
      databaseStatus: 'ok',
      missingCount: 0,
      modifiedCount: 0
    })
    database.close()

    const restoredInfo = restoreWorkspacePackage(created.path, restorePath)
    expect(restoredInfo.name).toBe('Preserved Study')
    const restored = new WorkspaceDatabase(restorePath)
    expect(restored.listLessons()[0]).toMatchObject({ title: 'Next week', notes: 'Lecture notes', sources: [{ text: 'Source text' }] })
    expect(restored.getSource(source.id).files[0].sha256).toBe(sourceFile.sha256)
    expect(restored.getInterview(interview.id)).toMatchObject({
      participantName: 'P01',
      segments: [{ text: 'This evidence should survive restoration.' }]
    })
    expect(readFileSync(restored.interviewMediaPath(media.id), 'utf8')).toBe(
      'preserved interview recording'
    )
    expect(readFileSync(restored.projectFilePath(projectFile.id), 'utf8')).toBe(
      '# Durable project notes'
    )
    const csv = qualitativeCsv(
      restored.listInterviews(),
      restored.listCodes(),
      restored.listSynthesisMemos(null)
    )
    expect(csv).toContain('qualitative_code')
    expect(csv).toContain('transcript_segment')
    expect(csv).toContain('Durability')
    expect(csv).toContain('This evidence should survive restoration.')
    restored.close()
  })

  it('reports missing managed files and rejects corrupted or unsafe packages', () => {
    const sourcePath = temporary('research-studio-source-')
    const packageRoot = temporary('research-studio-packages-')
    const rejectedPackageRoot = temporary('research-studio-rejected-packages-')
    const failedRestorePath = temporary('research-studio-failed-restore-')
    const database = new WorkspaceDatabase(sourcePath, 'Integrity Study')
    const source = database.saveSource({
      title: 'Integrity evidence',
      sourceType: 'other',
      status: 'unread',
      authors: [],
      year: null,
      publicationTitle: null,
      publisher: null,
      doi: null,
      url: null,
      abstract: null,
      notes: null,
      tags: [],
      origin: 'user',
      provenanceNote: null
    })
    const pdf = join(sourcePath, 'integrity.pdf')
    writeFileSync(pdf, '%PDF-1.4 integrity')
    const attached = database.attachPdf(source.id, pdf)
    const created = createWorkspacePackage(database, packageRoot)

    writeFileSync(database.filePath(attached.id), 'externally modified')
    expect(() => createWorkspacePackage(database, rejectedPackageRoot)).toThrow(
      'Cannot back up modified managed file'
    )
    unlinkSync(database.filePath(attached.id))
    expect(checkWorkspaceIntegrity(database)).toMatchObject({
      missingCount: 1,
      modifiedCount: 0
    })
    database.close()

    const snapshotPath = join(created.path, 'workspace.sqlite3')
    writeFileSync(snapshotPath, 'corrupted database')
    expect(() => readWorkspacePackage(created.path)).toThrow(
      'failed its integrity check for workspace.sqlite3'
    )

    const manifestPath = join(created.path, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: { relativePath: string; byteSize: number; sha256: string }[]
    }
    const snapshotEntry = manifest.files.find((file) => file.relativePath === 'workspace.sqlite3')!
    snapshotEntry.byteSize = 18
    snapshotEntry.sha256 = createHash('sha256').update('corrupted database').digest('hex')
    writeFileSync(manifestPath, JSON.stringify(manifest))
    expect(() => restoreWorkspacePackage(created.path, failedRestorePath)).toThrow()
    expect(existsSync(join(failedRestorePath, '.research-studio'))).toBe(false)

    manifest.files[0].relativePath = '..\\outside.sqlite3'
    writeFileSync(manifestPath, JSON.stringify(manifest))
    expect(() => readWorkspacePackage(created.path)).toThrow(
      'workspace package contains an unsupported file path'
    )
  })
})
