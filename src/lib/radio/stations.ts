export type BandId = "fm" | "sw" | "pl";

export type VoiceId =
  | "lighthouse"
  | "train"
  | "library"
  | "kitchen"
  | "observatory"
  | "sea"
  | "post"
  | "glass"
  | "dream"
  | "numbers"
  | "cellar"
  | "harbor"
  | "broadcast";

export type Station = {
  id: string;
  band: BandId;
  freq: number;
  name: string;
  sign: string;
  voice: VoiceId;
  stream?: string;
  lines: string[];
};

export const STATIONS: Station[] = [
  {
    id: "latarnia",
    band: "fm",
    freq: 88.6,
    name: "Latarnia",
    sign: "LN-4",
    voice: "lighthouse",
    lines: [
      "Mgła na trzy mile. Światło chodzi, choć nikt nie prosił.",
      "Jeśli mnie słyszysz, zostań na kanale. Tu jest cieplej niż na zewnątrz.",
      "Morze oddało dziś but i list. But był lewy. List był do ciebie, ale bez imienia.",
    ],
  },
  {
    id: "ekspres",
    band: "fm",
    freq: 92.3,
    name: "Nocny ekspres",
    sign: "NX-7",
    voice: "train",
    lines: [
      "Następna stacja: nigdzie. Opóźnienie: cała noc.",
      "Wagon siódmy jest pusty i ma zapalone światło nad jednym siedzeniem.",
      "Konduktor prosi, żeby nie budzić pasażera, który śni o peronie.",
    ],
  },
  {
    id: "biblioteka",
    band: "fm",
    freq: 96.1,
    name: "Biblioteka ciszy",
    sign: "BC-14",
    voice: "library",
    lines: [
      "Proszę o zwrot tomu, którego pan nie wypożyczał.",
      "Sygnatura: sen/14/morze. Atrament jeszcze nie wyschnął, a książka jest zamknięta od lat.",
      "W czytelni ktoś przewraca strony tak cicho, że słychać tylko przecinki.",
    ],
  },
  {
    id: "kuchnia",
    band: "fm",
    freq: 99.7,
    name: "Kuchnia o trzeciej",
    sign: "KU-3",
    voice: "kitchen",
    lines: [
      "Zostawiłam herbatę na parapecie. Księżyc ją posłodził.",
      "Jeśli wrócisz, talerz jest tam gdzie zawsze: drugi od lewej, ten z pęknięciem.",
      "Nie rozmrażaj chleba. On pamięta wczoraj lepiej niż my.",
    ],
  },
  {
    id: "obserwatorium",
    band: "fm",
    freq: 103.4,
    name: "Obserwatorium",
    sign: "OB-18",
    voice: "observatory",
    lines: [
      "Gwiazda numer 4418 nie stawiła się na apel.",
      "Zapisuję jej nieobecność ołówkiem, żeby niebo mogło zmienić zdanie.",
      "Jeśli ją widzisz, nie wołaj głośno. Gwiazdy płoszą się od imion.",
    ],
  },
  {
    id: "morze",
    band: "fm",
    freq: 106.9,
    name: "Morze wewnętrzne",
    sign: "MW-0",
    voice: "sea",
    lines: [
      "W pokoju na końcu korytarza jest przypływ.",
      "Nie otwieraj okna. Ryby mylą firankę z siecią.",
      "Głębokość przy progu: do kostek. Głębokość przy łóżku: do snu.",
    ],
  },
  {
    id: "poczta",
    band: "sw",
    freq: 3480,
    name: "Poczta niewysłana",
    sign: "PN-00",
    voice: "post",
    lines: [
      "List bez znaczka. Data: jutro.",
      "„Byłem w drodze i droga też była w drodze.”",
      "Reszta rozmyła się od deszczu, który spadł dopiero w kopercie.",
    ],
  },
  {
    id: "szklarnia",
    band: "sw",
    freq: 5120,
    name: "Szklarnia",
    sign: "SZ-4",
    voice: "glass",
    lines: [
      "Paprocie proszą o mniej księżyca.",
      "Pomidor numer cztery zakwitł w stronę radia, nie słońca.",
      "Podlewam je szeptem. Woda o tej porze jest za głośna.",
    ],
  },
  {
    id: "archiwum",
    band: "sw",
    freq: 6890,
    name: "Archiwum snów",
    sign: "AS-1",
    voice: "dream",
    lines: [
      "Sen złożony bez tytułu. Nadawca nieznany. Czas trwania: jedna klatka schodowa.",
      "W środku jest klucz, który pasuje do drzwi, których jeszcze nie ma.",
      "Prosimy nie budzić depozytu.",
    ],
  },
  {
    id: "nosna",
    band: "sw",
    freq: 8460,
    name: "Nośna",
    sign: "NN-60",
    voice: "numbers",
    lines: [
      "4 1 9    ·    0 2 8    ·    7 7 1",
      "5 0 3    ·    6 6 4    ·    1 2 0",
      "Koniec grup. Powtarzam dla kogoś, kto śpi z radiem pod poduszką.",
      "Jeśli to ty — cyfra, której brakuje, jest twoja.",
    ],
  },
  {
    id: "piwnica",
    band: "sw",
    freq: 10040,
    name: "Piwnica z anteną",
    sign: "PW-2",
    voice: "cellar",
    lines: [
      "Tu na dole odbiór jest czystszy, bo ziemia trzyma szum za rękę.",
      "Zostawiam światło w korytarzu. Żarówka mruga w tempie twojego oddechu.",
      "Możesz zejść. Schody liczą się same.",
    ],
  },
  {
    id: "port",
    band: "sw",
    freq: 11580,
    name: "Port kieszonkowy",
    sign: "HK-9",
    voice: "harbor",
    lines: [
      "Cumujemy przy kieszeni płaszcza.",
      "Statek jest mały, ale fala w kieszeni jest prawdziwa.",
      "Odpłyń przed świtem. Rano port wygląda jak zwykła nitka.",
    ],
  },
  {
    id: "dwojka",
    band: "pl",
    freq: 89.1,
    name: "Dwójka",
    sign: "PR2",
    voice: "broadcast",
    stream: "https://stream12.polskieradio.pl/pr2/pr2.sdp/playlist.m3u8",
    lines: [
      "Program Drugi Polskiego Radia. Prawdziwa audycja, ściągana z internetu.",
      "Muzyka i kultura dzieją się teraz. To nie jest depesza.",
      "Jak sygnał siądzie czysto, szum zejdzie i zostanie ich antena.",
    ],
  },
  {
    id: "trojka",
    band: "pl",
    freq: 92.6,
    name: "Trójka",
    sign: "PR3",
    voice: "broadcast",
    stream: "https://stream13.polskieradio.pl/pr3/pr3.sdp/playlist.m3u8",
    lines: [
      "Program Trzeci Polskiego Radia, na żywo.",
      "Telefon nie jest anteną. Odtwarza ich strumień.",
      "Zostaw skalę, jeśli słychać ludzi, nie szum.",
    ],
  },
  {
    id: "czworka",
    band: "pl",
    freq: 96.1,
    name: "Czwórka",
    sign: "PR4",
    voice: "broadcast",
    stream: "https://stream14.polskieradio.pl/pr4/pr4.sdp/playlist.m3u8",
    lines: [
      "Czwórka Polskiego Radia. Młodsza antena, ten sam kraj.",
      "To jest transmisja z sieci, nie głos złożony w telefonie.",
      "Między piosenkami czasem wpadają wiadomości.",
    ],
  },
  {
    id: "pr24",
    band: "pl",
    freq: 99.4,
    name: "Polskie Radio 24",
    sign: "PR24",
    voice: "broadcast",
    stream: "https://stream15.polskieradio.pl/pr24/pr24.sdp/playlist.m3u8",
    lines: [
      "Polskie Radio 24. Wiadomości, bez przerwy na depeszę.",
      "Jak złapiesz czysto, mówią ludzie z redakcji, nie z kartki.",
      "Sygnał idzie z ich serwera. Fala z powietrza tu nie dociera.",
    ],
  },
  {
    id: "dzieciom",
    band: "pl",
    freq: 102.5,
    name: "Radio Dzieciom",
    sign: "RD",
    voice: "broadcast",
    stream: "https://stream85.polskieradio.pl/live/radio_dzieciom.sdp/playlist.m3u8",
    lines: [
      "Radio Dzieciom. Polskie Radio dla młodszych uszu.",
      "Słuchowiska i piosenki lecą na żywo ze strumienia.",
      "To osobna antena, nie nocna stacja z dziennika.",
    ],
  },
  {
    id: "kierowcy",
    band: "pl",
    freq: 105.6,
    name: "Radio Kierowców",
    sign: "RK",
    voice: "broadcast",
    stream: "https://stream10.polskieradio.pl/prk/rdk.sdp/playlist.m3u8",
    lines: [
      "Radio Kierowców. Droga, pogoda, ruch.",
      "Audycja jest prawdziwa. Skala tylko pomaga ją znaleźć.",
      "Zatrzymaj się na częstotliwości, resztę zrobi strumień.",
    ],
  },
];

export function stationById(id: string): Station | null {
  return STATIONS.find((station) => station.id === id) ?? null;
}
