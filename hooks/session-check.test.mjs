import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as checker from './session-check.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-check-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const clone = path.join(root, 'clone');
  fs.mkdirSync(path.join(home, '.vscode', 'extensions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.vscode', 'extensions', 'extensions.json'), '[]');
  const calls = [];
  const options = {
    home, clone,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: 'Already patched and verified: local extension', stderr: '' };
    },
  };
  const check = () => {
    assert.equal(typeof checker.checkActivity, 'function', 'local checker no longer needs prompt or disk session receipts');
    return checker.checkActivity(options);
  };
  const installClone = () => {
    fs.mkdirSync(clone);
    fs.writeFileSync(path.join(clone, 'patch.mjs'), '// Not executed by this test.');
  };
  return { home, clone, calls, options, check, installClone };
}

test('missing clone offers help after the current task and makes no changes', (t) => {
  const f = fixture(t);
  const output = f.check();
  assert.equal(output.outcome, 'clone_missing');
  assert.match(output.context, /after.*task/i);
  assert.match(output.context, /consent/i);
  assert.equal(fs.existsSync(f.clone), false);
  assert.equal(fs.existsSync(path.join(f.home, '.claude')), false);
  assert.equal(f.calls.length, 0);
});

test('verified patch returns quiet JSON and only executes a bounded local check', (t) => {
  const f = fixture(t);
  f.installClone();
  assert.deepEqual(f.check(), { outcome: 'already_patched' });
  assert.deepEqual(f.calls.map(({ args }) => args), [[path.join(f.clone, 'patch.mjs'), 'check']]);
  assert.equal(f.calls[0].options.timeout, 12000);
  assert.equal(fs.existsSync(path.join(f.home, '.claude')), false);
});

for (const result of [
  { status: 0, stdout: 'Compatible: Claude Code test-version' },
  { status: 1, stderr: 'Unsupported extension version test-version; no files changed.' },
  { status: 1, stderr: 'Patched by an older version of this script: run restore, then apply.' },
]) {
  test(`attention for ${result.stdout ?? result.stderr}`, (t) => {
    const f = fixture(t);
    f.installClone();
    f.options.spawn = () => result;
    const output = f.check();
    assert.equal(output.outcome, 'patch_needs_attention');
    assert.match(output.context, /consent/i);
    assert.ok(output.context.includes(result.stdout ?? result.stderr));
  });
}

test('timeout reports an error without exposing exception content', (t) => {
  const f = fixture(t);
  f.installClone();
  f.options.spawn = () => ({ status: null, error: Object.assign(new Error('private-error-details'), { code: 'ETIMEDOUT' }) });
  const output = f.check();
  assert.equal(output.outcome, 'check_error');
  assert.match(output.context, /ETIMEDOUT/);
  assert.doesNotMatch(JSON.stringify(output), /private-error-details/);
});

test('missing registry is skipped without reading the clone or launching a process', (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.home, '.vscode', 'extensions', 'extensions.json'));
  assert.deepEqual(f.check(), { outcome: 'registry_missing' });
  assert.equal(f.calls.length, 0);
});

test('executable needs no prompt stdin and writes no per-session files', (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.home, '.vscode', 'extensions', 'extensions.json'));
  const result = spawnSync(process.execPath, [path.join(ROOT, 'session-check.mjs')], {
    input: '', encoding: 'utf8', env: { ...process.env, USERPROFILE: f.home, HOME: f.home }, cwd: f.home,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { outcome: 'registry_missing' });
  assert.equal(fs.existsSync(path.join(f.home, '.claude')), false);
});

test('plugin uses only the in-process module, with no classic command hooks', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks.json'), 'utf8'));
  assert.deepEqual(config.modules, ['./register.ts']);
  assert.ok(!config.hooks || Object.keys(config.hooks).length === 0);
});
