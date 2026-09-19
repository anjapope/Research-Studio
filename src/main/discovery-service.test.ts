import { describe, expect, it, vi } from 'vitest'
import type { SearchIndexStatus, SearchResult } from '../shared/domain'
import { DiscoveryService } from './discovery-service'

describe('DiscoveryService', () => {
  it('trims and validates the query before searching the active workspace database', () => {
    const results: SearchResult[] = [
      {
        type: 'pdf-page',
        entityId: 'page-1',
        parentId: 'source-1',
        sourceFileId: 'file-1',
        page: 4,
        title: 'Source title',
        context: 'PDF page 4 · pdf-text',
        snippet: 'Matched snippet',
        score: -1.25
      }
    ]
    const database = {
      search: vi.fn().mockReturnValue(results)
    }
    const service = new DiscoveryService(() => database as never)

    expect(service.search('  tacit knowledge  ', ['pdf-page'])).toEqual(results)
    expect(database.search).toHaveBeenCalledWith('tacit knowledge', ['pdf-page'])
  })

  it('delegates index status and rebuild operations to the active workspace database', () => {
    const status: SearchIndexStatus = {
      dirty: true,
      indexedAt: '2026-09-17T12:00:00.000Z',
      itemCount: 12,
      pageCount: 3,
      ocrPageCount: 1
    }
    const rebuilt: SearchIndexStatus = {
      dirty: false,
      indexedAt: '2026-09-17T12:05:00.000Z',
      itemCount: 18,
      pageCount: 4,
      ocrPageCount: 2
    }
    const database = {
      searchIndexStatus: vi.fn().mockReturnValue(status),
      rebuildSearchIndex: vi.fn().mockReturnValue(rebuilt)
    }
    const service = new DiscoveryService(() => database as never)

    expect(service.searchIndexStatus()).toEqual(status)
    expect(service.rebuildSearchIndex()).toEqual(rebuilt)
    expect(database.searchIndexStatus).toHaveBeenCalledTimes(1)
    expect(database.rebuildSearchIndex).toHaveBeenCalledTimes(1)
  })

  it('rejects empty queries before calling the database', () => {
    const database = {
      search: vi.fn()
    }
    const service = new DiscoveryService(() => database as never)

    expect(() => service.search('   ')).toThrow()
    expect(database.search).not.toHaveBeenCalled()
  })
})
