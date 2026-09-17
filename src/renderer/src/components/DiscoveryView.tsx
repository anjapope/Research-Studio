import {
  BookOpen,
  FileSearch,
  FileText,
  Highlighter,
  Mic2,
  RefreshCw,
  Search,
  StickyNote,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SearchIndexStatus, SearchResult, SearchResultType } from '../../../shared/domain'

interface Props {
  onOpen: (result: SearchResult) => void
  onError: (message: string) => void
  onNotice: (message: string) => void
}

const types: { value: SearchResultType; label: string }[] = [
  { value: 'source', label: 'Sources' },
  { value: 'pdf-page', label: 'PDF pages' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'transcript', label: 'Transcripts' },
  { value: 'memo', label: 'Memos' },
  { value: 'manuscript', label: 'Manuscripts' }
]

function icon(type: SearchResultType): React.JSX.Element {
  if (type === 'source') return <BookOpen size={17} />
  if (type === 'pdf-page') return <FileText size={17} />
  if (type === 'evidence') return <Highlighter size={17} />
  if (type === 'transcript') return <Mic2 size={17} />
  if (type === 'memo') return <StickyNote size={17} />
  return <FileSearch size={17} />
}

function messageFrom(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'Local search could not be completed.'
}

function DiscoveryView({ onOpen, onError, onNotice }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<SearchResultType[]>([])
  const [results, setResults] = useState<SearchResult[]>([])
  const [status, setStatus] = useState<SearchIndexStatus | null>(null)
  const [searching, setSearching] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)

  useEffect(() => {
    window.api.discovery
      .status()
      .then(setStatus)
      .catch((error) => onError(messageFrom(error)))
  }, [onError])

  useEffect(() => {
    if (!query.trim()) return
    const timer = window.setTimeout(() => {
      setSearching(true)
      window.api.discovery
        .search(query, selectedTypes.length ? selectedTypes : undefined)
        .then(async (next) => {
          setResults(next)
          setStatus(await window.api.discovery.status())
        })
        .catch((error) => onError(messageFrom(error)))
        .finally(() => setSearching(false))
    }, 220)
    return () => window.clearTimeout(timer)
  }, [onError, query, selectedTypes])

  function toggleType(type: SearchResultType): void {
    setSelectedTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type]
    )
  }

  async function rebuild(): Promise<void> {
    setRebuilding(true)
    try {
      const next = await window.api.discovery.rebuild()
      setStatus(next)
      if (query.trim()) {
        setResults(
          await window.api.discovery.search(query, selectedTypes.length ? selectedTypes : undefined)
        )
      }
      onNotice(`Rebuilt the local index with ${next.itemCount} searchable records.`)
    } catch (error) {
      onError(messageFrom(error))
    } finally {
      setRebuilding(false)
    }
  }

  return (
    <div className="discovery-workspace">
      <header className="discovery-header">
        <div>
          <p className="eyebrow">Local document intelligence</p>
          <h1>Discover</h1>
          <p>Search the evidence trail across your complete workspace.</p>
        </div>
        <button className="button secondary" disabled={rebuilding} onClick={rebuild}>
          <RefreshCw size={15} className={rebuilding ? 'spin' : ''} />
          {rebuilding ? 'Rebuilding…' : 'Rebuild index'}
        </button>
      </header>

      <div className="discovery-search">
        <Search size={21} />
        <input
          id="workspace-search"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            if (!event.target.value.trim()) setResults([])
          }}
          placeholder="Search sources, PDF pages, transcripts, memos, manuscripts…"
        />
        {query && (
          <button
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              setResults([])
            }}
          >
            <X size={17} />
          </button>
        )}
      </div>

      <div className="discovery-filters">
        {types.map((type) => (
          <button
            className={selectedTypes.includes(type.value) ? 'active' : ''}
            key={type.value}
            onClick={() => toggleType(type.value)}
          >
            {type.label}
          </button>
        ))}
        <span>
          {status
            ? `${status.itemCount} indexed · ${status.pageCount} PDF pages${status.ocrPageCount ? ` · ${status.ocrPageCount} OCR` : ''}`
            : 'Reading index status…'}
        </span>
      </div>

      <main className="discovery-results">
        {query.trim() ? (
          <>
            <div className="discovery-result-count">
              {searching ? 'Searching locally…' : `${results.length} results`}
            </div>
            {results.map((result) => (
              <button
                className="discovery-result"
                key={`${result.type}-${result.entityId}`}
                onClick={() => onOpen(result)}
              >
                <span className="discovery-result-icon">{icon(result.type)}</span>
                <span className="discovery-result-body">
                  <span className="discovery-result-meta">
                    <b>{result.type.replace('-', ' ')}</b>
                    <small>{result.context}</small>
                  </span>
                  <strong>{result.title}</strong>
                  <p>{result.snippet.replace(/[‹›]/g, '')}</p>
                </span>
              </button>
            ))}
            {!searching && results.length === 0 && (
              <div className="discovery-empty">
                <FileSearch size={28} />
                <h2>No matching research found</h2>
                <p>Try fewer terms, clear type filters, or rebuild the local index.</p>
              </div>
            )}
          </>
        ) : (
          <div className="discovery-empty discovery-intro">
            <Search size={30} />
            <h2>One search across the evidence trail</h2>
            <p>
              PDF page text is indexed as pages are read. Image-only pages can be recognized
              privately with local OCR in the PDF reader.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

export default DiscoveryView
