# Design Spec: Swarm Nexus (Zero-Dep IPC)

**Date:** 2026-03-18
**Status:** Approved (via Final Control Review)
**Topic:** Full-Duplex Subagent Communication via WebSockets

## 1. Problem Statement
The current subagent orchestration relies on file polling (checking `.swarm/*.json` files). This introduces latency, increases disk I/O, and prevents real-time "steering" or streaming of agent thoughts. To scale to a professional "Agentic Organization," we need a low-latency, event-driven communication bus.

## 2. Goals
- **Full-Duplex:** Real-time log streaming from subagents and instant interruption from the orchestrator.
- **Zero-Dependency:** Implementation using only native Node.js modules (`node:http`, `node:crypto`).
- **Resilience:** Dynamic port allocation (binding to `:0`) to avoid collisions.
- **Security:** Local-only (`127.0.0.1`) with token-based authentication and timing-attack protection.

## 3. Architecture

### 3.1 The Nexus Server (`nexus.js`)
A minimal WebSocket server implementation (RFC 6455) using `node:http`'s `upgrade` event.
- **Handshake:** Implements the `Sec-WebSocket-Accept` header calculation using the magic string `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` and SHA-1 hashing.
- **Framing Logic:** 
    - Handles unmasked server-to-client frames.
    - Decodes masked client-to-server frames.
    - Supports 7-bit, 16-bit, and 64-bit payload lengths.
    - Implements Opcode handling: `0x1` (Text), `0x8` (Close), `0x9` (Ping), `0xA` (Pong).
- **Lifecycle:** Boots on a random available port; updates the Discovery Beacon atomically after the `listening` event.

### 3.2 Discovery Mechanism (`.swarm/nexus.json`)
Upon startup, the Parent Agent launches the Nexus and writes its coordinates:
```json
{
  "port": 49152,
  "token": "a1b2c3d4...",
  "pid": 12345
}
```

### 3.3 Protocol (JSON Events)
| Event Type | Direction | Payload |
|------------|-----------|---------|
| `hello` | Client -> Server | `agentId`, `taskId`, `token` |
| `log` | Client -> Server | `data` (partial stdout/stderr) |
| `ping`/`pong` | Bidirectional | Connection keep-alive (30s server-side timeout) |
| `interrupt` | Server -> Client | `reason` (causes subagent PGID kill) |
| `bye` | Client -> Server | `exitCode`, `summary` |

## 4. Implementation Plan
1. **Nexus Core:** Implement RFC 6455 handshake and basic data framing in `skills/brainstorming/scripts/nexus.js`.
2. **Client Wrapper:** Add a lightweight WebSocket client to `summon.js` using `node:http` (for handshake) and raw TCP sockets for framing.
3. **Integration:** Parent Agent launches Nexus on session start; `summon.js` reads `nexus.json` to connect.

## 5. Verification
- **Security:** Verify token verification via `crypto.timingSafeEqual`.
- **Stress Test:** `tests/gemini-cli/nexus-concurrency.test.js` where multiple agents flood the Nexus with logs.
- **Interruption Test:** Verify that sending an `interrupt` event via Nexus correctly kills the child process tree.
