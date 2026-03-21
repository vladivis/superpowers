import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { StreamBuffer, encodeFrame } from './lib/protocol.js';

/**
 * Swarm Nexus: A robust zero-dependency WebSocket server (RFC 6455)
 */
export class NexusServer {
  constructor(authToken) {
    this.authToken = authToken;
    this.server = createServer((req, res) => {
      res.writeHead(426, { 'Content-Type': 'text/plain' });
      res.end('Upgrade Required');
    });

    this.server.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head);
    });

    this.clients = new Set();
    this.onMessageHandler = (client, message) => {};
    
    // Security limits
    this.MAX_FRAME_SIZE = 100 * 1024 * 1024; // 100MB per single frame
    this.MAX_TOTAL_MESSAGE_SIZE = 250 * 1024 * 1024; // 250MB total
    this.MAX_FRAGMENTS_PER_MESSAGE = 1000;
  }

  handleUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    const protocol = req.headers['sec-websocket-protocol'];
    const providedToken = req.headers['x-nexus-token'] || protocol;
    
    if (!this.verifyToken(providedToken)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!key || req.headers['upgrade']?.toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }

    const acceptValue = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptValue}`
    ];
    
    if (protocol) responseHeaders.push(`Sec-WebSocket-Protocol: ${protocol}`);
    socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');
    
    const client = { 
      socket, 
      streamBuffer: new StreamBuffer(),
      messageFragments: [], 
      messageTotalSize: 0,
      writeQueue: [], 
      isDrained: true,
      id: null, 
      taskId: null 
    };
    this.clients.add(client);

    socket.on('data', (chunk) => {
      client.streamBuffer.push(chunk);
      this.processBuffer(client);
    });

    socket.on('drain', () => {
      client.isDrained = true;
      this.flushWriteQueue(client);
    });

    socket.on('error', () => this.removeClient(client));
    socket.on('end', () => this.removeClient(client));
  }

  verifyToken(token) {
    if (!this.authToken) return true;
    if (!token) return false;
    try {
      return timingSafeEqual(Buffer.from(token), Buffer.from(this.authToken));
    } catch (e) {
      return false;
    }
  }

  removeClient(client) {
    this.clients.delete(client);
    if (!client.socket.destroyed) client.socket.destroy();
  }

  flushWriteQueue(client) {
    while (client.isDrained && client.writeQueue.length > 0) {
      const data = client.writeQueue.shift();
      client.isDrained = client.socket.write(data);
    }
  }

  processBuffer(client) {
    let frame;
    // Modular O(N) linear-time frame reassembly
    while ((frame = client.streamBuffer.consumeFrame()) !== null) {
      this.handleFrame(client, frame.opcode, frame.payload, frame.isFinal);
    }
  }

  handleFrame(client, opcode, payload, isFinal) {
    if (opcode === 0x8) { this.removeClient(client); return; }
    if (opcode === 0x9) { this.sendFrame(client.socket, payload, 0xA); return; }

    if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
      if (payload.length > this.MAX_FRAME_SIZE ||
          client.messageTotalSize + payload.length > this.MAX_TOTAL_MESSAGE_SIZE ||
          client.messageFragments.length >= this.MAX_FRAGMENTS_PER_MESSAGE) {
        this.removeClient(client);
        return;
      }

      client.messageFragments.push(payload);
      client.messageTotalSize += payload.length;
      
      if (isFinal) {
        const fullMessage = Buffer.concat(client.messageFragments);
        client.messageFragments = [];
        client.messageTotalSize = 0;
        
        try {
          const message = JSON.parse(fullMessage.toString('utf8'));
          if (message.type === 'hello') {
            client.id = message.agentId;
            client.taskId = message.taskId;
          }
          if (message.type === 'log' && typeof message.data === 'string') {
            message.data = message.data.replace(/\r\n/g, '\n');
          }
          this.onMessageHandler(client, message);
        } catch (e) {}
      }
    }
  }

  sendFrame(socket, payload, opcode = 0x1) {
    if (socket.destroyed) return;
    const payloadBuffer = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
    const frame = encodeFrame(payloadBuffer, opcode, false, true);
    
    let client;
    for(const c of this.clients) { if(c.socket === socket) { client = c; break; } }

    if (client && (client.writeQueue.length > 0 || !client.isDrained)) {
      client.writeQueue.push(frame);
    } else {
      const ok = socket.write(frame);
      if (client && !ok) client.isDrained = false;
    }
  }

  onMessage(handler) { this.onMessageHandler = handler; }

  listen(port = 0, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
      this.server.listen(port, host, () => resolve(this.server.address().port));
      this.server.on('error', reject);
    });
  }

  close() {
    for (const client of this.clients) this.removeClient(client);
    this.server.close();
  }
}
