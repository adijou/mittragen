import type { Config } from "@netlify/functions";
import { withSession } from "./_shared/database.ts";
import { json } from "./_shared/auth.ts";
import { validPingenSignature,pingenConfig } from "./_shared/pingen-client.ts";
import { syncPostal } from "./_shared/postal-dispatch.ts";

export default async(request:Request)=>{
  if(request.method!=="POST")return new Response(null,{status:405});
  if(Number(request.headers.get('content-length')??0)>65536)return new Response(null,{status:413});
  const raw=await request.text();if(Buffer.byteLength(raw)>65536)return new Response(null,{status:413});
  const signature=request.headers.get('signature'),secret=Netlify.env.get('PINGEN_WEBHOOK_SECRET');
  if(!validPingenSignature(raw,signature,secret)){
    // Diagnose delivery configuration without recording credentials, signatures or payloads.
    console.warn('pingen_webhook_signature_rejected',{
      secretConfigured:Boolean(secret),signaturePresent:Boolean(signature),
      signatureFormatValid:Boolean(signature&&/^[a-f0-9]{64}$/.test(signature)),
    });
    return new Response(null,{status:401});
  }
  let decoded:unknown;try{decoded=JSON.parse(raw);}catch{return new Response(null,{status:400});}
  if(!decoded||typeof decoded!=='object')return new Response(null,{status:400});
  const payload=decoded as {data?:{id?:string;type?:string;relationships?:Record<string,{data?:{id?:string;type?:string}}>}};
  const data=payload.data;
  if(!data?.id||!data.type||!['webhook_sent','webhook_issues','webhook_delivered','webhook_undeliverable'].includes(data.type))return json({ignored:true});
  const relation=data.relationships?.deliverable?.data??data.relationships?.letter?.data;
  if(relation?.type!=='letters'||!relation.id)return json({ignored:true});
  try{
    const conf=pingenConfig();
    if(data.relationships?.organisation?.data?.id!==conf.organisationId)return new Response(null,{status:401});
    const row=await withSession('system:pingen-webhook',null,async client=>(await client.query<{id:string;tenant_id:string}>(
      "SELECT id,tenant_id FROM billing_postal_dispatches WHERE environment=$1 AND organisation_id=$2 AND provider_letter_id=$3",[conf.environment,conf.organisationId,relation.id])).rows[0]);
    if(!row)return json({ignored:true});
    const duplicate=await withSession('system:pingen-webhook',row.tenant_id,client=>client.query("SELECT event_id FROM billing_pingen_webhook_events WHERE environment=$1 AND organisation_id=$2 AND event_id=$3",[conf.environment,conf.organisationId,data.id]));
    if(duplicate.rows.length)return json({received:true});
    // Pull authoritative current state; an old webhook can never replay an old price or recipient.
    await syncPostal({actor:'system:pingen-webhook',tenantId:row.tenant_id},row.id);
    await withSession('system:pingen-webhook',row.tenant_id,client=>client.query(`INSERT INTO billing_pingen_webhook_events(tenant_id,environment,organisation_id,event_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[row.tenant_id,conf.environment,conf.organisationId,data.id]));
    return json({received:true});
  }catch{return json({error:"pingen_sync_failed"},503);}
};
export const config:Config={path:"/api/pingen/webhook"};
