import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeLocalActivitySummary } from './activity.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MARKER = '/* claude-vscode-activity:v1 */';
const SUPPORTED = {
  '2.1.312': {
    hash: '73ad1a2b1f006dc315c4e78dedf8c3a488f36e7fd5c9231ed26e55902da46785',
    component: 'Dy0', pill: 'Nv5', session: '$', open: 'J', hook: 'f0',
    create: 'F', container: 'R', count: 'ol', waiting: 'jR', dot: 'fc1',
    styles: 'r7', pillStyles: 'Ym', statusDot: 'qY',
  },
  '2.1.314': {
    hash: 'ef7910d63f3a0ae3e9bbf5d238c73c19fab8704363d7a07edab2157f10611e6d',
    component: 'NMt', pill: 'SNn', session: 'e', open: 't', hook: 'Dt',
    create: 'm', container: 'k', count: 'j$', waiting: 'f8', dot: 'sVe',
    styles: 'Zs', pillStyles: 'tU', statusDot: 'df',
  },
  '2.1.317': {
    hash: '3f17c05525aaf248356a16019071dc2b58dec52a92540f715f26eb461639f77e',
    component: 'GMt', pill: 'GNn', session: 'e', open: 't', hook: 'Dt',
    create: 'm', container: 'k', count: 'Z$', waiting: 'f8', dot: 'mVe',
    styles: 'ea', pillStyles: 'oU', statusDot: 'ff',
    // The footer hides the pill until a subagent exists; keep it visible so Main/Background show too.
    alwaysShow: [',tt=l!==void 0&&De.size>0,', ',tt=l!==void 0,'],
  },
};

export const digest = (content) => createHash('sha256').update(content).digest('hex');

// Both supported bundles put these two small component functions next to one another.
export function componentSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0 || source.indexOf(`function ${name}(`, start + 1) >= 0) {
    throw new Error(`Expected one component named ${name}.`);
  }
  const end = source.indexOf('function ', start + 9);
  if (end < 0) throw new Error(`Cannot locate the end of ${name}.`);
  return source.slice(start, end);
}

function replaceOnce(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch anchor must match exactly once: ${before.slice(0, 100)}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchBundle(source, version) {
  const spec = SUPPORTED[version];
  if (!spec) throw new Error(`Unsupported extension version ${version}; no files changed.`);
  if (source.includes(MARKER)) throw new Error('Already patched.');
  if (digest(source) !== spec.hash) {
    throw new Error(`Original bundle fingerprint does not match ${version}; no files changed.`);
  }

  const originalComponent = componentSource(source, spec.component);
  const originalPill = componentSource(source, spec.pill);
  const component = `function ${spec.component}({session:${spec.session},onOpen:${spec.open}}){` +
    `${spec.hook}();let session=${spec.session},agents=session.agentMapAgents.value,` +
    `permissions=session.permissionRequests.value,` +
    `activity=claudeLocalActivitySummary(session,${spec.count}(agents),` +
    `${spec.dot}(agents,${spec.waiting}(permissions)));` +
    `return ${spec.create}(${spec.pill},{activity,dot:activity.dot,onOpen:${spec.open}})}`;
  const pill = `function ${spec.pill}({activity,onOpen}){` +
    `return ${spec.container}("button",{type:"button",` +
    `style:{minWidth:0,maxWidth:"100%",flexShrink:1,padding:"0 8px"},` +
    `className:${spec.styles}.modelPill+" "+${spec.pillStyles}.agentsPill,` +
    `onClick:onOpen,title:activity.title,"data-agents-dot":activity.dot,` +
    `"aria-label":activity.label+" · "+activity.title,` +
    `children:activity.sections.map((section,index)=>${spec.container}("span",{` +
    `style:{display:"inline-flex",alignItems:"center",gap:4,minWidth:0,flexShrink:1},` +
    `title:section.title,"data-activity-section":section.kind,children:[` +
    `index>0&&${spec.create}("span",{"aria-hidden":true,children:"·"}),` +
    `${spec.create}(${spec.statusDot},{state:section.state,className:${spec.pillStyles}.dot,title:section.title}),` +
    `${spec.create}("span",{style:{minWidth:0,overflow:"hidden",textOverflow:"ellipsis"},` +
    `children:section.label})]},section.kind))})}`;

  let patched = replaceOnce(source, originalComponent,
    `${MARKER}\n${claudeLocalActivitySummary.toString()}\n${component}`);
  patched = replaceOnce(patched, originalPill, pill);
  if (spec.alwaysShow) patched = replaceOnce(patched, ...spec.alwaysShow);
  return patched;
}

function checkSyntax(source) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`JavaScript syntax check failed:\n${result.stderr}`);
}

