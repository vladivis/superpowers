# Swarm Nexus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a zero-dependency WebSocket-based IPC bus for real-time full-duplex communication between the orchestrator and subagents.

**Architecture:** A lightweight Node.js WebSocket server (Nexus) using native `http` and `crypto` modules. Subagents connect via a specialized client wrapper in `summon.js`. Discovery is handled through an atomic `nexus.json` beacon file.

**Tech Stack:** Node.js (native), RFC 6455 (WebSockets), Vitest.

---

### Task 1: Nexus Server Core (RFC 6455 Handshake)

**Files:**
- Create: `.gemini/task-polyfill/nexus.js`
- Test: `tests/gemini-cli/nexus-core.test.js`

- [ ] **Step 1: Write the failing test for WebSocket handshake**
    - Verify `Sec-WebSocket-Accept` header calculation using magic string `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`.
- [ ] **Step 2: Implement the RFC 6455 handshake logic**
    - Use `http.createServer()` and listen for the `upgrade` event.
- [ ] **Step 3: Verify handshake with test**
- [ ] **Step 4: Commit**

### Task 2: Nexus Framing, Protocol & 64-bit Payloads

**Files:**
- Modify: `.gemini/task-polyfill/nexus.js`
- Test: `tests/gemini-cli/nexus-protocol.test.js`

- [ ] **Step 1: Write test for frame encoding/decoding**
    - Must cover: 7-bit, 16-bit, and 64-bit lengths.
    - Must cover: Masked (client-to-server) and Unmasked (server-to-client) frames.
    - Must cover: Opcode `0x1` (Text), `0x9` (Ping), `0xA` (Pong).
- [ ] **Step 2: Implement frame parsing with fragmentation support**
    - Handle the `FIN` bit and continuation frames if necessary.
- [ ] **Step 3: Implement JSON event protocol & security**
    - Events: `hello`, `log`, `ping`, `interrupt`, `bye`.
    - Secure token verification using `crypto.timingSafeEqual`.
- [ ] **Step 4: Verify protocol with tests**
- [ ] **Step 5: Commit**

### Task 3: Client Integration & PGID Interruption

**Files:**
- Modify: `.gemini/task-polyfill/summon.js`
- Test: `tests/gemini-cli/nexus-client.test.js`

- [ ] **Step 1: Implement minimal WebSocket client in `summon.js`**
    - Use `http.request()` for the handshake and a raw TCP socket for framing.
- [ ] **Step 2: Update `spawn` logic to pipe output into Nexus**
    - Stream `stdout`/`stderr` as `log` events in real-time.
- [ ] **Step 3: Implement `interrupt` signal handling**
    - Logic: On `interrupt` event, execute `process.kill(-childPid, 'SIGTERM')` to kill the entire process group.
- [ ] **Step 4: Verify client connectivity and real-time log streaming**
- [ ] **Step 5: Commit**

### Task 4: Parent Lifecycle, Discovery & Timeouts

**Files:**
- Modify: `.gemini/task-polyfill/init_env.js`
- Test: `tests/gemini-cli/nexus-integration.test.js`

- [ ] **Step 1: Implement dynamic port binding (:0) and atomic `nexus.json` creation**
    - Write the beacon ONLY after the `listening` event is fired.
- [ ] **Step 2: Add server-side connection health checks**
    - Close stale connections if no `Pong` is received within 30 seconds.
- [ ] **Step 3: Write full end-to-end integration test**
    - Simulate 10 agents streaming logs concurrently to the Nexus.
- [ ] **Step 4: Verify entire system passes and Cleanup**
- [ ] **Step 5: Commit**
