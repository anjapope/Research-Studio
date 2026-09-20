import { contextBridge, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ResearchStudioApi } from '../shared/domain'

let beforeCloseHandler: (() => Promise<boolean>) | null = null
electronAPI.ipcRenderer.on('app:before-close', async () => {
  if (!beforeCloseHandler || (await beforeCloseHandler())) {
    electronAPI.ipcRenderer.send('app:close-ready')
  }
})

// Custom APIs for renderer
const api: ResearchStudioApi = {
  teaching: {
    aiSettings: () => electronAPI.ipcRenderer.invoke('teaching:ai-settings'),
    saveAiSettings: (settings) =>
      electronAPI.ipcRenderer.invoke('teaching:save-ai-settings', settings),
    synthesize: (lesson) => electronAPI.ipcRenderer.invoke('teaching:synthesize', lesson),
    cancelSynthesis: () => electronAPI.ipcRenderer.invoke('teaching:cancel-synthesis'),
    list: () => electronAPI.ipcRenderer.invoke('teaching:list'),
    save: (lesson) => electronAPI.ipcRenderer.invoke('teaching:save', lesson),
    importDocuments: () => electronAPI.ipcRenderer.invoke('teaching:import'),
    export: (lesson, format) => electronAPI.ipcRenderer.invoke('teaching:export', lesson, format)
  },
  lifecycle: {
    setBeforeCloseHandler: (handler) => {
      beforeCloseHandler = handler
    },
    flushBeforeNavigation: () => beforeCloseHandler?.() ?? Promise.resolve(true)
  },
  workspace: {
    choose: (mode) => electronAPI.ipcRenderer.invoke('workspace:choose', mode),
    recent: () => electronAPI.ipcRenderer.invoke('workspace:recent'),
    close: () => electronAPI.ipcRenderer.invoke('workspace:close')
  },
  sources: {
    list: (query) => electronAPI.ipcRenderer.invoke('sources:list', query),
    get: (id) => electronAPI.ipcRenderer.invoke('sources:get', id),
    save: (draft) => electronAPI.ipcRenderer.invoke('sources:save', draft),
    remove: (id) => electronAPI.ipcRenderer.invoke('sources:remove', id),
    attachPdf: (id) => electronAPI.ipcRenderer.invoke('sources:attach-pdf', id),
    openFile: (id) => electronAPI.ipcRenderer.invoke('sources:open-file', id),
    importLibrary: () => electronAPI.ipcRenderer.invoke('sources:import-library'),
    exportLibrary: (format) => electronAPI.ipcRenderer.invoke('sources:export-library', format)
  },
  worker: {
    status: () => electronAPI.ipcRenderer.invoke('worker:status'),
    documents: () => electronAPI.ipcRenderer.invoke('worker:documents'),
    importDocument: (fileId) => electronAPI.ipcRenderer.invoke('worker:import-document', fileId)
  },
  reader: {
    listPageSummaries: (fileId) => electronAPI.ipcRenderer.invoke('reader:page-summaries', fileId),
    pdfData: (id) => electronAPI.ipcRenderer.invoke('reader:pdf-data', id),
    listExcerpts: (sourceId) => electronAPI.ipcRenderer.invoke('reader:list-excerpts', sourceId),
    saveExcerpt: (draft) => electronAPI.ipcRenderer.invoke('reader:save-excerpt', draft),
    removeExcerpt: (id) => electronAPI.ipcRenderer.invoke('reader:remove-excerpt', id),
    listCodes: () => electronAPI.ipcRenderer.invoke('reader:list-codes'),
    savePageText: (fileId, page, text, method, confidence) =>
      electronAPI.ipcRenderer.invoke(
        'reader:save-page-text',
        fileId,
        page,
        text,
        method,
        confidence
      ),
    getPageText: (fileId, page) =>
      electronAPI.ipcRenderer.invoke('reader:get-page-text', fileId, page),
    ocrPage: (image) => electronAPI.ipcRenderer.invoke('reader:ocr-page', image)
  },
  projects: {
    list: () => electronAPI.ipcRenderer.invoke('projects:list'),
    get: (id) => electronAPI.ipcRenderer.invoke('projects:get', id),
    save: (draft) => electronAPI.ipcRenderer.invoke('projects:save', draft),
    remove: (id) => electronAPI.ipcRenderer.invoke('projects:remove', id),
    assignSource: (projectId, sourceId, assigned) =>
      electronAPI.ipcRenderer.invoke('projects:assign-source', projectId, sourceId, assigned),
    saveGoal: (projectId, goal) =>
      electronAPI.ipcRenderer.invoke('projects:save-goal', projectId, goal),
    removeGoal: (id) => electronAPI.ipcRenderer.invoke('projects:remove-goal', id),
    saveNote: (projectId, body) =>
      electronAPI.ipcRenderer.invoke('projects:save-note', projectId, body),
    removeNote: (id) => electronAPI.ipcRenderer.invoke('projects:remove-note', id),
    importFiles: (projectId) => electronAPI.ipcRenderer.invoke('projects:import-files', projectId),
    importDroppedFiles: (projectId, paths) =>
      electronAPI.ipcRenderer.invoke('projects:import-dropped-files', projectId, paths),
    openFile: (fileId) => electronAPI.ipcRenderer.invoke('projects:open-file', fileId),
    revealFile: (fileId) => electronAPI.ipcRenderer.invoke('projects:reveal-file', fileId),
    removeFile: (projectId, fileId, deleteManagedCopy) =>
      electronAPI.ipcRenderer.invoke('projects:remove-file', projectId, fileId, deleteManagedCopy),
    export: (id) => electronAPI.ipcRenderer.invoke('projects:export', id)
  },
  files: {
    pathForDrop: (file) => webUtils.getPathForFile(file)
  },
  manuscripts: {
    list: (projectId) => electronAPI.ipcRenderer.invoke('manuscripts:list', projectId),
    get: (id) => electronAPI.ipcRenderer.invoke('manuscripts:get', id),
    save: (projectId, draft) =>
      electronAPI.ipcRenderer.invoke('manuscripts:save', projectId, draft),
    importDraft: (projectId) =>
      electronAPI.ipcRenderer.invoke('manuscripts:import-draft', projectId),
    remove: (id) => electronAPI.ipcRenderer.invoke('manuscripts:remove', id),
    saveSection: (manuscriptId, section) =>
      electronAPI.ipcRenderer.invoke('manuscripts:save-section', manuscriptId, section),
    removeSection: (id) => electronAPI.ipcRenderer.invoke('manuscripts:remove-section', id),
    addTrace: (sectionId, excerptId, sourceId, marker) =>
      electronAPI.ipcRenderer.invoke(
        'manuscripts:add-trace',
        sectionId,
        excerptId,
        sourceId,
        marker
      ),
    export: (id, format) => electronAPI.ipcRenderer.invoke('manuscripts:export', id, format)
  },
  revisions: {
    get: (manuscriptId) => electronAPI.ipcRenderer.invoke('revisions:get', manuscriptId),
    importComments: (manuscriptId) =>
      electronAPI.ipcRenderer.invoke('revisions:import-comments', manuscriptId),
    analyzeManuscript: (manuscriptId) =>
      electronAPI.ipcRenderer.invoke('revisions:analyze-manuscript', manuscriptId),
    setStatus: (suggestionId, status) =>
      electronAPI.ipcRenderer.invoke('revisions:set-status', suggestionId, status),
    removeDocument: (documentId) =>
      electronAPI.ipcRenderer.invoke('revisions:remove-document', documentId)
  },
  interviews: {
    list: () => electronAPI.ipcRenderer.invoke('interviews:list'),
    get: (id) => electronAPI.ipcRenderer.invoke('interviews:get', id),
    save: (draft) => electronAPI.ipcRenderer.invoke('interviews:save', draft),
    remove: (id) => electronAPI.ipcRenderer.invoke('interviews:remove', id),
    attachMedia: (id) => electronAPI.ipcRenderer.invoke('interviews:attach-media', id),
    openMedia: (id) => electronAPI.ipcRenderer.invoke('interviews:open-media', id),
    importTranscript: (id) => electronAPI.ipcRenderer.invoke('interviews:import-transcript', id),
    saveSegment: (id, segment) =>
      electronAPI.ipcRenderer.invoke('interviews:save-segment', id, segment),
    removeSegment: (id) => electronAPI.ipcRenderer.invoke('interviews:remove-segment', id)
  },
  analysis: {
    analyze: (query) => electronAPI.ipcRenderer.invoke('analysis:analyze', query),
    listMemos: (projectId) => electronAPI.ipcRenderer.invoke('analysis:list-memos', projectId),
    saveMemo: (draft) => electronAPI.ipcRenderer.invoke('analysis:save-memo', draft),
    removeMemo: (id) => electronAPI.ipcRenderer.invoke('analysis:remove-memo', id),
    exportMemo: (id) => electronAPI.ipcRenderer.invoke('analysis:export-memo', id)
  },
  preservation: {
    checkIntegrity: () => electronAPI.ipcRenderer.invoke('preservation:check-integrity'),
    createBackup: () => electronAPI.ipcRenderer.invoke('preservation:create-backup'),
    restoreBackup: () => electronAPI.ipcRenderer.invoke('preservation:restore-backup'),
    exportQualitative: (format) =>
      electronAPI.ipcRenderer.invoke('preservation:export-qualitative', format)
  },
  discovery: {
    search: (query, types) => electronAPI.ipcRenderer.invoke('discovery:search', query, types),
    status: () => electronAPI.ipcRenderer.invoke('discovery:status'),
    rebuild: () => electronAPI.ipcRenderer.invoke('discovery:rebuild')
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
