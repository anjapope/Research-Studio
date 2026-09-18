import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FileSearch,
  FileText,
  FolderOpen,
  FolderKanban,
  Library,
  Mic2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type {
  Source,
  SourceDraft,
  SourceQuery,
  SourceStatus,
  SourceType,
  SourceFile,
  WorkspaceInfo,
  SearchResult
} from '../../shared/domain'
import { SOURCE_STATUSES, SOURCE_TYPES } from '../../shared/domain'
import SourceEditor from './components/SourceEditor'
import PdfReader from './components/PdfReader'
import ProjectsView from './components/ProjectsView'
import InterviewsView from './components/InterviewsView'
import AnalysisView from './components/AnalysisView'
import PreservationView from './components/PreservationView'
import DiscoveryView from './components/DiscoveryView'
import TeachingView from './components/TeachingView'
import SharedWorkerPanel from './components/SharedWorkerPanel'

function messageFrom(error: unknown): string {
  if (!(error instanceof Error)) return 'Something went wrong.'
  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

type ActiveView =
  'sources' | 'projects' | 'interviews' | 'analysis' | 'discovery' | 'preservation' | 'teaching'

function App(): React.JSX.Element {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Source | 'new' | null>(null)
  const [reading, setReading] = useState<{
    source: Source
    file: SourceFile
    page?: number
  } | null>(null)
  const [focusedInterviewId, setFocusedInterviewId] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<ActiveView>('sources')
  const [query, setQuery] = useState<SourceQuery>({ sourceType: 'all', status: 'all' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const selected = sources.find((source) => source.id === selectedId) ?? null

  const navigate = useCallback(async (view: ActiveView): Promise<boolean> => {
    if (!(await window.api.lifecycle.flushBeforeNavigation())) return false
    setActiveView(view)
    return true
  }, [])

  async function openSearchResult(result: SearchResult): Promise<void> {
    try {
      if (result.type === 'source') {
        const source = await window.api.sources.get(result.entityId)
        setSources((current) => [source, ...current.filter((item) => item.id !== source.id)])
        setQuery({ sourceType: 'all', status: 'all' })
        if (!(await navigate('sources'))) return
        setSelectedId(result.entityId)
        return
      }
      if ((result.type === 'pdf-page' || result.type === 'evidence') && result.parentId) {
        const source = await window.api.sources.get(result.parentId)
        const file =
          source.files.find((item) => item.id === result.sourceFileId) ?? source.files[0] ?? null
        if (!file) throw new Error('The PDF linked to this search result is unavailable.')
        setReading({ source, file, page: result.page ?? 1 })
        return
      }
      if (result.type === 'transcript' && result.parentId) {
        setFocusedInterviewId(result.parentId)
        if (!(await navigate('interviews'))) return
        return
      }
      if (result.type === 'memo') {
        if (!(await navigate('analysis'))) return
        setNotice('Opened Analysis. The matching synthesis memo is available in the memo panel.')
        return
      }
      if (result.type === 'manuscript') {
        if (!(await navigate('projects'))) return
        setNotice('Opened Projects. The matching manuscript is available in its project.')
      }
    } catch (caught) {
      setError(messageFrom(caught))
    }
  }

  const loadSources = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.sources.list(query)
      setSources(next)
      setSelectedId((current) =>
        current && next.some((source) => source.id === current) ? current : (next[0]?.id ?? null)
      )
    } catch (caught) {
      setError(messageFrom(caught))
    }
  }, [query])

  useEffect(() => {
    window.api.workspace
      .recent()
      .then((recent) => setWorkspace(recent))
      .catch((caught) => setError(messageFrom(caught)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        void navigate('discovery').then((navigated) => {
          if (navigated)
            window.setTimeout(() => document.getElementById('workspace-search')?.focus(), 0)
        })
      }
    }
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [navigate])

  useEffect(() => {
    if (!workspace) return
    const timer = window.setTimeout(loadSources, 160)
    return () => window.clearTimeout(timer)
  }, [loadSources, workspace])

  async function chooseWorkspace(mode: 'create' | 'open'): Promise<void> {
    try {
      setError(null)
      const next = await window.api.workspace.choose(mode)
      if (next) {
        setWorkspace(next)
        setSelectedId(null)
      }
    } catch (caught) {
      setError(messageFrom(caught))
    }
  }

  async function saveSource(draft: SourceDraft): Promise<void> {
    try {
      const saved = await window.api.sources.save(draft)
      setEditing(null)
      await loadSources()
      setSelectedId(saved.id)
    } catch (caught) {
      throw new Error(messageFrom(caught))
    }
  }

  async function attachPdf(): Promise<void> {
    if (!selected) return
    try {
      const attached = await window.api.sources.attachPdf(selected.id)
      if (attached) await loadSources()
    } catch (caught) {
      setError(messageFrom(caught))
    }
  }

  async function openSourceFile(file: SourceFile): Promise<void> {
    if (file.mediaType === 'application/pdf') {
      if (selected) setReading({ source: selected, file })
      return
    }
    try {
      await window.api.sources.openFile(file.id)
    } catch (caught) {
      setError(messageFrom(caught))
    }
  }

  async function removeSource(): Promise<void> {
    if (!selected || !window.confirm(`Delete “${selected.title}” from this workspace?`)) return
    try {
      await window.api.sources.remove(selected.id)
      await loadSources()
    } catch (caught) {
      setError(messageFrom(caught))
    }
  }

  async function importLibrary(): Promise<void> {
    try {
      setError(null)
      setNotice(null)
      const result = await window.api.sources.importLibrary()
      if (!result) return
      await loadSources()
      setNotice(
        `Imported ${result.imported} ${result.imported === 1 ? 'source' : 'sources'} from ${result.fileName}` +
          (result.skipped
            ? ` · ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'} skipped`
            : '')
      )
    } catch (caught) {
      setError(messageFrom(caught))
    }
  }

  async function exportLibrary(format: 'csl-json' | 'bibtex'): Promise<void> {
    try {
      setError(null)
      setNotice(null)
      const count = await window.api.sources.exportLibrary(format)
      if (count !== null) {
        setNotice(
          `Exported ${count} ${count === 1 ? 'source' : 'sources'} as ${format === 'csl-json' ? 'CSL JSON' : 'BibTeX'}.`
        )
      }
    } catch (caught) {
      setError(messageFrom(caught))
    }
  }

  if (loading) {
    return (
      <main className="launch-screen">
        <div className="brand-mark">
          <BookOpen size={24} />
        </div>
        <p>Opening Research Studio…</p>
      </main>
    )
  }

  if (!workspace) {
    return (
      <main className="welcome">
        <section className="welcome-card">
          <div className="wordmark">
            <span className="brand-mark">
              <BookOpen size={22} />
            </span>{' '}
            Research Studio
          </div>
          <div className="welcome-copy">
            <p className="eyebrow">A quieter place for serious work</p>
            <h1>Your research, held together.</h1>
            <p>
              Build a durable local library of sources and the provenance behind them. Everything
              stays on this computer.
            </p>
          </div>
          <div className="welcome-actions">
            <button className="button primary large" onClick={() => chooseWorkspace('create')}>
              <Plus size={18} /> Create workspace
            </button>
            <button className="button secondary large" onClick={() => chooseWorkspace('open')}>
              <FolderOpen size={18} /> Open workspace
            </button>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={16} /> Offline by design · No account required
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
        </section>
        <aside className="welcome-art" aria-hidden="true">
          <div className="paper paper-one">
            <span>FIELD NOTES</span>
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="paper paper-two">
            <FileText size={24} />
            <i />
            <i />
            <i />
          </div>
          <div className="paper paper-three">
            <Sparkles size={18} />
            <strong>Evidence before inference.</strong>
          </div>
        </aside>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="wordmark sidebar-wordmark">
          <span className="brand-mark">
            <BookOpen size={20} />
          </span>
          <span>Research Studio</span>
        </div>
        <div className="workspace-switcher" title={workspace.path}>
          <div className="workspace-avatar">{workspace.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{workspace.name}</strong>
            <span>Local workspace</span>
          </div>
          <MoreHorizontal size={17} />
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          <button
            className={`nav-item ${activeView === 'sources' ? 'active' : ''}`}
            onClick={() => void navigate('sources')}
          >
            <Library size={18} /> Sources <span>{sources.length}</span>
          </button>
          <button
            className={`nav-item ${activeView === 'projects' ? 'active' : ''}`}
            onClick={() => void navigate('projects')}
          >
            <FolderKanban size={18} /> Projects
          </button>
          <button
            className={`nav-item ${activeView === 'interviews' ? 'active' : ''}`}
            onClick={() => void navigate('interviews')}
          >
            <Mic2 size={18} /> Interviews
          </button>
          <button
            className={`nav-item ${activeView === 'analysis' ? 'active' : ''}`}
            onClick={() => void navigate('analysis')}
          >
            <BarChart3 size={18} /> Analysis
          </button>
          <button
            className={`nav-item ${activeView === 'discovery' ? 'active' : ''}`}
            onClick={() => void navigate('discovery')}
          >
            <FileSearch size={18} /> Discover
          </button>
          <button
            className={`nav-item ${activeView === 'preservation' ? 'active' : ''}`}
            onClick={() => void navigate('preservation')}
          >
            <ShieldCheck size={18} /> Preservation
          </button>
          <button
            className={`nav-item ${activeView === 'teaching' ? 'active' : ''}`}
            onClick={() => void navigate('teaching')}
          >
            <BookOpen size={18} /> Teaching &amp; Instruction
          </button>
        </nav>
        <div className="sidebar-footer">
          <div className="local-status">
            <span className="status-dot" /> Saved locally
          </div>
          <button className="text-button" onClick={() => chooseWorkspace('open')}>
            <FolderOpen size={15} /> Switch workspace
          </button>
        </div>
      </aside>

      {activeView === 'sources' ? (
        <main className="main-content">
          <header className="topbar">
            <div>
              <p className="eyebrow">Library</p>
              <h1>Sources</h1>
            </div>
            <div className="topbar-actions">
              <button className="button secondary" onClick={importLibrary}>
                <Upload size={16} /> Import
              </button>
              <div className="export-actions">
                <span>
                  <Download size={15} /> Export
                </span>
                <button onClick={() => exportLibrary('csl-json')}>CSL JSON</button>
                <button onClick={() => exportLibrary('bibtex')}>BibTeX</button>
              </div>
              <button className="button primary" onClick={() => setEditing('new')}>
                <Plus size={17} /> Add source
              </button>
            </div>
          </header>

          {error && (
            <div className="error-banner inline" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice-banner" role="status">
              <Check size={15} />
              <span>{notice}</span>
              <button aria-label="Dismiss message" onClick={() => setNotice(null)}>
                <X size={16} />
              </button>
            </div>
          )}

          <section className="library-toolbar" aria-label="Source filters">
            <label className="search-field">
              <Search size={17} />
              <span className="sr-only">Search sources</span>
              <input
                id="source-search"
                value={query.search ?? ''}
                onChange={(event) => setQuery({ ...query, search: event.target.value })}
                placeholder="Search title, author, tag, DOI…"
                autoComplete="off"
              />
              <kbd>Ctrl K</kbd>
            </label>
            <label>
              <span className="sr-only">Filter by source type</span>
              <select
                value={query.sourceType}
                onChange={(event) =>
                  setQuery({ ...query, sourceType: event.target.value as SourceType | 'all' })
                }
              >
                <option value="all">All types</option>
                {SOURCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {titleCase(type)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by reading status</span>
              <select
                value={query.status}
                onChange={(event) =>
                  setQuery({ ...query, status: event.target.value as SourceStatus | 'all' })
                }
              >
                <option value="all">All statuses</option>
                {SOURCE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {titleCase(status)}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <SharedWorkerPanel onError={setError} onNotice={setNotice} onImported={loadSources} />

          <div className="library-layout">
            <section className="source-list" aria-label="Sources">
              <div className="list-heading">
                <span>
                  {sources.length} {sources.length === 1 ? 'source' : 'sources'}
                </span>
                <span>Updated</span>
              </div>
              {sources.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <Library size={24} />
                  </div>
                  <h2>
                    {query.search || query.sourceType !== 'all' || query.status !== 'all'
                      ? 'No matching sources'
                      : 'Begin your library'}
                  </h2>
                  <p>
                    {query.search
                      ? 'Try a broader search or clear a filter.'
                      : 'Add a book, article, report, or other work you want to keep close.'}
                  </p>
                  {!query.search && (
                    <button className="button primary" onClick={() => setEditing('new')}>
                      <Plus size={17} /> Add first source
                    </button>
                  )}
                </div>
              ) : (
                sources.map((source) => (
                  <button
                    key={source.id}
                    className={`source-row ${selectedId === source.id ? 'selected' : ''}`}
                    onClick={() => setSelectedId(source.id)}
                  >
                    <div className={`type-icon ${source.sourceType}`}>
                      <FileText size={19} />
                    </div>
                    <div className="source-summary">
                      <strong>{source.title}</strong>
                      <span>
                        {source.authors.map((author) => author.displayName).join(', ') ||
                          'Unknown author'}
                        {source.year ? ` · ${source.year}` : ''}
                      </span>
                      <div className="row-meta">
                        <span className={`status-pill ${source.status}`}>
                          {titleCase(source.status)}
                        </span>
                        {source.tags.slice(0, 2).map((tag) => (
                          <span className="tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                        {source.files.length > 0 && (
                          <span className="attachment-count">
                            <Paperclip size={12} /> {source.files.length}
                          </span>
                        )}
                      </div>
                    </div>
                    <time>
                      {new Intl.DateTimeFormat(undefined, {
                        month: 'short',
                        day: 'numeric'
                      }).format(new Date(source.updatedAt))}
                    </time>
                    <ChevronRight size={17} className="row-chevron" />
                  </button>
                ))
              )}
            </section>

            <aside className="detail-panel" aria-label="Source details">
              {selected ? (
                <>
                  <div className="detail-actions">
                    <span className="record-origin">
                      <ShieldCheck size={14} />{' '}
                      {selected.origin === 'user' ? 'User-authored record' : 'Imported record'}
                    </span>
                    <div>
                      <button
                        className="icon-button"
                        aria-label="Edit source"
                        onClick={() => setEditing(selected)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-button danger"
                        aria-label="Delete source"
                        onClick={removeSource}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="detail-title">
                    <span className="type-label">{titleCase(selected.sourceType)}</span>
                    <h2>{selected.title}</h2>
                    <p>
                      {selected.authors.map((author) => author.displayName).join(', ') ||
                        'Unknown author'}
                      {selected.year ? ` · ${selected.year}` : ''}
                    </p>
                  </div>
                  <dl className="metadata-grid">
                    {selected.publicationTitle && (
                      <>
                        <dt>Published in</dt>
                        <dd>{selected.publicationTitle}</dd>
                      </>
                    )}
                    {selected.publisher && (
                      <>
                        <dt>Publisher</dt>
                        <dd>{selected.publisher}</dd>
                      </>
                    )}
                    {selected.doi && (
                      <>
                        <dt>DOI</dt>
                        <dd>{selected.doi}</dd>
                      </>
                    )}
                    {selected.url && (
                      <>
                        <dt>URL</dt>
                        <dd className="truncate">{selected.url}</dd>
                      </>
                    )}
                  </dl>
                  {selected.abstract && (
                    <section className="detail-section">
                      <h3>Abstract</h3>
                      <p>{selected.abstract}</p>
                    </section>
                  )}
                  {selected.notes && (
                    <section className="detail-section notes">
                      <h3>Research notes</h3>
                      <p>{selected.notes}</p>
                    </section>
                  )}
                  {selected.tags.length > 0 && (
                    <section className="detail-section">
                      <h3>Tags</h3>
                      <div className="tags">
                        {selected.tags.map((tag) => (
                          <span className="tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </section>
                  )}
                  <section className="detail-section files-section">
                    <div className="section-heading">
                      <h3>Files</h3>
                      <button className="text-button" onClick={attachPdf}>
                        <Paperclip size={14} /> Attach PDF
                      </button>
                    </div>
                    {selected.files.length === 0 ? (
                      <p className="muted">No PDF attached.</p>
                    ) : (
                      selected.files.map((file) => (
                        <button
                          className="file-card"
                          key={file.id}
                          onClick={() => void openSourceFile(file)}
                        >
                          <span>
                            <FileText size={19} />
                          </span>
                          <div>
                            <strong>{file.originalName}</strong>
                            <small>
                              {(file.byteSize / 1_048_576).toFixed(1)} MB · Read and capture
                              evidence
                            </small>
                          </div>
                          <ChevronRight size={16} />
                        </button>
                      ))
                    )}
                  </section>
                  <section className="provenance-card">
                    <div>
                      <Clock3 size={15} />
                      <strong>Record provenance</strong>
                    </div>
                    <p>
                      {selected.provenanceNote ||
                        (selected.origin === 'user'
                          ? 'Created manually in Research Studio.'
                          : 'Imported by the user.')}
                    </p>
                    <small>
                      Created {new Date(selected.createdAt).toLocaleString()} · Updated{' '}
                      {new Date(selected.updatedAt).toLocaleString()}
                    </small>
                  </section>
                </>
              ) : (
                <div className="detail-placeholder">
                  <ArrowLeft size={20} />
                  <p>Select a source to inspect its metadata and provenance.</p>
                </div>
              )}
            </aside>
          </div>
        </main>
      ) : activeView === 'teaching' ? (
        <main className="main-content">
          <TeachingView key={workspace.id} />
        </main>
      ) : activeView === 'projects' ? (
        <main className="main-content">
          <ProjectsView onError={setError} onNotice={setNotice} />
          {error && (
            <div className="error-banner floating-message" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice-banner floating-message" role="status">
              <Check size={15} />
              <span>{notice}</span>
              <button aria-label="Dismiss message" onClick={() => setNotice(null)}>
                <X size={16} />
              </button>
            </div>
          )}
        </main>
      ) : activeView === 'interviews' ? (
        <main className="main-content">
          <InterviewsView
            initialInterviewId={focusedInterviewId}
            onError={setError}
            onNotice={setNotice}
          />
          {error && (
            <div className="error-banner floating-message" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice-banner floating-message" role="status">
              <Check size={15} />
              <span>{notice}</span>
              <button aria-label="Dismiss message" onClick={() => setNotice(null)}>
                <X size={16} />
              </button>
            </div>
          )}
        </main>
      ) : activeView === 'analysis' ? (
        <main className="main-content">
          <AnalysisView onError={setError} onNotice={setNotice} />
          {error && (
            <div className="error-banner floating-message" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice-banner floating-message" role="status">
              <Check size={15} />
              <span>{notice}</span>
              <button aria-label="Dismiss message" onClick={() => setNotice(null)}>
                <X size={16} />
              </button>
            </div>
          )}
        </main>
      ) : activeView === 'discovery' ? (
        <main className="main-content">
          <DiscoveryView onOpen={openSearchResult} onError={setError} onNotice={setNotice} />
          {error && (
            <div className="error-banner floating-message" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice-banner floating-message" role="status">
              <Check size={15} />
              <span>{notice}</span>
              <button aria-label="Dismiss message" onClick={() => setNotice(null)}>
                <X size={16} />
              </button>
            </div>
          )}
        </main>
      ) : (
        <main className="main-content">
          <PreservationView
            workspace={workspace}
            onWorkspaceRestored={(restored) => {
              setWorkspace(restored)
              setActiveView('sources')
              setSelectedId(null)
              void loadSources()
            }}
            onError={setError}
            onNotice={setNotice}
          />
          {error && (
            <div className="error-banner floating-message" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice-banner floating-message" role="status">
              <Check size={15} />
              <span>{notice}</span>
              <button aria-label="Dismiss message" onClick={() => setNotice(null)}>
                <X size={16} />
              </button>
            </div>
          )}
        </main>
      )}

      {editing && (
        <SourceEditor
          source={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={saveSource}
        />
      )}
      {reading && (
        <PdfReader
          source={reading.source}
          file={reading.file}
          initialPage={reading.page}
          onClose={() => setReading(null)}
          onError={setError}
        />
      )}
    </div>
  )
}

export default App
