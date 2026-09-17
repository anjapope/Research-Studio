import {
  Ban,
  CheckCircle2,
  Clock3,
  FileSearch,
  LocateFixed,
  MessageSquareText,
  Trash2,
  Upload
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  RevisionCategory,
  RevisionSuggestionStatus,
  RevisionWorkspace
} from '../../../shared/domain'

interface Props {
  manuscriptId: string
  flushDraft: () => Promise<boolean>
  onFocusSection: (sectionId: string) => Promise<void>
  onError: (message: string) => void
  onNotice: (message: string) => void
}

function messageFrom(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'The revision analysis could not be updated.'
}

const emptyWorkspace: RevisionWorkspace = { documents: [], suggestions: [] }

function RevisionPanel({
  manuscriptId,
  flushDraft,
  onFocusSection,
  onError,
  onNotice
}: Props): React.JSX.Element {
  const [workspace, setWorkspace] = useState<RevisionWorkspace>(emptyWorkspace)
  const [category, setCategory] = useState<RevisionCategory | 'all'>('all')
  const [status, setStatusFilter] = useState<RevisionSuggestionStatus | 'active' | 'all'>('active')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.revisions
      .get(manuscriptId)
      .then(setWorkspace)
      .catch((error) => onError(messageFrom(error)))
  }, [manuscriptId, onError])

  const visible = useMemo(
    () =>
      workspace.suggestions.filter(
        (suggestion) =>
          (category === 'all' || suggestion.category === category) &&
          (status === 'all' ||
            (status === 'active'
              ? suggestion.status === 'open' || suggestion.status === 'deferred'
              : suggestion.status === status))
      ),
    [category, status, workspace.suggestions]
  )

  async function importComments(): Promise<void> {
    if (!(await flushDraft())) return
    setBusy(true)
    try {
      const result = await window.api.revisions.importComments(manuscriptId)
      if (!result) return
      setWorkspace(result)
      onNotice(
        result.duplicate
          ? `“${result.fileName}” was already imported.`
          : `Imported ${result.importedComments} reviewer ${result.importedComments === 1 ? 'comment' : 'comments'} from “${result.fileName}”.`
      )
    } catch (error) {
      onError(messageFrom(error))
    } finally {
      setBusy(false)
    }
  }

  async function analyzeManuscript(): Promise<void> {
    if (!(await flushDraft())) return
    setBusy(true)
    try {
      const next = await window.api.revisions.analyzeManuscript(manuscriptId)
      setWorkspace(next)
      const count = next.suggestions.filter(
        (suggestion) => suggestion.sourceType === 'manuscript-rule' && suggestion.status === 'open'
      ).length
      onNotice(
        count
          ? `Local manuscript review found ${count} ${count === 1 ? 'item' : 'items'} to consider.`
          : 'Local manuscript review found no structural flags.'
      )
    } catch (error) {
      onError(messageFrom(error))
    } finally {
      setBusy(false)
    }
  }

  async function updateStatus(
    suggestionId: string,
    nextStatus: RevisionSuggestionStatus
  ): Promise<void> {
    try {
      setWorkspace(await window.api.revisions.setStatus(suggestionId, nextStatus))
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  async function removeDocument(id: string, name: string): Promise<void> {
    if (!window.confirm(`Remove “${name}” and its reviewer-comment suggestions?`)) return
    try {
      setWorkspace(await window.api.revisions.removeDocument(id))
    } catch (error) {
      onError(messageFrom(error))
    }
  }

  return (
    <div className="revision-panel">
      <div className="revision-actions">
        <button disabled={busy} onClick={importComments}>
          <Upload size={14} /> Import comments
        </button>
        <button disabled={busy} onClick={analyzeManuscript}>
          <FileSearch size={14} /> Analyze draft
        </button>
      </div>
      <p className="revision-privacy">
        Local rules only. Suggestions never rewrite manuscript text automatically.
      </p>

      {workspace.documents.length > 0 && (
        <section className="review-documents">
          <h2>Reviewer files</h2>
          {workspace.documents.map((document) => (
            <div key={document.id}>
              <MessageSquareText size={14} />
              <span>
                <strong>{document.originalName}</strong>
                <small>
                  {document.commentCount} comments · {document.sha256.slice(0, 8)}…
                </small>
              </span>
              <button
                className="danger"
                aria-label={`Remove ${document.originalName}`}
                onClick={() => removeDocument(document.id, document.originalName)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </section>
      )}

      <div className="revision-filters">
        <select
          aria-label="Filter revision suggestions by category"
          value={category}
          onChange={(event) => setCategory(event.target.value as RevisionCategory | 'all')}
        >
          <option value="all">All concerns</option>
          <option value="argument">Argument</option>
          <option value="evidence">Evidence</option>
          <option value="methods">Methods</option>
          <option value="structure">Structure</option>
          <option value="clarity">Clarity</option>
          <option value="style">Style</option>
        </select>
        <select
          aria-label="Filter revision suggestions by status"
          value={status}
          onChange={(event) =>
            setStatusFilter(event.target.value as RevisionSuggestionStatus | 'active' | 'all')
          }
        >
          <option value="active">Open and deferred</option>
          <option value="all">All decisions</option>
          <option value="open">Open</option>
          <option value="addressed">Addressed</option>
          <option value="deferred">Deferred</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>

      <section className="revision-suggestions">
        <h2>{visible.length} suggestions</h2>
        {visible.length === 0 ? (
          <div className="revision-empty">
            <MessageSquareText size={22} />
            <p>Import reviewer comments or analyze the saved manuscript to begin.</p>
          </div>
        ) : (
          visible.map((suggestion) => (
            <article className={`revision-card ${suggestion.status}`} key={suggestion.id}>
              <div className="revision-card-meta">
                <span className={`revision-category ${suggestion.category}`}>
                  {suggestion.category}
                </span>
                <small>
                  {suggestion.sourceType === 'reviewer-comment' ? 'Reviewer' : 'Local check'}
                </small>
              </div>
              <h3>{suggestion.summary}</h3>
              {suggestion.reviewerComment && (
                <blockquote>“{suggestion.reviewerComment}”</blockquote>
              )}
              <strong className="revision-interpretation">Interpretation</strong>
              <p>{suggestion.rationale}</p>
              <strong className="proposed-action">Implementation approach</strong>
              <p>{suggestion.proposedAction}</p>
              {suggestion.sectionId && (
                <button
                  className="revision-focus"
                  onClick={() => onFocusSection(suggestion.sectionId!)}
                >
                  <LocateFixed size={13} /> {suggestion.sectionTitle ?? 'Open matched section'}
                </button>
              )}
              <div className="revision-decision-actions">
                <button
                  className={suggestion.status === 'addressed' ? 'selected' : ''}
                  onClick={() => updateStatus(suggestion.id, 'addressed')}
                  title="Mark addressed"
                >
                  <CheckCircle2 size={14} /> Addressed
                </button>
                <button
                  className={suggestion.status === 'deferred' ? 'selected' : ''}
                  onClick={() => updateStatus(suggestion.id, 'deferred')}
                  title="Defer"
                >
                  <Clock3 size={14} /> Defer
                </button>
                <button
                  className={suggestion.status === 'dismissed' ? 'selected' : ''}
                  onClick={() => updateStatus(suggestion.id, 'dismissed')}
                  title="Dismiss"
                >
                  <Ban size={14} /> Dismiss
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  )
}

export default RevisionPanel
