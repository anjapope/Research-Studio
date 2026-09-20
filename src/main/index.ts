import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { WorkspaceService } from './workspace-service'

let workspaceService: WorkspaceService

function createWindow(): void {
  let closeReady = false
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })
  mainWindow.on('close', (event) => {
    if (closeReady) return
    event.preventDefault()
    mainWindow.webContents.send('app:before-close')
  })
  const closeHandler = (event: Electron.IpcMainEvent): void => {
    if (event.sender !== mainWindow.webContents) return
    closeReady = true
    mainWindow.close()
  }
  ipcMain.on('app:close-ready', closeHandler)
  mainWindow.on('closed', () => ipcMain.removeListener('app:close-ready', closeHandler))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const target = new URL(details.url)
      if (target.protocol === 'https:' || target.protocol === 'http:') {
        void shell.openExternal(target.toString())
      }
    } catch {
      // Relative and malformed links remain inside the isolated preview.
    }
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('studio.research.desktop')
  workspaceService = new WorkspaceService()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('workspace:choose', (_, mode) => workspaceService.choose(mode))
  ipcMain.handle('teaching:list', () => workspaceService.listLessons())
  ipcMain.handle('teaching:ai-settings', () => workspaceService.teachingSettings.get())
  ipcMain.handle('teaching:save-ai-settings', (_, settings) =>
    workspaceService.teachingSettings.save(settings)
  )
  ipcMain.handle('teaching:synthesize', (_, lesson) =>
    workspaceService.synthesizeTeachingLesson(lesson)
  )
  ipcMain.handle('teaching:cancel-synthesis', () => workspaceService.cancelTeachingSynthesis())
  ipcMain.handle('teaching:save', (_, lesson) => workspaceService.saveLesson(lesson))
  ipcMain.handle('teaching:import', () => workspaceService.importTeachingDocuments())
  ipcMain.handle('teaching:export', (_, lesson, format) =>
    workspaceService.exportLesson(lesson, format)
  )
  ipcMain.handle('workspace:recent', () => workspaceService.recent())
  ipcMain.handle('workspace:close', () => workspaceService.close())
  ipcMain.handle('sources:list', (_, query) => workspaceService.listSources(query))
  ipcMain.handle('sources:get', (_, id) => workspaceService.getSource(id))
  ipcMain.handle('sources:save', (_, draft) => workspaceService.saveSource(draft))
  ipcMain.handle('sources:remove', (_, id) => workspaceService.removeSource(id))
  ipcMain.handle('sources:attach-pdf', (_, id) => workspaceService.attachPdf(id))
  ipcMain.handle('sources:open-file', (_, id) => workspaceService.openFile(id))
  ipcMain.handle('sources:import-library', () => workspaceService.importLibrary())
  ipcMain.handle('sources:export-library', (_, format) => workspaceService.exportLibrary(format))
  ipcMain.handle('worker:status', () => workspaceService.workerStatus())
  ipcMain.handle('worker:documents', () => workspaceService.workerDocuments())
  ipcMain.handle('worker:import-document', (_, fileId) =>
    workspaceService.importWorkerDocument(fileId)
  )
  ipcMain.handle('reader:pdf-data', (_, id) => workspaceService.pdfData(id))
  ipcMain.handle('reader:page-summaries', (_, id) => workspaceService.listDocumentPageSummaries(id))
  ipcMain.handle('reader:list-excerpts', (_, sourceId) => workspaceService.listExcerpts(sourceId))
  ipcMain.handle('reader:save-excerpt', (_, draft) => workspaceService.saveExcerpt(draft))
  ipcMain.handle('reader:remove-excerpt', (_, id) => workspaceService.removeExcerpt(id))
  ipcMain.handle('reader:list-codes', () => workspaceService.listCodes())
  ipcMain.handle('reader:save-page-text', (_, fileId, page, text, method, confidence) =>
    workspaceService.saveDocumentPageText(fileId, page, text, method, confidence)
  )
  ipcMain.handle('reader:get-page-text', (_, fileId, page) =>
    workspaceService.getDocumentPageText(fileId, page)
  )
  ipcMain.handle('reader:ocr-page', (_, image) => workspaceService.ocrPage(image))
  ipcMain.handle('projects:list', () => workspaceService.listProjects())
  ipcMain.handle('projects:get', (_, id) => workspaceService.getProject(id))
  ipcMain.handle('projects:save', (_, draft) => workspaceService.saveProject(draft))
  ipcMain.handle('projects:remove', (_, id) => workspaceService.removeProject(id))
  ipcMain.handle('projects:assign-source', (_, projectId, sourceId, assigned) =>
    workspaceService.assignProjectSource(projectId, sourceId, assigned)
  )
  ipcMain.handle('projects:save-goal', (_, projectId, goal) =>
    workspaceService.saveProjectGoal(projectId, goal)
  )
  ipcMain.handle('projects:remove-goal', (_, id) => workspaceService.removeProjectGoal(id))
  ipcMain.handle('projects:save-note', (_, projectId, body) =>
    workspaceService.saveProjectNote(projectId, body)
  )
  ipcMain.handle('projects:remove-note', (_, id) => workspaceService.removeProjectNote(id))
  ipcMain.handle('projects:import-files', (_, id) => workspaceService.importProjectFiles(id))
  ipcMain.handle('projects:import-dropped-files', (_, id, paths) =>
    workspaceService.importDroppedProjectFiles(id, paths)
  )
  ipcMain.handle('projects:open-file', (_, id) => workspaceService.openProjectFile(id))
  ipcMain.handle('projects:reveal-file', (_, id) => workspaceService.revealProjectFile(id))
  ipcMain.handle('projects:remove-file', (_, projectId, fileId, deleteManagedCopy) =>
    workspaceService.removeProjectFile(projectId, fileId, deleteManagedCopy)
  )
  ipcMain.handle('projects:export', (_, id) => workspaceService.exportProject(id))
  ipcMain.handle('manuscripts:list', (_, projectId) => workspaceService.listManuscripts(projectId))
  ipcMain.handle('manuscripts:get', (_, id) => workspaceService.getManuscript(id))
  ipcMain.handle('manuscripts:save', (_, projectId, draft) =>
    workspaceService.saveManuscript(projectId, draft)
  )
  ipcMain.handle('manuscripts:import-draft', (_, projectId) =>
    workspaceService.importManuscript(projectId)
  )
  ipcMain.handle('manuscripts:remove', (_, id) => workspaceService.removeManuscript(id))
  ipcMain.handle('manuscripts:save-section', (_, manuscriptId, section) =>
    workspaceService.saveManuscriptSection(manuscriptId, section)
  )
  ipcMain.handle('manuscripts:remove-section', (_, id) =>
    workspaceService.removeManuscriptSection(id)
  )
  ipcMain.handle('manuscripts:add-trace', (_, sectionId, excerptId, sourceId, marker) =>
    workspaceService.addManuscriptTrace(sectionId, excerptId, sourceId, marker)
  )
  ipcMain.handle('manuscripts:export', (_, id, format) =>
    workspaceService.exportManuscript(id, format)
  )
  ipcMain.handle('revisions:get', (_, manuscriptId) =>
    workspaceService.getRevisionWorkspace(manuscriptId)
  )
  ipcMain.handle('revisions:import-comments', (_, manuscriptId) =>
    workspaceService.importReviewerComments(manuscriptId)
  )
  ipcMain.handle('revisions:analyze-manuscript', (_, manuscriptId) =>
    workspaceService.analyzeManuscriptRevision(manuscriptId)
  )
  ipcMain.handle('revisions:set-status', (_, suggestionId, status) =>
    workspaceService.setRevisionSuggestionStatus(suggestionId, status)
  )
  ipcMain.handle('revisions:remove-document', (_, documentId) =>
    workspaceService.removeReviewDocument(documentId)
  )
  ipcMain.handle('interviews:list', () => workspaceService.listInterviews())
  ipcMain.handle('interviews:get', (_, id) => workspaceService.getInterview(id))
  ipcMain.handle('interviews:save', (_, draft) => workspaceService.saveInterview(draft))
  ipcMain.handle('interviews:remove', (_, id) => workspaceService.removeInterview(id))
  ipcMain.handle('interviews:attach-media', (_, id) => workspaceService.attachInterviewMedia(id))
  ipcMain.handle('interviews:open-media', (_, id) => workspaceService.openInterviewMedia(id))
  ipcMain.handle('interviews:import-transcript', (_, id) => workspaceService.importTranscript(id))
  ipcMain.handle('interviews:save-segment', (_, id, segment) =>
    workspaceService.saveTranscriptSegment(id, segment)
  )
  ipcMain.handle('interviews:remove-segment', (_, id) =>
    workspaceService.removeTranscriptSegment(id)
  )
  ipcMain.handle('analysis:analyze', (_, query) => workspaceService.analyzeInterviews(query))
  ipcMain.handle('analysis:list-memos', (_, projectId) =>
    workspaceService.listSynthesisMemos(projectId)
  )
  ipcMain.handle('analysis:save-memo', (_, draft) => workspaceService.saveSynthesisMemo(draft))
  ipcMain.handle('analysis:remove-memo', (_, id) => workspaceService.removeSynthesisMemo(id))
  ipcMain.handle('analysis:export-memo', (_, id) => workspaceService.exportSynthesisMemo(id))
  ipcMain.handle('preservation:check-integrity', () => workspaceService.checkIntegrity())
  ipcMain.handle('preservation:create-backup', () => workspaceService.createBackup())
  ipcMain.handle('preservation:restore-backup', () => workspaceService.restoreBackup())
  ipcMain.handle('preservation:export-qualitative', (_, format) =>
    workspaceService.exportQualitative(format)
  )
  ipcMain.handle('discovery:search', (_, query, types) => workspaceService.search(query, types))
  ipcMain.handle('discovery:status', () => workspaceService.searchIndexStatus())
  ipcMain.handle('discovery:rebuild', () => workspaceService.rebuildSearchIndex())

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  workspaceService?.close()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
