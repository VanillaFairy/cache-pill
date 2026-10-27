import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { charge, formatRemaining, monoDigits, pillColor } from '../hooks/pill'
import { readCache } from '../hooks/transcript'

const HOUR = 60 * 60_000
const LAST = '2026-10-15T11:29:14.336Z'

function assistant(split: { m5: number; h1: number }, extra: object = {}): string {
  return JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    timestamp: LAST,
    message: {
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: split.m5 + split.h1,
        cache_read_input_tokens: 115863,
        output_tokens: 556,
        cache_creation: { ephemeral_1h_input_tokens: split.h1, ephemeral_5m_input_tokens: split.m5 },
      },
    },
    ...extra,
  })
}

const MAIN_1H = [
  JSON.stringify({ type: 'user', message: { content: 'hi' } }),
  assistant({ m5: 0, h1: 1654 }),
  // A subagent's 5m write, relayed as progress and as a sidechain entry, is not the main cache.
  JSON.stringify({ type: 'progress', data: { message: JSON.parse(assistant({ m5: 900, h1: 0 })) } }),
  assistant({ m5: 900, h1: 0 }, { isSidechain: true }),
].join('\n')

test('the TTL and last refresh come from the newest main-thread write', async () => {
  expect(readCache(MAIN_1H)).toEqual({ ttlMs: HOUR, lastAt: Date.parse(LAST) })
  expect(readCache(assistant({ m5: 10, h1: 1654 })).ttlMs).toBe(5 * 60_000)
  expect(readCache(JSON.stringify({ type: 'user' }))).toEqual({ ttlMs: null, lastAt: null })
})

test('color is green, amber under 20% left, orange-red when cold; the countdown shows whole minutes in monospace digits', async () => {
  expect(pillColor(1)).toBe('#7cb342')
  expect(pillColor(0.2)).toBe('#7cb342')
  expect(pillColor(0.19)).toBe('#e0a800')
  expect(pillColor(0)).toBe('#d9482b')
  expect(charge(0, HOUR, HOUR / 2)).toBe(0.5)
  expect(formatRemaining(272_400)).toBe('5m left')
  expect(formatRemaining(60_000)).toBe('1m left')
  expect([...monoDigits('59m left')].length).toBe(8)
  expect(monoDigits('09').codePointAt(0)).toBe(0x1d7f6)
})

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }
const ID = 'abc'
const PATH = `C:/Users/u/.claude/projects/C--w/${ID}.jsonl`

/** The engine beneath the plugin: a home folder holding this session's transcript. */
function engine(on: On, files: Record<string, string>) {
  const slash = (path: string) => path.replaceAll('\\', '/')
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: ID }))
  on('env.get', (_$, e) => ({ value: (({ USERPROFILE: 'C:/Users/u', OS: 'Windows_NT' }) as Record<string, string>)[e.name] }))
  on('fs.exists', (_$, e) => ({ value: slash(e.path) === 'C:/Users/u/.claude/projects' || slash(e.path) in files }))
  on('fs.list', () => ({
    value: [
      { name: 'C--other', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'C--w', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.stat', (_$, e) => ({ value: { kind: 'file', size: files[slash(e.path)]!.length, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$, e) => ({ value: files[slash(e.path)]! }))
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { model: e.model, input_tokens: 2, output_tokens: 5, cache_read_input_tokens: 5000, cache_creation_input_tokens: 1654 },
    } as const
  })
}

const fromMono = (text: string) =>
  [...text].map(c => (c.codePointAt(0)! >= 0x1d7f6 && c.codePointAt(0)! <= 0x1d7ff ? String(c.codePointAt(0)! - 0x1d7f6) : c)).join('')

/** The pill's label, digits read back as ASCII: the bold Text on both surfaces. */
async function pillLabel(ui: { findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }) {
  return (await ui.findAll({ type: 'Text' })).filter(t => t.props.bold).map(t => fromMono(t.text.replaceAll('\u200b', '').trim()))[0]
}

for (const surface of ['terminal', 'desktop'] as const) {
  const target = { plugin: 'cache-pill', surface, component: 'SessionMode', props: { modes: ['focus'] } } as const

  test(`${surface}: a resumed session counts down from the transcript's last write`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse(LAST) + 10 * 60_000 })
    engine(on, { [PATH]: MAIN_1H })
    await $.session.start({ cwd: 'C:/w', surface, isInteractive: true })

    const ui = await $.ui.mount(target)
    expect(await pillLabel(ui)).toBe('Cache: 50m left')
    expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()

    await clock.advance(50 * 60_000)
    expect(await pillLabel(ui)).toBe('Cache: cold')
  })

  test(`${surface}: with no write on record the pill waits for the transcript`, async ($, on) => {
    const files: Record<string, string> = { [PATH]: JSON.stringify({ type: 'user' }) }
    const clock = mock.clock(on, { now: 1_000_000 })
    engine(on, files)
    await $.session.start({ cwd: 'C:/w', surface, isInteractive: true })

    const ui = await $.ui.mount(target)
    expect(await pillLabel(ui)).toBe('Cache: –')

    for await (const _ of $.turn.step(STEP)) {
      // drain the stream
    }
    expect(await pillLabel(ui)).toBe('Cache: ?')

    files[PATH] = assistant({ m5: 0, h1: 1654 })
    await clock.advance(1000)
    expect(await pillLabel(ui)).toBe('Cache: 60m left')
  })
}
