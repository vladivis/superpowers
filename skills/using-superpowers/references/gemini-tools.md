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

## Subagent Support (Task Polyfill with Nexus IPC)

Gemini CLI has no native equivalent to Claude Code's `Task` tool. However, this workspace provides a robust task polyfill located in `.gemini/task-polyfill` within the `superpowers` extension directory. This tool emulates subagent dispatch via isolated Git Worktrees and background processes. It supports macOS, Linux, and **Windows** (via `gemini.cmd`).

**LOCATION:** To find the orchestrator, use the base path of the `superpowers` extension. 
1. Call `activate_skill using-superpowers`.
2. Extract the absolute path from the `<location>` tag.
3. The extension root is the directory containing `skills/`.
4. The orchestrator is at `<extension_root>/.gemini/task-polyfill/summon.js`.

**MANDATORY USE:** EVERY skill or sub-skill that requires dispatching a subagent (including `subagent-driven-development`, `dispatching-parallel-agents`, and internal `spec-review` or `plan-review` steps) MUST use this polyfill script via `run_shell_command`.

### 🚀 Enabling Real-time Features (Nexus IPC)
To enable real-time log streaming and bidirectional process control, the **Parent Agent MUST initialize the Nexus server** at the beginning of the session:
`node <absolute_path_to_init_env.js> --start-nexus &`

### Key Features
- **Neural Sync (IPC):** Subagents connect to the Nexus server for zero-latency log streaming and instant `interrupt` signal handling.
- **Secure Stdin Pipeline:** Prompts are passed via standard input to the subagent. This eliminates shell injection risks and command-line length limitations.
- **Model Resilience:** The polyfill automatically falls back to the `flash` model if the selected model encounters `ResourceExhausted` (429) errors.
- **Isolation:** Each task runs in a dedicated Git Worktree, isolated from the parent session.

**CRITICAL:** Before calling `summon.js`:
1. You MUST write the detailed instruction/prompt into a temporary file inside the `.swarm/` directory **of the current project**: e.g., `.swarm/<task_id>.prompt.txt`.
2. You MUST use the `ask_user` tool to let the user select the model for the subagent. (In `--yolo` mode, this will automatically select the first option).
   Provide these exact choices:
   1. `auto` - Let the router decide based on complexity (DEFAULT)
   2. `pro` - Highly capable for complex reasoning
   3. `flash` - Fast and cheap
   4. `flash-lite` - Fastest and cheapest for very simple tasks

**EXECUTION:** Call the summon script by passing the **absolute path** to `summon.js` and the path to the prompt file (relative to the project root). The orchestrator will read the file and pipe its content to the subagent via stdin: `node <absolute_path_to_summon.js> <task_id> .swarm/<task_id>.prompt.txt <model>`.

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
