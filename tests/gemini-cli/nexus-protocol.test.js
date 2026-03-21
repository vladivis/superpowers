import { test, expect, beforeAll, afterAll } from 'vitest';
import { NexusServer } from '../../.gemini/task-polyfill/nexus.js';
import { createHash, randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';

let nexus;
let port;
const TEST_TOKEN = 'secret-test-token';

beforeAll(async () => {
  nexus = new NexusServer(TEST_TOKEN);
  port = await nexus.listen(0);
});

afterAll(() => {
  nexus.close();
});

async function performHandshake(socket, token = TEST_TOKEN) {
  const key = randomBytes(16).toString('base64');
  const expectedAccept = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  return new Promise((resolve, reject) => {
    const headers = [
      `GET / HTTP/1.1`,
      `Host: localhost`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Key: ${key}`,
      `Sec-WebSocket-Version: 13`,
      `X-Nexus-Token: ${token}`,
      '\r\n'
    ];
    socket.write(headers.join('\r\n'));

    socket.once('data', (data) => {
      const response = data.toString();
      if (response.includes('101 Switching Protocols') && response.includes(expectedAccept)) {
        resolve();
      } else {
        reject(new Error('Handshake failed: ' + response));
      }
    });
  });
}

function encodeFrame(payload, isMasked = true, opcode = 0x1, isFinal = true) {
  const buf = typeof payload === 'string' ? Buffer.from(payload) : Buffer.from(JSON.stringify(payload));
  let header;
  const len = buf.length;

  if (len <= 125) {
    header = Buffer.alloc(2 + (isMasked ? 4 : 0));
    header[1] = len | (isMasked ? 0x80 : 0);
  } else if (len <= 65535) {
    header = Buffer.alloc(4 + (isMasked ? 4 : 0));
    header[1] = 126 | (isMasked ? 0x80 : 0);
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10 + (isMasked ? 4 : 0));
    header[1] = 127 | (isMasked ? 0x80 : 0);
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  header[0] = (isFinal ? 0x80 : 0x00) | opcode;

  if (isMasked) {
    const mask = randomBytes(4);
    const maskOffset = header.length - 4;
    mask.copy(header, maskOffset);
    for (let i = 0; i < buf.length; i++) {
      buf[i] ^= mask[i % 4];
    }
  }

  return Buffer.concat([header, buf]);
}

test('Nexus: Secure Handshake and Fragmentation', async () => {
  const socket = createConnection(port, '127.0.0.1');
  await performHandshake(socket);

  const receivedMessages = [];
  nexus.onMessage((client, msg) => {
    receivedMessages.push(msg);
  });

  // Test fragmented message
  const msgPart1 = JSON.stringify({ type: 'log', data: 'Part 1 ' }).slice(0, 10);
  const msgPart2 = JSON.stringify({ type: 'log', data: 'Part 1 ' }).slice(10);

  // Frame 1: Opcode 0x1 (Text), FIN=0
  socket.write(encodeFrame(msgPart1, true, 0x1, false));
  // Frame 2: Opcode 0x0 (Continuation), FIN=1
  socket.write(encodeFrame(msgPart2, true, 0x0, true));

  await new Promise(r => setTimeout(r, 200));
  expect(receivedMessages[0]).toEqual({ type: 'log', data: 'Part 1 ' });
  socket.destroy();
});

test('Nexus: Unauthorized Access', async () => {
  const socket = createConnection(port, '127.0.0.1');
  try {
    await performHandshake(socket, 'wrong-token');
  } catch (e) {
    expect(e.message).toContain('401 Unauthorized');
  }
  socket.destroy();
});
