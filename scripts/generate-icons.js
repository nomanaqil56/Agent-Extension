const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Minimal PNG generator without external dependencies
function createPng(width, height, drawPixel) {
  const rowSize = width * 4 + 1;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawPixel(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * 4;
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const compressedData = zlib.deflateSync(rawData);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(8 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const crc = crc32(buf.subarray(4, 8 + len));
  buf.writeUInt32BE(crc, 8 + len);
  return buf;
}

// Standard CRC32
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Draw a sleek glowing Antigravity icon
function drawAgentIcon(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const dx = (x - cx) / (w / 2);
  const dy = (y - cy) / (h / 2);
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Rounded squircle background
  const p = Math.pow(Math.abs(dx), 3.5) + Math.pow(Math.abs(dy), 3.5);
  if (p > 1.0) {
    return [0, 0, 0, 0]; // Transparent outside
  }

  // Antigravity dark cyberpunk background (#0B0F19 to #1A1F36)
  const bgR = Math.floor(11 + 15 * (1 - dist));
  const bgG = Math.floor(15 + 20 * (1 - dist));
  const bgB = Math.floor(28 + 35 * (1 - dist));

  // Glowing outer border
  if (p > 0.88) {
    // Neon cyan to purple border
    const angle = Math.atan2(dy, dx);
    const t = (Math.sin(angle * 2) + 1) / 2;
    const borderR = Math.floor(0 * (1 - t) + 121 * t);
    const borderG = Math.floor(242 * (1 - t) + 40 * t);
    const borderB = Math.floor(254 * (1 - t) + 202 * t);
    return [borderR, borderG, borderB, 255];
  }

  // Draw an stylized "A" / Delta core with glowing eye/orb
  const isEye = dist < 0.28;
  if (isEye) {
    // Glowing cyan center core
    const glow = 1 - dist / 0.28;
    return [
      Math.floor(0 + 200 * glow),
      Math.floor(242 * glow),
      Math.floor(254),
      255
    ];
  }

  // Chevron / wings
  const chevron = Math.abs(dx) * 1.5 - dy * 0.8;
  if (dy > -0.6 && dy < 0.5 && Math.abs(chevron - 0.4) < 0.18) {
    return [0, 242, 254, 255]; // Neon cyan
  }

  return [bgR, bgG, bgB, 255];
}

const iconsDir = path.join(__dirname, '..', 'extension', 'icons');
[16, 48, 128].forEach(size => {
  const buf = createPng(size, size, drawAgentIcon);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), buf);
  console.log(`Generated icon${size}.png (${buf.length} bytes)`);
});
