import path from 'node:path';
import fsp from 'node:fs/promises';
import zlib from 'node:zlib';

export interface ZipEntryInput {
  name: string;
  data: Buffer;
  modifiedAt?: Date;
}

export interface ZipReadEntry {
  name: string;
  data: Buffer;
  directory: boolean;
}

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function normaliseRelativePath(value: string) {
  return value.split('\\').join('/');
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = ZIP_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

export function safeZipEntryName(value: string) {
  const normalised = normaliseRelativePath(value).replace(/^\/+/, '');
  const parts = normalised.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..') || path.isAbsolute(value)) {
    throw new Error(`Unsafe zip entry path: ${value}`);
  }
  return parts.join('/');
}

export async function writeZipFile(filePath: string, entries: ZipEntryInput[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of sortedEntries) {
    const entryName = safeZipEntryName(entry.name);
    const nameBuffer = Buffer.from(entryName, 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const { dosTime, dosDate } = zipDosDateTime(entry.modifiedAt || new Date());

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sortedEntries.length, 8);
  end.writeUInt16LE(sortedEntries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, Buffer.concat([...localParts, centralDirectory, end]));
}

function findZipEndOfCentralDirectory(buffer: Buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('Invalid zip file: end of central directory was not found.');
}

export function safeZipReadEntryName(value: string) {
  const normalised = normaliseRelativePath(value).replace(/^\/+/, '');
  const parts = normalised.split('/');
  if (!normalised || path.isAbsolute(value) || parts.some((part) => part === '..')) return null;
  return normalised;
}

export async function readZipFile(filePath: string): Promise<ZipReadEntry[]> {
  const zipPath = path.resolve(filePath || '');
  const buffer = await fsp.readFile(zipPath);
  const endOffset = findZipEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let centralOffset = buffer.readUInt32LE(endOffset + 16);
  const entries: ZipReadEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (centralOffset + 46 > buffer.length || buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error('Invalid zip file: central directory is corrupt.');
    }

    const compressionMethod = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const rawName = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString('utf8');
    const name = safeZipReadEntryName(rawName);
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
    if (!name) continue;

    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid zip file: local header is corrupt for ${name}.`);
    }
    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const directory = name.endsWith('/');
    let data = Buffer.alloc(0);

    if (!directory) {
      if (compressionMethod === 0) data = Buffer.from(compressed);
      else if (compressionMethod === 8) data = zlib.inflateRawSync(compressed);
      else throw new Error(`Unsupported zip compression method ${compressionMethod} for ${name}.`);
    }

    entries.push({ name, data, directory });
  }

  return entries;
}
