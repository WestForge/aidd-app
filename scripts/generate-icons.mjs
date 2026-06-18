import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(rootDir, 'build');
const iconsDir = path.join(buildDir, 'icons');

const colors = {
  bg: [17, 24, 39, 255],
  fg: [226, 233, 243, 255],
  muted: [151, 163, 183, 255],
  panel: [17, 24, 39, 255],
};

function makeCanvas(w, h, color) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = color[3];
  }
  return { w, h, data };
}

function setPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= canvas.w || y >= canvas.h) return;
  const i = (y * canvas.w + x) * 4;
  canvas.data[i] = color[0];
  canvas.data[i + 1] = color[1];
  canvas.data[i + 2] = color[2];
  canvas.data[i + 3] = color[3];
}

function fillRect(canvas, x, y, w, h, color) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(canvas.w, Math.ceil(x + w));
  const bottom = Math.min(canvas.h, Math.ceil(y + h));
  for (let py = top; py < bottom; py++) {
    for (let px = left; px < right; px++) setPixel(canvas, px, py, color);
  }
}

function fillCircle(canvas, cx, cy, r, color) {
  const r2 = r * r;
  const left = Math.max(0, Math.floor(cx - r));
  const top = Math.max(0, Math.floor(cy - r));
  const right = Math.min(canvas.w - 1, Math.ceil(cx + r));
  const bottom = Math.min(canvas.h - 1, Math.ceil(cy + r));
  for (let y = top; y <= bottom; y++) {
    const dy = y + 0.5 - cy;
    for (let x = left; x <= right; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) setPixel(canvas, x, y, color);
    }
  }
}

function fillLine(canvas, x1, y1, x2, y2, width, color) {
  const r = width / 2;
  const r2 = r * r;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - r));
  const maxX = Math.min(canvas.w - 1, Math.ceil(Math.max(x1, x2) + r));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - r));
  const maxY = Math.min(canvas.h - 1, Math.ceil(Math.max(y1, y2) + r));
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
      const qx = x1 + t * dx;
      const qy = y1 + t * dy;
      const ddx = px - qx;
      const ddy = py - qy;
      if (ddx * ddx + ddy * ddy <= r2) setPixel(canvas, x, y, color);
    }
  }
}

function roundedRectContains(px, py, x, y, w, h, r) {
  const right = x + w;
  const bottom = y + h;
  if (px < x || py < y || px > right || py > bottom) return false;
  const cx = px < x + r ? x + r : px > right - r ? right - r : px;
  const cy = py < y + r ? y + r : py > bottom - r ? bottom - r : py;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function fillRoundedRect(canvas, x, y, w, h, r, color) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(canvas.w - 1, Math.ceil(x + w));
  const bottom = Math.min(canvas.h - 1, Math.ceil(y + h));
  for (let py = top; py <= bottom; py++) {
    for (let px = left; px <= right; px++) {
      if (roundedRectContains(px + 0.5, py + 0.5, x, y, w, h, r)) setPixel(canvas, px, py, color);
    }
  }
}

function strokeRoundedRect(canvas, x, y, w, h, r, width, color, fillColor) {
  fillRoundedRect(canvas, x, y, w, h, r, color);
  fillRoundedRect(canvas, x + width, y + width, w - width * 2, h - width * 2, Math.max(0, r - width), fillColor);
}

function drawGlyphA(canvas, s, color) {
  fillLine(canvas, 405 * s, 586 * s, 477 * s, 444 * s, 42 * s, color);
  fillLine(canvas, 477 * s, 444 * s, 545 * s, 586 * s, 42 * s, color);
  fillLine(canvas, 435 * s, 535 * s, 516 * s, 535 * s, 32 * s, color);
}

function drawGlyphI(canvas, s, color) {
  fillRect(canvas, 592 * s, 454 * s, 40 * s, 136 * s, color);
  fillRect(canvas, 560 * s, 454 * s, 104 * s, 36 * s, color);
  fillRect(canvas, 560 * s, 554 * s, 104 * s, 36 * s, color);
}

