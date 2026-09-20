# Research Studio architecture audit

This document describes the current Research Studio codebase as it exists on `mayday2/refactor`. It is an audit of the baseline, not a redesign plan.

## 1. Executive summary

Research Studio is a local-first Electron desktop application with a React renderer, a narrow preload bridge, and a main-process service layer backed by a SQLite workspace database and managed files on disk.

The application already has good top-level separation between:

- renderer UI in `src/renderer`
- IPC bridge and shared contracts in `src/preload` and `src/shared`
- main-process orchestration in `src/main`
- workspace persistence in SQLite plus managed file storage under `.research-studio`

The main maintainability pressure is not missing layers, but oversized layers:

- `WorkspaceService` is the central orchestration hub for nearly every feature.
- `WorkspaceDatabase` is the central persistence hub for nearly every feature.
- IPC contracts are repeated across `src/main/index.ts`, `src/preload/index.ts`, and `src/shared/domain.ts`.
- several renderer views mix presentation with feature workflow orchestration.

That means the codebase is functional and coherent, but many responsibilities are concentrated into a small number of large files.

## 2. Stack and runtime model

### Desktop/runtime

- Electron 44
- React 19
- TypeScript 5
- Vite via `electron-vite`

### Persistence and local processing

- SQLite via Node's built-in `node:sqlite` `DatabaseSync`
- local file storage under per-workspace `.research-studio`
- PDF rendering/extraction via `pdfjs-dist`
- OCR via `tesseract.js` with bundled English data
- DOCX import via `mammoth`
- citation import/export via Citation.js
- PowerPoint export via `pptxgenjs`

### Networked/provider dependency

- OpenAI Responses API for Teaching synthesis only

There is no general hosted agent runtime in the current shipping app.

## 3. Project structure

### Top-level files

- `package.json`: scripts, runtime dependencies, build dependencies
- `electron.vite.config.ts`: Electron/Vite configuration and renderer aliasing
- `electron-builder.yml`: packaging rules, unpacked OCR assets, platform packaging
- `README.md`: user-facing behavior and storage model

### `src/main`

Main-process code. Current responsibilities include:

- Electron app bootstrap
- IPC handler registration
- workspace open/close lifecycle
- validation before writes
- database access
- managed file operations
- import/export dialogs
- OCR execution
- teaching AI calls
- preservation/backup flows

Key files:

- `index.ts`: Electron startup and IPC registration
- `workspace-lifecycle.ts`: active workspace/database ownership, recent-workspace preferences, and open/close lifecycle
- `workspace-service.ts`: application orchestration façade for almost all features
- `database.ts`: SQLite schema access, record hydration, file-copy logic, derived search index logic
- `migrations.ts`: schema evolution
- `validation.ts`: `zod` validation for renderer-to-main inputs
- `interchange.ts`: CSL JSON/BibTeX import/export
- `preservation.ts`: backup, restore, integrity, qualitative export
- `ocr-service.ts`: local OCR worker boundary
- `manuscript-import.ts`: TXT/MD/DOCX/PDF manuscript import
- `revision-analysis.ts`: local deterministic revision analysis
- `discovery-service.ts`: discovery/search orchestration and validation routing
- `teaching-service.ts`: teaching-domain orchestration, dialog workflows, synthesis lifecycle, import/export
- `teaching-ai.ts`: hosted provider call to OpenAI
- `teaching-settings.ts`: encrypted AI key and model storage in Electron user data
- `future-services.ts`: unimplemented service contracts for future optional integrations

### `src/preload`

Context-isolated IPC bridge. This is the only API surface exposed to the renderer. It mirrors the feature surface exposed by the main process.

### `src/shared`

Shared serializable types and feature contracts.

Key files:

- `domain.ts`: domain models, IPC API interface, search/OCR/document types
- `teaching.ts`: teaching-specific models and local drafting helpers
- `document-preparation.ts`: shared document preparation workflow contract

### `src/renderer`

React UI.

Key files:

