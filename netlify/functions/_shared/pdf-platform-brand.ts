import { rgb, type PDFFont, type PDFPage } from "pdf-lib";

const DEFAULT_COLOR = rgb(112 / 255, 121 / 255, 134 / 255);
const MARK_PATH = "M0 11V7.2C0 3.4 2.4 1 5.7 1S11.4 3.4 11.4 7.2V11H8.7V7.2C8.7 5.2 7.5 3.8 5.7 3.8S2.7 5.2 2.7 7.2V11ZM11.4 11V7.2C11.4 3.4 13.8 1 17.1 1S22.8 3.4 22.8 7.2V11H20.1V7.2C20.1 5.2 18.9 3.8 17.1 3.8S14.1 5.2 14.1 7.2V11Z";

type PlatformCreditOptions = {
  x?: number;
  right?: number;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  color?: ReturnType<typeof rgb>;
};

export function platformCreditWidth(regular: PDFFont, bold: PDFFont) {
  return regular.widthOfTextAtSize("Erstellt mit", 6.4)
    + 4
    + 16
    + 3.5
    + bold.widthOfTextAtSize("mittragen.ch", 7.2);
}

export function drawPlatformCredit(page: PDFPage, options: PlatformCreditOptions) {
  const color = options.color ?? DEFAULT_COLOR;
  const width = platformCreditWidth(options.regular, options.bold);
  const x = options.x ?? ((options.right ?? page.getWidth()) - width);
  const label = "Erstellt mit";
  page.drawText(label, { x, y: options.y, size: 6.4, font: options.regular, color });

  const markX = x + options.regular.widthOfTextAtSize(label, 6.4) + 4;
  page.drawSvgPath(MARK_PATH, { x: markX, y: options.y + 6.6, scale: 0.66, color });
  page.drawCircle({ x: markX + 7.52, y: options.y + 8.4, size: 1.55, color });

  page.drawText("mittragen.ch", {
    x: markX + 19.5,
    y: options.y - 0.1,
    size: 7.2,
    font: options.bold,
    color,
  });
  return width;
}
