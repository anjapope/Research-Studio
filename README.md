# Research Studio

Research Studio is a private, local-first desktop environment for durable scholarly work. It provides local workspaces, structured source records, evidence capture, research projects, manuscripts, and qualitative interview analysis.

Attached PDFs open in an in-app evidence reader. Each page is rendered locally and its extracted text can be selected to create an evidence excerpt with a page locator, research note, reusable qualitative codes, original filename, and retained SHA-256 checksum.

## Run locally

Requirements: Windows 10/11, Node.js 20 or newer, and npm.

```powershell
npm install
npm run dev
```

Useful checks:

```powershell
npm test
npm run typecheck
npm run lint
npm run build:unpack
```

## Local data

Choosing a workspace creates a `.research-studio` folder inside it:

- `workspace.sqlite3` stores records and migration history.
- `files\` stores managed copies of attached PDFs under stable generated names.
- `interview-media\` stores managed copies of attached audio and video under stable generated names.
- `project-files\<project-id>\` stores managed copies of project PDF, TXT, and Markdown material.

Core research features work without an account or network service. Optional Teaching & Instruction AI synthesis sends the selected lesson's source text and class context to OpenAI only when you click **Send readings & synthesize with AI**. Back up the complete `.research-studio` directory together. Electron's local user-data directory stores the recent workspace path and optional AI model settings and encrypted API key; the key is excluded from workspace backups. See [Teaching & Instruction](docs/teaching.md) for setup and PowerPoint export.

## Citation exchange

Use **Import** in the Sources header to add a CSL JSON (`.json`) or BibTeX (`.bib`, `.bibtex`) library. Imports retain standard bibliographic metadata, mark records as imported, record the original file and timestamp, and skip duplicates by normalized DOI or title/year. Export produces standard CSL JSON or BibTeX without changing local records.

## Evidence reader

Attach a PDF to a source, then select its file card to open the reader. Navigate to a page and drag across the extracted text beneath the rendered page. Add an optional research note and comma-separated qualitative codes, then save the excerpt. Saved evidence remains linked to its source, exact PDF, page, and checksum.

PDF rendering and text extraction happen locally through PDF.js. The reader accepts managed PDFs up to 100 MB. Image-only/scanned pages can be processed with explicit local English OCR.

### Prepare a full source for analysis

Open an attached source PDF and choose **Prepare for analysis** above the page preview. The app checks every page, saves embedded text with its file identity, page number, checksum, and extraction method, and reports readable-page coverage, unchecked pages, and page-specific failures. Text becomes available through **Discover**, including pages you have never viewed.

Pages without text are listed under **Inspect pages needing attention**. Choose **Run local English OCR** to process these pages on-device with the bundled OCR engine. Blank pages can remain without text; coverage measures non-empty text, not OCR accuracy or completeness. Inspect important passages before using them as evidence.

**Cancel** stops further page work after the current operation settles. Closing the reader also cancels the pass. Successfully saved pages survive cancellation, app closure, and workspace reopening. **Retry / check all pages** reuses readable pages and retries the rest without creating duplicate page records or replacing saved OCR with embedded text. Progress and failure messages describe the current reader session; saved page coverage is reconstructed on reopening. Preparation does not continue in the background after the reader closes.

The original PDF and evidence excerpts are unchanged. If a managed PDF no longer matches its recorded checksum, the reader refuses to attribute new text to it; restore the original copy or attach the changed PDF as a new file. This phase prepares attached source PDFs only; it does not add semantic search, project-attachment indexing, or cloud processing.

## Research projects

Projects organize library sources and their evidence around a research question. Each project dashboard includes:

- source assignment without duplicating library records;
- evidence gathered automatically from assigned sources and filterable by qualitative code;
- concrete goals with completion state and optional target dates;
- timestamped project notes; and
- managed PDF, plain-text, and Markdown attachments imported with the native multi-file picker or drag and drop; and
- portable JSON export containing project metadata, attachment manifests, goals, notes, evidence provenance, and complete assigned source records.

Project attachments retain original filename and path, managed relative path, media type, extension, byte size, SHA-256 checksum, and import time. Files are copied into workspace storage with collision-safe generated names; originals are never moved or deleted. Importing the same bytes again links the existing managed copy instead of copying it. **Unlink** removes only the project relationship, while **Delete managed copy** removes the workspace copy from every linked project after confirmation. Files can also be opened in their default application or revealed in Explorer.

Deleting a project never deletes its underlying library sources, source PDFs, or evidence.

## Manuscripts

Open a project and choose **Write** to create manuscripts with ordered sections. Draft content autosaves locally after a short pause. The research drawer can insert:

- source citations, which create a durable trace to the library record; and
- evidence quotations, which create a trace to the exact excerpt, PDF, page, and checksum.

The trace map remains separate from prose so citations can be inspected without embedding hidden data in the document. Manuscripts export as Markdown or Microsoft Word (`.docx`), including trace notes.

## Revision assistant

Create a manuscript or use **Import draft** to bring in a local PDF (`.pdf`), Word (`.docx`), plain-text (`.txt`), or Markdown (`.md`) manuscript. The native picker names every supported extension explicitly. Word titles and primary headings become the manuscript and editable sections; subordinate headings, emphasis, lists, links, quotations, and tables are retained as Markdown. Actual Word comments and directly colored annotation text are separated from the manuscript body and shown as visually distinct reviewer material under **Review**. Because color can also be legitimate document styling, confirm the separated notes after import. Use **Write** to edit Markdown and **Preview** to inspect its formatted rendering. Selectable PDF text is imported page by page with visual line and paragraph breaks retained where the PDF exposes them; PDF typography, comments, and complex multi-column layout cannot be reconstructed exactly. Scanned PDFs without embedded text must be OCR’d first. PDF imports support up to 50 MB, Word imports up to 25 MB, and text formats up to 10 MB; extracted text is capped at 5 million characters and long sections are divided into editable parts. Then select **Review** in the research drawer. The revision assistant can:

- import reviewer comments from local plain-text (`.txt`) or Markdown (`.md`) files up to 5 MB;
- parse blank-line-separated comments or numbered/bulleted comment lists;
- classify concerns as argument, evidence, methods, structure, clarity, or style;
- interpret whether each note signals a reader uncertainty, direct revision request, or advisory suggestion and explain the likely underlying concern;
- match a reviewer concern to the most likely manuscript section when the local text evidence is strong enough;
- inspect the saved manuscript for underdeveloped sections, unusually long paragraphs, and developed sections without a detected citation or evidence trace; and
- record each suggestion as open, addressed, deferred, or dismissed.

Analysis uses transparent local rules and does not call a model or network service. **Analyze draft** re-evaluates imported reviewer comments against the latest saved manuscript, explains a bounded interpretation, and proposes an implementation approach, but never rewrites manuscript prose automatically. Imported comment text, its SHA-256 checksum, classifications, section links, and author decisions are persisted in SQLite. Re-importing the same comment content into one manuscript is detected as a duplicate. Project JSON export includes manuscripts and their revision records.

## Interviews and qualitative coding

Interviews retain a participant name or pseudonym, optional project assignment and date, workflow status, and an explicit consent/handling note. Audio and video attachments are copied into the local workspace with their original filename, size, media type, import time, and SHA-256 checksum; opening media uses the operating system's local player.

Import a plain-text or Markdown transcript (up to 10 MB), or build one passage at a time. Re-imports append new blank-line-separated `Speaker: text` blocks instead of replacing coded passages or memo links. Each segment supports optional start/end seconds and comma-separated reusable qualitative codes. No transcription engine, cloud account, or upload is involved.

## Cross-interview analysis

The **Analysis** workspace compares coded transcript passages across the complete workspace or within one project. Search passages and participant context, filter by qualitative code, and inspect both passage frequency and interview coverage. Select any set of passages to create a user-authored synthesis memo with a durable evidence map back to each interview, speaker, timestamp, and code.

Synthesis memos remain editable, can move from working to developed status, and export as portable Markdown with quoted transcript evidence and provenance labels. Removing a transcript passage only removes its memo link; it does not silently copy or orphan transcript text.

## Preservation and recovery

The **Preservation** workspace provides four local-only operations:

- **Integrity check** runs SQLite's structural check and recomputes SHA-256 checksums for every managed source, project, audio, and video file. Missing and modified files are reported by name and managed path.
- **Verified backup** first confirms registered file sizes and checksums, then creates a timestamped `.research-studio-backup` folder containing a consistent SQLite snapshot, all managed files, and a versioned JSON manifest. Modified or missing managed files must be resolved before backup.
- **Restore** validates the complete package before copying it into an empty destination, opens the restored database, applies supported migrations, and verifies the result. Existing workspaces are never overwritten.
- **Qualitative export** writes versioned JSON or a flattened CSV containing interviews, transcript segments, the qualitative codebook, and synthesis memos.

Backup packages are directories rather than opaque archives so they remain inspectable and can be copied with ordinary filesystem tools. Preserve the complete package folder; editing package contents causes restore verification to fail.

## Local document intelligence

Use **Discover** or press `Ctrl+K` to search locally across source metadata, indexed PDF pages, evidence excerpts, transcript passages, synthesis memos, and manuscript sections. Results preserve their record type and context; PDF results reopen the exact managed file and page, while transcript results open the relevant interview.

PDF.js automatically stores embedded page text as pages are read. When a page has no selectable text, the reader offers explicit **local English OCR** powered by bundled Tesseract language data. The rendered page image is processed on-device and never uploaded. OCR results retain the source file checksum, page number, method, language, confidence, and extraction timestamps.

The SQLite FTS5 index is derived and rebuildable rather than authoritative. Record changes mark it dirty; the next search refreshes it transactionally, or **Rebuild index** can be used manually. The index can always be reconstructed from canonical workspace records and stored page text.

See [docs/architecture.md](docs/architecture.md) for boundaries and schema direction.
Longer-term product requirements, including the embedded Microsoft ecosystem learning layer, are recorded in [docs/product-direction.md](docs/product-direction.md).
