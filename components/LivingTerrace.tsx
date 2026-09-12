'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Disc3,
  Flame,
  Globe2,
  ScanSearch,
  Settings2,
} from 'lucide-react';
import type {
  SceneController,
  TerraceDestination,
} from '@/lib/terrace/plates/stage';
import './terrace-shell.css';
import './LivingTerrace.css';

const destinations = [
  { id: 'journal', label: 'Journal', icon: BookOpen },
  { id: 'atlas', label: 'Atlas', icon: Globe2 },
  { id: 'identify', label: 'Add a cigar', icon: ScanSearch },
  { id: 'records', label: 'Records', icon: Disc3 },
] as const;

/** A horizontal flick on the record player: at least this far, within this time. */
export const RECORD_FLICK = { distance: 40, milliseconds: 600 };

export function LivingTerrace({
  theme = '/plates/terrace/',
  canAdd,
  musicOpen = false,
  playing = false,
  trackTitle,
  active = true,
  onOpen,
  onFlickRecords,
  onSettings,
}: {
  /** Which room to load: a folder holding a manifest and its painted plates. */
  theme?: string;
  /** Kept for callers that still pass it; the terrace no longer letters a plaque. */
  establishedLabel?: string;
  canAdd: boolean;
  musicOpen?: boolean;
  playing?: boolean;
  /** The record on the turntable; shown as the records caption while playing. */
  trackTitle?: string;
  active?: boolean;
  onOpen: (destination: TerraceDestination) => void;
  /** A sideways flick on the record player toggles playback without opening it. */
  onFlickRecords?: () => void;
  onSettings: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const buttons = useRef<
    Partial<Record<TerraceDestination, HTMLButtonElement>>
  >({});
  const controller = useRef<SceneController | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  );
  // Motion follows the OS reduced-motion setting only.
  const [motion, setMotion] = useState(true);
  const [retry, setRetry] = useState(0);
  const live = useRef({ motion, playing, active });
  useEffect(() => {
    live.current = { motion, playing, active };
  }, [motion, playing, active]);
  const flick = useRef<{ id: number; x: number; y: number; at: number } | null>(
    null,
  );
  const swallowClick = useRef(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preference = () => setMotion(!media.matches);
    preference();
    media.addEventListener('change', preference);
    return () => media.removeEventListener('change', preference);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let failed = false;
    let owned: SceneController | null = null;
    const release = () => {
      const instance = owned;
      owned = null;
      if (controller.current === instance) controller.current = null;
      instance?.dispose();
    };
    const fail = () => {
      if (cancelled || failed) return;
      failed = true;
      release();
      setStatus('unavailable');
    };
    // The painted-plates stage is a manifest-driven theme player; the terrace
    // is its first theme. The former lit 3D renderer stays in lib/terrace.
    void import('@/lib/terrace/plates/stage')
      .then(({ createPlatesRenderer }) => {
        if (cancelled || !host.current) return;
        try {
          const instance = createPlatesRenderer({
            host: host.current,
            buttons: buttons.current,
            theme,
            canvasClass: 'living-terrace-canvas',
            ...live.current,
            onReady: () => {
              if (!cancelled && !failed) setStatus('ready');
            },
            onFailure: fail,
          });
          if (cancelled || failed) {
            instance.dispose();
            return;
          }
          owned = instance;
          controller.current = instance;
        } catch {
          fail();
        }
      })
      .catch(fail);
    return () => {
      cancelled = true;
      release();
    };
  }, [retry, theme]);

  useEffect(() => controller.current?.setMotion(motion), [motion]);
  useEffect(
    () => controller.current?.setPlaying(playing, trackTitle),
    [playing, trackTitle],
  );
  useEffect(() => controller.current?.setActive(active), [active]);

  function open(destination: TerraceDestination) {
    if (destination === 'identify' && !canAdd) return;
    if (controller.current && status === 'ready')
      controller.current.enter(destination, () => onOpen(destination));
    else onOpen(destination);
  }

  return (
    <section
      className="living-terrace"
      aria-label="Ember living terrace"
      data-status={status}
      data-music-open={musicOpen}
    >
      <div className="living-terrace-renderer" ref={host} />
      <div className="living-terrace-print" aria-hidden="true" />
      <header className="living-terrace-masthead">
        <h1>
          ember
          <Flame size={19} fill="currentColor" aria-hidden="true" />
        </h1>
        <span>Good taste.</span>
      </header>
      <div
        className="living-terrace-objects"
        aria-label="Objects on your table"
      >
        {destinations.map(({ id, label }) => (
          <button
            key={id}
            ref={(element) => {
              if (element) buttons.current[id] = element;
              else delete buttons.current[id];
            }}
            className={`living-object living-object-${id}`}
            type="button"
            aria-label={
              id === 'records' && playing && trackTitle
                ? `Records, playing ${trackTitle}`
                : label
            }
            disabled={id === 'identify' && !canAdd}
            onPointerDown={
              id === 'records'
                ? (event) => {
                    if (!event.isPrimary || event.button !== 0) return;
                    // Captured on the button, so the swipe never leans the camera.
                    event.currentTarget.setPointerCapture(event.pointerId);
                    flick.current = {
                      id: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                      at: event.timeStamp,
                    };
                    swallowClick.current = false;
                  }
                : undefined
            }
            onPointerUp={
              id === 'records'
                ? (event) => {
                    const start = flick.current;
                    flick.current = null;
                    if (!start || start.id !== event.pointerId) return;
                    const dx = event.clientX - start.x;
                    const dy = event.clientY - start.y;
                    const quick =
                      event.timeStamp - start.at < RECORD_FLICK.milliseconds;
                    if (
                      quick &&
                      Math.abs(dx) >= RECORD_FLICK.distance &&
                      Math.abs(dx) > Math.abs(dy)
                    ) {
                      // A user gesture: toggling playback here is allowed.
                      swallowClick.current = true;
                      onFlickRecords?.();
                    }
                  }
                : undefined
            }
            onPointerCancel={
              id === 'records'
                ? () => {
                    flick.current = null;
                  }
                : undefined
            }
            onClick={() => {
              if (id === 'records' && swallowClick.current) {
                swallowClick.current = false;
                return;
              }
              open(id);
            }}
          >
            <span>
              {id === 'records' && playing && trackTitle ? trackTitle : label}
            </span>
          </button>
        ))}
      </div>
      {status === 'loading' && (
        <output className="living-terrace-message">Opening the terrace…</output>
      )}
      {status === 'unavailable' && (
        <output className="living-terrace-unavailable">
          <p>The 3D view couldn’t open. Your journal is still here.</p>
          <button
            type="button"
            onClick={() => {
              setStatus('loading');
              setRetry((value) => value + 1);
            }}
          >
            Try the terrace again
          </button>
        </output>
      )}
      <footer className="living-terrace-footer">
        <nav aria-label="Terrace shortcuts">
          {destinations.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-label={`Open ${label.toLowerCase()}`}
              disabled={id === 'identify' && !canAdd}
              onClick={() => open(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
          <button type="button" aria-label="Settings" onClick={onSettings}>
            <Settings2 size={18} />
            <span>Settings</span>
          </button>
        </nav>
      </footer>
    </section>
  );
}
