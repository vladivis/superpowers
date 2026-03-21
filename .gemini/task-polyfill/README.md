# Gemini CLI Task Polyfill

This directory contains a platform-agnostic Node.js polyfill for managing isolated, non-interactive sub-agent execution within the Gemini CLI environment using Git Worktrees.

## Overview
Since Gemini CLI lacks a native `Task` tool for sub-agent dispatch, this polyfill emulates that functionality by leveraging OS-level isolation and structured JSON signals. It is designed to be robust, secure, and cross-platform.

**NOTE:** This tool is strictly for Gemini CLI. Other platforms (Claude Code, Codex) should use their native orchestration tools.

## Key Technical Features
- **Isolated Workspaces:** Sub-agents operate in dedicated Git Worktrees (`.worktrees/`), ensuring zero interference with the parent's working directory.
- **Secure Communication:** Prompts are passed to the sub-agent via standard input (**stdin**). This bypasses OS command-line length limits and eliminates shell injection risks.
- **Cross-Platform:** Full support for macOS, Linux, and **Windows** (utilizing `gemini.cmd`).
- **Resilience & Fallback:** Includes automatic model fallback to `flash` if the primary model (e.g., `pro`) encounters `ResourceExhausted` errors (429).
- **Resource Guardrails:**
    - **Timeout:** Tasks are automatically terminated after **15 minutes** to prevent hanging processes.
    - **Watchdog:** Execution logs are capped at **10MB** to prevent disk exhaustion.
- **Repository Hygiene:** Uses local Git excludes (`.git/info/exclude`) to keep the main repository history clean from polyfill-specific temporary files and worktrees.

## Component Structure
- `summon.js`: Core orchestration script for macOS, Linux, and Windows.
- `init_env.js`: Environment initialization script.
- `.swarm/`: (Internal) Hidden directory containing atomic JSON signals (`.running.json`, `.complete.json`) and PID tracking.
- `.worktrees/`: (Internal) Hidden directory containing isolated git workspaces.

## Workspace Lifecycle & Safety
1. **Concurrency Protection:** Do not modify or delete directories in `.worktrees/` or files in `.swarm/` while a sub-agent task is active. The polyfill utilizes lock-retry mechanisms with random jitter to prevent thundering herd deadlocks on Git resources.
2. **Mandatory Cleanup:** Once a task is merged and verified, the orchestrating agent MUST remove the associated worktree to reclaim disk space: `git worktree remove .worktrees/<task_id>`.
3. **Zombie Management:** If a sub-agent process terminates unexpectedly, the Parent Agent should use the `pid` from `.swarm/<task_id>.running.json` to verify process death before manual cleanup.

## Execution Flow
1. **Isolation:** A new Git branch and worktree are created under `.worktrees/<task-name>`.
2. **Invocation:** A non-interactive Gemini CLI process is launched within the worktree directory.
3. **Secure Dispatch:** The prompt content is piped through **stdin**.
4. **Capture:** The script monitors for filesystem changes and output.
5. **Signaling:** Atomic JSON files are emitted into `.swarm/` to notify the parent process of status and provide a summary of changes.

## Usage (Internal Only)
This polyfill is automatically invoked by the Parent Agent when following the `dispatching-parallel-agents` or `subagent-driven-development` skills in a Gemini environment.

### Direct Execution (Diagnostic)

```bash
node .gemini/task-polyfill/summon.js <task_id> <path_to_prompt_file> [model_alias] [target_worktree_path]
```

*Note: The script reads the prompt from the provided file path and pipes it to the sub-agent.*
