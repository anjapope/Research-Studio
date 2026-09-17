import { ElectronAPI } from '@electron-toolkit/preload'
import type { ResearchStudioApi } from '../shared/domain'

declare global {
  interface Window {
    electron: ElectronAPI
    api: ResearchStudioApi
  }
}
