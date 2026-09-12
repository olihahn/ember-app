import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import type { IdentificationEvidence } from '../lib/types';

// Render the actual local Evidence function without booting the app's native
// services. The separate explanation component has its own rendering tests.
const source = readFileSync(
  new URL('../app/EmberApp.tsx', import.meta.url),
  'utf8',
);
const parsed = ts.createSourceFile(
  'EmberApp.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declarations = parsed.statements
  .filter(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      ['Evidence', 'safeUrl'].includes(node.name?.text || ''),
  )
  .map((node) => node.getFullText(parsed))
  .join('\n');
const componentModule = {
  exports: {} as {
    Evidence: (props: {
      evidence: IdentificationEvidence;
      previous?: boolean;
    }) => ReturnType<typeof createElement>;
  },
};
const compiled = ts.transpileModule(
  `${declarations}\nexports.Evidence = Evidence;`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
);
runInNewContext(compiled.outputText, {
  exports: componentModule.exports,
  URL,
  Sparkles: () => null,
  ExternalLink: () => null,
  IdentificationSummary: ({ explanation }: { explanation: string }) =>
    createElement('p', null, explanation),
  require(name: string) {
    if (name === 'react/jsx-runtime') return jsxRuntime;
    throw new Error(`Unexpected evidence dependency: ${name}`);
  },
});
const evidence: IdentificationEvidence = {
  confidence: 'low',
  explanation: 'The band is unclear. Check this suggestion before saving.',
  alternatives: ['Another possible cigar'],
  sources: [
    { title: 'Manufacturer', url: 'https://example.com/cigar' },
    { title: 'Unsafe source', url: 'javascript:alert(1)' },
  ],
};

void test('new low-confidence evidence remains expanded with uncertainty and source access', () => {
  const markup = renderToStaticMarkup(
    createElement(componentModule.exports.Evidence, { evidence }),
  );
  assert.match(markup, /Uncertain identification/);
  assert.match(markup, /low confidence/);
  assert.match(markup, /The band is unclear/);
  assert.match(markup, /Another possible cigar/);
  assert.match(markup, /href="https:\/\/example.com\/cigar"/);
  assert.doesNotMatch(markup, /saved-identification|javascript:|Unsafe source/);
});

void test('previous saved evidence starts collapsed but keeps confidence in its visible summary', () => {
  const markup = renderToStaticMarkup(
    createElement(componentModule.exports.Evidence, {
      evidence,
      previous: true,
    }),
  );
  assert.match(markup, /^<details class="saved-identification"><summary>/);
  assert.match(
    markup,
    /<summary>Identification details<span class="saved-confidence low">low confidence<\/span><\/summary>/,
  );
  assert.doesNotMatch(markup, /<details[^>]+\sopen(?:=|>)/);
  assert.match(markup, /Uncertain identification/);
  assert.match(markup, /href="https:\/\/example.com\/cigar"/);
});

void test('new results on an edited entry cannot use the previous-evidence disclosure', () => {
  assert.match(source, /previous=\{Boolean\(editing\) && !needsConfirmation\}/);
  assert.match(source, /\(needsConfirmation && !confirmed\)/);
});
