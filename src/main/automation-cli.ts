import { loadWorkerConfig } from './automation-config'
import { scanInbox } from './automation-worker'

function printUsage(): void {
  console.log('Usage: npm run worker:scan')
  console.log('Set RESEARCH_STUDIO_DATA_ROOT or RESEARCH_STUDIO_WORKER_CONFIG before running.')
}

const command = process.argv[2]

if (command !== 'scan-inbox') {
  printUsage()
  process.exitCode = 1
} else {
  try {
    const result = scanInbox(loadWorkerConfig())
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
