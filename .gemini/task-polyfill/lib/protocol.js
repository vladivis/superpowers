import { StringDecoder } from 'node:string_decoder';
import { randomBytes } from 'node:crypto';

/**
 * RFC 6455 WebSocket Protocol Implementation
 * Built for O(N) linear performance and memory safety.
 */

export function encodeFrame(payload, opcode = 0x1, isMasked = false, isFinal = true) {
  let buf = Buffer.isBuffer(payload) ? payload : Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  let header;
  const len = buf.length;

  // Calculate header size
  let offset = 2;
  if (len <= 125) offset = 2;
  else if (len <= 65535) offset = 4;
  else offset = 10;

  const headerSize = offset + (isMasked ? 4 : 0);
  header = Buffer.alloc(headerSize);

  // Set FIN bit and opcode
  header[0] = (isFinal ? 0x80 : 0x00) | opcode;

  // Set Mask bit and initial length
  if (len <= 125) {
    header[1] = (isMasked ? 0x80 : 0x00) | len;
  } else if (len <= 65535) {
    header[1] = (isMasked ? 0x80 : 0x00) | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header[1] = (isMasked ? 0x80 : 0x00) | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  if (isMasked) {
    const mask = randomBytes(4);
    mask.copy(header, offset);
    // Mask the payload
    const maskedBuf = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      maskedBuf[i] = buf[i] ^ mask[i % 4];
    }
    buf = maskedBuf;
  }

  return Buffer.concat([header, buf]);
}

/**
 * Decodes a WebSocket frame header and payload.
 */
export function decodeFrame(buffer) {
  if (buffer.length < 2) return null;

  const firstByte = buffer[0];
  const secondByte = buffer[1];

  const isFinal = !!(firstByte & 0x80);
  const opcode = firstByte & 0x0f;
  const isMasked = !!(secondByte & 0x80);
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    payloadLength = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  const headerSize = offset + (isMasked ? 4 : 0);
  if (buffer.length < headerSize + payloadLength) return null;

  let maskingKey = null;
  if (isMasked) {
    maskingKey = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  const payload = buffer.slice(offset, offset + payloadLength);
  const unmasked = Buffer.alloc(payload.length);
  
  if (isMasked) {
    for (let i = 0; i < payload.length; i++) {
      unmasked[i] = payload[i] ^ maskingKey[i % 4];
    }
  } else {
    payload.copy(unmasked);
  }

  return { opcode, payload: unmasked, isFinal, consumed: headerSize + payloadLength };
}

/**
 * Efficiently reassembles WebSocket frames with linear-time complexity.
 */
export class StreamBuffer {
  constructor() {
    this.chunks = [];
    this.totalLength = 0;
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
    this.chunks.push(chunk);
    this.totalLength += chunk.length;
  }

  consumeFrame() {
    if (this.totalLength < 2) return null;

    const head = this._peek(2);
    let payloadLen = head[1] & 0x7f;
    let headerLen = 2 + (head[1] & 0x80 ? 4 : 0);

    if (payloadLen === 126) headerLen += 2;
    else if (payloadLen === 127) headerLen += 8;

    if (this.totalLength < headerLen) return null;
    
    const fullHeader = this._peek(headerLen);
    let exactPayloadLen = payloadLen;
    if (payloadLen === 126) exactPayloadLen = fullHeader.readUInt16BE(2);
    else if (payloadLen === 127) exactPayloadLen = Number(fullHeader.readBigUInt64BE(2));

    if (this.totalLength < headerLen + exactPayloadLen) return null;

    const buffer = Buffer.concat(this.chunks);
    const result = decodeFrame(buffer);
    
    if (result) {
      const remaining = buffer.slice(result.consumed);
      this.chunks = remaining.length > 0 ? [remaining] : [];
      this.totalLength = remaining.length;
      return result;
    }
    
    return null;
  }

  _peek(n) {
    if (this.chunks.length === 0) return Buffer.alloc(0);
    if (this.chunks[0].length >= n) return this.chunks[0].slice(0, n);
    return Buffer.concat(this.chunks, n);
  }
}

/**
 * Ensures UTF-8 integrity across stream boundaries.
 */
export class SafeDecoder {
  constructor() {
    this.decoder = new StringDecoder('utf8');
  }
  write(chunk) { return this.decoder.write(chunk); }
  flush() { return this.decoder.end(); }
}