- `src/App.tsx`: top-level shell, workspace selection, navigation, source list, cross-view notices/errors
- `src/components/PdfReader.tsx`: in-app PDF reader, excerpt capture, page text persistence, manual OCR
- `src/components/DocumentPreparation.tsx`: full-document text/OCR preparation workflow
- `src/components/ProjectsView.tsx`: project workspace, goals, notes, attachments, manuscript entry point
- `src/components/ManuscriptEditor.tsx`: manuscript editing, traces, revision workflows
- `src/components/InterviewsView.tsx`: interview records, media, transcript segments, coding
- `src/components/AnalysisView.tsx`: coded passage analysis and memo authoring
- `src/components/DiscoveryView.tsx`: local cross-record search
- `src/components/PreservationView.tsx`: integrity, backup, restore, qualitative export
- `src/components/TeachingView.tsx`: lesson drafting, AI synthesis, export
- `src/components/SourceEditor.tsx`: source metadata editing

## 4. Startup path

Current startup path is:

1. Electron starts in `src/main/index.ts`.
2. `app.whenReady()` creates a single `WorkspaceService` instance.
3. `ipcMain.handle(...)` registers every feature endpoint directly against that service.
4. `createWindow()` creates the BrowserWindow with:
   - preload script from `src/preload/index.ts`
   - `contextIsolation: true`
   - `nodeIntegration: false`
5. In development, the renderer loads from `ELECTRON_RENDERER_URL`; otherwise it loads packaged `index.html`.
6. In preload, `window.api` and lifecycle hooks are exposed to the renderer.
7. `src/renderer/src/main.tsx` renders `App`.
8. `App.tsx` calls `window.api.workspace.recent()` on mount.
9. If a recent workspace exists, the main process opens it immediately and returns `WorkspaceInfo`.
10. Once a workspace is available, the renderer begins fetching feature data, starting with sources.

### Window close behavior

The main process intercepts window close and emits `app:before-close`. The preload bridge allows the renderer to register a `beforeCloseHandler`. This is currently used for view-level flush behavior such as teaching draft save/navigation handling.

## 5. Current architectural layers

### 5.1 UI / presentation

The renderer owns:

- screen layout
- local component state
- navigation between workspaces/views
- transient notices and error banners
- client-side workflow coordination inside a view

The renderer does **not** have direct Node, filesystem, or database access.

#### Current audit note

Presentation and orchestration are partly mixed. `App.tsx`, `TeachingView.tsx`, `ProjectsView.tsx`, `InterviewsView.tsx`, and `PdfReader.tsx` each contain substantial async workflow logic, not just rendering.

### 5.2 Application orchestration

The main orchestration boundary is `WorkspaceService`.

`WorkspaceService` now remains the renderer-facing façade, but feature responsibilities are starting to move into dedicated collaborators. `WorkspaceLifecycle` owns the active `WorkspaceDatabase`, recent-workspace preferences, and workspace open/close behavior. `TeachingService` and `DiscoveryService` both continue to use the currently active `WorkspaceDatabase` instance through the existing `WorkspaceService.requireDatabase()` bridge.

It currently handles:

- dialog interaction
- validation entry points
- feature-level command routing
- import/export coordination
- delegation to `WorkspaceLifecycle` for active-workspace and database lifecycle ownership
- delegation to `TeachingService` for teaching AI request lifecycle, lesson import/export, and lesson persistence commands
- delegation to `DiscoveryService` for search validation, index status, and index rebuild commands
- preservation command routing

This is the main application-service layer today.

#### Current audit note

`WorkspaceService` is effective as a façade, but it is also a concentration point. The new Teaching split reduces some pressure, but it still mixes:

- application workflow
- dialog policy
- provider dispatch
- export formatting
- error messaging

This is a clear modularization seam for future Mayday work.

### 5.3 Persistence / state

The canonical workspace state lives in SQLite plus managed files on disk.

There remains exactly one authoritative local SQLite writer in the desktop app at a time, owned through `WorkspaceLifecycle`. This stage does not introduce remote workers, distributed writes, or multi-machine database ownership.

`WorkspaceDatabase` owns:

- schema creation and migrations
- CRUD for sources, projects, manuscripts, interviews, memos, lessons, and review records
- managed-file import/copy/delete logic
- checksum computation and file-path resolution
- derived search index rebuild/query logic
- hydration of relational rows into shared domain objects

#### Current audit note

`WorkspaceDatabase` combines repository, file-store, indexing, and some domain behavior in one large class. It is the second major concentration point after `WorkspaceService`.

