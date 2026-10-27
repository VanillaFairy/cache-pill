import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheHit } from '../types'
import { charge, formatRemaining, monoDigits, pillColor } from './pill'
import { readCache } from './transcript'

const hit = atom({ plugin: 'cache-pill', key: 'hit' } as const, null as CacheHit | null)
const now = atom({ plugin: 'cache-pill', key: 'now' } as const, 0)
const ttl = atom({ plugin: 'cache-pill', key: 'ttlMs' } as const, null as number | null)

/** `$.fs.read` refuses files over 4 MiB; past that only the tail is read. */
const READ_LIMIT = 4 * 1024 * 1024
const TAIL_BYTES = 2 * 1024 * 1024

const TAIL_PS =
  `$f=[IO.File]::Open($env:CACHE_PILL_PATH,'Open','Read','ReadWrite');` +
  `$n=[Math]::Min($f.Length,${TAIL_BYTES});$null=$f.Seek(-$n,'End');` +
  `$b=New-Object byte[] $n;$null=$f.Read($b,0,$n);$f.Close();` +
  `$o=[Console]::OpenStandardOutput();$o.Write($b,0,$n);$o.Flush()`

let transcript: { sessionId: string; path: string } | null = null

async function findTranscript($: EngineInterface): Promise<string | null> {
  const sessionId = await $.session.id()
  if (transcript?.sessionId === sessionId) return transcript.path

  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home && `${home}/.claude`)
  if (!configDir) return null

  const projects = `${configDir}/projects`
  if (!(await $.fs.exists(projects))) return null
  for (const dir of await $.fs.list(projects)) {
    const path = `${projects}/${dir.name}/${sessionId}.jsonl`
    if (dir.kind === 'dir' && (await $.fs.exists(path))) {
      transcript = { sessionId, path }
      return path
    }
  }

  return null
}

async function readTail($: EngineInterface, path: string): Promise<string | null> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const argv = isWindows
    ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', TAIL_PS]
    : ['tail', '-c', String(TAIL_BYTES), path]
  const run = await $.process.run(argv, { env: { CACHE_PILL_PATH: path } })
  if (run.exitCode !== 0 || run.isStdoutTruncated) return null

  // The first line is cut where the tail starts.
  return run.stdout.slice(run.stdout.indexOf('\n') + 1)
}

/** Takes the TTL, and with `isResume` the last refresh time, from the transcript. */
async function refresh($: EngineInterface, isResume: boolean): Promise<void> {
  try {
    await readTranscript($, isResume)
  } catch (error) {
    $.ui.log(`cache-pill: transcript not read: ${String(error)}`, { to: 'debug' })
  }
  await tick($)
}

async function readTranscript($: EngineInterface, isResume: boolean): Promise<void> {
  const path = await findTranscript($)
  if (!path) return
  const { size } = await $.fs.stat(path)
  const text = size <= READ_LIMIT ? await $.fs.read(path) : await readTail($, path)
  if (text === null) return

  const reading = readCache(text)
  if (reading.ttlMs !== null) {
    const ttlMs = reading.ttlMs
    await update($, ttl, () => ttlMs)
  }
  if (isResume && reading.lastAt !== null) {
    const at = reading.lastAt
    await update($, hit, () => ({ at }))
  }
}

async function tick($: EngineInterface): Promise<void> {
  const last = await read($, hit)
  const ttlMs = await read($, ttl)
  const t = await $.clock.now()
  // Stop redrawing once the pill has gone fully red.
  if (last && (ttlMs === null || t - last.at <= ttlMs + 1000)) {
    await update($, now, () => t)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refresh($, true)
    $.clock.every(1000, () => void tick($))

    return started
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    // The new model has no cache entry for this conversation yet.
    await update($, hit, () => null)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage
    if (!e.agentId && usage && usage.cache_read_input_tokens + usage.cache_creation_input_tokens > 0) {
      const t = await $.clock.now()
      await update($, hit, () => ({ at: t }))
      await update($, now, () => t)
      // The engine appends the response to the transcript after the step returns.
      if (usage.cache_creation_input_tokens > 0) $.clock.after(1000, () => void refresh($, false))
    }

    return result
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const last = await read($, hit)
    const ttlMs = await read($, ttl)
    const t = await read($, now)

    const fraction = last && ttlMs !== null ? charge(last.at, ttlMs, t) : 0
    const color = last && ttlMs !== null ? pillColor(fraction) : '#6b6b6b'
    const state = !last
      ? '–'
      : ttlMs === null
        ? '?'
        : fraction > 0
          ? formatRemaining(last.at + ttlMs - t)
          : 'cold'
    const label = `Cache: ${state}`
    const modes = e.props.modes.join(' & ')

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="row" gap={1}>
          {modes && <Text dimColor>{modes}</Text>}
          <Text color="black" backgroundColor={color} bold>
            {` ${label} `}
          </Text>
        </Box>
      )
    }

    // The desktop footer draws text only (color and backgroundColor; no Box paint, no Svg),
    // spaces Text siblings apart and trims every Unicode space, so the badge is one Text
    // padded with no-break spaces that zero-width spaces (not whitespace to trim) shield.
    // Its font's digits are proportional; monospace digits keep the width fixed as it counts.
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" alignItems="center">
        {modes && <Text dimColor>{modes}</Text>}
        <Text color="black" backgroundColor={color} bold>
          {`\u200b\u00a0${monoDigits(label)}\u00a0\u200b`}
        </Text>
      </Box>
    )
  })
}
