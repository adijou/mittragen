# Registrierungsbenachrichtigungen während der Pilotphase

Die Netlify Function `registration-notification` abonniert ausschliesslich das signierte Identity-Ereignis `userSignup`. Dieses Ereignis wird nach erfolgreicher Registrierung ausgelöst, bei aktivierter E-Mail-Bestätigung nach der Bestätigung. Es gilt für neu aktivierte Konten; die spätere Anmeldung eines bestehenden Kontos, ein neuer Sponsor-Datensatz oder eine weitere Vereinszuordnung lösen keine Mail aus. Bestehende Konten werden nicht rückwirkend gemeldet.

Die deutsche Mail enthält den Namen (falls angegeben), die Konto-E-Mail-Adresse und den Aktivierungszeitpunkt in Schweizer Zeit. Falls das Ereignis keinen Bestätigungszeitpunkt enthält, wird der Zeitpunkt seines Eingangs verwendet. Rollen, Passwörter, Aktivierungslinks und weitere Profildaten werden nicht versandt. Zum Registrierungszeitpunkt ist noch nicht zwingend eine Organisation oder ein Sponsor zugeordnet; die Benachrichtigung behauptet deshalb keine solche Zuordnung.

## Konfiguration

In Netlify für das Projekt `mittragen` im Kontext **Production** und Scope **Functions** konfigurieren:

| Variable | Bedeutung |
|---|---|
| `REGISTRATION_NOTIFICATION_TO` | Vom Betreiber festgelegte Empfängeradresse für die Pilotmeldungen |
| `RESEND_API_KEY` | Bestehender geheimer Resend-Versandschlüssel |
| `MAIL_FROM` | Bestehender verifizierter Absender, z. B. `mittragen.ch <noreply@news.mittragen.ch>` |
| `MAIL_REPLY_TO` | Optionale betreute Antwortadresse |

Die Zieladresse wird ausschliesslich aus der geschützten Serverkonfiguration gelesen. Formulare und Profilfelder können sie nicht überschreiben. Ohne `REGISTRATION_NOTIFICATION_TO` ist die Funktion ausgeschaltet; damit lässt sie sich nach der Pilotphase auch wieder deaktivieren. Nach Änderungen an Funktionsvariablen ist ein neuer Deploy nötig. Vorschauen und lokale Entwicklung senden keine Benachrichtigungen und schreiben keine Einträge in den produktiven Store.

## Ausführung und Wiederholungen

`config.background = true` trennt den Versand von der Kontoaktivierung. Die Funktion verändert keine Identity-Daten, weist kein Login ab und hat keinen öffentlichen HTTP-Versandhandler. Netlify überprüft die Signatur des Ereignisses vor dem Aufruf. Fehler beim Hintergrundversand werden nach einer Minute und bei erneutem Fehler nach weiteren zwei Minuten wiederholt.

Der Site-Store `registration-notifications` verwendet starke Lesekonsistenz und pro Site-/Benutzer-ID einen gehashten Schlüssel. Ein atomarer `onlyIfNew`-Schreibvorgang legt den Mailauftrag an. Gleichzeitige Aufrufe verwenden den gespeicherten, unveränderten Inhalt und denselben Resend-Idempotenzschlüssel. Nach Resends Annahme bleiben nur Nachrichten-ID und Versandzeitpunkt gespeichert; die personenbezogenen Mailinhalte werden aus diesem Eintrag entfernt. Der Beleg bleibt deployübergreifend erhalten und verhindert spätere Wiederholungen. Ein Resend-Beleg bestätigt die Annahme, nicht den Eingang im Postfach.

Resend bewahrt Idempotenzschlüssel 24 Stunden auf. Falls ein Versandstatus auch nach 23 Stunden ungeklärt bleibt, bricht eine erneute Verarbeitung mit `registration_notification_delivery_requires_review` ab. Dadurch wird nach einem möglichen Versand mit anschliessendem Speicherfehler nicht blind nochmals verschickt. Zur Klärung in den Netlify-Funktionslogs und im Resend-Dashboard prüfen, ob eine Nachricht angenommen bzw. zugestellt wurde. Einen offenen Store-Eintrag nicht ungeprüft löschen. Bei dauerhaften Anbieter- oder Konfigurationsfehlern ist nach den automatischen Wiederholungen ein manueller Eingriff erforderlich.

## Prüfung

Automatisierte Tests simulieren neue und wiederholte Ereignisse, parallele Aufrufe, Resend- und Speicherfehler, ungültige Antworten und den Ausschluss von Vorschau-Deploys. Sie senden keine echten Mails. Die produktive Abnahme erfolgt mit der nächsten tatsächlich autorisierten Neuregistrierung: Aktivierung abschliessen, Meldung und Zustellstatus in Resend prüfen, danach erneut anmelden und kontrollieren, dass keine zweite Nachricht entsteht.

Referenzen: [Identity-Ereignisse und Hintergrundausführung](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/), [automatische Wiederholungen](https://docs.netlify.com/build/functions/background-functions/), [atomare Blobs-Schreibvorgänge](https://docs.netlify.com/build/data-and-storage/netlify-blobs/), [Resend-Idempotenz](https://resend.com/docs/dashboard/emails/idempotency-keys).