## 6. Data storage layout

For each user-selected workspace, the app creates:

`.research-studio/`

with:

- `workspace.sqlite3`
- `files/` for source PDFs
- `interview-media/` for audio/video
- `project-files/` for project-attached PDF/TXT/Markdown material

Separately, Electron user-data storage holds app-level preferences:

- recent workspace path in `preferences.json`
- teaching AI settings in `teaching-ai.json`

The encrypted teaching API key is intentionally stored outside the workspace backup boundary.

## 7. Major data flows

### 7.1 Workspace open

Renderer → preload → `workspace:choose` / `workspace:recent` → `WorkspaceService.open()` → `WorkspaceDatabase` constructor → migrations → `WorkspaceInfo` returned to renderer.

### 7.2 Source creation and editing

Renderer form state → `window.api.sources.save()` → Zod validation in `validation.ts` → `WorkspaceDatabase.saveSource()` → SQLite write → hydrated `Source` returned.

### 7.3 PDF attach and evidence capture

1. Main process opens native file picker.
2. Database layer copies the selected PDF into managed workspace storage and records checksum/provenance.
3. Renderer requests PDF bytes by stable file id.
4. `PdfReader.tsx` renders pages locally with PDF.js.
5. Extracted text is persisted back through IPC as `document_pages` records.
6. User text selection becomes an `EvidenceExcerpt` linked to source, file, page, and checksum.

### 7.4 Full document preparation

1. Renderer loads the managed PDF bytes.
2. `DocumentPreparation.tsx` uses the shared `prepareDocument()` workflow.
3. For each page, renderer extracts text locally or renders an image for OCR.
4. OCR image bytes are sent to main.
5. Main runs Tesseract and returns text/confidence.
6. Main persists per-page text into `document_pages`.
7. Search index is later refreshed from canonical records.

### 7.5 Project attachment import

Renderer action → main dialog → database import logic → file copied or deduplicated by checksum → join rows created between project and managed file → hydrated `ProjectDetail` / import summary returned.

### 7.6 Manuscript import and revision analysis

1. Main opens a file picker.
2. `extractManuscript()` converts TXT/MD/DOCX/PDF into title/sections and optional reviewer comments.
3. Database persists manuscript, sections, review docs, comments, and derived suggestions.
4. Renderer edits manuscript sections and displays traces and revision suggestions.

### 7.7 Interview analysis and memo creation

1. Transcript segments and codes are stored in normalized tables.
2. Analysis queries aggregate coded passages on demand.
3. User-selected passages are linked to synthesis memos via join rows.
4. Export writes a Markdown representation plus provenance labels.

### 7.8 Discovery search

1. Canonical records mark the FTS index dirty when source data changes.
2. Renderer calls `window.api.discovery.search()` / `.status()` / `.rebuild()`.
3. `WorkspaceService` delegates discovery commands to `DiscoveryService` without changing IPC contracts.
4. `DiscoveryService` validates input and calls `WorkspaceDatabase.search()` / `searchIndexStatus()` / `rebuildSearchIndex()`.
5. If needed, the database rebuilds the derived FTS5 index transactionally.
6. Results return a typed `SearchResult` with parent ids, page ids, and snippets.
7. `App.tsx` routes the user to the relevant view.

### 7.9 Teaching synthesis

1. `TeachingView.tsx` assembles lesson state and source text.
2. It may pull from library abstracts, notes, prepared PDF pages, and saved excerpts.
3. Renderer calls `window.api.teaching.synthesize()`.
4. `WorkspaceService` delegates to `TeachingService` without changing IPC contracts.
5. `TeachingService` loads encrypted credentials from `TeachingSettings`.
6. `teaching-ai.ts` calls the OpenAI Responses API.
7. Structured output is validated, normalized, and returned with provider/model provenance.
8. Lesson persistence remains local in SQLite through the active `WorkspaceDatabase`.

## 8. Model/provider integrations

### 8.1 Active provider integration

The only active hosted model/provider integration is Teaching synthesis:

- provider: OpenAI
- transport: HTTPS `POST` to `https://api.openai.com/v1/responses`
- implementation: `src/main/teaching-ai.ts`
- credentials: encrypted at rest via Electron `safeStorage`
- metadata retained: provider, model, generation time, source digest

#### Important boundary behavior

