import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(
  new URL('../app/EmberApp.tsx', import.meta.url),
  'utf8',
);
const app = ts.createSourceFile(
  'EmberApp.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const hook = app.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) &&
    node.name?.text === 'useWorkPageHeadingFocus',
);
assert.ok(hook);

function fixture() {
  const slots: { current: unknown }[] = [];
  let cursor = 0;
  let protectedFocus = '';
  let effects: (() => void)[] = [];
  const calls: boolean[] = [];
  const heading = {
    focus: (options: { preventScroll: boolean }) =>
      calls.push(options.preventScroll),
  };
  const fixtureModule = {
    exports: {} as {
      useWorkPageHeadingFocus: (
        tab: string,
        blocked: boolean,
      ) => { current: unknown };
    },
  };
  runInNewContext(
    ts.transpileModule(`export ${hook!.getText(app)}`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      module: fixtureModule,
      exports: fixtureModule.exports,
      useRef: (initial: unknown) => (slots[cursor++] ??= { current: initial }),
      useEffect: (effect: () => void) => effects.push(effect),
      document: {
        activeElement: {
          closest: (selector: string) =>
            protectedFocus && selector.includes(protectedFocus) ? {} : null,
        },
      },
    },
  );
  return {
    calls,
    protect: (selector: string) => {
      protectedFocus = selector;
    },
    render: (tab: string, blocked = false) => {
      cursor = 0;
      effects = [];
      const ref = fixtureModule.exports.useWorkPageHeadingFocus(tab, blocked);
      ref.current = heading; // React assigns DOM refs before flushing effects.
      effects.forEach((effect) => effect());
    },
  };
}

void test('entering a work page from Terrace focuses its heading once without extra scrolling', () => {
  const page = fixture();
  page.render('terrace');
  assert.deepEqual(page.calls, []);
  page.render('journal');
  assert.deepEqual(page.calls, [true]);
  page.render('journal');
  page.render('atlas');
  assert.deepEqual(page.calls, [true]);
  page.render('terrace');
  page.render('atlas');
  assert.deepEqual(page.calls, [true, true]);
});

void test('route focus never takes an active form/dialog or retries after its dismissal', () => {
  for (const selector of [
    'input',
    'textarea',
    'select',
    'form',
    '[contenteditable]',
    '[role="dialog"]',
    '[role="alertdialog"]',
  ]) {
    const page = fixture();
    page.render('terrace');
    page.protect(selector);
    page.render('journal');
    page.protect('');
    page.render('journal');
    assert.deepEqual(page.calls, [], selector);
  }
  const modal = fixture();
  modal.render('terrace');
  modal.render('atlas', true);
  modal.render('atlas', false);
  assert.deepEqual(modal.calls, []);
});

void test('the real work-page h1 is the programmatic focus target; diagnostic is removed', () => {
  let heading: ts.JsxElement | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(app) === 'h1'
    )
      heading = node;
    ts.forEachChild(node, visit);
  }
  visit(app);
  assert.ok(heading);
  const workHeading = { current: null };
  for (const tab of ['journal', 'atlas']) {
    const fixtureModule = {
      exports: {} as {
        value: { type: string; props: Record<string, unknown> };
      },
    };
    runInNewContext(
      ts.transpileModule(`export const value = ${heading.getText(app)};`, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
      {
        module: fixtureModule,
        exports: fixtureModule.exports,
        tab,
        workHeading,
        require: (name: string) => {
          assert.equal(name, 'react/jsx-runtime');
          return { jsx: (type: string, props: unknown) => ({ type, props }) };
        },
      },
    );
    const actual = fixtureModule.exports.value;
    assert.equal(actual.type, 'h1');
    assert.equal(actual.props.ref, workHeading);
    assert.equal(actual.props.tabIndex, -1);
    assert.equal(
      actual.props.children,
      tab === 'journal' ? 'The Journal.' : 'The Atlas.',
    );
  }
  assert.doesNotMatch(source, /FRAME_DIAGNOSTIC|TemporaryFrameDiagnostic/);
});
