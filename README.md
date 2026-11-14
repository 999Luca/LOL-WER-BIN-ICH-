# Wer bin ich? – League of Legends

Multiplayer-Ratespiel für 2–5 Spieler: Jeder bekommt einen zufälligen Champion, sieht die Champions der anderen, aber nicht den eigenen, und errät ihn mit Ja/Nein-Fragen (z. B. im Discord-Call).

**Stack:** Node.js · Express · Socket.io · Vanilla HTML/CSS/JS. Der Spielzustand liegt im Arbeitsspeicher des Servers, eine Datenbank gibt es nicht.

## Lokal starten

```bash
npm install
npm start
# → http://localhost:3000
```

Node.js ab Version 18 ist nötig, weil der Server das eingebaute `fetch` benutzt.

## Deploy auf Render (Free Tier)

1. Diesen Ordner in ein GitHub-Repository pushen.
2. Auf <https://render.com> → **New → Web Service** → Repository auswählen.
3. Einstellungen:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. **Create Web Service**. Nach dem Build ist die App unter `https://<name>.onrender.com` erreichbar.

`PORT` setzt Render selbst, der Server liest ihn aus `process.env.PORT`. Für den Health-Check kannst du `/healthz` eintragen.

**Einschränkungen im Free Tier:**
- Nach etwa 15 Minuten ohne Aufrufe schläft der Dienst ein. Der erste Aufruf danach dauert rund 30–60 Sekunden. Öffne die Seite am besten kurz vor dem Spiel.
- Bei einem Neustart oder neuen Deploy gehen alle Räume verloren, weil sie nur im Arbeitsspeicher liegen.

## Spielablauf

1. Name eingeben und **Raum erstellen**. Du bist dann Host. Den Link (`/room/ABCD`) kopierst du und teilst ihn im Discord.
2. Die anderen öffnen den Link, geben ihren Namen ein und treten bei.
3. In der Lobby wählt der Host den Champion-Pool (alle Champions oder bestimmte Klassen) und startet das Spiel.
4. Jeder sieht die Karten der anderen. Die eigene Karte zeigt nur **„?“**. Der Server schickt dir deinen eigenen Champion erst, wenn du ihn erraten hast. Nachschauen in den DevTools bringt also nichts.
5. Wer dran ist, tippt eine Ja/Nein-Frage ein (🎲 liefert eine zufällige Idee). Alle anderen stimmen mit **Ja**, **Nein** oder **Weiß nicht** ab. Jede Frage zählt automatisch +1.
   - Die Mehrheit entscheidet. Bei Gleichstand zwischen Ja und Nein lautet das Ergebnis „unklar“.
   - Bei **Ja** darf man weiterfragen, sonst ist der Nächste dran. In der Lobby kann der Host auf „immer nur 1 Frage pro Zug“ umstellen.
   - Wer offline ist, wird beim Abstimmen nicht mitgezählt. Fragesteller und Host können mit **Jetzt auswerten** früher auswerten oder die Frage **zurückziehen**.
   - Unter jeder Karte steht der **Fragen-Verlauf** mit allen Antworten.
6. **Ich hab's erraten!** öffnet ein Eingabefeld mit Autovervollständigung. Ein richtiger Tipp deckt deine Karte auf, ein falscher kostet +1 Frage und beendet deinen Zug. Mit **Aufgeben** deckst du deinen Champion auf und landest am Ende der Rangliste.
7. Wenn alle fertig sind, erscheint die Rangliste (wenigste Fragen gewinnt) und dazu die **Gesamtwertung** über alle Runden mit Siegen und Ø Fragen. Danach startet der Host eine **neue Runde** oder geht zurück in die **Lobby**.

Extras:
- 📋 **Notizblock**: ein privates Raster mit allen Champions zum Ausschließen, auch eine ganze Klasse auf einmal
- 😀 **Emoji-Reaktionen**, die bei allen über den Bildschirm fliegen
- 🎉 **Aufdecken in groß** mit Splash-Art, Titel und Kurzgeschichte des Champions
- 🏅 **Auszeichnungen** am Rundenende: Blitzmerker, Neugierigste Person, Glückspilz, Nein-Mauer, Kamikaze, Ahnungslos
- ✨ **Skin-Modus** (in der Lobby, standardmäßig aus): zufällige Skins statt Standard-Splash
- 🔊 Sounds (Stummschalter oben), Vibration auf dem Handy, Konfetti, „🎯 Du bist dran!“ im Tab-Titel
- Auf Render ruft der Server sich während eines laufenden Spiels alle 10 Minuten selbst auf, damit er nicht einschläft

Lädt jemand die Seite neu, landet er wieder in seinem Raum. Die Sitzungs-ID liegt im `localStorage`. Wer länger offline ist, kann vom Host entfernt werden. Ist der Host länger als 45 Sekunden offline, übernimmt ein anderer Spieler.

## Dateien

```
server.js          Express + Socket.io, Raum- und Spiellogik, Data-Dragon-Laden
public/index.html  Oberfläche
public/style.css   Hextech-Design
public/app.js      Client-Logik
```

Champion-Daten und Bilder kommen von Riot Data Dragon. Das ist ein inoffizielles Fan-Projekt und wird nicht von Riot Games unterstützt.
