export type BrandColors = { primary: string; accent: string };
export type Pixel = { red: number; green: number; blue: number; alpha?: number };

const FALLBACK: BrandColors = { primary: "#0B2144", accent: "#1967FF" };

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

export async function extractBrandColors(file: File): Promise<BrandColors> {
  const image = await imageFromFile(file);
  const width = "naturalWidth" in image ? image.naturalWidth : image.width;
  const height = "naturalHeight" in image ? image.naturalHeight : image.height;
  const scale = Math.min(1, 96 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return FALLBACK;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if ("close" in image && typeof image.close === "function") image.close();
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels: Pixel[] = [];
  for (let index = 0; index < data.length; index += 4) {
    pixels.push({ red: data[index], green: data[index + 1], blue: data[index + 2], alpha: data[index + 3] });
  }
  return deriveBrandColors(pixels);
}
