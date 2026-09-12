'use client';

import { useId } from 'react';

type CigarLoaderProps = {
  phase: 'preparing' | 'identifying';
  className?: string;
};

/** A decorative loop, not a measure of request progress. */
export function CigarLoader({ phase, className = '' }: CigarLoaderProps) {
  const clipId = useId();
  return (
    <output
      className={`cigar-loader ${className}`}
      aria-live="polite"
      aria-atomic="true"
    >
      <svg
        className="cigar-loader-art"
        viewBox="0 0 160 64"
        width="192"
        height="77"
        aria-hidden="true"
        focusable="false"
        shapeRendering="crispEdges"
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              className="cigar-loader-trim"
              x="20"
              y="28"
              width="116"
              height="22"
            />
          </clipPath>
        </defs>
        <g className="cigar-loader-scene">
          <g clipPath={`url(#${clipId})`}>
            <path
              d="M24 32H134V34H138V46H134V48H24V46H20V34H24Z"
              fill="#193844"
            />
            <path d="M24 34H134V46H24V44H22V36H24Z" fill="#865331" />
            <path d="M26 34H134V36H26ZM24 36H26V38H24Z" fill="#ba8351" />
            <path d="M24 44H134V46H24ZM22 40H24V44H22Z" fill="#603e2e" />
            <path
              d="M32 36H34V40H36V44H34V40H32ZM66 36H68V40H70V44H68V40H66ZM92 36H94V40H96V44H94V40H92ZM116 36H118V40H120V44H118V40H116Z"
              fill="#b37b4c"
            />
            <path
              d="M58 40H60V42H58ZM80 38H82V40H80ZM106 42H108V44H106Z"
              fill="#563e30"
            />
            <path d="M42 32H58V48H42Z" fill="#193844" />
            <path d="M44 34H56V46H44Z" fill="#f6f1e4" />
            <path d="M46 34H54V36H46ZM46 44H54V46H46Z" fill="#b83e2f" />
            <path d="M48 38H52V42H48Z" fill="#b83e2f" />
          </g>
          <g className="cigar-loader-front">
            <g className="cigar-loader-smoke cigar-loader-smoke-one">
              <path d="M136 30V26H138V22H136V18H134V14H136V10" />
            </g>
            <g className="cigar-loader-smoke cigar-loader-smoke-two">
              <path d="M138 30V24H140V20H138V16H140V12" />
            </g>
            <g className="cigar-loader-smoke cigar-loader-smoke-three">
              <path d="M134 28V24H132V20H134V16H132V12H134V8" />
            </g>
            <g className="cigar-loader-glow">
              <path
                d="M130 32H140V34H142V46H140V48H130Z"
                fill="#c79540"
                opacity="0.24"
              />
              <rect
                x="132"
                y="34"
                width="8"
                height="12"
                fill="#e4a448"
                opacity="0.3"
              />
            </g>
            <path d="M134 34H140V36H142V44H140V46H134Z" fill="#a69f87" />
            <path
              d="M136 34H140V36H136ZM138 38H142V40H138ZM136 44H140V46H136Z"
              fill="#d6cfb9"
            />
            <path d="M134 34H136V36H138V44H136V46H134Z" fill="#b83e2f" />
            <path
              className="cigar-loader-coal"
              d="M134 36H136V44H134ZM136 38H138V40H136Z"
              fill="#ffd27b"
            />
            <rect x="134" y="38" width="2" height="4" fill="#fff3c4" />
          </g>
          <g className="cigar-loader-fall cigar-loader-fall-one" fill="#858371">
            <rect x="118" y="43" width="6" height="3" />
            <rect x="122" y="40" width="3" height="2" fill="#d6cfb9" />
          </g>
          <g className="cigar-loader-fall cigar-loader-fall-two" fill="#858371">
            <rect x="82" y="43" width="7" height="3" />
            <rect x="86" y="40" width="3" height="2" fill="#d6cfb9" />
          </g>
        </g>
      </svg>
      <span className="cigar-loader-caption">
        <strong>
          {phase === 'preparing'
            ? 'Preparing your photo…'
            : 'Identifying your cigar…'}
        </strong>
        <span>
          {phase === 'preparing'
            ? 'On your device.'
            : 'Checking the photo and online sources.'}
        </span>
      </span>
    </output>
  );
}
