# mittragen.ch

**Unterstützung. Einfach weiter.**

mittragen.ch unterstützt Schweizer Vereine bei der Organisation von Sponsoren, Paketen, Verträgen und Matchbällen. Jeder Verein verfügt über eigene Daten und Teamrollen; Sponsoren erhalten einen persönlichen Space. Der Einstieg für weitere Vereine erfolgt als begleiteter Pilot über [Digital Bell](https://digitalbell.ch/).

## Aktueller Stand

Die produktive Anwendung umfasst:

- öffentliche Produktseite mit Funktionsübersicht, Beispielansichten für Verein und Sponsor, Mehrvereinsverwaltung, Pilot-Einstieg und Kontakt zu Digital Bell
- getrennte Organisationsbereiche mit Teamrollen und eigenem Markenauftritt
- produktiver Zugang mit Netlify Identity: Login, Registrierung, Bestätigung, Wiederherstellung und Einladungsannahme
- Self-Service-Onboarding für neue Klubs, Vereine, Events und Projekte
- verständliche Organisationstypen mit «Sportklub» und «Verein / Organisation»
- Owner-Einstellungen für einen veränderbaren Anzeigenamen bei stabilem technischem Kurzname
- Teamverwaltung mit Einladungsversand über Netlify Identity
- Gebrandete Identity-Einladung unter `/emails/invitation.html` (in Netlify als Einladungsvorlage hinterlegen)
- Deutsche Bestätigungsmail mit Bildmarke unter `/emails/confirmation.html` (in Netlify separat aktivieren) und sichtbare Erfolgsmeldung nach E-Mail-Bestätigung
- Produktive Excel-/CSV-Datenübernahme mit Blattwahl, persistierten Importläufen, Feldzuordnung, Vorprüfung und atomarem Sponsorimport
- explizite Zuordnung importierter Paketbezeichnungen zu veröffentlichten Paketversionen mit Preisübernahme
- editierbares Klubprofil und automatisch generiertes Sponsoringdossier als PDF aus den öffentlichen Paketen
- Produktive Überführungskampagnen mit eingefrorener Ausgangslage, Paket-Mapping, persönlichen Vorschlägen, Ausnahmen und Fortschrittskennzahlen
- Produktiver Paketkatalog mit unveränderlichen Versionen, strukturierten Rechten, Kapazitäten, Exklusivitätsregeln und transaktionalem Reservierungsschutz
- Expliziter Kampagnenversand über Resend mit persönlichen, 14 Tage gültigen Sponsorzugängen
- Geschützter Sponsorbereich mit Paketvergleich, verbindlicher Wahl, Alternative, Beratung und Ablehnung
- Vertragscenter mit organisationsspezifischen Absender- und Laufzeitregeln
- gebrandete, durchsuchbare Vertrags-PDFs aus einem unveränderlichen Paket- und Stammdatensnapshot
- protokollierte Klickbestätigung im Sponsorbereich mit Identität, E-Mail, Funktion, Zeitpunkt und Dokument-Fingerabdruck
- selbständiger Sponsorzugang nach Vertragsbestätigung: Konto erstellen oder anmelden, E-Mail bestätigen und den zugeordneten Space öffnen
- Sponsor-Space mit Dokumenten, Kontakt- und Adresspflege, Website und Logo; Änderungen aktualisieren die Stammdaten und werden protokolliert
- Logo-Vorschau, Logo-Filter und Logo-Verwaltung in der Administration
- «FAQ & Hilfe» im Adminpanel mit durchsuchbaren Schritt-für-Schritt-Anleitungen für alle Verwaltungsbereiche
- Schutz vor Kontoverwechslungen bei Sponsorlinks und persönlichen Aktivierungslinks
- unveränderliches Ereignisprotokoll sowie Row-Level Security für Verträge und Nachweise
- mandantenfähiges Event-/Matchball-Sponsoring mit Spielplan, direkter öffentlicher Anmeldung ohne Konto und Doppelbelegungsschutz
- gebrandete A4-Matchblätter je Spiel aus dem zentralen Organisationslogo und der hinterlegten Farbpalette

- serverseitige Rollenvergabe, automatische Einladungsübernahme und Schutz der letzten Owner-Rolle
- relationaler PostgreSQL-Kern via Netlify Database
- serverseitige Rollenprüfung und erzwungene Row-Level Security für alle mandanteneigenen Tabellen
- geschützte Functions für Mandantenliste, Mandantenerstellung und Workspace
- produktive Sponsoren-Stammdaten mit Suche, Erfassung und Bearbeitung
- Kontakt-, Adress-, Paket-, Status- und Jahreswertdaten mit serverseitiger Validierung
- Audit-Ereignisse für neue und geänderte Sponsoren
- responsive Darstellung und zugängliche Basisinteraktionen
- Netlify-Konfiguration für Continuous Deployment aus GitHub

Die SMTP- und Template-Konfiguration für Identity ist in [`docs/email-delivery.md`](docs/email-delivery.md) dokumentiert. Secrets werden ausschliesslich in den geschützten Netlify-/Resend-Einstellungen gespeichert.

Für die Pilotphase kann `REGISTRATION_NOTIFICATION_TO` eine interne Benachrichtigung nach erfolgreicher Kontoaktivierung einschalten. Der Hintergrundversand, die Produktionseinstellungen und die Behandlung von Wiederholungen sind in [`docs/registration-notifications.md`](docs/registration-notifications.md) beschrieben.

Die Daten im öffentlichen Überführungs-Prototyp sind bewusst als Demo-Daten gekennzeichnet und bleiben im Browser gespeichert. Änderungen im geschützten Workspace werden dagegen produktiv und mandantengetrennt in PostgreSQL gespeichert. Ein Kampagnenversand erfolgt ausschliesslich nach einer ausdrücklichen Bestätigung im Adminbereich; Deployments lösen keine E-Mail aus.

## Lokal starten

Die Hilfe ist im Workspace über «FAQ & Hilfe» erreichbar. Themenfilter und Volltextsuche durchsuchen Fragen, Schritte und Hinweise; berechtigte Teammitglieder können direkt zum beschriebenen Bereich wechseln. Die Inhalte stehen in `src/workspaceHelpContent.ts` und sollen bei Änderungen an Bedienabläufen mitgepflegt werden. Die Hilfe ist auch vor dem Anlegen einer Organisation verfügbar und lädt keine zusätzlichen Vereinsdaten.

Voraussetzung: Node.js 22.12 oder neuer.

```bash
npm install
npm run dev
```

Produktions-Build prüfen:

```bash
npm run build
```

## Routen

- `/` – öffentliche Produktseite
- `/admin` – geschlossener Backoffice-Prototyp; Weiterleitung auf `/login`
- `/space` – geschlossener Sponsor-Prototyp; Weiterleitung auf `/login`
- `/sponsor` – produktiver, geschützter Sponsorbereich
- `/ueberfuehren` – geschlossener Überführungs-Prototyp; Weiterleitung auf `/login`
- `/login` – produktive Anmeldung und Registrierung
- `/workspace` – geschützter, mandantengetrennter Workspace
- `/matchball/:publicKey` – öffentliches Matchball-Formular einer Organisation ohne Login

## Netlify

Das Repository ist für einen Git-basierten Netlify-Deploy vorbereitet:

- Build Command: `npm run build`
- Publish Directory: `dist`
- Node: `22`
- SPA-Fallback: in `netlify.toml` konfiguriert

Der Netlify Vite Plugin ist eingebunden, damit Functions, Blobs, Umgebungsvariablen und weitere Netlify-Primitiven in den nächsten Ausbauschritten lokal und in Produktion konsistent genutzt werden können.

Organisationskontakt, Vertragsabsender und Dossier-Branding werden zentral unter «Organisation» gepflegt. Logos liegen mandantengetrennt im site-weiten Blob Store `tenant-brand-assets`; die Datenbank speichert nur den geschützten Blob-Schlüssel, Dateityp und die automatisch vorgeschlagene, manuell anpassbare Farbpalette.

## Fachliche Grundlage

Die Umsetzung folgt dem Pflichtenheft «Sponsoring-Plattform für die Fusion des FC Bösingen und des FC Wünnewil-Flamatt – mit SaaS-Fähigkeit ab dem ersten Release», Version 1.0 vom 8. September 2026.

Für den Vertragsausbau wurden der bisherige Bronzesponsor-Vertrag und das Sponsoringkonzept des FC Bösingen fachlich modernisiert. Die öffentlich dokumentierte Gestaltungsgrundlage ist:

- [`docs/document-style-mittragen.md`](docs/document-style-mittragen.md) – auf Mittragen angepasster Dokumentenstil

Der bereitgestellte Altvertrag und das Sponsoringkonzept mit konkreten rechtlichen sowie kommerziellen Inhalten werden als interne fachliche Quellen behandelt und nicht als Dokumente im öffentlichen Repository veröffentlicht.

Die Referenzwerte werden nicht ungefragt in bestehende Mandanten geschrieben. Produktive Verträge entstehen ausschliesslich aus einer bestätigten Paketwahl. Vor der Freigabe verlangt das Vertragscenter eine explizite fachliche und rechtliche Prüfung. Die aktuell umgesetzte Klickbestätigung eignet sich für formfreie Vereinbarungen; fortgeschrittene und qualifizierte Signaturen bleiben als Provider-Adapter vorbereitet.

Der Pflichtenheft-Schritt «Klickbarer Prototyp des Sponsor-Überführungswegs mit fünf bis acht realen Szenarien» ist mit sieben fiktiven Szenarien umgesetzt. Das Grundgerüst für Mandanten, Rollen, PostgreSQL und Authentisierung sowie die erste produktive Sponsorenverwaltung sind ebenfalls implementiert.

Netlify Identity ist im Projekt aktiviert. Die Datenbank und Migrationen werden durch `@netlify/database` beim Deploy bereitgestellt.

Der [Pilot-Rollout-Plan](docs/pilot-rollout.md) unterscheidet die Freigabe für begleitete Pilotvereine von den offenen Anforderungen des vollständigen SaaS-Erstreleases. Vor weiteren Piloten stehen die Abnahme mit zwei Vereinen, vollständige Login-/Mailtests, ein wiederholbarer Einrichtungsablauf, Entzug von Zugängen sowie Betrieb und Wiederherstellung im Vordergrund.

Rechnungsübersicht, Zahlungsstatus, allgemeine Dokumentablage, weitere Leistungserfüllung, Verlängerungen sowie Tarifwahl und Plattform-Abrechnung sind noch auszubauen. Die öffentliche Produktseite kennzeichnet den Pilotumfang und stellt diese Funktionen nicht als bereits verfügbar dar.

Der aktuelle Zugang nach Vertragsunterzeichnung und die Abgrenzung zwischen Stammdaten und Vertragsstand sind in [`docs/sponsor-space.md`](docs/sponsor-space.md) beschrieben.

## Sicherheitsmodell

Jeder Datenzugriff läuft über eine Netlify Function. Diese prüft zuerst die Identity-Sitzung, danach die Mitgliedschaft und Rolle im angeforderten Mandanten. Erst dann wird innerhalb einer Datenbanktransaktion die Tenant-ID gesetzt. PostgreSQL erzwingt diese Grenze zusätzlich über `FORCE ROW LEVEL SECURITY`.

Automatisierte Tests prüfen die Rollenmatrix sowie die RLS-Abdeckung aller mandanteneigenen Tabellen:

```bash
npm test
```

## Designsystem

- Mittragen Blau: `#1F6BFF`
- Warmes Gold: `#F2B632`
- Tiefes Navy: `#0B2142`
- Off-White: `#F4F7FB`
- Typografie: Inter mit System-Fallbacks

Das Signet zeigt ein tragendes, rundes «m» mit einem warmen Mittelpunkt. Die Wortmarke wird immer exakt als `mittragen.ch` gesetzt.
