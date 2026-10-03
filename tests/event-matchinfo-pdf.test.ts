import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument,PDFRawStream,decodePDFRawStream } from "pdf-lib";
import { writeFile } from "node:fs/promises";
import { createEventFlyerPdf, type EventFlyerPdfData } from "../netlify/functions/_shared/event-flyer-pdf.ts";

const data: EventFlyerPdfData = {
  generatedAt: "2026-09-12T12:00:00Z",
  brand: { primaryColor: "#16213E", accentColor: "#E9B949", logo: null },
  organization: { name: "Sportverein Muster", contactName: null, contactEmail: null, contactPhone: null, website: null },
  event: {
    teamName: "Heimteam",
    opponent: "Gastteam",
    competition: "Meisterschaft",
    venue: "Sportanlage Muster",
    startsAt: "2026-10-03T16:00:00Z",
    homeCoach: "Trainer Heim",
    opponentCoach: "Trainer Gast",
    refereeName: "Spielleitung Muster",
    matchInfoUrl: "https://example.test/matchcenter",
    speakerNote: "Beide Teams vor dem Anpfiff begrüssen.",
  },
  matchballSponsors: [
    { sponsorName: "Sponsor Eins AG", source: "direct", detail: "Direktbuchung" },
    { sponsorName: "Sponsor Zwei GmbH", source: "package", detail: "Bronze · Matchball" },
  ],
  partners: [
    { sponsorName: "Partner Gold AG", packageName: "Gold" },
    { sponsorName: "Partner Silber AG", packageName: "Silber" },
  ],
  publicUrl: "https://example.test/matchball/public-key",
};

function printedText(document:PDFDocument) {
  return document.context.enumerateIndirectObjects().flatMap(([,object])=>object instanceof PDFRawStream?[Buffer.from(decodePDFRawStream(object).decode()).toString('latin1')]:[]).join('\n');
}

const textHex=(value:string)=>Buffer.from(value,'latin1').toString('hex').toUpperCase();

test("match info renders multiple sponsors as one branded A4 page", async () => {
  const bytes = await createEventFlyerPdf(data);
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
  assert.equal(document.getTitle(), "Matchinfo Heimteam - Gastteam");
  assert.equal(document.getAuthor(), "Sportverein Muster");
  const page = document.getPage(0);
  assert.ok(Math.abs(page.getWidth() - 595.28) < 0.1);
  assert.ok(Math.abs(page.getHeight() - 841.89) < 0.1);
  for(const partner of data.partners!)assert.ok(printedText(document).includes(textHex(partner.sponsorName)));
});

test("more than seven Gold and Silver partners fit on the match info without omissions",async()=>{
  const partners=Array.from({length:12},(_,index)=>[
    {sponsorName:`Gold Partner ${String(index+1).padStart(2,'0')} AG`,packageName:'Goldsponsoring'},
    {sponsorName:`Silver Partner ${String(index+1).padStart(2,'0')} AG`,packageName:'Silver Partner'},
  ]).flat();
  const bytes=await createEventFlyerPdf({...data,partners});
  const pdf=await PDFDocument.load(bytes),text=printedText(pdf);
  assert.equal(pdf.getPageCount(),1);
  for(const partner of partners)assert.ok(text.includes(textHex(partner.sponsorName)),partner.sponsorName);
  if(process.env.MATCHINFO_PDF_FIXTURE)await writeFile(process.env.MATCHINFO_PDF_FIXTURE,bytes);
});

test("large partner lists continue on branded pages instead of dropping names",async()=>{
  const partners=Array.from({length:65},(_,index)=>[
    {sponsorName:`Gold Partner ${String(index+1).padStart(2,'0')} AG`,packageName:'Gold'},
    {sponsorName:`Silber Partner ${String(index+1).padStart(2,'0')} AG`,packageName:'Silber'},
  ]).flat();
  const bytes=await createEventFlyerPdf({...data,brand:{primaryColor:'#1f5129',accentColor:'#f2ca52',logo:null},partners});
  const pdf=await PDFDocument.load(bytes),text=printedText(pdf);
  assert.ok(pdf.getPageCount()>1);
  for(const partner of partners)assert.ok(text.includes(textHex(partner.sponsorName)),partner.sponsorName);
  if(process.env.MATCHINFO_OVERFLOW_PDF_FIXTURE)await writeFile(process.env.MATCHINFO_OVERFLOW_PDF_FIXTURE,bytes);
});

test("match info remains one page without assigned sponsors", async () => {
  const bytes = await createEventFlyerPdf({ ...data, matchballSponsors: [] });
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
});
