import { expect, type Locator, type Page } from '@playwright/test';

type EccLevel = 'L' | 'M' | 'Q' | 'H';

interface BlockSpec {
  totalData: number;
  g1Blocks: number;
  g1Data: number;
  g2Blocks: number;
  g2Data: number;
}

// ISO/IEC 18004 Table 9 for QR Versions 1..10
const VERSION_ECC_TABLE: Record<number, Record<EccLevel, BlockSpec>> = {
  1: {
    L: { totalData: 19, g1Blocks: 1, g1Data: 19, g2Blocks: 0, g2Data: 0 },
    M: { totalData: 16, g1Blocks: 1, g1Data: 16, g2Blocks: 0, g2Data: 0 },
    Q: { totalData: 13, g1Blocks: 1, g1Data: 13, g2Blocks: 0, g2Data: 0 },
    H: { totalData: 9, g1Blocks: 1, g1Data: 9, g2Blocks: 0, g2Data: 0 },
  },
  2: {
    L: { totalData: 34, g1Blocks: 1, g1Data: 34, g2Blocks: 0, g2Data: 0 },
    M: { totalData: 28, g1Blocks: 1, g1Data: 28, g2Blocks: 0, g2Data: 0 },
    Q: { totalData: 22, g1Blocks: 1, g1Data: 22, g2Blocks: 0, g2Data: 0 },
    H: { totalData: 16, g1Blocks: 1, g1Data: 16, g2Blocks: 0, g2Data: 0 },
  },
  3: {
    L: { totalData: 55, g1Blocks: 1, g1Data: 55, g2Blocks: 0, g2Data: 0 },
    M: { totalData: 44, g1Blocks: 1, g1Data: 44, g2Blocks: 0, g2Data: 0 },
    Q: { totalData: 34, g1Blocks: 2, g1Data: 17, g2Blocks: 0, g2Data: 0 },
    H: { totalData: 26, g1Blocks: 2, g1Data: 13, g2Blocks: 0, g2Data: 0 },
  },
  4: {
    L: { totalData: 80, g1Blocks: 1, g1Data: 80, g2Blocks: 0, g2Data: 0 },
    M: { totalData: 64, g1Blocks: 2, g1Data: 32, g2Blocks: 0, g2Data: 0 },
    Q: { totalData: 48, g1Blocks: 2, g1Data: 24, g2Blocks: 0, g2Data: 0 },
    H: { totalData: 36, g1Blocks: 4, g1Data: 9, g2Blocks: 0, g2Data: 0 },
  },
  5: {
    L: { totalData: 108, g1Blocks: 1, g1Data: 108, g2Blocks: 0, g2Data: 0 },
    M: { totalData: 86, g1Blocks: 2, g1Data: 43, g2Blocks: 0, g2Data: 0 },
    Q: { totalData: 62, g1Blocks: 2, g1Data: 15, g2Blocks: 2, g2Data: 16 },
    H: { totalData: 46, g1Blocks: 2, g1Data: 11, g2Blocks: 2, g2Data: 12 },
  },
  6: {
    L: { totalData: 136, g1Blocks: 2, g1Data: 68, g2Blocks: 0, g2Data: 0 },
    M: { totalData: 108, g1Blocks: 4, g1Data: 27, g2Blocks: 0, g2Data: 0 },
    Q: { totalData: 76, g1Blocks: 4, g1Data: 19, g2Blocks: 0, g2Data: 0 },
    H: { totalData: 60, g1Blocks: 4, g1Data: 15, g2Blocks: 0, g2Data: 0 },
  },
  7: {
    L: { totalData: 156, g1Blocks: 2, g1Data: 78, g2Blocks: 0, g2Data: 0 },
    M: { totalData: 124, g1Blocks: 4, g1Data: 31, g2Blocks: 0, g2Data: 0 },
    Q: { totalData: 88, g1Blocks: 2, g1Data: 14, g2Blocks: 4, g2Data: 15 },
    H: { totalData: 66, g1Blocks: 4, g1Data: 13, g2Blocks: 1, g2Data: 14 },
  },
  8: {
    L: { totalData: 194, g1Blocks: 2, g1Data: 97, g2Blocks: 0, g2Data: 0 },
    M: { totalData: 154, g1Blocks: 2, g1Data: 38, g2Blocks: 2, g2Data: 39 },
    Q: { totalData: 110, g1Blocks: 4, g1Data: 18, g2Blocks: 2, g2Data: 19 },
    H: { totalData: 86, g1Blocks: 4, g1Data: 14, g2Blocks: 2, g2Data: 15 },
  },
  9: {
    L: { totalData: 232, g1Blocks: 2, g1Data: 116, g2Blocks: 0, g2Data: 0 },
    M: { totalData: 182, g1Blocks: 3, g1Data: 36, g2Blocks: 2, g2Data: 37 },
    Q: { totalData: 132, g1Blocks: 4, g1Data: 16, g2Blocks: 4, g2Data: 17 },
    H: { totalData: 100, g1Blocks: 4, g1Data: 12, g2Blocks: 4, g2Data: 13 },
  },
  10: {
    L: { totalData: 274, g1Blocks: 2, g1Data: 68, g2Blocks: 2, g2Data: 69 },
    M: { totalData: 216, g1Blocks: 4, g1Data: 43, g2Blocks: 1, g2Data: 44 },
    Q: { totalData: 154, g1Blocks: 6, g1Data: 19, g2Blocks: 2, g2Data: 20 },
    H: { totalData: 122, g1Blocks: 6, g1Data: 15, g2Blocks: 2, g2Data: 16 },
  },
};

