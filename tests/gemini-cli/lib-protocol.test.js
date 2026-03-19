import { describe, test, expect } from 'vitest';
import { encodeFrame, decodeFrame, StreamBuffer, SafeDecoder } from '../../.gemini/task-polyfill/lib/protocol.js';
import { randomBytes } from 'node:crypto';

describe('encodeFrame', () => {
  test('encodes a small unmasked text frame', () => {
    const payload = 'Hello';
    const frame = encodeFrame(payload, 0x1, false, true);
    expect(frame[0]).toBe(0x81); // FIN | Text
    expect(frame[1]).toBe(5);    // Length 5
    expect(frame.slice(2).toString()).toBe('Hello');
  });

  test('encodes a masked text frame', () => {
    const payload = 'Hello';
    const frame = encodeFrame(payload, 0x1, true, true);
    expect(frame[0]).toBe(0x81);
    expect(frame[1] & 0x80).toBe(0x80); // Mask bit must be set
    // Note: our current encodeFrame in lib/protocol.js actually 
    // might not support masking if it was simplified for server-only use.
    // Let's verify and adapt test if needed.
  });
});

describe('decodeFrame', () => {
  test('decodes a small unmasked text frame', () => {
    const payload = Buffer.from('Hello');
    const header = Buffer.from([0x81, 0x05]);
    const frame = Buffer.concat([header, payload]);
    
    const result = decodeFrame(frame);
    expect(result).not.toBeNull();
    expect(result.opcode).toBe(0x1);
    expect(result.isFinal).toBe(true);
    expect(result.payload.toString()).toBe('Hello');
    expect(result.consumed).toBe(frame.length);
  });

  test('decodes a medium masked binary frame', () => {
    const payloadSize = 200;
    const payload = randomBytes(payloadSize);
    const mask = randomBytes(4);
    const maskedPayload = Buffer.alloc(payloadSize);
    for (let i = 0; i < payloadSize; i++) {
      maskedPayload[i] = payload[i] ^ mask[i % 4];
    }

    const header = Buffer.alloc(4);
    header[0] = 0x82; // FIN | Binary
    header[1] = 126 | 0x80; // Masked | 16-bit length
    header.writeUInt16BE(payloadSize, 2);
    
    const frame = Buffer.concat([header, mask, maskedPayload]);
    
    const result = decodeFrame(frame);
    expect(result).not.toBeNull();
    expect(result.payload.equals(payload)).toBe(true);
    expect(result.consumed).toBe(frame.length);
  });
});

describe('StreamBuffer', () => {
  test('linearly reassembles fragmented frames', () => {
    const sb = new StreamBuffer();
    const payload = 'A'.repeat(200);
    const fullFrame = encodeFrame(payload, 0x1, false, true);
    
    // Push frame in tiny chunks
    for (let i = 0; i < fullFrame.length; i++) {
      sb.push(fullFrame.slice(i, i + 1));
      if (i < fullFrame.length - 1) {
        expect(sb.consumeFrame()).toBeNull(); // O(N) peek should return null
      }
    }
    
    const result = sb.consumeFrame();
    expect(result).not.toBeNull();
    expect(result.payload.toString()).toBe(payload);
  });
});

describe('SafeDecoder', () => {
  test('correctly decodes split UTF-8 characters', () => {
    const decoder = new SafeDecoder();
    const char = 'Привет'; // Multibyte characters
    const buf = Buffer.from(char, 'utf8');
    
    // Split mid-character
    const part1 = buf.slice(0, 3);
    const part2 = buf.slice(3);
    
    let result = decoder.write(part1);
    result += decoder.write(part2);
    result += decoder.flush();
    
    expect(result).toBe(char);
  });
});
