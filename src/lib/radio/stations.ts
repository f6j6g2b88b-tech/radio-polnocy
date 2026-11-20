export type BandId = "fm" | "sw";

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
  | "harbor";

export type Station = {
  id: string;
  band: BandId;
  freq: number;
  name: string;
  sign: string;
  voice: VoiceId;
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
];

export function stationById(id: string): Station | null {
  return STATIONS.find((station) => station.id === id) ?? null;
}
