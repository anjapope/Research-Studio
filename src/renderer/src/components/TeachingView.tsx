import { useEffect, useRef, useState } from 'react'
import { Download, GraduationCap, Plus, Save, Upload } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { Source } from '../../../shared/domain'
import {
  draftLesson,
  parseTeachingSlides,
  type Lesson,
  type TeachingAiSettings
} from '../../../shared/teaching'

function blank(): Lesson {
  return {
    id: crypto.randomUUID(),
    title: 'Untitled lesson',
    audience: '',
    duration: 60,
    objectives: '',
    sources: [],
    synthesis: '',
    notes: '',
    slides: ''
  }
}

export default function TeachingView(): React.JSX.Element {
  const [lesson, setLesson] = useState<Lesson>(blank)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [library, setLibrary] = useState<Source[]>([])
  const [sourceId, setSourceId] = useState('')
  const [tab, setTab] = useState<'synthesis' | 'notes' | 'slides'>('synthesis')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [ai, setAi] = useState<TeachingAiSettings | null>(null)
  const [model, setModel] = useState('gpt-4.1')
  const [apiKey, setApiKey] = useState('')
  const [synthesizing, setSynthesizing] = useState(false)
  const current = useRef(lesson)
  const dirty = useRef(false)
  const working = useRef(false)
  const loaded = useRef(false)

  function update(next: Lesson): void {
    current.current = next
    dirty.current = true
    setLesson(next)
    setMessage('Unsaved changes')
  }

  async function save(): Promise<boolean> {
    if (working.current || !loaded.current) return false
    if (!dirty.current) return true
    try {
      const snapshot = current.current
      await window.api.teaching.save(snapshot)
      if (current.current === snapshot) dirty.current = false
      setLessons((items) => [snapshot, ...items.filter((item) => item.id !== snapshot.id)])
      setMessage('Saved in this workspace')
      return true
    } catch (failure) {
      setError(String(failure))
      return false
    }
  }

  useEffect(() => {
    let active = true
    window.api.teaching
      .aiSettings()
      .then((settings) => {
        if (active) {
          setAi(settings)
          setModel(settings.model)
        }
      })
      .catch((failure) => {
        if (active) setError(String(failure))
      })
    Promise.all([window.api.teaching.list(), window.api.sources.list()])
      .then(([items, sources]) => {
        if (!active) return
        setLessons(items)
        setLibrary(sources)
        if (items[0]) {
          current.current = items[0]
          setLesson(items[0])
        }
        loaded.current = true
        setReady(true)
      })
      .catch((failure) => setError(String(failure)))
    window.api.lifecycle.setBeforeCloseHandler(save)
    return () => {
      active = false
      window.api.lifecycle.setBeforeCloseHandler(null)
    }
    // The navigation handler reads current drafts from refs.
  }, [])

  async function run(action: () => Promise<void>): Promise<void> {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(String(failure))
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  async function addLibrarySource(): Promise<void> {
    const source = library.find((item) => item.id === sourceId)
    if (!source) return
    const parts = [
      source.abstract ? `Abstract:\n${source.abstract}` : '',
      source.notes ? `Research notes:\n${source.notes}` : ''
    ].filter(Boolean)
    for (const file of source.files) {
      const pages = await window.api.reader.listPageSummaries(file.id)
      for (const page of pages.filter((item) => item.readable)) {
        const saved = await window.api.reader.getPageText(file.id, page.page)
        if (saved?.text.trim()) parts.push(`${file.originalName}, p. ${page.page}:\n${saved.text}`)
      }
    }
    const excerpts = await window.api.reader.listExcerpts(source.id)
    parts.push(
      ...excerpts.map((excerpt) => `${excerpt.fileName}, p. ${excerpt.page}:\n${excerpt.text}`)
    )
    if (!parts.length)
      throw new Error(
        'This source has no readable text yet. Prepare its PDF in the reader, import the document here, or paste its text.'
      )
    update({
      ...current.current,
      sources: [
        ...current.current.sources,
        { id: crypto.randomUUID(), title: source.title, text: parts.join('\n\n') }
      ]
    })
    setMessage(
      'Added abstract, notes, saved PDF pages, and evidence where available. Review source text for coverage.'
    )
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Class preparation</p>
          <h1>
            <GraduationCap size={26} /> Teaching &amp; Instruction
          </h1>
        </div>
        <div className="topbar-actions">
          <button
            className="button secondary"
            disabled={!ready || busy}
            onClick={async () => {
              if (await save()) {
                const next = blank()
                current.current = next
                setLesson(next)
                dirty.current = false
                setMessage('New lesson')
              }
            }}
          >
            <Plus size={16} /> New lesson
          </button>
          <button className="button primary" disabled={!ready || busy} onClick={() => void save()}>
            <Save size={16} /> Save lesson
          </button>
        </div>
      </header>
      <div className="teaching-workspace">
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {message && <p role="status">{message}</p>}
        <fieldset disabled={!ready || busy} className="teaching-fields">
          <label>
            Saved lessons
            <select
              value={lessons.some((item) => item.id === lesson.id) ? lesson.id : ''}
              onChange={async (event) => {
                const id = event.target.value
                if (await save()) {
                  const next = lessons.find((item) => item.id === id)
                  if (next) {
                    current.current = next
                    setLesson(next)
                    dirty.current = false
                    setMessage('Lesson loaded')
                  }
                }
              }}
            >
              <option value="" disabled>
                New lesson
              </option>
              {lessons.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <div className="teaching-grid">
            <label>
              Lesson title
              <input
                value={lesson.title}
                onChange={(event) => update({ ...lesson, title: event.target.value })}
              />
            </label>
            <label>
              Audience / course
              <input
                placeholder="e.g. Undergraduate research methods"
                value={lesson.audience}
                onChange={(event) => update({ ...lesson, audience: event.target.value })}
              />
            </label>
            <label>
              Class length (minutes)
              <input
                type="number"
                min={5}
                max={480}
                value={lesson.duration}
                onChange={(event) => update({ ...lesson, duration: Number(event.target.value) })}
              />
            </label>
          </div>
          <label>
            Learning objectives
            <textarea
              rows={3}
              placeholder="What should students be able to explain, compare, or apply?"
              value={lesson.objectives}
              onChange={(event) => update({ ...lesson, objectives: event.target.value })}
            />
          </label>
          <section className="teaching-card">
            <h2>1. Gather readings</h2>
            <p>
              Import PDF, DOCX, Markdown, or text. Scanned PDFs need OCR first. Library selection
              uses saved readable pages, evidence, abstracts, and notes.
            </p>
            <div className="topbar-actions">
              <button
                className="button secondary"
                onClick={() =>
                  void run(async () => {
                    const sources = await window.api.teaching.importDocuments()
                    if (sources.length)
                      update({
                        ...current.current,
                        sources: [...current.current.sources, ...sources]
                      })
                  })
                }
              >
                <Upload size={16} /> Import documents
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  update({
                    ...lesson,
                    sources: [
                      ...lesson.sources,
                      { id: crypto.randomUUID(), title: 'Pasted reading', text: '' }
                    ]
                  })
                }
              >
                Paste a reading
              </button>
              <select
                aria-label="Library source"
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
              >
                <option value="">Choose library source</option>
                {library.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title}
                  </option>
                ))}
              </select>
              <button
                className="button secondary"
                disabled={!sourceId}
                onClick={() => void run(addLibrarySource)}
              >
                Add source
              </button>
            </div>
            {!lesson.sources.length && (
              <p className="muted">Add next week’s readings to start a lesson.</p>
            )}
            {lesson.sources.map((source, index) => (
              <details className="teaching-reading" key={source.id}>
                <summary>
                  [S{index + 1}] {source.title} · {source.text.length.toLocaleString()} characters
                </summary>
                <label>
                  Source title
                  <input
                    value={source.title}
                    onChange={(event) =>
                      update({
                        ...lesson,
                        sources: lesson.sources.map((item) =>
                          item.id === source.id ? { ...item, title: event.target.value } : item
                        )
                      })
                    }
                  />
                </label>
                <label>
                  Source text
                  <textarea
                    rows={7}
                    value={source.text}
                    onChange={(event) =>
                      update({
                        ...lesson,
                        sources: lesson.sources.map((item) =>
                          item.id === source.id ? { ...item, text: event.target.value } : item
                        )
                      })
                    }
                  />
                </label>
                <button
                  className="text-button danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Remove this reading? Existing drafts retain their original source references until regenerated.'
                      )
                    )
                      update({
                        ...lesson,
                        sources: lesson.sources.filter((item) => item.id !== source.id)
                      })
                  }}
                >
                  Remove reading
                </button>
              </details>
            ))}
          </section>
          <section className="teaching-card">
            <h2>2. Develop the lesson</h2>
            <details className="teaching-reading">
              <summary>
                AI settings · {ai?.hasKey ? 'API key saved' : 'Add an OpenAI API key'}
              </summary>
              <p>
                Your API key is encrypted on this computer, outside workspace backups. OpenAI API
                usage is billed to your API account.
              </p>
              <label>
                OpenAI model
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="gpt-4.1"
                />
              </label>
              <label>
                API key
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    ai?.hasKey ? 'Leave blank to keep the saved key' : 'Enter your OpenAI API key'
                  }
                />
              </label>
              <div className="topbar-actions">
                <button
                  className="button secondary"
                  onClick={() =>
                    void run(async () => {
                      const key = apiKey.trim()
                      setApiKey('')
                      const settings = await window.api.teaching.saveAiSettings({
                        model,
                        ...(key ? { apiKey: key } : {})
                      })
                      setAi(settings)
                      setModel(settings.model)
                      setMessage(
                        'AI settings saved. You can now send lesson readings for synthesis.'
                      )
                    })
                  }
                >
                  Save AI settings
                </button>
                <button
                  className="text-button danger"
                  disabled={!ai?.hasKey}
                  onClick={() =>
                    void run(async () => {
                      setApiKey('')
                      const settings = await window.api.teaching.saveAiSettings({
                        model: ai!.model,
                        removeKey: true
                      })
                      setAi(settings)
                      setMessage('Saved API key removed')
                    })
                  }
                >
                  Remove saved key
                </button>
              </div>
            </details>
            <p>
              AI synthesis sends this lesson’s source text, titles, audience, class length, and
              objectives to OpenAI. It creates a source-linked synthesis, lecture notes, and slides
              with speaker notes. Review the interpretation and citations before teaching.
            </p>
            <button
              className="button primary"
              disabled={
                !ai?.hasKey ||
                !lesson.sources.length ||
                lesson.sources.some((source) => !source.text.trim()) ||
                !lesson.title.trim() ||
                lesson.duration < 5 ||
                lesson.duration > 480 ||
                !Number.isInteger(lesson.duration)
              }
              onClick={() => {
                if (
                  (lesson.notes || lesson.slides || lesson.synthesis) &&
                  !window.confirm(
                    'Replace the synthesis, lecture notes, and slides with AI drafts? Your edits remain unchanged if generation fails.'
                  )
                )
                  return
                void run(async () => {
                  setSynthesizing(true)
                  setMessage(
                    `Sending ${lesson.sources.length} readings to OpenAI (${ai?.model}). This can take a few minutes.`
                  )
                  try {
                    const result = await window.api.teaching.synthesize(current.current)
                    update(result)
                    setMessage('AI drafts ready. Review and save the lesson.')
                  } finally {
                    setSynthesizing(false)
                  }
                })
              }}
            >
              Send readings &amp; synthesize with AI
            </button>
            {lesson.generation && (
              <p className="muted">
                Last AI draft: {lesson.generation.model} ·{' '}
                {new Date(lesson.generation.generatedAt).toLocaleString()}. Later edits may change
                the generated content.
              </p>
            )}
            <p>
              Prefer to work offline? Local drafting selects source passages and shared terms
              without sending any material.
            </p>
            <button
              className="button primary"
              disabled={
                !lesson.sources.some((source) => source.text.trim()) ||
                !lesson.title.trim() ||
                lesson.duration < 5 ||
                lesson.duration > 480 ||
                !Number.isInteger(lesson.duration)
              }
              onClick={() => {
                if (
                  (lesson.notes || lesson.slides || lesson.synthesis) &&
                  !window.confirm(
                    'Replace the synthesis, lecture notes, and slides with new drafts? This replaces your edits.'
                  )
                )
                  return
                try {
                  update({ ...lesson, ...draftLesson(lesson), generation: undefined })
                  setMessage(
                    'Drafts created. Review the source passages and add your teaching interpretation; save when ready.'
                  )
                } catch (failure) {
                  setError(String(failure))
                }
              }}
            >
              Draft locally
            </button>
          </section>
          <section className="teaching-card">
            <div className="topbar-actions">
              {(['synthesis', 'notes', 'slides'] as const).map((kind) => (
                <button
                  key={kind}
                  className={`button ${tab === kind ? 'primary' : 'secondary'}`}
                  aria-pressed={tab === kind}
                  onClick={() => setTab(kind)}
                >
                  {kind === 'notes'
                    ? 'Lecture notes'
                    : kind === 'slides'
                      ? 'Slides'
                      : 'Source synthesis'}
                </button>
              ))}
              <button
                className="button secondary"
                disabled={!lesson[tab].trim()}
                onClick={() =>
                  void run(async () => {
                    if (await window.api.teaching.export(current.current, tab))
                      setMessage('Exported teaching material')
                  })
                }
              >
                <Download size={16} /> Export {tab === 'slides' ? 'HTML deck' : 'Markdown'}
              </button>
              {tab === 'slides' && (
                <button
                  className="button primary"
                  disabled={!lesson.slides.trim()}
                  onClick={() =>
                    void run(async () => {
                      if (await window.api.teaching.export(current.current, 'pptx'))
                        setMessage('Exported editable PowerPoint with speaker notes')
                    })
                  }
                >
                  <Download size={16} /> Export PowerPoint
                </button>
              )}
            </div>
            {tab === 'slides' && (
              <p>
                Separate slides with --- and start slide titles with #. Put ??? on its own line
                before speaker notes. PowerPoint export keeps text editable and splits long content
                across continuation slides.
              </p>
            )}
            <div className="teaching-editors">
              <label>
                Edit {tab}
                <textarea
                  rows={20}
                  value={lesson[tab]}
                  onChange={(event) => update({ ...lesson, [tab]: event.target.value })}
                  placeholder="Draft from readings or write your own material here."
                />
              </label>
              <div className="teaching-preview" aria-label="Preview">
                {tab === 'slides' ? (
                  parseTeachingSlides(lesson.slides).map((slide, index) => (
                    <article className="teaching-slide" key={index}>
                      <small>Slide {index + 1}</small>
                      <ReactMarkdown>{`# ${slide.title}\n\n${slide.body}`}</ReactMarkdown>
                      {slide.notes && (
                        <details>
                          <summary>Speaker notes</summary>
                          <ReactMarkdown>{slide.notes}</ReactMarkdown>
                        </details>
                      )}
                    </article>
                  ))
                ) : (
                  <ReactMarkdown>{lesson[tab]}</ReactMarkdown>
                )}
              </div>
            </div>
          </section>
        </fieldset>
        {busy && <p role="status">Working with your teaching material…</p>}
        {synthesizing && (
          <button
            className="button secondary"
            onClick={() => {
              void window.api.teaching
                .cancelSynthesis()
                .catch((failure) => setError(String(failure)))
            }}
          >
            Cancel AI synthesis
          </button>
        )}
      </div>
    </>
  )
}
