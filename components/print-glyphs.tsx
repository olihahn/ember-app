// Small inline glyphs drawn in the print's language: single-weight ink strokes,
// no fills except paper. Used as icon-only buttons; the button carries the
// aria-label, so the glyphs themselves are decorative.

type GlyphProps = { size?: number; className?: string };

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** A 1950s rangefinder camera: flat body, lens barrel, viewfinder window, shutter button. */
export function CameraGlyph({ size = 32, className }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g {...stroke}>
        <rect x="3" y="10" width="26" height="15" rx="2" />
        <path d="M3 15.5h26" strokeWidth="1" />
        <circle cx="16" cy="18.5" r="5.2" />
        <circle cx="16" cy="18.5" r="2.4" />
        <rect x="6.5" y="12" width="4" height="2.4" rx="0.6" strokeWidth="1" />
        <path d="M22.5 7.5h4.5v2.5" />
        <path d="M10 10V8h4v2" />
      </g>
    </svg>
  );
}

/** A closed photo album: spine on the left, a small tipped-in print on the cover with two corner mounts. */
export function AlbumGlyph({ size = 32, className }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g {...stroke}>
        {/* Cover with a rounded fore-edge and a bound spine on the left. */}
        <path d="M8 4.5h17.5a2 2 0 0 1 2 2v19a2 2 0 0 1-2 2H8Z" />
        <path d="M8 4.5H6.2a1.7 1.7 0 0 0-1.7 1.7v19.6a1.7 1.7 0 0 0 1.7 1.7H8" />
        <path d="M8 4.5v23" strokeWidth="1.1" />
        <path d="M6.2 9h1.8M6.2 23h1.8" strokeWidth="1" />
        {/* The tipped-in print, slightly askew, held by two corner mounts. */}
        <rect x="12.4" y="10.2" width="10.6" height="8.2" transform="rotate(-4 17.7 14.3)" strokeWidth="1.1" />
        <path d="M12.6 10.4l2.6 2.4M23 9.6l-2.6 2.4" strokeWidth="1.5" />
        <path d="M11.8 21.6h8" strokeWidth="1" />
      </g>
    </svg>
  );
}
