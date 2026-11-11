import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { claudeLocalActivitySummary as summarize } from './activity.mjs';
import { componentSource, digest, patchBundle, run } from './patch.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const signal = (value) => ({ value });
function session(overrides = {}) {
  return {
    visiblyBusy: signal(false), pendingInput: signal(false),
    permissionRequests: signal([]), userDialogRequests: signal([]),
    context: { hostUnresponsive: signal(false) }, heldElsewhere: signal(false),
    agentMapAgents: signal(new Map()), backgroundTasks: signal(new Map()),
    backgroundTaskOutcomes: signal(new Map()), ...overrides,
  };
}

const cases = [
  ['idle session', {}, 0, 'idle', 'Main idle · Subagents 0 · Background 0', 'idle'],
  ['main assistant working without subagents', { visiblyBusy: signal(true) }, 0, 'idle',
    'Main working · Subagents 0 · Background 0', 'running'],
  ['main assistant waiting for permission', { permissionRequests: signal([{}]) }, 0, 'idle',
    'Main waiting for permission · Subagents 0 · Background 0', 'waiting'],
  ['main assistant waiting for a question', { userDialogRequests: signal([{}]) }, 0, 'idle',
    'Main waiting for input · Subagents 0 · Background 0', 'waiting'],
  ['reported pending input', { visiblyBusy: signal(true), pendingInput: signal(true) }, 0, 'idle',
    'Main waiting for input · Subagents 0 · Background 0', 'waiting'],
  ['subagent permission does not relabel the main assistant', {
    visiblyBusy: signal(true), permissionRequests: signal([{ agentId: 'child' }]),
  }, 1, 'waiting', 'Main working · Subagents 1 · Background 0', 'waiting'],
  ['subagent question does not relabel the main assistant', {
    userDialogRequests: signal([{ agentId: 'child' }]),
  }, 1, 'running', 'Main idle · Subagents 1 · Background 0', 'waiting'],
  ['parallel subagents', {}, 3, 'running', 'Main idle · Subagents 3 · Background 0', 'running'],
  ['background shell with idle main assistant', {
    backgroundTasks: signal(new Map([['shell', { taskType: 'local_bash' }]])),
  }, 0, 'idle', 'Main idle · Subagents 0 · Background 1', 'running'],
  ['background monitors and workflows', {
    backgroundTasks: signal(new Map([
      ['monitor', { taskType: 'monitor' }], ['workflow', { taskType: 'local_workflow' }],
    ])),
  }, 0, 'idle', 'Main idle · Subagents 0 · Background 2', 'running'],
  ['exclude completed tasks and duplicate agents', {
    backgroundTasks: signal(new Map([
      ['done', { taskType: 'local_bash' }], ['agent', { taskType: 'local_agent' }],
      ['duplicate', { taskType: 'unknown' }], ['live', { taskType: 'local_bash' }],
    ])),
    backgroundTaskOutcomes: signal(new Map([['done', 'finished']])),
    agentMapAgents: signal(new Map([['duplicate', { status: 'working' }]])),
  }, 1, 'running', 'Main idle · Subagents 1 · Background 1', 'running'],
  ['history of failure remains visible when idle', {}, 0, 'failed',
    'Main idle · Subagents 0 · Background 0', 'failed'],
  ['current work takes precedence over past failure', { visiblyBusy: signal(true) }, 0, 'failed',
    'Main working · Subagents 0 · Background 0', 'running'],
  ['unresponsive connection is not shown as idle', {
    context: { hostUnresponsive: signal(true) },
  }, 0, 'idle', 'Main connection unresponsive · Subagents 0 · Background 0', 'failed'],
  ['session held in another window', { heldElsewhere: signal(true) }, 0, 'idle',
    'Main active in another window · Subagents 0 · Background 0', 'idle'],
];

for (const [name, overrides, count, agentDot, label, dot] of cases) {
  test(name, () => {
    const result = summarize(session(overrides), count, agentDot);
    assert.equal(result.label, label);
    assert.equal(result.dot, dot);
    assert.match(result.title, /Click to open the agent map/);
    assert.doesNotMatch(result.label + result.title, /\p{Script=Han}/u);
    assert.deepEqual(result.sections.map((section) => section.kind), ['main', 'subagents', 'background']);
    assert.equal(result.sections.map((section) => section.label).join(' · '), label);
  });
}

test('idle main dot stays grey when subagents and background tasks are running', () => {
  const state = session({
    backgroundTasks: signal(new Map([['shell', { taskType: 'local_bash' }]])),
  });
  const result = summarize(state, 1, 'running');
  assert.deepEqual(result.sections.map((section) => section.state), ['idle', 'running', 'running']);
  assert.equal(result.dot, 'running');
});

