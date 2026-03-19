import { test, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { NexusServer } from '../../.gemini/task-polyfill/nexus.js';
import { randomBytes } from 'node:crypto';
import { createSandbox, cleanupSandbox } from './test-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '../..');

let sandboxPath;
let swarmDir;
let beaconPath;
let nexus;
let testToken;

beforeAll(async () => {
  sandboxPath = createSandbox('nexus-heavy');
  swarmDir = join(sandboxPath, '.swarm');
  beaconPath = join(swarmDir, 'nexus.json');
  
  testToken = randomBytes(16).toString('hex');
  nexus = new NexusServer(testToken);
  
  const port = await nexus.listen(0);
  
  writeFileSync(beaconPath, JSON.stringify({
    port,
    token: testToken,
    pid: process.pid,
    startTime: Date.now()
  }));
});

afterAll(() => {
  if (nexus) nexus.close();
  cleanupSandbox(sandboxPath);
});

test('Nexus Heavy: Real Multi-process Swarm', async () => {
  console.log('\n[HeavyTest] Swarm is active in sandbox. Spawning 5 REAL sustained orchestrators...');

  const summonScript = join(ROOT_DIR, '.gemini/task-polyfill/summon.js');
  const mockAgentPath = join(ROOT_DIR, 'tests/gemini-cli/heavy-mock-agent.js');
  const promises = [];

  for (let i = 0; i < 5; i++) {
    promises.push(new Promise((resolve) => {
      const taskId = `heavy-task-${i}`;
      const proc = spawn(process.execPath, [
        summonScript,
        taskId,
        "Heavy Validation Prompt",
        "flash"
      ], {
        cwd: sandboxPath,
        env: { 
          ...process.env, 
          GEMINI_CMD: mockAgentPath
        }
      });
      
      proc.on('close', (code) => resolve({ taskId, code }));
    }));
  }

  const results = await Promise.all(promises);
  for (const res of results) {
    expect(res.code).toBe(0);
  }

  console.log('[HeavyTest] Swarm successfully completed the sustained workload.');
}, 60000);
