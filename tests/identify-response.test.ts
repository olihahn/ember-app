import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identifySubjectRejection,
  isIdentifySubject,
  parseIdentifySubjectRejection,
} from '../lib/identify-response.ts';
import type { IdentifyRejectedOutcome, IdentifySubject } from '../lib/types.ts';

void test('shared native/web parser accepts each explicit no-evidence rejection', () => {
  const cases: [IdentifyRejectedOutcome, IdentifySubject][] = [
    ['no_cigar', { kind: 'no_cigar', visibleCount: 0, confidence: 'high' }],
    [
      'multiple_cigars',
      { kind: 'multiple_cigars', visibleCount: 2, confidence: 'high' },
    ],
    [
      'unclear_photo',
      { kind: 'uncertain', visibleCount: null, confidence: 'low' },
    ],
    [
      'unclear_photo',
      { kind: 'single_cigar', visibleCount: 1, confidence: 'high' },
    ],
    [
      'unclear_photo',
      { kind: 'multiple_cigars', visibleCount: 2, confidence: 'medium' },
    ],
  ];
  for (const [outcome, subject] of cases) {
    const payload = identifySubjectRejection(outcome, subject);
    assert.deepEqual(parseIdentifySubjectRejection(payload), payload);
  }
});

void test('older successful results remain on their existing path rather than becoming subject rejections', () => {
  assert.equal(
    parseIdentifySubjectRejection({
      candidate: { fullName: 'An existing result' },
      confidence: 'low',
      explanation: 'Check the name.',
      sources: [],
    }),
    null,
  );
  assert.equal(
    parseIdentifySubjectRejection({
      error: 'Service unavailable.',
      code: 'UPSTREAM_UNAVAILABLE',
    }),
    null,
  );
});

void test('client parser rejects fabricated outcome/count combinations, malformed values and mixed-in candidates', () => {
  const subject: IdentifySubject = {
    kind: 'no_cigar',
    visibleCount: 0,
    confidence: 'high',
  };
  const valid = identifySubjectRejection('no_cigar', subject);
  for (const value of [
    null,
    [],
    'no_cigar',
    {},
    { ...valid, outcome: ['no_cigar'] },
    { ...valid, outcome: 'something_else' },
    { ...valid, code: 'MULTIPLE_CIGARS' },
    { ...valid, error: 'A fabricated arbitrary message' },
    { ...valid, candidate: {} },
    { ...valid, sources: [] },
    { ...valid, confidence: 'high' },
    { ...valid, alternatives: [] },
    { ...valid, subject: { ...subject, visibleCount: '0' } },
    { ...valid, subject: { ...subject, visibleCount: 1 } },
    { ...valid, subject: { ...subject, confidence: ['high'] } },
    { ...valid, subject: { ...subject, confidence: 'low' } },
    {
      ...valid,
      subject: { kind: 'single_cigar', visibleCount: 1, confidence: 'high' },
    },
  ])
    assert.equal(parseIdentifySubjectRejection(value), null);
  assert.equal(
    isIdentifySubject({
      kind: 'uncertain',
      visibleCount: null,
      confidence: 'low',
    }),
    true,
  );
});
