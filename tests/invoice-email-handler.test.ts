import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import type {DatabaseClient} from '../netlify/functions/_shared/database.ts';
import {runDeliveryBatch} from '../shared/delivery-batch.ts';

const hooks=registerHooks({load(url,context,nextLoad){
  if(url.includes('/node_modules/@netlify/identity/'))return {shortCircuit:true,format:'module',source:`export class AuthError extends Error {};let user;export const setTestUser=value=>user=value;export const getUser=async()=>user;export const refreshSession=async()=>{};export const verifyRequestOrigin=request=>{if(request.headers.get('origin')!==new URL(request.url).origin)throw new Error('origin')};`};
  if(url.endsWith('/netlify/functions/_shared/database.ts'))return {shortCircuit:true,format:'module',source:`let session;export const setTestSession=value=>session=value;export const withSession=(...args)=>session(...args);export const isUuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);`};
  return nextLoad(url,context);
}});
const {default:mail}=await import('../netlify/functions/invoice-email.mts');
const {default:finance}=await import('../netlify/functions/finance.mts');
const {setTestSession}=await import('../netlify/functions/_shared/database.ts') as never as {setTestSession:(fn:unknown)=>void};
const {setTestUser}=await import('@netlify/identity') as never as {setTestUser:(user:unknown)=>void};
hooks.deregister();

test('bulk dispatch preserves partial success and stops before starting the next item',async()=>{
  const results:unknown[]=[];let stopped=false;
  const done=await runDeliveryBatch([{id:'one'},{id:'two'},{id:'three'},{id:'four'}],async row=>{if(row.id==='two')throw new Error('provider failed');if(row.id==='three')stopped=true;return 'accepted';},row=>results.push(row),()=>stopped);
  assert.deepEqual(done.map(row=>[row.id,row.ok]),[['one',true],['two',false],['three',true]]);assert.deepEqual(results,done);
});