const ALIGNMENT_COORDS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const ALPHANUMERIC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function buildFormatTable(): Array<{ code: number; ecc: EccLevel; maskId: number }> {
  const eccMap: Record<number, EccLevel> = {
    0b01: 'L',
    0b00: 'M',
    0b11: 'Q',
    0b10: 'H',
  };
  const table: Array<{ code: number; ecc: EccLevel; maskId: number }> = [];
  for (let data = 0; data < 32; data++) {
    let rem = data << 10;
    for (let bit = 14; bit >= 10; bit--) {
      if ((rem >>> bit) & 1) {
        rem ^= 0x537 << (bit - 10);
      }
    }
    const code = ((data << 10) | rem) ^ 0x5412;
    const eccBits = (data >> 3) & 0b11;
    const maskId = data & 0b111;
    table.push({ code, ecc: eccMap[eccBits], maskId });
  }
  return table;
}

const FORMAT_TABLE = buildFormatTable();

function popcount15(n: number): number {
  let x = n & 0x7fff;
  let c = 0;
  while (x !== 0) {
    c += x & 1;
    x >>>= 1;
  }
  return c;
}

function decodeFormatInfo(raw15: number): {
  ecc: EccLevel;
  maskId: number;
  distance: number;
} {
  let best = FORMAT_TABLE[0];
  let bestDist = 16;
  for (const entry of FORMAT_TABLE) {
    const dist = popcount15(raw15 ^ entry.code);
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return { ecc: best.ecc, maskId: best.maskId, distance: bestDist };
}

function maskBit(maskId: number, r: number, c: number): boolean {
  switch (maskId) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return false;
  }
}

function buildReservedMatrix(version: number, size: number): boolean[][] {
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    Array<boolean>(size).fill(false),
  );

  // Top-left finder + separator + format info (9x9)
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      reserved[r][c] = true;
    }
  }
  // Top-right finder + separator + format info
  for (let r = 0; r < 9; r++) {
    for (let c = size - 8; c < size; c++) {
      reserved[r][c] = true;
    }
  }
  // Bottom-left finder + separator + dark module + format info
  for (let r = size - 8; r < size; r++) {
    for (let c = 0; c < 9; c++) {
      reserved[r][c] = true;
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    reserved[6][i] = true;
    reserved[i][6] = true;
  }

  // Alignment patterns (Versions >= 2)
  const coords = ALIGNMENT_COORDS[version] ?? [];
  for (const ar of coords) {
    for (const ac of coords) {
      const overlapsFinder =
        (ar < 9 && ac < 9) ||
        (ar < 9 && ac >= size - 8) ||
        (ar >= size - 8 && ac < 9);
      if (overlapsFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          reserved[ar + dr][ac + dc] = true;
        }
      }
    }
  }

  // Version info blocks (Versions >= 7)
  if (version >= 7) {
    for (let r = 0; r < 6; r++) {
      for (let c = size - 11; c < size - 8; c++) {
        reserved[r][c] = true;
        reserved[c][r] = true;
      }
    }
  }

  return reserved;
}

