# Architecture

## Stack decision

Phase 1 uses Electron 44, React 19, TypeScript, and Node's built-in SQLite module. Tauri 2 was preferred, but this machine did not have a Rust toolchain. Electron is the mature Windows-capable fallback and keeps the application buildable with the available Node toolchain. Using the runtime's SQLite implementation also avoids a native add-on toolchain and ABI coupling.

## Boundaries

- `src/shared` contains serializable domain and IPC contracts.
- `src/main` owns workspace access, validation, migrations, SQLite, managed files, and operating-system dialogs. Renderer input is validated with Zod before reaching persistence.
- `src/preload` is the narrow context-isolated bridge. The renderer has no Node or filesystem access.
- `src/renderer` contains React UI and view state only.

SQLite runs in WAL mode with foreign keys enabled. Stable UUIDs identify records; ISO 8601 timestamps and an explicit `origin` distinguish user-authored, imported, and future AI-generated material. PDF names are generated, paths are relative to the workspace store, and resolved paths are checked before opening or deletion.

## Schema direction

Migration 1 supports sources, people/authors, tags, and source files and reserves normalized tables for later research workflows. Migration 2 activates evidence excerpts and qualitative codes: each excerpt links to its source and managed PDF, stores a page locator and user note, and preserves capture method, timestamp, original filename, and file checksum as provenance.

Migration 3 activates projects as an organizational layer over existing records. `project_sources` provides non-owning membership, so deleting a project never deletes library sources or evidence. Project goals and notes are owned by the project; evidence dashboards resolve excerpts through assigned source IDs rather than copying evidence. Portable project JSON includes a version marker and export timestamp for future import migrations.

Migration 4 activates project manuscripts, ordered sections, and explicit trace records. Manuscript prose remains user-authored Markdown; trace rows link inserted citations or claims to stable source IDs and, when applicable, evidence excerpt IDs. The renderer provides separate editing and safe formatted-preview modes without enabling imported raw HTML. Hydrated traces resolve the source title, PDF page, filename, and checksum for inspection and export. Autosave uses idempotent section upserts through validated IPC, and navigation or application shutdown awaits the same dirty-draft flush before unmounting the editor. Markdown and DOCX generation runs in the main process and writes only through native save dialogs.

Migration 5 activates interviews, managed media, and structured transcript segments. Interview records retain project assignment, participant pseudonym, date, consent/handling notes, and workflow status. Media is copied beneath `interview-media`, identified by generated paths, and checksum-stamped. Plain-text transcript imports are split into ordered speaker passages; timestamps and many-to-many qualitative codes remain independently editable. Deleting an interview removes its transcript and managed media, while deleting a project preserves interviews and clears their project assignment.

Migration 6 activates cross-interview qualitative synthesis. Read models aggregate coded transcript passages at query time, preserving interview, participant, speaker, timestamp, project, and code context without duplicating transcript text. User-authored synthesis memos store interpretation separately and link to stable segment IDs through ordered join rows. Foreign-key actions remove stale passage links when source segments disappear and preserve memos as workspace-level records when a project is deleted.

Migration 7 activates local document intelligence. `document_pages` stores page text with its managed source-file ID, page number, extraction method (`pdf-text` or `ocr`), language/confidence where applicable, retained file checksum, and timestamps. `search_index` is an FTS5 virtual table over derived search documents for sources, PDF pages, excerpts, transcript segments, synthesis memos, and manuscript sections. Lightweight triggers mark the index dirty; rebuilding replaces its contents transactionally from canonical normalized tables.

Migration 8 adds checksum-addressed project source material. `project_managed_files` stores one durable managed copy and provenance metadata; `project_file_links` links that copy to one or more stable project IDs. Imports accept PDF, TXT, and Markdown only, copy into `project-files/<project-id>/`, and reuse an existing managed copy when its SHA-256 matches. Unlinking removes only a join row. Deleting a managed copy is an explicit separate action that removes all links but never touches the recorded original path.

Migration 9 activates the traceable revision assistant. `review_documents` stores imported TXT/Markdown reviewer content with filename, checksum, and import timestamp. Parsed `reviewer_comments` retain source order, classification, and an optional section match. `revision_suggestions` separates reviewer-derived guidance from manuscript-rule diagnostics, records the deterministic fingerprint and generator, and persists the author’s addressed/deferred/dismissed decision. Section deletion nulls a stale match rather than deleting the reviewer record; manuscript deletion cascades its revision workspace.

`revision-analysis.ts` is a pure, offline analysis boundary. It uses explicit keyword classification, conservative token overlap for section matching, visible language signals for bounded interpretations, and documented structural checks. It distinguishes direct requests, questions, and advisory language, then proposes a category-specific implementation approach without claiming certainty about reviewer intent. Re-analysis refreshes reviewer interpretations and section matches against the latest saved manuscript while preserving author decisions. It does not generate replacement prose or make network calls. This service can later sit beside an optional evidence-grounded model implementation without changing the persistence contract or making model output authoritative.

