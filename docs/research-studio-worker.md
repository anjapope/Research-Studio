# Research Studio Worker Foundation

Mayday 3 is the background automation and file-processing worker for Research Studio. Stage C adds trustworthy document ingestion while keeping the worker independent from Electron and the renderer. It does not make autonomous AI decisions, call language models, modify the renderer UI, or delete Inbox files.

```text
External file
  |
Shared Inbox
  |
Stage B scanner
  |
Queued job
  |
Stage C processor
  |
Preserved source + extracted representation
  |
Shared manifests and Outputs/Extracts
  |
Stage D SharedWorkerService
  |
Research Studio import -> Research Studio source
```

Stage B/C are processing infrastructure. Stage D is a read-only consumer of shared worker state until the user explicitly imports a completed document. The renderer never reads or writes shared JSON/files directly:

```text
Research Studio UI -> main/preload service -> shared manifests/outputs
Mayday 3 worker   -> processing            -> shared manifests/outputs
```

## Shared Data Root

The worker operates against a configurable shared data root. Do not put the Git repository inside OneDrive. Keep application code in Git, and point the worker at a shared Research Studio data folder using either an environment variable or a small JSON config file.

Environment variables:

```sh
export RESEARCH_STUDIO_DATA_ROOT="/path/to/Research Studio"
export RESEARCH_STUDIO_WORKER_DRY_RUN=true
```

JSON config:

```json
{
  "sharedDataRoot": "/path/to/Research Studio",
  "dryRun": true
}
```

`dryRun` defaults to `true` when not specified.

## Folder Structure

The filesystem abstraction owns all shared-folder paths and creates this structure when a non-dry-run scan is executed:

```text
Research Studio/
  Inbox/
  Sources/
    PDFs/
    Data/
    Media/
  Projects/
  Processing/
    Queued/
    Working/
    Complete/
    Failed/
  Outputs/
    Reports/
    Extracts/
    Exports/
  System/
    manifests/
    logs/
    config/
```

The root path is never hard-coded in source.

## Inbox Scans

`scanInbox(config)` scans files directly inside `Inbox/`. It records metadata and queues a simple `ingest-inbox-file` job for each new file. The scanner does not recursively scan subfolders yet, and it does not modify, move, or delete Inbox files.

During dry runs, the scanner returns the actions it would take without creating folders, manifests, job descriptors, or logs. Scanning and processing are deliberately separate commands.

## Manifests

Manifests are JSON files under `System/manifests/`:

- `files.json` stores discovered file metadata: filename, extension, byte size, discovery time, last seen time, modified time, source path, SHA-256 checksum, processing status, and associated project when known. Shared-file locations use portable `/`-separated references relative to the configured shared root; the optional `producerSourcePath` retains the producer's native absolute source path for provenance. After processing it also records the preserved source, extraction status, extraction outputs, processor, timestamps, warnings, and job ID.
- `jobs.json` stores processing jobs: ID, source file, job type, creation/update/working/completion/failure times, status, processor, input location, output location, warnings, and error information. Job file locations use the same portable root-relative form.

Research Studio also accepts existing version-1 manifests that contain absolute producer paths. It maps only an exact recognized shared-layout reference (for example `Sources/Data/...` or `Outputs/Extracts/...`) onto the configured root; it never infers a mapping from filenames or arbitrary matching folder names. Traversal, unrecognized absolute paths, and paths that resolve through symlinks outside the configured root are rejected. No manifest rewrite is required for this compatibility mode.

Repeated scans update an existing file entry by source path instead of adding duplicates. Existing jobs are reused by source file and job type.

## Jobs

The first job type is `ingest-inbox-file`. Supported statuses are:

- `queued`
- `working`
- `complete`
- `failed`

Queued jobs also get a machine-readable descriptor in `Processing/Queued/<job-id>.json` during non-dry-run scans. The processor moves the same descriptor through `Working`, then `Complete` or `Failed`. `outputLocation` remains `null` until a processor has a real generated output to report.

The current processor supports:

- `.txt`: UTF-8 text with BOM removal and newline normalization.
- `.md`: UTF-8 Markdown with the same conservative normalization.
- `.pdf`: embedded text extraction with page boundaries and page count. OCR is not attempted.