class BitStreamReader {
  private bitOffset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  remainingBits(): number {
    return this.bytes.length * 8 - this.bitOffset;
  }

  readBits(count: number): number {
    if (count === 0) return 0;
    if (this.remainingBits() < count) {
      throw new Error(
        `Unexpected end of QR bitstream: need ${count} bits, have ${this.remainingBits()}`,
      );
    }
    let val = 0;
    for (let i = 0; i < count; i++) {
      const byteIdx = (this.bitOffset + i) >> 3;
      const bitIdx = 7 - ((this.bitOffset + i) & 7);
      val = (val << 1) | ((this.bytes[byteIdx] >> bitIdx) & 1);
    }
    this.bitOffset += count;
    return val;
  }
}

function deinterleaveDataCodewords(
  rawCodewords: number[],
  spec: BlockSpec,
): Uint8Array {
  const totalBlocks = spec.g1Blocks + spec.g2Blocks;
  const blocks: number[][] = [];
  for (let b = 0; b < spec.g1Blocks; b++) {
    blocks.push(new Array<number>(spec.g1Data).fill(0));
  }
  for (let b = 0; b < spec.g2Blocks; b++) {
    blocks.push(new Array<number>(spec.g2Data).fill(0));
  }

  let idx = 0;
  const maxDataLen = Math.max(spec.g1Data, spec.g2Data);
  for (let pos = 0; pos < maxDataLen; pos++) {
    for (let b = 0; b < totalBlocks; b++) {
      if (pos < blocks[b].length) {
        blocks[b][pos] = rawCodewords[idx++] ?? 0;
      }
    }
  }

  const data = new Uint8Array(spec.totalData);
  let outIdx = 0;
  for (const blk of blocks) {
    for (const cw of blk) {
      data[outIdx++] = cw;
    }
  }
  return data;
}

