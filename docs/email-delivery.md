# E-Mail-Versand: Netlify Identity über Resend

Stand: 9. September 2026

mittragen.ch verwendet für Benutzerkonten und Einladungen Netlify Identity. Neue Identity-Konten erhalten ihre Einladung über Resend SMTP in Netlify. Für Personen, die bereits ein Identity-Konto besitzen, sendet die Team-Funktion zusätzlich eine gebrandete Zugangsmail direkt über die Resend API.

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
| Sender name, falls als separates Feld vorhanden | `mittragen.ch` |
| SMTP host | `smtp.resend.com` |
| SMTP port | `587` |
| SMTP username | `resend` |
| SMTP password | der separate Resend API-Key |
| Security/TLS, falls auswählbar | `STARTTLS` |

SMTP-Port `587` verwendet STARTTLS. Alternativ unterstützt Resend Port `465` mit implizitem SSL/TLS; für Netlify Identity ist `587` die bevorzugte Einstellung.

## 3. mittragen.ch-Einladung aktivieren

Pfad im Netlify-Dashboard:

**mittragen → Project configuration → Identity → Emails → Invitation template**

| Feld | Wert |
|---|---|
| Subject | `Einladung zu mittragen.ch – Unterstützung einfach organisieren` |
| Template path | `/emails/invitation.html` |

Die Vorlage ist bereits mit der produktiven Website deployt. Sie führt Einladungen gezielt auf `/login/` und übergibt dort den persönlichen `invite_token` an `@netlify/identity`.

## 4. Netlify-Umgebungsvariablen

Für die Zugangsmail an bestehende Identity-Konten benötigt die Team-Funktion einen separaten Resend-Schlüssel. In Resend dafür idealerweise einen zweiten Schlüssel `mittragen-existing-user-mail` mit reiner Versandberechtigung für `news.mittragen.ch` erstellen.

Die bestehende Variable `NETLIFY_IDENTITY_OPERATOR_TOKEN` bleibt unverändert. Sie wird von der geschützten Team-Funktion verwendet, um Identity-Einladungen auszulösen; sie ersetzt den Resend-Schlüssel nicht.

| Variable | Beispiel / Bedeutung | Netlify Scope | Context |
|---|---|---|---|
| `RESEND_API_KEY` | Schlüssel `mittragen-existing-user-mail` | Functions, als Secret | Production |
| `MAIL_FROM` | `mittragen.ch <noreply@news.mittragen.ch>` | Functions | Production |
| `MAIL_REPLY_TO` | optionale, betreute Antwortadresse | Functions | Production |

`RESEND_API_KEY` ist für diesen Versandweg erforderlich. `MAIL_FROM` sollte explizit gesetzt werden; ohne Variable verwendet die Funktion denselben Wert als sicheren Standard. `MAIL_REPLY_TO` bleibt optional. Der Schlüssel gehört ausschliesslich ins Netlify-Dashboard und nie ins Repository, in einen Chat oder Screenshot.

## 5. Funktionsprüfung

1. Eine neue Einladung an eine private Testadresse senden.
2. Im Resend-Dashboard unter **Emails** prüfen, ob die Nachricht erscheint.
3. Danach bei einer bereits registrierten Corporate-Adresse **Erneut senden** auslösen.
4. In Resend den Status `Delivered`, `Bounced` oder `Suppressed` prüfen.
5. Link öffnen, Passwort setzen und kontrollieren, ob die Organisation im Workspace erscheint.

In mittragen.ch bedeutet der Status **Übergeben**, dass Netlify die E-Mail an den Mailanbieter übergeben hat. Den endgültigen Zustellstatus liefert Resend.
