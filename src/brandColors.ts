export type BrandColors = { primary: string; accent: string };
export type Pixel = { red: number; green: number; blue: number; alpha?: number };
export type PreparedLogo = { file: File; colors: BrandColors; optimized: boolean };

const FALLBACK: BrandColors = { primary: "#0B2142", accent: "#1F6BFF" };
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_RENDER_DIMENSION = 2400;
const MIN_RENDER_DIMENSION = 16;

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function saturation(red: number, green: number, blue: number) {
  const maximum = Math.max(red, green, blue) / 255;
  const minimum = Math.min(red, green, blue) / 255;
  if (maximum === minimum) return 0;
  const lightness = (maximum + minimum) / 2;
  return (maximum - minimum) / (1 - Math.abs(2 * lightness - 1));
}

function distance(first: Pixel, second: Pixel) {
  return Math.sqrt((first.red - second.red) ** 2 + (first.green - second.green) ** 2 + (first.blue - second.blue) ** 2);
}

function candidates(pixels: Pixel[]) {
  const buckets = new Map<string, { count: number; red: number; green: number; blue: number }>();
  for (const pixel of pixels) {
    if ((pixel.alpha ?? 255) < 120) continue;
    const brightness = (pixel.red * 299 + pixel.green * 587 + pixel.blue * 114) / 1000;
    if (brightness > 245) continue;
    const key = [pixel.red, pixel.green, pixel.blue].map((value) => Math.round(value / 24) * 24).join(":");
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += pixel.red;
    bucket.green += pixel.green;
    bucket.blue += pixel.blue;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((bucket) => ({
    count: bucket.count,
    red: bucket.red / bucket.count,
    green: bucket.green / bucket.count,
    blue: bucket.blue / bucket.count,
  })).sort((first, second) => second.count - first.count);
}

export function deriveBrandColors(pixels: Pixel[]): BrandColors {
  const palette = candidates(pixels);
  if (!palette.length) return FALLBACK;
  const vivid = palette.filter((item) => saturation(item.red, item.green, item.blue) >= 0.22);
  const primary = vivid[0] ?? palette[0];
  const accent = vivid.find((item) => distance(item, primary) >= 95)
    ?? palette.find((item) => distance(item, primary) >= 110)
    ?? vivid[1]
    ?? { red: 233, green: 180, blue: 76 };
  return {
    primary: rgbToHex(primary.red, primary.green, primary.blue),
    accent: rgbToHex(accent.red, accent.green, accent.blue),
  };
}

async function imageFromFile(file: File) {
  if ("createImageBitmap" in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function closeImage(image: ImageBitmap | HTMLImageElement) {
  if ("close" in image && typeof image.close === "function") image.close();
}

function imageDimensions(image: ImageBitmap | HTMLImageElement) {
  const width = "naturalWidth" in image ? image.naturalWidth : image.width;
  const height = "naturalHeight" in image ? image.naturalHeight : image.height;
  return { width, height };
}

function colorsFromImage(image: ImageBitmap | HTMLImageElement): BrandColors {
  const { width, height } = imageDimensions(image);
  const scale = Math.min(1, 96 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return FALLBACK;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels: Pixel[] = [];
  for (let index = 0; index < data.length; index += 4) {
    pixels.push({ red: data[index], green: data[index + 1], blue: data[index + 2], alpha: data[index + 3] });
  }
  return deriveBrandColors(pixels);
}

export function normalizedLogoDimensions(width: number, height: number, maximum = MAX_RENDER_DIMENSION) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < MIN_RENDER_DIMENSION || height < MIN_RENDER_DIMENSION) return null;
  let scale = Math.min(1, maximum / Math.max(width, height));
  if (Math.min(width, height) * scale < MIN_RENDER_DIMENSION) {
    scale = MIN_RENDER_DIMENSION / Math.min(width, height);
  }
  const normalized = { width: Math.round(width * scale), height: Math.round(height * scale) };
  return normalized.width <= 6000 && normalized.height <= 6000 && normalized.width * normalized.height <= 30_000_000
    ? normalized
    : null;
}

function canvasBlob(canvas: HTMLCanvasElement, contentType: "image/png" | "image/jpeg") {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("logo_normalization_failed")),
    contentType,
    contentType === "image/jpeg" ? 0.9 : undefined,
  ));
}

async function normalizedLogoBlob(image: ImageBitmap | HTMLImageElement, contentType: "image/png" | "image/jpeg") {
  const source = imageDimensions(image);
  const initial = normalizedLogoDimensions(source.width, source.height);
  if (!initial) throw new Error("invalid_logo_dimensions");
  let width = initial.width;
  let height = initial.height;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("logo_normalization_failed");
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasBlob(canvas, contentType);
    if (blob.size <= MAX_UPLOAD_BYTES) return { blob, width, height };
    width = Math.max(MIN_RENDER_DIMENSION, Math.round(width * 0.72));
    height = Math.max(MIN_RENDER_DIMENSION, Math.round(height * 0.72));
  }
  throw new Error("invalid_logo_size");
}

export async function extractBrandColors(file: File): Promise<BrandColors> {
  const image = await imageFromFile(file);
  try {
    return colorsFromImage(image);
  } finally {
    closeImage(image);
  }
}

export async function prepareLogoUpload(file: File): Promise<PreparedLogo> {
  const image = await imageFromFile(file);
  try {
    const colors = colorsFromImage(image);
    const contentType = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
    const prepared = await normalizedLogoBlob(image, contentType);
    const baseName = file.name.replace(/\.[^.]+$/, "") || "logo";
    const extension = contentType === "image/jpeg" ? "jpg" : "png";
    return {
      colors,
      file: new File([prepared.blob], `${baseName}.${extension}`, { type: contentType, lastModified: Date.now() }),
      optimized: prepared.width !== imageDimensions(image).width
        || prepared.height !== imageDimensions(image).height
        || prepared.blob.size !== file.size,
    };
  } finally {
    closeImage(image);
  }
}
