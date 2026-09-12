import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { BeachCompanion } from '../components/BeachCompanion.tsx';

void test('subject rejections use one concise caption and decorative noninteractive art', () => {
  for (const [reason, caption] of [
    ['no_cigar', 'No cigar in sight.'],
    ['multiple_cigars', 'One cigar at a time.'],
    ['unclear_photo', 'A clearer photo, please.'],
  ] as const) {
    const markup = renderToStaticMarkup(
      createElement(BeachCompanion, { reason }),
    );
    assert.match(
      markup,
      /<output[^>]+aria-live="polite"[^>]+aria-atomic="true"/,
    );
    assert.match(markup, /class="beach-companion-art" aria-hidden="true"/);
    assert.ok(markup.includes(caption));
    assert.doesNotMatch(
      markup,
      /<button|confidence|candidate|API|https?:|progressbar/,
    );
  }
});

void test('sprite is local, the head shake is finite, and reduced motion has a still pose', () => {
  const css = readFileSync(
    new URL('../components/BeachCompanion.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /url\('\/images\/beach-companion.png'\)/);
  assert.match(css, /2\.8s steps\(1, end\) 1 both/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none/);
  assert.doesNotMatch(css, /infinite|https?:/);
});