function decodePayloadFromDataBytes(
  data: Uint8Array,
  version: number,
): string {
  const reader = new BitStreamReader(data);
  const bytesOut: number[] = [];

  while (reader.remainingBits() >= 4) {
    const mode = reader.readBits(4);
    if (mode === 0) {
      // Terminator
      break;
    }

    if (mode === 0b0100) {
      // Byte mode
      const countBits = version <= 9 ? 8 : 16;
      const count = reader.readBits(countBits);
      for (let i = 0; i < count; i++) {
        bytesOut.push(reader.readBits(8));
      }
    } else if (mode === 0b0010) {
      // Alphanumeric mode
      const countBits = version <= 9 ? 9 : 11;
      let count = reader.readBits(countBits);
      while (count >= 2) {
        const pair = reader.readBits(11);
        const c1 = ALPHANUMERIC_CHARS[Math.floor(pair / 45)];
        const c2 = ALPHANUMERIC_CHARS[pair % 45];
        bytesOut.push(c1.charCodeAt(0), c2.charCodeAt(0));
        count -= 2;
      }
      if (count === 1) {
        const idx = reader.readBits(6);
        bytesOut.push(ALPHANUMERIC_CHARS[idx].charCodeAt(0));
      }
    } else if (mode === 0b0001) {
      // Numeric mode
      const countBits = version <= 9 ? 10 : 12;
      let count = reader.readBits(countBits);
      while (count >= 3) {
        const triple = reader.readBits(10);
        const s = String(triple).padStart(3, '0');
        for (const ch of s) bytesOut.push(ch.charCodeAt(0));
        count -= 3;
      }
      if (count === 2) {
        const pair = reader.readBits(7);
        const s = String(pair).padStart(2, '0');
        for (const ch of s) bytesOut.push(ch.charCodeAt(0));
      } else if (count === 1) {
        const single = reader.readBits(4);
        bytesOut.push(String(single).charCodeAt(0));
      }
    } else if (mode === 0b0111) {
      // ECI mode: read assignment number and continue
      const first = reader.readBits(8);
      if ((first & 0x80) !== 0) {
        if ((first & 0xc0) === 0x80) {
          reader.readBits(8);
        } else {
          reader.readBits(16);
        }
      }
    } else {
      throw new Error(`Unsupported QR data mode: 0b${mode.toString(2)}`);
    }
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(
    new Uint8Array(bytesOut),
  );
}

/**
 * Pure-TS QR decoder operating on a 2D binarized pixel matrix (1 = dark, 0 = light).
 */
export function decodeQrFromBinaryPixels(
  width: number,
  height: number,
  bits: number[],
): string {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      if (bits[rowOff + x] === 1) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    throw new Error('QR image contains no dark modules');
  }

  // Measure top-left 7x7 finder top bar width (run of dark pixels starting at minX on rows near minY)
  let finderWidth = 0;
  for (let y = minY; y <= Math.min(maxY, minY + 3); y++) {
    let run = 0;
    for (let x = minX; x <= maxX; x++) {
      if (bits[y * width + x] === 1) {
        run++;
      } else {
        break;
      }
    }
    if (run > finderWidth) {
      finderWidth = run;
    }
  }

  if (finderWidth < 7) {
    throw new Error(`Invalid top-left finder width: ${finderWidth}`);
  }

  const approxModSize = finderWidth / 7;
  const rawN = (maxX - minX + 1) / approxModSize;
  const rawVersion = Math.round((rawN - 17) / 4);
  if (rawVersion < 1 || rawVersion > 10) {
    throw new Error(
      `Unsupported QR version ${rawVersion} (supported: 1..10)`,
    );
  }
  const version = rawVersion;
  const size = 17 + 4 * version;

  const modW = (maxX - minX + 1) / size;
  const modH = (maxY - minY + 1) / size;

  const grid: number[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (__, c) => {
      const px = Math.min(
        width - 1,
        Math.max(0, Math.floor(minX + (c + 0.5) * modW)),
      );
      const py = Math.min(
        height - 1,
        Math.max(0, Math.floor(minY + (r + 0.5) * modH)),
      );
      return bits[py * width + px] === 1 ? 1 : 0;
    }),
  );

  // Extract Format Info Copy 1 (top-left) and Copy 2 (top-right / bottom-left)
  const copy1Coords: Array<[number, number]> = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  let rawFmt1 = 0;
  for (const [r, c] of copy1Coords) {
    rawFmt1 = (rawFmt1 << 1) | grid[r][c];
  }

  const copy2Coords: Array<[number, number]> = [
    [size - 1, 8],
    [size - 2, 8],
    [size - 3, 8],
    [size - 4, 8],
    [size - 5, 8],
    [size - 6, 8],
    [size - 7, 8],
    [8, size - 8],
    [8, size - 7],
    [8, size - 6],
    [8, size - 5],
    [8, size - 4],
    [8, size - 3],
    [8, size - 2],
    [8, size - 1],
  ];
  let rawFmt2 = 0;
  for (const [r, c] of copy2Coords) {
    rawFmt2 = (rawFmt2 << 1) | grid[r][c];
  }

  const fmt1 = decodeFormatInfo(rawFmt1);
  const fmt2 = decodeFormatInfo(rawFmt2);
  const fmt = fmt1.distance <= fmt2.distance ? fmt1 : fmt2;
  if (fmt.distance > 3) {
    throw new Error(
      `Failed to decode QR format info (best Hamming distance ${fmt.distance})`,
    );
  }

  const reserved = buildReservedMatrix(version, size);
  const rawCodewords: number[] = [];
  let currentByte = 0;
  let bitCount = 0;
  let upward = true;

  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) {
      rightCol = 5;
    }
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = rightCol - dc;
        if (reserved[r][c]) continue;
        const rawBit = grid[r][c];
        const unmaskedBit = maskBit(fmt.maskId, r, c) ? rawBit ^ 1 : rawBit;
        currentByte = (currentByte << 1) | unmaskedBit;
        bitCount++;
        if (bitCount === 8) {
          rawCodewords.push(currentByte);
          currentByte = 0;
          bitCount = 0;
        }
      }
    }
    upward = !upward;
  }

  const spec = VERSION_ECC_TABLE[version]?.[fmt.ecc];
  if (!spec) {
    throw new Error(`Unsupported QR version=${version} ecc=${fmt.ecc}`);
  }

  const dataBytes = deinterleaveDataCodewords(rawCodewords, spec);
  return decodePayloadFromDataBytes(dataBytes, version);
}