- provider calls occur only in the main process
- the renderer never stores raw API keys
- lesson drafts remain local unless the user explicitly invokes synthesis
- the networked result is validated before it is accepted into the lesson model

### 8.2 Hosted agent calls

There is no generalized hosted-agent execution path in the current application.

Related but inactive/provisional elements exist:

- `future-services.ts` defines optional future service contracts
- migration 1 created an `agent_observations` table, but no active runtime uses it

This means agent-related persistence exists as a provisional schema artifact, not as an implemented feature boundary.

### 8.3 Local model/tool execution

Current local intelligence is tool-based rather than provider-based:

- PDF.js for PDF rendering and embedded text extraction
- Tesseract.js for English OCR
- deterministic local rules in `revision-analysis.ts`
- local extractive lesson drafting in `src/shared/teaching.ts`

## 9. File handling

### 9.1 File access model

All authoritative file access is mediated by the main process.

Renderer file interactions are limited to:

- receiving PDF bytes by stable managed file id
- obtaining dropped-file local paths through `webUtils.getPathForFile()`
- sending OCR image bytes to main

The renderer is never given arbitrary filesystem privileges.

### 9.2 Managed file categories

- source PDFs: `source_files` + `.research-studio/files/`
- interview media: `interview_media` + `.research-studio/interview-media/`
- project files: `project_managed_files` and `project_file_links` + `.research-studio/project-files/`

### 9.3 File identity and provenance

Managed files retain:

- original filename
- relative managed path
- media type / extension
- byte size
- SHA-256 checksum
- import time

Evidence and prepared page text additionally retain the file checksum used when captured.

### 9.4 File safety

Current safety measures include:

- stable relative managed paths
- path resolution checks
- checksum verification
- import size limits by file type
- backup/restore path validation

## 10. Shared-data access

Shared data contracts currently live in `src/shared`.

These shared contracts serve two purposes:

- runtime shape agreement between renderer, preload, and main
- feature-level domain vocabulary for records and workflows

The current design is strong in intent, but the IPC contract is mirrored manually in three places:

- `src/shared/domain.ts`
- `src/preload/index.ts`
- `src/main/index.ts`

That duplication is one of the clearest maintainability issues in the codebase.

## 11. Configuration and environment variables

### 11.1 Application configuration

Current configuration is minimal and mostly code-based:

- Electron/Vite config in `electron.vite.config.ts`
- packaging config in `electron-builder.yml`
- build/test/lint scripts in `package.json`

### 11.2 Runtime environment variables

There are effectively no app feature environment variables today.

Observed runtime environment use:

- `ELECTRON_RENDERER_URL` in development only

The app does **not** currently depend on environment variables for provider credentials, workspace paths, or feature flags.

### 11.3 User-level secure configuration

Teaching AI settings are stored in Electron user data:

- model name in plain JSON config
- API key encrypted with Electron `safeStorage`

This is configuration, but not workspace-shared configuration.

## 12. Persistence/state boundaries

### 12.1 Canonical state

Canonical state is split between:

- SQLite records
- managed files on disk
- Electron user-data preferences/settings

### 12.2 Derived state

Derived or rebuildable state includes:

- FTS5 search index
- page-readability summaries reconstructed from `document_pages`
- local draft teaching content generated by `draftLesson()` until saved
- revision suggestions regenerated from reviewer comments and manuscript structure

### 12.3 Renderer state

Renderer state is mostly ephemeral view state:

- current selection
- current editor form contents
- pending notice/error messages
- in-progress document preparation state
- unsaved teaching lesson state

There is no separate client-side state library; state is local React state.

## 13. Provenance and citations

Provenance is a first-class concern throughout the app.

Current provenance-bearing areas include:

- imported citation libraries record import provenance notes
- managed source PDFs retain checksum and original name
- evidence excerpts retain source, file, page, and checksum
- prepared document pages retain extraction method, checksum, language, confidence, and timestamps
- manuscript traces retain source linkage and optional page/file checksum data
- synthesis memos retain linked transcript segment provenance
- teaching synthesis retains provider/model/source-digest provenance

Citation interoperability is isolated in `interchange.ts` through Citation.js.

## 14. Logging and error handling

There is no dedicated structured logging subsystem yet.

Current patterns are:

