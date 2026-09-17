import {
  BookOpen,
  Check,
  Circle,
  Download,
  ExternalLink,
  FileText,
  Flag,
  FolderKanban,
  Pencil,
  Paperclip,
  Plus,
  Quote,
  StickyNote,
  Trash2,
  Unlink,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ProjectDetail,
  ProjectDraft,
  ProjectSummary,
  ProjectStatus,
  Source
} from '../../../shared/domain'
import ManuscriptEditor from './ManuscriptEditor'

interface Props {
  onError: (message: string) => void
  onNotice: (message: string) => void
}

function messageFrom(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'The project could not be updated.'
}

const emptyDraft: ProjectDraft = {
  title: '',
  researchQuestion: '',
  description: null,
  status: 'active'
}

function ProjectsView({ onError, onNotice }: Props): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [editing, setEditing] = useState<ProjectDraft | null>(null)
  const [goalTitle, setGoalTitle] = useState('')
  const [goalDate, setGoalDate] = useState('')
  const [note, setNote] = useState('')
  const [codeFilter, setCodeFilter] = useState('all')
  const [writing, setWriting] = useState(false)

  const refreshProjects = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.projects.list()
      setProjects(next)
      setSelectedId((current) =>
        current && next.some((project) => project.id === current) ? current : (next[0]?.id ?? null)
      )
    } catch (error) {
      onError(messageFrom(error))
    }
  }, [onError])

  useEffect(() => {
    Promise.all([window.api.projects.list(), window.api.sources.list()])
      .then(([nextProjects, nextSources]) => {
        setProjects(nextProjects)
        setSources(nextSources)
        setSelectedId(nextProjects[0]?.id ?? null)
      })
      .catch((error) => onError(messageFrom(error)))
  }, [onError])

  useEffect(() => {
    if (!selectedId) return
    window.api.projects
      .get(selectedId)
      .then(setDetail)
      .catch((error) => onError(messageFrom(error)))
  }, [onError, selectedId])

  const evidenceCodes = useMemo(
    () =>
      [
        ...new Set(
          (detail?.evidence ?? []).flatMap((excerpt) => excerpt.codes.map((code) => code.name))
        )
      ].sort(),
    [detail]
  )
  const visibleEvidence = (detail?.evidence ?? []).filter(
    (excerpt) => codeFilter === 'all' || excerpt.codes.some((code) => code.name === codeFilter)
  )

  async function saveProject(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!editing) return
    try {
      const saved = await window.api.projects.save(editing)
      setEditing(null)
      await refreshProjects()
      setSelectedId(saved.id)
      setDetail(saved)
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function assignSource(sourceId: string, assigned: boolean): Promise<void> {
    if (!detail) return
    try {
      const updated = await window.api.projects.assignSource(detail.id, sourceId, assigned)
      setDetail(updated)
      await refreshProjects()
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function addGoal(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!detail || !goalTitle.trim()) return
    try {
      const updated = await window.api.projects.saveGoal(detail.id, {
        title: goalTitle,
        status: 'open',
        targetDate: goalDate || null
      })
      setDetail(updated)
      setGoalTitle('')
      setGoalDate('')
      await refreshProjects()
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function toggleGoal(
    goalId: string,
    title: string,
    complete: boolean,
    targetDate: string | null
  ): Promise<void> {
    if (!detail) return
    try {
      const updated = await window.api.projects.saveGoal(detail.id, {
        id: goalId,
        title,
        status: complete ? 'complete' : 'open',
        targetDate
      })
      setDetail(updated)
      await refreshProjects()
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function addNote(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!detail || !note.trim()) return
    try {
      setDetail(await window.api.projects.saveNote(detail.id, note))
      setNote('')
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function removeGoal(id: string): Promise<void> {
    if (!detail) return
    try {
      await window.api.projects.removeGoal(id)
      setDetail(await window.api.projects.get(detail.id))
      await refreshProjects()
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function removeNote(id: string): Promise<void> {
    if (!detail) return
    try {
      await window.api.projects.removeNote(id)
      setDetail(await window.api.projects.get(detail.id))
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function removeProject(): Promise<void> {
    if (
      !detail ||
      !window.confirm(
        `Delete project “${detail.title}”? Sources and evidence will remain in the library.`
      )
    )
      return
    try {
      await window.api.projects.remove(detail.id)
      setDetail(null)
      setSelectedId(null)
      await refreshProjects()
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function exportProject(): Promise<void> {
    if (!detail) return
    try {
      if (await window.api.projects.export(detail.id))
        onNotice(`Exported “${detail.title}” with its managed-file manifest.`)
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  function describeImport(imported: number, linkedExisting: number, duplicates: number): string {
    const parts = [
      imported ? `${imported} copied` : '',
      linkedExisting
        ? `${linkedExisting} existing managed ${linkedExisting === 1 ? 'file' : 'files'} linked`
        : '',
      duplicates ? `${duplicates} already linked` : ''
    ].filter(Boolean)
    return parts.join(', ') || 'No files were imported.'
  }

  async function importFiles(): Promise<void> {
    if (!detail) return
    try {
      const result = await window.api.projects.importFiles(detail.id)
      if (!result) return
      setDetail(result.project)
      onNotice(describeImport(result.imported, result.linkedExisting, result.duplicates))
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function importDroppedFiles(files: FileList): Promise<void> {
    if (!detail) return
    try {
      const paths = Array.from(files)
        .map((file) => window.api.files.pathForDrop(file))
        .filter(Boolean)
      if (!paths.length) throw new Error('The dropped files are not available as local files.')
      const result = await window.api.projects.importDroppedFiles(detail.id, paths)
      setDetail(result.project)
      onNotice(describeImport(result.imported, result.linkedExisting, result.duplicates))
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function removeFile(fileId: string, deleteManagedCopy: boolean): Promise<void> {
    if (!detail) return
    const file = detail.files.find((item) => item.id === fileId)
    if (!file) return
    const prompt = deleteManagedCopy
      ? `Delete the managed copy of “${file.originalName}”? This removes it from ${file.linkCount} linked ${file.linkCount === 1 ? 'project' : 'projects'}, but never deletes the original file.`
      : `Unlink “${file.originalName}” from this project? The managed copy and original file will remain.`
    if (!window.confirm(prompt)) return
    try {
      setDetail(await window.api.projects.removeFile(detail.id, fileId, deleteManagedCopy))
      onNotice(
        deleteManagedCopy
          ? 'Managed copy deleted. The original file was not changed.'
          : 'File unlinked. Its managed copy remains in the workspace.'
      )
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  return (
    <div className="projects-layout">
      <aside className="project-list">
        <div className="project-list-header">
          <div>
            <p className="eyebrow">Research</p>
            <h1>Projects</h1>
          </div>
          <button
            className="icon-button project-add"
            aria-label="New project"
            onClick={() => setEditing(emptyDraft)}
          >
            <Plus size={18} />
          </button>
        </div>
        {projects.length === 0 ? (
          <div className="project-empty">
            <FolderKanban size={25} />
            <h2>No projects yet</h2>
            <p>Bring sources and evidence together around a research question.</p>
            <button className="button primary" onClick={() => setEditing(emptyDraft)}>
              <Plus size={16} /> New project
            </button>
          </div>
        ) : (
          projects.map((project) => (
            <button
              key={project.id}
              className={`project-row ${project.id === selectedId ? 'selected' : ''}`}
              onClick={() => setSelectedId(project.id)}
            >
              <div>
                <strong>{project.title}</strong>
                <span>{project.researchQuestion}</span>
              </div>
              <small>
                {project.sourceCount} sources · {project.evidenceCount} excerpts
              </small>
            </button>
          ))
        )}
      </aside>

      <main className="project-dashboard">
        {detail ? (
          <>
            <header className="project-hero">
              <div className="project-status">
                <span className={`status-dot ${detail.status}`} /> {detail.status}
              </div>
              <h1>{detail.title}</h1>
              <p className="research-question">{detail.researchQuestion}</p>
              {detail.description && <p className="project-description">{detail.description}</p>}
              <div className="project-actions">
                <button className="button primary" onClick={() => setWriting(true)}>
                  <FileText size={15} /> Write
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    setEditing({
                      id: detail.id,
                      title: detail.title,
                      researchQuestion: detail.researchQuestion,
                      description: detail.description,
                      status: detail.status
                    })
                  }
                >
                  <Pencil size={15} /> Edit
                </button>
                <button className="button secondary" onClick={importFiles}>
                  <Paperclip size={15} /> Import files
                </button>
                <button className="button secondary" onClick={exportProject}>
                  <Download size={15} /> Export
                </button>
                <button
                  className="icon-button danger"
                  aria-label="Delete project"
                  onClick={removeProject}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </header>
            <div className="project-metrics">
              <div>
                <BookOpen size={17} />
                <strong>{detail.sourceCount}</strong>
                <span>Sources</span>
              </div>
              <div>
                <Quote size={17} />
                <strong>{detail.evidenceCount}</strong>
                <span>Evidence excerpts</span>
              </div>
              <div>
                <Flag size={17} />
                <strong>{detail.openGoalCount}</strong>
                <span>Open goals</span>
              </div>
            </div>
            <div className="project-grid">
              <section className="project-card source-assignment">
                <div className="project-card-heading">
                  <div>
                    <BookOpen size={16} />
                    <h2>Sources</h2>
                  </div>
                  <span>{detail.sourceIds.length} assigned</span>
                </div>
                <div className="assignment-list">
                  {sources.length === 0 ? (
                    <p className="muted">Add sources to the library first.</p>
                  ) : (
                    sources.map((source) => (
                      <label key={source.id}>
                        <input
                          type="checkbox"
                          checked={detail.sourceIds.includes(source.id)}
                          onChange={(event) => assignSource(source.id, event.target.checked)}
                        />
                        <span>
                          <strong>{source.title}</strong>
                          <small>
                            {source.authors.map((author) => author.displayName).join(', ') ||
                              'Unknown author'}
                            {source.year ? ` · ${source.year}` : ''}
                          </small>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </section>

              <section
                className="project-card project-files-card"
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  void importDroppedFiles(event.dataTransfer.files)
                }}
              >
                <div className="project-card-heading">
                  <div>
                    <Paperclip size={16} />
                    <h2>Managed files</h2>
                  </div>
                  <button className="text-button" onClick={importFiles}>
                    <Plus size={14} /> Import
                  </button>
                </div>
                <p className="project-files-hint">
                  Drop PDF, TXT, or Markdown files here. Research Studio copies them; originals stay
                  untouched.
                </p>
                <div className="project-file-list">
                  {detail.files.length === 0 ? (
                    <p className="muted">No managed source material yet.</p>
                  ) : (
                    detail.files.map((file) => (
                      <article key={file.id}>
                        <div>
                          <strong>{file.originalName}</strong>
                          <small>
                            {file.extension.toUpperCase()} · {(file.byteSize / 1024).toFixed(1)} KB
                            · {file.sha256.slice(0, 10)}…
                          </small>
                        </div>
                        <div className="project-file-actions">
                          <button
                            aria-label={`Open ${file.originalName}`}
                            title="Open"
                            onClick={() =>
                              window.api.projects
                                .openFile(file.id)
                                .catch((error) => onError(messageFrom(error)))
                            }
                          >
                            <ExternalLink size={14} />
                          </button>
                          <button
                            aria-label={`Reveal ${file.originalName} in folder`}
                            title="Reveal in folder"
                            onClick={() =>
                              window.api.projects
                                .revealFile(file.id)
                                .catch((error) => onError(messageFrom(error)))
                            }
                          >
                            <FolderKanban size={14} />
                          </button>
                          <button
                            aria-label={`Unlink ${file.originalName}`}
                            title="Unlink from project; keep managed copy"
                            onClick={() => removeFile(file.id, false)}
                          >
                            <Unlink size={14} />
                          </button>
                          <button
                            className="danger"
                            aria-label={`Delete managed copy of ${file.originalName}`}
                            title="Delete managed copy; original remains"
                            onClick={() => removeFile(file.id, true)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>

              <section className="project-card goals-card">
                <div className="project-card-heading">
                  <div>
                    <Flag size={16} />
                    <h2>Goals</h2>
                  </div>
                </div>
                <form className="quick-add goal-add" onSubmit={addGoal}>
                  <input
                    value={goalTitle}
                    onChange={(event) => setGoalTitle(event.target.value)}
                    placeholder="Add a concrete next step…"
                  />
                  <input
                    type="date"
                    aria-label="Target date"
                    value={goalDate}
                    onChange={(event) => setGoalDate(event.target.value)}
                  />
                  <button aria-label="Add goal">
                    <Plus size={16} />
                  </button>
                </form>
                <div className="goal-list">
                  {detail.goals.map((goal) => (
                    <div className={`goal-row ${goal.status}`} key={goal.id}>
                      <button
                        aria-label={goal.status === 'open' ? 'Complete goal' : 'Reopen goal'}
                        onClick={() =>
                          toggleGoal(goal.id, goal.title, goal.status === 'open', goal.targetDate)
                        }
                      >
                        {goal.status === 'complete' ? <Check size={15} /> : <Circle size={15} />}
                      </button>
                      <span>
                        {goal.title}
                        {goal.targetDate && (
                          <small>
                            Due {new Date(`${goal.targetDate}T00:00:00`).toLocaleDateString()}
                          </small>
                        )}
                      </span>
                      <button
                        className="danger"
                        aria-label="Delete goal"
                        onClick={() => removeGoal(goal.id)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="project-card evidence-card">
                <div className="project-card-heading">
                  <div>
                    <Quote size={16} />
                    <h2>Evidence</h2>
                  </div>
                  <select
                    aria-label="Filter evidence by code"
                    value={codeFilter}
                    onChange={(event) => setCodeFilter(event.target.value)}
                  >
                    <option value="all">All codes</option>
                    {evidenceCodes.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="project-evidence-list">
                  {visibleEvidence.length === 0 ? (
                    <p className="muted">Evidence from assigned sources will gather here.</p>
                  ) : (
                    visibleEvidence.map((excerpt) => (
                      <article key={excerpt.id}>
                        <div>
                          <span>{excerpt.sourceTitle}</span>
                          <small>Page {excerpt.page}</small>
                        </div>
                        <blockquote>“{excerpt.text}”</blockquote>
                        {excerpt.note && <p>{excerpt.note}</p>}
                        <div className="tags">
                          {excerpt.codes.map((code) => (
                            <span className="tag" key={code.id}>
                              {code.name}
                            </span>
                          ))}
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>

              <section className="project-card notes-card">
                <div className="project-card-heading">
                  <div>
                    <StickyNote size={16} />
                    <h2>Project notes</h2>
                  </div>
                </div>
                <form className="note-add" onSubmit={addNote}>
                  <textarea
                    rows={3}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Capture a decision, question, or connection…"
                  />
                  <button className="button primary">
                    <Plus size={15} /> Add note
                  </button>
                </form>
                <div className="project-note-list">
                  {detail.notes.map((item) => (
                    <article key={item.id}>
                      <p>{item.body}</p>
                      <div>
                        <time>{new Date(item.createdAt).toLocaleString()}</time>
                        <button aria-label="Delete note" onClick={() => removeNote(item.id)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </>
        ) : projects.length > 0 ? (
          <div className="project-placeholder">
            <FolderKanban size={28} />
            <p>Select a project to open its research dashboard.</p>
          </div>
        ) : null}
      </main>

      {editing && (
        <div className="modal-backdrop">
          <section
            className="editor-modal project-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-editor-title"
          >
            <header>
              <div>
                <p className="eyebrow">{editing.id ? 'Edit project' : 'New project'}</p>
                <h2 id="project-editor-title">Research project</h2>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setEditing(null)}>
                <X size={19} />
              </button>
            </header>
            <form onSubmit={saveProject}>
              <div className="form-scroll">
                <div className="form-grid">
                  <label className="field full">
                    <span>
                      Project title <b>*</b>
                    </span>
                    <input
                      autoFocus
                      value={editing.title}
                      onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                    />
                  </label>
                  <label className="field full">
                    <span>
                      Research question <b>*</b>
                    </span>
                    <textarea
                      rows={3}
                      value={editing.researchQuestion}
                      onChange={(event) =>
                        setEditing({ ...editing, researchQuestion: event.target.value })
                      }
                      placeholder="What are you trying to understand?"
                    />
                  </label>
                  <label className="field full">
                    <span>Scope and working notes</span>
                    <textarea
                      rows={4}
                      value={editing.description ?? ''}
                      onChange={(event) =>
                        setEditing({ ...editing, description: event.target.value || null })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Status</span>
                    <select
                      value={editing.status}
                      onChange={(event) =>
                        setEditing({ ...editing, status: event.target.value as ProjectStatus })
                      }
                    >
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="complete">Complete</option>
                    </select>
                  </label>
                </div>
              </div>
              <footer>
                <button type="button" className="button secondary" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className="button primary">
                  <Check size={16} /> Save project
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {writing && detail && (
        <ManuscriptEditor
          project={detail}
          sources={sources}
          onClose={() => setWriting(false)}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </div>
  )
}

export default ProjectsView
