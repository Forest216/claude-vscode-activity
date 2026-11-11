// One local check; the in-process module owns per-session deduplication.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkActivity({ home = os.homedir(), clone, spawn = spawnSync } = {}) {
  function attention(outcome, detail) {
    return {
      outcome,
      context: `[claude-vscode-activity] Automatic local check: ${outcome}. ${detail} ` +
        "After addressing the user's current task, briefly offer to handle the activity patch in their language. " +
        'They do not need to mention the patch. Ask once and wait for consent before cloning, applying, restoring, ' +
        'or porting the patch with the claude-vscode-activity skill. Never reload VS Code automatically.',
    };
  }
  if (!fs.existsSync(path.join(home, '.vscode', 'extensions', 'extensions.json'))) return { outcome: 'registry_missing' };
  clone ??= fs.existsSync('Q:/Code')
    ? path.resolve('Q:/Code/claude-vscode-activity')
    : path.join(home, 'claude-vscode-activity');
  if (!fs.existsSync(path.join(clone, 'patch.mjs'))) return attention('clone_missing', `No working clone at ${clone}.`);

  const result = spawn(process.execPath, [path.join(clone, 'patch.mjs'), 'check'], {
    cwd: clone, encoding: 'utf8', timeout: 12000,
  });
  if (result.error) return attention('check_error', `Patch check failed to execute (${result.error.code ?? 'unknown'}).`);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status === 0 && output.startsWith('Already patched')) return { outcome: 'already_patched' };
  return attention('patch_needs_attention', `Check in ${clone} reported: ${output.slice(0, 2000) || 'no output'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(checkActivity()));
  } catch (error) {
    console.error(`[claude-vscode-activity] Check failed (${error.code ?? error.name}).`);
    process.exitCode = 1;
  }
}
