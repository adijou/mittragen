import { useEffect, useState } from "react";

type SigningData = {
  contract: {
    contractNumber: string; title: string; status: "released" | "confirmed"; snapshotHash: string;
    releasedAt: string; confirmedAt: string | null;
    organization: { legalName: string; contactEmail: string };
    sponsor: { legalName: string };
    package: { name: string; priceCents: number; durationMonths: number };
  };
  signer: { name: string; role: string; email: string };
  invitation: { status: string; expiresAt: string };
};

const errorLabels: Record<string, string> = {
  contract_signing_link_invalid: "Dieser Bestätigungslink ist ungültig, abgelaufen oder wurde durch einen neueren Link ersetzt.",
  contract_signing_link_expired: "Dieser Bestätigungslink ist abgelaufen. Bitte verlangen Sie beim Absender einen neuen Link.",
  contract_already_confirmed: "Dieser Vertrag wurde bereits bestätigt.",
  contract_acknowledgement_required: "Bitte bestätigen Sie zuerst, dass Sie den Vertrag geprüft haben.",
};

const formatChf = (cents: number) => new Intl.NumberFormat("de-CH", {
  style: "currency", currency: "CHF", maximumFractionDigits: 0,
}).format(cents / 100);
const formatDateTime = (value: string) => new Intl.DateTimeFormat("de-CH", {
  dateStyle: "long", timeStyle: "short",
}).format(new Date(value));

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

export function ContractSigning({ onHome }: { onHome: () => void }) {
  const [token] = useState(() => {
    const urlToken = new URLSearchParams(window.location.search).get("token");
    const historyToken = window.history.state && typeof window.history.state.contractSigningToken === "string"
      ? window.history.state.contractSigningToken
      : "";
    return urlToken ?? historyToken;
  });
  const [data, setData] = useState<SigningData | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (token && window.location.search) {
      window.history.replaceState({ ...(window.history.state ?? {}), contractSigningToken: token }, "", "/unterzeichnen");
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setError(errorLabels.contract_signing_link_invalid);
      return;
    }
    setBusy("load");
    void requestJson<SigningData>(`/api/contract-signing/${token}`)
      .then((result) => { setData(result); setConfirmed(result.contract.status === "confirmed"); })
      .catch((reason) => setError(errorLabels[reason instanceof Error ? reason.message : ""] ?? "Der Vertrag konnte nicht geladen werden."))
      .finally(() => setBusy(""));
  }, [token]);

  const downloadPdf = async () => {
    setBusy("pdf"); setError("");
    try {
      const response = await fetch(`/api/contract-signing/${token}/pdf`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "pdf_failed");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `Sponsoringvertrag_${data?.contract.contractNumber ?? "Mittragen"}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(errorLabels[reason instanceof Error ? reason.message : ""] ?? "Das PDF konnte nicht erstellt werden.");
    } finally { setBusy(""); }
  };

  const confirm = async () => {
    setBusy("confirm"); setError("");
    try {
      await requestJson(`/api/contract-signing/${token}/confirm`, { method: "POST", body: JSON.stringify({ acknowledged }) });
      setConfirmed(true);
      setData((current) => current ? { ...current, contract: { ...current.contract, status: "confirmed", confirmedAt: new Date().toISOString() } } : current);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      if (code === "contract_already_confirmed") setConfirmed(true);
      else setError(errorLabels[code] ?? "Der Vertrag konnte nicht bestätigt werden.");
    } finally { setBusy(""); }
  };

  return <div className="contract-signing-page">
    <header className="contract-signing-top"><button className="brand" onClick={onHome}>mittragen</button><span>Sichere Vertragsbestätigung</span></header>
    <main>
      {busy === "load" && <section className="contract-signing-card"><p>Vertrag wird sicher geladen …</p></section>}
      {error && !data && <section className="contract-signing-card contract-signing-error"><p className="eyebrow">Link nicht verfügbar</p><h1>Der Vertrag kann nicht geöffnet werden.</h1><p>{error}</p></section>}
      {data && <>
        <section className="contract-signing-card contract-signing-intro">
          <p className="eyebrow">{data.contract.organization.legalName}</p>
          <h1>{data.contract.title}</h1>
          <p>{data.contract.contractNumber} · unveränderlich freigegeben am {formatDateTime(data.contract.releasedAt)}</p>
          <dl><div><dt>Sponsor</dt><dd>{data.contract.sponsor.legalName}</dd></div><div><dt>Paket</dt><dd>{data.contract.package.name}</dd></div><div><dt>Jahreswert</dt><dd>{formatChf(data.contract.package.priceCents)}</dd></div><div><dt>Laufzeit</dt><dd>{data.contract.package.durationMonths} Monate</dd></div></dl>
          <button className="access-secondary" disabled={busy !== ""} onClick={() => void downloadPdf()}>{busy === "pdf" ? "PDF wird erstellt …" : "Vollständigen Vertrag als PDF öffnen"}</button>
        </section>
        {confirmed ? <section className="contract-signing-card contract-signing-success"><span aria-hidden="true">✓</span><div><p className="eyebrow">Bestätigung abgeschlossen</p><h2>Vielen Dank, Ihre Bestätigung ist protokolliert.</h2><p>Die Organisation kann Ihnen nun einen persönlichen Zugang oder eine PDF-Kopie des bestätigten Vertrags zustellen.</p></div></section> : <section className="contract-signing-card contract-signing-confirm">
          <p className="eyebrow">Unterzeichnende Person</p><h2>{data.signer.name}</h2><p>{data.signer.role} · {data.signer.email}</p>
          <label className="sponsor-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}/><span>Ich habe den vollständigen Vertrag geprüft, bin zur Bestätigung berechtigt und stimme dem unveränderlichen Vertragsstand zu.</span></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="access-primary" disabled={!acknowledged || busy !== ""} onClick={() => void confirm()}>{busy === "confirm" ? "Bestätigung wird protokolliert …" : "Vertrag verbindlich bestätigen"}</button>
          <small>Persönlicher Einmallink · gültig bis {formatDateTime(data.invitation.expiresAt)} · Prüfsumme {data.contract.snapshotHash.slice(0, 16)}…</small>
        </section>}
      </>}
    </main>
  </div>;
}
