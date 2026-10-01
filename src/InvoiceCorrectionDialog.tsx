import { useState } from "react";
import { formatBillingChf as chf } from "../shared/billing";
import { FinanceDialog } from "./FinanceDialog";

type Source={sourceKey:string;description:string;recipient:{name:string};contributionCents:number;platformFeeCents:number};
type Invoice={id:string;status:string;invoice_number:string|null;reference:string;source_key:string;recipient:{name:string};description:string;contribution_cents:number;platform_fee_cents:number;refreshSources:Source[]};
export type InvoiceCorrectionInput={confirmed:boolean;reason:string;deliveryAcknowledged:boolean;sourceKey?:string};

export function InvoiceCorrectionDialog<T extends Invoice>({invoice,action,deliveryStarted,pdfUrl,canIssue,onSubmit,onReload,onIssue,onClose,errorMessages}:{
  invoice:T;action:"cancel"|"recreate";deliveryStarted:boolean;pdfUrl:(id:string)=>string;canIssue:boolean;
  onSubmit:(input:InvoiceCorrectionInput)=>Promise<T>;onReload:()=>Promise<void>;onIssue:(invoice:T)=>void;onClose:()=>void;errorMessages:Record<string,string>;
}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [result,setResult]=useState<T|null>(null);
  const [reason,setReason]=useState(action==="recreate"?"Rechnung neu erstellen":"");
  const [confirmed,setConfirmed]=useState(false),[deliveryAcknowledged,setDeliveryAcknowledged]=useState(false);
  const [sourceKey,setSourceKey]=useState(()=>invoice.refreshSources.find(source=>source.sourceKey===invoice.source_key)?.sourceKey??(invoice.refreshSources.length===1?invoice.refreshSources[0].sourceKey:""));
  const source=invoice.refreshSources.find(row=>row.sourceKey===sourceKey);
  const title=action==="recreate"?"Rechnung neu erstellen":invoice.invoice_number?"Rechnung stornieren":"Entwurf löschen";
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();setBusy(true);setError("");
    try{
      setResult(await onSubmit({confirmed,reason,deliveryAcknowledged,...(action==="recreate"?{sourceKey}:{})}));
      try{await onReload();}catch{setError("Die Änderung wurde gespeichert. Bitte die Seite neu laden, um die Liste zu aktualisieren.");}
    }catch(reason){setError(errorMessages[(reason as Error).message]??"Die Rechnung konnte nicht korrigiert werden. Bitte erneut prüfen.");}
    finally{setBusy(false);}
  };
  return <FinanceDialog title={title} busy={busy} onClose={onClose}>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {result?<>
      <p className="finance-success" role="status">{action==="recreate"?`Neuer Entwurf ${result.reference} erstellt.`:invoice.invoice_number?"Rechnung storniert. Der Originalbeleg bleibt im Verlauf erhalten.":"Entwurf gelöscht. Die Leistung kann erneut abgerechnet werden."}</p>
      {action==="recreate"&&result.status==="draft"&&<>
        <p>{result.description} · <strong>{chf(result.contribution_cents+result.platform_fee_cents)}</strong></p>
        <p><a href={pdfUrl(result.id)} target="_blank" rel="noreferrer">Neue PDF-Vorschau öffnen</a></p>
        <p>Bitte den neuen Entwurf prüfen und die QR-Rechnung freigeben. Der Versand erfolgt anschliessend separat.</p>
        <button type="button" className="access-primary" disabled={busy||!canIssue} onClick={()=>onIssue(result)}>Zur QR-Freigabe</button>
      </>}
      {action==="recreate"&&result.status!=="draft"&&<p>Die Ersatzrechnung wurde inzwischen weiterbearbeitet. Bitte den aktuellen Status in der Liste prüfen.</p>}
      <button type="button" className="access-secondary" disabled={busy} onClick={onClose}>Schliessen</button>
    </>:<form onSubmit={submit}>
      <p><strong>{invoice.invoice_number??invoice.reference}</strong> · {invoice.recipient.name}</p>
      <p>{action==="recreate"?"Der bisherige Beleg wird aufgehoben. Aus der aktuellen bestätigten Abrechnungsgrundlage entsteht ein neuer Entwurf. Bei der Freigabe erhält er eine neue Rechnungsnummer und QR-Referenz.":invoice.invoice_number?"Die Rechnung wird storniert. Originalbeleg und Versandverlauf bleiben erhalten.":"Der Entwurf wird aus der aktiven Liste entfernt. Die Leistung steht danach wieder zur Abrechnung bereit."}</p>
      {action==="recreate"&&(invoice.refreshSources.length?<>
        <label>Abrechnungsgrundlage<select required value={sourceKey} onChange={event=>{setSourceKey(event.target.value);setConfirmed(false);}}><option value="">Bitte auswählen …</option>{invoice.refreshSources.map(source=><option key={source.sourceKey} value={source.sourceKey}>{source.description}</option>)}</select></label>
        {source&&<p>Neu: {source.recipient.name}<br/>Vereinsbeitrag {chf(source.contributionCents)} + Plattformgebühr {chf(source.platformFeeCents)} = <strong>{chf(source.contributionCents+source.platformFeeCents)}</strong></p>}
      </>:<p className="finance-warning">Keine passende bestätigte Abrechnungsgrundlage vorhanden. Bitte zuerst den Vertrag oder die Buchung prüfen. Die bisherige Rechnung bleibt erhalten.</p>)}
      <label>Grund<input required minLength={5} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></label>
      {deliveryStarted&&invoice.status!=="cancelled"&&<label className="finance-checkbox"><input type="checkbox" required checked={deliveryAcknowledged} onChange={event=>setDeliveryAcknowledged(event.target.checked)}/><span>Der Versand wurde bereits begonnen. Ich informiere den Sponsor über die Korrektur und darüber, die alte Rechnung nicht mehr zu bezahlen. Bereits übermittelte E-Mails oder Briefe werden nicht zurückgerufen; entstandene Postkosten bleiben bestehen.</span></label>}
      <label className="finance-checkbox"><input type="checkbox" required checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>{action==="recreate"?"Ich bestätige die Aufhebung des bisherigen Belegs und die Erstellung des neuen Entwurfs.":invoice.invoice_number?"Ich bestätige die Stornierung dieser Rechnung.":"Ich bestätige das Löschen dieses Entwurfs."}</span></label>
      <div><button className="access-primary" disabled={busy||!confirmed||(action==="recreate"&&!source)}>{busy?"Wird gespeichert …":action==="recreate"?"Aufheben und neu erstellen":invoice.invoice_number?"Verbindlich stornieren":"Entwurf löschen"}</button><button type="button" className="access-secondary" disabled={busy} onClick={onClose}>Abbrechen</button></div>
    </form>}
  </FinanceDialog>;
}
