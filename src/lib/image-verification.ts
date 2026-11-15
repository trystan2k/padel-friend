/** Shared raster-image checks. MIME alone is untrusted; inspect only a bounded header. */
export function matchesImageMagicBytes(type: string, bytes: Uint8Array): boolean {
  if (type === 'image/jpeg')
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png')
    return (
      bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    );
  return (
    type === 'image/webp' &&
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  );
}

export async function isVerifiedImage(blob: Blob, maxBytes: number): Promise<boolean> {
  if (blob.size < 1 || blob.size > maxBytes) return false;
  return matchesImageMagicBytes(blob.type, new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
}
