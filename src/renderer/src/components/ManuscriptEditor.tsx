import {
  BookOpen,
  Download,
  FileText,
  MessageSquareText,
  Plus,
  Quote,
  Save,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Manuscript, ProjectDetail, Source } from '../../../shared/domain'
import RevisionPanel from './RevisionPanel'

interface Props {
  project: ProjectDetail
  sources: Source[]
  onClose: () => void
  onError: (message: string) => void
  onNotice: (message: string) => void
}

function messageFrom(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'The manuscript could not be updated.'
}

function ManuscriptEditor({
  project,
  sources,
  onClose,
  onError,
  onNotice
}: Props): React.JSX.Element {
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([])
  const [manuscript, setManuscript] = useState<Manuscript | null>(null)
  const [sectionId, setSectionId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ title: string; content: string } | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [drawerMode, setDrawerMode] = useState<'research' | 'review'>('research')
  const [writingMode, setWritingMode] = useState<'write' | 'preview'>('write')

  const section = manuscript?.sections.find((item) => item.id === sectionId) ?? null
  const projectSources = sources.filter((source) => project.sourceIds.includes(source.id))

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.manuscripts.list(project.id)
      setManuscripts(next)
      if (next[0]) {
        setManuscript(next[0])
        setSectionId(next[0].sections[0]?.id ?? null)
        const first = next[0].sections[0]
        setDraft(first ? { title: first.title, content: first.content } : null)
      }
    } catch (error) {
      onError(messageFrom(error))
    }
  }, [onError, project.id])

  useEffect(() => {
    window.api.manuscripts
      .list(project.id)
      .then((next) => {
        setManuscripts(next)
        if (next[0]) {
          setManuscript(next[0])
          setSectionId(next[0].sections[0]?.id ?? null)
          const first = next[0].sections[0]
          setDraft(first ? { title: first.title, content: first.content } : null)
        }
      })
      .catch((error) => onError(messageFrom(error)))
  }, [onError, project.id])

  const flushDraft = useCallback(async (): Promise<boolean> => {
    if (!manuscript || !section || !draft) return true
    const persisted = manuscripts.find((item) => item.id === manuscript.id)
    const sectionDirty = draft.title !== section.title || draft.content !== section.content
    const metadataDirty =
      !persisted || persisted.title !== manuscript.title || persisted.status !== manuscript.status
    if (!sectionDirty && !metadataDirty) return true
    setSaveState('saving')
    try {
      let updated = manuscript
      if (sectionDirty) {
        updated = await window.api.manuscripts.saveSection(manuscript.id, {
          id: section.id,
          title: draft.title,
          content: draft.content,
          position: section.position
        })
      }
      if (metadataDirty) {
        updated = await window.api.manuscripts.save(project.id, {
          id: manuscript.id,
          title: manuscript.title,
          status: manuscript.status
        })
      }
      setManuscript(updated)
      setManuscripts((items) => items.map((item) => (item.id === updated.id ? updated : item)))
      setSaveState('saved')
      return true
    } catch (error) {
      setSaveState('unsaved')
      onError(messageFrom(error))
      return false
    }
  }, [draft, manuscript, manuscripts, onError, project.id, section])

  useEffect(() => {
    if (!manuscript || !section || !draft) return
    const persisted = manuscripts.find((item) => item.id === manuscript.id)
    if (
      draft.title === section.title &&
      draft.content === section.content &&
      persisted?.title === manuscript.title &&
      persisted.status === manuscript.status
    )
      return
    const timer = window.setTimeout(() => {
      void flushDraft()
    }, 650)
    return () => window.clearTimeout(timer)
  }, [draft, flushDraft, manuscript, manuscripts, section])

  useEffect(() => {
    window.api.lifecycle.setBeforeCloseHandler(flushDraft)
    return () => window.api.lifecycle.setBeforeCloseHandler(null)
  }, [flushDraft])

  async function createManuscript(): Promise<void> {
    if (!(await flushDraft())) return
    try {
      const created = await window.api.manuscripts.save(project.id, {
        title: `${project.title} manuscript`,
        status: 'draft'
      })
      await load()
      setManuscript(created)
      setSectionId(created.sections[0]?.id ?? null)
      const first = created.sections[0]
      setDraft(first ? { title: first.title, content: first.content } : null)
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function importManuscript(): Promise<void> {
    if (!(await flushDraft())) return
    try {
      const result = await window.api.manuscripts.importDraft(project.id)
      if (!result) return
      const imported = result.manuscript
      await load()
      setManuscript(imported)
      const first = imported.sections[0]
      setSectionId(first?.id ?? null)
      setDraft(first ? { title: first.title, content: first.content } : null)
      setDrawerMode('review')
      onNotice(
        `Imported “${imported.title}”.` +
          (result.reviewerCommentsImported
            ? ` Separated ${result.reviewerCommentsImported} inline reviewer ${result.reviewerCommentsImported === 1 ? 'note' : 'notes'} into Review.`
            : ' Open Review to analyze the saved draft.')
      )
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function addSection(): Promise<void> {
    if (!manuscript) return
    if (!(await flushDraft())) return
    try {
      const updated = await window.api.manuscripts.saveSection(manuscript.id, {
        title: 'New section',
        content: '',
        position: manuscript.sections.length
      })
      setManuscript(updated)
      const added = updated.sections.at(-1)
      setSectionId(added?.id ?? null)
      setDraft(added ? { title: added.title, content: added.content } : null)
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function saveManuscriptMeta(next: Manuscript): Promise<void> {
    try {
      const saved = await window.api.manuscripts.save(project.id, {
        id: next.id,
        title: next.title,
        status: next.status
      })
      setManuscript(saved)
      setManuscripts((items) => items.map((item) => (item.id === saved.id ? saved : item)))
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function removeManuscript(): Promise<void> {
    if (!manuscript || !window.confirm(`Delete manuscript “${manuscript.title}”?`)) return
    try {
      await window.api.manuscripts.remove(manuscript.id)
      setManuscript(null)
      setSectionId(null)
      await load()
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function removeSection(): Promise<void> {
    if (!section || !manuscript) return
    try {
      await window.api.manuscripts.removeSection(section.id)
      const updated = await window.api.manuscripts.get(manuscript.id)
      setManuscript(updated)
      const first = updated.sections[0]
      setSectionId(first?.id ?? null)
      setDraft(first ? { title: first.title, content: first.content } : null)
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function insertSource(source: Source): Promise<void> {
    if (!section || !draft) return
    const author = source.authors[0]?.familyName ?? source.authors[0]?.displayName ?? source.title
    const marker = `(${author}${source.year ? `, ${source.year}` : ''})`
    const content = `${draft.content}${draft.content && !draft.content.endsWith(' ') ? ' ' : ''}${marker}`
    setDraft({ ...draft, content })
    setSaveState('unsaved')
    try {
      const traced = await window.api.manuscripts.addTrace(section.id, null, source.id, marker)
      setManuscript((current) =>
        current
          ? {
              ...current,
              sections: current.sections.map((item) => (item.id === traced.id ? traced : item))
            }
          : current
      )
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function insertEvidence(excerpt: ProjectDetail['evidence'][number]): Promise<void> {
    if (!section || !draft) return
    const source = sources.find((item) => item.id === excerpt.sourceId)
    const author =
      source?.authors[0]?.familyName ?? source?.authors[0]?.displayName ?? excerpt.sourceTitle
    const marker = `(${author}${source?.year ? `, ${source.year}` : ''}, p. ${excerpt.page})`
    setDraft({
      ...draft,
      content: `${draft.content}${draft.content ? '\n\n' : ''}> ${excerpt.text}\n\n${marker}`
    })
    setSaveState('unsaved')
    try {
      const traced = await window.api.manuscripts.addTrace(
        section.id,
        excerpt.id,
        excerpt.sourceId,
        marker
      )
      setManuscript((current) =>
        current
          ? {
              ...current,
              sections: current.sections.map((item) => (item.id === traced.id ? traced : item))
            }
          : current
      )
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function exportFile(format: 'markdown' | 'docx'): Promise<void> {
    if (!manuscript) return
    if (!(await flushDraft())) return
    try {
      if (await window.api.manuscripts.export(manuscript.id, format)) {
        onNotice(`Exported “${manuscript.title}” as ${format === 'docx' ? 'DOCX' : 'Markdown'}.`)
      }
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function focusSection(targetId: string): Promise<void> {
    if (targetId === sectionId) return
    if (!(await flushDraft())) return
    const target = manuscript?.sections.find((item) => item.id === targetId)
    if (!target) {
      onError('The section linked to this suggestion is no longer available.')
      return
    }
    setSectionId(target.id)
    setDraft({ title: target.title, content: target.content })
    setSaveState('saved')
  }

  const wordCount = draft?.content.trim() ? draft.content.trim().split(/\s+/).length : 0

  return (
    <section
      className="manuscript-workspace"
      role="dialog"
      aria-modal="true"
      aria-label="Manuscript editor"
    >
      <header className="manuscript-header">
        <div>
          <p className="eyebrow">{project.title}</p>
          <h1>Manuscripts</h1>
        </div>
        <div className="manuscript-header-actions">
          {manuscript && (
            <>
              <select
                aria-label="Manuscript status"
                value={manuscript.status}
                onChange={(event) => {
                  const next = {
                    ...manuscript,
                    status: event.target.value as Manuscript['status']
                  }
                  setManuscript(next)
                  saveManuscriptMeta(next)
                }}
              >
                <option value="draft">Draft</option>
                <option value="revision">Revision</option>
                <option value="complete">Complete</option>
              </select>
              <button onClick={() => exportFile('markdown')}>
                <Download size={15} /> Markdown
              </button>
              <button onClick={() => exportFile('docx')}>
                <Download size={15} /> DOCX
              </button>
              <button className="danger" onClick={removeManuscript}>
                <Trash2 size={15} /> Delete
              </button>
            </>
          )}
          <button
            className="icon-button"
            aria-label="Close editor"
            onClick={async () => {
              if (await flushDraft()) onClose()
            }}
          >
            <X size={19} />
          </button>
        </div>
      </header>
      <div className="manuscript-body">
        <aside className="manuscript-nav">
          <div className="manuscript-nav-title">
            <span>Documents</span>
            <div>
              <button
                aria-label="Import manuscript draft"
                title="Import PDF, Word, TXT, or Markdown"
                onClick={importManuscript}
              >
                <Upload size={14} />
              </button>
              <button aria-label="New manuscript" onClick={createManuscript}>
                <Plus size={15} />
              </button>
            </div>
          </div>
          {manuscripts.map((item) => (
            <button
              key={item.id}
              className={item.id === manuscript?.id ? 'active' : ''}
              onClick={async () => {
                if (!(await flushDraft())) return
                setManuscript(item)
                const first = item.sections[0]
                setSectionId(first?.id ?? null)
                setDraft(first ? { title: first.title, content: first.content } : null)
              }}
            >
              <FileText size={15} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.status}</small>
              </span>
            </button>
          ))}
          {manuscript && (
            <>
              <div className="manuscript-nav-title sections-title">
                <span>Sections</span>
                <button aria-label="Add section" onClick={addSection}>
                  <Plus size={15} />
                </button>
              </div>
              {manuscript.sections.map((item) => (
                <button
                  key={item.id}
                  className={item.id === sectionId ? 'active section' : 'section'}
                  onClick={async () => {
                    if (item.id === sectionId) return
                    if (!(await flushDraft())) return
                    setSectionId(item.id)
                    setDraft({ title: item.title, content: item.content })
                    setSaveState('saved')
                  }}
                >
                  <span>{item.position + 1}</span>
                  <strong>{item.title}</strong>
                </button>
              ))}
            </>
          )}
        </aside>

        <main className="writing-area">
          {!manuscript ? (
            <div className="manuscript-empty">
              <FileText size={29} />
              <h2>Begin a manuscript</h2>
              <p>
                Draft an argument with citations and evidence that remain traceable to the library.
              </p>
              <button className="button primary" onClick={createManuscript}>
                <Plus size={16} /> New manuscript
              </button>
            </div>
          ) : section && draft ? (
            <>
              <div className="writing-toolbar">
                <span className={`save-state ${saveState}`}>
                  <Save size={13} />{' '}
                  {saveState === 'saved'
                    ? 'Saved locally'
                    : saveState === 'saving'
                      ? 'Saving…'
                      : 'Unsaved changes'}
                </span>
                <span>{wordCount} words</span>
                <div className="writing-mode-toggle">
                  <button
                    className={writingMode === 'write' ? 'active' : ''}
                    onClick={() => setWritingMode('write')}
                  >
                    Write
                  </button>
                  <button
                    className={writingMode === 'preview' ? 'active' : ''}
                    onClick={() => setWritingMode('preview')}
                  >
                    Preview
                  </button>
                </div>
                <button className="danger" aria-label="Delete section" onClick={removeSection}>
                  <Trash2 size={14} />
                </button>
              </div>
              <input
                className="manuscript-title-input"
                value={manuscript.title}
                onChange={(event) =>
                  setManuscript((current) =>
                    current ? { ...current, title: event.target.value } : current
                  )
                }
                onBlur={() => saveManuscriptMeta(manuscript)}
                aria-label="Manuscript title"
              />
              <input
                className="section-title-input"
                value={draft.title}
                onChange={(event) => {
                  setDraft({ ...draft, title: event.target.value })
                  setSaveState('unsaved')
                }}
              />
              {writingMode === 'write' ? (
                <textarea
                  className="manuscript-textarea"
                  value={draft.content}
                  onChange={(event) => {
                    setDraft({ ...draft, content: event.target.value })
                    setSaveState('unsaved')
                  }}
                  placeholder="Develop the argument here. Markdown formatting is supported…"
                />
              ) : (
                <div className="manuscript-preview">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noreferrer">
                          {children}
                        </a>
                      )
                    }}
                  >
                    {draft.content}
                  </ReactMarkdown>
                </div>
              )}
              {section.traces.length > 0 && (
                <div className="trace-strip">
                  <strong>Trace map</strong>
                  {section.traces.map((trace) => (
                    <span key={trace.id} title={trace.fileSha256 ?? undefined}>
                      {trace.marker} → {trace.sourceTitle}
                      {trace.page ? `, page ${trace.page}` : ''}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </main>

        <aside className="research-drawer">
          <div className="research-drawer-heading">
            {drawerMode === 'research' ? <BookOpen size={16} /> : <MessageSquareText size={16} />}
            <div>
              <strong>
                {drawerMode === 'research' ? 'Project research' : 'Revision assistant'}
              </strong>
              <span>
                {drawerMode === 'research'
                  ? 'Insert with a durable trace'
                  : 'Local, attributable suggestions'}
              </span>
            </div>
          </div>
          <div className="drawer-tabs">
            <button
              className={drawerMode === 'research' ? 'active' : ''}
              onClick={() => setDrawerMode('research')}
            >
              <BookOpen size={14} /> Research
            </button>
            <button
              className={drawerMode === 'review' ? 'active' : ''}
              onClick={() => setDrawerMode('review')}
            >
              <MessageSquareText size={14} /> Review
            </button>
          </div>
          {drawerMode === 'research' ? (
            <>
              <section>
                <h2>Sources</h2>
                {projectSources.map((source) => (
                  <button
                    className="research-insert"
                    key={source.id}
                    onClick={() => insertSource(source)}
                  >
                    <BookOpen size={15} />
                    <span>
                      <strong>{source.title}</strong>
                      <small>
                        {source.authors.map((author) => author.displayName).join(', ') ||
                          'Unknown author'}
                        {source.year ? ` · ${source.year}` : ''}
                      </small>
                    </span>
                    <Plus size={14} />
                  </button>
                ))}
              </section>
              <section>
                <h2>Evidence</h2>
                {project.evidence.length === 0 ? (
                  <p className="muted">Capture evidence from assigned PDFs first.</p>
                ) : (
                  project.evidence.map((excerpt) => (
                    <button
                      className="evidence-insert"
                      key={excerpt.id}
                      onClick={() => insertEvidence(excerpt)}
                    >
                      <div>
                        <Quote size={14} />
                        <span>
                          {excerpt.sourceTitle} · p. {excerpt.page}
                        </span>
                      </div>
                      <blockquote>“{excerpt.text}”</blockquote>
                      <small>
                        <Plus size={12} /> Insert quote and trace
                      </small>
                    </button>
                  ))
                )}
              </section>
            </>
          ) : manuscript ? (
            <RevisionPanel
              manuscriptId={manuscript.id}
              flushDraft={flushDraft}
              onFocusSection={focusSection}
              onError={onError}
              onNotice={onNotice}
            />
          ) : (
            <p className="muted">Create a manuscript before starting revision analysis.</p>
          )}
        </aside>
      </div>
    </section>
  )
}

export default ManuscriptEditor
