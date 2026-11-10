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

A synchronous UserPromptSubmit hook checks the patch on the first message
in a session, including an ordinary greeting. SessionStart on startup, resume,
or clear resets the check receipt. A `[claude-vscode-activity]` note means the
clone is missing or the patch needs attention: in the current reply, briefly
offer to set up, apply, or port it, then address the user's message. Do not
require them to name the patch. Wait for their consent before making changes.
The hook's systemMessage is an auxiliary notice; its display depends on the host.

## Working clone (never run from the plugin cache)

The script writes `backups/` next to itself and porting edits `patch.mjs`, so it
must run from a persistent clone, not this plugin's install directory.

- Location: `Q:\Code\claude-vscode-activity` if `Q:\Code` exists, otherwise
  `~/claude-vscode-activity`.
- If missing: `git clone https://github.com/Forest216/claude-vscode-activity.git <location>`.
- If present: `git -C <location> pull --ff-only`. Do not discard local changes.

## Apply / check / restore

From the clone:

```
node patch.mjs check      # reports Compatible, Already patched, or Unsupported
node patch.mjs apply
node patch.mjs restore
```

Never reload VS Code yourself. Tell the user to run **Developer: Reload Window**
once their other sessions are safe to interrupt.

## Porting a new extension version

When `check` says `Unsupported extension version X`:

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
