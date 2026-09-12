import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanIdentificationExplanation,
  identificationSummary,
} from '../lib/identification-display.ts';

void test('repeated scan sentences and raw source citations are removed from display only', () => {
  const observation = "The band displays 'OLMEC' and 'ESTELÍ – NICARAGUA'.";
  const source =
    '([foundationcigarcompany.com](https://foundationcigarcompany.com/olmec/?utm_source=openai))';
  const original = `${observation} A distinct profile logo is visible. ${observation} A distinct profile logo is visible. The source supports the Olmec line. ${source}`;
  assert.equal(
    cleanIdentificationExplanation(original),
    `${observation} A distinct profile logo is visible. The source supports the Olmec line.`,
  );
  assert.ok(original.includes(source));
  assert.equal(original.split(observation).length, 3);
});

void test('meaningful Markdown link labels become plain text, never new links', () => {
  assert.equal(
    cleanIdentificationExplanation(
      'See [the product page](https://example.com/cigar). **Review** the proposed name.',
    ),
    'See the product page. Review the proposed name.',
  );
});

void test('short explanations remain intact and do not need an expansion control', () => {
  const text = 'The band is unreadable. Add a clearer photo or a label hint.';
  assert.deepEqual(identificationSummary(text), {
    full: text,
    preview: text,
    expandable: false,
  });
});

void test('a long result has a short preview and retains the complete cleaned explanation', () => {
  const text =
    'The band reads Olmec. ' +
    'The retrieved manufacturer page supports this product line and its manufacturing origin, while the wrapper and blend describe the product rather than the brand headquarters. ' +
    'Review the proposed details before saving your journal entry.';
  const result = identificationSummary(text);
  assert.equal(result.preview, 'The band reads Olmec.');
  assert.equal(result.full, text);
  assert.equal(result.expandable, true);
});

void test('uncertainty remains visible when a long visual description precedes it', () => {
  const warning =
    'The product line is not readable in this photo, so the specific line remains uncertain.';
  const text =
    'The photo shows a cigar with a decorated band, several letters and a contrasting border against its wrapper. The visible brand has a distinctive crest and lettering that could help with a closer photo. ' +
    warning;
  const result = identificationSummary(text);
  assert.equal(result.preview, warning);
  assert.ok(result.full.endsWith(warning));
  assert.equal(result.expandable, true);
});

void test('long single sentences are bounded without changing stored evidence', () => {
  const text = 'Visible band detail '.repeat(30).trim() + '.';
  const result = identificationSummary(text);
  assert.ok(result.preview.length <= 230);
  assert.ok(result.preview.endsWith('…'));
  assert.equal(result.full, text);
  assert.equal(result.expandable, true);
});

void test('truncating a long sentence never drops its trailing caveat from the preview', () => {
  const text =
    'The ornate band and its gold border match the manufacturer photographs, with the large crest, contrasting red lettering, decorative scrollwork, dark wrapper and overall proportions all consistent with this product family, but the exact product line cannot be verified from this photo.';
  const result = identificationSummary(text);
  assert.match(result.preview, /details need checking/);
  assert.ok(result.preview.length <= 230);
  assert.equal(result.full, text);
  assert.equal(result.expandable, true);
});

void test('empty or citation-only explanations do not produce empty disclosure controls', () => {
  for (const text of ['', '  ', '([example.com](https://example.com/cigar))']) {
    assert.deepEqual(identificationSummary(text), {
      full: '',
      preview: '',
      expandable: false,
    });
  }
});
