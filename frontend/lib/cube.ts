/**
 * Parse Adobe .cube 3D LUT files.
 *
 * Layout in the file: r varies fastest, then g, then b.
 * Output: Float32Array of length N*N*N*4 (RGBA), suitable for WebGPU rgba32float.
 */

export type ParsedCube = {
  size: number;
  /** Flat RGBA buffer; index order matches WebGPU texture_3d write order (depth-major). */
  data: Float32Array;
  title?: string;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
};

export async function fetchCube(url: string): Promise<ParsedCube> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch cube: ${res.status} ${url}`);
  const text = await res.text();
  return parseCube(text);
}

export function parseCube(text: string): ParsedCube {
  let size = 0;
  let title: string | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("TITLE")) {
      title = line.slice(5).trim().replace(/^"|"$/g, "");
      continue;
    }
    if (line.startsWith("LUT_3D_SIZE")) {
      size = parseInt(line.split(/\s+/)[1] ?? "0", 10);
      continue;
    }
    if (line.startsWith("LUT_1D_SIZE")) {
      throw new Error("1D LUT files not supported");
    }
    if (line.startsWith("DOMAIN_MIN")) {
      const parts = line.split(/\s+/).slice(1, 4).map(Number);
      if (parts.length === 3) domainMin = parts as [number, number, number];
      continue;
    }
    if (line.startsWith("DOMAIN_MAX")) {
      const parts = line.split(/\s+/).slice(1, 4).map(Number);
      if (parts.length === 3) domainMax = parts as [number, number, number];
      continue;
    }
    // assume an "r g b" triplet
    const nums = line.split(/\s+/).map(Number);
    if (nums.length === 3 && nums.every((n) => Number.isFinite(n))) {
      values.push(nums[0], nums[1], nums[2]);
    }
  }

  if (size <= 0) throw new Error("missing LUT_3D_SIZE");
  const expected = size * size * size * 3;
  if (values.length !== expected) {
    throw new Error(
      `cube data length mismatch: got ${values.length}, expected ${expected}`,
    );
  }

  // .cube order: r fastest, then g, then b. WebGPU writeTexture with bytesPerRow
  // and rowsPerImage assumes [x, y, z] index order where x is fastest within a row.
  // So x=r, y=g, z=b. We pack RGBA tightly.
  const data = new Float32Array(size * size * size * 4);
  let i = 0;
  let j = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        data[j++] = values[i++];
        data[j++] = values[i++];
        data[j++] = values[i++];
        data[j++] = 1.0;
      }
    }
  }

  return { size, data, title, domainMin, domainMax };
}

export function identityCube(size = 17): ParsedCube {
  const data = new Float32Array(size * size * size * 4);
  let j = 0;
  for (let b = 0; b < size; b++) {
    const bv = b / (size - 1);
    for (let g = 0; g < size; g++) {
      const gv = g / (size - 1);
      for (let r = 0; r < size; r++) {
        const rv = r / (size - 1);
        data[j++] = rv;
        data[j++] = gv;
        data[j++] = bv;
        data[j++] = 1.0;
      }
    }
  }
  return {
    size,
    data,
    title: "Identity",
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
  };
}
