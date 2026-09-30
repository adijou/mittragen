import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import type { InvoiceRow } from "./billing-ledger.ts";
import type { OrganizationPdfBrand } from "./organization-pdf-brand.ts";
import { formatBillingChf } from "../../../shared/billing.ts";

/** Deliberately non-payable: no account, QR code, due date or issued invoice number. */
export async function createInvoiceDraftPdf(invoice: InvoiceRow, brand: OrganizationPdfBrand) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(await readFile(resolve("assets/fonts/DejaVuSans-Latin.ttf")), { subset: true });
  const bold = await pdf.embedFont(await readFile(resolve("assets/fonts/DejaVuSans-Latin-Bold.ttf")), { subset: true });
  const dark = rgb(0.04,0.13,0.26); const muted = rgb(0.32,0.39,0.46);
  const mm = (value: number) => value * 72 / 25.4;
  let page = pdf.addPage([mm(210), mm(297)]);
  let y = mm(194);
  function draw(text: string, x: number, top: number, size = 10, strong = false) {
    const font = strong ? bold : regular;
    // The embedded Latin font cannot represent every script. Replace unsupported glyphs explicitly.
    const supported = new Set(font.getCharacterSet());
    const clean = [...text.replace(/[\u2010-\u2015]/g,"-").replace(/\s/g," ")].map((char) => supported.has(char.codePointAt(0)!) ? char : "?").join("");
    page.drawText(clean,{ x, y: top, size, font, color: strong ? dark : muted });
  }
  function paragraph(text: string, size = 10, strong = false) {
    const font = strong ? bold : regular;
    let line = "";
    const flush = () => {
        if (y < mm(30)) { page = pdf.addPage([mm(210),mm(297)]); y=mm(268); }
        draw(line,mm(18),y,size,strong); y-=size*1.5; line="";
    };
    for (let word of text.trim().split(/\s+/)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`,size) > mm(174)) flush();
      while (font.widthOfTextAtSize(word,size) > mm(174)) {
        let count=1; while(count<word.length && font.widthOfTextAtSize(word.slice(0,count+1),size)<=mm(174)) count++;
        line=word.slice(0,count);flush();word=word.slice(count);
      }
      line += (line?" ":"") + word;
    }
    if (line) flush();
    y-=8;
  }
  pdf.setTitle(`Rechnungsentwurf ${invoice.reference}`);
  pdf.setAuthor(invoice.issuer.name);
  pdf.setSubject("Entwurf - keine Zahlungsaufforderung");
  draw("RECHNUNGSENTWURF",mm(18),mm(278),15,true);
  draw("Keine Zahlungsaufforderung",mm(18),mm(270),10);
  if (brand.logo) {
    const logo = brand.logo.contentType === "image/png" ? await pdf.embedPng(brand.logo.bytes) : await pdf.embedJpg(brand.logo.bytes);
    const scale = Math.min(mm(37)/logo.width,mm(18)/logo.height);
    page.drawImage(logo,{x:mm(155),y:mm(268),width:logo.width*scale,height:logo.height*scale});
  }
  // The entire right postage area (x116/y40/w89.5/h47.5 mm from the top) stays clear except recipient.
  // Long addresses fail visibly instead of silently changing the postal recipient.
  const addressLines = [invoice.recipient.name,invoice.recipient.street,`${invoice.recipient.postalCode} ${invoice.recipient.city}`,invoice.recipient.country];
  if (addressLines.some((line) => regular.widthOfTextAtSize(line,10) > mm(85.5))) throw new Error("billing_address_too_long");
  addressLines.forEach((line,index) => draw(line,mm(118),mm(237)-10-index*13,10));
  const issuerLines = [invoice.issuer.name,invoice.issuer.street,`${invoice.issuer.postalCode} ${invoice.issuer.city}`];
  issuerLines.forEach((line,index) => {
    let fontSize=10;
    while (regular.widthOfTextAtSize(line,fontSize)>mm(90) && fontSize>7) fontSize-=0.5;
    draw(line,mm(18),mm(248)-index*14,fontSize,index===0);
  });
  paragraph(invoice.reference,11,true);
  paragraph(invoice.description,12,true);
  y-=10;
  const line = (label: string,amount: number,strong=false) => {
    draw(label,mm(18),y,11,strong);
    const value=formatBillingChf(amount); const font=strong?bold:regular;
    draw(value,mm(192)-font.widthOfTextAtSize(value,11),y,11,strong); y-=26;
  };
  line("Sponsoringbeitrag zugunsten des Vereins",invoice.contribution_cents);
  line(`Plattformgebühr (${invoice.fee_basis_points / 100} %)`,invoice.platform_fee_cents);
  page.drawLine({start:{x:mm(18),y:y+14},end:{x:mm(192),y:y+14},thickness:0.7,color:rgb(.8,.83,.88)});
  line("Gesamtbetrag CHF",invoice.contribution_cents+invoice.platform_fee_cents,true);
  y-=10;
  paragraph(invoice.collection_notice || "Die Zahlungskonditionen und die vereinbarte Abrechnung des bestehenden Sponsorings bleiben unverändert.");
  paragraph("Versandkosten sind nicht enthalten. Es wurde kein kostenpflichtiger Versand ausgelöst.");
  paragraph("Dieser Entwurf ist zur Prüfung bestimmt. Die zahlbare QR-Rechnung wird nach Einrichtung der vollständigen Zahlungsangaben erstellt. Bitte auf Grundlage dieses Dokuments keine Zahlung auslösen.",10,true);
  paragraph("Steuerangaben und allfällige Mehrwertsteuer werden vor der Rechnungsfreigabe geprüft.",9);
  const pages=pdf.getPages();
  pages.forEach((sheet,index) => {
    page=sheet; draw("mittragen.ch · Rechnungsentwurf",mm(18),mm(16),8);
    draw(`${index+1} / ${pages.length}`,mm(181),mm(16),8);
  });
  return pdf.save();
}
