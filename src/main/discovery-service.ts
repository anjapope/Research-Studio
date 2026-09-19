import type { SearchIndexStatus, SearchResult, SearchResultType } from '../shared/domain'
import type { WorkspaceDatabase } from './database'
import { discoverySearchSchema } from './validation'

export class DiscoveryService {
  constructor(private readonly requireDatabase: () => WorkspaceDatabase) {}

  search(query: string, types?: SearchResultType[]): SearchResult[] {
    const parsed = discoverySearchSchema.parse({ query, types })
    return this.requireDatabase().search(parsed.query, parsed.types)
  }

  searchIndexStatus(): SearchIndexStatus {
    return this.requireDatabase().searchIndexStatus()
  }

  rebuildSearchIndex(): SearchIndexStatus {
    return this.requireDatabase().rebuildSearchIndex()
  }
}
