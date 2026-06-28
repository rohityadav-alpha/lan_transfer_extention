/**
 * File Chunker
 * Reads a File object in fixed-size chunks using FileReader.
 * Only one chunk is in memory at a time — designed for backpressure-controlled streaming.
 */

const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64 KB — optimal for WebRTC DataChannel

/**
 * Read a single slice of a File as an ArrayBuffer.
 * @param {File} file
 * @param {number} start - byte offset
 * @param {number} end - byte offset (exclusive)
 * @returns {Promise<ArrayBuffer>}
 */
function readSlice(file, start, end) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file.slice(start, end));
  });
}

/**
 * Create an async iterator that yields ArrayBuffer chunks from a File.
 *
 * Usage:
 *   for await (const { chunk, index, total, progress } of fileChunks(file)) {
 *     channel.send(chunk);
 *   }
 *
 * @param {File} file - The file to chunk
 * @param {number} [chunkSize=65536] - Size of each chunk in bytes
 * @yields {{ chunk: ArrayBuffer, index: number, total: number, progress: number }}
 */
export async function* fileChunks(file, chunkSize = DEFAULT_CHUNK_SIZE) {
  const total = Math.ceil(file.size / chunkSize);
  for (let index = 0; index < total; index++) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = await readSlice(file, start, end);
    yield {
      chunk,
      index,
      total,
      progress: (index + 1) / total,
    };
  }
}

/**
 * Build file metadata object for the "meta" message.
 * @param {File} file
 * @param {number} [chunkSize=65536]
 * @returns {{ type: string, name: string, size: number, totalChunks: number, mimeType: string }}
 */
export function buildFileMeta(file, chunkSize = DEFAULT_CHUNK_SIZE) {
  return {
    type: 'meta',
    name: file.name,
    size: file.size,
    totalChunks: Math.ceil(file.size / chunkSize),
    mimeType: file.type || 'application/octet-stream',
  };
}

export { DEFAULT_CHUNK_SIZE };
