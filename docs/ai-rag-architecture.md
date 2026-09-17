# Evidence-grounded source conversation and reading guides

## Purpose and non-goals

This document designs the next research-assistant phase: a conversation and reading-guide workspace for one selected, prepared source PDF. It builds on the local-first source library, evidence capture, full-source preparation, and page-level search already in Research Studio.

The feature must answer from an explicit, inspectable packet of source evidence. It must never treat an answer as a source, silently turn an assistant interpretation into a user conclusion, or hide the pages that support a claim.

This design does not add a model provider, embeddings implementation, credentials, HTTP client, network call, background sync, or production UI. It specifies the durable boundaries required before those pieces are introduced.

## User experience

### Sources are full research documents

The **Sources** tab is the primary intake and analysis surface for full research documents, not a citation-only catalogue. Bibliographic records remain useful metadata, but they must not be required before a PDF can be preserved, prepared, searched, discussed, or analysed.

The PDF-first intake flow creates a managed `source_files` record with the original name, byte size, SHA-256 checksum, and import time. The researcher may complete citation metadata immediately or save the PDF as an uncatalogued source with a visible **Metadata to review** state. The existing citation-import flow remains useful and should show which citations have no PDF, an attached PDF awaiting preparation, partially prepared text, or analysis-ready text.

The source detail should show one of these document states before any assistant action:

| State | Meaning | Available action |
|---|---|---|
| No document | Citation metadata only; no source text is available. | Attach/import PDF. |
| Attached | Managed PDF exists but text has not been prepared. | Prepare for analysis. |
| Partially prepared | Some saved pages are readable; gaps, failed pages, or OCR candidates remain. | Discuss prepared pages with a partial-evidence label; resume preparation or run local OCR. |
| Prepared | Every page has non-empty saved text, subject to OCR confidence and source quality limits. | Discuss source, request a reading guide, search within source, and capture evidence. |
| Modified/unavailable | Managed bytes no longer match the retained checksum, or the file is unavailable. | Restore the original or attach a new version; disable analysis against the changed file. |

**Analyze document** always selects a specific attached file. It offers bounded, page-cited work: ask a question, create a reading guide, map stated arguments, identify described methods or results, and surface stated limitations. It does not grant autonomous access to other workspace material or authority to make claims about unread pages.

### Start from a source

The source detail and PDF reader should expose **Discuss source** once a source has at least one attached PDF. Opening it selects exactly one `source_files` record, not merely a bibliographic source. This matters because a source can have multiple attached versions with different checksums and page layouts.

The analysis view remains anchored to that full document even if citation metadata is incomplete. Early document analyses are structured reading aids: an argument, methods, results, or limitations map can contain only a page-cited source-supported claim, a separately labelled interpretation with evidence links, or an insufficient-evidence notice.

The workspace begins with a preparation card:

- selected source title, authors, year, attached filename, and SHA-256 checksum;
- page coverage: readable pages / total pages, embedded-text pages, OCR pages, empty or failed pages, and the last preparation time;
- clear actions to resume preparation or run explicit local OCR for identified pages; and
- an explanation that a response can only cover saved readable pages, not the whole visual document.

The user can then choose one of two paths:

1. Ask a focused question, such as “What does the author mean by situated knowledge?” or “What limitations does this study report?”
2. Request a reading guide. A guide asks for a purpose and depth: orient, assess methods, trace an argument, compare to a project question, or critique. It may optionally receive a selected project so it can use that project’s research question and project-specific preferences.

Before generation, the UI presents an **Evidence preview**. It lists every page passage and saved evidence excerpt proposed for use, with page number, extraction method, OCR confidence when applicable, and a link that opens the exact page in the PDF reader. The user can remove a candidate, pin a candidate, or cancel. The model request, when a provider exists, uses the final preview rather than unrestricted access to a workspace.

The response view has three visibly separate regions:

