import { AlertCircle, CheckCircle2, FileArchive, RefreshCw, UploadCloud } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { SharedWorkerDocument, SharedWorkerStatus } from '../../../shared/domain'

interface SharedWorkerPanelProps {
  onError: (message: string) => void
  onNotice: (message: string) => void
  onImported: () => Promise<void>
}

function connectionLabel(status: SharedWorkerStatus): string {
  if (status.connection === 'connected') return 'Worker: Connected'
  if (status.connection === 'not-configured') return 'Worker: Not configured'
  if (status.connection === 'unavailable') return 'Worker: Unavailable'
  return 'Worker: Invalid state'
}

function documentLabel(document: SharedWorkerDocument): string {
  if (document.extractionStatus === 'needs-ocr') return 'Needs OCR'
  if (document.jobStatus === 'failed') return 'Failed'
  if (document.jobStatus === 'complete') return 'Processed'
  if (document.jobStatus === 'working') return 'Working'
  return 'Queued'
}

export default function SharedWorkerPanel({
  onError,
  onNotice,
  onImported
}: SharedWorkerPanelProps): React.JSX.Element {
  const [status, setStatus] = useState<SharedWorkerStatus | null>(null)
  const [documents, setDocuments] = useState<SharedWorkerDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [nextStatus, nextDocuments] = await Promise.all([
        window.api.worker.status(),
        window.api.worker.documents()
      ])
      setStatus(nextStatus)
      setDocuments(nextDocuments)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not read worker state.')
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  async function importDocument(document: SharedWorkerDocument): Promise<void> {
    setImporting(document.fileId)
    try {
      const result = await window.api.worker.importDocument(document.fileId)
      if (result.source) await onImported()
      onNotice(result.message)
      await refresh()
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not import worker document.')
    } finally {
      setImporting(null)
    }
  }

  return (
    <section className="worker-panel" aria-label="Shared worker documents">
      <div className="worker-panel-heading">
        <div>
          <p className="eyebrow">Shared processing</p>
          <h2>{status ? connectionLabel(status) : 'Worker status'}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh worker state"
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} className={loading ? 'spin' : undefined} />
        </button>
      </div>
      {status?.connection === 'connected' ? (
        <div className="worker-counts" aria-label="Worker job counts">
          <span>{status.queuedJobs} queued</span>
          <span>{status.workingJobs} working</span>
          <span>{status.completedJobs} complete</span>
          <span>{status.failedJobs} failed</span>
        </div>
      ) : (
        <p className="worker-message">{status?.message ?? 'Checking shared worker state…'}</p>
      )}
      {documents.length > 0 && (
        <div className="worker-documents">
          {documents.map((document) => {
            const imported = Boolean(document.importedSourceId)
            const canImport = document.jobStatus === 'complete' && !imported
            return (
              <div className="worker-document" key={document.fileId}>
                <div className="worker-document-icon">
                  <FileArchive size={17} />
                </div>
                <div className="worker-document-summary">
                  <strong>{document.filename}</strong>
                  <span>
                    {document.extension.toUpperCase() || 'FILE'} · {documentLabel(document)}
                    {document.extractionStatus === 'needs-ocr' ? ' · text unavailable' : ''}
                  </span>
                  {document.jobError && (
                    <small title={document.jobError}>{document.jobError}</small>
                  )}
                </div>
                {imported ? (
                  <span className="worker-imported">
                    <CheckCircle2 size={14} /> In library
                  </span>
                ) : canImport ? (
                  <button
                    className="text-button"
                    disabled={importing === document.fileId}
                    onClick={() => void importDocument(document)}
                  >
                    <UploadCloud size={14} />{' '}
                    {importing === document.fileId ? 'Importing…' : 'Import'}
                  </button>
                ) : document.jobStatus === 'failed' ? (
                  <span className="worker-failed">
                    <AlertCircle size={14} /> Failed
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      {status?.connection === 'connected' && documents.length === 0 && (
        <p className="worker-message">No worker documents discovered yet.</p>
      )}
    </section>
  )
}
