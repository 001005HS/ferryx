import { describe, expect, it } from "vitest";

import { decodeTerminalOutputFrame } from "./terminalOutput";

function encodeFramingHeader(
  sessionId: string,
  sequence: bigint,
  timestampMs: bigint,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const sessionBytes = new TextEncoder().encode(sessionId);
  const frame = new Uint8Array(20 + sessionBytes.byteLength + payload.byteLength);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

  const flags = (1 << 0) | (1 << 1);
  view.setUint8(0, 1);
  view.setUint8(1, flags);
  view.setUint16(2, sessionBytes.byteLength, true);
  view.setBigUint64(4, sequence, true);
  view.setBigUint64(12, timestampMs, true);

  frame.set(sessionBytes, 20);
  if (payload.byteLength > 0) {
    frame.set(payload, 20 + sessionBytes.byteLength);
  }
  return frame;
}

function fnv1a32(bytes: Uint8Array, initial: number = 0x811c9dc5): number {
  let hash = initial;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

describe("terminal throughput and parsing performance regression", () => {
  it("direct Uint8Array streaming throughput exceeds threshold", () => {
    const CHUNK_SIZE = 32 * 1024;
    const TOTAL_BYTES = 5 * 1024 * 1024;
    const CHUNK_COUNT = TOTAL_BYTES / CHUNK_SIZE;

    const chunks: Uint8Array[] = new Array(CHUNK_COUNT);
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const chunk = new Uint8Array(CHUNK_SIZE);
      for (let j = 0; j < CHUNK_SIZE; j++) {
        chunk[j] = ((i * 31 + j) % 95) + 32;
      }
      chunks[i] = chunk;
    }

    let warmupBytes = 0;
    for (let i = 0; i < 10; i++) {
      warmupBytes += chunks[i]!.byteLength;
    }
    expect(warmupBytes).toBe(10 * CHUNK_SIZE);

    let processedBytes = 0;
    let byteChecksum = 0;
    const consumer = (chunk: Uint8Array) => {
      processedBytes += chunk.byteLength;
      byteChecksum += chunk[0]! + chunk[chunk.byteLength - 1]!;
    };

    const startTime = performance.now();
    for (let i = 0; i < CHUNK_COUNT; i++) {
      consumer(chunks[i]!);
    }
    const elapsedMs = performance.now() - startTime;
    const elapsedSec = elapsedMs / 1000;
    const throughputMiBps = (processedBytes / (1024 * 1024)) / Math.max(elapsedSec, 0.000001);

    expect(processedBytes).toBe(TOTAL_BYTES);
    expect(byteChecksum).toBeGreaterThan(0);
    expect(throughputMiBps).toBeGreaterThan(50);
  });

  it("direct Uint8Array vs base64 parsing throughput speedup", () => {
    const CHUNK_SIZE = 16 * 1024;
    const NUM_CHUNKS = 80;

    const rawChunks: Uint8Array[] = new Array(NUM_CHUNKS);
    const base64Chunks: string[] = new Array(NUM_CHUNKS);

    for (let i = 0; i < NUM_CHUNKS; i++) {
      const raw = new Uint8Array(CHUNK_SIZE);
      for (let j = 0; j < CHUNK_SIZE; j++) {
        raw[j] = (i * 17 + j) & 0xff;
      }
      rawChunks[i] = raw;

      let binaryString = "";
      for (let j = 0; j < CHUNK_SIZE; j++) {
        binaryString += String.fromCharCode(raw[j]!);
      }
      base64Chunks[i] = globalThis.btoa(binaryString);
    }

    for (let i = 0; i < 5; i++) {
      const view = new Uint8Array(rawChunks[i]!.buffer, rawChunks[i]!.byteOffset, rawChunks[i]!.byteLength);
      expect(view.byteLength).toBe(CHUNK_SIZE);
      const bin = globalThis.atob(base64Chunks[i]!);
      const dec = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) dec[j] = bin.charCodeAt(j);
      expect(dec.byteLength).toBe(CHUNK_SIZE);
    }

    let directProcessedBytes = 0;
    const startDirect = performance.now();
    for (let i = 0; i < NUM_CHUNKS; i++) {
      const chunk = rawChunks[i]!;
      const view = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      directProcessedBytes += view.byteLength;
    }
    const directTimeMs = performance.now() - startDirect;

    let base64ProcessedBytes = 0;
    const startBase64 = performance.now();
    for (let i = 0; i < NUM_CHUNKS; i++) {
      const b64 = base64Chunks[i]!;
      const binary = globalThis.atob(b64);
      const decoded = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) {
        decoded[j] = binary.charCodeAt(j);
      }
      base64ProcessedBytes += decoded.byteLength;
    }
    const base64TimeMs = performance.now() - startBase64;

    expect(directProcessedBytes).toBe(NUM_CHUNKS * CHUNK_SIZE);
    expect(base64ProcessedBytes).toBe(NUM_CHUNKS * CHUNK_SIZE);

    const speedup = base64TimeMs / Math.max(directTimeMs, 0.0001);
    expect(speedup).toBeGreaterThanOrEqual(1.5);
  });

  it("binary framing header parser latency bound", () => {
    const FRAME_COUNT = 10_000;
    const payload = new Uint8Array([0x1b, 0x5b, 0x33, 0x32, 0x6d, 0x4f, 0x4b, 0x1b, 0x5b, 0x30, 0x6d]);
    const baseTimestamp = 1_700_000_000_000n;

    const frames: Uint8Array[] = new Array(FRAME_COUNT);
    for (let i = 0; i < FRAME_COUNT; i++) {
      const sessionId = `term-sess-${i % 32}`;
      const sequence = BigInt(i + 1);
      const timestamp = baseTimestamp + BigInt(i);
      frames[i] = encodeFramingHeader(sessionId, sequence, timestamp, payload);
    }

    for (let i = 0; i < 200; i++) {
      decodeTerminalOutputFrame(frames[i]!);
    }

    const startTime = performance.now();
    for (let i = 0; i < FRAME_COUNT; i++) {
      const decoded = decodeTerminalOutputFrame(frames[i]!);
      if (i === 0 || i === FRAME_COUNT - 1) {
        expect(decoded.sessionId).toBe(`term-sess-${i % 32}`);
        expect(decoded.sequence).toBe(String(i + 1));
        expect(decoded.daemonEpoch).toBe(String(baseTimestamp + BigInt(i)));
        expect(decoded.data.byteLength).toBe(payload.byteLength);
      }
    }
    const elapsedMs = performance.now() - startTime;
    const avgMicrosecondsPerHeader = (elapsedMs / FRAME_COUNT) * 1000;

    expect(elapsedMs).toBeLessThan(50);
    expect(avgMicrosecondsPerHeader).toBeLessThan(5);
  });

  it("chunk aggregation memory and time bound", () => {
    const varyingSizes = [
      64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536,
      96, 384, 1500, 4800, 11200, 24000, 39500, 52000, 65536,
    ];

    const REPETITIONS = 6;
    const totalChunkCount = varyingSizes.length * REPETITIONS;
    const chunks: Uint8Array[] = new Array(totalChunkCount);

    let expectedTotalBytes = 0;
    let expectedStreamChecksum = 0x811c9dc5;

    let chunkIndex = 0;
    for (let rep = 0; rep < REPETITIONS; rep++) {
      for (let s = 0; s < varyingSizes.length; s++) {
        const size = varyingSizes[s]!;
        const chunk = new Uint8Array(size);
        for (let j = 0; j < size; j++) {
          chunk[j] = (rep * 41 + s * 19 + j) & 0xff;
        }
        chunks[chunkIndex] = chunk;
        expectedTotalBytes += size;
        expectedStreamChecksum = fnv1a32(chunk, expectedStreamChecksum);
        chunkIndex++;
      }
    }

    expect(expectedTotalBytes).toBeGreaterThan(1_500_000);

    const startTime = performance.now();

    const chunkOffsets = new Uint32Array(totalChunkCount);
    let aggregatedByteCount = 0;

    for (let i = 0; i < totalChunkCount; i++) {
      chunkOffsets[i] = aggregatedByteCount;
      aggregatedByteCount += chunks[i]!.byteLength;
    }

    const aggregatedBuffer = new Uint8Array(aggregatedByteCount);
    for (let i = 0; i < totalChunkCount; i++) {
      aggregatedBuffer.set(chunks[i]!, chunkOffsets[i]!);
    }

    const elapsedMs = performance.now() - startTime;

    expect(aggregatedByteCount).toBe(expectedTotalBytes);
    expect(aggregatedBuffer.byteLength).toBe(expectedTotalBytes);

    const contiguousChecksum = fnv1a32(aggregatedBuffer);
    expect(contiguousChecksum).toBe(expectedStreamChecksum);

    for (let i = 0; i < totalChunkCount; i++) {
      const original = chunks[i]!;
      const offset = chunkOffsets[i]!;
      const boundarySlice = aggregatedBuffer.subarray(offset, offset + original.byteLength);

      expect(boundarySlice.byteLength).toBe(original.byteLength);
      expect(boundarySlice[0]).toBe(original[0]);
      expect(boundarySlice[boundarySlice.length - 1]).toBe(original[original.length - 1]);
    }

    expect(elapsedMs).toBeLessThan(100);
  });
});