- **Source-supported response**: concise answer or reading-guide sections, with page citations after each supported claim.
- **Interpretive observations**: optional assistant inferences, labelled as interpretation and tied to the evidence links that led to them.
- **Gaps and cautions**: unprepared pages, failed OCR, contradictory passages, weak retrieval, or an insufficient-evidence result.

Each cited page opens the reader at that page. A user can save a response as a reading guide, mark a response useful or not useful, add a correction, or write a personal conclusion. Saving a personal conclusion always creates a separate user-authored record; it never edits the assistant response.

## Canonical evidence packet

The main process constructs a `SourceConversationEvidencePacket` from canonical SQLite records. The renderer can display this packet but cannot provide arbitrary paths, document bytes, or additional source text.

```ts
interface SourceConversationEvidencePacket {
  packetVersion: 1
  workspaceId: string
  source: {
    id: string
    title: string
    sourceType: SourceType
    authors: Array<{ id: string; displayName: string }>
    year: number | null
    publicationTitle: string | null
    publisher: string | null
    doi: string | null
    url: string | null
    abstract: string | null
    tags: string[]
  }
  file: {
    id: string
    originalName: string
    sha256: string
    byteSize: number
    importedAt: string
  }
  preparation: {
    totalPages: number | null
    readablePages: number
    embeddedTextPages: number
    ocrPages: number
    emptyOrUnpreparedPages: number[]
    failedPages: Array<{ page: number; reason: string }>
    coverageRatio: number | null
    coverageDefinition: 'non-empty-saved-text'
  }
  pagePassages: Array<{
    evidenceId: string // stable document_pages.id
    sourceFileId: string
    page: number
    text: string
    extractionMethod: 'pdf-text' | 'ocr'
    language: string | null
    confidence: number | null
    fileSha256: string
    extractedAt: string
    updatedAt: string
    retrieval: { rank: number; lexicalScore: number | null; reason: string }
  }>
  savedExcerpts: Array<{
    evidenceId: string // stable evidence_excerpts.id
    sourceId: string
    sourceFileId: string
    page: number
    text: string
    note: string | null
    codes: Array<{ id: string; name: string }>
    origin: Origin
    createdAt: string
    fileName: string
    fileSha256: string
    retrieval: { rank: number; lexicalScore: number | null; reason: string }
  }>
  limitations: string[]
}
```

`pagePassages` are the saved text from `document_pages`, not regenerated text. Their `(source_file_id, page_number, file_sha256)` tuple is the primary page citation. `savedExcerpts` are authored evidence selections and include their note and qualitative codes only when the user includes them in the preview. The packet intentionally excludes the full PDF bytes, unselected source files, workspace-wide search results, hidden prompt material, and original source filesystem paths.

For a reading guide, the packet may include the selected project’s `id`, title, research question, and explicitly opted-in project preferences. It does not include project notes, manuscripts, interviews, or other sources unless a later multi-source workflow is designed separately.

## Retrieval and citation rules

### Initial local retrieval

The first useful implementation uses SQLite FTS5 and deterministic ranking only. It limits candidates to the selected `source_file_id` and unions two types of evidence:

1. matching `document_pages` rows, ranked by FTS BM25, with full saved page text or a bounded contextual passage;
2. matching `evidence_excerpts`, ranked ahead of generic page text when their excerpt text, note, or qualitative code matches the request.

The retrieval service also adds user-pinned evidence, exact page references in the question (“page 12”), and a small set of neighbouring pages only when needed for context. It deduplicates page/excerpt overlap while retaining both stable evidence IDs. A deterministic token budget caps the packet; the UI reports which candidates were omitted and why.

The generator receives a citation grammar, for example `[file:<sourceFileId>; p.<page>; sha256:<prefix>]`, and may cite only evidence IDs included in the packet. The main process validates every emitted citation against the packet before displaying or saving the result. A sentence with no valid citation must be rendered as an interpretation or removed from the source-supported section. Citation labels shown to users should be readable, such as `Smith 2024, p. 12`, while the durable record keeps the stable ID and full checksum.

