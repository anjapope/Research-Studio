import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  preparationPages,
  prepareDocument,
  type PreparationProgress
} from '../../../shared/document-preparation'
import { extractPdfPage, recognizePdfPage } from '../pdf-preparation'

interface Props {
  pdf: PDFDocumentProxy
  fileId: string
  refreshKey: number
  disabled: boolean
  onPage: (page: number) => void
  onBusy: (busy: boolean) => void
  onPrepared: () => void
}

export default function DocumentPreparation({
  pdf,
  fileId,
  refreshKey,
  disabled,
  onPage,
  onBusy,
  onPrepared
}: Props): React.JSX.Element {
  const [progress, setProgress] = useState<PreparationProgress | null>(null)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const run = useRef<AbortController | null>(null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      run.current?.abort()
    }
  }, [])

  useEffect(() => {
    let disposed = false
    if (run.current) return
    window.api.reader
      .listPageSummaries(fileId)
      .then((saved) => {
        if (!disposed && !run.current)
          setProgress((previous) => {
            const pages = preparationPages(pdf.numPages, saved)
            // Keep this session's page errors visible when the reader refreshes its text.
            for (const item of pages) {
              const old = previous?.pages[item.page - 1]
              if (item.status !== 'readable' && old?.status === 'failed') Object.assign(item, old)
            }
            return {
              status: previous?.status ?? 'idle',
              pages,
              currentPage: null,
              completed: 0,
              workTotal: 0
            }
          })
      })
      .catch((caught) => {
        if (!disposed) setError(String(caught))
      })
    return () => {
      disposed = true
    }
  }, [fileId, pdf, refreshKey])

  async function start(mode: 'text' | 'ocr'): Promise<void> {
    if (!progress || run.current) return
    const controller = new AbortController()
    run.current = controller
    setCancelling(false)
    setError('')
    onBusy(true)
    try {
      await prepareDocument(
        progress.pages,
        mode,
        {
          getSaved: (page) => window.api.reader.getPageText(fileId, page),
          extract: (page) => extractPdfPage(pdf, page),
          recognize: (page) =>
            recognizePdfPage(pdf, page, controller.signal, window.api.reader.ocrPage),
          save: (page, text, method, confidence) =>
            window.api.reader.savePageText(fileId, page, text, method, confidence)
        },
        controller.signal,
        (next) => {
          if (mounted.current) setProgress(next)
        }
      )
    } catch (caught) {
      if (mounted.current) setError(String(caught))
    } finally {
      run.current = null
      if (mounted.current) {
        setCancelling(false)
        onBusy(false)
        onPrepared()
      }
    }
  }

  const busy = progress?.status === 'running'
  const readable = progress?.pages.filter((item) => item.status === 'readable').length ?? 0
  const needsOcr = progress?.pages.filter((item) => item.status === 'needs-ocr') ?? []
  const failures = progress?.pages.filter((item) => item.status === 'failed') ?? []
  const pending = progress?.pages.filter((item) => item.status === 'pending').length ?? pdf.numPages
  const ocrAvailable = needsOcr.length + failures.length

  return (
    <section className="document-preparation" aria-label="Full-source document preparation">
      <div className="preparation-heading">
        <strong>Prepare for analysis</strong>
        <div className="preparation-actions">
          <button
            className="button secondary"
            disabled={!progress || busy || disabled}
            onClick={() => start('text')}
          >
            {progress?.status === 'idle' ? 'Prepare for analysis' : 'Retry / check all pages'}
          </button>
          {ocrAvailable > 0 && (
            <button
              className="button secondary"
              disabled={busy || disabled}
              onClick={() => start('ocr')}
            >
              Run local English OCR ({ocrAvailable} pages)
            </button>
          )}
          {busy && (
            <button
              className="button secondary"
              disabled={cancelling}
              onClick={() => {
                setCancelling(true)
                run.current?.abort()
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <p role="status" aria-live="polite">
        {!progress
          ? 'Checking saved page coverage…'
          : `${readable} / ${pdf.numPages} pages have readable text (${Math.round((readable / pdf.numPages) * 100)}%). ` +
            `${needsOcr.length} need OCR or are blank; ${failures.length} failed; ${pending} unchecked.`}
        {busy &&
          (cancelling
            ? ' Cancelling; waiting for the current operation…'
            : ` Processing page ${progress?.currentPage}: ${progress?.completed} / ${progress?.workTotal} checked this pass.`)}
        {progress?.status === 'cancelled' &&
          ' Cancelled. Saved pages are retained; retry to continue.'}
        {progress?.status === 'complete' && ' Pass finished. Saved text is available in Discover.'}
      </p>
      {busy && (
        <progress
          aria-label="Preparation progress"
          value={progress?.completed}
          max={progress?.workTotal || 1}
        />
      )}
      <small>
        On-device only. OCR is optional and may misread text. Coverage means non-empty text, not
        verified accuracy. Closing the reader cancels preparation.
      </small>
      {error && <p role="alert">{error}</p>}
      {(needsOcr.length > 0 || failures.length > 0) && (
        <details>
          <summary>Inspect pages needing attention</summary>
          <ul>
            {[...failures, ...needsOcr].map((item) => (
              <li key={item.page}>
                <button disabled={disabled} onClick={() => onPage(item.page)}>
                  Page {item.page}
                </button>
                : {item.error || 'No embedded text; OCR may help, or this page may be blank.'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
