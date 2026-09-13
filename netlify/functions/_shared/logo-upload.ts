import { PDFDocument } from "pdf-lib";
import { isLogoUpload } from "./organization-profile-input.ts";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

type LogoContentType = "image/png" | "image/jpeg";

type LogoValidationResult =
  | { ok: true; value: { buffer: ArrayBuffer; contentType: LogoContentType; size: number } }
  | { ok: false; error: "invalid_logo_size" | "invalid_logo_type" | "invalid_logo_dimensions" | "invalid_logo_file" };

function detectedContentType(bytes: Uint8Array): LogoContentType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

function imageDimensions(bytes: Uint8Array, contentType: LogoContentType) {
  if (contentType === "image/png") {
    if (bytes.length < 24) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (startOfFrame.has(marker) && length >= 7) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  return null;
}

export async function validateLogoUpload(value: unknown): Promise<LogoValidationResult> {
  if (!isLogoUpload(value) || value.size === 0 || value.size > MAX_LOGO_BYTES) {
    return { ok: false, error: "invalid_logo_size" };
  }
  let buffer: ArrayBuffer;
  try {
    buffer = await value.arrayBuffer();
  } catch {
    return { ok: false, error: "invalid_logo_file" };
  }
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_LOGO_BYTES || buffer.byteLength !== value.size) {
    return { ok: false, error: "invalid_logo_size" };
  }
  const bytes = new Uint8Array(buffer);
  const contentType = detectedContentType(bytes);
  if (!contentType) return { ok: false, error: "invalid_logo_type" };
  const dimensions = imageDimensions(bytes, contentType);
  if (!dimensions || dimensions.width < 16 || dimensions.height < 16 || dimensions.width > 6000 || dimensions.height > 6000
    || dimensions.width * dimensions.height > 30_000_000) return { ok: false, error: "invalid_logo_dimensions" };
  try {
    const probe = await PDFDocument.create();
    if (contentType === "image/png") await probe.embedPng(bytes);
    else await probe.embedJpg(bytes);
  } catch {
    return { ok: false, error: "invalid_logo_file" };
  }
  return { ok: true, value: { buffer, contentType, size: value.size } };
}
