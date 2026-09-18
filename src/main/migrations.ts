export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'phase-one-foundation',
    sql: `
      CREATE TABLE workspace (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL
      );
      CREATE TABLE people (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        given_name TEXT,
        family_name TEXT,
        orcid TEXT,
        origin TEXT NOT NULL CHECK (origin IN ('user', 'imported', 'ai')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source_type TEXT NOT NULL,
        status TEXT NOT NULL,
        year INTEGER,
        publication_title TEXT,
        publisher TEXT,
        doi TEXT,
        url TEXT,
        abstract TEXT,
        notes TEXT,
        origin TEXT NOT NULL CHECK (origin IN ('user', 'imported', 'ai')),
        provenance_note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE source_people (
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES people(id),
        role TEXT NOT NULL DEFAULT 'author',
        position INTEGER NOT NULL,
        PRIMARY KEY (source_id, person_id, role)
      );
      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE source_tags (
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (source_id, tag_id)
      );
      CREATE TABLE source_files (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        media_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE INDEX source_title_idx ON sources(title COLLATE NOCASE);
      CREATE INDEX source_updated_idx ON sources(updated_at DESC);

      CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, origin TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), title TEXT NOT NULL, document_type TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE annotations (id TEXT PRIMARY KEY, source_id TEXT REFERENCES sources(id), document_id TEXT REFERENCES documents(id), body TEXT NOT NULL, locator_json TEXT, origin TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE evidence_excerpts (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), text TEXT NOT NULL, locator_json TEXT, provenance_json TEXT NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE interviews (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), title TEXT NOT NULL, participant_person_id TEXT REFERENCES people(id), occurred_at TEXT, consent_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE transcripts (id TEXT PRIMARY KEY, interview_id TEXT NOT NULL REFERENCES interviews(id), content TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE qualitative_codes (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT NOT NULL, description TEXT, color TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE manuscripts (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), title TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE goals (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), title TEXT NOT NULL, horizon TEXT, status TEXT NOT NULL, target_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE relationships (id TEXT PRIMARY KEY, from_type TEXT NOT NULL, from_id TEXT NOT NULL, relation_type TEXT NOT NULL, to_type TEXT NOT NULL, to_id TEXT NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE agent_observations (id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, body TEXT NOT NULL, model_provider TEXT, model_name TEXT, prompt_hash TEXT, supporting_evidence_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    `
  },
  {
    version: 2,
    name: 'pdf-evidence-reader',
    sql: `
      ALTER TABLE evidence_excerpts ADD COLUMN source_file_id TEXT REFERENCES source_files(id);
      ALTER TABLE evidence_excerpts ADD COLUMN note TEXT;
      CREATE TABLE evidence_excerpt_codes (
        excerpt_id TEXT NOT NULL REFERENCES evidence_excerpts(id) ON DELETE CASCADE,
        code_id TEXT NOT NULL REFERENCES qualitative_codes(id) ON DELETE CASCADE,
        PRIMARY KEY (excerpt_id, code_id)
      );
      CREATE INDEX evidence_source_idx ON evidence_excerpts(source_id, created_at DESC);
      CREATE UNIQUE INDEX qualitative_code_name_idx ON qualitative_codes(name COLLATE NOCASE)
        WHERE project_id IS NULL;
      UPDATE workspace SET schema_version = 2;
    `
  },
  {
    version: 3,
    name: 'project-workspaces',
    sql: `
      ALTER TABLE projects ADD COLUMN research_question TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'complete'));
      CREATE TABLE project_sources (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        added_at TEXT NOT NULL,
        PRIMARY KEY (project_id, source_id)
      );
      CREATE TABLE project_notes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('user', 'imported', 'ai')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX project_sources_source_idx ON project_sources(source_id);
      CREATE INDEX project_notes_project_idx ON project_notes(project_id, created_at DESC);
      UPDATE workspace SET schema_version = 3;
    `
  },
  {
    version: 4,
    name: 'evidence-linked-manuscripts',
    sql: `
      CREATE TABLE manuscript_sections (
        id TEXT PRIMARY KEY,
        manuscript_id TEXT NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE manuscript_traces (
        id TEXT PRIMARY KEY,
        section_id TEXT NOT NULL REFERENCES manuscript_sections(id) ON DELETE CASCADE,
        evidence_excerpt_id TEXT REFERENCES evidence_excerpts(id) ON DELETE SET NULL,
        source_id TEXT NOT NULL REFERENCES sources(id),
        marker TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX manuscript_project_idx ON manuscripts(project_id, updated_at DESC);
      CREATE INDEX manuscript_section_idx ON manuscript_sections(manuscript_id, position);
      CREATE INDEX manuscript_trace_section_idx ON manuscript_traces(section_id);
      UPDATE workspace SET schema_version = 4;
    `
  },
  {
    version: 5,
    name: 'qualitative-interviews',
    sql: `
      ALTER TABLE interviews ADD COLUMN participant_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE interviews ADD COLUMN status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'recorded', 'transcribed', 'coded'));
      CREATE TABLE interview_media (
        id TEXT PRIMARY KEY,
        interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        media_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE transcript_segments (
        id TEXT PRIMARY KEY,
        transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
        speaker TEXT NOT NULL,
        start_seconds REAL,
        end_seconds REAL,
        text TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE transcript_segment_codes (
        segment_id TEXT NOT NULL REFERENCES transcript_segments(id) ON DELETE CASCADE,
        code_id TEXT NOT NULL REFERENCES qualitative_codes(id) ON DELETE CASCADE,
        PRIMARY KEY (segment_id, code_id)
      );
      CREATE INDEX interview_project_idx ON interviews(project_id, updated_at DESC);
      CREATE INDEX transcript_segment_idx ON transcript_segments(transcript_id, position);
      UPDATE workspace SET schema_version = 5;
    `
  },
  {
    version: 6,
    name: 'qualitative-synthesis',
    sql: `
      CREATE TABLE synthesis_memos (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('working', 'developed')),
        origin TEXT NOT NULL CHECK (origin IN ('user', 'imported', 'ai')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE synthesis_memo_segments (
        memo_id TEXT NOT NULL REFERENCES synthesis_memos(id) ON DELETE CASCADE,
        segment_id TEXT NOT NULL REFERENCES transcript_segments(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        linked_at TEXT NOT NULL,
        PRIMARY KEY (memo_id, segment_id)
      );
      CREATE INDEX synthesis_memo_project_idx ON synthesis_memos(project_id, updated_at DESC);
      CREATE INDEX synthesis_memo_segment_idx ON synthesis_memo_segments(segment_id);
      UPDATE workspace SET schema_version = 6;
    `
  },
  {
    version: 7,
    name: 'local-document-intelligence',
    sql: `
      CREATE TABLE document_pages (
        id TEXT PRIMARY KEY,
        source_file_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL CHECK (page_number > 0),
        text TEXT NOT NULL DEFAULT '',
        extraction_method TEXT NOT NULL CHECK (extraction_method IN ('pdf-text', 'ocr')),
        language TEXT,
        confidence REAL,
        file_sha256 TEXT NOT NULL,
        extracted_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (source_file_id, page_number)
      );
      CREATE VIRTUAL TABLE search_index USING fts5(
        entity_type UNINDEXED,
        entity_id UNINDEXED,
        parent_id UNINDEXED,
        source_file_id UNINDEXED,
        page UNINDEXED,
        title,
        context,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TABLE search_index_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        dirty INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0, 1)),
        indexed_at TEXT,
        item_count INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO search_index_state (id, dirty, indexed_at, item_count)
      VALUES (1, 1, NULL, 0);

      CREATE TRIGGER search_dirty_sources_insert AFTER INSERT ON sources
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_sources_update AFTER UPDATE ON sources
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_sources_delete AFTER DELETE ON sources
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_evidence_insert AFTER INSERT ON evidence_excerpts
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_evidence_update AFTER UPDATE ON evidence_excerpts
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_evidence_delete AFTER DELETE ON evidence_excerpts
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_segments_insert AFTER INSERT ON transcript_segments
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_segments_update AFTER UPDATE ON transcript_segments
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_segments_delete AFTER DELETE ON transcript_segments
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_memos_insert AFTER INSERT ON synthesis_memos
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_memos_update AFTER UPDATE ON synthesis_memos
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_memos_delete AFTER DELETE ON synthesis_memos
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_manuscripts_insert AFTER INSERT ON manuscript_sections
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_manuscripts_update AFTER UPDATE ON manuscript_sections
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_manuscripts_delete AFTER DELETE ON manuscript_sections
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_pages_insert AFTER INSERT ON document_pages
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_pages_update AFTER UPDATE ON document_pages
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_pages_delete AFTER DELETE ON document_pages
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE INDEX document_page_file_idx ON document_pages(source_file_id, page_number);
      UPDATE workspace SET schema_version = 7;
    `
  },
  {
    version: 8,
    name: 'project-managed-files',
    sql: `
      CREATE TABLE project_managed_files (
        id TEXT PRIMARY KEY,
        owner_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        original_name TEXT NOT NULL,
        original_path TEXT,
        relative_path TEXT NOT NULL UNIQUE,
        media_type TEXT NOT NULL,
        extension TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        sha256 TEXT NOT NULL UNIQUE,
        imported_at TEXT NOT NULL
      );
      CREATE TABLE project_file_links (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_id TEXT NOT NULL REFERENCES project_managed_files(id) ON DELETE CASCADE,
        linked_at TEXT NOT NULL,
        PRIMARY KEY (project_id, file_id)
      );
      CREATE INDEX project_file_links_file_idx ON project_file_links(file_id);
      UPDATE workspace SET schema_version = 8;
    `
  },
  {
    version: 9,
    name: 'traceable-revision-assistant',
    sql: `
      CREATE TABLE review_documents (
        id TEXT PRIMARY KEY,
        manuscript_id TEXT NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        content TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        UNIQUE (manuscript_id, sha256)
      );
      CREATE TABLE reviewer_comments (
        id TEXT PRIMARY KEY,
        review_document_id TEXT NOT NULL REFERENCES review_documents(id) ON DELETE CASCADE,
        manuscript_id TEXT NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        body TEXT NOT NULL,
        category TEXT NOT NULL CHECK (
          category IN ('argument', 'evidence', 'methods', 'structure', 'clarity', 'style')
        ),
        section_id TEXT REFERENCES manuscript_sections(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE revision_suggestions (
        id TEXT PRIMARY KEY,
        manuscript_id TEXT NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
        reviewer_comment_id TEXT REFERENCES reviewer_comments(id) ON DELETE CASCADE,
        section_id TEXT REFERENCES manuscript_sections(id) ON DELETE SET NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('reviewer-comment', 'manuscript-rule')),
        category TEXT NOT NULL CHECK (
          category IN ('argument', 'evidence', 'methods', 'structure', 'clarity', 'style')
        ),
        fingerprint TEXT NOT NULL,
        summary TEXT NOT NULL,
        rationale TEXT NOT NULL,
        proposed_action TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (
          status IN ('open', 'addressed', 'deferred', 'dismissed')
        ),
        current INTEGER NOT NULL DEFAULT 1 CHECK (current IN (0, 1)),
        generated_by TEXT NOT NULL DEFAULT 'local-rules',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (manuscript_id, fingerprint)
      );
      CREATE INDEX review_document_manuscript_idx
        ON review_documents(manuscript_id, imported_at DESC);
      CREATE INDEX reviewer_comment_manuscript_idx
        ON reviewer_comments(manuscript_id, position);
      CREATE INDEX revision_suggestion_manuscript_idx
        ON revision_suggestions(manuscript_id, current, status, created_at DESC);
      UPDATE workspace SET schema_version = 9;
    `
  },
  {
    version: 10,
    name: 'teaching-lessons',
    sql: `CREATE TABLE teaching_lessons (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
      UPDATE workspace SET schema_version = 10;`
  },
  {
    version: 11,
    name: 'shared-worker-provenance',
    sql: `
      ALTER TABLE source_files ADD COLUMN worker_file_id TEXT;
      ALTER TABLE source_files ADD COLUMN worker_job_id TEXT;
      ALTER TABLE source_files ADD COLUMN worker_original_path TEXT;
      ALTER TABLE source_files ADD COLUMN worker_preserved_path TEXT;
      ALTER TABLE source_files ADD COLUMN worker_extraction_path TEXT;
      ALTER TABLE source_files ADD COLUMN worker_extraction_status TEXT;
      ALTER TABLE source_files ADD COLUMN worker_processed_at TEXT;
      ALTER TABLE source_files ADD COLUMN worker_processor TEXT;
      CREATE UNIQUE INDEX source_worker_file_idx ON source_files(worker_file_id)
        WHERE worker_file_id IS NOT NULL;
      CREATE TABLE source_extractions (
        source_file_id TEXT PRIMARY KEY REFERENCES source_files(id) ON DELETE CASCADE,
        extraction_status TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        output_path TEXT,
        record_path TEXT,
        extractor TEXT,
        page_count INTEGER,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        imported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      UPDATE workspace SET schema_version = 11;`
  },
  {
    version: 12,
    name: 'source-extraction-search',
    sql: `
      CREATE TRIGGER search_dirty_extractions_insert AFTER INSERT ON source_extractions
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_extractions_update AFTER UPDATE ON source_extractions
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      CREATE TRIGGER search_dirty_extractions_delete AFTER DELETE ON source_extractions
      BEGIN UPDATE search_index_state SET dirty = 1 WHERE id = 1; END;
      UPDATE search_index_state SET dirty = 1 WHERE id = 1;
      UPDATE workspace SET schema_version = 12;`
  }
]
