import {
  Check,
  FileAudio,
  FileText,
  FolderOpen,
  Mic2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Interview, ProjectSummary, TranscriptSegment } from '../../../shared/domain'

interface Props {
  initialInterviewId?: string | null
  onError: (message: string) => void
  onNotice: (message: string) => void
}

type InterviewDraft = Parameters<typeof window.api.interviews.save>[0]

const blank: InterviewDraft = {
  projectId: null,
  title: '',
  participantName: '',
  occurredAt: null,
  consentNote: null,
  status: 'planned'
}

function messageFrom(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'The interview could not be updated.'
}

function formatTime(seconds: number | null): string {
  if (seconds === null) return '—'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function InterviewsView({
  initialInterviewId = null,
  onError,
  onNotice
}: Props): React.JSX.Element {
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Interview | null>(null)
  const [editing, setEditing] = useState<InterviewDraft | null>(null)
  const [segment, setSegment] = useState<{
    id?: string
    speaker: string
    start: string
    end: string
    text: string
    codes: string
    position: number
  } | null>(null)

  async function refresh(selectId?: string): Promise<void> {
    try {
      const next = await window.api.interviews.list()
      setInterviews(next)
      const id = selectId ?? selectedId ?? next[0]?.id ?? null
      setSelectedId(id)
      setSelected(next.find((item) => item.id === id) ?? null)
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  useEffect(() => {
    Promise.all([window.api.interviews.list(), window.api.projects.list()])
      .then(([nextInterviews, nextProjects]) => {
        setInterviews(nextInterviews)
        setProjects(nextProjects)
        const initial =
          nextInterviews.find((interview) => interview.id === initialInterviewId) ??
          nextInterviews[0] ??
          null
        setSelectedId(initial?.id ?? null)
        setSelected(initial)
      })
      .catch((error) => onError(messageFrom(error)))
  }, [initialInterviewId, onError])

  async function openInterview(id: string): Promise<void> {
    setSelectedId(id)
    try {
      setSelected(await window.api.interviews.get(id))
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function saveInterview(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!editing) return
    try {
      const saved = await window.api.interviews.save(editing)
      setEditing(null)
      await refresh(saved.id)
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function attachMedia(): Promise<void> {
    if (!selected) return
    try {
      const media = await window.api.interviews.attachMedia(selected.id)
      if (media) {
        await refresh(selected.id)
        onNotice(`Attached ${media.originalName} locally.`)
      }
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function importTranscript(): Promise<void> {
    if (!selected) return
    try {
      const updated = await window.api.interviews.importTranscript(selected.id)
      if (updated) {
        setSelected(updated)
        await refresh(updated.id)
        onNotice(`Transcript imported. This interview now has ${updated.segments.length} segments.`)
      }
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function saveSegment(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!selected || !segment) return
    try {
      const updated = await window.api.interviews.saveSegment(selected.id, {
        id: segment.id,
        speaker: segment.speaker,
        startSeconds: segment.start ? Number(segment.start) : null,
        endSeconds: segment.end ? Number(segment.end) : null,
        text: segment.text,
        position: segment.position,
        codeNames: segment.codes
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      })
      setSelected(updated)
      setSegment(null)
      await refresh(updated.id)
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  function editSegment(item: TranscriptSegment): void {
    setSegment({
      id: item.id,
      speaker: item.speaker,
      start: item.startSeconds?.toString() ?? '',
      end: item.endSeconds?.toString() ?? '',
      text: item.text,
      codes: item.codes.map((code) => code.name).join(', '),
      position: item.position
    })
  }

  async function removeInterview(): Promise<void> {
    if (!selected || !window.confirm(`Delete interview “${selected.title}” and its managed media?`))
      return
    try {
      await window.api.interviews.remove(selected.id)
      setSelected(null)
      setSelectedId(null)
      await refresh()
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  return (
    <div className="interviews-layout">
      <aside className="interview-list">
        <header>
          <div>
            <p className="eyebrow">Qualitative</p>
            <h1>Interviews</h1>
          </div>
          <button
            className="icon-button interview-add"
            aria-label="New interview"
            onClick={() => setEditing(blank)}
          >
            <Plus size={18} />
          </button>
        </header>
        {interviews.length === 0 ? (
          <div className="interview-empty">
            <Mic2 size={26} />
            <h2>No interviews yet</h2>
            <p>Create a private interview record and build its transcript locally.</p>
            <button className="button primary" onClick={() => setEditing(blank)}>
              <Plus size={16} /> New interview
            </button>
          </div>
        ) : (
          interviews.map((item) => (
            <button
              className={`interview-row ${selectedId === item.id ? 'selected' : ''}`}
              key={item.id}
              onClick={() => openInterview(item.id)}
            >
              <Mic2 size={16} />
              <div>
                <strong>{item.title}</strong>
                <span>{item.participantName}</span>
                <small>
                  {item.status} · {item.segments.length} segments
                </small>
              </div>
            </button>
          ))
        )}
      </aside>
      <main className="interview-detail">
        {selected ? (
          <>
            <header className="interview-hero">
              <div className="interview-status">{selected.status}</div>
              <h1>{selected.title}</h1>
              <p>
                {selected.participantName}
                {selected.occurredAt
                  ? ` · ${new Date(`${selected.occurredAt}T00:00:00`).toLocaleDateString()}`
                  : ''}
              </p>
              <div>
                <button
                  className="button secondary"
                  onClick={() =>
                    setEditing({
                      id: selected.id,
                      projectId: selected.projectId,
                      title: selected.title,
                      participantName: selected.participantName,
                      occurredAt: selected.occurredAt,
                      consentNote: selected.consentNote,
                      status: selected.status
                    })
                  }
                >
                  <Pencil size={15} /> Edit
                </button>
                <button
                  className="icon-button danger"
                  aria-label="Delete interview"
                  onClick={removeInterview}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </header>
            {selected.consentNote && (
              <div className="consent-card">
                <ShieldCheck size={17} />
                <div>
                  <strong>Consent and handling note</strong>
                  <p>{selected.consentNote}</p>
                </div>
              </div>
            )}
            <section className="interview-media-section">
              <div className="interview-section-heading">
                <div>
                  <FileAudio size={17} />
                  <h2>Local media</h2>
                </div>
                <button className="text-button" onClick={attachMedia}>
                  <Plus size={14} /> Attach media
                </button>
              </div>
              {selected.media.length === 0 ? (
                <p className="muted">
                  No audio or video attached. Files remain inside this workspace.
                </p>
              ) : (
                selected.media.map((media) => (
                  <button
                    className="media-card"
                    key={media.id}
                    onClick={() =>
                      window.api.interviews
                        .openMedia(media.id)
                        .catch((error) => onError(messageFrom(error)))
                    }
                  >
                    <FileAudio size={18} />
                    <span>
                      <strong>{media.originalName}</strong>
                      <small>
                        {(media.byteSize / 1_048_576).toFixed(1)} MB · checksum retained
                      </small>
                    </span>
                    <FolderOpen size={15} />
                  </button>
                ))
              )}
            </section>
            <section className="transcript-section">
              <div className="interview-section-heading">
                <div>
                  <FileText size={17} />
                  <h2>Transcript</h2>
                </div>
                <div>
                  <button className="text-button" onClick={importTranscript}>
                    <Upload size={14} /> Import text
                  </button>
                  <button
                    className="button primary small"
                    onClick={() =>
                      setSegment({
                        speaker: 'Interviewer',
                        start: '',
                        end: '',
                        text: '',
                        codes: '',
                        position: selected.segments.length
                      })
                    }
                  >
                    <Plus size={14} /> Add segment
                  </button>
                </div>
              </div>
              <div className="segment-list">
                {selected.segments.length === 0 ? (
                  <div className="transcript-empty">
                    <FileText size={23} />
                    <p>Import a plain-text transcript or add speaker segments manually.</p>
                    <small>Automatic transcription is intentionally not connected yet.</small>
                  </div>
                ) : (
                  selected.segments.map((item) => (
                    <article className="segment-card" key={item.id}>
                      <div className="segment-meta">
                        <strong>{item.speaker}</strong>
                        <span>
                          {formatTime(item.startSeconds)}
                          {item.endSeconds !== null ? `–${formatTime(item.endSeconds)}` : ''}
                        </span>
                        <button aria-label="Edit segment" onClick={() => editSegment(item)}>
                          <Pencil size={13} />
                        </button>
                        <button
                          aria-label="Delete segment"
                          onClick={async () => {
                            try {
                              await window.api.interviews.removeSegment(item.id)
                              await refresh(selected.id)
                            } catch (error) {
                              onError(messageFrom(error))
                            }
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <p>{item.text}</p>
                      {item.codes.length > 0 && (
                        <div className="tags">
                          {item.codes.map((code) => (
                            <span className="tag" key={code.id}>
                              {code.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>
          </>
        ) : (
          <div className="interview-placeholder">
            <Mic2 size={28} />
            <p>Select an interview to work with its media and transcript.</p>
          </div>
        )}
      </main>

      {editing && (
        <div className="modal-backdrop">
          <section className="editor-modal interview-editor" role="dialog" aria-modal="true">
            <header>
              <div>
                <p className="eyebrow">{editing.id ? 'Edit interview' : 'New interview'}</p>
                <h2>Interview record</h2>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setEditing(null)}>
                <X size={19} />
              </button>
            </header>
            <form onSubmit={saveInterview}>
              <div className="form-scroll">
                <div className="form-grid">
                  <label className="field full">
                    <span>
                      Title <b>*</b>
                    </span>
                    <input
                      autoFocus
                      value={editing.title}
                      onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>
                      Participant name or pseudonym <b>*</b>
                    </span>
                    <input
                      value={editing.participantName}
                      onChange={(event) =>
                        setEditing({ ...editing, participantName: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Date</span>
                    <input
                      type="date"
                      value={editing.occurredAt ?? ''}
                      onChange={(event) =>
                        setEditing({ ...editing, occurredAt: event.target.value || null })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Project</span>
                    <select
                      value={editing.projectId ?? ''}
                      onChange={(event) =>
                        setEditing({ ...editing, projectId: event.target.value || null })
                      }
                    >
                      <option value="">No project</option>
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
                          status: event.target.value as Interview['status']
                        })
                      }
                    >
                      <option value="planned">Planned</option>
                      <option value="recorded">Recorded</option>
                      <option value="transcribed">Transcribed</option>
                      <option value="coded">Coded</option>
                    </select>
                  </label>
                  <label className="field full">
                    <span>Consent and handling note</span>
                    <textarea
                      rows={4}
                      value={editing.consentNote ?? ''}
                      onChange={(event) =>
                        setEditing({ ...editing, consentNote: event.target.value || null })
                      }
                      placeholder="Document consent scope, anonymization, retention, and access constraints."
                    />
                  </label>
                </div>
              </div>
              <footer>
                <button type="button" className="button secondary" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className="button primary">
                  <Check size={16} /> Save interview
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {segment && selected && (
        <div className="modal-backdrop">
          <section className="editor-modal segment-editor" role="dialog" aria-modal="true">
            <header>
              <div>
                <p className="eyebrow">{segment.id ? 'Edit segment' : 'New segment'}</p>
                <h2>Transcript passage</h2>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setSegment(null)}>
                <X size={19} />
              </button>
            </header>
            <form onSubmit={saveSegment}>
              <div className="form-scroll">
                <div className="form-grid">
                  <label className="field">
                    <span>Speaker</span>
                    <input
                      autoFocus
                      value={segment.speaker}
                      onChange={(event) => setSegment({ ...segment, speaker: event.target.value })}
                    />
                  </label>
                  <div className="time-fields">
                    <label className="field">
                      <span>Start (seconds)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={segment.start}
                        onChange={(event) => setSegment({ ...segment, start: event.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>End (seconds)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={segment.end}
                        onChange={(event) => setSegment({ ...segment, end: event.target.value })}
                      />
                    </label>
                  </div>
                  <label className="field full">
                    <span>Transcript text</span>
                    <textarea
                      rows={7}
                      value={segment.text}
                      onChange={(event) => setSegment({ ...segment, text: event.target.value })}
                    />
                  </label>
                  <label className="field full">
                    <span>Qualitative codes</span>
                    <input
                      value={segment.codes}
                      onChange={(event) => setSegment({ ...segment, codes: event.target.value })}
                      placeholder="Separate reusable codes with commas"
                    />
                  </label>
                </div>
              </div>
              <footer>
                <button type="button" className="button secondary" onClick={() => setSegment(null)}>
                  Cancel
                </button>
                <button className="button primary">
                  <Check size={16} /> Save passage
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default InterviewsView
