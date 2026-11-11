import { expect, test } from 'claude-code/testing'

const result = (context?: string) => JSON.stringify({ outcome: context ? 'clone_missing' : 'already_patched', context })
const notice = '[claude-vscode-activity] Offer to handle the patch after the current task; wait for consent.'

for (const context of [notice, undefined]) {
  test(`first ordinary prompt checks once; later prompts start no process (${context ? 'attention' : 'quiet'})`, async ($, on) => {
    let processes = 0
    on('session.id', () => ({ value: 'session-one' }))
    on('process.run', ($, e) => {
      processes++
      expect(e.argv[0]).toBe('node')
      expect(e.argv[1]).toContain('/hooks/session-check.mjs')
      expect(e.init?.stdin).toBeUndefined()
      expect(e.init?.timeoutMs).toBe(15000)
      return { value: { exitCode: 0, stdout: result(context), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('prompt.submit', ($, e) => ({ text: e.text, context: e.context, origin: e.origin }))
    const first = await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'sdk' }, context: ['existing'] })
    expect(first.text).toBe('hello')
    expect(first.context).toEqual(context ? ['existing', context] : ['existing'])
    for (let i = 0; i < 10; i++) {
      const later = await $.prompt.submit({ text: `normal task ${i}`, wait: false, origin: { kind: 'sdk' } })
      expect(later.text).toBe(`normal task ${i}`)
      expect(later.context).toBeUndefined()
    }
    expect(processes).toBe(1)
  })
}

test('new session ID and module session start each permit a fresh check', async ($, on) => {
  let id = 'one'
  let processes = 0
  on('session.id', () => ({ value: id }))
  on('process.run', () => {
    processes++
    return { value: { exitCode: 0, stdout: result(), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'sdk' } })
  id = 'two'
  await $.prompt.submit({ text: 'new', wait: false, origin: { kind: 'sdk' } })
  await $.session.start({ cwd: '/test', surface: null, isInteractive: false })
  await $.prompt.submit({ text: 'resumed', wait: false, origin: { kind: 'sdk' } })
  expect(processes).toBe(3)
})

test('background notifications do not consume the first user-message check', async ($, on) => {
  let processes = 0
  on('session.id', () => ({ value: 'one' }))
  on('process.run', () => {
    processes++
    return { value: { exitCode: 0, stdout: result(notice), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  await $.prompt.submit({ text: 'background', wait: false, origin: { kind: 'task-notification' }, isMeta: true })
  expect(processes).toBe(0)
  const first = await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'sdk' } })
  expect(first.context).toEqual([notice])
  expect(processes).toBe(1)
})

for (const stdout of ['not json', JSON.stringify({ context: { invalid: true } })]) {
  test(`malformed helper output does not block or rewrite the task (${stdout})`, async ($, on) => {
    let processes = 0
    on('session.id', () => ({ value: 'one' }))
    on('process.run', () => {
      processes++
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
    on('ui.log', () => ({ value: undefined }))
    const first = await $.prompt.submit({ text: 'important task', wait: false, origin: { kind: 'sdk' }, context: ['keep'] })
    expect(first.text).toBe('important task')
    expect(first.context).toEqual(['keep'])
    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'sdk' } })
    expect(processes).toBe(1)
  })
}

test('overlapping prompts share one check and preserve attachments and provenance', async ($, on) => {
  let processes = 0
  let release: (() => void) | undefined
  const checking = new Promise<void>(resolve => { release = resolve })
  on('session.id', () => ({ value: 'one' }))
  on('process.run', async () => {
    processes++
    await checking
    return { value: { exitCode: 0, stdout: result(notice), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const seen: unknown[] = []
  on('prompt.submit', ($, e) => {
    seen.push({ text: e.text, wait: e.wait, origin: e.origin, attachments: e.attachments })
    return { text: e.text, context: e.context, origin: e.origin }
  })
  const prompt = { text: 'first', wait: true, origin: { kind: 'sdk' as const }, attachments: [] }
  const first = $.prompt.submit(prompt)
  const second = $.prompt.submit({ ...prompt, text: 'second' })
  release?.()
  const answers = await Promise.all([first, second])
  expect(processes).toBe(1)
  expect(answers.filter(answer => answer.context?.includes(notice)).length).toBe(1)
  expect(seen).toEqual([
    { text: 'second', wait: true, origin: { kind: 'sdk' }, attachments: [] },
    { text: 'first', wait: true, origin: { kind: 'sdk' }, attachments: [] },
  ])
})

test('helper execution failure does not block the original prompt', async ($, on) => {
  on('session.id', () => ({ value: 'one' }))
  on('process.run', () => ({ deny: 'synthetic process failure' }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('ui.log', () => ({ value: undefined }))
  const first = await $.prompt.submit({ text: 'important task', wait: false, origin: { kind: 'sdk' } })
  expect(first.text).toBe('important task')
})
