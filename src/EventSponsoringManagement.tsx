import { useEffect, useMemo, useState } from "react";

type Booking = {
  id: string;
  reference: string;
  sponsorName: string;
  address: string;
  postalCode: string;
  city: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  referredByMember: string | null;
  includeFnMention: boolean;
  paymentMode: "invoice" | "cash";
  amountCents: number;
  submittedAt: string;
};

type SponsorshipEvent = {
  id: string;
  teamName: string;
  opponent: string;
  competition: string | null;
  venue: string | null;
  startsAt: string;
  timeTbd: boolean;
  priceCents: number;
  fnSupplementCents: number;
  status: "draft" | "published" | "cancelled";
  createdAt: string;
  booking: Booking | null;
};

type EventSponsoringData = {
  tenant: { name: string; slug: string };
  settings: {
    publicKey: string;
    publicUrl: string;
    headline: string;
    seasonLabel: string | null;
    introduction: string;
    termsText: string;
    isPublished: boolean;
    updatedAt: string;
  };
  events: SponsorshipEvent[];
};

const emptyEvent = {
  teamName: "",
  opponent: "",
  competition: "Meisterschaft",
  venue: "",
  startsAt: "",
  timeTbd: false,
  priceTemplate: "active",
  price: "150",
  fnSupplement: "30",
  publishNow: true,
};

const formatChf = (cents: number) => new Intl.NumberFormat("de-CH", {
  style: "currency", currency: "CHF", maximumFractionDigits: 0,
}).format(cents / 100);

