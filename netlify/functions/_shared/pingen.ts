import { BillingError } from "./billing-ledger.ts";

type Env = (name:string)=>string|undefined;
/** Read-only pricing integration. No upload/create/send operation exists in this milestone. */
export async function pingenSamplePrice(read:Env=(name)=>Netlify.env.get(name), fetcher:typeof fetch=fetch) {
  const clientId=read("PINGEN_CLIENT_ID"),secret=read("PINGEN_CLIENT_SECRET"),organisationId=read("PINGEN_ORGANISATION_ID");
  if(!clientId||!secret||!organisationId)throw new BillingError("pingen_not_configured",422);
  const environment=read("PINGEN_ENVIRONMENT") === "production" ? "production" : "staging";
  // Current official Pingen JS SDK endpoints. Hosts cannot be supplied by a browser request.
  const base=environment==="production"?"https://api.pingen.com":"https://api-staging.pingen.com";
  const auth=await fetcher(`${base}/auth/access-tokens`,{method:"POST",redirect:"error",signal:AbortSignal.timeout(12_000),
    headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:secret,grant_type:"client_credentials"}).toString()});
  if(!auth.ok)throw new BillingError("pingen_auth_failed",502);
  const token=await auth.json() as {access_token?:unknown};
  if(typeof token.access_token!=="string"||!token.access_token)throw new BillingError("pingen_auth_failed",502);
  const response=await fetcher(`${base}/organisations/${encodeURIComponent(organisationId)}/deliveries/letters/price-calculator`,{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(12_000),headers:{"Content-Type":"application/vnd.api+json",Accept:"application/vnd.api+json",Authorization:`Bearer ${token.access_token}`},
    body:JSON.stringify({data:{type:"letter_price_calculator",attributes:{country:"CH",paper_types:["normal","qr"],print_mode:"simplex",print_spectrum:"grayscale",delivery_product:"cheap"}}})});
  if(!response.ok)throw new BillingError("pingen_price_failed",502);
  const data=await response.json() as {data?:{attributes?:{currency?:unknown;price?:unknown}}};
  const price=data.data?.attributes?.price;
  if(data.data?.attributes?.currency!=="CHF" || typeof price!=="number" || !Number.isFinite(price) || price<0)throw new BillingError("pingen_price_invalid",502);
  return {environment,currency:"CHF",price,calculatedAt:new Date().toISOString(),
    description:"Kostenbeispiel Schweiz: 2 Seiten, davon 1 QR-Blatt, einseitig, Graustufen, Versandart cheap.",
    note:"Unverbindliche Preisabfrage. Keine Adressdaten übertragen, kein Brief erstellt und keine Kosten freigegeben. Steuerbehandlung und endgültiger Dokumentpreis sind vor dem Versand zu prüfen."};
}
