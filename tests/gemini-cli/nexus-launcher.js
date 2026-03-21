#!/usr/bin/env node
import { NexusServer } from '../../.gemini/task-polyfill/nexus.js';
import { writeFileSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT_DIR = process.cwd();
const SWARM_DIR = join(ROOT_DIR, '.swarm');
const NEXUS_BEACON = join(SWARM_DIR, 'nexus.json');

async function launch() {
  const token = process.argv[2] || 'test-token';
  mkdirSync(SWARM_DIR, { recursive: true });

  const nexus = new NexusServer(token);
  
  nexus.onMessage((client, msg) => {
    if (msg.type === 'log') {
      process.stdout.write(`[Agent:${client.id}] ${msg.data}`);
    }
  });

  const port = await nexus.listen(0);
  
  const tmpBeacon = `${NEXUS_BEACON}.tmp`;
  writeFileSync(tmpBeacon, JSON.stringify({
    port,
    token,
    pid: process.pid,
    startTime: new Date().toISOString()
  }));
  renameSync(tmpBeacon, NEXUS_BEACON);

  console.log(`[Swarm] Nexus active on port ${port}`);

  process.on('SIGTERM', () => {
    try { rmSync(NEXUS_BEACON, { force: true }); } catch (e) {}
    process.exit(0);
  });
  
  // Keep process alive
  setInterval(() => {}, 10000);
}

launch().catch(err => {
  console.error("Launcher error:", err.message);
  process.exit(1);
});
