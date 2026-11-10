// Check on the first prompt; startup/resume only resets the per-session receipt.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version;

export function runHook(input, { home = os.homedir(), clone, stateDirectory, spawn = spawnSync } = {}) {
  const event = input?.hook_event_name;
  if (!['SessionStart', 'UserPromptSubmit'].includes(event) ||
      typeof input.session_id !== 'string' || !input.session_id || input.session_id.length > 512) return;
  stateDirectory ??= path.join(home, '.claude', 'activity-hook-state');
  const key = createHash('sha256').update(input.session_id).digest('hex');
  const receipt = path.join(stateDirectory, `${key}.json`);
  if (event === 'SessionStart') {
    fs.rmSync(receipt, { force: true });
    return;
  }

  const started = Date.now();
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  if (fs.existsSync(receipt)) {
    let previous;
    try { previous = JSON.parse(fs.readFileSync(receipt, 'utf8')); } catch { /* An interrupted write can be retried. */ }
    if (previous && started - previous.at < (previous.outcome === 'checking' ? 60000 : 7 * 86400000)) return;
    fs.rmSync(receipt, { force: true });
  }
  // Bound only our hashed receipts; never prune arbitrary files from the state directory.
  const records = fs.readdirSync(stateDirectory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .map((name) => ({ file: path.join(stateDirectory, name), at: fs.statSync(path.join(stateDirectory, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const [index, record] of records.entries()) {
    if (index >= 127 || started - record.at > 7 * 86400000) fs.rmSync(record.file, { force: true });
  }
  try {
    fs.writeFileSync(receipt, JSON.stringify({ outcome: 'checking', at: started }), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') return;
    throw error;
  }

  function finish(outcome, detail = '', status = {}) {
    const attention = !['already_patched', 'registry_missing'].includes(outcome);
    fs.writeFileSync(receipt, JSON.stringify({
      version: VERSION, event, at: started, outcome, elapsedMs: Date.now() - started,
      emitted: attention, ...status,
    }) + '\n');
    if (!attention) return;
    return {
      systemMessage: `[claude-vscode-activity] Activity patch needs attention: ${outcome}.`,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `[claude-vscode-activity] Automatic check: ${outcome}. ${detail} ` +
          'In the current reply, even for a greeting or an unrelated request, briefly offer to handle the activity patch ' +
          "in the user's language, then address their message. They do not need to mention the patch. " +
          'Ask once and wait for consent before cloning, applying, restoring, or porting the patch with ' +
          'the claude-vscode-activity skill. Never reload VS Code automatically.',
      },
    };
  }

  if (!fs.existsSync(path.join(home, '.vscode', 'extensions', 'extensions.json'))) return finish('registry_missing');
  clone ??= fs.existsSync('Q:/Code')
    ? path.resolve('Q:/Code/claude-vscode-activity')
    : path.join(home, 'claude-vscode-activity');
  if (!fs.existsSync(path.join(clone, 'patch.mjs'))) return finish('clone_missing', `No working clone at ${clone}.`);

  // Preserve the existing fast-forward update; a network failure must not block checking local files.
  const pull = spawn('git', ['-C', clone, 'pull', '--ff-only', '-q'], { timeout: 5000, stdio: 'ignore' });
  const result = spawn(process.execPath, [path.join(clone, 'patch.mjs'), 'check'], {
    cwd: clone, encoding: 'utf8', timeout: 12000,
  });
  const status = { pullExit: pull.status, checkExit: result.status, checkError: result.error?.code };
  if (result.error) return finish('check_error', `Patch check failed to execute (${result.error.code ?? 'unknown'}).`, status);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status === 0 && output.startsWith('Already patched')) return finish('already_patched', '', status);
  return finish('patch_needs_attention', `Check in ${clone} reported: ${output.slice(0, 2000) || 'no output'}`, status);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = runHook(JSON.parse(fs.readFileSync(0, 'utf8')));
    if (output) console.log(JSON.stringify(output));
  } catch (error) {
    // Never echo stdin: it contains the user's prompt, not just hook metadata.
    console.error(`[claude-vscode-activity] Hook failed (${error.code ?? error.name}).`);
    process.exitCode = 1;
  }
}
