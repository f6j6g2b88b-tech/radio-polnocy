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

## Uruchomienie

```bash
npm install
npm run dev
```

Odbiornik wstaje na [http://127.0.0.1:8080](http://127.0.0.1:8080). Dźwięk startuje po włączeniu sieci, bo przeglądarka sama nie puszcza audio.
