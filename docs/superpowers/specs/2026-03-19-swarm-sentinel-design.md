# Design Spec: Swarm Sentinel (Proxy Awareness)

**Date:** 2026-03-19
**Status:** Approved (via Definitive Pro Audit Round 3)
**Topic:** Real-time Autonomous Monitoring and Steering of Subagents

## 1. Problem Statement
The turn-based nature of Gemini CLI creates a "Carbonite Freeze" effect where the Parent Agent is inactive while subagents execute. Manual polling by the Parent Agent is token-prohibitive. We need a low-cost, real-time "Sentinel" that can monitor subagent progress and wake the Parent Agent only when intervention is required.

## 2. Goals
- **Context Protection:** Use blocking shell calls to "freeze" the Parent Agent context while monitoring via a zero-cost proxy.
- **Real-time Triggering:** Immediate process exit to "wake up" the Parent Agent upon detecting anomalies.
- **Multi-layered Detection:** Use Regex, SOS markers, and periodic Micro-LLM checks (gemini-2.5-flash-lite).
- **Steering:** Enable Parent Agent to read a Sentinel report and issue `interrupt` signals.
- **Mission-Critical Reliability:** Implement a failsafe "Living Heartbeat" and secure credential transport.

## 3. Architecture

### 3.1 The Sentinel Script (`sentinel.js`)
A standalone Node.js script connecting to **Swarm Nexus**.
- **Handshake & Recovery:** Sentinel maintains an internal `last_event_id`. Upon reconnection to Nexus, it requests a replay starting from that ID to ensure zero data loss during network blips.
- **Living Heartbeat (Dead Man's Switch):** Continuously updates (via `fs.utimesSync`) the access/modification time of `.swarm/sentinel.alive` every 10s.
- **Security:** Reads `GOOGLE_API_KEY` strictly via **stdin** or process-scoped environment variables. Credentials MUST NEVER touch the disk (No temporary files).

### 3.2 Detection Layers
1. **Layer 1: Heuristics (Regex):** Constant scanning for fatal errors or infinite loops.
2. **Layer 3: Cognitive (Micro-LLM):** 
   - Periodically (every 2-3m) sends the rolling buffer to `gemini-2.5-flash-lite` via direct `node:https` calls.
   - Asks a binary question: "Is subagent still on track? [Yes/No]".

### 3.3 Wake-Up & Reporting
On trigger, Sentinel:
1. Writes a structured report to `.swarm/sentinel-report.json`.
2. Exits with code `10`. 
3. Parent Agent wakes up, detects code `10`, and performs cognitive steering.

### 3.4 Infrastructure Requirements (Nexus & Subagent Update)
- **Nexus Replay Bus:** `NexusServer` must buffer the last 500 events and support `replaySince(eventId)` requests.
- **Subagent Active Watchdog:** Subagents (in `summon.js`) must monitor the `mtime` of `.swarm/sentinel.alive`. If `Date.now() - mtime > 30s`, subagent MUST self-terminate to prevent orphaned execution.

## 4. Implementation Plan
1. **Nexus Evolution:** Implement cursor-based event buffering and replay logic.
2. **Sentinel Core:** Build the Nexus-connected monitor with Living Heartbeat and secure stdin key loading.
3. **Trigger Engine:** Implement Regex, SOS, and Micro-LLM (HTTPS) logic.
4. **Integration:** Update `subagent-driven-development` skill to orchestrate the Parent-Sentinel-Subagent triangle.

## 5. Verification
- **Zombie Test:** Force-kill Sentinel (SIGKILL); verify subagent self-terminates when heartbeat stops "beating".
- **Security Audit:** Confirm API keys never appear in filesystem journals or orphaned temp files.
- **Replay Test:** Simulate connection drop; verify Sentinel receives missed log lines upon reconnection.
