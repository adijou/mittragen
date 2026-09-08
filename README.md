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
- responsive Darstellung und zugängliche Basisinteraktionen
- Netlify-Konfiguration für Continuous Deployment aus GitHub

Die dargestellten Daten sind bewusst als Demo-Daten gekennzeichnet. Änderungen bleiben im Browser gespeichert; Vertragsbestätigung, Dateiimport und Versand verändern keine externen Daten.

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

## Netlify

Das Repository ist für einen Git-basierten Netlify-Deploy vorbereitet:

- Build Command: `npm run build`
- Publish Directory: `dist`
- Node: `22`
- SPA-Fallback: in `netlify.toml` konfiguriert

Der Netlify Vite Plugin ist eingebunden, damit Functions, Blobs, Umgebungsvariablen und weitere Netlify-Primitiven in den nächsten Ausbauschritten lokal und in Produktion konsistent genutzt werden können.

## Fachliche Grundlage

Die Umsetzung folgt dem Pflichtenheft «Sponsoring-Plattform für die Fusion des FC Bösingen und des FC Wünnewil-Flamatt – mit SaaS-Fähigkeit ab dem ersten Release», Version 1.0 vom 8. September 2026.

Der Pflichtenheft-Schritt «Klickbarer Prototyp des Sponsor-Überführungswegs mit fünf bis acht realen Szenarien» ist mit sieben fiktiven Szenarien umgesetzt. Der nächste Architekturbaustein ist:

1. Mandanten- und Rollenmodell festlegen.
2. Relationale Datenbank mit Tenant-Isolation aufsetzen.
3. Authentisierung und sichere Einladungen integrieren.
4. Import- und Mapping-Persistenz implementieren.
5. Vertrags-, Dokument- und Audit-Modell anbinden.
6. E-Mail-, Zahlungs- und Signaturprovider über austauschbare Adapter ergänzen.

## Designsystem

- Dunkles Navy: `#0B2144`
- Primäres Blau: `#1967FF`
- Gönner-Gold: `#E9B44C`
- Typografie: Manrope + DM Sans mit System-Fallbacks

Das Signet zeigt mehrere Beitragende, die ein gemeinsames Zentrum tragen.
