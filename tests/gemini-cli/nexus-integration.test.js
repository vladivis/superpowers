import { test, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { createSandbox, cleanupSandbox } from './test-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '../..');

let sandboxPath;
let swarmDir;
let beaconPath;

beforeAll(() => {
  sandboxPath = createSandbox('nexus-integration');
  swarmDir = join(sandboxPath, '.swarm');
  beaconPath = join(swarmDir, 'nexus.json');
});

afterAll(() => {
  cleanupSandbox(sandboxPath);
});

async function performHandshake(socket, token) {
  const key = randomBytes(16).toString('base64');
  return new Promise((resolve, reject) => {
    const headers = [
      `GET / HTTP/1.1`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Key: ${key}`,
      `Sec-WebSocket-Version: 13`,
      `X-Nexus-Token: ${token}`,
      `\r\n`
    ];
    socket.write(headers.join('\r\n'));
    socket.once('data', (data) => {
      if (data.toString().includes('101 Switching Protocols')) resolve();
      else reject(new Error('Handshake failed'));
    });
  });
}

function encodeFrame(payload) {
  const buf = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(6);
  header[0] = 0x81;
  header[1] = 0x80 | buf.length;
  const mask = randomBytes(4);
  mask.copy(header, 2);
  const masked = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) masked[i] = buf[i] ^ mask[i % 4];
  return Buffer.concat([header, masked]);
}

test('Nexus Integration: Multi-agent Real-time Streaming', async () => {
  const launcherScript = join(ROOT_DIR, 'tests/gemini-cli/nexus-launcher.js');
  const testToken = 'integration-test-secret';
  
  // Start Nexus inside sandbox
  const nexusProc = spawn(process.execPath, [launcherScript, testToken], {
    cwd: sandboxPath,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let beacon;
  for (let i = 0; i < 50; i++) {
    if (existsSync(beaconPath)) {
      try {
        const content = readFileSync(beaconPath, 'utf8');
        if (content) {
          beacon = JSON.parse(content);
          break;
        }
      } catch (e) {}
    }
    await new Promise(r => setTimeout(r, 200));
  }
  expect(beacon).toBeDefined();
  expect(beacon.token).toBe(testToken);

  const NUM_AGENTS = 5;
  const messagesPerAgent = 5;
  const connections = [];
  const receivedData = [];

  nexusProc.stdout.on('data', (chunk) => {
    receivedData.push(chunk.toString());
  });

  for (let i = 0; i < NUM_AGENTS; i++) {
    const socket = createConnection(beacon.port, '127.0.0.1');
    await performHandshake(socket, beacon.token);
    const agentId = `agent-${i}`;
    socket.write(encodeFrame({ type: 'hello', agentId, taskId: 'test-task' }));
    connections.push({ socket, agentId });
  }

  const promises = [];
  for (const conn of connections) {
    for (let m = 0; m < messagesPerAgent; m++) {
      promises.push(new Promise(r => {
        setTimeout(() => {
          conn.socket.write(encodeFrame({ type: 'log', data: `msg-${m} from ${conn.agentId}\n` }));
          r();
        }, Math.random() * 200);
      }));
    }
  }

  await Promise.all(promises);
  await new Promise(r => setTimeout(r, 2000));

  const allLogs = receivedData.join('');
  for (let i = 0; i < NUM_AGENTS; i++) {
    expect(allLogs).toContain(`agent-${i}`);
  }

  for (const conn of connections) conn.socket.destroy();
  nexusProc.kill('SIGTERM');
}, 30000);
