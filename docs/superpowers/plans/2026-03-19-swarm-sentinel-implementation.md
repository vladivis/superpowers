# Swarm Sentinel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a low-latency proxy monitor ("Sentinel") to provide real-time steering and fail-safe termination for background subagents without consuming the Parent Agent's token context.

**Architecture:** 
1. `NexusServer` gets an event replay buffer. 
2. `sentinel.js` connects via WebSocket, maintains a rolling log window, evaluates heuristics/Micro-LLMs, and maintains a "Living Heartbeat" (`mtime` on `.swarm/sentinel.alive`). Handles state recovery via `replaySince(eventId)`.
3. `summon.js` monitors the heartbeat and self-terminates if the Sentinel crashes or fails to start.
4. Skills are updated to launch the Sentinel alongside subagents.

**Tech Stack:** Node.js (native ESM), RFC 6455 WebSockets, Vitest.

---

### Task 1: Nexus Replay Buffer & Broadcast

**Files:**
- Modify: `.gemini/task-polyfill/nexus.js`
- Test: `tests/gemini-cli/nexus-replay.test.js`

- [ ] **Step 1: Write the failing test for replay buffer**
```javascript
// Test: Server should store last 500 events and replay them when requested with a `replaySince` event
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/gemini-cli/nexus-replay.test.js`

- [ ] **Step 3: Implement Replay and Broadcast logic**
In `nexus.js`:
- Add `this.eventLog = []` (capped at 500 items).
- Assign a sequential `eventId` to every incoming `log` event and store it.
- Implement a new incoming event handler for `replaySince`: When a client sends `{ type: 'replaySince', eventId: X }`, the server must send all missed events from `eventLog` that have an ID > X.
- Implement `broadcastToTask(taskId, message)`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/gemini-cli/nexus-replay.test.js`

- [ ] **Step 5: Commit**
```bash
git add .gemini/task-polyfill/nexus.js tests/gemini-cli/nexus-replay.test.js
git commit -m "feat(nexus): implement dedicated replaySince event buffer and task broadcasting"
```

---

### Task 2: Subagent "Dead Man's Switch" (Active Watchdog)

**Files:**
- Modify: `.gemini/task-polyfill/summon.js`
- Test: `tests/gemini-cli/dead-mans-switch.test.js`

- [ ] **Step 1: Write the failing tests for Dead Man's Switch**
```javascript
// Test 1 (Startup Fail): Spawn subagent. Do NOT create sentinel.alive. Verify subagent self-terminates after 30s.
// Test 2 (Hard SIGKILL): Spawn Sentinel and Subagent. SIGKILL the Sentinel. Verify Subagent detects heartbeat loss and terminates.
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/gemini-cli/dead-mans-switch.test.js`

- [ ] **Step 3: Implement Active Watchdog in `summon.js`**
In `summon.js` (inside `heartbeat` interval):
- Try to check `fs.statSync('.swarm/sentinel.alive')`.
- If the file exists AND `Date.now() - stats.mtimeMs > 30000`, invoke `handleKill('SENTINEL_DEAD')`.
- If the file DOES NOT exist AND `Date.now() - startTimeTotal > 30000` (subagent boot time), invoke `handleKill('SENTINEL_NEVER_STARTED')`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/gemini-cli/dead-mans-switch.test.js`

- [ ] **Step 5: Commit**
```bash
git add .gemini/task-polyfill/summon.js tests/gemini-cli/dead-mans-switch.test.js
git commit -m "security(summon): implement robust mtime-based Dead Man's Switch including startup failure detection"
```

---

### Task 3: Sentinel Core, Heuristics & Replay Recovery

**Files:**
- Create: `.gemini/task-polyfill/sentinel.js`
- Test: `tests/gemini-cli/sentinel-core.test.js`

- [ ] **Step 1: Write failing tests for Sentinel**
```javascript
// Test 1: Sentinel connects, utimesSync .alive every 10s, exits code 10 on 'npm ERR!'
// Test 2 (Replay Recovery): Simulate connection drop. Sentinel reconnects, sends replaySince event, and receives missed logs.
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/gemini-cli/sentinel-core.test.js`

