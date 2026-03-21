import { test, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox, cleanupSandbox } from './test-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '../..');

let sandboxPath;
let swarmDir;

beforeAll(() => {
  sandboxPath = createSandbox('orchestrator');
  swarmDir = join(sandboxPath, '.swarm');
});

afterAll(async () => {
  cleanupSandbox(sandboxPath);
});

test('Concurrent Worktree Creation and Swarm Execution', async () => {
  const NUM_AGENTS = 5;
  const promises = [];
  const summonScript = join(ROOT_DIR, '.gemini/task-polyfill/summon.js');
  const mockAgentPath = join(ROOT_DIR, 'tests/gemini-cli/heavy-mock-agent.js');

  for (let i = 0; i < NUM_AGENTS; i++) {
    promises.push(new Promise((resolve) => {
      const taskId = `stress-task-${i}`;
      const proc = spawn(process.execPath, [
        summonScript,
        taskId,
        "Mock prompt",
        "flash"
      ], {
        cwd: sandboxPath,
        env: { 
          ...process.env, 
          GEMINI_CMD: `"${process.execPath}" "${mockAgentPath}"`
        }
      });

      proc.on('close', (code) => resolve({ taskId, code }));
    }));
  }

  const results = await Promise.all(promises);

  for (const res of results) {
    expect(res.code).toBe(0);
    const completeFile = join(swarmDir, `${res.taskId}.complete.json`);
    expect(existsSync(completeFile)).toBe(true);
    const d = JSON.parse(readFileSync(completeFile, 'utf8'));
    expect(d.status).toBe('success');
  }
}, 60000);