const formatDate = (value: string) => new Intl.DateTimeFormat("de-CH", {
  weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

export function EventSponsoringManagement({ tenantId, canWrite, canManage }: {
  tenantId: string;
  canWrite: boolean;
  canManage: boolean;
}) {
  const [data, setData] = useState<EventSponsoringData | null>(null);
  const [settings, setSettings] = useState({ headline: "", seasonLabel: "", introduction: "", termsText: "", isPublished: false });
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const apply = (next: EventSponsoringData) => {
    setData(next);
    setSettings({
      headline: next.settings.headline,
      seasonLabel: next.settings.seasonLabel ?? "",
      introduction: next.settings.introduction,
      termsText: next.settings.termsText,
      isPublished: next.settings.isPublished,
    });
  };

  const load = async () => {
    const result = await request<{ eventSponsoring: EventSponsoringData }>(`/api/event-sponsoring/${tenantId}`);
    apply(result.eventSponsoring);
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    void load().catch(() => setError("Die Event-Sponsorings konnten nicht geladen werden.")).finally(() => setLoading(false));
  }, [tenantId]);

  const upcoming = useMemo(() => data?.events.filter((event) => event.status !== "cancelled") ?? [], [data]);
  const bookedCount = useMemo(() => upcoming.filter((event) => event.booking).length, [upcoming]);

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("settings"); setError(""); setMessage("");
    try {
      const result = await request<{ eventSponsoring: EventSponsoringData }>(`/api/event-sponsoring/${tenantId}/settings`, {
        method: "PATCH", body: JSON.stringify(settings),
      });
      apply(result.eventSponsoring);
      setMessage(settings.isPublished ? "Öffentliche Matchballseite gespeichert und freigeschaltet." : "Matchballseite gespeichert. Der öffentliche Link ist aktuell deaktiviert.");
    } catch {
      setError("Die Einstellungen konnten nicht gespeichert werden.");
    } finally { setBusy(""); }
  };

  const createEvent = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("create"); setError(""); setMessage("");
    try {
      const startsAt = new Date(eventForm.startsAt);
      if (Number.isNaN(startsAt.valueOf())) throw new Error("invalid_event_date");
      const result = await request<{ eventSponsoring: EventSponsoringData }>(`/api/event-sponsoring/${tenantId}/events`, {
        method: "POST",
        body: JSON.stringify({
          teamName: eventForm.teamName,
          opponent: eventForm.opponent,
          competition: eventForm.competition,
          venue: eventForm.venue,
          startsAt: startsAt.toISOString(),
          timeTbd: eventForm.timeTbd,
          priceCents: Math.round(Number(eventForm.price.replace(",", ".")) * 100),
          fnSupplementCents: Math.round(Number(eventForm.fnSupplement.replace(",", ".")) * 100),
          status: eventForm.publishNow ? "published" : "draft",
        }),
      });
      apply(result.eventSponsoring);
      setEventForm(emptyEvent);
      setMessage("Spiel erfasst. Es kann jetzt als Matchball-Sponsoring angeboten werden.");
    } catch {
      setError("Das Spiel konnte nicht erfasst werden. Bitte Datum und Beträge prüfen.");
    } finally { setBusy(""); }
  };

  const selectPriceTemplate = (value: string) => {
    const prices: Record<string, string> = { active: "150", juniorsA: "120", juniorsBC: "100", juniorsDF: "70" };
    setEventForm((current) => ({ ...current, priceTemplate: value, price: prices[value] ?? current.price }));
  };

  const changeStatus = async (item: SponsorshipEvent, status: SponsorshipEvent["status"]) => {
    setBusy(item.id); setError(""); setMessage("");
    try {
      const result = await request<{ eventSponsoring: EventSponsoringData }>(`/api/event-sponsoring/${tenantId}/events/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          teamName: item.teamName,
          opponent: item.opponent,
          competition: item.competition,
          venue: item.venue,
          startsAt: item.startsAt,
          timeTbd: item.timeTbd,
          priceCents: item.priceCents,
          fnSupplementCents: item.fnSupplementCents,
          status,
        }),
      });
      apply(result.eventSponsoring);
      setMessage(status === "published" ? "Spiel öffentlich freigeschaltet." : status === "draft" ? "Spiel vom öffentlichen Formular entfernt." : "Spiel abgesagt.");
    } catch {
      setError("Der Spielstatus konnte nicht geändert werden.");
    } finally { setBusy(""); }
  };

  const cancelBooking = async (item: SponsorshipEvent) => {
    if (!item.booking || !window.confirm(`Matchball-Zusage ${item.booking.reference} von ${item.booking.sponsorName} wirklich stornieren? Das Spiel wird danach wieder buchbar.`)) return;
    setBusy(item.id); setError(""); setMessage("");
    try {
      const result = await request<{ eventSponsoring: EventSponsoringData }>(`/api/event-sponsoring/${tenantId}/events/${item.id}/booking`, {
        method: "POST", body: JSON.stringify({ cancelled: true }),
      });
      apply(result.eventSponsoring);
      setMessage("Die Matchball-Zusage wurde storniert; das Spiel ist wieder verfügbar.");
    } catch {
      setError("Die Matchball-Zusage konnte nicht storniert werden.");
    } finally { setBusy(""); }
  };

  const copyLink = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.settings.publicUrl);
      setMessage("Öffentlicher Link kopiert.");
    } catch {
      setError("Der Link konnte nicht automatisch kopiert werden. Bitte markieren und manuell kopieren.");
    }
  };

  if (loading) return <section className="event-sponsoring-management"><div className="workspace-loading">Event-Sponsorings werden geladen …</div></section>;
  if (!data) return <section className="event-sponsoring-management"><div className="workspace-error"><strong>Event-Sponsoring nicht verfügbar.</strong><p>{error}</p></div></section>;

  return <section className="event-sponsoring-management">
    <header className="event-sponsoring-heading"><div><p className="eyebrow">Einzelne Spieltage unterstützen</p><h1>Matchball-Sponsoring</h1><p>Heimspiele veröffentlichen, Matchballsponsoren direkt erfassen und ein gebrandetes Matchblatt erzeugen.</p></div><div className="event-sponsoring-heading__metrics"><span><strong>{upcoming.length}</strong> Spiele</span><span><strong>{bookedCount}</strong> vergeben</span></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-success" role="status">{message}</p>}

    <section className="event-public-card">
      <div><p className="eyebrow">Öffentliches Formular</p><h2>Link für Interessierte</h2><p>Der Link funktioniert ohne Konto. Eine vollständige Anmeldung reserviert das Spiel unmittelbar.</p></div>
      <label><span>Öffentlicher Link</span><input readOnly value={data.settings.publicUrl}/></label>
      <div className="event-public-card__actions"><button className="access-secondary" type="button" onClick={() => void copyLink()}>Link kopieren</button><a className="access-primary" href={data.settings.publicUrl} target="_blank" rel="noreferrer">Formular öffnen</a></div>
      <span className={`event-public-state event-public-state--${data.settings.isPublished ? "published" : "draft"}`}>{data.settings.isPublished ? "Öffentlich" : "Noch deaktiviert"}</span>
    </section>

    <div className="event-sponsoring-grid">
      <form className="event-settings-card" onSubmit={saveSettings}>
        <div><p className="eyebrow">Darstellung</p><h2>Öffentliche Seite</h2><p>Logo und Farben stammen automatisch aus «Organisation».</p></div>
        <label><span>Titel</span><input required minLength={2} maxLength={160} disabled={!canManage} value={settings.headline} onChange={(event) => setSettings((current) => ({ ...current, headline: event.target.value }))}/></label>
        <label><span>Saison / Zeitraum</span><input maxLength={80} disabled={!canManage} value={settings.seasonLabel} onChange={(event) => setSettings((current) => ({ ...current, seasonLabel: event.target.value }))} placeholder="Saison 2026/27"/></label>
        <label><span>Einleitung</span><textarea required minLength={2} maxLength={2000} disabled={!canManage} value={settings.introduction} onChange={(event) => setSettings((current) => ({ ...current, introduction: event.target.value }))}/></label>
        <label><span>Hinweise</span><textarea required minLength={2} maxLength={3000} disabled={!canManage} value={settings.termsText} onChange={(event) => setSettings((current) => ({ ...current, termsText: event.target.value }))}/></label>
        <label className="onboarding-check"><input type="checkbox" disabled={!canManage} checked={settings.isPublished} onChange={(event) => setSettings((current) => ({ ...current, isPublished: event.target.checked }))}/><span>Öffentliches Formular aktivieren</span></label>
        {canManage ? <button className="access-primary" disabled={busy !== ""}>{busy === "settings" ? "Speichert …" : "Einstellungen speichern"}</button> : <p className="organization-readonly">Nur Owner können die öffentliche Seite bearbeiten.</p>}
      </form>

      <form className="event-create-card" onSubmit={createEvent}>
        <div><p className="eyebrow">Spielplan</p><h2>Spiel erfassen</h2><p>Der Grundpreis und die optionale FN-Verdankung werden pro Spiel festgelegt.</p></div>
        <div className="event-form-row"><label><span>Mannschaft</span><input required maxLength={160} disabled={!canWrite} value={eventForm.teamName} onChange={(event) => setEventForm((current) => ({ ...current, teamName: event.target.value }))} placeholder="1. Mannschaft"/></label><label><span>Gegner</span><input required maxLength={160} disabled={!canWrite} value={eventForm.opponent} onChange={(event) => setEventForm((current) => ({ ...current, opponent: event.target.value }))} placeholder="FC Muster"/></label></div>
        <div className="event-form-row"><label><span>Datum und Anpfiff</span><input required type="datetime-local" disabled={!canWrite} value={eventForm.startsAt} onChange={(event) => setEventForm((current) => ({ ...current, startsAt: event.target.value }))}/></label><label><span>Spielort</span><input maxLength={240} disabled={!canWrite} value={eventForm.venue} onChange={(event) => setEventForm((current) => ({ ...current, venue: event.target.value }))} placeholder="Sportplatz Bösingen"/></label></div>
        <label className="onboarding-check"><input type="checkbox" disabled={!canWrite} checked={eventForm.timeTbd} onChange={(event) => setEventForm((current) => ({ ...current, timeTbd: event.target.checked }))}/><span>Anspielzeit ist noch nicht bestätigt</span></label>
        <label><span>Wettbewerb</span><input maxLength={160} disabled={!canWrite} value={eventForm.competition} onChange={(event) => setEventForm((current) => ({ ...current, competition: event.target.value }))}/></label>
        <label><span>Preisvorlage aus bisherigem Matchballblatt</span><select disabled={!canWrite} value={eventForm.priceTemplate} onChange={(event) => selectPriceTemplate(event.target.value)}><option value="active">Aktive · CHF 150</option><option value="juniorsA">Junioren A · CHF 120</option><option value="juniorsBC">Junioren B und C · CHF 100</option><option value="juniorsDF">Junioren D bis F · CHF 70</option><option value="custom">Individueller Betrag</option></select></label>
        <div className="event-form-row"><label><span>Matchballpreis CHF</span><input required min="0" step="0.01" inputMode="decimal" disabled={!canWrite} value={eventForm.price} onChange={(event) => setEventForm((current) => ({ ...current, priceTemplate: "custom", price: event.target.value }))}/></label><label><span>FN-Verdankung CHF</span><input required min="0" step="0.01" inputMode="decimal" disabled={!canWrite} value={eventForm.fnSupplement} onChange={(event) => setEventForm((current) => ({ ...current, fnSupplement: event.target.value }))}/></label></div>
        <label className="onboarding-check"><input type="checkbox" disabled={!canWrite} checked={eventForm.publishNow} onChange={(event) => setEventForm((current) => ({ ...current, publishNow: event.target.checked }))}/><span>Spiel direkt öffentlich anbieten</span></label>
        {canWrite ? <button className="access-primary" disabled={busy !== ""}>{busy === "create" ? "Wird erfasst …" : "Spiel erfassen"}</button> : <p className="organization-readonly">Sie haben Leserechte.</p>}
      </form>
    </div>

    <section className="event-list-section"><div><p className="eyebrow">Spielübersicht</p><h2>Matchball-Termine</h2></div>
      {data.events.length === 0 ? <div className="transition-empty">Noch keine Spiele erfasst.</div> : <div className="event-list">{data.events.map((item) => <article className={`event-card event-card--${item.booking ? "booked" : item.status}`} key={item.id}>
        <div className="event-card__date"><strong>{new Intl.DateTimeFormat("de-CH", { day: "2-digit" }).format(new Date(item.startsAt))}</strong><span>{new Intl.DateTimeFormat("de-CH", { month: "short" }).format(new Date(item.startsAt))}</span></div>
        <div className="event-card__main"><span className="event-card__meta">{item.timeTbd ? `${new Intl.DateTimeFormat("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(item.startsAt))} · Anspielzeit offen` : formatDate(item.startsAt)}{item.venue ? ` · ${item.venue}` : ""}</span><h3>{item.teamName} <i>gegen</i> {item.opponent}</h3><p>{item.competition || "Heimspiel"} · {formatChf(item.priceCents)}{item.fnSupplementCents ? ` + ${formatChf(item.fnSupplementCents)} FN` : ""}</p>
          {item.booking && <div className="event-booking"><strong>{item.booking.sponsorName}</strong><span>{item.booking.reference} · {formatChf(item.booking.amountCents)} · {item.booking.paymentMode === "invoice" ? "Rechnung" : "Barzahlung"}</span><small>{item.booking.contactName} · {item.booking.contactEmail}{item.booking.contactPhone ? ` · ${item.booking.contactPhone}` : ""}</small></div>}
        </div>
        <div className="event-card__actions"><span className={`event-status event-status--${item.booking ? "booked" : item.status}`}>{item.booking ? "Vergeben" : item.status === "published" ? "Öffentlich" : item.status === "draft" ? "Entwurf" : "Abgesagt"}</span><a className="access-secondary" href={`/api/event-sponsoring/${tenantId}/events/${item.id}/flyer`} target="_blank" rel="noreferrer">Matchblatt PDF</a>{canWrite && !item.booking && item.status !== "cancelled" && <button className="access-secondary" disabled={busy !== ""} onClick={() => void changeStatus(item, item.status === "published" ? "draft" : "published")}>{item.status === "published" ? "Ausblenden" : "Veröffentlichen"}</button>}{canWrite && item.booking && <button className="access-text event-cancel" disabled={busy !== ""} onClick={() => void cancelBooking(item)}>Zusage stornieren</button>}</div>
      </article>)}</div>}
    </section>
  </section>;
}
