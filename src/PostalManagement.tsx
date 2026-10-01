import { useEffect,useRef,useState } from "react";
import { formatBillingChf as chf } from "../shared/billing";
import { runDeliveryBatch,type DeliveryResult } from "../shared/delivery-batch";
import { FinanceDialog } from "./FinanceDialog";

export type PostalRow={id:string;invoice_id:string;status:string;environment:string;provider_status:string|null;provider_address:string|null;
  quoted_cents:number|null;quote_token:string|null;quoted_at:string|null;approved_cents:number|null;send_started_at:string|null;create_started_at:string|null;cost_confirmed:boolean;last_error:string|null};
export type PostalCost={id:string;invoice_id:string;dispatch_id:string;amount_cents:number;booked_on:string;provider_letter_id:string;remaining_cents:string};
export type EmailDispatch={id:string;invoice_id:string;recipient_email:string;status:string;accepted_at:string|null;last_error:string|null};
type Invoice={id:string;status:string;invoice_number:string|null;recipient:{name:string};recipient_email:string;sourceAvailable:boolean;received_cents:string;contribution_cents:number;platform_fee_cents:number};
type Kind="prepare"|"sync"|"post"|"email";
const labels:Record<string,string>={preparing:"Wird vorbereitet",validating:"Pingen prüft das PDF",ready:"Bereit zur Versandfreigabe",sending:"Versand wird übermittelt",submitted:"Versandauftrag angenommen",sent:"An die Post übergeben",delivered:"Zustellung bestätigt",undeliverable:"Unzustellbar",cancelled:"Bei Pingen storniert",needs_review:"Status prüfen"};
const errors:Record<string,string>={
  pingen_not_configured:"Der zentrale Pingen-API-Zugang fehlt noch.",pingen_postal_disabled:"Der kostenpflichtige Postversand ist noch nicht freigegeben. Die Vorbereitung ist möglich.",pingen_production_only:"Echter Postversand ist nur auf der produktiven Website möglich.",
  pingen_quote_expired:"Bitte den Preis und Status aktualisieren und erneut prüfen.",pingen_quote_changed:"Der Pingen-Preis hat sich geändert. Bitte die neuen Kosten prüfen und erneut freigeben.",
  pingen_provider_review:"Pingen benötigt eine Prüfung. Bitte den Status aktualisieren und das Dokument im Pingen-Konto prüfen.",pingen_document_mismatch:"Pingen hat abweichende Dokument- oder Adressangaben erkannt. Es wurde nichts versendet.",
  pingen_paper_not_ready:"Pingen hat das QR-Papier noch nicht bestätigt. Bitte den Status erneut aktualisieren.",pingen_recovery_required:"Der Upload ist noch nicht eindeutig zugeordnet. Bitte im Pingen-Konto prüfen; keinen zweiten Brief versenden.",
  pingen_prepare_again:"Der Upload wurde nicht abgeschlossen. Bitte erneut vorbereiten.",pingen_processing:"Die Übermittlung läuft noch. Bitte nach kurzer Zeit den Status aktualisieren.",
  pingen_invoice_received:"Zu dieser Rechnung liegt bereits eine Zahlung vor. Ein weiterer Rechnungsversand ist gesperrt.",pingen_address_invalid:"Für den Postversand wird eine vollständige Schweizer Postadresse benötigt.",
  pingen_account_changed:"Dieser Auftrag gehört zu einer anderen Pingen-Konfiguration. Bitte die Plattformverantwortung kontaktieren.",billing_source_unavailable:"Die Abrechnungsgrundlage wurde geändert oder storniert. Bitte zuerst die Rechnung prüfen.",
  invoice_email_not_configured:"Der E-Mail-Versand ist noch nicht eingerichtet.",invoice_email_production_only:"Rechnungs-E-Mails können nur auf der produktiven Website versendet werden.",invoice_email_invalid:"Bitte eine gültige E-Mail-Adresse eingeben.",
  invoice_email_confirmation_required:"Bitte E-Mail-Adresse und Versandfreigabe prüfen.",invoice_email_not_issued:"Bitte zuerst die QR-Rechnung freigeben.",invoice_email_received:"Zu dieser Rechnung liegt bereits eine Zahlung vor.",
  invoice_email_recipient_locked:"Ein Versand an eine andere Adresse wurde bereits begonnen. Bitte zuerst diesen Versand prüfen.",invoice_email_processing:"Die E-Mail wird bereits übermittelt. Bitte den Versandstatus nach kurzer Wartezeit neu laden.",
  invoice_email_manual_review:"Der Versand ist ungeklärt und muss beim Mailanbieter geprüft werden. Es wird keine zweite E-Mail automatisch ausgelöst.",invoice_email_rate_limited:"Der Mailanbieter begrenzt gerade die Versandrate. Bitte später erneut auswählen; bereits übergebene Mails werden übersprungen.",
  invoice_email_uncertain:"Keine eindeutige Versandbestätigung. Ein erneuter Versuch verwendet denselben Versandauftrag, um Dubletten zu vermeiden.",invoice_email_provider_error:"Der Mailanbieter hat den Versand nicht bestätigt. Bitte die Konfiguration prüfen und später erneut versuchen.",permission_denied:"Die Berechtigung für den Rechnungsversand fehlt.",
};
const emailValid=(email:string)=>email.length<=254&&/^[^\s@<>,;]+@[a-z\d.-]+\.[a-z]{2,}$/i.test(email);