### Later embeddings without changing truth or citations

Add embeddings as a retrieval aid, not an evidence store or citation authority. A future `EmbeddingIndex` may create records per saved page and, later, per deterministic page chunk. Every vector record must retain:

- `document_page_id` and, if chunked, a stable chunk identifier and character offsets;
- `source_file_id`, page, and source-file SHA-256;
- embedding model/provider identifier, dimensions, created time, and content checksum; and
- the exact normalized text used to produce it.

Hybrid ranking combines local lexical score, embedding similarity, and explicit user pins. It must still resolve results to source page records before generation. A vector alone can never be cited. Re-embedding occurs when saved page text or its source checksum changes; stale vectors are excluded. The user should be able to rebuild or delete a local vector index independently from canonical source text.

## Evidence limits and uncertainty

Preparation coverage is a capability signal, not a quality guarantee. The response contract must include `coverage`, `limitations`, and `answerStatus`:

- **supported**: cited passages directly answer the question within prepared pages.
- **partial**: evidence supports part of the answer, but relevant pages are unprepared, OCR is missing, or context is too sparse.
- **contradictory**: selected passages materially disagree. Show each position with separate citations; do not resolve the conflict as fact.
- **insufficient-evidence**: no retrieved text directly supports an answer. State what was searched, list likely next pages or OCR candidates, and suggest a narrower question. Do not invent an answer from metadata, an abstract, or general knowledge.

OCR text is labelled as OCR-derived and carries its stored confidence. Low-confidence text is retrievable but should be down-ranked, visibly marked, and never presented as a verified quotation. Pages with no saved text, failed preparation, or failed OCR are listed in the evidence preview. If a request appears to concern an unprepared section, the assistant should recommend preparation/OCR before answering.

Contradiction detection starts as a transparent heuristic: identify passages whose lexical stance around the same named concept differs and ask the generator to compare rather than harmonize them. The response must say that the passages appear in tension and let the user inspect both pages. This is a cue for review, not an automated truth judgment.

## Provider-neutral future boundary

The existing `future-services.ts` is the right location for contracts. It should evolve into interfaces similar to the following only when the first offline packet and records are implemented. These are designs, not code to add in this phase.

```ts
interface SourceConversationRequest {
  requestId: string
  mode: 'question' | 'reading-guide'
  question: string
  evidence: SourceConversationEvidencePacket
  preferences: ResolvedResearchPreferences
}

interface GroundedClaim {
  text: string
  evidenceIds: string[]
  kind: 'source-supported' | 'interpretation' | 'limitation'
}

interface SourceConversationResult {
  answerStatus: 'supported' | 'partial' | 'contradictory' | 'insufficient-evidence'
  title: string
  claims: GroundedClaim[]
  guide?: ReadingGuideDraft
  provider: { kind: 'local-rules' | 'azure-hosted'; model: string; version: string | null }
}

interface GroundedConversationProvider {
  describe(): { id: string; kind: 'local-rules' | 'azure-hosted'; dataHandling: string }
  respond(request: SourceConversationRequest): Promise<SourceConversationResult>
}

interface EmbeddingProvider {
  describe(): { id: string; kind: 'local' | 'azure-hosted'; dimensions: number }
  embed(input: Array<{ id: string; text: string; contentSha256: string }>): Promise<Array<{ id: string; vector: number[] }>>
}
```

The interfaces accept a bounded evidence packet rather than a database handle, path, or broad workspace query. Azure-hosted implementations belong in a separate optional adapter; no Azure SDK, model name, endpoint, API key, credential lookup, or network dependency belongs in the local core. A local deterministic provider may initially create only an insufficient-evidence explanation, preparation checklist, or reading-guide skeleton; it must not imply semantic understanding it does not have.

## Research preferences

