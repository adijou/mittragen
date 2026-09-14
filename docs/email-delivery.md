# E-Mail-Versand: Netlify Identity über Resend

Stand: 14. September 2026

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

### Bestätigung der E-Mail-Adresse

Für die Bestätigung nach der Registrierung gibt es eine eigene deutsche Vorlage mit mittragen.ch-Bildmarke, Wortmarke und Markenfarben. Sie gilt für Sponsor- und Organisationskonten, da die E-Mail-Adresse das plattformweite Konto bestätigt.

Nach Veröffentlichung der neuen Dateien in Netlify unter **Project configuration → Identity → Emails → Confirmation template** hinterlegen:

| Feld | Wert |
|---|---|
| Subject | `Bitte bestätigen Sie Ihre E-Mail-Adresse – mittragen.ch` |
| Template path | `/emails/confirmation.html` |

Die Vorlage verwendet `{{ .SiteURL }}/login/#confirmation_token={{ .Token }}` für den Button **E-Mail-Adresse bestätigen** und den Ersatzlink. Die PNG-Bildmarke unter `/brand/mittragen-icon-email.png` ist aus der bestehenden SVG-Bildmarke exportiert. Für die Konto-Bestätigung bleibt `autoconfirm` deaktiviert.

Die Rückkehr auf die Website zeigt nach erfolgreicher Prüfung **E-Mail-Adresse erfolgreich bestätigt**. Der Benutzer bleibt auf dieser Seite, bis er **Weiter zu meinem Space** beziehungsweise **Weiter zu meinem Zugang** wählt. Sponsorzuordnungen werden im Hintergrund anhand der bestätigten Konto-E-Mail ermittelt; das funktioniert auch in einem neuen Tab. Scheitert nur das Laden des Zugangs, bleibt die erfolgreiche Bestätigung sichtbar und die Zuordnung kann erneut geprüft werden.

Auch bisherige Links mit einem Bestätigungstoken an der Startseite werden verarbeitet. Ungültige, abgelaufene und bereits verwendete Links zeigen einen deutschen Hinweis. Ein vorhandenes anderes Login oder ein Token in der URL allein führt zu keiner Erfolgsmeldung. Die Initialisierung löst die Bestätigung auch unter React StrictMode nur einmal aus.

**Veröffentlichungsstand:** Vorlage und Seitenänderung sind lokal vorbereitet. Der reine Website-Deploy aktiviert die Identity-Vorlage nicht automatisch. Erst die Veröffentlichung abwarten und prüfen, dass die beiden oben genannten Dateien öffentlich erreichbar sind; anschliessend Betreff und Template-Pfad in Identity setzen. Das Dashboard war bei der Prüfung nicht angemeldet, deshalb wurde seine Konfiguration nicht geändert. Die bisherige SMTP-Konfiguration wird weiterverwendet.

**Live-Diagnose am 14. September 2026:** Ein Aufruf der Startseite mit einem frei erfundenen `confirmation_token` zeigt weiterhin die öffentliche Produktseite. Der aktuelle produktive Stand (`c3dd000`, Deploy `6aa71d1bff58fc0008fef787`) verarbeitet den Token dort nicht. Die Login-Links dieser Seite navigieren nach `/login` und verlieren den Bestätigungscode. Das erklärt `invalid_grant: Email not confirmed`, wenn ein Bestätigungslink auf der Startseite landet. Ein tatsächlicher Bestätigungscode des betroffenen Kontos wurde nicht verwendet; weitere kontospezifische Ursachen sind damit nicht ausgeschlossen.

Bis zur Veröffentlichung kann bei einem noch gültigen Link zur Startseite der Pfad von `/#confirmation_token=…` auf `/login/#confirmation_token=…` geändert werden. Der Token bleibt dabei exakt unverändert und wird ausschliesslich auf `mittragen.ch` geöffnet. Die dauerhafte Korrektur verarbeitet auch die ursprünglichen Links, ohne dass Benutzer die Adresse bearbeiten müssen.

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

Für die neue Bestätigungsvorlage nach ihrer Aktivierung zusätzlich mit einer ausdrücklich freigegebenen Testadresse registrieren: deutschen Betreff, Logo und Button prüfen, Link in einem neuen Tab öffnen, die sichtbare Erfolgsmeldung prüfen und über den Weiter-Button den zugeordneten Bereich öffnen. Lokale Tests prüfen die Verarbeitung und Fehlermeldungen ohne echte E-Mails. Die Zustellung und Darstellung in einem Mailprogramm sind damit noch nicht geprüft.

In mittragen.ch bedeutet der Status **Übergeben**, dass Netlify die E-Mail an den Mailanbieter übergeben hat. Den endgültigen Zustellstatus liefert Resend.
