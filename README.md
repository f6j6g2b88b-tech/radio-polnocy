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
- **Dziennik nasłuchu.** Złapane stacje zostają w przeglądarce. „Dostrój” wraca na ich częstotliwość.

## Jak uruchomić

Potrzebujesz Gita i [Node.js 22](https://nodejs.org) albo nowszego. `npm` jest w zestawie z Node.

1. Sklonuj repozytorium i wejdź do katalogu:

```bash
git clone https://github.com/f6j6g2b88b-tech/radio-polnocy.git
cd radio-polnocy
```

2. Zainstaluj zależności. Pierwszy raz trwa chwilę:

```bash
npm install
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
- Przyciski na skali: **FM** (nocne stacje), **KR** (fale krótkie), **PL** (Polskie Radio z internetu).
- Pasmo Polska potrzebuje sieci. Reszta gra też bez niej.
- Najlepiej w słuchawkach.

Strzałki stroją. Z Shiftem skok jest większy. Strzałki w górę i w dół zmieniają głośność.

### Jak coś nie wstanie

- Terminal nie zna `npm` ani `node` — doinstaluj Node.js i otwórz terminal od nowa.
- `npm run dev` pisze, że port `8080` jest zajęty — zamknij drugi serwer, który go trzyma, i odpal komendę jeszcze raz.
- Strona jest pusta albo nie ma dźwięku — odśwież kartę i włącz **Sieć**. Nocne stacje szumią bez internetu. Polskie Radio milczy, gdy strumień nie dojdzie.