test('only the main dot becomes active when the main assistant works', () => {
  const result = summarize(session({ visiblyBusy: signal(true) }), 0, 'idle');
  assert.deepEqual(result.sections.map((section) => section.state), ['running', 'idle', 'idle']);
});

test('subagent permission and question waits do not color the main dot', () => {
  for (const kind of ['permissionRequests', 'userDialogRequests']) {
    const result = summarize(session({ [kind]: signal([{ agentId: 'child' }]) }), 1,
      kind === 'permissionRequests' ? 'waiting' : 'running');
    assert.deepEqual(result.sections.map((section) => section.state), ['idle', 'waiting', 'idle']);
  }
});

test('main permission wait does not color other sections', () => {
  const result = summarize(session({ permissionRequests: signal([{}]) }), 0, 'idle');
  assert.deepEqual(result.sections.map((section) => section.state), ['waiting', 'idle', 'idle']);
});

test('main connection failure and subagent failure remain separate', () => {
  const mainFailed = summarize(session({ context: { hostUnresponsive: signal(true) } }), 0, 'idle');
  assert.deepEqual(mainFailed.sections.map((section) => section.state), ['failed', 'idle', 'idle']);
  const childFailed = summarize(session(), 0, 'failed');
  assert.deepEqual(childFailed.sections.map((section) => section.state), ['idle', 'failed', 'idle']);
});

test('signal changes are read afresh instead of cached', () => {
  const state = session();
  assert.equal(summarize(state, 0, 'idle').dot, 'idle');
  state.visiblyBusy.value = true;
  assert.equal(summarize(state, 0, 'idle').dot, 'running');
  state.permissionRequests.value = [{}];
  assert.equal(summarize(state, 0, 'idle').dot, 'waiting');
  state.permissionRequests.value = [];
  state.visiblyBusy.value = false;
  state.backgroundTasks.value = new Map([['shell', { taskType: 'local_bash' }]]);
  assert.equal(summarize(state, 0, 'idle').dot, 'running');
  state.backgroundTaskOutcomes.value = new Map([['shell', 'finished']]);
  assert.equal(summarize(state, 0, 'idle').dot, 'idle');
});

function installedOriginal(version) {
  const extensionRoot = process.env.CLAUDE_VSCODE_TEST_EXTENSIONS ?? path.join(os.homedir(), '.vscode', 'extensions');
  const directory = path.join(extensionRoot, `anthropic.claude-code-${version}-win32-x64`);
  const bundle = path.join(directory, 'webview', 'index.js');
  if (!fs.existsSync(bundle)) return null;
  const installed = fs.readFileSync(bundle, 'utf8');
  if (!installed.includes('/* claude-vscode-activity:v1 */')) return installed;
  const key = digest(fs.realpathSync(directory).toLowerCase()).slice(0, 12);
  const backupRoot = process.env.CLAUDE_VSCODE_TEST_BACKUPS ?? path.join(ROOT, 'backups');
  const backup = path.join(backupRoot, `${version}-${key}`, 'index.js.original');
  return fs.existsSync(backup) ? fs.readFileSync(backup, 'utf8') : null;
}

