import type { Config,Context } from "@netlify/functions";
import { verifyRequestOrigin } from "@netlify/identity";
import { hasPermission,isResponse,json,requireUser,type MembershipRole } from "./_shared/auth.ts";
import { isUuid,withSession } from "./_shared/database.ts";
import { BillingError } from "./_shared/billing-ledger.ts";
import { preparePostal,sendPostal,syncPostal } from "./_shared/postal-dispatch.ts";

export default async(request:Request,context:Context)=>{
  const match=new URL(request.url).pathname.match(/^\/api\/postal\/([0-9a-f-]+)\/(invoices|dispatches)\/([0-9a-f-]+)\/(prepare|sync|send)$/i);
  if(!match||!isUuid(match[1])||!isUuid(match[3]))return json({error:"not_found"},404);
  if(request.method!=="POST")return json({error:"method_not_allowed"},405);
  const user=await requireUser(request);if(isResponse(user))return user;
  try{verifyRequestOrigin(request);}catch{return json({error:"invalid_request_origin"},403);}
  const [,tenantId,resource,id,action]=match;
  if(resource==='invoices'&&action!=='prepare'||resource==='dispatches'&&action==='prepare')return json({error:"not_found"},404);
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body))return json({error:"invalid_billing_input"},422);
  try{
    await withSession(user.id,tenantId,async client=>{
      const row=(await client.query<{role:MembershipRole}>("SELECT role FROM tenant_memberships WHERE tenant_id=$1 AND identity_user_id=$2",[tenantId,user.id])).rows[0];
      if(!row||!hasPermission(row.role,"finance:write"))throw new BillingError("permission_denied",403);
    },user.email??undefined);
    const session={actor:user.id,tenantId,email:user.email??undefined};
    const result=action==='prepare'?await preparePostal(session,id,context.deploy?.context):action==='sync'?await syncPostal(session,id):
      await sendPostal(session,id,{quoteToken:body.quoteToken,quotedCents:body.quotedCents,costsAccepted:body.costsAccepted===true},context.deploy?.context);
    return json({dispatch:result});
  }catch(error){
    if(error instanceof BillingError)return json({error:error.message},error.status);
    console.error("postal_request_failed",{requestId:context.requestId,tenantId});return json({error:"pingen_request_uncertain"},502);
  }
};
export const config:Config={path:["/api/postal/:tenantId/invoices/:id/prepare","/api/postal/:tenantId/dispatches/:id/sync","/api/postal/:tenantId/dispatches/:id/send"]};
