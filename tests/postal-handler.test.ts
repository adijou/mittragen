import assert from 'node:assert/strict';
import { createHmac,randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { DatabaseClient } from '../netlify/functions/_shared/database.ts';

const hooks=registerHooks({load(url,context,nextLoad){
  if(url.includes('/node_modules/@netlify/identity/'))return{shortCircuit:true,format:'module',source:`export class AuthError extends Error {};let user;export const setTestUser=value=>user=value;export const getUser=async()=>user;export const refreshSession=async()=>{};export const verifyRequestOrigin=request=>{if(request.headers.get('origin')!==new URL(request.url).origin)throw new Error('origin')};`};
  if(url.endsWith('/netlify/functions/_shared/database.ts'))return{shortCircuit:true,format:'module',source:`let session;export const setTestSession=value=>session=value;export const withSession=(...args)=>session(...args);export const isUuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);`};
  return nextLoad(url,context);
}});
const {default:postal}=await import('../netlify/functions/postal.mts');
const {default:finance}=await import('../netlify/functions/finance.mts');
const {default:webhook}=await import('../netlify/functions/pingen-webhook.mts');
const {preparePayout,discardPayout,settlePayout,recordPayout,recordReceipt}=await import('../netlify/functions/_shared/billing-ledger.ts');
const {allocatePostalCosts}=await import('../netlify/functions/_shared/postal-costs.ts');
const {pingenCents,validPingenSignature}=await import('../netlify/functions/_shared/pingen-client.ts');
const {setTestSession}=await import('../netlify/functions/_shared/database.ts') as never as {setTestSession:(fn:unknown)=>void};
const {setTestUser}=await import('@netlify/identity') as never as {setTestUser:(user:unknown)=>void};
hooks.deregister();

test('postal money uses integer cents, carries uncovered charges, and credits refunds',()=>{
  assert.equal(pingenCents(1.48),148);assert.throws(()=>pingenCents(1.481));assert.throws(()=>pingenCents(NaN));
  assert.deepEqual(allocatePostalCosts(100,[{id:'charge',remaining_cents:'150'}]),{items:[{id:'charge',amountCents:100}],netCents:0,postalCents:100});
  assert.deepEqual(allocatePostalCosts(0,[{id:'charge',remaining_cents:'20'},{id:'refund',remaining_cents:'-50'}]),{items:[{id:'refund',amountCents:-50},{id:'charge',amountCents:20}],netCents:30,postalCents:-30});
  assert.equal(validPingenSignature('{}',createHmac('sha256','secret').update('{}').digest('hex'),'secret'),true);
  assert.equal(validPingenSignature('{ }',createHmac('sha256','secret').update('{}').digest('hex'),'secret'),false);
});

test('postal workflow binds immutable invoices, confirms real costs, and deducts each cent once',async(t)=>{
  const db=new PGlite({extensions:{pgcrypto}});await db.waitReady;const originalFetch=globalThis.fetch;
  try{
    const migrations=new URL('../netlify/database/migrations/',import.meta.url);
    for(const dir of (await readdir(migrations)).sort())await db.exec(await readFile(new URL(`${dir}/migration.sql`,migrations),'utf8'));
    await db.exec('CREATE ROLE postal_test NOLOGIN; GRANT USAGE ON SCHEMA public TO postal_test; GRANT ALL ON ALL TABLES IN SCHEMA public TO postal_test; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postal_test;');
    const session=async<T>(id:string,tenant:string|null,fn:(client:DatabaseClient)=>Promise<T>,email?:string)=>db.transaction(async tx=>{
      await tx.exec('SET LOCAL ROLE postal_test');await tx.query("SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true),set_config('app.user_email',$3,true)",[id,tenant??'',email??'']);
      return fn({query:async<Row>(sql:string,args?:unknown[])=>{const result=await tx.query<Row>(sql,args);return{rows:result.rows,rowCount:result.affectedRows??result.rows.length};},release(){}});
    });setTestSession(session);
    const tenant=randomUUID(),other=randomUUID(),event=randomUUID();
    const env:Record<string,string>={BILLING_OPERATOR_USER_IDS:'operator',BILLING_QR_CREDITOR:JSON.stringify({iban:'CH4431999123000889012',name:'Test Inkasso',street:'',houseNumber:'',postalCode:'8000',city:'Zürich',country:'CH'}),PINGEN_CLIENT_ID:'client',PINGEN_CLIENT_SECRET:'test-secret',PINGEN_ORGANISATION_ID:'test-org',PINGEN_ENVIRONMENT:'production',PINGEN_POSTAL_ENABLED:'true',PINGEN_WEBHOOK_SECRET:'test-hook-secret'};
    Object.assign(globalThis,{Netlify:{env:{get:(name:string)=>env[name]}}});
    await db.query("INSERT INTO tenants(id,slug,name) VALUES($1,'postal-one','Verein Eins'),($2,'postal-two','Verein Zwei')",[tenant,other]);
    await db.query("INSERT INTO tenant_memberships(tenant_id,identity_user_id,role) VALUES($1,'operator','owner'),($1,'reader','viewer'),($2,'operator','owner')",[tenant,other]);
    await db.query("INSERT INTO sponsorship_events(id,tenant_id,team_name,opponent,starts_at,price_cents,status,created_by) VALUES($1,$2,'FC Beispiel','FC Gast','2026-10-01',100000,'published','fixture')",[event,tenant]);
    let user='operator';setTestUser({id:user});
    const ctx={requestId:'postal-test',deploy:{context:'production'}} as never;
    const request=(kind:string,tenantId:string,path:string,body:object,origin='https://test.invalid')=>new Request(`https://test.invalid/api/${kind}/${tenantId}${path}`,{method:'POST',headers:{Origin:origin,'X-Sponsor-Account':user},body:JSON.stringify(body)});
    const post=async(path:string,body:object={},expected=200,tenantId=tenant,context=ctx)=>{const result=await postal(request('postal',tenantId,path,body),context);const value=await result.json();assert.equal(result.status,expected,JSON.stringify(value));return value;};
    const bill=async(path:string,body:object={},expected=200)=>{const result=await finance(request('finance',tenant,path,body),ctx);const value=await result.json();assert.equal(result.status,expected,JSON.stringify(value));return value;};
    const makeInvoice=async(amount=100000)=>{
      const booking=randomUUID();await db.query(`INSERT INTO event_sponsorship_bookings(id,tenant_id,event_id,reference,sponsor_name,address,postal_code,city,contact_name,contact_email,payment_mode,amount_cents,fee_basis_points)
        VALUES($1,$2,$3,$4,'Muster Sponsor AG','Hauptstrasse 1','3186','Düdingen','Max Muster','test@example.invalid','invoice',$5,250)`,[booking,tenant,event,`MB-2026-${randomUUID().slice(0,8).toUpperCase()}`,amount]);
      const invoice=(await bill('/invoices',{sourceKey:`event:${booking}`},201)).invoice;
      await bill(`/invoices/${invoice.id}/issue`,{detailsConfirmed:true});return invoice.id as string;
    };
    type Remote={id:string;type:string;attributes:Record<string,unknown>};
    const remotes=new Map<string,Remote>();let quote=1.50,actualCost=1.60,sendCount=0,createCount=0,uploadCount=0,loseSend=false,loseCreate=false,wrongAddress=false,unsafeUpload=false;
    let uploadedPages=0;
    let time=Date.now();const tick=()=>new Date(time+=1000).toISOString();
    const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/vnd.api+json'}});
    globalThis.fetch=(async(url,init)=>{
      const target=String(url),method=init?.method??'GET',headers=new Headers(init?.headers);
      if(target.endsWith('/auth/access-tokens'))return response({access_token:'fake-token'});
      if(target.endsWith('/file-upload'))return response({data:{attributes:{url:unsafeUpload?'https://127.0.0.1/private':'https://objects.cloudscale.ch/test/file?signature=test',url_signature:'fake-signature'}}});
      if(target.startsWith('https://objects.cloudscale.ch/')){assert.equal(headers.has('Authorization'),false);assert.equal(method,'PUT');uploadedPages=(await PDFDocument.load(new Uint8Array(init!.body as ArrayBuffer))).getPageCount();assert.equal(uploadedPages,1);uploadCount++;return response({});}
      assert.equal(headers.get('Authorization'),'Bearer fake-token');
      const body=init?.body?JSON.parse(String(init.body)):null;
      if(target.endsWith('/price-calculator')){assert.deepEqual(body.data.attributes.paper_types,['qr']);return response({data:{attributes:{currency:'CHF',price:quote}}});}
      if(target.includes('?filter=')){const name=JSON.parse(new URL(target).searchParams.get('filter')!).file_original_name;return response({data:[...remotes.values()].filter(row=>row.attributes.file_original_name===name)});}
      if(target.endsWith('/letters')&&method==='POST'){
        assert.equal(body.data.attributes.auto_send,false);assert.equal(body.data.attributes.address_position,'right');assert.ok(headers.get('Idempotency-Key'));
        const id=randomUUID();const remote={id,type:'letters',attributes:{status:'valid',file_original_name:body.data.attributes.file_original_name,file_pages:uploadedPages,paper_types:Array(uploadedPages).fill('normal'),country:'CH',address_position:'right',address:'Muster Sponsor AG\nHauptstrasse 1\n3186 Düdingen',submitted_at:null,updated_at:tick()}};
        remotes.set(id,remote);createCount++;if(loseCreate)throw new Error('response lost after creation');return response({data:remote},201);
      }
      const match=target.match(/\/letters\/([\da-f-]+)(?:\/(send|cost-details))?$/);assert.ok(match,`Unexpected network request: ${target}`);
      const row=remotes.get(match[1])!;assert.ok(row);
      if(match[2]==='cost-details')return response({data:{attributes:{currency:'CHF',total_cost:actualCost}}});
      if(match[2]==='send'){
        sendCount++;assert.equal(method,'PATCH');assert.ok(headers.get('Idempotency-Key'));assert.equal(body.data.attributes.print_mode,'simplex');
        row.attributes.status='sent';row.attributes.submitted_at=tick();row.attributes.updated_at=tick();if(loseSend)throw new Error('response lost after send');return response({data:row});
      }
      if(method==='PATCH'){assert.deepEqual(body.data.attributes.paper_types,['qr']);row.attributes.paper_types=body.data.attributes.paper_types;row.attributes.updated_at=tick();}
      return response({data:wrongAddress?{...row,attributes:{...row.attributes,country:'DE'}}:row});
    }) as typeof fetch;
    let invoice='',id='',letterId='',ready:any;
    await t.test('roles, origin and deployment protect invoice uploads',async()=>{
      invoice=await makeInvoice();
      user='reader';setTestUser({id:user});await post(`/invoices/${invoice}/prepare`,{},403);user='operator';setTestUser({id:user});
      assert.equal((await postal(request('postal',tenant,`/invoices/${invoice}/prepare`,{},'https://evil.invalid'),ctx)).status,403);
      await post(`/invoices/${invoice}/prepare`,{},404,other);
      await post(`/invoices/${invoice}/prepare`,{},403,tenant,{requestId:'preview',deploy:{context:'deploy-preview'}} as never);
      assert.equal(uploadCount,0);assert.equal(sendCount,0);
    });
    await t.test('preparation works before sending is enabled; one immutable PDF and reviewed price are retained',async()=>{
      env.PINGEN_POSTAL_ENABLED='false';
      const a=(await post(`/invoices/${invoice}/prepare`)).dispatch;id=a.id;letterId=a.provider_letter_id;
      assert.equal((await post(`/invoices/${invoice}/prepare`)).dispatch.id,id);assert.equal(createCount,1);assert.equal(uploadCount,1);assert.equal(sendCount,0);
      ready=(await post(`/dispatches/${id}/sync`)).dispatch;assert.equal(ready.status,'ready');assert.equal(ready.page_count,1);assert.deepEqual(ready.paper_types,['qr']);assert.equal(ready.quoted_cents,150);
      assert.match(ready.provider_address,/Düdingen/);assert.equal((await db.query('SELECT id FROM billing_postal_costs')).rows.length,0);
      await post(`/dispatches/${id}/send`,{quoteToken:ready.quote_token,quotedCents:ready.quoted_cents,costsAccepted:true},422);
      assert.equal(sendCount,0);env.PINGEN_POSTAL_ENABLED='true';
      await post(`/dispatches/${id}/send`,{quoteToken:ready.quote_token,quotedCents:1,costsAccepted:true},409);
      wrongAddress=true;await post(`/dispatches/${id}/send`,{quoteToken:ready.quote_token,quotedCents:150,costsAccepted:true},409);wrongAddress=false;assert.equal(sendCount,0);
      quote=1.60;await post(`/dispatches/${id}/send`,{quoteToken:ready.quote_token,quotedCents:150,costsAccepted:true},409);assert.equal(sendCount,0);
      ready=(await post(`/dispatches/${id}/sync`)).dispatch;
    });
    await t.test('an uncertain send cannot create a second letter or an estimated cost charge',async()=>{
      loseSend=true;
      const input={quoteToken:ready.quote_token,quotedCents:160,costsAccepted:true};
      const result=(await post(`/dispatches/${id}/send`,input)).dispatch;assert.equal(result.status,'needs_review');
      await post(`/dispatches/${id}/send`,input);assert.equal(sendCount,1);assert.equal(createCount,1);
      assert.equal((await db.query('SELECT id FROM billing_postal_costs')).rows.length,0);
      await assert.rejects(session('operator',tenant,client=>preparePayout(client,tenant,'operator','2099-01')),/billing_postal_costs_pending/);
      await post(`/dispatches/${id}/sync`,{},404,other);
    });
    await t.test('signed webhooks reconcile authoritative actual costs once; tampering is rejected',async()=>{
      await db.query('UPDATE billing_postal_dispatches SET refresh_token=$2,refresh_started_at=now() WHERE id=$1',[id,randomUUID()]);
      await post(`/dispatches/${id}/sync`,{},409);
      await db.query('UPDATE billing_postal_dispatches SET refresh_token=NULL,refresh_started_at=NULL WHERE id=$1',[id]);
      const payload={data:{id:randomUUID(),type:'webhook_sent',relationships:{organisation:{data:{id:'test-org',type:'organisations'}},deliverable:{data:{id:letterId,type:'letters'}}}}};
      const raw=JSON.stringify(payload),signature=createHmac('sha256',env.PINGEN_WEBHOOK_SECRET).update(raw).digest('hex');
      const hook=(text:string=raw,sig:string=signature)=>webhook(new Request('https://test.invalid/api/pingen/webhook',{method:'POST',headers:{signature:sig},body:text}));
      assert.equal((await hook(raw+' ')).status,401);assert.equal((await hook(raw,'bad')).status,401);
      assert.equal((await hook()).status,200);assert.equal((await hook()).status,200);
      let costs=(await db.query<{amount_cents:number}>('SELECT amount_cents FROM billing_postal_costs')).rows;assert.equal(costs.length,1);assert.equal(costs[0].amount_cents,160);
      await post(`/dispatches/${id}/sync`);assert.equal((await db.query('SELECT id FROM billing_postal_costs')).rows.length,1);
      assert.equal((await session('operator',other,client=>client.query('SELECT id FROM billing_postal_costs'))).rows.length,0);
      assert.equal((await session('operator',other,client=>client.query('SELECT id FROM billing_postal_dispatches'))).rows.length,0);
      actualCost=1.40;remotes.get(letterId)!.attributes.updated_at=tick();await post(`/dispatches/${id}/sync`);
      costs=(await db.query<{amount_cents:number}>('SELECT amount_cents FROM billing_postal_costs ORDER BY created_at')).rows;assert.deepEqual(costs.map(row=>row.amount_cents),[160,-20]);
      await assert.rejects(db.exec('DELETE FROM billing_postal_costs'),/immutable/);
    });
    await t.test('monthly settlement reserves exact postage, carries excess, restores discarded allocations',async()=>{
      await session('operator',tenant,client=>recordReceipt(client,tenant,'operator',invoice,{idempotencyKey:randomUUID(),amountCents:103,receivedOn:'2026-09-01',bankReference:'SMALL-PAYMENT'})); // club share 100
      const payout=await session('operator',tenant,client=>preparePayout(client,tenant,'operator','2099-01'));
      assert.equal(await session('operator',tenant,client=>preparePayout(client,tenant,'operator','2099-01')),payout);
      const row=(await db.query<{gross_cents:bigint;postal_cents:bigint;amount_cents:bigint}>('SELECT gross_cents,postal_cents,amount_cents FROM billing_payouts WHERE id=$1',[payout])).rows[0];
      assert.equal(Number(row.gross_cents),100);assert.equal(Number(row.postal_cents),100);assert.equal(Number(row.amount_cents),0);
      await session('operator',tenant,client=>discardPayout(client,tenant,'operator',payout,'Test preparation correction'));
      assert.equal((await db.query('SELECT cost_id FROM billing_payout_postal_items')).rows.length,0);
      const rebuilt=await session('operator',tenant,client=>preparePayout(client,tenant,'operator','2099-01'));
      await session('operator',tenant,client=>settlePayout(client,tenant,'operator',rebuilt));
      const remaining=(await db.query<{amount:string}>(`SELECT ((SELECT sum(amount_cents) FROM billing_postal_costs)-(SELECT sum(amount_cents) FROM billing_payout_postal_items))::text amount`)).rows[0].amount;assert.equal(Number(remaining),40);
      await session('operator',tenant,client=>recordReceipt(client,tenant,'operator',invoice,{idempotencyKey:randomUUID(),amountCents:102397,receivedOn:'2026-09-02',bankReference:'REMAINING-PAYMENT'}));
      const next=await session('operator',tenant,client=>preparePayout(client,tenant,'operator','2099-02'));
      const paid=(await db.query<{gross_cents:string;postal_cents:string;amount_cents:string}>('SELECT gross_cents::text,postal_cents::text,amount_cents::text FROM billing_payouts WHERE id=$1',[next])).rows[0];
      assert.deepEqual(paid,{gross_cents:'99900',postal_cents:'40',amount_cents:'99860'});
      actualCost=1.30;remotes.get(letterId)!.attributes.updated_at=tick();await post(`/dispatches/${id}/sync`);
      await assert.rejects(session('operator',tenant,client=>recordPayout(client,tenant,'operator',next,'2099-03-01','TEST-TRANSFER')),/billing_payout_costs_changed/);
      await session('operator',tenant,client=>discardPayout(client,tenant,'operator',next,'Release fixture reservations'));
    });
    await t.test('unknown creates recover by exact unique filename and staging never charges a club',async()=>{
      const second=await makeInvoice();loseCreate=true;await post(`/invoices/${second}/prepare`,{},502);loseCreate=false;
      const row=(await db.query<{id:string}>("SELECT id FROM billing_postal_dispatches WHERE invoice_id=$1",[second])).rows[0];
      const before=createCount;await post(`/invoices/${second}/prepare`);assert.equal(createCount,before);
      await db.query("UPDATE billing_postal_dispatches SET updated_at=now()-interval '3 minutes' WHERE id=$1",[row.id]);
      assert.equal((await post(`/dispatches/${row.id}/sync`)).dispatch.status,'ready');assert.equal(createCount,before);
      env.PINGEN_ENVIRONMENT='staging';const third=await makeInvoice();loseSend=false;
      const staged=(await post(`/invoices/${third}/prepare`)).dispatch;
      const quoteRow=(await post(`/dispatches/${staged.id}/sync`)).dispatch;
      await post(`/dispatches/${staged.id}/send`,{quoteToken:quoteRow.quote_token,quotedCents:quoteRow.quoted_cents,costsAccepted:true});await post(`/dispatches/${staged.id}/sync`);
      assert.equal((await db.query('SELECT id FROM billing_postal_costs WHERE dispatch_id=$1',[staged.id])).rows.length,0);
      unsafeUpload=true;const fourth=await makeInvoice();await post(`/invoices/${fourth}/prepare`,{},502);
    });
  }finally{globalThis.fetch=originalFetch;await db.close();}
});
