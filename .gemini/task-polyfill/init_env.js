#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { NexusServer } from './nexus.js';

// Modular Swarm Imports
import { acquireAtomicLock, releaseAtomicLock } from './lib/fs.js';
import { isIdentityVerified, killTree, isProcessRunning } from './lib/process.js';

const ROOT_DIR = process.cwd();
const SWARM_DIR = join(ROOT_DIR, '.swarm');
const NEXUS_BEACON = join(SWARM_DIR, 'nexus.json');

const CONFIG = {
  LOCK_TIMEOUT_MS: 60000,
};

async function init() {
  try {
    mkdirSync(SWARM_DIR, { recursive: true });
    mkdirSync(join(ROOT_DIR, '.worktrees'), { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') {
      console.error("[Init] Critical: Failed to create directories:", e.message);
      process.exit(1);
    }
  }

  // 1. Zombie Reaper using Modular Process Primitives
  reapZombies();

  // 2. Git Exclude Initialization using Modular Atomic Locking
  const gitPathProc = spawnSync('git', ['rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8' });

  if (gitPathProc.status === 0 && gitPathProc.stdout) {
    const excludePath = resolve(ROOT_DIR, gitPathProc.stdout.trim());
    
    let lockId;
    try {
      lockId = acquireAtomicLock(excludePath, CONFIG.LOCK_TIMEOUT_MS);
    } catch (e) {
      console.error(`[Init] Aborting: Failed to acquire atomic lock for ${excludePath}`);
      process.exit(1);
    }

    try {
      updateExcludeFile(excludePath);
    } finally {
      releaseAtomicLock(excludePath, lockId);
    }
  }

  if (process.argv.includes('--start-nexus')) {
    startNexus();
  }
}

function updateExcludeFile(path) {
  try {
    let content = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const lines = content.split(/\r?\n/);
    let changed = false;
    ['.swarm/', '.worktrees/'].forEach(entry => {
      if (!lines.includes(entry)) {
        content += (content.endsWith('\n') || content === '' ? '' : '\n') + entry + '\n';
        changed = true;
      }
    });
    if (changed) writeFileSync(path, content);
  } catch (e) {
    console.error(`[Init] Exclude update failed: ${e.message}`);
  }
}

function reapZombies() {
  if (!existsSync(SWARM_DIR)) return;
  const files = readdirSync(SWARM_DIR);
  for (const file of files) {
    if (file.endsWith('.running.json')) {
      const filePath = join(SWARM_DIR, file);
      try {
        const data = JSON.parse(readFileSync(filePath, 'utf8'));
        const { orchestratorPid, orchestratorStartTime, childPid, childStartTime } = data;
        
        // Verify parent identity using PID + StartTime (Modular logic)
        if (orchestratorPid && !isIdentityVerified(orchestratorPid, orchestratorStartTime)) {
          if (childPid && isIdentityVerified(childPid, childStartTime)) {
            console.warn(`[Reaper] Harvesting orphaned child process ${childPid}`);
            killTree(childPid);
          }
          rmSync(filePath, { force: true });
          const logPath = filePath.replace('.running.json', '.output.log');
          rmSync(logPath, { force: true });
        }
      } catch (e) {}
    }
  }
}

async function startNexus() {
  const token = randomBytes(32).toString('hex');
  const nexus = new NexusServer(token);
  nexus.onMessage((client, msg) => {
    if (msg.type === 'log') process.stdout.write(`[Agent:${client.id}] ${msg.data}`);
  });
  const port = await nexus.listen(0);
  writeFileSync(NEXUS_BEACON, JSON.stringify({ port, token, pid: process.pid, startTime: Date.now() }));
  console.log(`[Swarm] Nexus active on port ${port}`);
  process.on('exit', () => { try { rmSync(NEXUS_BEACON, { force: true }); } catch (e) {} });
  // Keep alive
  setInterval(() => {}, 10000);
}

init().catch(err => {
  console.error("[Init] Fatal:", err.message);
  process.exit(1);
});