for (const [version, name, pill] of [
  ['2.1.312', 'Dy0', 'Nv5'], ['2.1.314', 'NMt', 'SNn'], ['2.1.317', 'GMt', 'GNn'],
  ['2.1.318', 'XMt', 'QNn'],
]) {
  test(`${version}: patch parses and preserves the task-map click handler`, (t) => {
    const original = installedOriginal(version);
    if (original === null) {
      t.skip(`Local ${version} original bundle is unavailable; proprietary fixtures are not distributed.`);
      return;
    }
    const patched = patchBundle(original, version);
    assert.notEqual(patched, original);
    if (version === '2.1.317') {
      assert.ok(patched.includes(',tt=l!==void 0,') && !patched.includes('De.size>0'), 'pill shown without subagents');
    }
    if (version === '2.1.318') {
      assert.ok(patched.includes(',Ye=l!==void 0,') && !patched.includes('Ie.size>0'), 'pill shown without subagents');
    }
    const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], {
      input: patched, encoding: 'utf8',
    });
    assert.equal(syntax.status, 0, syntax.stderr);

    const create = (type, props) => ({ type, props });
    const noOp = () => {};
    const count = (agents) => [...agents.values()].filter((agent) => agent.status === 'working').length;
    const waiting = (requests) => new Set(requests.map((request) => request.agentId));
    const dot = () => 'idle';
    const render = new Function(
      'claudeLocalActivitySummary', 'f0', 'Dt', 'F', 'm', 'ol', 'j$', 'Z$', 'X$', 'jR', 'f8', 'm8', 'fc1', 'sVe', 'mVe', 'vVe', pill,
      `${componentSource(patched, name)};return ${name};`,
    )(summarize, noOp, noOp, create, create, count, count, count, count, waiting, waiting, waiting, dot, dot, dot, dot, 'pill');
    const onOpen = () => 'map opened';
    const rendered = render({ session: session({ visiblyBusy: signal(true) }), onOpen });
    assert.equal(rendered.props.activity.label, 'Main working · Subagents 0 · Background 0');
    assert.equal(rendered.props.dot, 'running');
    assert.equal(rendered.props.onOpen, onOpen);
    assert.equal(rendered.props.onOpen(), 'map opened');

    const renderPill = new Function(
      'R', 'k', 'F', 'm', 'r7', 'Zs', 'ea', 'Qs', 'Ym', 'tU', 'oU', 'rU', 'W91', 'tle', 'qY', 'df', 'ff', 'hf',
      `${componentSource(patched, pill)};return ${pill};`,
    )(create, create, create, create, {}, {}, {}, {}, {}, {}, {}, {}, noOp, noOp, noOp, noOp, noOp, noOp);
    const button = renderPill(rendered.props);
    assert.equal(button.type, 'button');
    assert.equal(button.props.onClick, onOpen);
    assert.match(button.props['aria-label'], /Main working/);
    assert.equal(button.props['data-agents-dot'], 'running');
    assert.equal(button.props.children.length, 3);
    assert.deepEqual(button.props.children.map((section) => section.props['data-activity-section']),
      ['main', 'subagents', 'background']);
    const states = (tree) => tree.props.children.map((section) => section.props.children[1].props.state);
    assert.deepEqual(states(button), ['running', 'idle', 'idle']);
    assert.deepEqual(button.props.children.map((section) => section.props.children[2].props.children),
      ['Main working', 'Subagents 0', 'Background 0']);
    assert.ok(button.props.children.every((section) => section.props.style.display === 'inline-flex'));

    const backgroundOnly = renderPill({ onOpen, activity: summarize(session({
      backgroundTasks: signal(new Map([['shell', { taskType: 'local_bash' }]])),
    }), 0, 'idle') });
    assert.deepEqual(states(backgroundOnly), ['idle', 'idle', 'running']);
    const idleMain = renderPill({ onOpen, activity: summarize(session({
      backgroundTasks: signal(new Map([['shell', { taskType: 'local_bash' }]])),
    }), 1, 'running') });
    assert.deepEqual(states(idleMain), ['idle', 'running', 'running']);
    assert.throws(() => patchBundle(patched, version), /Already patched/);
    assert.throws(() => patchBundle(original + ' ', version), /fingerprint/);
  });
}

test('unknown version is refused without modification', () => {
  assert.throws(() => patchBundle('unchanged', '9.9.9'), /Unsupported/);
});

for (const version of ['2.1.314', '2.1.318']) {
  test(`${version}: apply, repeat apply, guarded restore, and exact restore`, (t) => {
    const original = installedOriginal(version);
    if (original === null) {
      t.skip(`Local ${version} original bundle is unavailable; proprietary fixtures are not distributed.`);
      return;
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-activity-test-'));
    const extension = path.join(temporary, 'extension');
    fs.mkdirSync(path.join(extension, 'webview'), { recursive: true });
    const key = digest(fs.realpathSync(extension).toLowerCase()).slice(0, 12);
    const backupDirectory = path.join(ROOT, 'backups', `${version}-${key}`);
    try {
      fs.writeFileSync(path.join(extension, 'package.json'), JSON.stringify({
        publisher: 'Anthropic', name: 'claude-code', version,
      }));
      const target = path.join(extension, 'webview', 'index.js');
      fs.writeFileSync(target, original);
      run('check', extension);
      assert.equal(fs.readFileSync(target, 'utf8'), original);
      run('apply', extension);
      const patched = fs.readFileSync(target, 'utf8');
      assert.equal(patched, patchBundle(original, version));
      assert.equal(fs.readFileSync(path.join(backupDirectory, 'index.js.original'), 'utf8'), original);
      run('apply', extension);
      assert.equal(fs.readFileSync(target, 'utf8'), patched);
      fs.writeFileSync(target, patched + '\n// concurrent edit');
      assert.throws(() => run('restore', extension), /refusing to overwrite/);
      assert.equal(fs.readFileSync(target, 'utf8'), patched + '\n// concurrent edit');
      fs.writeFileSync(target, patched);
      run('restore', extension);
      assert.equal(fs.readFileSync(target, 'utf8'), original);
      run('restore', extension);
    } finally {
      // These are only directories created by this test, never installed extension files.
      fs.rmSync(temporary, { recursive: true, force: true });
      fs.rmSync(backupDirectory, { recursive: true, force: true });
    }
  });
}
