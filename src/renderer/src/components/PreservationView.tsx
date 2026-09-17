import {
  ArchiveRestore,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileJson2,
  FileSpreadsheet,
  HardDrive,
  RefreshCw,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react'
import { useState } from 'react'
import type {
  IntegrityReport,
  QualitativeExportFormat,
  WorkspaceInfo,
  WorkspacePackageSummary
} from '../../../shared/domain'

interface Props {
  workspace: WorkspaceInfo
  onWorkspaceRestored: (workspace: WorkspaceInfo) => void
  onError: (message: string) => void
  onNotice: (message: string) => void
}

function messageFrom(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'The preservation operation could not be completed.'
}

function formatBytes(bytes: number): string {
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

function PreservationView({
  workspace,
  onWorkspaceRestored,
  onError,
  onNotice
}: Props): React.JSX.Element {
  const [report, setReport] = useState<IntegrityReport | null>(null)
  const [backup, setBackup] = useState<WorkspacePackageSummary | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function checkIntegrity(): Promise<void> {
    setBusy('check')
    try {
      const next = await window.api.preservation.checkIntegrity()
      setReport(next)
      if (next.databaseStatus === 'ok' && !next.missingCount && !next.modifiedCount) {
        onNotice('Workspace database and managed files passed their integrity checks.')
      }
    } catch (error) {
      onError(messageFrom(error))
    } finally {
      setBusy(null)
    }
  }

  async function createBackup(): Promise<void> {
    setBusy('backup')
    try {
      const result = await window.api.preservation.createBackup()
      if (result) {
        setBackup(result)
        onNotice(`Created a verified backup containing ${result.fileCount} files.`)
      }
    } catch (error) {
      onError(messageFrom(error))
    } finally {
      setBusy(null)
    }
  }

  async function restoreBackup(): Promise<void> {
    setBusy('restore')
    try {
      const restored = await window.api.preservation.restoreBackup()
      if (restored) {
        onWorkspaceRestored(restored)
        onNotice(`Restored and opened “${restored.name}”.`)
      }
    } catch (error) {
      onError(messageFrom(error))
    } finally {
      setBusy(null)
    }
  }

  async function exportQualitative(format: QualitativeExportFormat): Promise<void> {
    setBusy(format)
    try {
      const count = await window.api.preservation.exportQualitative(format)
      if (count !== null)
        onNotice(`Exported ${count} qualitative records as ${format.toUpperCase()}.`)
    } catch (error) {
      onError(messageFrom(error))
    } finally {
      setBusy(null)
    }
  }

  const healthy =
    report && report.databaseStatus === 'ok' && !report.missingCount && !report.modifiedCount

  return (
    <div className="preservation-workspace">
      <header className="preservation-header">
        <div>
          <p className="eyebrow">Long-term stewardship</p>
          <h1>Preservation</h1>
          <p>Keep the complete local workspace verifiable, recoverable, and portable.</p>
        </div>
        <div className="preservation-local">
          <HardDrive size={17} />
          <span>
            <strong>{workspace.name}</strong>
            <small>{workspace.path}</small>
          </span>
        </div>
      </header>

      <div className="preservation-grid">
        <section className="preservation-card integrity-card">
          <div className="preservation-icon">
            {healthy ? <ShieldCheck size={23} /> : <ShieldAlert size={23} />}
          </div>
          <div className="preservation-card-heading">
            <p className="eyebrow">Integrity</p>
            <h2>Verify workspace</h2>
            <p>
              Check SQLite structure and recompute every managed PDF, audio, and video checksum.
            </p>
          </div>
          <button className="button secondary" disabled={busy !== null} onClick={checkIntegrity}>
            <RefreshCw size={15} className={busy === 'check' ? 'spin' : ''} />
            {report ? 'Check again' : 'Run integrity check'}
          </button>
          {report && (
            <div className={`integrity-result ${healthy ? 'healthy' : 'attention'}`}>
              <header>
                {healthy ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
                <strong>{healthy ? 'Everything is intact' : 'Attention required'}</strong>
                <span>{new Date(report.checkedAt).toLocaleString()}</span>
              </header>
              <div>
                <span>
                  <b>{report.okCount}</b> verified
                </span>
                <span>
                  <b>{report.missingCount}</b> missing
                </span>
                <span>
                  <b>{report.modifiedCount}</b> modified
                </span>
              </div>
              {!healthy && (
                <ul>
                  {report.items
                    .filter((item) => item.status !== 'ok')
                    .map((item) => (
                      <li key={`${item.kind}-${item.relativePath}`}>
                        <strong>{item.name}</strong>
                        <span>{item.status}</span>
                        <small>{item.relativePath}</small>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="preservation-card">
          <div className="preservation-icon">
            <DatabaseBackup size={23} />
          </div>
          <div className="preservation-card-heading">
            <p className="eyebrow">Complete backup</p>
            <h2>Create workspace package</h2>
            <p>
              Make a consistent database snapshot plus managed files and a versioned SHA-256
              manifest.
            </p>
          </div>
          <button className="button primary" disabled={busy !== null} onClick={createBackup}>
            <DatabaseBackup size={15} />{' '}
            {busy === 'backup' ? 'Creating…' : 'Create verified backup'}
          </button>
          {backup && (
            <div className="backup-result">
              <CheckCircle2 size={17} />
              <div>
                <strong>Backup ready</strong>
                <span>
                  {backup.fileCount} files · {formatBytes(backup.byteSize)}
                </span>
                <small title={backup.path}>{backup.path}</small>
              </div>
            </div>
          )}
        </section>

        <section className="preservation-card">
          <div className="preservation-icon">
            <ArchiveRestore size={23} />
          </div>
          <div className="preservation-card-heading">
            <p className="eyebrow">Recovery</p>
            <h2>Restore into a new folder</h2>
            <p>
              Validate a backup package before copying it, then reopen the restored workspace
              without overwriting existing research.
            </p>
          </div>
          <button className="button secondary" disabled={busy !== null} onClick={restoreBackup}>
            <ArchiveRestore size={15} /> {busy === 'restore' ? 'Restoring…' : 'Restore backup'}
          </button>
          <p className="preservation-note">
            Restore always requires an empty destination and never changes the backup package.
          </p>
        </section>

        <section className="preservation-card qualitative-export-card">
          <div className="preservation-icon">
            <Download size={23} />
          </div>
          <div className="preservation-card-heading">
            <p className="eyebrow">Interoperability</p>
            <h2>Export qualitative data</h2>
            <p>
              Take interviews, transcript passages, codes, and synthesis memos into other research
              tools.
            </p>
          </div>
          <div className="preservation-actions">
            <button
              className="button secondary"
              disabled={busy !== null}
              onClick={() => exportQualitative('json')}
            >
              <FileJson2 size={15} /> Versioned JSON
            </button>
            <button
              className="button secondary"
              disabled={busy !== null}
              onClick={() => exportQualitative('csv')}
            >
              <FileSpreadsheet size={15} /> CSV
            </button>
          </div>
          <p className="preservation-note">
            Exports are local copies. Consent and handling obligations still apply outside Research
            Studio.
          </p>
        </section>
      </div>
    </div>
  )
}

export default PreservationView
