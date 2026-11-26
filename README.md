# Radio Północy

Nocny odbiornik w przeglądarce. Szafka jest stylizowana na lampową Syrenę. Stroisz skalę i łapiesz stacje: część jest zmyślona, część to prawdziwe anteny Polskiego Radia.

## Funkcje

- **Szafka.** Drewniana rama, płócienna maskownica, czarna skala i bakelitowe gałki: strojenie, głośność, sieć.
- **Oczko magiczne.** Na środku maskownicy. Przy szumie jest ciemne. Im czyściej złapana stacja, tym mocniej zapala się na zielono.
- **Trzy pasma.** `FM` to nocne stacje. `KR` to fale krótkie. `PL` to Polskie Radio.
- **Strojenie.** Gałka, przeciąganie skali albo strzałki na klawiaturze. „Szukaj” jedzie wzdłuż pasma i staje na stacji.
- **Sygnał.** Między stacjami jest szum. Blisko nośnej głos się przebija. Na czystej częstotliwości stacja siedzi.
- **RDS.** Na FM i na paśmie Polska: nazwa programu, gatunek i przewijany tekst. Przy słabym sygnale znaki się sypią. Fale krótkie RDS nie mają.
- **Depesza.** Po złapaniu nocnej stacji tekst wychodzi jak z maszyny. Przy słabym sygnale litery się psują.
- **Polskie Radio.** Dwójka, Trójka, Czwórka, Radio 24, Radio Dzieciom i Radio Kierowców lecą z internetowego strumienia, nie z anteny w telefonie. Jedynki nie ma: jej adres nie działa w przeglądarce.
- **Korespondencja.** Na falach krótkich osoby z tym samym znakiem (cztery znaki) i tą samą falą mogą rozmawiać przez internet. Stuknij **Nadawanie**, aby włączyć mikrofon, i stuknij **Zakończ nadawanie**, aby zakończyć transmisję. Puszczenie przycisku nie wyłącza nadawania. Wspólny znak wybiera kanał; nie jest hasłem ani kontrolą dostępu.

## Jak uruchomić

