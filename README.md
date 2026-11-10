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
- The button stays visible even before any subagent has run (2.1.317+); unpatched, the extension hides it until the session has a subagent.

This reports the extension's existing state, not independent process health or a completion percentage.

## Install

Requires Git, Node.js 20 or newer, and a supported official Claude Code VS Code extension installation. This is a version-specific local prototype, not an official or supported extension feature; review the scripts and your applicable software terms and policies before use.

Install the Claude Code plugin once per machine. In a terminal (needs the `claude` CLI):

```powershell
claude plugin marketplace add Forest216/claude-vscode-activity
claude plugin install claude-vscode-activity@claude-vscode-activity
```

Or type the same two commands with a leading `/` in the Claude Code chat box (not in PowerShell): `/plugin marketplace add Forest216/claude-vscode-activity`, then `/plugin install claude-vscode-activity@claude-vscode-activity`.

Start a new Claude Code session and send any message, such as `hello`; no patch-specific request is needed. A synchronous first-message hook checks the patch and, if attention is needed, asks Claude to offer help in that reply. The hook does not start a conversation by itself. After you agree, Claude can clone a working copy to `Q:\Code\claude-vscode-activity` (or `~/claude-vscode-activity` without `Q:\Code`), apply the patch, and ask you to run **Developer: Reload Window**. Reloading can interrupt current sessions, so nothing reloads automatically.

You can also just ask, for example, "install the activity patch", "restore the activity patch", or "the Claude Code extension updated, update the activity patch".

## Updates

- Patch fixes: on the first message, the hook attempts a fast-forward of the working clone, then checks local files even if the network update fails. A patch applied by an older script is reported; changes still require your agreement.
- Repeated messages do not repeat the check. Startup, resume, and `/clear` reset it. Small diagnostic receipts in `~/.claude/activity-hook-state/` contain only a hashed session filename, time, plugin version, outcome, and subprocess status—not prompts or transcripts. Receipts expire after seven days and are capped at 128; eviction can cause another check.
- An auxiliary `systemMessage` requests a notice, but its rendering depends on the host. A model reply is still needed for the offer. If it is absent after an ordinary first message, inspect hook loading and the diagnostic receipt; do not assume installation failed.
- Claude Code extension updates: the new bundle replaces the patch and is refused until its fingerprint and anchors are reviewed. Claude ports it when you agree, then asks before pushing the new version here.
- Plugin updates (the hook and skill themselves) are not automatic for third-party marketplaces. Turn on auto-update in `/plugin` → Marketplaces → `claude-vscode-activity`, or run `claude plugin marketplace update claude-vscode-activity` and `claude plugin update claude-vscode-activity@claude-vscode-activity`.

## Compatibility and backup

- Reviewed bundle fingerprints: **2.1.312**, **2.1.314**, and **2.1.317**, Windows x64.
- Unsupported versions or modified bundles are refused before changing the extension.
- `backups/<version>-<installation-id>/` in the working clone holds the exact original bundle and checksum metadata. It is gitignored: do not publish the proprietary extension bundles.
- Restore refuses to overwrite an extension that changed after patching.

## Manual use (without the plugin)

From a clone of this repository:

```powershell
node .\patch.mjs check
node .\patch.mjs apply
node .\patch.mjs restore
node .\patch.mjs check --extension "$env:USERPROFILE\.vscode\extensions\anthropic.claude-code-2.1.317-win32-x64"
```

By default the script targets the version registered in `%USERPROFILE%\.vscode\extensions\extensions.json`. Reload the VS Code window after applying or restoring.

## Tests

```powershell
node --test .\patch.test.mjs .\hooks\session-check.test.mjs
```

Hook tests cover arbitrary first messages, per-session deduplication, resume resets, quiet success, missing clones, check errors, and bounded diagnostic state. They use temporary directories and stub subprocesses: they do not prove that VS Code loaded the hook or that the model displayed the offer. Validate that separately in the actual VS Code host with an ordinary first message.

The 22 standalone tests need no extension installation. Four integration tests use locally installed original bundles and skip when those bundles or their backups are unavailable; skips do not mean compatibility was verified. Proprietary test fixtures are not included.

To use another extensions directory or backup folder:

```powershell
$env:CLAUDE_VSCODE_TEST_EXTENSIONS = "$env:USERPROFILE\.vscode\extensions"
$env:CLAUDE_VSCODE_TEST_BACKUPS = 'D:\local-only\claude-activity-backups'
node --test .\patch.test.mjs
```
