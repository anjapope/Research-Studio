import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import {
  loadWorkerSchedulerConfig,
  runWorkerSchedule,
  workerScheduleStatus
} from './automation-scheduler'

function option(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

function usage(): void {
  console.log(
    'Usage: npm run worker:schedule:<command> -- --config /absolute/path/to/scheduler.json'
  )
  console.log('Commands: run, status, install, start, stop, uninstall')
}

function launchAgentPath(label: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
}

function escapeXml(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (character) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!
  )
}

function plist(label: string, configPath: string, intervalMinutes: number): string {
  const repository = resolve(__dirname, '../..')
  const argumentsList = [
    process.execPath,
    join(repository, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    join(repository, 'src', 'main', 'automation-scheduler-cli.ts'),
    'run',
    '--config',
    configPath
  ]
  const argumentsXml = argumentsList
    .map((item) => `    <string>${escapeXml(item)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>StartInterval</key>
  <integer>${intervalMinutes * 60}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>/dev/null</string>
</dict>
</plist>
`
}

function launchctl(argumentsList: string[]): void {
  const result = spawnSync('/bin/launchctl', argumentsList, { encoding: 'utf8' })
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'launchctl failed.')
}

function launchdLoaded(label: string): boolean {
  const result = spawnSync('/bin/launchctl', ['print', domain(label)], { encoding: 'utf8' })
  return result.status === 0
}

function domain(label: string): string {
  return `gui/${process.getuid?.() ?? 0}/${label}`
}

async function main(): Promise<void> {
  const command = process.argv[2]
  const configPath = option('--config')
  if (
    !command ||
    !configPath ||
    !['run', 'status', 'install', 'start', 'stop', 'uninstall'].includes(command)
  ) {
    usage()
    process.exitCode = 1
    return
  }
  try {
    const resolvedConfigPath = resolve(configPath)
    const config = loadWorkerSchedulerConfig(resolvedConfigPath)
    const agentPath = launchAgentPath(config.label)
    if (command === 'run') {
      console.log(JSON.stringify(await runWorkerSchedule(config), null, 2))
      return
    }
    if (command === 'status') {
      console.log(
        JSON.stringify(
          {
            ...workerScheduleStatus(config),
            launchAgentPath: agentPath,
            installed: existsSync(agentPath),
            loaded: launchdLoaded(config.label)
          },
          null,
          2
        )
      )
      return
    }
    if (command === 'install') {
      mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
      writeFileSync(
        agentPath,
        plist(config.label, resolvedConfigPath, config.intervalMinutes),
        'utf8'
      )
      console.log(
        JSON.stringify(
          { installed: agentPath, label: config.label, enabled: config.enabled },
          null,
          2
        )
      )
      return
    }
    if (command === 'start') {
      if (!existsSync(agentPath)) throw new Error('Install the launchd agent before starting it.')
      try {
        launchctl(['bootstrap', `gui/${process.getuid?.() ?? 0}`, agentPath])
      } catch (error) {
        if (!(error instanceof Error) || !/service already loaded/i.test(error.message)) throw error
      }
      launchctl(['kickstart', '-k', domain(config.label)])
      console.log(JSON.stringify({ started: config.label }, null, 2))
      return
    }
    if (command === 'stop') {
      try {
        launchctl(['bootout', domain(config.label)])
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/could not find service|no such process/i.test(error.message)
        )
          throw error
      }
      console.log(JSON.stringify({ stopped: config.label }, null, 2))
      return
    }
    try {
      launchctl(['bootout', domain(config.label)])
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/could not find service|no such process/i.test(error.message)
      )
        throw error
    }
    rmSync(agentPath, { force: true })
    console.log(JSON.stringify({ uninstalled: agentPath }, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

void main()
