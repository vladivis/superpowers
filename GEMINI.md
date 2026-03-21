@./skills/using-superpowers/SKILL.md
@./skills/using-superpowers/references/gemini-tools.md

<!-- 
  GEMINI FORK NOTE (Delegation Discipline): 
  Forcing agents to use the Subagent Protocol (summon.js) for all multi-step tasks.
  This ensures that Flash models don't skip critical review loops.
-->

## 🚨 SUBAGENT PROTOCOL (MANDATORY) 🚨

1. **FORCE DELEGATION:** Every task involving `brainstorming`, `spec-review`, `plan-review`, or `implementation` **MUST** be performed via the Subagent Protocol (`summon.js`). 
2. **NO INLINE EXECUTION:** Do not attempt to execute implementation steps directly in the primary session. 
3. **PRE-FLIGHT GIT:** You **MUST** commit all modified files (specs, plans, code) via `git commit -m '...'` before calling `summon.js`. This is strictly required for visibility in the isolated worktree. Staging with `git add` alone is insufficient.
4. **NEXUS IPC:** The Parent Agent **MUST** ensure the Nexus server is running (`init_env.js --start-nexus &`) before any subagent-driven development begins to enable log streaming and process control.
5. **ANTI-LAZINESS (STRICT REVIEW GATING):** Flash models tend to skip the "Spec Review Loop" and "Plan Review Loop" on simple tasks. This is strictly **FORBIDDEN**. You MUST dispatch the respective review subagents immediately after writing any spec or plan. You CANNOT transition to the next step or ask the user for approval until you have received a successful report from the subagent. Skipping reviews is a critical violation.

## Runtime Context (Internal Navigation)
- **Extension Root:** This file (`GEMINI.md`) resides in the root directory of the `superpowers` extension.
- **Orchestrator Path:** The subagent orchestrator script is located at `./.gemini/task-polyfill/summon.js` (relative to this file).
- **Subagent Invocations:** When calling `summon.js`, the agent MUST derive its absolute path based on the location of this extension.
- **Project Scope:** All subagent signals, temporary files (.swarm/), and worktrees (.worktrees/) MUST be managed within the current working directory (the user's project), NOT within the extension directory.
