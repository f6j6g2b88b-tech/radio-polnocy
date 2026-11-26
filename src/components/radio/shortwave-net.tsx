import { useCallback, useEffect, useRef, useState } from "react";
import { P2PRoom, type PeerInfo, type SignalingStatus } from "@/lib/multiplayer";
import { peekEngine } from "@/lib/radio/audio";
import { MicrophoneCapture } from "@/lib/radio/microphone";
import { normalizeSign, waveChannel } from "@/lib/radio/shortwave-controls";

function peerId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `p${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function ShortwaveNet({
  on,
  freq,
  sign,
  onSign,
  onFreq,
  onLive,
}: {
  on: boolean;
  freq: number;
  sign: string;
  onSign: (sign: string) => void;
  onFreq: (freq: number) => void;
  onLive: (hot: boolean) => void;
}) {
  const channel = waveChannel(freq);
  const [settled, setSettled] = useState(channel);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [remoteTx, setRemoteTx] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [micError, setMicError] = useState("");
  const [signaling, setSignaling] = useState<SignalingStatus>("connecting");
  const [registered, setRegistered] = useState(false);
  const [microphone] = useState(
    () =>
      new MicrophoneCapture(async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Ta przeglądarka nie udostępnia mikrofonu. Otwórz stronę przez HTTPS.");
        }
        return navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
          video: false,
        });
      }),
  );
  const roomRef = useRef<P2PRoom | null>(null);
  const sendingRef = useRef(false);
  const requestingRef = useRef(false);
  const requestId = useRef(0);
  const removeTrackListener = useRef<(() => void) | null>(null);
  const hearingRef = useRef(false);
  const editingFreq = useRef(false);
  const signRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => String(Math.round(freq)));

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(channel), 450);
    return () => window.clearTimeout(timer);
  }, [channel]);

  const ready = on && sign.length === 4;
  const joined = ready && settled === channel;
  const scope = joined ? `sw${settled}${sign}` : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const release = useCallback(
    (room = roomRef.current) => {
      ++requestId.current;
      requestingRef.current = false;
      sendingRef.current = false;
      removeTrackListener.current?.();
      removeTrackListener.current = null;
      microphone.release();
      room?.setMic(null);
      room?.send({ tx: false });
      setRequesting(false);
      setSending(false);
      peekEngine()?.setNet(hearingRef.current, true);
    },
    [microphone],
  );

  useEffect(() => {
    setPeers([]);
    setRemoteTx(new Set());
    setRegistered(false);
    setSignaling("connecting");
    setMicError("");
    if (!scope) return;
    const mouths = new Set<string>();
    const isCurrent = () => roomRef.current === room && scopeRef.current === scope;
    const room = new P2PRoom({
      room: scope,
      // A new room session needs a fresh inbox: old SDP and a delayed leave
      // must never be mistaken for the new connection after an off/on cycle.
      selfId: peerId(),
      name: sign,
      onConnected: () => {
        if (isCurrent()) setRegistered(true);
      },
      onSignalingStatus: (next) => {
        if (isCurrent()) setSignaling(next);
      },
      onPeerReady: (id) => {
        // A correspondent may arrive after we have already switched TX on.
        if (isCurrent()) room.send({ tx: sendingRef.current }, id);
      },
      onMicError: () => {
        if (!isCurrent()) return;
        release(room);
        setMicError("Nie udało się wysłać dźwięku. Stuknij Nadawanie, aby spróbować ponownie.");
      },
      onPeersChanged: (next) => {
        if (!isCurrent()) return;
        setPeers(next);
        const alive = new Set(next.map((peer) => peer.id));
        setRemoteTx((current) => {
          const kept = new Set([...current].filter((id) => alive.has(id)));
          return kept.size === current.size ? current : kept;
        });
      },
      onMessage: (from, data) => {
        if (!isCurrent()) return;
        const tx = Boolean(
          data && typeof data === "object" && "tx" in data && (data as { tx?: boolean }).tx,
        );
        setRemoteTx((current) => {
          const next = new Set(current);
          if (tx) next.add(from);
          else next.delete(from);
          return next.size === current.size && [...next].every((id) => current.has(id))
            ? current
            : next;
        });
      },
      onAudio: (from, stream) => {
        if (!isCurrent()) return;
        mouths.add(from);
        peekEngine()?.attachMouth(from, stream);
      },
      onAudioGone: (from) => {
        if (!isCurrent()) return;
        mouths.delete(from);
        peekEngine()?.detachMouth(from);
        setRemoteTx((current) => {
          if (!current.has(from)) return current;
          const next = new Set(current);
          next.delete(from);
          return next;
        });
      },
    });
    roomRef.current = room;
    void room.join().catch(() => {
      if (isCurrent()) setSignaling("retrying");
    });
    return () => {
      release(room);
      for (const id of mouths) peekEngine()?.detachMouth(id);
      mouths.clear();
      if (roomRef.current === room) roomRef.current = null;
      room.close();
      peekEngine()?.setNet(false, true);
    };
  }, [scope, sign, release]);

  useEffect(() => {
    if (!editingFreq.current) setDraft(String(Math.round(freq)));
  }, [freq]);

  function commitFreq() {
    editingFreq.current = false;
    const text = draft.replace(",", ".").trim();
    const parsed = Number(text);
    if (!text || !Number.isFinite(parsed)) {
      setDraft(String(Math.round(freq)));
      return;
    }
    const next = waveChannel(parsed);
    onFreq(next);
    setDraft(String(next));
  }

  const hearing =
    joined && peers.some((peer) => peer.connectionState === "connected" && remoteTx.has(peer.id));
  hearingRef.current = hearing;
  const hot = joined && (hearing || sending);

  useEffect(() => {
    onLive(hot);
    peekEngine()?.setNet(hot, !sending);
  }, [hot, sending, onLive]);

  useEffect(() => {
    return () => {
      onLive(false);
      peekEngine()?.setNet(false, true);
    };
  }, [onLive]);

  const connected = peers.filter((peer) => peer.connectionState === "connected").length;
  const failed = peers.filter(
    (peer) => peer.connectionState === "failed" || peer.recoveryExhausted,
  ).length;
  const others = Math.max(0, peers.length);

  let status = "Włącz sieć, wejdź na KR i umówcie znak.";
  if (!on) status = "Włącz sieć. Potem oboje wchodzicie na tę samą falę.";
  else if (sign.length < 4) status = "Cztery znaki, te same u was obojga. Inaczej fala jest pusta.";
  else if (!joined) status = `Dostrajam falę ${channel}.`;
  else if (!registered && signaling === "retrying")
    status = "Nie mogę połączyć się z serwerem rozmów. Ponawiam połączenie…";
  else if (!registered) status = `Łączę z falą ${settled}…`;
  else if (requesting) status = "Czekam na zgodę na mikrofon. Możesz anulować przyciskiem poniżej.";
  else if (failed > 0 && connected === 0)
    status = "Połączenie głosowe nie doszło. Wyłącz i włącz Sieć, aby spróbować ponownie.";
  else if (sending && connected === 0)
    status = `Mikrofon włączony na ${settled}. Czekam na połączenie z korespondentem.`;
  else if (sending) status = `Nadaję na ${settled}.`;
  else if (hearing) status = `Ktoś nadaje na ${settled}.`;
  else if (connected > 0) status = `Na fali ${settled}. Korespondentów: ${connected}.`;
  else if (signaling === "retrying")
    status = "Utraciłem kontakt z serwerem rozmów. Ponawiam połączenie…";
  else if (others > 0) status = `Szukam korespondenta na ${settled}…`;
  else status = `Fala ${settled} jest pusta. Czekam.`;

  async function toggle() {
    if (requestingRef.current || sendingRef.current) {
      release();
      return;
    }
    if (!on) return;
    if (sign.length < 4) {
      signRef.current?.focus();
      return;
    }
    const room = roomRef.current;
    if (!joined || !registered || !room || scope !== scopeRef.current) return;
    const attempt = ++requestId.current;
    requestingRef.current = true;
    setRequesting(true);
    setMicError("");
    peekEngine()?.resume();
    try {
      const track = await microphone.acquire();
      if (attempt !== requestId.current || !track) return;
      if (roomRef.current !== room || scopeRef.current !== scope) {
        release(room);
        return;
      }
      const onEnded = () => {
        if (attempt !== requestId.current) return;
        release(room);
        setMicError("Mikrofon został odłączony. Stuknij Nadawanie, aby spróbować ponownie.");
      };
      track.addEventListener("ended", onEnded, { once: true });
      removeTrackListener.current = () => track.removeEventListener("ended", onEnded);
      requestingRef.current = false;
      sendingRef.current = true;
      setRequesting(false);
      setSending(true);
      peekEngine()?.setNet(true, false);
      room.setMic(track);
      room.send({ tx: true });
    } catch (error) {
      if (attempt !== requestId.current) return;
      release(room);
      const unavailable = error instanceof Error && error.message.includes("HTTPS");
      setMicError(
        unavailable
          ? error.message
          : "Przeglądarka nie dała mikrofonu. Zezwól na niego i stuknij jeszcze raz.",
      );
    }
  }

  return (
    <div className="net" data-testid="net" data-signaling={signaling}>
      <div className="net-fields">
        <label className="net-sign">
          <span>Znak</span>
          <input
            value={sign}
            maxLength={4}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Wspólny znak, cztery znaki"
            placeholder="····"
            ref={signRef}
            onChange={(event) => onSign(normalizeSign(event.target.value))}
          />
        </label>
        <label className="net-sign">
          <span>Fala, kHz</span>
          <input
            value={draft}
            inputMode="numeric"
            autoComplete="off"
            aria-label="Częstotliwość w kilohercach"
            data-testid="freq-entry"
            onFocus={() => {
              editingFreq.current = true;
            }}
            onChange={(event) => setDraft(event.target.value.replace(/[^\d,.]/g, "").slice(0, 5))}
            onBlur={commitFreq}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              commitFreq();
              event.currentTarget.blur();
            }}
          />
        </label>
      </div>
      <p className="net-status" data-testid="net-status" role="status">
        {status}
      </p>
      <button
        type="button"
        className={sending ? "net-ptt is-live" : "net-ptt"}
        data-testid="ptt"
        data-tx={sending ? "on" : "off"}
        data-microphone={requesting ? "requesting" : sending ? "active" : "off"}
        disabled={!on || (!sending && !requesting && sign.length === 4 && (!joined || !registered))}
        aria-pressed={sending}
        aria-describedby="radio-ptt-help"
        onClick={(event) => {
          event.preventDefault();
          void toggle();
        }}
      >
        {requesting ? "Anuluj mikrofon" : sending ? "Zakończ nadawanie" : "Nadawanie"}
      </button>
      <p className="net-status" id="radio-ptt-help">
        Stuknij Nadawanie, aby włączyć mikrofon. Stuknij ponownie, aby zakończyć.
      </p>
      {micError ? <p className="net-status">{micError}</p> : null}
    </div>
  );
}
