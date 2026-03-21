import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { isIdentityVerified, getProcessStartTime } from './process.js';

export function acquireAtomicLock(targetPath, timeoutMs = 5000) {
  const lockDir = `${targetPath}.lock.dir`;
  const startTime = Date.now();
  const lockToken = crypto.randomUUID();
  const myPid = process.pid;
  const myStart = getProcessStartTime(myPid);
  const ownerData = `${myPid}:${myStart}:${lockToken}`;

  while (Date.now() - startTime < timeoutMs) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'owner'), ownerData);
      return lockToken;
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          const currentOwner = fs.readFileSync(path.join(lockDir, 'owner'), 'utf-8');
          const [pidStr, tsStr] = currentOwner.split(':');
          const pid = parseInt(pidStr, 10);
          const ts = parseInt(tsStr, 10);

          if (pid && ts && !isIdentityVerified(pid, ts)) {
            const recoveryDir = `${targetPath}.lock.recovery.${myPid}.${Date.now()}`;
            try {
              fs.renameSync(lockDir, recoveryDir);
              fs.rmSync(recoveryDir, { recursive: true, force: true });
              continue;
            } catch (renameErr) {}
          }
        } catch (readErr) {}
        
        try {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        } catch (e) {
          const end = Date.now() + 50;
          while (Date.now() < end) {}
        }
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Failed to acquire lock on ${targetPath} within ${timeoutMs}ms`);
}

export function releaseAtomicLock(targetPath, myLockId) {
  const lockDir = `${targetPath}.lock.dir`;
  try {
    const currentOwner = fs.readFileSync(path.join(lockDir, 'owner'), 'utf-8');
    const parts = currentOwner.split(':');
    if (parts.length === 3 && parts[2] === myLockId) {
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  } catch (err) {}
}

/**
 * Securely resolves a command to its absolute path.
 */
export function resolveSecureCommand(cmd) {
  // 1. Handle absolute paths directly (with security check)
  if (path.isAbsolute(cmd)) {
    if (fs.existsSync(cmd)) {
      const stat = fs.statSync(cmd);
      if (stat.isFile()) {
        try {
          fs.accessSync(cmd, fs.constants.X_OK);
          return cmd;
        } catch (e) {}
      }
    }
    throw new Error(`Absolute path '${cmd}' is not a valid executable file.`);
  }

  // 2. Resolve via secure PATH search
  const pathEnv = process.env.PATH || '';
  const paths = pathEnv.split(path.delimiter);
  
  for (const p of paths) {
    if (!p || !path.isAbsolute(p)) continue; // Strictly ignore relative paths in PATH
    
    const exts = os.platform() === 'win32' ? ['.cmd', '.bat', '.exe', ''] : [''];
    
    for (const ext of exts) {
      const fullPath = path.join(p, cmd + ext);
      try {
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            fs.accessSync(fullPath, fs.constants.X_OK);
            return fullPath;
          }
        }
      } catch (e) {}
    }
  }
  
  throw new Error(`Command '${cmd}' not found in secure system PATH`);
}

export function gitPath(p) {
  return p.replace(/\\/g, '/');
}
