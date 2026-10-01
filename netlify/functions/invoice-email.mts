import type { Config,Context } from "@netlify/functions";
import { verifyRequestOrigin } from "@netlify/identity";
import { hasPermission,isResponse,json,requireUser,type MembershipRole } from "./_shared/auth.ts";
import { isUuid,withSession } from "./_shared/database.ts";
import { BillingError } from "./_shared/billing-ledger.ts";
import { sendInvoiceEmail,validInvoiceEmail } from "./_shared/invoice-email.ts";

export default async(request:Request,context:Context)=>{
  const match=new URL(request.url).pathname.match(/^\/api\/invoice-email\/([0-9a-f-]+)\/invoices\/([0-9a-f-]+)\/send$/i);
  if(!match||!isUuid(match[1])||!isUuid(match[2]))return json({error:"not_found"},404);
  if(request.method!=="POST")return json({error:"method_not_allowed"},405);
  const user=await requireUser(request);if(isResponse(user))return user;
  try{verifyRequestOrigin(request);}catch{return json({error:"invalid_request_origin"},403);}
  const [,tenantId,id]=match;
  const body=await request.json().catch(()=>null);
  if(!body||body.confirmed!==true||!validInvoiceEmail(body.recipientEmail))return json({error:"invoice_email_confirmation_required"},422);
  try{
    await withSession(user.id,tenantId,async client=>{
      const member=(await client.query<{role:MembershipRole}>("SELECT role FROM tenant_memberships WHERE tenant_id=$1 AND identity_user_id=$2",[tenantId,user.id])).rows[0];
      if(!member||!hasPermission(member.role,"finance:write"))throw new BillingError("permission_denied",403);
    },user.email??undefined);
    return json({dispatch:await sendInvoiceEmail({actor:user.id,tenantId,email:user.email??undefined},id,body.recipientEmail,context.deploy?.context)});
  }catch(error){
    if(error instanceof BillingError)return json({error:error.message},error.status);
    console.error("invoice_email_failed",{requestId:context.requestId,tenantId});return json({error:"invoice_email_uncertain"},502);
  }
};
export const config:Config={path:"/api/invoice-email/:tenantId/invoices/:id/send"};
