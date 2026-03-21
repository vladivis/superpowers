import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

/**
 * Creates a unique sandbox directory for a test run.
 * Initializes git so orchestrators can create worktrees.
 */
export function createSandbox(name) {
  const id = randomBytes(4).toString('hex');
  const sandboxPath = join(tmpdir(), `swarm-test-${name}-${id}`);
  
  if (existsSync(sandboxPath)) rmSync(sandboxPath, { recursive: true, force: true });
  mkdirSync(sandboxPath, { recursive: true });
  mkdirSync(join(sandboxPath, '.swarm'), { recursive: true });
  mkdirSync(join(sandboxPath, '.worktrees'), { recursive: true });
  
  // Initialize git to satisfy orchestrator requirements
  spawnSync('git', ['init', '--quiet'], { cwd: sandboxPath });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: sandboxPath });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: sandboxPath });
  // Create a dummy commit so worktree add -b works
  writeFileSync(join(sandboxPath, 'README.md'), '# Test Sandbox');
  spawnSync('git', ['add', '.'], { cwd: sandboxPath });
  spawnSync('git', ['commit', '-m', 'initial', '--quiet'], { cwd: sandboxPath });
  
  return sandboxPath;
}

/**
 * Cleans up the sandbox directory.
 */
export function cleanupSandbox(path) {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (e) {}
}
