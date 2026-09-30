import { createHmac, timingSafeEqual } from "node:crypto";
import { BillingError } from "./billing-ledger.ts";

export type PingenConfig={environment:"staging"|"production";organisationId:string;clientId:string;secret:string;enabled:boolean};
export function pingenConfig(read:(name:string)=>string|undefined=(name)=>Netlify.env.get(name)):PingenConfig {
  const clientId=read("PINGEN_CLIENT_ID"),secret=read("PINGEN_CLIENT_SECRET"),organisationId=read("PINGEN_ORGANISATION_ID");
  if(!clientId||!secret||!organisationId)throw new BillingError("pingen_not_configured",422);
  return {clientId,secret,organisationId,environment:read("PINGEN_ENVIRONMENT")==="production"?"production":"staging",enabled:read("PINGEN_POSTAL_ENABLED")==="true"};
}
export function requirePostalEnabled(config:PingenConfig,deployContext:string|undefined) {
  if(!config.enabled)throw new BillingError("pingen_postal_disabled",422);
  if(config.environment==="production"&&deployContext!=="production")throw new BillingError("pingen_production_only",403);
}
export function pingenCents(value:unknown):number {
  if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>10000||Math.abs(value*100-Math.round(value*100))>0.000001)throw new BillingError("pingen_price_invalid",502);
  return Math.round(value*100);
}
export type PingenLetter={id:string;type:string;attributes:{status?:string;file_original_name?:string;file_pages?:number;paper_types?:string[];
  address?:string;address_position?:string;country?:string;submitted_at?:string|null;updated_at?:string;delivery_product?:string;print_mode?:string;print_spectrum?:string}};
type Envelope={data:PingenLetter};

export async function pingenClient(config:PingenConfig,fetcher:typeof fetch=fetch) {
  const base=config.environment==="production"?"https://api.pingen.com":"https://api-staging.pingen.com";
  const response=await fetcher(`${base}/auth/access-tokens`,{method:"POST",redirect:"error",signal:AbortSignal.timeout(8000),
    headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:config.clientId,client_secret:config.secret,grant_type:"client_credentials"}).toString()});
  if(!response.ok)throw new BillingError("pingen_auth_failed",502);
  const auth=await response.json() as {access_token?:unknown};
  if(typeof auth.access_token!=="string"||!auth.access_token)throw new BillingError("pingen_auth_failed",502);
  const root=`/organisations/${encodeURIComponent(config.organisationId)}/deliveries/letters`;
  const api=async<T>(path:string,method="GET",body?:object,key?:string):Promise<T>=>{
    const res=await fetcher(`${base}${path}`,{method,redirect:"error",signal:AbortSignal.timeout(8000),headers:{Accept:"application/vnd.api+json",
      "Content-Type":"application/vnd.api+json",Authorization:`Bearer ${auth.access_token}`,...(key?{"Idempotency-Key":key}:{})},body:body?JSON.stringify(body):undefined});
    if(!res.ok)throw new BillingError(`pingen_api_${res.status}`,502);
    return await res.json() as T;
  };
  const details=async(id:string)=>{
    const result=await api<Envelope>(`${root}/${encodeURIComponent(id)}`);
    if(result.data?.id!==id||result.data.type!=="letters"||!result.data.attributes)throw new BillingError("pingen_response_invalid",502);
    return result.data;
  };
  return {
    details,
    async upload(bytes:Uint8Array) {
      const result=await api<{data:{attributes:{url:string;url_signature:string}}}>("/file-upload");
      const attrs=result.data?.attributes;
      let url:URL;try{url=new URL(attrs.url);}catch{throw new BillingError("pingen_upload_invalid",502);}
      if(url.protocol!=="https:"||url.username||url.password||url.port||!(url.hostname.endsWith(".cloudscale.ch")||url.hostname.endsWith(".pingen.com"))||!attrs.url_signature)throw new BillingError("pingen_upload_invalid",502);
      // Signed storage URL comes only from Pingen. Never forward the OAuth token to object storage.
      const uploaded=await fetcher(url,{method:"PUT",body:bytes as BodyInit,redirect:"error",signal:AbortSignal.timeout(12000)});
      if(!uploaded.ok)throw new BillingError("pingen_upload_failed",502);
      return attrs;
    },
    async create(file:{url:string;url_signature:string},name:string,key:string) {
      const result=await api<Envelope>(root,"POST",{data:{type:"letters",attributes:{file_original_name:name,file_url:file.url,
        file_url_signature:file.url_signature,address_position:"right",auto_send:false,delivery_product:"cheap",print_mode:"simplex",print_spectrum:"grayscale"}}},key);
      if(typeof result.data?.id!=="string"||result.data.type!=="letters")throw new BillingError("pingen_response_invalid",502);
      return result.data;
    },
    async find(name:string) {
      const params=new URLSearchParams({filter:JSON.stringify({file_original_name:name}),"page[limit]":"2"});
      const result=await api<{data:PingenLetter[]}>(`${root}?${params}`);
      const matches=result.data?.filter(row=>row.type==="letters"&&row.attributes.file_original_name===name);
      if(!matches||matches.length!==1)throw new BillingError("pingen_recovery_required",409);
      return matches[0];
    },
    async paper(id:string,paperTypes:string[],key:string) {
      return api<Envelope>(`${root}/${encodeURIComponent(id)}`,"PATCH",{data:{type:"letters",id,attributes:{paper_types:paperTypes}}},key);
    },
    async quote(paperTypes:string[],key:string) {
      const result=await api<{data:{attributes:{currency:string;price:unknown}}}>(`${root}/price-calculator`,"POST",{data:{type:"letter_price_calculator",attributes:{country:"CH",paper_types:paperTypes,print_mode:"simplex",print_spectrum:"grayscale",delivery_product:"cheap"}}},key);
      if(result.data?.attributes?.currency!=="CHF")throw new BillingError("pingen_price_invalid",502);
      return pingenCents(result.data.attributes.price);
    },
    async send(id:string,key:string) {
      return api<Envelope>(`${root}/${encodeURIComponent(id)}/send`,"PATCH",{data:{type:"letters",id,attributes:{delivery_product:"cheap",print_mode:"simplex",print_spectrum:"grayscale"}}},key);
    },
    async costs(id:string) {
      const result=await api<{data:{attributes:{currency:string;total_cost:unknown}}}>(`${root}/${encodeURIComponent(id)}/cost-details`);
      if(result.data?.attributes?.currency!=="CHF")throw new BillingError("pingen_price_invalid",502);
      return pingenCents(result.data.attributes.total_cost);
    },
  };
}

export function validPingenSignature(body:string,signature:string|null,secret:string|undefined) {
  if(!secret||!signature||!/^[a-f0-9]{64}$/.test(signature))return false;
  const expected=createHmac("sha256",secret).update(body).digest();
  return timingSafeEqual(expected,Buffer.from(signature,"hex"));
}
