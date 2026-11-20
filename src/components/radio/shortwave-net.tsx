import { useEffect, useRef, useState, type PointerEvent } from "react";
import { P2PRoom, type PeerInfo } from "@/lib/multiplayer";
import { peekEngine } from "@/lib/radio/audio";
import { clampFreq } from "@/lib/radio/tuning";

export function waveChannel(freq: number) {
  return Math.round(clampFreq("sw", freq) / 10) * 10;
}

export function normalizeSign(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

function peerId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `p${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function ShortwaveNet({
  on,
  freq,
  sign,
  onSign,
  onLive,
}: {
  on: boolean;
  freq: number;
  sign: string;
  onSign: (sign: string) => void;
  onLive: (hot: boolean) => void;
}) {
  const channel = waveChannel(freq);
  const [settled, setSettled] = useState(channel);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [remoteTx, setRemoteTx] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [micError, setMicError] = useState("");
  const selfId = useRef(peerId());
  const roomRef = useRef<P2PRoom | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(channel), 450);
    return () => window.clearTimeout(timer);
  }, [channel]);

  const ready = on && sign.length === 4;
  const joined = ready && settled === channel;

  useEffect(() => {
    if (!ready) {
      setPeers([]);
      setRemoteTx(new Set());
      return;
    }
    const room = new P2PRoom({
      room: `sw${settled}${sign}`,
      selfId: selfId.current,
      name: sign,
      onPeersChanged: (next) => {
        setPeers(next);
        const alive = new Set(next.map((peer) => peer.id));
        setRemoteTx((current) => {
          const kept = new Set([...current].filter((id) => alive.has(id)));
          return kept.size === current.size ? current : kept;
        });
      },
      onMessage: (from, data) => {
        const tx = Boolean(data && typeof data === "object" && "tx" in data && (data as { tx?: boolean }).tx);
        setRemoteTx((current) => {
          const next = new Set(current);
          if (tx) next.add(from);
          else next.delete(from);
          return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next;
        });
      },
      onAudio: (from, stream) => {
        peekEngine()?.attachMouth(from, stream);
      },
      onAudioGone: (from) => {
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
    void room.join();
    return () => {
      room.close();
      if (roomRef.current === room) roomRef.current = null;
      peekEngine()?.setNet(false, true);
    };
  }, [ready, settled, sign]);

  useEffect(() => {
    return () => {
      for (const track of micRef.current?.getTracks() ?? []) track.stop();
      micRef.current = null;
    };
  }, []);

  const hearing = remoteTx.size > 0;
  const hot = hearing || sending;

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
  const failed = peers.filter((peer) => peer.connectionState === "failed").length;
  const others = Math.max(0, peers.length);

  let status = "Włącz sieć, wejdź na KR i umówcie znak.";
  if (!on) status = "Włącz sieć. Potem oboje wchodzicie na tę samą falę.";
  else if (sign.length < 4) status = "Cztery znaki, te same u was obojga. Inaczej fala jest pusta.";
  else if (!joined) status = `Dostrajam falę ${channel}.`;
  else if (failed > 0 && connected === 0) status = "Nie dogadaliśmy się z tą siecią. Spróbujcie innej fali.";
  else if (hearing) status = `Ktoś nadaje na ${settled}.`;
  else if (connected > 0) status = `Na fali ${settled}. Korespondentów: ${connected}.`;
  else if (others > 0) status = `Szukam korespondenta na ${settled}…`;
  else status = `Fala ${settled} jest pusta. Czekam.`;

  async function begin(event: PointerEvent<HTMLButtonElement>) {
    if (!joined || connected === 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    sendingRef.current = true;
    setSending(true);
    setMicError("");
    try {
      if (!micRef.current) {
        micRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
          video: false,
        });
      }
      const track = micRef.current.getAudioTracks()[0];
      if (!track || !sendingRef.current) return;
      roomRef.current?.setMic(track);
      roomRef.current?.send({ tx: true });
    } catch {
      sendingRef.current = false;
      setSending(false);
      setMicError("Przeglądarka nie dała mikrofonu.");
    }
  }

  function end() {
    if (!sendingRef.current) return;
    sendingRef.current = false;
    setSending(false);
    roomRef.current?.send({ tx: false });
    roomRef.current?.setMic(null);
  }

  return (
    <div className="net" data-testid="net">
      <label className="net-sign">
        <span>Znak</span>
        <input
          value={sign}
          maxLength={4}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Wspólny znak, cztery znaki"
          placeholder="NORD"
          onChange={(event) => onSign(normalizeSign(event.target.value))}
        />
      </label>
      <p className="net-status" data-testid="net-status">
        {status}
      </p>
      <button
        type="button"
        className={sending ? "net-ptt is-live" : "net-ptt"}
        data-testid="ptt"
        disabled={!joined || connected === 0}
        aria-pressed={sending}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onBlur={end}
      >
        {sending ? "Nadaję" : "Nadawanie"}
      </button>
      {micError ? <p className="net-status">{micError}</p> : null}
    </div>
  );
}