- [ ] **Step 3: Implement `sentinel.js` Core & Recovery**
- Parse CLI args: `<taskId>`.
- Maintain `last_event_id`. Connect to Nexus, and after `hello`, send `{ type: 'replaySince', eventId: last_event_id }` if `last_event_id` is greater than 0.
- Implement `setInterval` to `fs.utimesSync('.swarm/sentinel.alive', new Date(), new Date())` every 10s (create file if missing).
- Accumulate last 100 lines of `log` events in a rolling buffer. Update `last_event_id` from incoming logs.
- Run Regex heuristics (e.g., `/npm ERR!/`, `/[SENTINEL_WAKE_UP]/`).
- If triggered: write `.swarm/sentinel-report.json`, send `interrupt` via Nexus, and `process.exit(10)`.
- If `bye` event received: `process.exit(0)`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/gemini-cli/sentinel-core.test.js`

- [ ] **Step 5: Commit**
```bash
git add .gemini/task-polyfill/sentinel.js tests/gemini-cli/sentinel-core.test.js
git commit -m "feat(sentinel): implement proxy awareness core with explicit replay recovery and SOS triggers"
```

---

### Task 4: Sentinel Micro-LLM Integration (Flash-Lite)

**Files:**
- Modify: `.gemini/task-polyfill/sentinel.js`
- Test: `tests/gemini-cli/sentinel-cognitive.test.js`

- [ ] **Step 1: Write failing tests for cognitive trigger & security**
```javascript
// Test 1: Mock HTTPS server. Sentinel sends log buffer, mock returns "Yes". Sentinel exits code 10.
// Test 2 (Security Audit): Verify API key is passed via stdin and DOES NOT exist in process.env or any temp file after initialization.
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/gemini-cli/sentinel-cognitive.test.js`

- [ ] **Step 3: Implement Cognitive Check & Secure Auth**
In `sentinel.js`:
- Read API key strictly from `process.stdin` upon launch. Store in a local variable, NOT `process.env`.
- Every 3 minutes, use `node:https` to make a POST request to `generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`.
- Prompt: "Is subagent still on track? [Yes/No]"
- If response includes NO (or indicates deviation based on the strict spec prompt), trigger intervention. (Wait, the spec says "If response includes YES, trigger intervention" for the prompt "Is the agent stuck...". Since the spec prompt is "Is subagent still on track? [Yes/No]", the trigger condition should be if the response includes "No" or "NO").
- *Correction to trigger logic based on the spec prompt:* If response includes "NO", trigger intervention.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/gemini-cli/sentinel-cognitive.test.js`

- [ ] **Step 5: Commit**
```bash
git add .gemini/task-polyfill/sentinel.js tests/gemini-cli/sentinel-cognitive.test.js
git commit -m "feat(sentinel): integrate Flash-Lite for secure, strict-prompt cognitive log evaluation"
```

---

### Task 5: Skill Integration & Parent Orchestration

**Files:**
- Modify: `skills/subagent-driven-development/implementer-prompt.md`
- Modify: `skills/using-superpowers/references/gemini-tools.md`

- [ ] **Step 1: Update `gemini-tools.md`**
- Document the new Sentinel execution flow for the Parent Agent.
- Instruction: Launch subagent with `is_background: true`. Then immediately launch `sentinel.js` via stdin piping (`echo $KEY | node <absolute_path_to_extension>/.gemini/task-polyfill/sentinel.js <taskId>`) WITHOUT `is_background: true`.

- [ ] **Step 2: Update `implementer-prompt.md`**
- Inform subagents about the `[SENTINEL_WAKE_UP]` marker they can use if they get stuck.

- [ ] **Step 3: Commit**
```bash
git add skills/
git commit -m "docs(skills): integrate Sentinel execution flow and SOS markers into agent skills"
```