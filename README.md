# Mittragen

**Das Support-OS für Vereine, Events und Projekte.**

Mittragen führt Unterstützungsbeziehungen durch ihren gesamten Lebenszyklus: vom Paket und Vertrag über Rechnung, Dokumente und Leistungserfüllung bis zur nächsten Veränderung. Der besondere Produktkern ist der geführte Überführungsmodus für Fusionen, neue Paketwelten und die Ablösung manueller Prozesse.

## Aktueller Stand

Der erste interaktive Produkt-Slice setzt die ausgewählte visuelle Richtung «Klares Partnerschafts-OS» unter dem definitiven Namen **Mittragen** um:

- öffentliche Startseite und Markenauftritt
- Organisations-Dashboard mit Aufgaben, Kennzahlen und Übergangsstatus
- Sponsor-Space mit Paketvorschlag, Vergleich, Rechnungen und Dokumenten
- geführter Überführungsprozess mit Datenbasis, Mapping, Vorschlägen und Versandprüfung
- sieben fiktive Testszenarien für Doppelsponsoren, Exklusivität, Laufzeit, Rechtsträger, Betragstreue, Sachleistungen und Standardmigration
- drei Mapping-Simulationen mit dynamischer Wert- und Konfliktanzeige
- persönliche Paketwahl, Alternative, Beratung oder Ablehnung ohne Sackgasse
- lokale Status-Persistenz und Audit-Protokoll für den vollständigen Prototyp-Test
- produktiver Zugang mit Netlify Identity: Login, Registrierung, Bestätigung, Wiederherstellung und Einladungsannahme
- Self-Service-Onboarding für neue Klubs, Vereine, Events und Projekte
- verständliche Organisationstypen mit «Sportklub» und «Verein / Organisation»
- Owner-Einstellungen für einen veränderbaren Anzeigenamen bei stabilem technischem Kurzname
- Teamverwaltung mit Einladungsversand über Netlify Identity
- Gebrandete Identity-Einladung unter `/emails/invitation.html` (in Netlify als Einladungsvorlage hinterlegen)
- Produktive CSV-Datenübernahme mit persistierten Importläufen, Feldzuordnung, Vorprüfung und atomarem Sponsorimport
- Produktive Überführungskampagnen mit eingefrorener Ausgangslage, Paket-Mapping, persönlichen Vorschlägen, Ausnahmen und Fortschrittskennzahlen
- Produktiver Paketkatalog mit unveränderlichen Versionen, strukturierten Rechten, Kapazitäten, Exklusivitätsregeln und transaktionalem Reservierungsschutz

Die SMTP- und Template-Konfiguration für Identity ist in [`docs/email-delivery.md`](docs/email-delivery.md) dokumentiert. Secrets werden ausschliesslich in den geschützten Netlify-/Resend-Einstellungen gespeichert.
- serverseitige Rollenvergabe, automatische Einladungsübernahme und Schutz der letzten Owner-Rolle
- relationaler PostgreSQL-Kern via Netlify Database
- serverseitige Rollenprüfung und erzwungene Row-Level Security für alle mandanteneigenen Tabellen
- geschützte Functions für Mandantenliste, Mandantenerstellung und Workspace
- produktive Sponsoren-Stammdaten mit Suche, Erfassung und Bearbeitung
- Kontakt-, Adress-, Paket-, Status- und Jahreswertdaten mit serverseitiger Validierung
- Audit-Ereignisse für neue und geänderte Sponsoren
- responsive Darstellung und zugängliche Basisinteraktionen
- Netlify-Konfiguration für Continuous Deployment aus GitHub

Die Daten im öffentlichen Überführungs-Prototyp sind bewusst als Demo-Daten gekennzeichnet und bleiben im Browser gespeichert. Änderungen im geschützten Workspace werden dagegen produktiv und mandantengetrennt in PostgreSQL gespeichert. Vertragsbestätigung, Dateiimport und Versand verändern weiterhin keine externen Daten.

## Lokal starten

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
- `/admin` – Organisations-Backoffice
- `/space` – Sponsor-Space
- `/ueberfuehren` – geführter Überführungsprozess
- `/login` – produktive Anmeldung und Registrierung
- `/workspace` – geschützter, mandantengetrennter Workspace

## Netlify

Das Repository ist für einen Git-basierten Netlify-Deploy vorbereitet:

- Build Command: `npm run build`
- Publish Directory: `dist`
- Node: `22`
- SPA-Fallback: in `netlify.toml` konfiguriert

Der Netlify Vite Plugin ist eingebunden, damit Functions, Blobs, Umgebungsvariablen und weitere Netlify-Primitiven in den nächsten Ausbauschritten lokal und in Produktion konsistent genutzt werden können.

## Fachliche Grundlage

Die Umsetzung folgt dem Pflichtenheft «Sponsoring-Plattform für die Fusion des FC Bösingen und des FC Wünnewil-Flamatt – mit SaaS-Fähigkeit ab dem ersten Release», Version 1.0 vom 8. September 2026.

Der Pflichtenheft-Schritt «Klickbarer Prototyp des Sponsor-Überführungswegs mit fünf bis acht realen Szenarien» ist mit sieben fiktiven Szenarien umgesetzt. Das Grundgerüst für Mandanten, Rollen, PostgreSQL und Authentisierung sowie die erste produktive Sponsorenverwaltung sind ebenfalls implementiert.

Netlify Identity ist im Projekt aktiviert. Die Datenbank und Migrationen werden durch `@netlify/database` beim Deploy bereitgestellt.

Priorisierte nächste Schritte:

1. Sponsorwahl und Kampagnenversand an veröffentlichte Paketversionen anbinden.
2. Vertrags-, Dokument- und Audit-Modell erweitern.
3. Zahlungs- und Signaturprovider über austauschbare Adapter ergänzen.

## Sicherheitsmodell

Jeder Datenzugriff läuft über eine Netlify Function. Diese prüft zuerst die Identity-Sitzung, danach die Mitgliedschaft und Rolle im angeforderten Mandanten. Erst dann wird innerhalb einer Datenbanktransaktion die Tenant-ID gesetzt. PostgreSQL erzwingt diese Grenze zusätzlich über `FORCE ROW LEVEL SECURITY`.

Automatisierte Tests prüfen die Rollenmatrix sowie die RLS-Abdeckung aller mandanteneigenen Tabellen:

```bash
npm test
```

## Designsystem

- Dunkles Navy: `#0B2144`
- Primäres Blau: `#1967FF`
- Gönner-Gold: `#E9B44C`
- Typografie: Manrope + DM Sans mit System-Fallbacks

Das Signet zeigt mehrere Beitragende, die ein gemeinsames Zentrum tragen.
