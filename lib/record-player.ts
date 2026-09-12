export type PlaybackState = 'paused' | 'loading' | 'playing' | 'error';

export interface RecordAudio {
  src: string;
  preload: string;
  volume: number;
  paused: boolean;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** Owns user intent separately from delayed media promises and native events. */
export class RecordTransport {
  private wanted = false;
  private generation = 0;
  private disposed = false;
  private readonly listeners: Record<string, () => void>;

  constructor(
    private readonly audio: RecordAudio,
    private readonly report: (state: PlaybackState) => void,
    private readonly onEnd: () => void,
  ) {
    audio.preload = 'none';
    audio.volume = 0.35;
    this.listeners = {
      playing: () => {
        if (!this.wanted || this.disposed) audio.pause();
        else report('playing');
      },
      waiting: () => {
        if (this.wanted && !this.disposed) report('loading');
      },
      pause: () => {
        // A queued pause from changing source must not cancel a newer play.
        if (audio.paused && !this.disposed) {
          this.wanted = false;
          this.generation++;
          report('paused');
        }
      },
      ended: () => {
        if (this.wanted && !this.disposed) {
          this.wanted = false;
          this.generation++;
          report('paused');
          onEnd();
        }
      },
      error: () => {
        if (this.wanted && !this.disposed) {
          this.wanted = false;
          this.generation++;
          report('error');
        }
      },
    };
    Object.entries(this.listeners).forEach(([event, listener]) =>
      audio.addEventListener(event, listener),
    );
  }

  get wantsPlayback(): boolean {
    return this.wanted;
  }

  select(src: string, play = false): void {
    if (this.disposed) return;
    this.pause();
    this.audio.src = src;
    // Changing src is sufficient; preload=none avoids loading all tracks.
    if (play) void this.play();
  }

  async play(): Promise<void> {
    if (this.disposed || (this.wanted && !this.audio.paused)) return;
    const generation = ++this.generation;
    this.wanted = true;
    this.report('loading');
    try {
      await this.audio.play();
      if (this.disposed || (!this.wanted && generation !== this.generation))
        this.audio.pause();
      // The actual `playing` event, not this promise, starts the animation.
    } catch {
      if (generation === this.generation && !this.disposed) {
        this.wanted = false;
        this.report('error');
      }
    }
  }

  pause(): void {
    this.wanted = false;
    this.generation++;
    this.audio.pause();
    if (!this.disposed) this.report('paused');
  }

  setVolume(volume: number): void {
    this.audio.volume = Math.min(1, Math.max(0, volume));
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    Object.entries(this.listeners).forEach(([event, listener]) =>
      this.audio.removeEventListener(event, listener),
    );
    this.audio.src = '';
    this.audio.load();
  }
}

/** A horizontal flick turns the record; a vertical gesture belongs to the page. */
export function isRecordFlick(dx: number, dy: number): boolean {
  return Math.abs(dx) >= 22 && Math.abs(dx) > Math.abs(dy) * 1.3;
}

export function recordLibraryLayout(
  anchorBottom: number,
  viewportTop: number,
  visibleBottom: number,
) {
  const docked = visibleBottom - anchorBottom - 22 < 220;
  const top = docked ? viewportTop + 12 : anchorBottom + 10;
  return { docked, top, maxHeight: Math.max(100, visibleBottom - top - 12) };
}
