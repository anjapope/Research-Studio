# Research Studio Worker Foundation

Mayday 3 is the background automation and file-processing worker for Research Studio. Stage C adds trustworthy document ingestion while keeping the worker independent from Electron and the renderer. It does not make autonomous AI decisions, call language models, modify the renderer UI, or delete Inbox files.

```text
Inbox -> Scan -> Queued Job -> Worker -> Preserved Source -> Extract -> Output -> Manifest
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

- `files.json` stores discovered file metadata: filename, extension, byte size, discovery time, last seen time, modified time, source path, SHA-256 checksum, processing status, and associated project when known. After processing it also records the preserved source, extraction status, extraction outputs, processor, timestamps, warnings, and job ID.
- `jobs.json` stores processing jobs: ID, source file, job type, creation/update/working/completion/failure times, status, processor, input location, output location, warnings, and error information.

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
