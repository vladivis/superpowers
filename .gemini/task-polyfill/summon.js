#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve, normalize, sep, delimiter } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, existsSync, createWriteStream, statSync, openSync, readSync, closeSync, cpSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';

// Import our high-integrity modules
import { resolveSecureCommand, gitPath } from './lib/fs.js';
import { killTree, isIdentityVerified } from './lib/process.js';
import { SafeDecoder, encodeFrame } from './lib/protocol.js';

// --- Constants ---
const CONFIG = {
  HEARTBEAT_INTERVAL_MS: 10000,
  GIT_LOCK_RETRIES: 15,
  GIT_LOCK_JITTER_MS: 2000,
  WORKTREE_RETRIES: 5,
  MAX_RETRY_ATTEMPTS: 3,
  MAX_SUMMARY_SIZE_BYTES: 1024 * 1024,
  MAX_TOTAL_LOG_SIZE_BYTES: 10 * 1024 * 1024,
  MAX_EXECUTION_TIME_MS: 15 * 60 * 1000,
  FALLBACK_MODEL: 'flash'
};

const isWindows = process.platform === 'win32';
const [, , taskId, prompt, model, targetWt] = process.argv;

if (!taskId || !/^[a-zA-Z0-9_-]+$/.test(taskId)) { process.exit(1); }
if (model && !/^[a-zA-Z0-9.-]+$/.test(model)) { process.exit(1); }

if (!prompt) {
  console.error("Usage: node summon.js <task_id> <prompt> [model] [target_worktree_path]");
  process.exit(1);
}

const ROOT_DIR = process.cwd();
const SWARM_DIR = join(ROOT_DIR, '.swarm');
const WT_BASE_DIR = join(ROOT_DIR, '.worktrees');
const NEXUS_BEACON = join(SWARM_DIR, 'nexus.json');

// Security: Target worktree must be within the project's .worktrees directory
let validatedWtPath = null;
if (targetWt) {
  const resolvedTarget = resolve(ROOT_DIR, targetWt);
  const normalizedWtBase = normalize(WT_BASE_DIR) + sep;
  if (!resolvedTarget.startsWith(normalizedWtBase)) {
    process.exit(1);
  }
  validatedWtPath = resolvedTarget;
}

mkdirSync(SWARM_DIR, { recursive: true });

// --- Nexus Client ---
class NexusClient {
  constructor(port, token, agentId, taskId) {
    this.port = port;
    this.token = token;
    this.agentId = agentId;
    this.taskId = taskId;
    this.socket = null;
    this.connected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const key = randomBytes(16).toString('base64');
      this.socket = connect(this.port, '127.0.0.1');
      const headers = [`GET / HTTP/1.1`, `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Key: ${key}`, `Sec-WebSocket-Version: 13`, `X-Nexus-Token: ${this.token}`, `\r\n`];
      this.socket.write(headers.join('\r\n'));

      let handshakeBuffer = '';
      const onData = (data) => {
        handshakeBuffer += data.toString();
        if (handshakeBuffer.includes('\r\n\r\n')) {
          if (handshakeBuffer.includes('101 Switching Protocols')) {
            this.connected = true;
            this.socket.removeListener('data', onData);
            this.send({ type: 'hello', agentId: this.agentId, taskId: this.taskId });
            resolve();
          } else {
            this.socket.removeListener('data', onData);
            reject(new Error('Nexus handshake failed'));
          }
        }
      };
      this.socket.on('data', onData);
      this.socket.on('error', (err) => { this.connected = false; if (!this.connected) reject(err); });
    });
  }

  send(message) {
    if (this.connected && !this.socket.destroyed) {
      this.socket.write(encodeFrame(JSON.stringify(message), 0x1, true, true));
    }
  }

  onInterrupt(callback) {
    this.socket.on('data', (data) => {
      if (data.toString().includes('"type":"interrupt"')) callback();
    });
  }
}

async function runGit(args, cwd = ROOT_DIR) {
  for (let count = 0; count < CONFIG.GIT_LOCK_RETRIES; count++) {
    try {
      return await new Promise((resolve, reject) => {
        const proc = spawn('git', args, { cwd, stdio: 'pipe' });
        let out = '';
        proc.stdout.on('data', (d) => out += d);
        proc.stderr.on('data', (d) => out += d);
        proc.on('close', (code) => {
          if (code === 0) resolve(out);
          else reject(new Error(`Git exit ${code}: ${out}`));
        });
        proc.on('error', reject);
      });
    } catch (e) {
      if (e.message.includes('index.lock') || e.message.includes('locked')) {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * CONFIG.GIT_LOCK_JITTER_MS));
      } else throw e;
    }
  }
  throw new Error("Git wrapper failed after retries due to locks.");
}

