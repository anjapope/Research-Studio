# Research Studio Worker Foundation

Mayday 3 is the background automation and file-processing worker for Research Studio. This first phase adds safe shared-folder infrastructure only. It does not make autonomous AI decisions, call language models, modify the renderer UI, or move/delete original research files.

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

During dry runs, the scanner returns the actions it would take without creating folders, manifests, job descriptors, or logs.

## Manifests

Manifests are JSON files under `System/manifests/`:

- `files.json` stores discovered file metadata: filename, extension, byte size, discovery time, last seen time, modified time, source path, SHA-256 checksum, processing status, and associated project when known.
- `jobs.json` stores processing jobs: ID, source file, job type, creation/update time, status, output location, and error information.

Repeated scans update an existing file entry by source path instead of adding duplicates. Existing jobs are reused by source file and job type.

## Jobs

The first job type is `ingest-inbox-file`. Supported statuses are:

- `queued`
- `working`
- `complete`
- `failed`

Queued jobs also get a machine-readable descriptor in `Processing/Queued/<job-id>.json` during non-dry-run scans. `outputLocation` remains `null` until a processor has a real generated output to report. Future processors can claim jobs by transitioning them into `working`, then finish them as `complete` or `failed`.

## Logs

Worker activity is written as JSON Lines under `System/logs/YYYY-MM-DD.jsonl` during non-dry-run scans. Each scan event records the time, file ID, job ID, source path, event name, and dry-run status.

## Running A Scan

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

## Not Yet Implemented

- Continuous filesystem watching.
- Recursive Inbox scanning.
- Project inference.
- PDF/OCR/data extraction processors.
- Job claiming across multiple machines.
- Renderer UI controls.
- AI/model calls.
- Movement or deletion of original research files.
