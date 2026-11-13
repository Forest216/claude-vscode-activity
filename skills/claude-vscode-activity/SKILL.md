---
name: claude-vscode-activity
description: >-
  Use when the user wants to install, apply, check, restore, or update the
  Claude Code VS Code activity indicator patch (Main / Subagents / Background
  status pill), or says the Claude Code extension updated and the indicator
  disappeared or the patch reports an unsupported version.
---

# Claude Code VS Code activity patch

Unofficial local patch to the installed Claude Code extension's `webview/index.js`.
It only changes the agent-map button rendering.

An in-process prompt.submit module checks local patch files on the first
ordinary message in each session. It remembers the session in module memory;
later messages launch no checker processes and write no receipt files.
Restarting/reloading the module or changing sessions permits a fresh check.
A `[claude-vscode-activity]` context note means attention is needed: address
the user's task, then briefly offer to set up, apply, or port the patch.
Do not require them to name the patch. Wait for consent before making changes.
Automatic checks never run git or call a model. After consent to handle the
patch, use the working-clone steps below to pick up published patch fixes.
The plugin is named vscode-activity-for-claude-code; its GitHub repository
and persistent working-clone paths remain unchanged.

## Working clone (never run from the plugin cache)

The script writes `backups/` next to itself and porting edits `patch.mjs`, so it
must run from a persistent clone, not this plugin's install directory.

- Location: `Q:\Code\claude-vscode-activity` if `Q:\Code` exists, otherwise
  `~/claude-vscode-activity`.
- Canonical remote: `https://github.com/Forest216/claude-vscode-activity.git`.
- If missing: clone the canonical remote with `--branch main`.
- If present: inspect the working tree and remote, then fetch the canonical remote
  and synchronize local `main` with `origin/main` using fast-forward only. Do not
  treat the currently checked-out feature branch as the published patch.
- **Remote first:** complete this synchronization before checking compatibility,
  changing the patch, or applying it. If clone, fetch, or pull fails, stop and
  report the failed step and error to the user. Do not continue from a stale
  clone, assume the version is unsupported, or silently start a local port.
- If local changes, a different remote, or divergent history prevent safe
  synchronization, report the blocker rather than discarding work or forcing it.
- Run the synchronized `main` patch first. If it already supports the installed
  extension, reuse it and stop; do not add unrelated tests or edits just to
  produce a commit.

## Publishing changes

- When the user authorizes a push in this repository, publish to **`main`**,
  not only to a feature branch: `git push origin HEAD:main`.
- A temporary local working branch is allowed, but base it on the latest remote
  `main`; publish only the requested, tested changes. Never force-push. If a push
  is rejected or fails, stop and report it to the user.
- After a successful push, synchronize and check out local `main` so subsequent
  checks use the published code. Preserve unrelated work and backups.
- This destination rule does not authorize an unsolicited commit or push.

## Apply / check / restore

From the clone:

```powershell
node patch.mjs check      # reports Compatible, Already patched, or Unsupported
node patch.mjs apply
node patch.mjs restore
```

Never reload VS Code yourself. Tell the user to run **Developer: Reload Window**
once their other sessions are safe to interrupt.

## Porting a new extension version

Only after the remote-first synchronization above succeeds and the published
`main` patch still reports `Unsupported extension version X`:

1. Bundle: `~/.vscode/extensions/anthropic.claude-code-X-<platform>/webview/index.js`.
   Record its `sha256sum`.
2. Find the component: grep `function \w+\(\{session:e,onOpen:t\}\)\{`. It
   should look like
   `function C({session:e,onOpen:t}){H();let n=e.agentMapAgents.value,i=W(e.permissionRequests.value);return M(P,{count:N(n),dot:D(n,i),onOpen:t})}`
   giving component C, hook H, waiting W, create M, pill P, count N, dot D,
   session `e`, open `t`.
3. The pill function `P` follows directly: `return K("button",{...className:\`${S.modelPill} ${Q.agentsPill}\`...m(F,{state:t,className:Q.dot})`
   giving container K, styles S, pillStyles Q, statusDot F. Confirm `F` is
   `function F({state:e,ring:t=!1,title:n,className:i})`.
   Also find where the footer renders the component: `V&&m(C,{session:e,onOpen:L})`,
   with `V` defined just before as `,V=L!==void 0&&A.size>0,` where
   `A=e.agentMapAgents.value`. That hides the pill until a subagent exists;
   record `alwaysShow: [',V=L!==void 0&&A.size>0,', ',V=L!==void 0,']`.
4. If any of these shapes differs (not just renamed identifiers), stop and tell
   the user; the patch needs a real review, not a rename.
5. Confirm `activity.mjs` session fields still exist in the bundle
   (`grep -o session\. activity.mjs`, then grep each field name).
6. Add `'X': { hash, component, pill, session, open, hook, create, container,
   count, waiting, dot, styles, pillStyles, statusDot, alwaysShow }` to `SUPPORTED` in
   `patch.mjs`. Add `['X', C, P]` to the version loop in `patch.test.mjs`, and
   any new identifiers to the two `new Function(...)` mock argument lists
   (count/waiting/dot get the matching mock, styles get `{}`, statusDot gets
   `noOp`).
7. `node --test --test-name-pattern=X patch.test.mjs` must pass, not skip.
   A skip means the X bundle was not found, so nothing was verified.
8. `node patch.mjs apply`, then ask before committing and pushing the new
   version so other machines get it.
