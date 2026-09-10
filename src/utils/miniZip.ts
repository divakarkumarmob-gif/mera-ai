import fs from "fs";
import path from "path";
import zlib from "zlib";

/**
 * Pure Node.js in-memory ZIP archive generator (Zero external dependencies)
 * Generates standard PKZIP archives compatible with Windows, Mac, Linux, and Android.
 */
export function createZipFromDirectory(sourceDir: string): Buffer {
  const files: { relPath: string; data: Buffer }[] = [];

  function collectFiles(dir: string, baseDir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(fullPath, baseDir);
      } else if (entry.isFile()) {
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
        const data = fs.readFileSync(fullPath);
        files.push({ relPath, data });
      }
    }
  }

  collectFiles(sourceDir, sourceDir);

  const localFileHeaders: Buffer[] = [];
  const centralDirHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.relPath, "utf8");
    const uncompressedData = file.data;
    const compressedData = zlib.deflateRawSync(uncompressedData);
    const useCompressed = compressedData.length < uncompressedData.length;
    const body = useCompressed ? compressedData : uncompressedData;
    const compressionMethod = useCompressed ? 8 : 0;
    const crc = crc32(uncompressedData);

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0, 6);          // General purpose bit flag
    localHeader.writeUInt16LE(compressionMethod, 8); // Compression method
    localHeader.writeUInt16LE(0, 10);         // Last mod file time
    localHeader.writeUInt16LE(0, 12);         // Last mod file date
    localHeader.writeUInt32LE(crc, 14);       // CRC-32
    localHeader.writeUInt32LE(body.length, 18); // Compressed size
    localHeader.writeUInt32LE(uncompressedData.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26); // Filename length
    localHeader.writeUInt16LE(0, 28);         // Extra field length
    nameBuffer.copy(localHeader, 30);

    localFileHeaders.push(localHeader, body);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central dir signature
    centralHeader.writeUInt16LE(20, 4);         // Version made by
    centralHeader.writeUInt16LE(20, 6);         // Version needed
    centralHeader.writeUInt16LE(0, 8);          // General purpose flag
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(body.length, 20);
    centralHeader.writeUInt32LE(uncompressedData.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // File comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    centralHeader.writeUInt32LE(0, 38); // External file attributes
    centralHeader.writeUInt32LE(offset, 42); // Relative offset of local header
    nameBuffer.copy(centralHeader, 46);

    centralDirHeaders.push(centralHeader);
    offset += localHeader.length + body.length;
  }

  const centralDirSize = centralDirHeaders.reduce((sum, b) => sum + b.length, 0);
  const centralDirOffset = offset;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4);          // Disk number
  eocd.writeUInt16LE(0, 6);          // Disk with central dir
  eocd.writeUInt16LE(files.length, 8);  // Total entries on this disk
  eocd.writeUInt16LE(files.length, 10); // Total entries overall
  eocd.writeUInt32LE(centralDirSize, 12); // Central dir size
  eocd.writeUInt32LE(centralDirOffset, 16); // Central dir offset
  eocd.writeUInt16LE(0, 20);          // Comment length

  return Buffer.concat([...localFileHeaders, ...centralDirHeaders, eocd]);
}

/**
 * Standard CRC32 table calculation
 */
function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (~crc) >>> 0;
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}
