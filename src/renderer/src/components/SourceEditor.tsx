import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Source, SourceDraft } from '../../../shared/domain'
import { SOURCE_STATUSES, SOURCE_TYPES } from '../../../shared/domain'

interface Props {
  source: Source | null
  onClose: () => void
  onSave: (draft: SourceDraft) => Promise<void>
}

const emptyDraft: SourceDraft = {
  title: '',
  sourceType: 'article',
  status: 'unread',
  authors: [],
  year: null,
  publicationTitle: null,
  publisher: null,
  doi: null,
  url: null,
  abstract: null,
  notes: null,
  tags: [],
  origin: 'user',
  provenanceNote: null
}

function SourceEditor({ source, onClose, onSave }: Props): React.JSX.Element {
  const [draft, setDraft] = useState<SourceDraft>(
    source
      ? {
          id: source.id,
          title: source.title,
          sourceType: source.sourceType,
          status: source.status,
          authors: source.authors.map((author) => author.displayName),
          year: source.year,
          publicationTitle: source.publicationTitle,
          publisher: source.publisher,
          doi: source.doi,
          url: source.url,
          abstract: source.abstract,
          notes: source.notes,
          tags: source.tags,
          origin: source.origin === 'ai' ? 'user' : source.origin,
          provenanceNote: source.provenanceNote
        }
      : emptyDraft
  )
  const [authors, setAuthors] = useState(draft.authors.join('; '))
  const [tags, setTags] = useState(draft.tags.join(', '))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [onClose])

  function update<K extends keyof SourceDraft>(key: K, value: SourceDraft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!draft.title.trim()) {
      setError('Add a title before saving.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        ...draft,
        title: draft.title.trim(),
        authors: authors
          .split(';')
          .map((value) => value.trim())
          .filter(Boolean),
        tags: tags
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this source.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
      >
        <header>
          <div>
            <p className="eyebrow">{source ? 'Edit record' : 'New record'}</p>
            <h2 id="editor-title">{source ? 'Source details' : 'Add a source'}</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="form-scroll">
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            <label className="field full">
              <span>
                Title <b>*</b>
              </span>
              <input
                autoFocus
                value={draft.title}
                onChange={(e) => update('title', e.target.value)}
              />
            </label>
            <div className="form-grid">
              <label className="field">
                <span>Type</span>
                <select
                  value={draft.sourceType}
                  onChange={(e) =>
                    update('sourceType', e.target.value as SourceDraft['sourceType'])
                  }
                >
                  {SOURCE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type[0].toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Reading status</span>
                <select
                  value={draft.status}
                  onChange={(e) => update('status', e.target.value as SourceDraft['status'])}
                >
                  {SOURCE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status[0].toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field full">
                <span>Authors</span>
                <input
                  value={authors}
                  onChange={(e) => setAuthors(e.target.value)}
                  placeholder="Separate multiple authors with semicolons"
                />
              </label>
              <label className="field">
                <span>Year</span>
                <input
                  type="number"
                  min="1000"
                  max="3000"
                  value={draft.year ?? ''}
                  onChange={(e) => update('year', e.target.value ? Number(e.target.value) : null)}
                />
              </label>
              <label className="field">
                <span>Publication or journal</span>
                <input
                  value={draft.publicationTitle ?? ''}
                  onChange={(e) => update('publicationTitle', e.target.value || null)}
                />
              </label>
              <label className="field">
                <span>Publisher</span>
                <input
                  value={draft.publisher ?? ''}
                  onChange={(e) => update('publisher', e.target.value || null)}
                />
              </label>
              <label className="field">
                <span>DOI</span>
                <input
                  value={draft.doi ?? ''}
                  onChange={(e) => update('doi', e.target.value || null)}
                  placeholder="10.xxxx/…"
                />
              </label>
              <label className="field full">
                <span>URL</span>
                <input
                  type="url"
                  value={draft.url ?? ''}
                  onChange={(e) => update('url', e.target.value || null)}
                  placeholder="https://…"
                />
              </label>
              <label className="field full">
                <span>Abstract</span>
                <textarea
                  rows={4}
                  value={draft.abstract ?? ''}
                  onChange={(e) => update('abstract', e.target.value || null)}
                />
              </label>
              <label className="field full">
                <span>Research notes</span>
                <textarea
                  rows={4}
                  value={draft.notes ?? ''}
                  onChange={(e) => update('notes', e.target.value || null)}
                  placeholder="Your reading notes, questions, and connections…"
                />
              </label>
              <label className="field full">
                <span>Tags</span>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="Separate tags with commas"
                />
              </label>
              <label className="field">
                <span>Record origin</span>
                <select
                  value={draft.origin}
                  onChange={(e) => update('origin', e.target.value as SourceDraft['origin'])}
                >
                  <option value="user">Entered manually</option>
                  <option value="imported">Imported by user</option>
                </select>
              </label>
              <label className="field">
                <span>Provenance note</span>
                <input
                  value={draft.provenanceNote ?? ''}
                  onChange={(e) => update('provenanceNote', e.target.value || null)}
                  placeholder="Where did this metadata come from?"
                />
              </label>
            </div>
          </div>
          <footer>
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={saving}>
              <Check size={17} /> {saving ? 'Saving…' : 'Save source'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

export default SourceEditor
