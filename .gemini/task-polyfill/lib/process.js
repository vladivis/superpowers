import * as os from 'os';
import * as fs from 'fs';
import { execSync } from 'child_process';

export function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

export function getProcessStartTime(pid) {
  try {
    if (os.platform() === 'win32') {
      try {
        const psCommand = `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`;
        const psOutput = execSync(`powershell -NoProfile -Command "${psCommand}"`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (psOutput) return Date.parse(psOutput);
      } catch (e) {
        // Fallback to WMIC
        const output = execSync(`wmic process where processid=${pid} get creationdate`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return 0;
        const dateStr = lines[1];
        const year = dateStr.slice(0, 4);
        const month = dateStr.slice(4, 6);
        const day = dateStr.slice(6, 8);
        const hour = dateStr.slice(8, 10);
        const min = dateStr.slice(10, 12);
        const sec = dateStr.slice(12, 14);
        const ms = dateStr.slice(15, 18);
        const timezoneMatch = dateStr.match(/([+-]\d{3})$/);
        const tzOffset = timezoneMatch ? parseInt(timezoneMatch[1], 10) : 0;
        
        const d = new Date(Date.UTC(year, month - 1, day, hour, min, sec, ms));
        d.setMinutes(d.getMinutes() - tzOffset);
        return d.getTime();
      }
    } else if (os.platform() === 'darwin') {
      const output = execSync(`ps -p ${pid} -o lstart=`, { encoding: 'utf-8' }).trim();
      if (!output) return 0;
      return Date.parse(output);
    } else {
      const statContent = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
      const statMatch = statContent.match(/^\d+\s+\([^)]+\)\s+(.*)$/);
      if (!statMatch) return 0;
      const fields = statMatch[1].split(/\s+/);
      const jiffies = parseInt(fields[19], 10);
      
      const sysStatContent = fs.readFileSync('/proc/stat', 'utf-8');
      const btimeMatch = sysStatContent.match(/^btime\s+(\d+)/m);
      if (!btimeMatch) return 0;
      const btime = parseInt(btimeMatch[1], 10);
      
      const sysConfOutput = execSync('getconf CLK_TCK', { encoding: 'utf-8' }).trim();
      const HZ = parseInt(sysConfOutput, 10) || 100;
      
      const startSecs = btime + (jiffies / HZ);
      return Math.floor(startSecs * 1000);
    }
  } catch (e) {
    return 0;
  }
}

export function isIdentityVerified(pid, recordedStartTime) {
  if (!isProcessRunning(pid)) return false;
  const currentStart = getProcessStartTime(pid);
  if (!currentStart) return false;
  return Math.abs(currentStart - recordedStartTime) <= 5000;
}

export function killTree(pid) {
  try {
    if (os.platform() === 'win32') {
      execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (e) {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch (e) {
    // Ignore errors when trying to kill
  }
}
