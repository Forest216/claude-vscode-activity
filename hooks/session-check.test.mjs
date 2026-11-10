import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const { runHook } = await import('./session-check.mjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-hook-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const clone = path.join(root, 'clone');
  const stateDirectory = path.join(root, 'state');
  fs.mkdirSync(path.join(home, '.vscode', 'extensions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.vscode', 'extensions', 'extensions.json'), '[]');
  const calls = [];
  const input = { hook_event_name: 'UserPromptSubmit', session_id: 'private-test-session', prompt: 'hello' };
  const options = {
    home, clone, stateDirectory,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: 'Already patched and verified: local extension', stderr: '' };
    },
  };
  const hook = (payload = input) => {
    return runHook(payload, options);
  };
  const receipt = path.join(stateDirectory, createHash('sha256').update(input.session_id).digest('hex') + '.json');
  const installClone = () => {
    fs.mkdirSync(clone);
    fs.writeFileSync(path.join(clone, 'patch.mjs'), '// Never executed by this test.');
  };
  return { home, clone, stateDirectory, calls, input, options, hook, receipt, installClone };
}

test('first ordinary hello requests an offer in the current reply, without cloning', (t) => {
  const f = fixture(t);
  const output = f.hook();
  assert.match(output.systemMessage, /activity/i);
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(output.hookSpecificOutput.additionalContext, /current reply/i);
  assert.match(output.hookSpecificOutput.additionalContext, /consent/i);
  assert.equal(f.calls.length, 0);
  assert.equal(fs.existsSync(f.clone), false);
  assert.equal(JSON.parse(fs.readFileSync(f.receipt)).outcome, 'clone_missing');
  assert.doesNotMatch(fs.readFileSync(f.receipt, 'utf8'), /hello|private-test-session/);
});

test('a second prompt in the same session neither checks nor offers again', (t) => {
  const f = fixture(t);
  f.hook();
  assert.equal(f.hook({ ...f.input, prompt: 'another message' }), undefined);
  assert.equal(f.calls.length, 0);
});

test('session start resets the receipt so resuming the same session checks again', (t) => {
  const f = fixture(t);
  f.hook();
  assert.equal(f.hook({ hook_event_name: 'SessionStart', source: 'resume', session_id: f.input.session_id }), undefined);
  assert.equal(fs.existsSync(f.receipt), false);
  assert.ok(f.hook()?.hookSpecificOutput);
});

test('a verified patch is quiet and checked once, using bounded read-only patch check', (t) => {
  const f = fixture(t);
  f.installClone();
  assert.equal(f.hook(), undefined);
  assert.equal(f.hook(), undefined);
  assert.deepEqual(f.calls.map(({ args }) => args), [
    ['-C', f.clone, 'pull', '--ff-only', '-q'],
    [path.join(f.clone, 'patch.mjs'), 'check'],
  ]);
  assert.deepEqual(f.calls.map(({ options }) => options.timeout), [5000, 12000]);
  assert.equal(JSON.parse(fs.readFileSync(f.receipt)).outcome, 'already_patched');
});

for (const result of [
  { status: 0, stdout: 'Compatible: Claude Code test-version' },
  { status: 1, stderr: 'Unsupported extension version test-version; no files changed.' },
  { status: 1, stderr: 'Patched by an older version of this script: run restore, then apply.' },
  { status: null, error: Object.assign(new Error('sensitive error details'), { code: 'ETIMEDOUT' }) },
]) {
  test(`attention output for check result ${result.status}: ${result.error?.code ?? result.stdout ?? result.stderr}`, (t) => {
    const f = fixture(t);
    f.installClone();
    f.options.spawn = (command, args) => args[0] === '-C' ? { status: 0 } : result;
    const output = f.hook();
    assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(output.hookSpecificOutput.additionalContext, /current reply/i);
    assert.doesNotMatch(JSON.stringify(output), /sensitive error details/);
    assert.equal(f.hook(), undefined);
  });
}

test('missing registry is explicitly recorded as skipped, not reported as installed', (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.home, '.vscode', 'extensions', 'extensions.json'));
  assert.equal(f.hook(), undefined);
  assert.equal(JSON.parse(fs.readFileSync(f.receipt)).outcome, 'registry_missing');
});

test('an active claim prevents duplicate work; a stale interrupted claim retries', (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.stateDirectory);
  fs.writeFileSync(f.receipt, JSON.stringify({ outcome: 'checking', at: Date.now() }));
  assert.equal(f.hook(), undefined);
  fs.writeFileSync(f.receipt, JSON.stringify({ outcome: 'checking', at: Date.now() - 60000 }));
  assert.ok(f.hook()?.hookSpecificOutput);
});

test('invalid events or missing session IDs have no filesystem or subprocess effects', (t) => {
  const f = fixture(t);
  for (const payload of [{}, { ...f.input, session_id: '' }, { ...f.input, hook_event_name: 'Stop' }]) {
    assert.equal(f.hook(payload), undefined);
  }
  assert.equal(fs.existsSync(f.stateDirectory), false);
  assert.equal(f.calls.length, 0);
});

test('hook state stays bounded and does not remove unrelated files', (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.stateDirectory);
  fs.writeFileSync(path.join(f.stateDirectory, 'keep.txt'), 'unrelated');
  for (let i = 0; i < 130; i++) {
    fs.writeFileSync(path.join(f.stateDirectory, i.toString(16).padStart(64, '0') + '.json'), '{}');
  }
  f.hook();
  assert.ok(fs.readdirSync(f.stateDirectory).filter((file) => file.endsWith('.json')).length <= 128);
  assert.equal(fs.readFileSync(path.join(f.stateDirectory, 'keep.txt'), 'utf8'), 'unrelated');
});

test('actual hook executable consumes stdin without logging the prompt', (t) => {
  const f = fixture(t);
  // Avoid the machine's Q: clone: no registry means no subprocess or network access.
  fs.unlinkSync(path.join(f.home, '.vscode', 'extensions', 'extensions.json'));
  const copied = path.join(f.home, 'plugin');
  fs.mkdirSync(path.join(copied, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(copied, '.claude-plugin'));
  fs.copyFileSync(path.join(ROOT, 'session-check.mjs'), path.join(copied, 'hooks', 'session-check.mjs'));
  fs.copyFileSync(path.join(ROOT, '..', '.claude-plugin', 'plugin.json'), path.join(copied, '.claude-plugin', 'plugin.json'));
  const result = spawnSync(process.execPath, [path.join(copied, 'hooks', 'session-check.mjs')], {
    input: JSON.stringify(f.input), encoding: 'utf8', cwd: f.home,
    env: { ...process.env, USERPROFILE: f.home, HOME: f.home },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, '');
  const receipt = fs.readFileSync(path.join(f.home, '.claude', 'activity-hook-state', path.basename(f.receipt)), 'utf8');
  assert.doesNotMatch(receipt, /hello|private-test-session/);
});

test('plugin checks at prompt submission; startup and resume only reset state', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks.json'), 'utf8'));
  const reset = config.hooks.SessionStart[0];
  for (const source of ['startup', 'resume', 'clear']) assert.match(source, new RegExp(reset.matcher));
  const submit = config.hooks.UserPromptSubmit[0];
  assert.equal(submit.hooks[0].type, 'command');
  assert.equal(submit.hooks[0].async, undefined);
  assert.equal(submit.hooks[0].once, undefined, 'plugin once is not a supported session guard');
});
