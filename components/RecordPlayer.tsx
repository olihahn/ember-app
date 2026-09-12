'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { ChevronDown, Pause, Play, SkipForward, Volume2 } from 'lucide-react';
import { isNative } from '@/lib/native-bridge';
import { isDevicePickerOpen } from '@/lib/mobile';
import {
  defaultTrackIndex,
  musicModificationNote,
  musicTracks,
} from '@/lib/music';
import {
  isRecordFlick,
  recordLibraryLayout,
  RecordTransport,
  type PlaybackState,
} from '@/lib/record-player';
import './RecordPlayer.css';

export function RecordPlayer({
  libraryOpen: open,
  onLibraryOpenChange: setOpen,
  presentation = 'standard',
  renderFrame,
  onPlayingChange,
  onTrackChange,
  onControls,
  transportInLibrary = false,
}: {
  libraryOpen: boolean;
  onLibraryOpenChange: (open: boolean) => void;
  presentation?: 'standard' | 'compact';
  /** Mount visible controls separately from the persistent audio transport. */
  renderFrame?: (controls: ReactNode) => ReactNode;
  onPlayingChange?: (playing: boolean) => void;
  onTrackChange?: (title: string) => void;
  /**
   * Hands out play/pause control for gestures elsewhere (a flick on the
   * terrace's record player). Callers must only invoke it from a user gesture.
   */
  onControls?: (controls: { toggle: () => void } | null) => void;
  /**
   * Show no standalone transport bar: a single play/title/next row lives
   * inside the record library instead (the terrace opens it from the scene).
   */
  transportInLibrary?: boolean;
}) {
  const [state, setState] = useState<PlaybackState>('paused');
  const [trackIndex, setTrackIndex] = useState(defaultTrackIndex);
  const [volume, setVolume] = useState(0.35);
  const transport = useRef<RecordTransport | null>(null);
  const indexRef = useRef(defaultTrackIndex);
  const playerRef = useRef<HTMLDivElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const libraryButtonRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const panelId = useId();
  const statusId = useId();
  const track = musicTracks[trackIndex];
  const playing = state === 'playing';
  const engaged = playing || state === 'loading';
  const compact = presentation === 'compact';

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);
  useEffect(() => {
    onTrackChange?.(track.title);
  }, [track.title, onTrackChange]);

  useEffect(() => {
    const audio = new Audio();
    // Each side ends quietly. Nothing starts on mount, return, or relaunch.
    const controls = new RecordTransport(audio, setState, () => {});
    controls.select(musicTracks[indexRef.current].src);
    transport.current = controls;
    // Leaving Ember pauses the record. Our own camera and gallery do not:
    // photographing the cigar in front of you is part of the same sitting.
    const pauseWhenHidden = () => {
      if (document.hidden && !isDevicePickerOpen()) controls.pause();
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    const nativeListener = isNative()
      ? NativeApp.addListener('appStateChange', ({ isActive }) => {
          if (!isActive && !isDevicePickerOpen()) controls.pause();
        })
      : null;
    return () => {
      document.removeEventListener('visibilitychange', pauseWhenHidden);
      void nativeListener?.then((listener) => listener.remove());
      controls.dispose();
      transport.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!playerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        libraryButtonRef.current?.focus();
      }
    };
    const fitLibrary = () => {
      const panel = libraryRef.current;
      const player = playerRef.current;
      if (!panel || !player) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const bottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const nav = document
        .querySelector<HTMLElement>('.mobile-bottom-nav')
        ?.getBoundingClientRect();
      const visibleBottom =
        nav && nav.height > 0 ? Math.min(bottom, nav.top) : bottom;
      const layout = recordLibraryLayout(
        player.getBoundingClientRect().bottom,
        viewportTop,
        visibleBottom,
      );
      panel.style.position = layout.docked ? 'fixed' : 'absolute';
      panel.style.top = layout.docked ? `${layout.top}px` : '100%';
      panel.style.right = layout.docked ? '20px' : '0';
      panel.style.marginTop = layout.docked ? '0' : '10px';
      panel.style.maxHeight = `${layout.maxHeight}px`;
    };
    fitLibrary();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', fitLibrary);
    window.addEventListener('scroll', fitLibrary, { passive: true });
    window.visualViewport?.addEventListener('resize', fitLibrary);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', fitLibrary);
      window.removeEventListener('scroll', fitLibrary);
      window.visualViewport?.removeEventListener('resize', fitLibrary);
    };
  }, [open, setOpen]);

  function togglePlayback() {
    if (transport.current?.wantsPlayback) transport.current.pause();
    else void transport.current?.play();
  }
  useEffect(() => {
    // The handle reads the transport ref at call time, so it never goes stale.
    onControls?.({
      toggle: () => {
        if (transport.current?.wantsPlayback) transport.current.pause();
        else void transport.current?.play();
      },
    });
    return () => onControls?.(null);
  }, [onControls]);

  function selectTrack(index: number, start: boolean) {
    indexRef.current = index;
    setTrackIndex(index);
    transport.current?.select(musicTracks[index].src, start);
  }

  // Only the visual object moves into the compact panel. The audio and its
  // lifecycle remain owned by this single, continuously mounted component.
  const turntable = (
    <div className="record-player-scene">
      <div className="record-player-plinth">
        <span className="record-player-maker" aria-hidden="true">
          EMBER · 33⅓
        </span>
        <button
          type="button"
          className="record-player-vinyl"
          aria-label={engaged ? 'Pause record' : 'Play record'}
          aria-describedby={statusId}
          aria-pressed={engaged}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            swallowClick.current = false;
            pointer.current = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            const start = pointer.current;
            pointer.current = null;
            if (!start || start.id !== event.pointerId) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
              swallowClick.current = true;
              if (isRecordFlick(dx, dy)) void transport.current?.play();
            }
          }}
          onPointerCancel={() => {
            pointer.current = null;
            swallowClick.current = true;
          }}
          onClick={(event) => {
            if (swallowClick.current && event.detail !== 0) {
              swallowClick.current = false;
              return;
            }
            swallowClick.current = false;
            togglePlayback();
          }}
        >
          <span className="record-player-disc" aria-hidden="true">
            <svg className="record-player-label" viewBox="0 0 100 100">
              <text className="record-player-label-brand" x="50" y="27">
                ember
              </text>
              <text className="record-player-label-side" x="50" y="83">
                {String.fromCharCode(65 + trackIndex)}
              </text>
              <circle className="record-player-spindle" cx="50" cy="50" r="6" />
            </svg>
          </span>
        </button>
        <span className="record-player-arm" aria-hidden="true">
          <i />
        </span>
        <span className="record-player-lamp" aria-hidden="true" />
      </div>
    </div>
  );

  const transportRow = (
    <div className="record-player-controls">
      <button
        type="button"
        onClick={togglePlayback}
        aria-label={engaged ? 'Pause music' : 'Play music'}
      >
        {engaged ? (
          <Pause size={15} fill="currentColor" />
        ) : (
          <Play size={15} fill="currentColor" />
        )}
      </button>
      <button
        type="button"
        className="record-player-title"
        ref={libraryButtonRef}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Choose a record and view music credits"
        onClick={() => setOpen(!open)}
      >
        <span>{compact && !engaged ? 'Records' : track.title}</span>
        <ChevronDown size={12} />
      </button>
      <button
        type="button"
        aria-label="Next record"
        onClick={() =>
          selectTrack(
            (indexRef.current + 1) % musicTracks.length,
            transport.current?.wantsPlayback ?? false,
          )
        }
      >
        <SkipForward size={15} />
      </button>
    </div>
  );

  const controls = (
    <div
      ref={playerRef}
      className={`record-player ${compact ? 'record-player--compact' : ''} ${transportInLibrary ? 'record-player--panel' : ''} ${playing ? 'is-playing' : ''} ${engaged ? 'is-engaged' : ''} ${state === 'error' ? 'is-error' : ''}`}
      aria-label="Ember record player"
    >
      {!compact && turntable}
      {!transportInLibrary && transportRow}
      <output id={statusId} className="record-player-status" aria-live="polite">
        {state === 'error'
          ? 'Couldn’t play. Tap to retry.'
          : state === 'loading'
            ? 'Needle down…'
            : playing
              ? 'Now playing · Kevin MacLeod'
              : compact && !open
                ? 'Choose a record or tap play.'
                : 'Swipe the record. Settle in.'}
      </output>
      {open && (
        <section
          ref={libraryRef}
          id={panelId}
          className="record-player-library"
          aria-label="Record collection"
        >
          <header>
            <span>On the turntable</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                libraryButtonRef.current?.focus();
              }}
            >
              Done
            </button>
          </header>
          {transportInLibrary && transportRow}
          {compact && (
            <>
              {turntable}
              <p className="record-player-current">
                <span>
                  {playing
                    ? 'Now playing'
                    : state === 'loading'
                      ? 'Needle down…'
                      : state === 'error'
                        ? 'Tap play to retry'
                        : 'Swipe or tap to play'}
                </span>
              </p>
            </>
          )}
          {musicTracks.map((record, index) => (
            <button
              type="button"
              key={record.id}
              className={`record-player-track ${index === trackIndex ? 'selected' : ''}`}
              aria-label={`Play ${record.title}`}
              aria-pressed={index === trackIndex && engaged}
              onClick={() => selectTrack(index, true)}
            >
              <span className="record-player-track-side">
                {String.fromCharCode(65 + index)}
              </span>
              <span>
                <strong>{record.title}</strong>
                {!compact && <small>{record.mood}</small>}
              </span>
              <Play size={14} />
            </button>
          ))}
          <label className="record-player-volume">
            <Volume2 size={17} />
            <span className="visually-hidden">Music volume</span>
            <input
              type="range"
              aria-label="Music volume"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(event) => {
                const value = Number(event.target.value);
                setVolume(value);
                transport.current?.setVolume(value);
              }}
            />
          </label>
          <details className="record-player-credits">
            <summary>Music credits</summary>
            <p>
              Copyright Kevin MacLeod (incompetech.com). These three recordings
              are licensed under{' '}
              <a href={track.licenseUrl} target="_blank" rel="noreferrer">
                Creative Commons Attribution 4.0
              </a>
              .
            </p>
            <ul>
              {musicTracks.map((record) => (
                <li key={record.id}>
                  <a href={record.sourceUrl} target="_blank" rel="noreferrer">
                    {record.title}
                  </a>
                </li>
              ))}
            </ul>
            <p>{musicModificationNote}</p>
          </details>
        </section>
      )}
    </div>
  );
  return renderFrame ? renderFrame(controls) : controls;
}