function downsample(source, targetSize, ss) {
  const out = new Uint8ClampedArray(targetSize * targetSize * 4);
  const samples = ss * ss;
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = (((y * ss + sy) * source.w) + (x * ss + sx)) * 4;
          r += source.data[i];
          g += source.data[i + 1];
          b += source.data[i + 2];
          a += source.data[i + 3];
        }
      }
      const o = (y * targetSize + x) * 4;
      out[o] = Math.round(r / samples);
      out[o + 1] = Math.round(g / samples);
      out[o + 2] = Math.round(b / samples);
      out[o + 3] = Math.round(a / samples);
    }
  }
  return out;
}

function renderIcon(size) {
  const ss = size <= 64 ? 6 : size <= 256 ? 4 : 2;
  const scale = (size * ss) / 1024;
  const canvas = makeCanvas(size * ss, size * ss, colors.bg);
  const s = scale;

  strokeRoundedRect(canvas, 88 * s, 88 * s, 848 * s, 848 * s, 146 * s, 29 * s, colors.fg, colors.bg);

  const nodes = {
    leftTop: [289 * s, 340 * s],
    top: [512 * s, 251 * s],
    rightTop: [735 * s, 340 * s],
    leftBottom: [333 * s, 680 * s],
    bottom: [512 * s, 771 * s],
    rightBottom: [692 * s, 680 * s],
  };

  const lineW = 21 * s;
  fillLine(canvas, ...nodes.leftTop, ...nodes.top, lineW, colors.muted);
  fillLine(canvas, ...nodes.top, ...nodes.rightTop, lineW, colors.muted);
  fillLine(canvas, ...nodes.leftTop, ...nodes.leftBottom, lineW, colors.muted);
  fillLine(canvas, ...nodes.rightTop, ...nodes.rightBottom, lineW, colors.muted);
  fillLine(canvas, ...nodes.leftTop, ...nodes.bottom, lineW, colors.muted);
  fillLine(canvas, ...nodes.top, ...nodes.bottom, lineW, colors.muted);
  fillLine(canvas, ...nodes.rightTop, ...nodes.bottom, lineW, colors.muted);
  fillLine(canvas, ...nodes.leftBottom, ...nodes.bottom, lineW, colors.muted);
  fillLine(canvas, ...nodes.rightBottom, ...nodes.bottom, lineW, colors.muted);
  fillLine(canvas, ...nodes.leftBottom, ...nodes.rightBottom, lineW, colors.muted);

  for (const [cx, cy] of Object.values(nodes)) fillCircle(canvas, cx, cy, 43 * s, colors.fg);

  strokeRoundedRect(canvas, 287 * s, 421 * s, 450 * s, 190 * s, 52 * s, 14 * s, colors.fg, colors.panel);
  drawGlyphA(canvas, s, colors.fg);
  drawGlyphI(canvas, s, colors.fg);

  return { width: size, height: size, data: downsample(canvas, size, ss) };
}

let crcTable;

function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(image) {
  const { width, height, data } = image;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, row + 1);
  }

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND'),
  ]);
}

function buildIcns(pngs) {
  const icnsTypes = new Map([
    [16, 'icp4'],
    [32, 'icp5'],
    [64, 'icp6'],
    [128, 'ic07'],
    [256, 'ic08'],
    [512, 'ic09'],
    [1024, 'ic10'],
  ]);
  const parts = [];
  for (const [size, type] of icnsTypes) {
    const png = pngs.get(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(8 + png.length, 4);
    parts.push(header, png);
  }
  const total = 8 + parts.reduce((sum, part) => sum + part.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...parts], total);
}

function buildIco(pngs) {
  const sizes = [16, 32, 48, 64, 128, 256];
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  const entries = [];
  const images = [];
  let offset = 6 + sizes.length * 16;
  for (const size of sizes) {
    const png = pngs.get(size);
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(png);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images], offset);
}

await fs.mkdir(iconsDir, { recursive: true });

const pngs = new Map();
for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  pngs.set(size, encodePng(renderIcon(size)));
}

await fs.writeFile(path.join(iconsDir, '512x512.png'), pngs.get(512));
await fs.writeFile(path.join(iconsDir, '1024x1024.png'), pngs.get(1024));
await fs.writeFile(path.join(iconsDir, 'icon.icns'), buildIcns(pngs));
await fs.writeFile(path.join(iconsDir, 'icon.ico'), buildIco(pngs));

console.log('Generated build/icons/icon.ico, icon.icns, 512x512.png, and 1024x1024.png');
