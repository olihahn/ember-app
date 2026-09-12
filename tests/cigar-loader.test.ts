import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CigarLoader } from '../components/CigarLoader.tsx';

void test('photo preparation announces local work with decorative, unfocusable art', () => {
  const markup = renderToStaticMarkup(
    createElement(CigarLoader, { phase: 'preparing' }),
  );
  assert.match(markup, /<output /);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /aria-atomic="true"/);
  assert.match(markup, /Preparing your photo…/);
  assert.match(markup, /On your device\./);
  assert.match(markup, /<svg[^>]+aria-hidden="true"[^>]+focusable="false"/);
  assert.doesNotMatch(markup, /online sources|progressbar|aria-valuenow|\d+%/);
});

void test('identification announces online checking without a fake completion estimate or remote asset', () => {
  const markup = renderToStaticMarkup(
    createElement(CigarLoader, {
      phase: 'identifying',
      className: 'identify-loading',
    }),
  );
  assert.match(markup, /class="cigar-loader identify-loading"/);
  assert.match(markup, /Identifying your cigar…/);
  assert.match(markup, /Checking the photo and online sources\./);
  assert.doesNotMatch(
    markup,
    /Preparing your photo|progressbar|aria-valuenow|\d+%|https?:|<image|<use/,
  );
});

void test('two loader instances keep their burn masks isolated', () => {
  const markup = renderToStaticMarkup(
    createElement(
      'div',
      null,
      createElement(CigarLoader, { phase: 'preparing' }),
      createElement(CigarLoader, { phase: 'identifying' }),
    ),
  );
  const ids = [...markup.matchAll(/<clipPath id="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) assert.ok(markup.includes(`clip-path="url(#${id})"`));
});
