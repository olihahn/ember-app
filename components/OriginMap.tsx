'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { geoGraticule10, geoOrthographic, geoPath } from 'd3-geo';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
import type { CigarEntry } from '@/lib/types';
import {
  INITIAL_GLOBE_ROTATION,
  classifyGlobeGesture,
  dragGlobeRotation,
  globePointDepth,
  interpolateGlobeRotation,
  isGlobePointVisible,
  keyboardGlobeRotation,
  rotationForGlobePoint,
} from '@/lib/globe-geometry';
import type { GlobeGesture, GlobeRotation } from '@/lib/globe-geometry';
import { globeCountries, groupGlobePins } from '@/lib/globe-pins';
import type { GlobePin } from '@/lib/globe-pins';
import './origin-globe.css';

const RADIUS = 218;
const CENTER: [number, number] = [280, 243];
const graticule = geoGraticule10();

interface DragState {
  pointerId: number;
  x: number;
  y: number;
  radius: number;
  start: GlobeRotation;
  gesture: GlobeGesture;
  touch: boolean;
}

export function OriginMap({
  entries,
  mode,
}: {
  entries: CigarEntry[];
  mode: 'origin' | 'purchase';
}) {
  const id = useId().replace(/:/g, '');
  const [rotation, setRotation] = useState<GlobeRotation>([
    ...INITIAL_GLOBE_ROTATION,
  ]);
  const [selected, setSelected] = useState<{
    mode: 'origin' | 'purchase';
    id: string;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const rotationRef = useRef(rotation);
  const animationRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const { pins, missing } = useMemo(
    () => groupGlobePins(entries, mode),
    [entries, mode],
  );
  const active =
    selected?.mode === mode
      ? pins.find((pin) => pin.id === selected.id)
      : undefined;
  const visited = useMemo(() => new Set(pins.map((pin) => pin.id)), [pins]);
  const projection = useMemo(
    () =>
      geoOrthographic()
        .translate(CENTER)
        .scale(RADIUS)
        .rotate(rotation)
        .clipAngle(90)
        .precision(0.6),
    [rotation],
  );
  const path = useMemo(() => geoPath(projection), [projection]);

  useEffect(
    () => () => {
      if (animationRef.current !== null)
        cancelAnimationFrame(animationRef.current);
    },
    [],
  );

  function stopAnimation() {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }
  function updateRotation(next: GlobeRotation) {
    rotationRef.current = next;
    setRotation(next);
  }
  function turnTo(next: GlobeRotation) {
    stopAnimation();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      updateRotation(next);
      return;
    }
    const start = rotationRef.current;
    let startedAt: number | undefined;
    function frame(now: number) {
      startedAt ??= now;
      const progress = Math.min(1, (now - startedAt) / 420);
      updateRotation(
        interpolateGlobeRotation(start, next, 1 - (1 - progress) ** 3),
      );
      animationRef.current = progress < 1 ? requestAnimationFrame(frame) : null;
    }
    animationRef.current = requestAnimationFrame(frame);
  }
  function selectPin(pin: GlobePin) {
    setSelected({ mode, id: pin.id });
    turnTo(rotationForGlobePoint(pin.coordinates));
  }
  function reset() {
    setSelected(null);
    turnTo([...INITIAL_GLOBE_ROTATION]);
  }
  function startDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    stopAnimation();
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      radius:
        (event.currentTarget.getBoundingClientRect().width / 560) * RADIUS,
      start: rotationRef.current,
      gesture: 'pending',
      touch: event.pointerType === 'touch',
    };
  }
  function moveDrag(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.gesture === 'pending') {
      drag.gesture = classifyGlobeGesture(dx, dy, drag.touch);
      if (drag.gesture === 'rotate') {
        event.currentTarget.setPointerCapture(event.pointerId);
        suppressClickRef.current = true;
        setDragging(true);
      }
    }
    if (drag.gesture !== 'rotate') return;
    event.preventDefault();
    updateRotation(dragGlobeRotation(drag.start, dx, dy, drag.radius));
  }
  function endDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div className="origin-map origin-globe">
      <div className="origin-globe-stage">
        <div className="origin-globe-annotation" aria-hidden="true">
          <span>Ember field atlas</span>
          <span>By origin. By memory.</span>
        </div>
        {/* oxlint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- A two-axis keyboard application, not a one-value slider. */}
        <svg
          className={`origin-globe-sphere${dragging ? ' is-turning' : ''}`}
          viewBox="0 0 560 522"
          role="application"
          tabIndex={0}
          aria-label={
            mode === 'origin'
              ? 'Turnable globe of cigar countries of origin'
              : 'Turnable globe of saved purchase places'
          }
          aria-describedby={`${id}-instructions`}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={(event) => {
            if (event.target === event.currentTarget) endDrag(event);
          }}
          onClickCapture={(event) => {
            if (suppressClickRef.current) {
              event.preventDefault();
              event.stopPropagation();
              suppressClickRef.current = false;
            }
          }}
          onKeyDown={(event) => {
            const next = keyboardGlobeRotation(rotationRef.current, event.key);
            if (!next) return;
            event.preventDefault();
            if (event.key === 'Home') reset();
            else {
              stopAnimation();
              updateRotation(next);
            }
          }}
        >
          <title>
            {mode === 'origin' ? 'Cigar origins' : 'Purchase places'}
          </title>
          <desc>
            Drag sideways to turn, or use the arrow keys. Home resets the globe.
            Every mapped place is also available in the list below.
          </desc>
          <defs>
            <radialGradient id={`${id}-ocean`} cx="31%" cy="22%" r="80%">
              <stop offset="0" stopColor="#3f8f97" />
              <stop offset="0.48" stopColor="#3f8f97" />
              <stop offset="1" stopColor="#3f8f97" />
            </radialGradient>
            <radialGradient id={`${id}-shade`} cx="31%" cy="25%" r="76%">
              <stop offset="0" stopColor="#fff8db" stopOpacity="0" />
              <stop offset="0.56" stopColor="#102431" stopOpacity="0" />
              <stop offset="0.84" stopColor="#0a1d2b" stopOpacity="0" />
              <stop offset="1" stopColor="#081b29" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${id}-brass`} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#b49b6f" />
              <stop offset="0.38" stopColor="#e0cfa7" />
              <stop offset="0.67" stopColor="#8e7853" />
              <stop offset="1" stopColor="#b8a17a" />
            </linearGradient>
            <radialGradient id={`${id}-shadow`}>
              <stop offset="0" stopColor="#193844" stopOpacity="0.23" />
              <stop offset="1" stopColor="#193844" stopOpacity="0" />
            </radialGradient>
            <clipPath id={`${id}-clip`}>
              <circle cx={CENTER[0]} cy={CENTER[1]} r={RADIUS} />
            </clipPath>
          </defs>
          <g aria-hidden="true" pointerEvents="none">
            <ellipse
              cx="288"
              cy="499"
              rx="151"
              ry="19"
              fill={`url(#${id}-shadow)`}
            />
            <path d="M 275 471 h 10 v 21 h -10 Z" fill={`url(#${id}-brass)`} />
            <ellipse
              cx="280"
              cy="493"
              rx="51"
              ry="7"
              fill={`url(#${id}-brass)`}
            />
            <ellipse cx="280" cy="490" rx="45" ry="4" fill="#c4af89" />
            <circle
              cx={CENTER[0]}
              cy={CENTER[1]}
              r="230"
              fill="none"
              stroke={`url(#${id}-brass)`}
              strokeWidth="3"
            />
            <circle
              cx={CENTER[0]}
              cy={CENTER[1]}
              r="235"
              fill="none"
              stroke="#a38a6240"
              strokeWidth="0.8"
              strokeDasharray="1 12"
            />
            <circle
              cx={CENTER[0]}
              cy={CENTER[1]}
              r={RADIUS}
              fill={`url(#${id}-ocean)`}
            />
            <g clipPath={`url(#${id}-clip)`}>
              {globeCountries.features.map((country) => (
                <path
                  key={country.id}
                  d={path(country) ?? ''}
                  fill={
                    mode === 'origin' && visited.has(String(country.id))
                      ? '#b8492b'
                      : '#d4a85e'
                  }
                  stroke="#173e4280"
                  strokeWidth="0.65"
                  strokeLinejoin="round"
                />
              ))}
              <path
                d={path(graticule) ?? ''}
                fill="none"
                stroke="#173e42"
                strokeOpacity="0.28"
                strokeWidth="0.65"
              />
              <circle
                cx={CENTER[0]}
                cy={CENTER[1]}
                r={RADIUS}
                fill={`url(#${id}-shade)`}
              />
            </g>
            <circle
              cx={CENTER[0]}
              cy={CENTER[1]}
              r={RADIUS}
              fill="none"
              stroke="#173e42"
              strokeWidth="1.3"
            />
          </g>
          <g clipPath={`url(#${id}-clip)`}>
            {pins
              .filter((pin) => isGlobePointVisible(pin.coordinates, rotation))
              .map((pin) => {
                const point = projection(pin.coordinates);
                if (!point) return null;
                const isActive = active?.id === pin.id;
                return (
                  <g
                    key={pin.id}
                    className="origin-globe-pin"
                    role="button"
                    tabIndex={0}
                    aria-pressed={isActive}
                    aria-label={`${pin.label}, ${pin.count} ${pin.count === 1 ? 'cigar' : 'cigars'}`}
                    transform={`translate(${point[0]},${point[1]})`}
                    opacity={Math.min(
                      1,
                      0.45 + globePointDepth(pin.coordinates, rotation) * 1.5,
                    )}
                    onClick={() => selectPin(pin)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectPin(pin);
                      }
                    }}
                  >
                    <title>
                      {pin.label}: {pin.count}{' '}
                      {pin.count === 1 ? 'cigar' : 'cigars'}
                    </title>
                    <circle r="23" fill="transparent" />
                    {isActive && (
                      <circle
                        r="15"
                        fill="none"
                        stroke="#f7e7bd"
                        strokeWidth="1.5"
                      />
                    )}
                    <circle
                      r={isActive ? 8 : 6}
                      fill="#b95238"
                      stroke="#fff1cf"
                      strokeWidth="2.3"
                    />
                  </g>
                );
              })}
          </g>
        </svg>
        {/* oxlint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */}
        <div className="origin-globe-turning">
          <button
            type="button"
            aria-label="Turn globe left"
            onClick={() =>
              turnTo(keyboardGlobeRotation(rotationRef.current, 'ArrowLeft')!)
            }
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
          <p>Drag to turn</p>
          <span
            id={`${id}-instructions`}
            className="origin-globe-accessible-instructions"
          >
            Drag sideways to turn the globe; swipe vertically to scroll the
            page. Use the arrow keys to rotate and Home to reset. Every mapped
            place is also available in the list below.
          </span>
          <button
            type="button"
            aria-label="Turn globe right"
            onClick={() =>
              turnTo(keyboardGlobeRotation(rotationRef.current, 'ArrowRight')!)
            }
          >
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="origin-globe-reset"
            aria-label="Reset globe"
            onClick={reset}
          >
            <RotateCcw size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="origin-globe-caption">
        <div
          className="origin-globe-selection"
          aria-live="polite"
          aria-atomic="true"
        >
          {active ? (
            <>
              <strong>{active.label}</strong>
              <p>{active.names.join(' · ')}</p>
            </>
          ) : (
            <p>
              {pins.length
                ? 'Choose a place'
                : mode === 'origin'
                  ? 'Add a cigar with a country of origin to place your first pin.'
                  : 'Save a location with an entry to add your first place.'}
            </p>
          )}
        </div>
        {pins.length > 0 && (
          <div
            className="origin-globe-places"
            aria-label={
              mode === 'origin' ? 'Mapped origins' : 'Mapped purchase places'
            }
          >
            {pins.map((pin) => (
              <button
                key={pin.id}
                type="button"
                aria-pressed={active?.id === pin.id}
                onClick={() => selectPin(pin)}
              >
                <span className="origin-globe-place-dot" aria-hidden="true" />
                <span>{pin.label}</span>
                <span className="origin-globe-place-count">{pin.count}</span>
              </button>
            ))}
          </div>
        )}
        <div className="origin-globe-footnote">
          <p>
            {mode === 'origin'
              ? 'Country-level origins; pins are approximate.'
              : 'Purchase pins use only locations you explicitly save.'}
            {missing > 0
              ? ` ${missing} ${missing === 1 ? 'entry has' : 'entries have'} no mapped ${mode === 'origin' ? 'origin' : 'location'}.`
              : ''}
          </p>
          <a
            href="https://www.naturalearthdata.com/about/terms-of-use/"
            target="_blank"
            rel="noreferrer"
          >
            Map data: Natural Earth
          </a>
        </div>
      </div>
    </div>
  );
}