export function PostalManagement({tenantId,accountId,canWrite,enabled,configured,emailConfigured,environment,invoices,dispatches,emailDispatches,costs,onChanged}:{tenantId:string;accountId:string;canWrite:boolean;enabled:boolean;configured:boolean;emailConfigured:boolean;environment:string;invoices:Invoice[];dispatches:PostalRow[];emailDispatches:EmailDispatch[];costs:PostalCost[];onChanged:()=>Promise<void>}) {
  const [selected,setSelected]=useState<string[]>([]),[filter,setFilter]=useState("");
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(""),[results,setResults]=useState<DeliveryResult[]>([]),[error,setError]=useState("");
  const [dialog,setDialog]=useState<"email"|"post"|null>(null),[accepted,setAccepted]=useState(false),[recipients,setRecipients]=useState<Record<string,string>>({});
  const stop=useRef(false),mounted=useRef(true),generation=useRef(0);
  useEffect(()=>{mounted.current=true;stop.current=false;generation.current++;setSelected([]);setDialog(null);setBusy(false);setResults([]);setProgress("");return()=>{mounted.current=false;stop.current=true;generation.current++;};},[tenantId,accountId]);
  const all=invoices.filter(row=>row.status==='issued'||row.status==='cancelled'&&Boolean(row.invoice_number));
  const candidates=all.filter(row=>row.status==='issued'&&row.sourceAvailable&&Number(row.received_cents)===0);
  const visible=all.filter(row=>`${row.invoice_number} ${row.recipient.name}`.toLocaleLowerCase('de-CH').includes(filter.toLocaleLowerCase('de-CH')));
  const visibleEligible=visible.filter(row=>candidates.some(candidate=>candidate.id===row.id));
  const chosen=candidates.filter(row=>selected.includes(row.id));
  const postalFor=(id:string)=>dispatches.find(row=>row.invoice_id===id&&row.environment===environment);
  const emailFor=(id:string)=>emailDispatches.find(row=>row.invoice_id===id);
  const mailPending=chosen.filter(row=>emailFor(row.id)?.status!=='accepted');
  const postalReady=chosen.every(row=>{const job=postalFor(row.id);return job?.status==='ready'&&!job.send_started_at&&job.quoted_cents!==null&&Boolean(job.quote_token);});
  const postalTotal=chosen.reduce((sum,row)=>sum+(postalFor(row.id)?.quoted_cents??0),0);
  const api=async<T,>(kind:"postal"|"invoice-email",path:string,body:object={}):Promise<T>=>{
    const response=await fetch(`/api/${kind}/${tenantId}/${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-Sponsor-Account':accountId},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw new Error(errors[result.error]??"Die Aktion konnte nicht bestätigt werden. Bitte den Versandstatus prüfen.");return result as T;
  };
  const open=(kind:"email"|"post")=>{setError("");setResults([]);setProgress("");setAccepted(false);setDialog(kind);setRecipients(Object.fromEntries(chosen.map(row=>[row.id,emailFor(row.id)?.recipient_email??row.recipient_email??""])));};
  const run=async(kind:Kind,items=chosen)=>{
    if(busy||!items.length)return;
    setBusy(true);setError("");setResults([]);stop.current=false;
    const currentGeneration=generation.current;
    const active=()=>mounted.current&&currentGeneration===generation.current;
    let completed=0;
    await runDeliveryBatch(items,async invoice=>{
      if(active())setProgress(`${completed+1} von ${items.length}: ${invoice.invoice_number}`);
      if(kind==='email'){
        if(emailFor(invoice.id)?.status==='accepted')return 'Bereits an den Mailanbieter übergeben – übersprungen.';
        try{await api('invoice-email',`invoices/${invoice.id}/send`,{recipientEmail:recipients[invoice.id]?.trim(),confirmed:accepted});}
        finally{await new Promise(resolve=>setTimeout(resolve,650));}
        return 'QR-Rechnung an den Mailanbieter übergeben.';
      }
      let job=postalFor(invoice.id);
      if(kind==='prepare'){
        job=(await api<{dispatch:PostalRow}>('postal',`invoices/${invoice.id}/prepare`)).dispatch;
        if(job.status==='validating')job=(await api<{dispatch:PostalRow}>('postal',`dispatches/${job.id}/sync`)).dispatch;
      }else if(kind==='sync'){
        if(!job)throw new Error('Bitte die Rechnung zuerst bei Pingen vorbereiten.');
        job=(await api<{dispatch:PostalRow}>('postal',`dispatches/${job.id}/sync`)).dispatch;
      }else{
        if(!job)throw new Error('Bitte die Rechnung zuerst bei Pingen vorbereiten.');
        job=(await api<{dispatch:PostalRow}>('postal',`dispatches/${job.id}/send`,{quoteToken:job.quote_token,quotedCents:job.quoted_cents,costsAccepted:accepted})).dispatch;
      }
      if(job.last_error)throw new Error(errors[job.last_error]??'Pingen benötigt eine Prüfung. Bitte den Status aktualisieren.');
      return job.status==='ready'?`Bei Pingen vorbereitet. Versandpreis: ${chf(job.quoted_cents??0)}. Noch nicht versendet.`:labels[job.status]??'Pingen-Status aktualisiert.';
    },result=>{completed++;if(active())setResults(current=>[...current,result]);},()=>stop.current||!active());
    if(!active())return;
    try{await onChanged();}catch{setError('Versand bearbeitet, aber die Übersicht konnte nicht neu geladen werden. Bitte die Seite neu laden; bereits bestätigte Sendungen nicht erneut anlegen.');}
    if(active()){setProgress(`${completed} von ${items.length} Rechnungen bearbeitet${stop.current?' · angehalten':''}.`);setBusy(false);setAccepted(false);}
  };
  const feedback=<>{error&&<p className="form-error" role="alert">{error}</p>}{progress&&<p role="status" aria-live="polite">{progress}</p>}{results.length>0&&<ul className="delivery-results">{results.map(result=><li key={result.id} className={result.ok?'finance-success':'form-error'}><strong>{invoices.find(row=>row.id===result.id)?.invoice_number}</strong>: {result.message}</li>)}</ul>}{busy&&<button type="button" className="access-secondary" onClick={()=>{stop.current=true;setProgress('Wird nach dem laufenden Vorgang angehalten …');}}>Nach diesem Vorgang stoppen</button>}</>;
  return <section className="workspace-panel invoice-delivery"><h2>Rechnungen versenden</h2><p>Eine oder mehrere freigegebene, unbezahlte Rechnungen auswählen. Jede E-Mail enthält die zugehörige QR-Rechnung als PDF; Empfänger sehen keine anderen Sponsorenadressen.</p>
    <p>Die Plattform bezahlt Pingen zentral. Tatsächliche Postkosten werden dem Verein bei der monatlichen Auszahlung abgezogen.</p>
    {!emailConfigured&&<p className="finance-warning">E-Mail-Versand ist noch nicht eingerichtet.</p>}{!configured&&<p className="finance-warning">Der Pingen-API-Zugang fehlt noch.</p>}{configured&&!enabled&&<p className="finance-warning">Pingen-Vorbereitung ist möglich. Der kostenpflichtige Postversand ist noch nicht freigeschaltet.</p>}{environment==='staging'&&<p className="finance-warning">Pingen-Testumgebung: Es werden keine echten Briefe verschickt.</p>}
    <label className="delivery-search">Rechnungen filtern<input type="search" value={filter} disabled={busy} onChange={event=>setFilter(event.target.value)} placeholder="Sponsor oder Rechnungsnummer"/></label>
    {canWrite&&<div className="delivery-actions"><strong>{chosen.length} ausgewählt</strong><button className="access-primary" disabled={busy||!chosen.length||!emailConfigured} onClick={()=>open('email')}>Per E-Mail senden</button><button className="access-secondary" disabled={busy||!chosen.length||!configured} onClick={()=>void run('prepare')}>{busy&&!dialog?'Wird bearbeitet …':'Bei Pingen vorbereiten'}</button><button className="access-secondary" disabled={busy||!chosen.length||!configured} onClick={()=>void run('sync')}>Pingen-Status aktualisieren</button><button className="access-secondary" disabled={busy||!chosen.length||!enabled} onClick={()=>open('post')}>Pingen-Versand prüfen</button></div>}
    {!dialog&&feedback}
    <div className="finance-table-wrap"><table className="finance-table"><thead><tr>{canWrite&&<th><input type="checkbox" aria-label="Alle sichtbaren versandfähigen Rechnungen auswählen" disabled={busy||!visibleEligible.length} checked={visibleEligible.length>0&&visibleEligible.every(row=>selected.includes(row.id))} onChange={event=>setSelected(current=>event.target.checked?[...new Set([...current,...visibleEligible.map(row=>row.id)])]:current.filter(id=>!visibleEligible.some(row=>row.id===id)))}/></th>}<th>Rechnung / Sponsor</th><th>E-Mail</th><th>Pingen</th><th>Postkosten / Aktion</th></tr></thead><tbody>{visible.map(invoice=>{const post=postalFor(invoice.id),mail=emailFor(invoice.id),eligible=candidates.some(row=>row.id===invoice.id);const booked=costs.filter(cost=>cost.dispatch_id===post?.id).reduce((sum,cost)=>sum+cost.amount_cents,0);return <tr key={invoice.id}>{canWrite&&<td><input type="checkbox" aria-label={`${invoice.invoice_number} auswählen`} disabled={busy||!eligible} checked={selected.includes(invoice.id)&&eligible} onChange={event=>setSelected(current=>event.target.checked?[...current,invoice.id]:current.filter(id=>id!==invoice.id))}/></td>}<td><strong>{invoice.invoice_number}</strong><small>{invoice.recipient.name}</small><small>{chf(invoice.contribution_cents+invoice.platform_fee_cents)}</small>{!eligible&&<small>{invoice.status==='cancelled'?'Storniert – kein weiterer Versand':'Zahlung vorhanden oder Abrechnungsgrundlage prüfen'}</small>}<a href={`/api/finance/${tenantId}/invoices/${invoice.id}/pdf?account=${encodeURIComponent(accountId)}`} target="_blank" rel="noreferrer">{invoice.status==='cancelled'?'Originalbeleg (storniert)':'QR-PDF öffnen'}</a></td><td>{mail?.recipient_email||invoice.recipient_email||'Adresse bei Versand ergänzen'}<small>{mail?.status==='accepted'?'An Mailanbieter übergeben':mail?.status==='sending'?'Wird übermittelt':mail?'Versand prüfen':'Noch nicht versendet'}</small>{mail?.last_error&&<small className="form-error">{errors[mail.last_error]??mail.last_error}</small>}</td><td>{post?labels[post.status]??'Status prüfen':'Noch nicht vorbereitet'}{post?.provider_status&&<small>Pingen: {post.provider_status}</small>}{post?.last_error&&<small className="form-error">{errors[post.last_error]??post.last_error}</small>}</td><td>{post?.environment==='production'&&post.cost_confirmed?<>{chf(booked)}<small>Bestätigte Kosten</small></>:post?.quoted_cents!=null?<>{chf(post.quoted_cents)}<small>Kostenvorschau</small></>:'—'}{post&&canWrite&&<button className="access-secondary" disabled={busy} onClick={()=>void run('sync',[invoice])}>Status aktualisieren</button>}</td></tr>;})}</tbody></table>{!visible.length&&<p>Noch keine passenden freigegebenen Rechnungen. Bitte zuerst eine QR-Rechnung freigeben.</p>}</div>
    {dialog&&<FinanceDialog title={dialog==='email'?'Rechnungen per E-Mail versenden':'Pingen-Versand freigeben'} busy={busy} onClose={()=>setDialog(null)}>{feedback}<form onSubmit={event=>{event.preventDefault();void run(dialog==='email'?'email':'post');}}>
      {dialog==='email'?<><p>{mailPending.length} neue E-Mails mit je einer QR-Rechnung im Anhang. Bitte jede Empfängeradresse prüfen.</p>{chosen.map(invoice=><label key={invoice.id}><strong>{invoice.invoice_number} · {invoice.recipient.name}</strong>{emailFor(invoice.id)?.status==='accepted'?<p>Bereits übergeben – wird übersprungen.</p>:<input type="email" required value={recipients[invoice.id]??''} disabled={busy||Boolean(emailFor(invoice.id))} onChange={event=>{setRecipients(current=>({...current,[invoice.id]:event.target.value}));setAccepted(false);}}/>}{postalFor(invoice.id)?.send_started_at&&<small className="finance-warning">Diese Rechnung wurde bereits für den Postversand freigegeben.</small>}</label>)}</>:<><p>{chosen.length} Briefe · Gesamtkosten laut Pingen: <strong>{chf(postalTotal)}</strong></p>{chosen.map(invoice=>{const job=postalFor(invoice.id);return <article key={invoice.id}><strong>{invoice.invoice_number} · {invoice.recipient.name}</strong><pre className="postal-address">{job?.provider_address??'Empfänger noch nicht von Pingen bestätigt'}</pre><p>{job?.quoted_cents!=null?chf(job.quoted_cents):'Preis noch offen'} · {job?labels[job.status]:'Noch nicht vorbereitet'}</p>{emailFor(invoice.id)?.status==='accepted'&&<small className="finance-warning">Diese Rechnung wurde bereits per E-Mail übergeben.</small>}</article>;})}{!postalReady&&<p className="form-error">Bitte zuerst alle ausgewählten Rechnungen vorbereiten und den Pingen-Status aktualisieren.</p>}</>}
      <label className="finance-checkbox"><input required type="checkbox" checked={accepted} disabled={busy} onChange={event=>setAccepted(event.target.checked)}/><span>{dialog==='email'?'Ich habe Empfänger und Rechnungen geprüft und gebe diese E-Mails frei.':'Ich habe PDFs, Empfänger und die angezeigten Kosten geprüft und gebe den Postversand zulasten des Vereins frei.'}</span></label><div><button className="access-primary" disabled={busy||!accepted||(dialog==='email'?mailPending.length===0||mailPending.some(row=>!emailValid((recipients[row.id]??'').trim())):!postalReady)}>{busy?'Versand läuft …':dialog==='email'?'E-Mails jetzt versenden':environment==='staging'?'Testversand auslösen':'Kostenpflichtig versenden'}</button><button type="button" className="access-secondary" disabled={busy} onClick={()=>setDialog(null)}>Schliessen</button></div>
    </form></FinanceDialog>}
  </section>;
}
