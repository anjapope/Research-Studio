import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ExternalLink,
  Highlighter,
  Quote,
  ScanText,
  Trash2,
  X
} from 'lucide-react'
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DocumentPageText,
  EvidenceExcerpt,
  QualitativeCode,
  Source,
  SourceFile
} from '../../../shared/domain'
import DocumentPreparation from './DocumentPreparation'
import { extractPdfPage, recognizePdfPage } from '../pdf-preparation'

GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  source: Source
  file: SourceFile
  initialPage?: number
  onClose: () => void
  onError: (message: string) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'The PDF reader encountered an error.'
}

function PdfReader({ source, file, initialPage = 1, onClose, onError }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(initialPage)
  const [pageText, setPageText] = useState('')
  const [pageRecord, setPageRecord] = useState<DocumentPageText | null>(null)
  const [selection, setSelection] = useState('')
  const [note, setNote] = useState('')
  const [codeText, setCodeText] = useState('')
  const [codes, setCodes] = useState<QualitativeCode[]>([])
  const [excerpts, setExcerpts] = useState<EvidenceExcerpt[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [coverageVersion, setCoverageVersion] = useState(0)
  const [readerError, setReaderError] = useState('')
  const manualOcr = useRef<AbortController | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const [nextExcerpts, nextCodes] = await Promise.all([
      window.api.reader.listExcerpts(source.id),
      window.api.reader.listCodes()
    ])
    setExcerpts(nextExcerpts)
    setCodes(nextCodes)
  }, [source.id])

  useEffect(() => {
    let disposed = false
    let task: ReturnType<typeof getDocument> | undefined
    window.api.reader
      .pdfData(file.id)
      .then((data) => {
        if (disposed) return null
        task = getDocument({ data: new Uint8Array(data) })
        return task.promise
      })
      .then((pdf) => {
        if (!disposed) setDocument(pdf)
      })
      .catch((error) => {
        if (!disposed) setReaderError(errorMessage(error))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    Promise.all([window.api.reader.listExcerpts(source.id), window.api.reader.listCodes()])
      .then(([nextExcerpts, nextCodes]) => {
        if (!disposed) {
          setExcerpts(nextExcerpts)
          setCodes(nextCodes)
        }
      })
      .catch((error) => onError(errorMessage(error)))
    return () => {
      disposed = true
      manualOcr.current?.abort()
      void task?.destroy()
    }
  }, [file.id, onError, source.id])

  useEffect(() => {
    if (!document || !canvasRef.current) return
    let cancelled = false
    let renderTask: RenderTask | undefined
    document
      .getPage(page)
      .then(async (pdfPage) => {
        if (cancelled || !canvasRef.current) return
        const viewport = pdfPage.getViewport({ scale: 1.35 })
        const canvas = canvasRef.current
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas rendering is unavailable.')
        canvas.width = viewport.width
        canvas.height = viewport.height
        renderTask = pdfPage.render({ canvas, canvasContext: context, viewport })
        await renderTask.promise
        const extracted = await extractPdfPage(document, page)
        if (!cancelled) {
          const record = extracted
            ? await window.api.reader.savePageText(file.id, page, extracted, 'pdf-text')
            : await window.api.reader.getPageText(file.id, page)
          if (cancelled) return
          setPageRecord(record)
          setPageText(record?.text || extracted)
          setCoverageVersion((value) => value + 1)
          setSelection('')
        }
      })
      .catch((error) => {
        if (!cancelled) setReaderError(errorMessage(error))
      })
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [document, file.id, onError, page])

  async function runOcr(): Promise<void> {
    if (!document || manualOcr.current || preparing) return
    const controller = new AbortController()
    manualOcr.current = controller
    setOcrRunning(true)
    try {
      const result = await recognizePdfPage(
        document,
        page,
        controller.signal,
        window.api.reader.ocrPage
      )
      if (controller.signal.aborted) return
      if (!result.text) throw new Error('OCR did not find readable English text on this page.')
      const saved = await window.api.reader.savePageText(
        file.id,
        page,
        result.text,
        'ocr',
        result.confidence
      )
      if (controller.signal.aborted) return
      setPageRecord(saved)
      setPageText(saved.text)
      setCoverageVersion((value) => value + 1)
    } catch (error) {
      if (!controller.signal.aborted) setReaderError(errorMessage(error))
    } finally {
      manualOcr.current = null
      if (!controller.signal.aborted) setOcrRunning(false)
    }
  }

  function captureSelection(): void {
    const range = window.getSelection()
    if (!range || range.isCollapsed || !textRef.current) return
    const anchor = range.anchorNode
    if (!anchor || !textRef.current.contains(anchor)) return
    setSelection(range.toString().replace(/\s+/g, ' ').trim())
  }

  async function saveExcerpt(): Promise<void> {
    if (!selection) return
    setSaving(true)
    try {
      await window.api.reader.saveExcerpt({
        sourceId: source.id,
        sourceFileId: file.id,
        text: selection,
        note: note.trim() || null,
        page,
        codeNames: codeText
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      })
      setSelection('')
      setNote('')
      setCodeText('')
      window.getSelection()?.removeAllRanges()
      await refresh()
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function removeExcerpt(id: string): Promise<void> {
    try {
      await window.api.reader.removeExcerpt(id)
      await refresh()
    } catch (error) {
      onError(errorMessage(error))
    }
  }

  return (
    <section
      className="reader"
      role="dialog"
      aria-modal="true"
      aria-label={`Reading ${source.title}`}
    >
      <header className="reader-header">
        <button className="reader-back" onClick={onClose}>
          <ArrowLeft size={17} /> Library
        </button>
        <div className="reader-title">
          <BookOpen size={18} />
          <div>
            <strong>{source.title}</strong>
            <span>{file.originalName}</span>
          </div>
        </div>
        <div className="reader-header-actions">
          <button
            onClick={() =>
              window.api.sources.openFile(file.id).catch((error) => onError(errorMessage(error)))
            }
          >
            <ExternalLink size={15} /> Open externally
          </button>
          <button className="icon-button" aria-label="Close reader" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
      </header>

      <div className="reader-body">
        <main className="pdf-stage">
          <div className="page-toolbar">
            <button
              aria-label="Previous page"
              disabled={page <= 1 || ocrRunning}
              onClick={() => setPage((value) => value - 1)}
            >
              <ArrowLeft size={16} />
            </button>
            <span>
              Page <strong>{page}</strong> of {document?.numPages ?? '—'}
            </span>
            <button
              aria-label="Next page"
              disabled={!document || page >= document.numPages || ocrRunning}
              onClick={() => setPage((value) => value + 1)}
            >
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="pdf-scroll">
            {readerError && (
              <p className="reader-error" role="alert">
                {readerError}
              </p>
            )}
            {document && (
              <DocumentPreparation
                pdf={document}
                fileId={file.id}
                refreshKey={coverageVersion}
                disabled={ocrRunning}
                onPage={setPage}
                onBusy={setPreparing}
                onPrepared={() => {
                  window.api.reader
                    .getPageText(file.id, page)
                    .then((record) => {
                      if (record) {
                        setPageRecord(record)
                        setPageText(record.text)
                      }
                    })
                    .catch((error) => setReaderError(errorMessage(error)))
                }}
              />
            )}
            {loading && <div className="reader-loading">Loading PDF…</div>}
            <canvas
              ref={canvasRef}
              className="pdf-canvas"
              aria-label={`Rendered PDF page ${page}`}
            />
            {!pageText && !loading && document && (
              <section className="ocr-prompt">
                <ScanText size={21} />
                <div>
                  <strong>No selectable text detected</strong>
                  <span>Run private, on-device English OCR for this page.</span>
                </div>
                <button
                  className="button secondary"
                  disabled={ocrRunning || preparing}
                  onClick={runOcr}
                >
                  <ScanText size={15} /> {ocrRunning ? 'Recognizing…' : 'Run local OCR'}
                </button>
              </section>
            )}
            {pageText && (
              <section className="selectable-text">
                <div>
                  <Highlighter size={15} />
                  <strong>Select evidence from page {page}</strong>
                  <span>
                    {pageRecord?.extractionMethod === 'ocr'
                      ? `Local OCR${pageRecord.confidence === null ? '' : ` · ${Math.round(pageRecord.confidence)}% confidence`}`
                      : 'Extracted from embedded PDF text'}
                  </span>
                </div>
                <div ref={textRef} className="page-text" onMouseUp={captureSelection}>
                  {pageText}
                </div>
              </section>
            )}
          </div>
        </main>

        <aside className="evidence-sidebar">
          <div className="capture-panel">
            <p className="eyebrow">Evidence capture</p>
            <h2>Trace the claim to its source.</h2>
            <blockquote className={selection ? '' : 'empty'}>
              {selection || 'Select text in the extracted page text to begin.'}
            </blockquote>
            <label>
              <span>Research note</span>
              <textarea
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why does this passage matter?"
              />
            </label>
            <label>
              <span>Qualitative codes</span>
              <input
                list="code-suggestions"
                value={codeText}
                onChange={(event) => setCodeText(event.target.value)}
                placeholder="theme, method, tension"
              />
            </label>
            <datalist id="code-suggestions">
              {codes.map((code) => (
                <option key={code.id} value={code.name} />
              ))}
            </datalist>
            <button
              className="button primary capture-button"
              disabled={!selection || saving}
              onClick={saveExcerpt}
            >
              <Check size={16} /> {saving ? 'Saving…' : 'Save evidence excerpt'}
            </button>
          </div>
          <div className="excerpt-list">
            <div className="excerpt-heading">
              <h3>Saved evidence</h3>
              <span>{excerpts.length}</span>
            </div>
            {excerpts.length === 0 ? (
              <div className="excerpt-empty">
                <Quote size={21} />
                <p>Saved excerpts from this source will appear here.</p>
              </div>
            ) : (
              excerpts.map((excerpt) => (
                <article
                  className={`excerpt-card ${excerpt.page === page ? 'current-page' : ''}`}
                  key={excerpt.id}
                >
                  <div className="excerpt-meta">
                    <button onClick={() => setPage(excerpt.page)}>Page {excerpt.page}</button>
                    <button aria-label="Delete excerpt" onClick={() => removeExcerpt(excerpt.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <blockquote>“{excerpt.text}”</blockquote>
                  {excerpt.note && <p>{excerpt.note}</p>}
                  {excerpt.codes.length > 0 && (
                    <div className="tags">
                      {excerpt.codes.map((code) => (
                        <span className="tag" key={code.id}>
                          {code.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <small title={excerpt.fileSha256}>
                    From {excerpt.fileName} · checksum retained
                  </small>
                </article>
              ))
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}

export default PdfReader