function defaultExtension() {
  const extensions = path.join(os.homedir(), '.vscode', 'extensions');
  const entries = JSON.parse(fs.readFileSync(path.join(extensions, 'extensions.json'), 'utf8'));
  const installed = entries.find((entry) => entry.identifier.id.toLowerCase() === 'anthropic.claude-code');
  if (!installed?.relativeLocation) throw new Error('Cannot locate the registered Claude Code extension. Use --extension <directory>.');
  return path.join(extensions, installed.relativeLocation);
}

function readTarget(extension) {
  const directory = fs.realpathSync(extension);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  if (manifest.publisher !== 'Anthropic' || manifest.name !== 'claude-code') {
    throw new Error('Target is not the official Anthropic Claude Code extension.');
  }
  const file = path.join(directory, 'webview', 'index.js');
  const original = fs.readFileSync(file, 'utf8');
  const key = digest(directory.toLowerCase()).slice(0, 12);
  const backupDirectory = path.join(ROOT, 'backups', `${manifest.version}-${key}`);
  return { directory, version: manifest.version, file, original, backupDirectory };
}

function writeAtomically(file, content) {
  const temporary = `${file}.claude-activity-${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function run(command, extension) {
  const target = readTarget(extension);
  const { directory, version, file, original, backupDirectory } = target;
  const backupFile = path.join(backupDirectory, 'index.js.original');
  const metadataFile = path.join(backupDirectory, 'patch.json');
  if (command === 'restore') {
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    const backup = fs.readFileSync(backupFile, 'utf8');
    if (metadata.extension !== directory || metadata.version !== version || digest(backup) !== metadata.originalHash) {
      throw new Error('Backup metadata or checksum does not match the target; no files changed.');
    }
    if (digest(original) === metadata.originalHash) {
      console.log(`Already restored: ${directory}`);
      return;
    }
    if (digest(original) !== metadata.patchedHash) {
      throw new Error('Extension changed after patching; refusing to overwrite newer edits.');
    }
    checkSyntax(backup);
    writeAtomically(file, backup);
    console.log(`Restored ${version}. Reload VS Code when other work is safe to interrupt.`);
    return;
  }

  if (original.includes(MARKER)) {
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    if (metadata.extension !== directory || digest(original) !== metadata.patchedHash ||
        digest(fs.readFileSync(backupFile, 'utf8')) !== metadata.originalHash) {
      throw new Error('Patched file or backup no longer matches recorded checksums.');
    }
    if (patchBundle(fs.readFileSync(backupFile, 'utf8'), version) !== original) {
      throw new Error(`Patched by an older version of this script: run restore, then apply. ${directory}`);
    }
    console.log(`Already patched and verified: ${directory}`);
    return;
  }

  const patched = patchBundle(original, version);
  checkSyntax(patched);
  if (command === 'check') {
    console.log(`Compatible: Claude Code ${version}\n${directory}\nOriginal SHA-256: ${digest(original)}`);
    return;
  }

  fs.mkdirSync(backupDirectory, { recursive: true });
  if (fs.existsSync(backupFile)) {
    if (digest(fs.readFileSync(backupFile, 'utf8')) !== digest(original)) {
      throw new Error('An existing backup differs from the original; no files changed.');
    }
  } else {
    fs.writeFileSync(backupFile, original, { flag: 'wx' });
  }
  const metadata = {
    patch: 'claude-vscode-activity:v1', extension: directory, version,
    originalHash: digest(original), patchedHash: digest(patched),
    appliedAt: new Date().toISOString(),
  };
  if (fs.existsSync(metadataFile)) JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  writeAtomically(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
  // Refuse to overwrite a bundle changed concurrently while the backup was being made.
  if (digest(fs.readFileSync(file, 'utf8')) !== metadata.originalHash) {
    throw new Error('Extension changed during patching; no extension files changed.');
  }
  writeAtomically(file, patched);
  console.log(`Applied activity indicator patch to Claude Code ${version}.\nBackup: ${backupFile}\nReload VS Code when other work is safe to interrupt.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command = 'check', ...args] = process.argv.slice(2);
    if (!['check', 'apply', 'restore'].includes(command) ||
        (args.length > 0 && (args.length !== 2 || args[0] !== '--extension'))) {
      throw new Error('Usage: node patch.mjs <check|apply|restore> [--extension <directory>]');
    }
    run(command, args[1] ?? defaultExtension());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
