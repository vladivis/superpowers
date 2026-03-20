# Swarm Sentinel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a low-latency proxy monitor ("Sentinel") to provide real-time steering and fail-safe termination for background subagents without consuming the Parent Agent's token context.

**Architecture:** 
1. `NexusServer` gets an event replay buffer. 
2. `sentinel.js` connects via WebSocket, maintains a rolling log window, evaluates heuristics/Micro-LLMs, and maintains a "Living Heartbeat" (`mtime` on `.swarm/sentinel.alive`).
3. `summon.js` monitors the heartbeat and self-terminates if the Sentinel crashes.

**Tech Stack:** Node.js (native ESM), RFC 6455 WebSockets, Vitest.

---

### Task 1: Nexus Replay Buffer & Broadcast

**Files:**
- Modify: `.gemini/task-polyfill/nexus.js`
- Test: `tests/gemini-cli/nexus-replay.test.js`

- [ ] **Step 1: Write the failing test for replay buffer**
```javascript
import { test, expect } from 'vitest';
import { NexusServer } from '../../.gemini/task-polyfill/nexus.js';
// Test: Server should store last 500 events and replay them when requested with `replaySince`
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/gemini-cli/nexus-replay.test.js`
Expected: FAIL (Replay feature not implemented)

- [ ] **Step 3: Implement Replay and Broadcast logic**
In `nexus.js`:
- Add `this.eventLog = []` (capped at 500).
- Modify `onMessage` to assign a sequential `eventId` to every incoming `log` event.
- If `hello` event contains `last_event_id`, send all missed events.
- Implement `broadcastToTask(taskId, message)`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/gemini-cli/nexus-replay.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add .gemini/task-polyfill/nexus.js tests/gemini-cli/nexus-replay.test.js
git commit -m "feat(nexus): implement event replay buffer and task broadcasting"
```

---

### Task 2: Subagent "Dead Man's Switch" (Active Watchdog)

**Files:**
- Modify: `.gemini/task-polyfill/summon.js`
- Test: `tests/gemini-cli/dead-mans-switch.test.js`

- [ ] **Step 1: Write the failing test for Dead Man's Switch**
```javascript
// Test: Spawn subagent. Do NOT update sentinel.alive. Verify subagent self-terminates after 30s.
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/gemini-cli/dead-mans-switch.test.js`
Expected: FAIL (Subagent continues running indefinitely)

- [ ] **Step 3: Implement Active Watchdog in `summon.js`**
In `summon.js` (inside `heartbeat` interval):
- Check `fs.statSync('.swarm/sentinel.alive')`.
- If `Date.now() - stats.mtimeMs > 30000`, invoke `handleKill('SENTINEL_DEAD')`.
- Skip check if file doesn't exist yet (Sentinel might be starting).

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/gemini-cli/dead-mans-switch.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add .gemini/task-polyfill/summon.js tests/gemini-cli/dead-mans-switch.test.js
git commit -m "security(summon): implement mtime-based Dead Man's Switch for subagent self-termination"
```

---

### Task 3: Sentinel Core & Heuristics (Rolling Buffer)

**Files:**
- Create: `.gemini/task-polyfill/sentinel.js`
- Test: `tests/gemini-cli/sentinel-core.test.js`

- [ ] **Step 1: Write failing tests for Sentinel connection and heuristics**
```javascript
// Test: Sentinel connects, touches .alive every 10s, exits with code 10 on 'npm ERR!'
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/gemini-cli/sentinel-core.test.js`
Expected: FAIL (sentinel.js does not exist)

- [ ] **Step 3: Implement `sentinel.js` Core**
- Parse CLI args: `<taskId>`.
- Read `.swarm/nexus.json` and connect using `NexusClient` (can abstract or duplicate minimal client).
- Implement `setInterval` to `fs.utimesSync('.swarm/sentinel.alive', new Date(), new Date())` every 10s.
- Accumulate last 100 lines of `log` events in an array.
- Run Regex heuristics on new logs (e.g., `/npm ERR!/`, `/[SENTINEL_WAKE_UP]/`).
- If triggered: write `.swarm/sentinel-report.json`, send `interrupt` via Nexus, and `process.exit(10)`.
- If `bye` event received: `process.exit(0)`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/gemini-cli/sentinel-core.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add .gemini/task-polyfill/sentinel.js tests/gemini-cli/sentinel-core.test.js
git commit -m "feat(sentinel): implement proxy awareness core with Regex and SOS triggers"
```

---

### Task 4: Sentinel Micro-LLM Integration (Flash-Lite)

**Files:**
- Modify: `.gemini/task-polyfill/sentinel.js`
- Modify: `.gemini/task-polyfill/lib/fs.js` (for secure key reading, if necessary)
- Test: `tests/gemini-cli/sentinel-cognitive.test.js`

- [ ] **Step 1: Write failing test for cognitive trigger**
```javascript
// Test: Mock HTTPS server. Sentinel sends log buffer, mock returns "Yes, stuck". Sentinel exits code 10.
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/gemini-cli/sentinel-cognitive.test.js`
Expected: FAIL 

- [ ] **Step 3: Implement Cognitive Check**
In `sentinel.js`:
- Read API key strictly from `process.env.GOOGLE_API_KEY` or `process.stdin` (DO NOT log it).
- Every 3 minutes, use `node:https` to make a POST request to `generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`.
- Prompt: "Evaluate these logs. Is the agent stuck in a loop or hallucinating? Reply strictly YES or NO."
- If response includes YES, trigger intervention.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/gemini-cli/sentinel-cognitive.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add .gemini/task-polyfill/sentinel.js tests/gemini-cli/sentinel-cognitive.test.js
git commit -m "feat(sentinel): integrate Flash-Lite for low-cost cognitive log evaluation"
```
