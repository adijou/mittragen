import { calculateQRReferenceChecksum, isIBANValid, isQRIBAN, isQRReferenceValid } from "swissqrbill/utils";
import type { Data, Debtor } from "swissqrbill/types";
import type { InvoiceParty } from "./billing-sources.ts";

export type QrCreditor = InvoiceParty & { iban: string; houseNumber: string };

function field(value: unknown, max: number, optional = false): string {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("billing_qr_address_invalid");
  const text = value.trim().normalize("NFC");
  if ((!optional && !text) || [...text].length > max) throw new Error("billing_qr_address_invalid");
  return text;
}

export function qrParty(party: InvoiceParty, houseNumber = ""): Debtor {
  const country = field(party.country, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("billing_qr_address_invalid");
  const zip = field(party.postalCode, 16);
  if ((country === "CH" || country === "LI") && !/^\d{4}$/.test(zip)) throw new Error("billing_qr_address_invalid");
  const street = field(party.street, 70, true);
  // Existing postal addresses have one street line. Split only an unambiguous terminal number.
  const split = !houseNumber && street.match(/^(.+?)\s+(\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)$/u);
  return { name: field(party.name, 70), address: split ? split[1] : street,
    buildingNumber: field(houseNumber || (split ? split[2] : ""), 16, true), zip,
    city: field(party.city, 35), country };
}

export function readQrCreditor(read: (name: string) => string | undefined): QrCreditor | null {
  try {
    const value = JSON.parse(read("BILLING_QR_CREDITOR") ?? "null");
    if (!value || typeof value.iban !== "string") return null;
    const iban = value.iban.replace(/ /g, "").toUpperCase();
    if (!/^(CH|LI)\d{19}$/.test(iban) || !isIBANValid(iban) || !isQRIBAN(iban)) return null;
    const party = qrParty({...value, street: value.street ?? ""}, value.houseNumber ?? "");
    return { iban, name: party.name, street: party.address, houseNumber: String(party.buildingNumber ?? ""),
      postalCode: String(party.zip), city: party.city, country: party.country };
  } catch { return null; }
}

/** Database-wide sequence gives all clubs on the collection account distinct references. */
export function qrReference(sequence: string): string {
  if (!/^[1-9]\d{0,25}$/.test(sequence)) throw new Error("billing_qr_reference_invalid");
  const body = sequence.padStart(26, "0");
  return body + calculateQRReferenceChecksum(body);
}

export function invoiceQrData(input: { creditor: QrCreditor; recipient: InvoiceParty; amountCents: number; qrReference: string; invoiceNumber: string }): Data {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > 99999999999
    || !isQRReferenceValid(input.qrReference)) throw new Error("billing_qr_data_invalid");
  return { currency: "CHF", amount: input.amountCents / 100, reference: input.qrReference,
    message: field(`Rechnung ${input.invoiceNumber}`, 140), debtor: qrParty(input.recipient),
    creditor: { ...qrParty(input.creditor, input.creditor.houseNumber), account: input.creditor.iban } };
}
