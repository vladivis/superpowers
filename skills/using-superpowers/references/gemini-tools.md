# Gemini CLI Tool Mapping

Skills use Claude Code tool names. When you encounter these in a skill, use your platform equivalent:

| Skill references | Gemini CLI equivalent |
|-----------------|----------------------|
| `Read` (file reading) | `read_file` |
| `Write` (file creation) | `write_file` |
| `Edit` (file editing) | `replace` |
| `Bash` (run commands) | `run_shell_command` |
| `Grep` (search file content) | `grep_search` |
| `Glob` (search files by name) | `glob` |
| `TodoWrite` (task tracking) | `write_todos` |
| `Skill` tool (invoke a skill) | `activate_skill` |
| `WebSearch` | `google_web_search` |
| `WebFetch` | `web_fetch` |
| `Task` tool (dispatch subagent) | `run_shell_command` with `node <path_to_extension>/.gemini/task-polyfill/summon.js` |

<!-- 
  GEMINI FORK NOTE (Subagent Enforcement): 
  Adding explicit protocol headers to prevent "Flash" models from skipping subagent dispatch. 
  The goal is to move delegation from an "instruction" to a "mandatory system law".
-->

## 🚨 MANDATORY DELEGATION PROTOCOL (Task Tool) 🚨

Gemini CLI has no native equivalent to Claude Code's `Task` tool. However, this workspace provides a robust task polyfill located in `.gemini/task-polyfill` within the `superpowers` extension directory.

🛑 **CRITICAL RULE FOR ALL MODELS (Pro & Flash):**
1. EVERY skill or sub-skill that requires dispatching a subagent (including `subagent-driven-development`, `dispatching-parallel-agents`, and internal `spec-review` or `plan-review` steps) **MUST** use this polyfill script via `run_shell_command`. 
2. **DO NOT** attempt to perform subagent tasks directly in the current session. 
3. Skipping the `Task` tool is a **PROTOCOL VIOLATION**.

**LOCATION:** To find the orchestrator, use the base path of the `superpowers` extension. 
1. Call `activate_skill using-superpowers`.
2. Extract the absolute path from the `<location>` tag.
3. The extension root is the directory containing `skills/`.
4. The orchestrator is at `<extension_root>/.gemini/task-polyfill/summon.js`.

### 🚀 Enabling Real-time Features (Nexus IPC)
To enable real-time log streaming and bidirectional process control, the **Parent Agent MUST initialize the Nexus server** at the beginning of the session:
`node <absolute_path_to_init_env.js> --start-nexus &`

### Key Features
- **Neural Sync (IPC):** Subagents connect to the Nexus server for zero-latency log streaming and instant `interrupt` signal handling.
- **Secure Stdin Pipeline:** Prompts are passed via standard input to the subagent. This eliminates shell injection risks and command-line length limitations.
- **Model Resilience:** The polyfill automatically falls back to the `flash` model if the selected model encounters `ResourceExhausted` (429) errors.
- **Isolation:** Each task runs in a dedicated Git Worktree, isolated from the parent session.

⚠️ **EXECUTION STEPS (Strict Order):**
1. **Pre-flight Git Check:** You **MUST** ensure all files the subagent needs to see are committed to Git. Run `git add <files>` and then `git commit -m '...'` for any new or modified files (e.g., specs, plans, or code). **Staging with `git add` alone is INSUFFICIENT** because isolated worktrees only inherit the committed history.
2. **Prepare Prompt:** Write the detailed instruction/prompt into a temporary file inside the `.swarm/` directory of the project.
   **STRICT NAMING CONVENTION:** For EVERY subagent dispatched (e.g., implementers, spec-reviewers, code-reviewers), you MUST use a structured `task_id` format: `<subject>-<role>-<iteration>`. 
   Examples: `sentinel-spec-review-v1`, `task1-implement`, `task1-quality-review-v2`. Do NOT use generic names like `test` or `agent`.
   Save the prompt as: `.swarm/<task_id>.prompt.txt`.
3. **Model Selection:** Use the `ask_user` tool to let the user select the model for the subagent.
   Provide these exact choices:
   1. `auto` - Let the router decide based on complexity (DEFAULT)
   2. `pro` - Highly capable for complex reasoning
   3. `flash` - Fast and cheap
   4. `flash-lite` - Fastest and cheapest for very simple tasks
4. **Dispatch:** Call the summon script by passing the **absolute path** to `summon.js` and the path to the prompt file (relative to the project root): `node <absolute_path_to_summon.js> <task_id> .swarm/<task_id>.prompt.txt <model>`.

**PROJECT SCOPE:** All subagent signals, temporary files (.swarm/), and worktrees (.worktrees/) MUST be managed within the current working directory (the user's project), NOT within the extension directory.

## Additional Gemini CLI tools

These tools are available in Gemini CLI but have no Claude Code equivalent:

| Tool | Purpose |
|------|---------|
| `list_directory` | List files and subdirectories |
| `save_memory` | Persist facts to GEMINI.md across sessions |
| `ask_user` | Request structured input from the user |
| `tracker_create_task` | Rich task management (create, update, list, visualize) |
| `enter_plan_mode` / `exit_plan_mode` | Switch to read-only research mode before making changes |