`manuscript-import.ts` converts local TXT, Markdown, DOCX, and PDF files into the existing manuscript/section contract. Before Mammoth conversion, DOCX XML separates actual Word comments and directly colored text runs as reviewer annotations; those annotations are removed from body prose and imported through the normal revision-document boundary. This is an explicit heuristic because color may also represent author styling, so the UI reports the separated count and keeps every note inspectable. Safe HTML then becomes GFM Markdown so primary headings become sections while subordinate headings, emphasis, lists, links, quotations, and tables remain editable. PDF.js extracts embedded text page by page and preserves exposed visual line and paragraph breaks; it cannot reconstruct arbitrary typography, comments, or complex layouts. Image-only PDFs fail explicitly rather than returning an empty manuscript. The main process validates extension, archive expansion, and extracted size before conversion, and no source document bytes cross a network boundary.

`future-services.ts` defines small optional boundaries for transcription and generative observations. There are no implementations or network dependencies in this phase. A future transcription service must return attributable segments through the existing domain boundary rather than write directly to SQLite. Any later generated observation must be evidence-linked and persist its provider/model provenance.

It also defines a provider-neutral `LearningGuideProvider` contract for the planned context-aware Microsoft ecosystem learning layer. Learning guides combine ready-to-use prompts with rationales, checkpoints, concepts, practice tasks, official sources, and content freshness metadata. This boundary has no implementation, credentials, SDKs, or cloud calls in the current application. See [product direction](product-direction.md).

## Interoperability

Data is normalized rather than embedded in UI state, and managed files retain original names, media type, size, checksum, and import time. The main-process interchange boundary maps sources to and from CSL JSON and BibTeX through Citation.js. Imports are local-file-only, size-limited, validated before writes, provenance-stamped, and deduplicated by normalized DOI or title/year. A later archival export can add CSV and file manifests without changing the renderer or core records.

Synthesis memo export is generated in the main process through a native save dialog. The Markdown contains only user-selected memo text and linked transcript evidence, with readable interview, participant, speaker, timestamp, and code provenance. No analysis data leaves the local machine.

PDF bytes cross the context-isolated IPC boundary only after the main process validates a stable file ID and resolves its managed path beneath the workspace. PDF.js renders and extracts text in the renderer without network access. Evidence writes return through validated IPC; the renderer never receives an arbitrary filesystem path.

## Preservation boundary

`preservation.ts` owns package creation, verification, restore, integrity reporting, and tabular qualitative serialization. The live SQLite connection creates consistent snapshots with `VACUUM INTO`; the implementation never copies WAL database files directly. A versioned manifest records workspace identity, schema version, export time, relative file paths, byte sizes, and SHA-256 checksums.

Package paths are restricted to the database snapshot, `files/`, `interview-media/`, and `project-files/`. Absolute paths, drive-qualified paths, traversal outside the package, duplicate entries, unsupported schema versions, missing files, size mismatches, and checksum mismatches are rejected before restoration. Backup also compares each live managed file against the checksum retained in SQLite rather than blessing externally modified bytes. Stored separators are normalized during guarded resolution so packages remain portable across supported operating systems. Restore requires an empty destination and verifies the resulting database and managed files before the application switches workspaces. SQLite handles are closed before failed restores remove only the newly created `.research-studio` directory.

Qualitative JSON uses an explicit format/version envelope. CSV is a long-form exchange table with separate interview, transcript-segment, qualitative-code, and synthesis-memo rows. Neither format contains managed media bytes; complete preservation uses the workspace package.

## Local extraction and OCR

Full-source preparation uses the same boundary: `DocumentPreparation.tsx` orchestrates an explicitly requested sequential pass through `shared/document-preparation.ts`, with PDF.js adapters in `renderer/src/pdf-preparation.ts`. Each page is independently upserted through the validated preload API into the existing `document_pages` table. No schema migration or replacement of canonical research records is required. A lightweight page-summary read reconstructs coverage after reopening; progress and errors are session state. Cancel/reader unmount aborts subsequent work, discards late extraction/OCR results before persistence, and retains completed writes. An in-flight OCR worker finishes its current recognition before cancellation settles; rendering itself can be cancelled.

Retries skip already readable pages, preserve existing OCR text, and use the unique `(source_file_id, page_number)` key. Empty results are retained to identify pages that may need OCR or may simply be blank. Page failures do not prevent preparation of later pages. An explicit second pass renders only OCR candidates to temporary, size-bounded canvases and uses the existing bundled English OCR capability. Managed PDF bytes are checked against the recorded SHA-256 before loading. Saved page writes already mark FTS5 dirty, so the next search refreshes all prepared text without a separate indexing path. Coverage is non-empty-text coverage, not a claim that every word or page image has been understood.

PDF.js remains responsible for rendering and embedded-text extraction in the context-isolated renderer. Extracted text crosses the narrow preload API with a stable source-file ID and page number; the main process validates and persists it. Image-only pages are not OCR'd silently. The user explicitly starts OCR for the visible page, which is serialized as PNG bytes and sent only to the main process.

Tesseract.js runs in a Node worker with bundled English trained data and WASM assets unpacked by electron-builder. No runtime download, remote endpoint, or model account is required. OCR output is treated as derived imported text—not scholarly evidence by itself—and confidence/method provenance remains visible. Users still choose exact excerpts before adding evidence.
