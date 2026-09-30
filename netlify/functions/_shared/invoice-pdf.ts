import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import PDFKit from "pdfkit";
import { SwissQRBill } from "swissqrbill/pdf";
import type { InvoiceRow } from "./billing-ledger.ts";
import type { OrganizationPdfBrand } from "./organization-pdf-brand.ts";
import { formatBillingChf } from "../../../shared/billing.ts";
import { invoiceQrData } from "./swiss-qr.ts";

/** Drafts remain non-payable. Issued copies include a separate A4 QR sheet for simplex postal printing. */
export async function createInvoicePdf(invoice: InvoiceRow, brand: OrganizationPdfBrand) {
  const issued = invoice.status === "issued";
  const documentNumber = issued ? invoice.invoice_number! : invoice.reference;
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
    // Never silently change a name or payment instruction in a financial document.
    const supported = new Set(font.getCharacterSet());
    const clean = text.replace(/[\u2010-\u2015]/g,"-").replace(/\s/g," ");
    if ([...clean].some(char => !supported.has(char.codePointAt(0)!))) throw new Error("billing_pdf_character_unsupported");
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
  pdf.setTitle(`${issued ? "Rechnung" : "Rechnungsentwurf"} ${documentNumber}`);
  pdf.setAuthor(invoice.issuer.name);
  pdf.setSubject(issued ? "Rechnung mit Schweizer QR-Zahlteil" : "Entwurf - keine Zahlungsaufforderung");
  draw(issued ? "RECHNUNG" : "RECHNUNGSENTWURF",mm(18),mm(278),15,true);
  draw(issued ? `Rechnungsdatum: ${invoice.issued_on!.slice(0,10).split("-").reverse().join(".")}` : "Keine Zahlungsaufforderung",mm(18),mm(270),10);
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
  paragraph(documentNumber,11,true);
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
  paragraph(issued ? "Es werden keine Versandkosten verrechnet." : "Versandkosten sind nicht enthalten. Es wurde kein kostenpflichtiger Versand ausgelöst.");
  if (issued) {
    paragraph("Bitte verwenden Sie für die Zahlung den beiliegenden QR-Zahlteil mit der angegebenen Referenz. Es gelten die vereinbarten Zahlungskonditionen.",10,true);
    if (!invoice.payment_creditor || !invoice.qr_reference || !invoice.invoice_number) throw new Error("billing_qr_data_invalid");
    const data = invoiceQrData({creditor:invoice.payment_creditor,recipient:invoice.recipient,
      amountCents:invoice.contribution_cents+invoice.platform_fee_cents,qrReference:invoice.qr_reference,invoiceNumber:invoice.invoice_number});
    // PDFKit's standard Helvetica must represent every QR field exactly (no missing glyphs).
    const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
    try { for (const party of [data.creditor,data.debtor!]) for (const value of Object.values(party)) helvetica.encodeText(String(value)); }
    catch { throw new Error("billing_pdf_character_unsupported"); }
    const qr = new SwissQRBill(data,{language:"DE",scissors:true,outlines:true});
    const qrDocument = new PDFKit({size:"A4",margin:0});
    const chunks: Buffer[] = [];
    const qrBytes = new Promise<Buffer>((resolve,reject) => {
      qrDocument.on("data",(chunk:Buffer)=>chunks.push(chunk));
      qrDocument.on("end",()=>resolve(Buffer.concat(chunks))); qrDocument.on("error",reject);
    });
    qr.attachTo(qrDocument); qrDocument.end();
    const [paymentPage] = await pdf.embedPdf(await qrBytes);
    page = pdf.addPage([mm(210),mm(297)]);
    page.drawPage(paymentPage,{x:0,y:0,width:mm(210),height:mm(297)});
    draw(`Zahlteil zur Rechnung ${documentNumber}`,mm(18),mm(278),14,true);
    draw("Bitte diesen Rechnungsbetrag nur einmal bezahlen.",mm(18),mm(265),10);
  } else {
    paragraph("Dieser Entwurf ist zur Prüfung bestimmt. Bitte auf Grundlage dieses Dokuments keine Zahlung auslösen. Die zahlbare QR-Rechnung entsteht erst bei der Freigabe.",10,true);
    paragraph("Steuerangaben und allfällige Mehrwertsteuer werden vor der Rechnungsfreigabe geprüft.",9);
  }
  const pages=pdf.getPages();
  pages.forEach((sheet,index) => {
    // Never put a footer inside the reserved 210 x 105 mm QR payment area.
    const footerY = issued && index === pages.length-1 ? mm(120) : mm(16);
    page=sheet; draw(`mittragen.ch · ${issued ? documentNumber : "Rechnungsentwurf"}`,mm(18),footerY,8);
    draw(`${index+1} / ${pages.length}`,mm(181),footerY,8);
  });
  return pdf.save();
}

export const createInvoiceDraftPdf = createInvoicePdf;