- thrown `Error` instances from main-process services
- renderer-side string cleanup for IPC error prefixes
- local UI banners/notices for failures
- limited direct `console.error` usage in preload exposure failure

### Current audit note

Error handling is consistent enough to function, but it is decentralized:

- repeated `messageFrom()` helpers appear across renderer components
- user-facing error text is embedded in many service methods
- there is no shared telemetry or structured log/event sink

This is a good modularization target because it cuts across every feature.

## 15. External services and system integrations

### Active external/network service

- OpenAI Responses API for Teaching synthesis

### Local/native integrations

- native open/save dialogs through Electron
- OS default app opening via `shell.openPath`
- reveal-in-folder via `shell.showItemInFolder`
- encrypted storage via `safeStorage`
- SQLite via Node runtime
- filesystem copy/read/write under main process

### Packaged assets

`electron-builder.yml` explicitly unpacks OCR-related assets and `resources/**` so OCR can run locally in packaged builds.

## 16. Likely integration points for background work

These are current feature seams that could support background execution later without changing product behavior.

### Good candidates

1. **Document preparation**
   - currently orchestrated in renderer session state
   - already page-based and independently commit-safe
   - natural fit for durable job orchestration if needed later

2. **OCR batches**
   - already isolated behind `ocr-service.ts`
   - page-level units and bounded byte payloads exist

3. **Search index rebuild**
   - already derived and transactional
   - natural candidate for deferred/background maintenance

4. **Integrity check and backup**
   - already service-based and file-inventory-driven
   - long-running on large workspaces

5. **Large imports**
   - citation library import
   - project file import
   - manuscript import
   - transcript import

6. **Teaching synthesis**
   - already cancellation-aware and isolated behind a single main-process boundary
   - could move to a formal job abstraction without changing the renderer contract much

### Constraints from the current design

- some workflows are renderer-session-bound today, especially document preparation
- `DatabaseSync` is synchronous in the main process, so long operations can still block the Electron main thread
- `WorkspaceService` is a single façade, so background job ownership is not yet separated by feature

## 17. Current coupling and modularization hot spots

These are the main places where responsibilities are tightly coupled, duplicated, provisional, or hard to maintain.

### 17.1 `WorkspaceService` as a god object

Symptoms:

- nearly every feature endpoint routes through one class
- dialog handling, validation, orchestration, export formatting, and provider calls are all mixed

Safe future split directions:

- workspace lifecycle
- sources/reader
- projects/manuscripts/revisions
- interviews/analysis
- preservation/discovery
- teaching/provider integration

### 17.2 `WorkspaceDatabase` as a combined repository + file store + indexer

Symptoms:

- persistence logic for many domains in one file
- file-copy/checksum/path behavior and SQL hydration are mixed
- search index logic is embedded in the same class as CRUD

Safe future split directions:

- repositories by bounded feature area
- managed file store helpers
- search/index service
- lesson/revision/manuscript-specific repositories

### 17.3 IPC contract duplication

Symptoms:

- the same feature surface is hand-maintained in main, preload, and shared interfaces

Risk:

- signature drift
- feature additions requiring changes in multiple layers

### 17.4 Renderer views with workflow logic

Symptoms:

- async orchestration sits inside components
- save/load/refresh patterns repeat across views
- repeated `messageFrom()` cleanup helpers

Risk:

- harder testability
- harder reuse of feature workflows across views

### 17.5 Provisional/future artifacts already present

Observed provisional areas:

- `future-services.ts` contracts
- `agent_observations` table from migration 1
- `ORIGINS` includes `ai` more broadly than current active features use

These are not wrong, but they are important to flag so future work does not accidentally treat them as complete runtime boundaries.

## 18. Baseline architectural conclusion

The current application has a solid local-first foundation and clear security-sensitive separation between renderer and main process. The authoritative baseline is worth preserving.

The next stabilization/modularization work should focus on extracting smaller feature boundaries from existing large hubs, not on changing frameworks or rewriting the product model.

Most likely safe seam lines are:

- split orchestration out of `WorkspaceService`
- split persistence/file/indexing concerns out of `WorkspaceDatabase`
- centralize IPC contract definitions
- centralize error/message handling
- move renderer workflow code toward feature controllers/hooks without changing UI behavior