test('invoice email routes preserve immutable attachments, tenant isolation and exactly one provider job',async t=>{
  const db=new PGlite({extensions:{pgcrypto}});await db.waitReady;const originalFetch=globalThis.fetch;
  try{
    const migrations=new URL('../netlify/database/migrations/',import.meta.url);
    for(const dir of (await readdir(migrations)).sort())await db.exec(await readFile(new URL(`${dir}/migration.sql`,migrations),'utf8'));
    await db.exec('CREATE ROLE email_test NOLOGIN;GRANT USAGE ON SCHEMA public TO email_test;GRANT ALL ON ALL TABLES IN SCHEMA public TO email_test;GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO email_test;');
    const session=async<T>(id:string,tenant:string|null,fn:(client:DatabaseClient)=>Promise<T>,email?:string)=>db.transaction(async tx=>{
      await tx.exec('SET LOCAL ROLE email_test');await tx.query("SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true),set_config('app.user_email',$3,true)",[id,tenant??'',email??'']);
      return fn({query:async<Row>(sql:string,args?:unknown[])=>{const result=await tx.query<Row>(sql,args);return{rows:result.rows,rowCount:result.affectedRows??result.rows.length};},release(){}});
    });setTestSession(session);
    const tenant=randomUUID(),other=randomUUID(),event=randomUUID();
    const env:Record<string,string>={RESEND_API_KEY:'fake-key',MAIL_FROM:'Test <test@example.invalid>',BILLING_OPERATOR_USER_IDS:'owner',BILLING_QR_CREDITOR:JSON.stringify({iban:'CH4431999123000889012',name:'Test Inkasso',street:'',houseNumber:'',postalCode:'8000',city:'Zürich',country:'CH'})};
    Object.assign(globalThis,{Netlify:{env:{get:(name:string)=>env[name]}}});
    await db.query("INSERT INTO tenants(id,slug,name) VALUES($1,'email-one','Verein Eins'),($2,'email-two','Verein Zwei')",[tenant,other]);
    await db.query("INSERT INTO tenant_memberships(tenant_id,identity_user_id,role) VALUES($1,'owner','owner'),($1,'reader','viewer'),($2,'owner','owner')",[tenant,other]);
    await db.query("INSERT INTO tenant_contract_settings(tenant_id,legal_name,street,postal_code,city,contact_email,updated_by) VALUES($1,'Verein Eins','Testweg 1','8000','Zürich','club@example.invalid','fixture')",[tenant]);
    await db.query("INSERT INTO sponsorship_events(id,tenant_id,team_name,opponent,starts_at,price_cents,status,created_by) VALUES($1,$2,'FC Beispiel','FC Gast','2026-10-01',40000,'published','fixture')",[event,tenant]);
    let user='owner';setTestUser({id:user});
    const ctx={requestId:'email-test',deploy:{context:'production'}} as never;
    const request=(kind:string,tenantId:string,path:string,body?:object,origin='https://test.invalid')=>new Request(`https://test.invalid/api/${kind}/${tenantId}${path}`,{method:body?'POST':'GET',headers:{Origin:origin,'X-Sponsor-Account':user},body:body?JSON.stringify(body):undefined});
    const bill=async(path:string,body?:object)=>{const response=await finance(request('finance',tenant,path,body),ctx);const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;};
    const send=async(id:string,body:object={recipientEmail:'sponsor@example.invalid',confirmed:true},status=200,tenantId=tenant,context=ctx)=>{const response=await mail(request('invoice-email',tenantId,`/invoices/${id}/send`,body),context);const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
    const make=async(issue=true)=>{
      const booking=randomUUID();await db.query("INSERT INTO event_sponsorship_bookings(id,tenant_id,event_id,reference,sponsor_name,address,postal_code,city,contact_name,contact_email,payment_mode,amount_cents,fee_basis_points) VALUES($1,$2,$3,$4,'Sponsor & <script>test</script>','Testweg 2','8000','Zürich','Test Person','sponsor@example.invalid','invoice',40000,250)",[booking,tenant,event,`MB-2026-${randomUUID().slice(0,8).toUpperCase()}`]);
      const invoice=(await bill('/invoices',{sourceKey:`event:${booking}`})).invoice;
      if(issue)await bill(`/invoices/${invoice.id}/issue`,{detailsConfirmed:true});return invoice.id as string;
    };
    let calls=0,deliveries=0,lose=false;
    const requests=new Map<string,string>();
    globalThis.fetch=(async(url,init)=>{
      assert.equal(String(url),'https://api.resend.com/emails');calls++;
      const key=new Headers(init?.headers).get('Idempotency-Key')!;assert.match(key,/^invoice-email\//);
      const body=String(init?.body);const existing=requests.get(key);
      if(existing)assert.equal(body,existing);else{requests.set(key,body);deliveries++;}
      if(lose)throw new Error('response lost');return new Response(JSON.stringify({id:`provider-${key}`}),{status:200});
    }) as typeof fetch;
    const invoice=await make();
    await t.test('authorization, origin, consent, environment and configuration are checked before mail',async()=>{
      user='reader';setTestUser({id:user});await send(invoice,undefined,403);user='owner';setTestUser({id:user});
      await send(invoice,undefined,404,other);await send(invoice,{recipientEmail:'sponsor@example.invalid'},422);await send(invoice,{recipientEmail:'a@example.invalid,b@example.invalid',confirmed:true},422);
      assert.equal((await mail(request('invoice-email',tenant,`/invoices/${invoice}/send`,{recipientEmail:'sponsor@example.invalid',confirmed:true},'https://evil.invalid'),ctx)).status,403);
      await send(invoice,undefined,403,tenant,{deploy:{context:'deploy-preview'}} as never);
      delete env.RESEND_API_KEY;await send(invoice,undefined,422);env.RESEND_API_KEY='fake-key';
      await send(await make(false),undefined,409);assert.equal(calls,0);
    });
    await t.test('one recipient, frozen PDF, club identity and retry-safe acceptance',async()=>{
      const result=(await send(invoice)).dispatch;assert.equal(result.status,'accepted');assert.equal(result.payload,undefined);
      const body=JSON.parse([...requests.values()][0]);assert.deepEqual(body.to,['sponsor@example.invalid']);assert.equal(body.cc,undefined);assert.equal(body.bcc,undefined);
      assert.equal(body.reply_to,'club@example.invalid');assert.match(body.html,/Sponsor &amp; &lt;script&gt;/);assert.doesNotMatch(body.html,/<script>/);assert.match(body.text,/Infrastruktur/);
      const pdf=(await db.query<{sha256:string}>('SELECT sha256 FROM billing_invoice_documents WHERE invoice_id=$1',[invoice])).rows[0];
      assert.equal(createHash('sha256').update(Buffer.from(body.attachments[0].content,'base64')).digest('hex'),pdf.sha256);
      assert.equal((await send(invoice)).dispatch.id,result.id);assert.equal(calls,1);assert.equal(deliveries,1);
      await send(invoice,{recipientEmail:'different@example.invalid',confirmed:true},409);
      const view=await bill('');assert.equal(view.emailDispatches[0].status,'accepted');assert.equal(view.emailDispatches[0].payload,undefined);assert.equal(view.invoices.find((row:{id:string})=>row.id===invoice).recipient_email,'sponsor@example.invalid');
      assert.equal((await session('owner',other,c=>c.query('SELECT id FROM billing_email_dispatches'))).rows.length,0);
    });
    await t.test('lost responses replay the same frozen request and expired uncertainty blocks a second email',async()=>{
      const next=await make();lose=true;await send(next,undefined,502);assert.equal(deliveries,2);
      env.MAIL_FROM='Changed <changed@example.invalid>';lose=false;
      assert.equal((await send(next)).dispatch.status,'accepted');assert.equal(deliveries,2);
      const expired=await make();lose=true;await send(expired,undefined,502);const before=calls;
      await db.query("UPDATE billing_email_dispatches SET first_attempt_at=now()-interval '24 hours' WHERE invoice_id=$1",[expired]);
      assert.equal((await send(expired,undefined,409)).error,'invoice_email_manual_review');assert.equal(calls,before);
    });
    await t.test('invoices with receipts cannot be newly emailed',async()=>{
      lose=false;const next=await make();await bill(`/invoices/${next}/receipts`,{amountCents:100,receivedOn:'2026-10-01',bankReference:'EMAIL-PAID',idempotencyKey:randomUUID(),bankEvidenceConfirmed:true});
      const before=calls;await send(next,undefined,409);assert.equal(calls,before);
    });
  }finally{globalThis.fetch=originalFetch;await db.close();}
});
