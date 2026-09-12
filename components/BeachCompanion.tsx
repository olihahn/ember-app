'use client';

import type { IdentifyRejectedOutcome } from '../lib/types';

const captions: Record<IdentifyRejectedOutcome, string> = {
  no_cigar: 'No cigar in sight.',
  multiple_cigars: 'One cigar at a time.',
  unclear_photo: 'A clearer photo, please.',
};

/** A small one-shot shrug, only for an actual rejected subject result. */
export function BeachCompanion({
  reason,
}: {
  reason: IdentifyRejectedOutcome;
}) {
  return (
    <output className="beach-companion" aria-live="polite" aria-atomic="true">
      <span className="beach-companion-art" aria-hidden="true" key={reason} />
      <span className="beach-companion-message">{captions[reason]}</span>
    </output>
  );
}
