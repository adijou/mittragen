import { useEffect, useMemo, useState, type CSSProperties } from "react";

type PublicEvent = {
  id: string;
  teamName: string;
  opponent: string;
  competition: string | null;
  venue: string | null;
  startsAt: string;
  timeTbd: boolean;
  priceCents: number;
  fnSupplementCents: number;
  available: boolean;
  sponsorCount: number;
};

type PublicData = {
  organization: {
    name: string;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    website: string | null;
    brandPrimaryColor: string;
    brandAccentColor: string;
    logoAvailable: boolean;
  };
  settings: { headline: string; seasonLabel: string | null; introduction: string; termsText: string };
  events: PublicEvent[];
};

const emptyForm = {
  sponsorName: "",
  address: "",
  postalCode: "",
  city: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  referredByMember: "",
  includeFnMention: false,
  paymentMode: "invoice" as "invoice" | "cash",
  termsAccepted: false,
  website: "",
};

const formatChf = (cents: number) => new Intl.NumberFormat("de-CH", {
  style: "currency", currency: "CHF", maximumFractionDigits: 0,
}).format(cents / 100);

const formatDate = (value: string) => new Intl.DateTimeFormat("de-CH", {
  weekday: "long", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));

function publicKey() {
  const match = window.location.pathname.match(/^\/matchball\/([0-9a-f]{36})\/?$/i);
  return match?.[1]?.toLowerCase() ?? "";
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

export function EventSponsoringPublic({ onHome }: { onHome: () => void }) {
  const key = publicKey();
  const [data, setData] = useState<PublicData | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [startedAt] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState<{ reference: string; amountCents: number } | null>(null);

  useEffect(() => {
    if (!key) { setError("Dieser Matchball-Link ist ungültig."); setLoading(false); return; }
    void request<{ eventSponsoring: PublicData }>(`/api/event-sponsoring-public/${key}`).then((result) => {
      setData(result.eventSponsoring);
      setSelectedId(result.eventSponsoring.events[0]?.id ?? "");
    }).catch(() => setError("Diese Matchballseite ist nicht verfügbar oder noch nicht veröffentlicht.")).finally(() => setLoading(false));
  }, [key]);

  const selected = useMemo(() => data?.events.find((event) => event.id === selectedId) ?? null, [data, selectedId]);
  const total = selected ? selected.priceCents + (form.includeFnMention ? selected.fnSupplementCents : 0) : 0;
  const update = <Key extends keyof typeof emptyForm>(field: Key, value: typeof emptyForm[Key]) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const result = await request<{ booking: { reference: string; amountCents: number } }>(`/api/event-sponsoring-public/${key}/book`, {
        method: "POST",
        body: JSON.stringify({ ...form, eventId: selected.id, startedAt }),
      });
      setBooking(result.booking);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "event_sponsoring_public_booking_failed";
      setError(code === "event_booking_terms_required"
          ? "Bitte bestätigen Sie die verbindliche Anmeldung."
          : "Die Anmeldung konnte nicht gespeichert werden. Bitte prüfen Sie alle Angaben und versuchen Sie es erneut.");
    } finally { setBusy(false); }
  };

  if (loading) return <main className="event-public-page event-public-state-page"><p>Matchballseite wird geladen …</p></main>;
  if (!data) return <main className="event-public-page event-public-state-page"><h1>Matchballseite nicht verfügbar</h1><p>{error}</p><button onClick={onHome}>Zur Startseite</button></main>;
  const style = { "--event-primary": data.organization.brandPrimaryColor, "--event-accent": data.organization.brandAccentColor } as CSSProperties;

  if (booking && selected) return <main className="event-public-page" style={style}>
    <header className="event-public-header"><button onClick={onHome} aria-label="Zur Startseite">mittragen</button>{data.organization.logoAvailable ? <img src={`/api/event-sponsoring-public/${key}/logo`} alt={`${data.organization.name} Logo`}/> : <strong>{data.organization.name}</strong>}</header>
    <section className="event-public-success"><span>✓</span><p className="eyebrow">Anmeldung gespeichert</p><h1>Vielen Dank für das Matchball-Sponsoring.</h1><p><strong>{selected.teamName} gegen {selected.opponent}</strong><br/>{formatDate(selected.startsAt)}</p><dl><div><dt>Referenz</dt><dd>{booking.reference}</dd></div><div><dt>Betrag</dt><dd>{formatChf(booking.amountCents)}</dd></div><div><dt>Abrechnung</dt><dd>{form.paymentMode === "invoice" ? "Der Verein stellt eine Rechnung." : "Barzahlung wurde gewählt."}</dd></div></dl><p>Die Anmeldung ist gespeichert. Es ist keine Konto- oder E-Mail-Bestätigung notwendig.</p></section>
  </main>;

  return <main className="event-public-page" style={style}>
    <header className="event-public-header"><button onClick={onHome} aria-label="Zur Startseite">mittragen</button>{data.organization.logoAvailable ? <img src={`/api/event-sponsoring-public/${key}/logo`} alt={`${data.organization.name} Logo`}/> : <strong>{data.organization.name}</strong>}</header>
    <section className="event-public-hero"><div><p className="eyebrow">{data.settings.seasonLabel || "Matchball-Sponsoring"}</p><h1>{data.settings.headline}</h1><p>{data.settings.introduction}</p></div><aside><span>Direkt anmelden</span><strong>Mehrere Sponsoren möglich</strong><small>Kein Konto und keine E-Mail-Bestätigung nötig.</small></aside></section>

    <section className="event-public-selection"><div><p className="eyebrow">Spielplan</p><h2>Heimspiel auswählen</h2><p>Pro Spiel können sich mehrere Matchballsponsoren engagieren; jede Anmeldung wird unmittelbar reserviert.</p></div>
      {data.events.length === 0 ? <div className="event-public-empty">Aktuell sind noch keine Spiele ausgeschrieben.</div> : <div className="event-public-games">{data.events.map((item) => <button type="button" className={selectedId === item.id ? "selected" : ""} key={item.id} onClick={() => setSelectedId(item.id)}><span>{item.timeTbd ? `${new Intl.DateTimeFormat("de-CH", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date(item.startsAt))} · Anspielzeit offen` : formatDate(item.startsAt)}</span><strong>{item.teamName} <i>gegen</i> {item.opponent}</strong><small>{item.venue || "Heimspiel"} · {formatChf(item.priceCents)}</small><em>{item.sponsorCount === 0 ? "Noch ohne Matchballsponsor" : `${item.sponsorCount} Matchballsponsor${item.sponsorCount === 1 ? "" : "en"}`}</em></button>)}</div>}
    </section>

    {selected && <form className="event-public-form" onSubmit={submit}>
      <div className="event-public-form__heading"><div><p className="eyebrow">Ihre Angaben</p><h2>Matchball-Sponsoring anmelden</h2><p>{selected.teamName} gegen {selected.opponent}</p></div><strong>{formatChf(total)}</strong></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="event-public-form__grid">
        <label className="wide"><span>Name des Sponsors / Unternehmens</span><input required maxLength={200} value={form.sponsorName} onChange={(event) => update("sponsorName", event.target.value)}/></label>
        <label className="wide"><span>Adresse</span><input required maxLength={240} autoComplete="street-address" value={form.address} onChange={(event) => update("address", event.target.value)}/></label>
        <label><span>PLZ</span><input required maxLength={20} autoComplete="postal-code" value={form.postalCode} onChange={(event) => update("postalCode", event.target.value)}/></label>
        <label><span>Ort</span><input required maxLength={160} autoComplete="address-level2" value={form.city} onChange={(event) => update("city", event.target.value)}/></label>
        <label><span>Kontaktperson</span><input required maxLength={160} autoComplete="name" value={form.contactName} onChange={(event) => update("contactName", event.target.value)}/></label>
        <label><span>E-Mail-Adresse</span><input required type="email" maxLength={320} autoComplete="email" value={form.contactEmail} onChange={(event) => update("contactEmail", event.target.value)}/></label>
        <label><span>Telefon (optional)</span><input maxLength={80} autoComplete="tel" value={form.contactPhone} onChange={(event) => update("contactPhone", event.target.value)}/></label>
        <label><span>Vermittelt durch Klubmitglied (optional)</span><input maxLength={160} value={form.referredByMember} onChange={(event) => update("referredByMember", event.target.value)}/></label>
        <label className="event-public-honeypot" aria-hidden="true"><span>Website</span><input tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => update("website", event.target.value)}/></label>
      </div>
      {selected.fnSupplementCents > 0 && <label className="event-public-choice"><input type="checkbox" checked={form.includeFnMention} onChange={(event) => update("includeFnMention", event.target.checked)}/><span><strong>Verdankung in den Freiburger Nachrichten</strong><small>Zusätzlich {formatChf(selected.fnSupplementCents)}</small></span></label>}
      <fieldset className="event-public-payment"><legend>Abrechnung</legend><label><input type="radio" name="payment" checked={form.paymentMode === "invoice"} onChange={() => update("paymentMode", "invoice")}/><span>Rechnung an Sponsor</span></label><label><input type="radio" name="payment" checked={form.paymentMode === "cash"} onChange={() => update("paymentMode", "cash")}/><span>Barzahlung</span></label></fieldset>
      <aside className="event-public-terms"><strong>Hinweise</strong><p>{data.settings.termsText}</p></aside>
      <label className="event-public-confirm"><input required type="checkbox" checked={form.termsAccepted} onChange={(event) => update("termsAccepted", event.target.checked)}/><span>Ich melde dieses Matchball-Sponsoring verbindlich an. Die Angaben dürfen für Abrechnung und Spieltagskommunikation verwendet werden.</span></label>
      <button className="event-public-submit" disabled={busy}>{busy ? "Anmeldung wird gespeichert …" : `Jetzt für ${formatChf(total)} anmelden`}</button>
      <small className="event-public-no-login">Kein Konto und keine E-Mail-Bestätigung erforderlich.</small>
    </form>}

    <footer className="event-public-footer"><strong>{data.organization.name}</strong><span>{[data.organization.contactName, data.organization.contactEmail, data.organization.contactPhone].filter(Boolean).join(" · ")}</span></footer>
  </main>;
}