Unsupported files receive `unsupported-file-type`, remain preserved, and move to a failed job state. A PDF with no embedded text completes with `extractionStatus: "needs-ocr"`, a warning, and an empty normalized text output. That is a successful preservation/analysis result, not a claim that text extraction succeeded.

## Source Preservation and Outputs

Original Inbox files are never moved, rewritten, or deleted. Processed sources are copied into:

- `Sources/PDFs/` for PDFs.
- `Sources/Data/` for text and Markdown files.

Existing preserved files are reused only when their SHA-256 matches. Filename collisions receive a deterministic file-ID suffix, and the original filename remains in the file and extraction metadata.

Extraction outputs are deterministic and stored under `Outputs/Extracts/`:

- `<file-id>.json` contains the extraction record and normalized text.
- `<file-id>.txt` contains the normalized text representation.

Each extraction record keeps the chain from original source path to preserved source, processing job, extractor/version, checksum, timestamps, output locations, page count, character/word counts, warnings, and errors. Newline/BOM normalization is explicitly recorded as a warning; the worker does not claim normalized text is byte-identical to the source.

Repeated processing is idempotent: completed jobs are no longer in `Processing/Queued/`, and a second process run creates no new output. If a file changes at the same Inbox path, its new checksum creates a new file identity and job while retaining the previous manifest record.

Manifest and output JSON/text writes use temporary files followed by rename. Job descriptor moves use the shared filesystem, and original source files are preserved before extraction begins.

## Logs

Worker activity is written as JSON Lines under `System/logs/YYYY-MM-DD.jsonl` during non-dry-run scans. Processing events include `job-claimed`, `source-preserved`, `extraction-started`, `extraction-completed`, `extraction-needs-ocr`, `job-completed`, and `job-failed`. Events include file/job IDs and paths needed to correlate manifests, but never full document contents.

## Running The Worker

Run a dry scan from the command line:

```sh
RESEARCH_STUDIO_DATA_ROOT="/path/to/Research Studio" npm run worker:scan
```

Run a write-enabled scan after reviewing the dry-run output:

```sh
RESEARCH_STUDIO_DATA_ROOT="/path/to/Research Studio" RESEARCH_STUDIO_WORKER_DRY_RUN=false npm run worker:scan
```

The implementation is also available as a library entry point in `src/main/automation-worker.ts`:

```ts
import { loadWorkerConfig } from './src/main/automation-config'
import { scanInbox } from './src/main/automation-worker'

const config = loadWorkerConfig()
const result = scanInbox(config)
console.log(result)
```

For initial testing, use the focused Vitest file:

```sh
npm test -- src/main/automation-worker.test.ts
```

Process jobs that are already in `Processing/Queued/` without scanning Inbox:

```sh
RESEARCH_STUDIO_DATA_ROOT="/path/to/Research Studio" npm run worker:process
```

Use `RESEARCH_STUDIO_WORKER_DRY_RUN=true` or omit the variable to report intended processing actions without moving descriptors, preserving sources, writing extraction outputs, or updating manifests. Use `false` only after reviewing the dry-run result.

For a real shared-folder smoke test, first confirm the configured root and inspect the queued descriptor. Then run `worker:process`, verify the source copy, completed descriptor, extract JSON/text, manifest state, and JSONL events. Do not run against a real shared root without setting `RESEARCH_STUDIO_DATA_ROOT` explicitly. The automated tests always use temporary directories.

## Research Studio Integration

When Research Studio has an open local workspace, the Sources view reads worker status and processed-document metadata through the main/preload boundary. It reports connected, not-configured, unavailable, or invalid-state without blocking normal workspace use. The user can manually refresh the worker view and choose `Import` for a completed document.

Import creates an ordinary Research Studio source and managed source file. The source file retains worker file/job IDs, original and preserved paths, extraction location/status, processor, processing timestamp, and canonical extracted text. Worker manifests remain external state and are never written by the renderer. A repeated import is detected by worker file ID and returns an informative duplicate result.

PDFs retain the existing Research Studio PDF reader path. Text and Markdown files open through the existing main-process file handler, while their normalized worker text is retained as source notes and structured extraction data. `needs-ocr` remains a visible status and does not make the preserved PDF unusable.

