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

Requires Git, Node.js 20 or newer, and a Claude Code runtime that supports function-hook modules (tested with the VS Code extension's 2.1.318 runtime). The standalone CLI can be older than the extension: use a current CLI or the extension's plugin manager to install this version. This is a version-specific local prototype, not an official or supported extension feature; review the scripts and your applicable software terms and policies before use.

Install the Claude Code plugin once per machine. In a terminal (needs the `claude` CLI):

```powershell
claude plugin marketplace add Forest216/claude-vscode-activity
claude plugin install vscode-activity-for-claude-code@claude-vscode-activity
```

In a current Claude Code CLI chat, the one-step install is:

```text
/plugin install vscode-activity-for-claude-code --marketplace Forest216/claude-vscode-activity
```

In VS Code, type `/plugins` in the Claude Code chat input, add `Forest216/claude-vscode-activity` under **Marketplaces**, then install **vscode-activity-for-claude-code** for your user. Installing the VS Code extension alone does not put a `claude` command on PowerShell's PATH.

### Migrating from 0.3.x

The plugin was renamed because current runtimes reserve names beginning with `claude-`. The marketplace and GitHub repository are unchanged. Disable the old **claude-vscode-activity** plugin before enabling **vscode-activity-for-claude-code**; otherwise its old command hook still runs. Keep the persistent clone and `backups/` untouched. Do not expect updating the old plugin ID to install the new one.

Start a new Claude Code session and send any message, such as `hello`; no patch-specific request is needed. A function-hook module runs one local check and, if attention is needed, adds context asking Claude to offer help after your current task. It does not start a model request by itself. After you agree, Claude can clone a working copy to `Q:\Code\claude-vscode-activity` (or `~/claude-vscode-activity` without `Q:\Code`), apply the patch, and ask you to run **Developer: Reload Window**. Reloading can interrupt current sessions, so nothing reloads automatically.

You can also just ask, for example, "install the activity patch", "restore the activity patch", or "the Claude Code extension updated, update the activity patch".

## Updates

- The first ordinary message in each session runs a bounded local checker. The module remembers the checked session ID in memory; subsequent messages start no checker process, read no receipt file, and do not run this plugin's classic `UserPromptSubmit` hook. Other plugins can still show their own hook indicators.
- Automatic checks never access the network, read transcripts, or receive the prompt text. A failure leaves the user's message unchanged and writes only a generic debug notice.
- Restarting or reloading the module resets memory. Switching to a new session ID checks that session on its next ordinary message. Old `~/.claude/activity-hook-state/` receipts are no longer used and are left untouched.
- Patch fixes are pulled when you agree to handle the patch through the skill, not during ordinary conversation. A patch applied by an older script is reported after the working clone is updated; changes still require your agreement.
- The offer is model context, not a guaranteed UI notification. Module-engine tests establish check frequency and context delivery; verify the visible offer in the actual VS Code host.
- Claude Code extension updates: the new bundle replaces the patch and is refused until its fingerprint and anchors are reviewed. Claude ports it when you agree, then asks before pushing the new version here.
- Plugin updates (the hook and skill themselves) are not automatic for third-party marketplaces. Turn on auto-update in `/plugin` → Marketplaces → `claude-vscode-activity`, or run `claude plugin marketplace update claude-vscode-activity` and `claude plugin update vscode-activity-for-claude-code@claude-vscode-activity`.

## Compatibility and backup

- Reviewed bundle fingerprints: **2.1.312**, **2.1.314**, **2.1.317**, and **2.1.318**, Windows x64.
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

Run the in-process module tests and validation using a current runtime (for example the executable under the VS Code extension's `resources/native-binary/`):

```powershell
claude plugin test .
claude plugin validate .
```

Module tests run through the hooks engine without model requests. They cover first-message context, ten subsequent messages with no checker processes, session resets, background-message filtering, and failure pass-through. Node tests use temporary directories and stub subprocesses to check the local helper; it writes no session receipts. These tests do not prove that the real VS Code host loaded the module or that the model displayed the offer. Verify that separately with an ordinary first message and a second message.

The 22 standalone patch tests need no extension installation. Six integration tests use locally installed original bundles and skip when those bundles or their backups are unavailable; skips do not mean compatibility was verified. Proprietary test fixtures are not included.

To use another extensions directory or backup folder:

```powershell
$env:CLAUDE_VSCODE_TEST_EXTENSIONS = "$env:USERPROFILE\.vscode\extensions"
$env:CLAUDE_VSCODE_TEST_BACKUPS = 'D:\local-only\claude-activity-backups'
node --test .\patch.test.mjs
```
