import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { 
  isProcessRunning, 
  getProcessStartTime, 
  isIdentityVerified, 
  killTree 
} from '../../.gemini/task-polyfill/lib/process.js';
import {
  acquireAtomicLock,
  releaseAtomicLock,
  resolveSecureCommand,
  gitPath
} from '../../.gemini/task-polyfill/lib/fs.js';

describe('process.js', () => {
  it('isProcessRunning returns true for own process and false for non-existent', () => {
    expect(isProcessRunning(process.pid)).toBe(true);
    expect(isProcessRunning(9999999)).toBe(false);
  });

  it('getProcessStartTime gets start time for current process', () => {
    const startTime = getProcessStartTime(process.pid);
    expect(typeof startTime).toBe('number');
    expect(startTime).toBeGreaterThan(0);
    // Should be close to Date.now() or at least valid
    expect(Date.now() - startTime).toBeGreaterThan(0);
  });

  it('isIdentityVerified verifies process identity with 5s tolerance', () => {
    const startTime = getProcessStartTime(process.pid);
    expect(isIdentityVerified(process.pid, startTime)).toBe(true);
    expect(isIdentityVerified(process.pid, startTime - 6000)).toBe(false);
    expect(isIdentityVerified(process.pid, startTime + 6000)).toBe(false);
  });

  it('killTree terminates a process tree', async () => {
    const child = spawn('node', ['-e', 'setTimeout(() => {}, 10000)']);
    expect(isProcessRunning(child.pid)).toBe(true);
    
    await new Promise(r => setTimeout(r, 100));
    
    killTree(child.pid);
    
    await new Promise(r => setTimeout(r, 1000));
    expect(isProcessRunning(child.pid)).toBe(false);
  });
});

describe('fs.js', () => {
  const tmpDir = path.join(os.tmpdir(), `gemini-test-fs-${Date.now()}`);
  
  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('atomic locks', () => {
    it('acquireAtomicLock acquires a lock and releaseAtomicLock releases it', () => {
      const lockPath = path.join(tmpDir, 'test1');
      const lockId = acquireAtomicLock(lockPath, 5000);
      
      expect(lockId).toBeTruthy();
      expect(fs.existsSync(`${lockPath}.lock.dir`)).toBe(true);
      
      releaseAtomicLock(lockPath, lockId);
      expect(fs.existsSync(`${lockPath}.lock.dir`)).toBe(false);
    });

    it('acquireAtomicLock fails if locked by another active process', () => {
      const lockPath = path.join(tmpDir, 'test2');
      const lockDir = `${lockPath}.lock.dir`;
      fs.mkdirSync(lockDir);
      
      const startTime = getProcessStartTime(process.pid);
      fs.writeFileSync(path.join(lockDir, 'owner'), `${process.pid}:${startTime}:mockToken`);
      
      expect(() => acquireAtomicLock(lockPath, 1000)).toThrow(/lock/i);
    });
    
    it('acquireAtomicLock recovers stale lock', () => {
      const lockPath = path.join(tmpDir, 'test3');
      const lockDir = `${lockPath}.lock.dir`;
      fs.mkdirSync(lockDir);
      
      fs.writeFileSync(path.join(lockDir, 'owner'), `9999999:123456789:mockToken`);
      
      const lockId = acquireAtomicLock(lockPath, 1000);
      expect(lockId).toBeTruthy();
      expect(fs.existsSync(lockDir)).toBe(true);
      
      releaseAtomicLock(lockPath, lockId);
    });
  });

  describe('resolveSecureCommand', () => {
    it('resolves node in system PATH', () => {
      const nodePath = resolveSecureCommand('node');
      expect(nodePath).toBeTruthy();
      expect(path.isAbsolute(nodePath)).toBe(true);
    });

    it('throws error if not found', () => {
      expect(() => resolveSecureCommand('nonexistent_command_12345')).toThrow(/not found/i);
    });
  });

  describe('gitPath', () => {
    it('normalizes to forward slashes', () => {
      const p = 'some\\windows\\path/with/mixed\\slashes';
      expect(gitPath(p)).toBe('some/windows/path/with/mixed/slashes');
    });
  });
});