Potrzebujesz Gita i [Node.js](https://nodejs.org) w wersji **22.13.0 lub nowszej z linii 22 albo w wersji 24 lub nowszej**. `npm` jest w zestawie z Node. CI sprawdza wersję minimalną i linię Node 24.

1. Sklonuj repozytorium i wejdź do katalogu:

```bash
git clone https://github.com/f6j6g2b88b-tech/radio-polnocy.git
cd radio-polnocy
```

2. Zainstaluj zależności. Pierwszy raz trwa chwilę:

```bash
npm ci
```

3. Włącz serwer i zostaw ten terminal otwarty:

```bash
npm run dev
```

4. Otwórz w przeglądarce [http://127.0.0.1:8080](http://127.0.0.1:8080).

Żeby wyłączyć serwer, wróć do terminala i wciśnij `Ctrl+C`.

### Jak posłuchać

- Kliknij dolną gałkę **Sieć**. Dopiero wtedy przeglądarka puszcza dźwięk.
- Lewa duża gałka stroi. **Szukaj** jedzie po paśmie i staje na stacji.
- Prawa duża gałka to głośność: ciągnij ją w górę albo w dół.
- Jeśli przeglądarka pozwala regulować strumienie Polskiego Radia tylko głośnością systemową, aplikacja wyświetli wskazówkę użycia przycisków urządzenia. Ustawienie gałki na zero nadal wycisza strumień. Dźwięki odbiornika i rozmowy na KR korzystają z regulacji Web Audio.
- Przyciski na skali: **FM** (nocne stacje), **KR** (fale krótkie), **PL** (Polskie Radio z internetu).
- Strumienie Polskiego Radia i rozmowy na KR potrzebują internetu. Dźwięki fikcyjnych stacji są generowane lokalnie po załadowaniu aplikacji.
- Najlepiej w słuchawkach.

Strzałki stroją. Z Shiftem skok jest większy. Strzałki w górę i w dół zmieniają głośność.

### Jak coś nie wstanie

- Terminal nie zna `npm` ani `node` — doinstaluj Node.js i otwórz terminal od nowa.
- `npm run dev` pisze, że port `8080` jest zajęty — zamknij drugi serwer, który go trzyma, i odpal komendę jeszcze raz.
- Strona jest pusta albo nie ma dźwięku — odśwież kartę i włącz **Sieć**. Nocne stacje szumią bez internetu. Polskie Radio milczy, gdy strumień nie dojdzie.

## Testy i kontrola jakości

Po `npm ci` uruchom:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` uruchamia testy skryptów oraz testy TypeScript w jednym przebiegu. Wynik jednej grupy nie blokuje uruchomienia drugiej. `npm run test:radio` ogranicza zakres do modułów radia i komunikacji WebRTC. Testy konfiguracji i metadanych PWA korzystają z katalogów tymczasowych, więc nie wymagają plików środowiska autora ani przykładowej nazwy projektu.

Test przeglądarkowy wymaga uruchomionej aplikacji (`npm run dev` w drugim terminalu) i Chromium:

```bash
npx playwright install chromium
npm run test:browser
```

Domyślnym adresem testu jest `http://127.0.0.1:8080`. Zmienna `RADIO_TEST_URL` pozwala wskazać inny adres, np. podgląd gotowej kompilacji. GitHub Actions instaluje przeglądarkę i uruchamia ten test na Node 24.

### Opcjonalne testy dokumentacji środowiska autora

`npm run test:builder-contracts` zachowuje cztery kontrole zgodności skryptów z dokumentacją narzędzi Grok. Wymaga oryginalnego katalogu `.grok/skills/og/` wraz z `SKILL.md` i `references/`, dostarczanego przez to środowisko. Tych zewnętrznych plików nie ma w repozytorium, dlatego kontrole są oddzielone od testów aplikacji. Testy działania skryptów pozostają w `npm test`.

## Wdrożenie i rozmowy na KR

Aplikacja zawiera serwer obsługujący `/api/rtc`; sam hosting statyczny nie wystarczy do rozmów. Obecna konfiguracja kompilacji jest przygotowana dla Vercel. Dostęp do mikrofonu wymaga HTTPS albo lokalnego adresu `localhost` / `127.0.0.1`.

### Wspólna baza danych

Na Vercel ustaw serwerową zmienną **`DATABASE_URL`** wskazującą wspólną bazę PostgreSQL, np. Neon. Wszystkie instancje aplikacji muszą używać tej samej bazy, aby widzieć korespondentów i wymieniać informacje potrzebne do zestawienia rozmowy. Konto bazy musi móc utworzyć tabele sygnalizacji i indeksy przy pierwszym użyciu. Bez konfiguracji bazy endpoint rozmów na Vercel zwraca błąd konfiguracji.

Lokalnie, bez `DATABASE_URL`, aplikacja używa PGlite w pamięci jednego procesu. To wystarcza do prób na jednym serwerze; dane połączeń znikają po jego restarcie. Dziennik nasłuchu i ustawienia odbiornika są zapisywane osobno, w przeglądarce użytkownika.

### TURN dla trudniejszych sieci

Domyślnie aplikacja korzysta z publicznych serwerów STUN. Aby umożliwić połączenia również w sieciach wymagających przekazywania ruchu przez serwer TURN, skonfiguruj po stronie serwera:

| Zmienna | Znaczenie |
| --- | --- |
| `TURN_URLS` | Adres lub adresy `turn:` / `turns:`, rozdzielone przecinkami, np. `turns:turn.example.com:5349` |
| `TURN_SHARED_SECRET` | Sekret współdzielony z serwerem TURN obsługującym czasowe poświadczenia REST, np. coturn z `use-auth-secret` |

Potrzebne są obie wartości. `/api/rtc` wystawia przeglądarce krótkotrwałe poświadczenia, a sekret pozostaje na serwerze. **Nie dodawaj prefiksu `VITE_` do sekretu** i nie zapisuj go w repozytorium. Samo ustawienie zmiennych nie uruchamia serwera TURN — jego działający adres i konfigurację trzeba zapewnić przy wdrożeniu.