Research preferences are user-authored instructions for how the assistant should frame, organize, and evaluate its response. They guide presentation; they cannot override the evidence packet, add unsupported claims, or erase uncertainty.

The UI should provide a **Research preferences** screen with:

- a global instruction field for durable preferences, such as preferred methodological lenses, desired response structure, terminology, or citation style;
- project-specific instructions that layer on top of global preferences for one project;
- editable examples of insights the user values, each with an optional explanation of why it helped;
- a resolved preview showing exactly which global, project, and example records would be included in a request;
- per-record creation/update timestamps, scope, and enable/disable state; and
- explicit edit and delete controls. Delete removes the preference record and any association, but does not alter prior conversation packets or saved responses; those retain a snapshot/reference for auditability.

The model packet should receive only enabled, resolved preferences. Preferences must be identified as user guidance, never evidence. The response should not cite them as source support.

## Durable records and provenance

A future migration should add normalized records rather than serializing an assistant session into one opaque blob. Proposed tables and relations:

| Record | Purpose and important fields |
|---|---|
| `research_preferences` | `id`, `scope` (`global`/`project`), nullable `project_id`, `kind` (`instruction`/`valued-example`), user-authored body, enabled, timestamps, soft or explicit deletion audit fields. |
| `source_conversations` | One source-file-scoped thread: `id`, `source_id`, `source_file_id`, immutable `file_sha256`, optional project, title, status, timestamps. |
| `conversation_turns` | Ordered user questions, assistant responses, and system preparation notices. Store role, body, origin, provider/model provenance, request/response content checksums, `answer_status`, and packet version. |
| `assistant_observations` | Structured claims produced in a turn: body, kind (`source-supported`, `interpretation`, `limitation`), confidence/uncertainty label, provider provenance, current/superseded state. |
| `reading_guides` | User-requested guide with source/file/checksum, purpose, depth, structured sections, origin, provider provenance, timestamps, and editable status. |
| `user_conclusions` | Explicitly user-authored notes or conclusions associated with a conversation, guide, source, or project. Never share a table or `origin` with assistant observations. |
| `assistant_feedback` | User rating, correction, follow-up, or dismissal for a turn/observation/guide; author is user; timestamps and optional reason. |
| `assistant_evidence_links` | Many-to-many links from a turn, observation, guide section, or conclusion to `document_pages` and/or `evidence_excerpts`, including order, relation (`supports`, `contradicts`, `context`, `user-selected`), page snapshot, source-file ID, and checksum snapshot. |
| `conversation_preference_snapshots` | Which resolved preferences were used for a request, including body checksum or immutable snapshot, so later edits do not rewrite history. |
| `embedding_records` | Optional local or remote retrieval cache, tied to page/chunk IDs and checksums as described above. |

Foreign keys should preserve canonical source text while avoiding false history. Deleting a source file must either block deletion while conversations/guides link to it, as manuscript traces already do, or require an explicit archival action that retains a non-authoritative citation snapshot and labels it unavailable. It must never silently rewrite an answer to point at another PDF version.

The display rules are strict:

- `document_pages` and `evidence_excerpts` are source evidence.
- `assistant_observations` and assistant turns are generated/inferred material, never source evidence.
- `user_conclusions`, feedback, and preferences are user-authored material, never assistant inference or source evidence.
- evidence links explain support or conflict; they do not certify that an observation is true.

Backup, restore, workspace JSON export, integrity checking, and search-index rebuild must be extended in the same migration phase so these records remain portable and recoverable. Source conversations should be searchable as assistant material only, with a filter that prevents their text from being mistaken for primary source text.

## Privacy and consent for the first cloud-enabled version

The first cloud-enabled release must be opt-in at two levels: provider setup and each request. Local retrieval, packet assembly, preview, preference resolution, and durable local storage run before any network decision.

Immediately before an Azure-hosted request, show a confirmation sheet with:

