import { randomUUID } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, it } from 'vitest'
import { WorkspaceDatabase } from './database'
import { migrations } from './migrations'

it('backfills a clean Stage D index and tracks extraction changes without re-import', () => {
  const path = mkdtempSync(join(tmpdir(), 'research-studio-stage-d-search-'))
  const storage = join(path, '.research-studio')
  mkdirSync(storage)
  const dbPath = join(storage, 'workspace.sqlite3')
  const sourceId = randomUUID()
  const fileId = randomUUID()
  const workerId = 'file-9b07ed0fb515b4d71483b3d518abb4f1b9e06e68f8b3a8847a5d506ccb1c1a14'
  const checksum = 'a'.repeat(64)
  const now = new Date().toISOString()
  const legacy = new DatabaseSync(dbPath)
  try {
    legacy.exec(
      'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
    )
    for (const migration of migrations.filter((item) => item.version <= 11)) {
      legacy.exec(migration.sql)
      legacy
        .prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)')
        .run(migration.version, migration.name, now)
    }
    legacy
      .prepare('INSERT INTO workspace VALUES (?, ?, ?, ?, 11)')
      .run(randomUUID(), 'Stage D workspace', now, now)
    legacy
      .prepare(
        `INSERT INTO sources
      (id, title, source_type, status, origin, created_at, updated_at)
      VALUES (?, 'mayday1-test.txt.txt', 'other', 'unread', 'imported', ?, ?)`
      )
      .run(sourceId, now, now)
    legacy
      .prepare(
        `INSERT INTO source_files
      (id, source_id, original_name, relative_path, media_type, byte_size, sha256, imported_at,
       worker_file_id, worker_extraction_status)
      VALUES (?, ?, 'mayday1-test.txt.txt', 'files/legacy.txt', 'text/plain', 20, ?, ?, ?, 'extracted')`
      )
      .run(fileId, sourceId, checksum, now, workerId)
    legacy
      .prepare(
        `INSERT INTO source_extractions
      (source_file_id, extraction_status, text, imported_at, updated_at)
      VALUES (?, 'extracted', 'Quasar archaeology canonical passage', ?, ?)`
      )
      .run(fileId, now, now)
    // Stage D's last rebuild indexed metadata, with no extraction in editable notes.
    legacy
      .prepare(
        `INSERT INTO search_index (entity_type, entity_id, title, content)
      VALUES ('source', ?, 'mayday1-test.txt.txt', 'mayday1-test.txt.txt')`
      )
      .run(sourceId)
    legacy.exec('UPDATE search_index_state SET dirty = 0, item_count = 1 WHERE id = 1')
  } finally {
    legacy.close()
  }

  const database = new WorkspaceDatabase(path)
  const sql = new DatabaseSync(dbPath)
  try {
    expect(database.searchIndexStatus().dirty).toBe(true)
    expect(database.search('Quasar archaeology', ['source'])).toMatchObject([
      { type: 'source', entityId: sourceId }
    ])
    database.rebuildSearchIndex()
    database.rebuildSearchIndex()
    expect(database.search('Quasar archaeology')).toHaveLength(1)
    expect(database.searchIndexStatus()).toMatchObject({ dirty: false, itemCount: 1 })
    expect(database.getSource(sourceId).files[0]).toMatchObject({
      workerFileId: workerId,
      sha256: checksum,
      sourceId,
      importedAt: now
    })

    for (const status of ['needs-ocr', 'failed']) {
      sql.prepare('UPDATE source_extractions SET extraction_status = ?').run(status)
      expect(database.searchIndexStatus().dirty).toBe(true)
      expect(database.search('Quasar')).toEqual([])
      expect(database.search('mayday1')).toHaveLength(1)
    }
    sql.exec("UPDATE source_extractions SET extraction_status = 'extracted', text = '   '")
    expect(database.search('Quasar')).toEqual([])
    sql.exec('DELETE FROM source_extractions')
    expect(database.searchIndexStatus().dirty).toBe(true)
    database.search('Quasar')
    sql
      .prepare(
        `INSERT INTO source_extractions
      (source_file_id, extraction_status, text, imported_at, updated_at)
      VALUES (?, 'extracted', 'Replacementcanonical', ?, ?)`
      )
      .run(fileId, now, now)
    expect(database.searchIndexStatus().dirty).toBe(true)
    expect(database.search('Replacementcanonical')).toMatchObject([{ entityId: sourceId }])
    expect(database.listSources()).toHaveLength(1)
  } finally {
    sql.close()
    database.close()
    rmSync(path, { recursive: true, force: true })
  }
})