## Stage E: Local Discovery Search

### Existing architecture and integration boundary

`WorkspaceDatabase` owns the workspace-local SQLite FTS5 `search_index` and its
`search_index_state`. Native source metadata, abstract, notes, authors and tags feed
one `source` entry. Native PDF reader/preparation saves write extracted or OCR page
text to `document_pages`, linked through `source_files` to `sources`; these become
separate `pdf-page` entries. Evidence excerpts, transcript segments, synthesis memos
and manuscript sections also feed their existing result types. Index content does
not have a separate generated-metadata classification; source origin/provenance
remains in the underlying records.

Database triggers mark the index dirty after content changes. `search()` rebuilds
a dirty index before querying; Discover also offers **Rebuild index**. Rebuilding
transactionally replaces index contents, so repeated rebuilds do not accumulate
entries. Queries use token-prefix matching, FTS5 ranking and content snippets.
Discover searches the open workspace across projects, with optional result-type
filters; it does not search other workspaces or the shared worker root.

Stage D's `SharedWorkerService` reads the Stage C extraction JSON during explicit
import. `attachWorkerSource()` stores its canonical normalized text in local
`source_extractions`, keyed by the managed `source_files.id`. Stage E includes
nonblank rows with `extraction_status = 'extracted'` in the existing source index
entry. This no longer relies on the editable copy in source notes. Search performs
no file extraction and does not synthesize page numbers from worker text.

Results retain `type: source` and the Research Studio source UUID as `entityId`.
The existing Discover navigation selects that source in Sources; PDF attachments
still open through the existing reader. Worker identity is never used as an
internal UUID. Ordinary result content contains source metadata and text, not
worker filesystem paths, IDs or hashes.

### Reconciliation, provenance and offline operation

Migration 12 adds insert/update/delete dirty-state triggers on `source_extractions`
and invalidates the existing index once. It adds no tables or columns and changes
no source identities, source contents, worker manifests or extraction records.
Opening a pre-Stage-E workspace applies the migration; its next Discover search
automatically rebuilds from local stored content. No deletion, re-import or manual
reconciliation is required. The existing **Rebuild index** action remains available.

Provenance stays normalized in `source_files` and `source_extractions`: source UUID,
worker file/job IDs, original filename, checksum, original/preserved/extraction
paths, extraction status, processor/extractor version, processing and import
timestamps. Indexing does not rewrite these values or duplicate them into index
rows. Different checksum-aware worker identities remain independent sources even
when their filenames match.

After import, both search and index rebuild operate entirely on the local database.
The managed source attachment also remains local. Mayday 3 and OneDrive can be
unavailable without preventing discovery of previously imported text. The renderer
continues to use the main/preload service boundary.

`needs-ocr`, failed and blank extraction rows contribute no extraction body to the
index. Source metadata/notes remain searchable under the existing rules. Stage E
does not perform OCR. Failed jobs are rejected by the completed-job import gate;
the integration now preserves the actual job status when presenting documents.

### Manual smoke test

Run the updated application and open the existing local workspace. In **Discover**,
search a distinctive phrase from the already imported `mayday1-test.txt.txt`, using
all result types or **Sources**. The first search automatically reconciles the
index. Open the result and verify it selects the existing source and retains its
worker provenance. No re-import or **Rebuild index** click is required. Worker PDF
body matches appear under **Sources**, not synthetic **PDF pages** results.

Automated tests use temporary roots and workspaces, including a schema-11 upgrade,
offline rebuild, duplicate filenames, failed/OCR-required documents and an embedded
text PDF. They do not inspect or modify the real smoke-test document. If its text
has no useful distinctive phrase, use a richer separately imported document for a
subsequent test without replacing the existing source.

## Not Yet Implemented

- Continuous filesystem watching.
- Recursive Inbox scanning.
- Project inference.
- OCR for scanned PDFs.
- DOCX or other office-document processing.
- Job claiming across multiple machines.
- Renderer UI controls or Electron background execution.
- AI/model calls.
- Scheduled daemon/service execution.
- Distributed locking or coordination.
- Automatic import of every worker document.
