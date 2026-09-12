import type {
  IdentifyRejectedOutcome,
  IdentifySubject,
  IdentifySubjectRejection,
} from './types';

const rejections = {
  no_cigar: { code: 'NO_CIGAR', error: 'No cigar in sight.' },
  multiple_cigars: { code: 'MULTIPLE_CIGARS', error: 'One cigar at a time.' },
  unclear_photo: { code: 'UNCLEAR_PHOTO', error: 'A clearer photo, please.' },
} as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isIdentifySubject(value: unknown): value is IdentifySubject {
  if (
    !object(value) ||
    typeof value.confidence !== 'string' ||
    !['high', 'medium', 'low'].includes(value.confidence) ||
    Object.keys(value).some(
      (key) => !['kind', 'visibleCount', 'confidence'].includes(key),
    )
  )
    return false;
  // Do not coerce strings, fractions, or approximate counts into a real count.
  switch (value.kind) {
    case 'no_cigar':
      return value.visibleCount === 0;
    case 'single_cigar':
      return value.visibleCount === 1;
    case 'multiple_cigars':
      return value.visibleCount === 2;
    case 'uncertain':
      return value.visibleCount === null;
    default:
      return false;
  }
}

export function rejectedIdentifySubject(
  subject: IdentifySubject,
): IdentifyRejectedOutcome | null {
  if (subject.confidence !== 'high' || subject.kind === 'uncertain')
    return 'unclear_photo';
  if (subject.kind === 'no_cigar') return 'no_cigar';
  if (subject.kind === 'multiple_cigars') return 'multiple_cigars';
  return null;
}

export function identifySubjectRejection(
  outcome: IdentifyRejectedOutcome,
  subject: IdentifySubject,
): IdentifySubjectRejection {
  return { outcome, ...rejections[outcome], subject };
}

/** Shared web/native response boundary; never treat a rejected photo as evidence. */
export function parseIdentifySubjectRejection(
  payload: unknown,
): IdentifySubjectRejection | null {
  if (
    !object(payload) ||
    typeof payload.outcome !== 'string' ||
    !['no_cigar', 'multiple_cigars', 'unclear_photo'].includes(
      payload.outcome,
    ) ||
    !isIdentifySubject(payload.subject) ||
    Object.keys(payload).some(
      (key) => !['outcome', 'code', 'error', 'subject'].includes(key),
    )
  )
    return null;
  const outcome = payload.outcome as IdentifyRejectedOutcome;
  const expected = rejections[outcome];
  if (payload.code !== expected.code || payload.error !== expected.error)
    return null;
  const subjectRejection = rejectedIdentifySubject(payload.subject);
  // An unreadable label on a clearly visible single cigar is also an unclear photo.
  if (
    subjectRejection !== outcome &&
    !(outcome === 'unclear_photo' && subjectRejection === null)
  )
    return null;
  return identifySubjectRejection(outcome, payload.subject);
}
