// SessionStart: report only when the activity patch is missing or needs work; silent otherwise.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const registry = path.join(os.homedir(), '.vscode', 'extensions', 'extensions.json');
if (!fs.existsSync(registry)) process.exit(0); // no VS Code extensions on this machine

const clone = fs.existsSync('Q:/Code')
  ? path.resolve('Q:/Code/claude-vscode-activity')
  : path.join(os.homedir(), 'claude-vscode-activity');
const note = (text) => console.log(`[claude-vscode-activity] ${text} ` +
  'Ask the user once, early in this session, whether to handle it with the claude-vscode-activity skill. ' +
  'Do not patch, clone, or reload VS Code without their yes.');

if (!fs.existsSync(path.join(clone, 'patch.mjs'))) {
  note(`The VS Code activity indicator patch is not set up on this machine (no working clone at ${clone}).`);
  process.exit(0);
}
const result = spawnSync(process.execPath, [path.join(clone, 'patch.mjs'), 'check'], {
  cwd: clone, encoding: 'utf8', timeout: 12000,
});
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
if (result.status === 0 && output.startsWith('Already patched')) process.exit(0);
note(`patch.mjs check in ${clone} reported: ${output || result.error?.message || 'no output'}`);
