/** Owns microphone capture across permission prompts, cancellation and retries. */
export class MicrophoneCapture {
  private readonly request: () => Promise<MediaStream>;
  private generation = 0;
  private stream: MediaStream | null = null;
  private pending: Promise<MediaStream> | null = null;

  constructor(request: () => Promise<MediaStream>) {
    this.request = request;
  }

  async acquire(): Promise<MediaStreamTrack | null> {
    const generation = ++this.generation;
    this.stopStream();

    // getUserMedia cannot be aborted. If a cancelled prompt is still open,
    // wait for its cleanup rather than opening a second capture concurrently.
    if (this.pending) {
      try {
        await this.pending;
      } catch {
        // The previous request reports its own error, if it is still current.
      }
    }
    if (generation !== this.generation) return null;

    const pending = this.request();
    this.pending = pending;
    try {
      const stream = await pending;
      if (generation !== this.generation) {
        for (const track of stream.getTracks()) track.stop();
        return null;
      }
      const track = stream.getAudioTracks().find((item) => item.readyState === "live");
      if (!track) {
        for (const item of stream.getTracks()) item.stop();
        throw new Error("Mikrofon nie udostępnił aktywnej ścieżki dźwięku.");
      }
      this.stream = stream;
      return track;
    } catch (error) {
      // A permission denial arriving after power-off/cancellation is stale.
      if (generation !== this.generation) return null;
      throw error;
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  release(): void {
    ++this.generation;
    this.stopStream();
  }

  private stopStream(): void {
    const stream = this.stream;
    this.stream = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
  }
}
