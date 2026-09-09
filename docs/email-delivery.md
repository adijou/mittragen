# E-Mail-Versand: Netlify Identity über Resend

Stand: 9. September 2026

Mittragen verwendet für Benutzerkonten und Einladungen Netlify Identity. Der Versand der Identity-E-Mails wird direkt in Netlify über Resend SMTP konfiguriert. Die Anwendung erhält den Resend-Schlüssel nicht.

## 1. Resend vorbereiten

Im Resend-Dashboard muss die Domain `news.mittragen.ch` den Status **Verified** haben.

Unter **API Keys** einen separaten Schlüssel erstellen:

| Feld | Wert |
|---|---|
| Name | `mittragen-netlify-identity` |
| Permission | nur Versand / Sending access |
| Domain | `news.mittragen.ch` |

Den erzeugten Schlüssel sofort sicher kopieren. Resend zeigt seinen Wert später nicht erneut an. Der Schlüssel gehört weder ins Repository noch in einen Chat oder Screenshot.

## 2. SMTP in Netlify Identity eintragen

Pfad im Netlify-Dashboard:

**mittragen → Project configuration → Identity → Emails → Outgoing email address**

| Netlify-Feld | Wert |
|---|---|
| Outgoing email address | `noreply@news.mittragen.ch` |
| Sender name, falls als separates Feld vorhanden | `Mittragen` |
| SMTP host | `smtp.resend.com` |
| SMTP port | `587` |
| SMTP username | `resend` |
| SMTP password | der separate Resend API-Key |
| Security/TLS, falls auswählbar | `STARTTLS` |

SMTP-Port `587` verwendet STARTTLS. Alternativ unterstützt Resend Port `465` mit implizitem SSL/TLS; für Netlify Identity ist `587` die bevorzugte Einstellung.

## 3. Mittragen-Einladung aktivieren

Pfad im Netlify-Dashboard:

**mittragen → Project configuration → Identity → Emails → Invitation template**

| Feld | Wert |
|---|---|
| Subject | `Einladung zu Mittragen – gemeinsam Unterstützung organisieren` |
| Template path | `/emails/invitation.html` |

Die Vorlage ist bereits mit der produktiven Website deployt. Sie führt Einladungen gezielt auf `/login/` und übergibt dort den persönlichen `invite_token` an `@netlify/identity`.

## 4. Netlify-Umgebungsvariablen

Für den hier beschriebenen Identity-SMTP-Versand werden **keine neuen Netlify Environment Variables** benötigt. Das SMTP-Passwort wird ausschliesslich im geschützten Identity-E-Mail-Bereich gespeichert.

Die bestehende Variable `NETLIFY_IDENTITY_OPERATOR_TOKEN` bleibt unverändert. Sie wird von der geschützten Team-Funktion verwendet, um Identity-Einladungen auszulösen; sie ersetzt den Resend-Schlüssel nicht.

Falls Mittragen später weitere transaktionale Nachrichten direkt aus Functions über die Resend API versendet, werden dafür separat folgende Variablen vorgesehen:

| Variable | Beispiel / Bedeutung | Netlify Scope | Context |
|---|---|---|---|
| `RESEND_API_KEY` | separater Resend-Schlüssel für Mittragen-Functions | Functions, als Secret | Production |
| `MAIL_FROM` | `Mittragen <noreply@news.mittragen.ch>` | Functions | Production |
| `MAIL_REPLY_TO` | betreute Antwortadresse, sobald festgelegt | Functions | Production |

Diese drei Variablen sind für Identity-Einladungen noch nicht erforderlich und sollen erst zusammen mit dem direkten Resend-Adapter aktiviert werden.

## 5. Funktionsprüfung

1. Eine neue Einladung an eine private Testadresse senden.
2. Im Resend-Dashboard unter **Emails** prüfen, ob die Nachricht erscheint.
3. Danach eine neue Einladung an die Corporate-Adresse senden.
4. In Resend den Status `Delivered`, `Bounced` oder `Suppressed` prüfen.
5. Link öffnen, Passwort setzen und kontrollieren, ob die Organisation im Workspace erscheint.

In Mittragen bedeutet der Status **Übergeben**, dass Netlify die E-Mail an den Mailanbieter übergeben hat. Den endgültigen Zustellstatus liefert Resend.