function failWithSignal(message) {
  const tmpDone = join(SWARM_DIR, `${taskId}.complete.tmp`);
  const finalDone = join(SWARM_DIR, `${taskId}.complete.json`);
  const finalRun = join(SWARM_DIR, `${taskId}.running.json`);
  try {
    writeFileSync(tmpDone, JSON.stringify({ status: "error", exitCode: 1, summary: message, branch: `task/${taskId}` }));
    renameSync(tmpDone, finalDone);
    try { if (existsSync(finalRun)) rmSync(finalRun, { force: true }); } catch (e) {}
  } catch(e) { console.error("[Swarm] Emergency signal failure:", e.message); }
}

async function main() {
  const startTimeTotal = Date.now();
  let wtPath = validatedWtPath || join(WT_BASE_DIR, taskId);
  if (!validatedWtPath) {
    mkdirSync(WT_BASE_DIR, { recursive: true });
    let created = false;
    for (let i = 0; i < CONFIG.WORKTREE_RETRIES; i++) {
      try {
        await runGit(['worktree', 'add', gitPath(wtPath), '-b', `task/${taskId}`]);
        created = true;
        break;
      } catch (e) {
        if (e.message.includes('already exists') || e.message.includes('fatal')) {
          failWithSignal(e.message); process.exit(1);
        }
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
    if (!created) { failWithSignal(`Failed to create worktree for ${taskId}`); process.exit(1); }
  }

  const tmpRun = join(SWARM_DIR, `${taskId}.running.tmp`);
  const finalRun = join(SWARM_DIR, `${taskId}.running.json`);
  const outLog = join(SWARM_DIR, `${taskId}.output.log`);
  const tmpDone = join(SWARM_DIR, `${taskId}.complete.tmp`);
  const finalDone = join(SWARM_DIR, `${taskId}.complete.json`);

  writeFileSync(tmpRun, JSON.stringify({ orchestratorPid: process.pid, orchestratorStartTime: Date.now(), branch: `task/${taskId}`, model: model || "default" }));
  renameSync(tmpRun, finalRun);

  // Disable interactive shell for the sub-agent to avoid node-pty/AttachConsole errors on Windows
  const localSettingsDir = join(wtPath, '.gemini');
  const localSettingsPath = join(localSettingsDir, 'settings.json');
  try {
    if (!existsSync(localSettingsDir)) mkdirSync(localSettingsDir, { recursive: true });
    writeFileSync(localSettingsPath, JSON.stringify({
      tools: {
        shell: {
          enableInteractiveShell: false
        }
      }
    }, null, 2));

    // Ensure this file is ignored locally in the main repo to prevent accidental commits
    const gitExcludePath = join(ROOT_DIR, '.git', 'info', 'exclude');
    if (existsSync(gitExcludePath)) {
      const excludeContent = readFileSync(gitExcludePath, 'utf8');
      if (!excludeContent.includes('.gemini/settings.json')) {
        writeFileSync(gitExcludePath, excludeContent + '\n.gemini/settings.json\n');
      }
    }
  } catch (e) {
    console.error(`[Summoner] Warning: Failed to create local settings: ${e.message}`);
  }

  let nexus = null;
  if (existsSync(NEXUS_BEACON)) {
    try {
      const beacon = JSON.parse(readFileSync(NEXUS_BEACON, 'utf8'));
      nexus = new NexusClient(beacon.port, beacon.token, 'subagent-' + taskId, taskId);
      await nexus.connect().catch(() => { nexus = null; });
    } catch (e) {}
  }

  let currentProc = null;
  const outDecoder = new SafeDecoder();
  const errDecoder = new SafeDecoder();

  const handleKill = (signal) => {
    if (nexus) {
      const finalOut = outDecoder.flush();
      const finalErr = errDecoder.flush();
      if (finalOut) nexus.send({ type: 'log', data: finalOut });
      if (finalErr) nexus.send({ type: 'log', data: finalErr });
    }
    killChild();
    const msg = `Orchestrator received ${signal}, killing subagent.`;
    if (nexus) nexus.send({ type: 'log', data: '\n' + msg });
    failWithSignal(msg);
    process.exit(1);
  };

  const killChild = () => { 
    if (currentProc && currentProc.pid) { 
      killTree(currentProc.pid);
      try { currentProc.kill('SIGKILL'); } catch(e) {}
    } 
  };

  process.on('exit', () => currentProc && killChild());
  process.on('SIGINT', () => handleKill('SIGINT'));
  process.on('SIGTERM', () => handleKill('SIGTERM'));
  if (nexus) nexus.onInterrupt(() => handleKill('NEXUS_INTERRUPT'));

  const heartbeat = setInterval(() => {
    try {
      if (Date.now() - startTimeTotal > CONFIG.MAX_EXECUTION_TIME_MS) { clearInterval(heartbeat); handleKill('TIMEOUT'); return; }
      if (existsSync(outLog)) {
        try { if (statSync(outLog).size > CONFIG.MAX_TOTAL_LOG_SIZE_BYTES) { clearInterval(heartbeat); handleKill('LOG_OVERFLOW'); return; } } catch (e) {}
      }
      let content;
      try { content = readFileSync(finalRun, 'utf8'); } catch (e) { return; }
      const d = JSON.parse(content);
      d.lastHeartbeat = new Date().toISOString();
      writeFileSync(tmpRun, JSON.stringify(d));
      renameSync(tmpRun, finalRun);
      if (nexus) nexus.send({ type: 'ping' });
    } catch (e) {}
  }, CONFIG.HEARTBEAT_INTERVAL_MS);

  // Handle multi-part commands (e.g., "node mock.js")
  let geminiCommand = process.env.GEMINI_CMD || 'gemini';
  let initialArgs = [];
  if (geminiCommand.includes(' ')) {
    const parts = geminiCommand.match(/(?:[^\s"]+|"[^"]*")+/g) || [geminiCommand];
    geminiCommand = parts[0].replace(/^"|"$/g, '');
    initialArgs = parts.slice(1).map(p => p.replace(/^"|"$/g, ''));
  }
  
  // Auto-detect gemini.cmd on Windows to avoid shell execution policy issues (.ps1 blocked)
  if (isWindows && geminiCommand === 'gemini' && !process.env.GEMINI_CMD) {
    const pathDirs = (process.env.PATH || "").split(delimiter);
    for (const dir of pathDirs) {
      const candidate = join(dir, 'gemini.cmd');
      if (existsSync(candidate)) {
        geminiCommand = candidate;
        break;
      }
    }
  }

  const cmdPath = resolveSecureCommand(geminiCommand);
  let exitCode = 1;
  let currentModel = model || 'auto';

  // --- Windows Direct Node Invocation ---
  let finalExecutable = cmdPath;
  let finalArgsPrefix = [...initialArgs];
  if (isWindows && cmdPath.toLowerCase().endsWith('.cmd')) {
    try {
      const cmdContent = readFileSync(cmdPath, 'utf8');
      const match = cmdContent.match(/"?([^"]*node_modules[\\/]@google[\\/]gemini-cli[\\/]dist[\\/]index\.js)"?/i);
      if (match) {
        let jsPath = match[1];
        if (jsPath.includes('%~dp0')) jsPath = jsPath.replace('%~dp0', dirname(cmdPath) + '\\');
        else if (jsPath.includes('%dp0%')) jsPath = jsPath.replace('%dp0%', dirname(cmdPath) + '\\');
        jsPath = resolve(dirname(cmdPath), jsPath);
        if (existsSync(jsPath)) {
          finalExecutable = process.execPath;
          finalArgsPrefix = [jsPath];
        }
      } else {
        // Fallback for custom or direct paths
        const npmGlobalDir = join(cmdPath, '..');
        const directJsPath = join(npmGlobalDir, 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js');
        if (existsSync(directJsPath)) {
          finalExecutable = process.execPath;
          finalArgsPrefix = [directJsPath];
        }
      }
    } catch (e) {}
  }

  let actualPrompt = prompt;
  const resolvedPromptPath = resolve(ROOT_DIR, prompt);
  const normalizedSwarmDir = normalize(SWARM_DIR) + sep;
  if (resolvedPromptPath.startsWith(normalizedSwarmDir) && existsSync(resolvedPromptPath)) {
    try { actualPrompt = readFileSync(resolvedPromptPath, 'utf8'); } catch (e) {}
  }

  for (let attempt = 1; attempt <= CONFIG.MAX_RETRY_ATTEMPTS; attempt++) {
    const logStream = createWriteStream(outLog, { flags: 'a' });
    try {
      exitCode = await new Promise((resolve) => {
        // SECURITY: On Windows, use shell to provide console for node-pty, 
        // but pass as a single quoted string to avoid DEP0190 array-concat vulnerabilities.
        // currentModel is strictly regex-validated above, so injection is impossible.
        let proc;
        const spawnOpts = { cwd: wtPath, detached: !isWindows, stdio: ['pipe', 'pipe', 'pipe'] };
        const fullArgs = [...finalArgsPrefix, '-m', currentModel, '--prompt', '-', '--yolo'];
        
        if (isWindows && finalExecutable === process.execPath) {
          // Direct node invocation doesn't need shell:true and is more stable
          proc = spawn(finalExecutable, fullArgs, { ...spawnOpts, shell: false });
        } else if (isWindows) {
          // Fallback to shell:true for unknown executables on Windows
          const cmdString = `"${finalExecutable}" ${fullArgs.join(' ')}`;
          proc = spawn(cmdString, { ...spawnOpts, shell: true });
        } else {
          proc = spawn(finalExecutable, fullArgs, { ...spawnOpts, shell: false });
        }
        currentProc = proc;

        try {
          let content;
          try { content = readFileSync(finalRun, 'utf8'); } catch(e) {}
          if (content) {
            const d = JSON.parse(content);
            d.childPid = proc.pid;
            d.childStartTime = Date.now();
            writeFileSync(tmpRun, JSON.stringify(d));
            renameSync(tmpRun, finalRun);
          }
        } catch (e) {}
        
        proc.stdin.write(actualPrompt); proc.stdin.end();
        
        proc.stdout.on('data', (chunk) => {
          logStream.write(chunk);
          if (nexus) nexus.send({ type: 'log', data: outDecoder.write(chunk) });
        });
        proc.stderr.on('data', (chunk) => {
          logStream.write(chunk);
          if (nexus) nexus.send({ type: 'log', data: errDecoder.write(chunk) });
        });
        
        proc.on('close', (code) => {
          if (nexus) {
            const finalOut = outDecoder.flush();
            const finalErr = errDecoder.flush();
            if (finalOut) nexus.send({ type: 'log', data: finalOut });
            if (finalErr) nexus.send({ type: 'log', data: finalErr });
          }
          currentProc = null;
          resolve(code !== null ? code : 1);
        });
        proc.on('error', (err) => {
          currentProc = null;
          const msg = `\nSpawn Error: ${err.message}`;
          logStream.write(msg);
          if (nexus) nexus.send({ type: 'log', data: msg });
          resolve(1);
        });
      });
    } catch (e) { exitCode = 1; }
    if (exitCode === 0) break;
    currentModel = CONFIG.FALLBACK_MODEL;
  }
  
  clearInterval(heartbeat);

  // --- Auto-Finalization (Commit if needed) ---
  if (exitCode === 0) {
    try {
      const status = spawnSync('git', ['status', '--porcelain'], { cwd: wtPath, encoding: 'utf8' });
      if (status.stdout && status.stdout.trim().length > 0) {
        if (nexus) nexus.send({ type: 'log', data: '\n[Summoner] Uncommitted changes detected. Auto-finalizing...\n' });
        spawnSync('git', ['add', '.'], { cwd: wtPath });
        spawnSync('git', ['commit', '-m', `task: automatic finalization of ${taskId}`], { cwd: wtPath });
      }
    } catch (e) {
      if (nexus) nexus.send({ type: 'log', data: `\n[Summoner] Auto-finalization failed: ${e.message}\n` });
    }
  }

  const status = exitCode === 0 ? "success" : "error";
  let summary = "No output captured.";
  if (existsSync(outLog)) {
    let fd = null;
    try {
      const stats = statSync(outLog);
      if (stats.size > CONFIG.MAX_SUMMARY_SIZE_BYTES) {
        fd = openSync(outLog, 'r');
        const buffer = Buffer.alloc(CONFIG.MAX_SUMMARY_SIZE_BYTES);
        readSync(fd, buffer, 0, buffer.length, stats.size - CONFIG.MAX_SUMMARY_SIZE_BYTES);
        let offset = 0;
        while (offset < buffer.length && (buffer[offset] & 0xC0) === 0x80) offset++;
        summary = "...[TRUNCATED HEAD]\n\n" + new TextDecoder('utf-8', { fatal: false }).decode(buffer.slice(offset));
      } else summary = readFileSync(outLog, 'utf8');
    } catch (e) { summary = `Error: ${e.message}`; } finally { if (fd !== null) { try { closeSync(fd); } catch(e) {} } }
  }

  if (nexus) nexus.send({ type: 'bye', exitCode, summary });
  try { writeFileSync(finalDone, JSON.stringify({ status, exitCode, summary, branch: `task/${taskId}` })); } catch (e) {}
  try { if (existsSync(finalRun)) rmSync(finalRun, { force: true }); } catch (e) {}
  try { if (existsSync(outLog)) rmSync(outLog, { force: true }); } catch (e) {}
  if (nexus?.socket) nexus.socket.destroy();
}

main().catch(err => { failWithSignal(err.message); process.exit(1); });
