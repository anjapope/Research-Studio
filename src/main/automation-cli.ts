import { loadWorkerConfig } from './automation-config'
import { processQueuedJobs } from './automation-processor'
import { scanInbox } from './automation-worker'

function printUsage(): void {
  console.log('Usage: npm run worker:scan')
  console.log('       npm run worker:process')
  console.log('Set RESEARCH_STUDIO_DATA_ROOT or RESEARCH_STUDIO_WORKER_CONFIG before running.')
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command !== 'scan-inbox' && command !== 'process') {
    printUsage()
    process.exitCode = 1
    return
  }
  try {
    const result =
      command === 'scan-inbox'
        ? scanInbox(loadWorkerConfig())
        : await processQueuedJobs(loadWorkerConfig())
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

void main()
