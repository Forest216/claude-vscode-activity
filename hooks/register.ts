import type { Register } from 'claude-code'

export const register: Register = on => {
  let checkedSession: string | undefined

  on('session.start', ($, e, next) => {
    checkedSession = undefined
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta || !['composer', 'bridge', 'sdk', 'unclassified'].includes(e.origin.kind)) return next(e)
    const session = await $.session.id()
    if (checkedSession === session) return next(e)
    // Claim before awaiting the check, so a queued prompt cannot start another process.
    checkedSession = session
    let context: string | undefined
    try {
      const result = await $.process.run(['node', `${$.plugin.root}/hooks/session-check.mjs`], {
        cwd: $.plugin.root,
        timeoutMs: 15000,
      })
      if (result.exitCode !== 0 || result.isStdoutTruncated) throw new Error('check failed')
      const output = JSON.parse(result.stdout)
      if (output.context !== undefined && (typeof output.context !== 'string' || output.context.length > 5000)) {
        throw new Error('invalid check output')
      }
      context = output.context
    } catch {
      $.ui.log('Activity patch check failed; the task is unchanged.', { to: 'debug' })
    }
    return next(context ? { ...e, context: [...(e.context ?? []), context] } : e)
  }).catch(($, e, next) => next(e))
}
