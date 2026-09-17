import {
  BarChart3,
  Check,
  Download,
  FilePenLine,
  Filter,
  Link2,
  Plus,
  Search,
  Tags,
  Trash2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type {
  AnalysisResult,
  CodedPassage,
  ProjectSummary,
  SynthesisMemo,
  SynthesisMemoDraft
} from '../../../shared/domain'

interface Props {
  onError: (message: string) => void
  onNotice: (message: string) => void
}

const emptyAnalysis: AnalysisResult = {
  passages: [],
  codes: [],
  availableCodedPassages: 0,
  totalCodedPassages: 0,
  interviewCount: 0
}

function messageFrom(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'The analysis workspace could not be updated.'
}

function timestamp(passage: CodedPassage): string {
  if (passage.startSeconds === null) return 'No timestamp'
  const format = (seconds: number): string =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
  return `${format(passage.startSeconds)}${passage.endSeconds === null ? '' : `–${format(passage.endSeconds)}`}`
}

function AnalysisView({ onError, onNotice }: Props): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [codeId, setCodeId] = useState<string | undefined>()
  const [search, setSearch] = useState('')
  const [analysis, setAnalysis] = useState(emptyAnalysis)
  const [memos, setMemos] = useState<SynthesisMemo[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<SynthesisMemoDraft | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [result, nextMemos] = await Promise.all([
        window.api.analysis.analyze({
          projectId,
          codeId,
          search: search.trim() || undefined
        }),
        window.api.analysis.listMemos(projectId)
      ])
      setAnalysis(result)
      setMemos(nextMemos)
      setSelectedIds((current) => {
        const visible = new Set(result.passages.map((passage) => passage.segmentId))
        return new Set([...current].filter((id) => visible.has(id)))
      })
    } catch (error) {
      onError(messageFrom(error))
    }
  }, [codeId, onError, projectId, search])

  useEffect(() => {
    window.api.projects
      .list()
      .then(setProjects)
      .catch((error) => onError(messageFrom(error)))
  }, [onError])

  useEffect(() => {
    const timer = window.setTimeout(refresh, 180)
    return () => window.clearTimeout(timer)
  }, [refresh])

  function togglePassage(id: string): void {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function createMemo(): void {
    setEditing({
      projectId,
      title: '',
      body: '',
      status: 'working',
      segmentIds: [...selectedIds]
    })
  }

  function editMemo(memo: SynthesisMemo): void {
    setEditing({
      id: memo.id,
      projectId: memo.projectId,
      title: memo.title,
      body: memo.body,
      status: memo.status,
      segmentIds: memo.passages.map((passage) => passage.segmentId)
    })
  }

  async function saveMemo(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!editing) return
    try {
      const saved = await window.api.analysis.saveMemo(editing)
      setEditing(null)
      setSelectedIds(new Set())
      await refresh()
      onNotice(`Saved “${saved.title}” with ${saved.passages.length} linked passages.`)
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function removeMemo(memo: SynthesisMemo): Promise<void> {
    if (!window.confirm(`Delete synthesis memo “${memo.title}”?`)) return
    try {
      await window.api.analysis.removeMemo(memo.id)
      await refresh()
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function exportMemo(memo: SynthesisMemo): Promise<void> {
    try {
      if (await window.api.analysis.exportMemo(memo.id)) {
        onNotice(`Exported “${memo.title}” as traceable Markdown.`)
      }
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  return (
    <div className="analysis-workspace">
      <header className="analysis-header">
        <div>
          <p className="eyebrow">Qualitative synthesis</p>
          <h1>Analysis</h1>
          <p>Compare coded transcript evidence without losing its interview context.</p>
        </div>
        <button className="button primary" onClick={createMemo}>
          <Plus size={16} /> Synthesis memo
          {selectedIds.size > 0 && <span className="selection-count">{selectedIds.size}</span>}
        </button>
      </header>

      <div className="analysis-toolbar">
        <label>
          <span className="sr-only">Project</span>
          <Filter size={15} />
          <select
            value={projectId ?? ''}
            onChange={(event) => {
              setProjectId(event.target.value || null)
              setCodeId(undefined)
              setSelectedIds(new Set())
            }}
          >
            <option value="">All interview projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <label className="analysis-search">
          <Search size={15} />
          <span className="sr-only">Search coded passages</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search passages, speakers, participants…"
          />
          {search && (
            <button aria-label="Clear search" onClick={() => setSearch('')}>
              <X size={14} />
            </button>
          )}
        </label>
        <div className="analysis-summary">
          <strong>{analysis.totalCodedPassages}</strong> passages across{' '}
          <strong>{analysis.interviewCount}</strong> interviews
        </div>
      </div>

      <div className="analysis-grid">
        <aside className="code-panel">
          <div className="panel-title">
            <Tags size={16} />
            <h2>Code distribution</h2>
          </div>
          <button
            className={`code-summary-row ${!codeId ? 'active' : ''}`}
            onClick={() => setCodeId(undefined)}
          >
            <span>All codes</span>
            <b>{analysis.availableCodedPassages}</b>
          </button>
          {analysis.codes.map((code) => (
            <button
              className={`code-summary-row ${codeId === code.id ? 'active' : ''}`}
              key={code.id}
              onClick={() => setCodeId(code.id === codeId ? undefined : code.id)}
            >
              <span>{code.name}</span>
              <b>{code.passageCount}</b>
              <small>{code.interviewCount} interviews</small>
            </button>
          ))}
          {analysis.codes.length === 0 && (
            <div className="analysis-mini-empty">
              <BarChart3 size={21} />
              <p>Codes appear here after transcript passages are coded.</p>
            </div>
          )}
        </aside>

        <section className="passage-panel">
          <div className="panel-title">
            <Link2 size={16} />
            <h2>Coded passages</h2>
            {selectedIds.size > 0 && (
              <button className="text-button" onClick={() => setSelectedIds(new Set())}>
                Clear {selectedIds.size}
              </button>
            )}
          </div>
          <div className="analysis-passages">
            {analysis.passages.map((passage) => (
              <article
                className={`analysis-passage ${selectedIds.has(passage.segmentId) ? 'selected' : ''}`}
                key={passage.segmentId}
              >
                <label className="passage-check">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(passage.segmentId)}
                    onChange={() => togglePassage(passage.segmentId)}
                  />
                  <span className="sr-only">Select passage</span>
                </label>
                <div>
                  <header>
                    <strong>{passage.interviewTitle}</strong>
                    <span>
                      {passage.speaker} · {timestamp(passage)}
                    </span>
                  </header>
                  <p>{passage.text}</p>
                  <footer>
                    <span>{passage.participantName}</span>
                    <div className="tags">
                      {passage.codes.map((code) => (
                        <span className="tag" key={code.id}>
                          {code.name}
                        </span>
                      ))}
                    </div>
                  </footer>
                </div>
              </article>
            ))}
            {analysis.passages.length === 0 && (
              <div className="analysis-empty">
                <Tags size={27} />
                <h2>No coded passages in this view</h2>
                <p>Code transcript segments in Interviews, or broaden the filters above.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="memo-panel">
          <div className="panel-title">
            <FilePenLine size={16} />
            <h2>Synthesis memos</h2>
          </div>
          {memos.map((memo) => (
            <article className="memo-card" key={memo.id}>
              <button className="memo-open" onClick={() => editMemo(memo)}>
                <span>{memo.status}</span>
                <strong>{memo.title}</strong>
                <p>{memo.body || 'No analytic text yet.'}</p>
                <small>{memo.passages.length} linked passages</small>
              </button>
              <footer>
                <button aria-label={`Export ${memo.title}`} onClick={() => exportMemo(memo)}>
                  <Download size={13} /> Export
                </button>
                <button aria-label={`Delete ${memo.title}`} onClick={() => removeMemo(memo)}>
                  <Trash2 size={13} />
                </button>
              </footer>
            </article>
          ))}
          {memos.length === 0 && (
            <div className="analysis-mini-empty">
              <FilePenLine size={21} />
              <p>Select passages and turn comparisons into a traceable memo.</p>
            </div>
          )}
        </aside>
      </div>

      {editing && (
        <div className="modal-backdrop">
          <section className="editor-modal synthesis-editor" role="dialog" aria-modal="true">
            <header>
              <div>
                <p className="eyebrow">{editing.id ? 'Refine synthesis' : 'New synthesis'}</p>
                <h2>Evidence-linked memo</h2>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setEditing(null)}>
                <X size={19} />
              </button>
            </header>
            <form onSubmit={saveMemo}>
              <div className="form-scroll">
                <div className="form-grid">
                  <label className="field full">
                    <span>Title</span>
                    <input
                      autoFocus
                      value={editing.title}
                      onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>
                      Project scope{editing.segmentIds.length > 0 ? ' (fixed by evidence)' : ''}
                    </span>
                    <select
                      value={editing.projectId ?? ''}
                      disabled={editing.segmentIds.length > 0}
                      onChange={(event) =>
                        setEditing({ ...editing, projectId: event.target.value || null })
                      }
                    >
                      <option value="">Workspace-wide</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Status</span>
                    <select
                      value={editing.status}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          status: event.target.value as SynthesisMemo['status']
                        })
                      }
                    >
                      <option value="working">Working</option>
                      <option value="developed">Developed</option>
                    </select>
                  </label>
                  <label className="field full">
                    <span>Interpretation</span>
                    <textarea
                      rows={12}
                      value={editing.body}
                      onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                      placeholder="Develop patterns, contrasts, negative cases, and open questions in your own words."
                    />
                  </label>
                  <div className="memo-evidence-summary">
                    <Link2 size={15} />
                    <span>
                      {editing.segmentIds.length} transcript passage
                      {editing.segmentIds.length === 1 ? '' : 's'} linked as evidence
                    </span>
                  </div>
                </div>
              </div>
              <footer>
                <button type="button" className="button secondary" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className="button primary">
                  <Check size={16} /> Save memo
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default AnalysisView
