# Claude Code VS Code activity indicator — local patch

Changes the existing agent-map button to show, for example:

> ⚪ Main idle · 🟢 Subagents 1 · 🟢 Background 1

Each section uses its own native, theme-aware status dot; the emoji above only illustrate the colors.

This is an unofficial local UI patch, not a separate VS Code extension or Claude Code mod. It does not change agent execution, permissions, model requests, or task scheduling.

## Behavior

- Main assistant: idle, working, waiting for permission/input, connection unresponsive, or held by another window.
- Subagents: the extension's existing count of currently working subagents.
- Background tasks: live non-agent tasks, including shells, monitors, and workflows; known completed tasks and duplicate agent entries are excluded.
- Independent dots: Main reflects only the main assistant, Subagents reflects the extension's child-agent status (including waits/failures), and Background is active only while background tasks remain. An idle main assistant stays grey even when other work continues.
- The aggregate state remains only in the button's existing data attribute; there is no visible overall dot to confuse with the main assistant.
- Clicking still opens the native Agent map. Hover text and the accessible label describe the complete status; long labels can truncate in narrow layouts.

This reports the extension's existing state, not independent process health or a completion percentage.

## Install and apply

Requires Git, Node.js 20 or newer, and a supported official Claude Code VS Code extension installation. No package installation is needed. This is a version-specific local prototype, not an official or supported extension feature; review the scripts and your applicable software terms and policies before use.

In PowerShell:

```powershell
git clone https://github.com/Forest216/claude-vscode-activity.git
cd claude-vscode-activity
node .\patch.mjs check
node .\patch.mjs apply
```

To restore the original bundle from this checkout's local backup:

```powershell
node .\patch.mjs restore
```

By default, the script targets the version registered in `%USERPROFILE%\.vscode\extensions\extensions.json`. To target a specific installation:

```powershell
node .\patch.mjs check --extension "$env:USERPROFILE\.vscode\extensions\anthropic.claude-code-2.1.314-win32-x64"
```

After applying or restoring, wait for important work to finish, then use **Developer: Reload Window** in VS Code. Reloading can interrupt current sessions; the script never reloads automatically.

## Compatibility and backup

- Reviewed bundle fingerprints: **2.1.312** and **2.1.314**, Windows x64.
- Unsupported versions or modified bundles are refused before changing the extension.
- `backups/<version>-<installation-id>/` holds the exact original bundle and checksum metadata.
- Restore refuses to overwrite an extension that changed after patching.
- Extension updates may replace the patch. Run `check` afterward; a new version requires reviewing its anchors and fingerprint, not simply changing the version number.
- Keep backups locally. Do not publish the proprietary extension bundles. Only the original patch scripts and their tests should go in a separate repository.

## Tests

```powershell
node --test .\patch.test.mjs
```

The 22 standalone tests need no extension installation. Three integration tests use locally installed original bundles and explicitly skip when those bundles or their backups are unavailable; skips do not mean extension compatibility was verified. Proprietary test fixtures are not included.

For integration testing against another local extensions directory or an existing backup folder:

```powershell
$env:CLAUDE_VSCODE_TEST_EXTENSIONS = "$env:USERPROFILE\.vscode\extensions"
$env:CLAUDE_VSCODE_TEST_BACKUPS = 'D:\local-only\claude-activity-backups'
node --test .\patch.test.mjs
```

The complete local validation covers 25 tests: status cases, patched component output, syntax of both complete bundles, click-handler preservation, idempotent application, and byte-exact restore. A brief live subagent/background-task demo was also checked in VS Code. Other versions and layouts are not claimed to be validated; inspect the actual UI after a safe reload.