- provider name, endpoint region, model/embedding deployment identifier, and stated retention/data-processing setting;
- the exact source title and file checksum;
- the count and page list of text passages and saved excerpts leaving the device;
- the exact preferences and project context included;
- an explicit statement that PDF bytes, unselected pages, original filesystem paths, other sources, manuscripts, transcripts, and interview media are excluded; and
- actions to remove any candidate, continue once, allow the same bounded policy for the current session, or cancel.

No “always send all source content” option belongs in the initial release. Credentials are stored through an OS-backed secret mechanism, never SQLite, workspace exports, logs, prompts, or provider provenance records. Network errors must not fall back to a different provider or transmit a larger packet. The user can remove a provider configuration and delete local embedding caches; deleting remote provider-side data follows the provider’s documented process and must be described honestly rather than implied by local deletion.

## Phased implementation plan

### Phase A: source-first local evidence workspace (smallest useful implementation)

1. Extend Sources so a PDF can be imported before complete citation metadata exists, with explicit document readiness states and managed-file provenance.
2. Add a read-only source conversation screen for one source file, preparation coverage, local FTS retrieval, evidence preview, and exact page links.
3. Add a deterministic local response mode that can produce an evidence bundle, preparation gap report, and reading-guide or analysis-map skeleton without claiming generated analysis.
4. Persist conversations, user questions, evidence links, reading-guide drafts, and user conclusions. Add migrations, validation, exports, backup/restore, and tests.
5. Add global/project preference records and resolved-preview/edit/delete UI. Preferences remain local and are visibly non-evidence.

Success criterion: a researcher can import a full PDF with or without finished citation metadata, see document preparation state in Sources, ask a question, inspect selected local pages and excerpts, save a page-linked reading guide or analysis outline, and distinguish source text, assistant material, and user notes without any network connection.

### Phase B: grounded local response policy

1. Add a provider-neutral orchestrator that creates the bounded packet and validates citations.
2. Add transparent status rules for supported, partial, contradictory, and insufficient evidence.
3. Add structured assistant observations and feedback, with evidence-link validation and regression tests for missing/invalid citations.

Success criterion: any future generator can only return a displayable source-supported claim if it links to packet evidence.

### Phase C: optional cloud conversation provider

1. Implement a separately packaged Azure-hosted adapter behind `GroundedConversationProvider`.
2. Add provider setup, OS-backed secrets, per-request consent, packet preview, provider provenance, and network-failure tests.
3. Keep the local path available and default. Do not auto-send requests or source content.

### Phase D: optional embeddings and hybrid retrieval

1. Implement a local embedding index first if a suitable local runtime is adopted; otherwise make a separately consented Azure embedding adapter.
2. Add hybrid ranking, stale-index handling, rebuild/delete controls, and retrieval evaluation fixtures with known cited pages.
3. Compare lexical and hybrid retrieval quality using page-level recall, citation precision, and insufficient-evidence correctness rather than fluent-answer preference alone.

### Phase E: multi-source and reviewer-context work

After page-level grounding is trustworthy, extend packets deliberately to project source sets and reviewer comments. A reviewer-comment response must include the comment, the relevant manuscript section, selected source evidence, and an explicit boundary between suggested revision and scholarly support. It should not infer reviewer intent or research consensus from generic model knowledge.

## Decisions for product owner input

The implementation can start with the defaults above, but these choices should be settled before Phase C or D:

1. Should source-file deletion be blocked while any conversation, guide, or observation cites it, or should an explicit archive flow retain unavailable citation snapshots?
2. For reading guides, should the initial scope be strictly one source file, or may it use the selected project’s research question and preferences by default after the user selects a project?
3. Should a local deterministic Phase A produce only evidence bundles and guide skeletons, or may it use local rule-based prose templates for limited summaries clearly labelled as such?
4. What Azure region, data-retention setting, and organizational consent policy must the first cloud provider display and enforce?
5. Should “valued insight” examples be sent verbatim when cloud use is approved, or summarized locally into a minimal style profile first?
