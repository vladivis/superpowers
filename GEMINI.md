@./skills/using-superpowers/SKILL.md
@./skills/using-superpowers/references/gemini-tools.md

## Runtime Context (Internal Navigation)
- **Extension Root:** This file (`GEMINI.md`) resides in the root directory of the `superpowers` extension.
- **Orchestrator Path:** The subagent orchestrator script is located at `./.gemini/task-polyfill/summon.js` (relative to this file).
- **Subagent Invocations:** When calling `summon.js`, the agent MUST derive its absolute path based on the location of this extension.
- **Project Scope:** All subagent signals, temporary files (.swarm/), and worktrees (.worktrees/) MUST be managed within the current working directory (the user's project), NOT within the extension directory.