/**
 * Rasterizes a DOM QR element (<img>, <canvas>, or <svg>) in the browser onto an
 * offscreen <canvas> with alpha-safe white compositing and decodes its URL payload.
 */
export async function decodeQrFromElement(locator: Locator): Promise<string> {
  await expect(locator).toBeVisible();

  const raster = await locator.evaluate(async (el) => {
    const findTarget = (
      root: Element,
    ): HTMLCanvasElement | HTMLImageElement | SVGSVGElement => {
      const tag = root.tagName.toLowerCase();
      if (tag === 'canvas' || tag === 'img' || tag === 'svg') {
        return root as HTMLCanvasElement | HTMLImageElement | SVGSVGElement;
      }
      const nested = root.querySelector('canvas, img, svg');
      if (!nested) {
        throw new Error(`No canvas/img/svg element found inside <${tag}>`);
      }
      return nested as HTMLCanvasElement | HTMLImageElement | SVGSVGElement;
    };

    const target = findTarget(el);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create 2D canvas context');

    const drawWithWhiteBg = (
      source: CanvasImageSource,
      w: number,
      h: number,
    ) => {
      canvas.width = w;
      canvas.height = h;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(source, 0, 0, w, h);
    };

    const tag = target.tagName.toLowerCase();
    if (tag === 'canvas') {
      const src = target as HTMLCanvasElement;
      if (src.width === 0 || src.height === 0) {
        throw new Error('QR <canvas> has zero dimensions');
      }
      drawWithWhiteBg(src, src.width, src.height);
    } else if (tag === 'img') {
      const img = target as HTMLImageElement;
      if (!img.complete) {
        await new Promise<void>((resolve, reject) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener(
            'error',
            () => reject(new Error('QR <img> failed to load')),
            { once: true },
          );
        });
      }
      const w = img.naturalWidth || img.width || 256;
      const h = img.naturalHeight || img.height || 256;
      drawWithWhiteBg(img, w, h);
    } else {
      const svg = target as SVGSVGElement;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      const rect = svg.getBoundingClientRect();
      const vb = svg.viewBox?.baseVal;
      const w = Math.max(
        256,
        Math.round(rect.width || (vb && vb.width) || 256),
      );
      const h = Math.max(
        256,
        Math.round(rect.height || (vb && vb.height) || 256),
      );
      clone.setAttribute('width', String(w));
      clone.setAttribute('height', String(h));
      if (!clone.getAttribute('xmlns')) {
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      const xml = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () =>
            reject(new Error('Failed to rasterize QR <svg>'));
          img.src = blobUrl;
        });
        drawWithWhiteBg(img, w, h);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const total = canvas.width * canvas.height;
    const bits = new Array<number>(total);
    for (let i = 0; i < total; i++) {
      const off = i * 4;
      const r = data[off];
      const g = data[off + 1];
      const b = data[off + 2];
      const a = data[off + 3];
      const isDark =
        a >= 128 && 0.299 * r + 0.587 * g + 0.114 * b < 128 ? 1 : 0;
      bits[i] = isDark;
    }

    return { width: canvas.width, height: canvas.height, bits };
  });

  return decodeQrFromBinaryPixels(raster.width, raster.height, raster.bits);
}

export async function verifyAndDecodeSessionQr(
  page: Page,
  qrLocator: Locator,
  expectedSessionId: string,
  forbiddenControllerKey?: string,
): Promise<string> {
  const decoded = await decodeQrFromElement(qrLocator);
  let parsed: URL;
  try {
    parsed = new URL(decoded, page.url());
  } catch {
    throw new Error(`Decoded QR payload is not a valid URL: "${decoded}"`);
  }

  expect(parsed.pathname).toMatch(new RegExp(`/s/${expectedSessionId}/?$`));
  expect(parsed.searchParams.has('key')).toBe(false);
  if (forbiddenControllerKey) {
    expect(decoded).not.toContain(forbiddenControllerKey);
  }
  return decoded;
}
