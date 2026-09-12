import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Node = { type: unknown; props: Record<string, unknown> };

void test('routes mount visible header and navigation frames around one stable music component', () => {
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
  let player: ts.JsxSelfClosingElement | undefined;
  let navigation: ts.JsxElement | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(app) === 'RecordPlayer'
    )
      player = node;
    if (ts.isJsxOpeningElement(node)) {
      const className = node.attributes.properties.find(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(app) === 'className',
      );
      const value = className?.getText(app) ?? '';
      if (value.includes('mobile-bottom-nav')) navigation = node.parent;
    }
    ts.forEachChild(node, visit);
  }
  visit(app);
  assert.ok(player && navigation);
  assert.ok(
    ts.isJsxElement(player.parent),
    'Player must not be conditional on the route',
  );
  assert.equal(player.parent.openingElement.tagName.getText(app), 'div');
  assert.equal(
    player.attributes.properties.some(
      (attribute) =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(app) === 'key',
    ),
    false,
  );
  const frame = player.attributes.properties.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText(app) === 'renderFrame',
  );
  assert.ok(
    frame &&
      ts.isJsxAttribute(frame) &&
      frame.initializer &&
      ts.isJsxExpression(frame.initializer) &&
      frame.initializer.expression,
  );
  let navigationExpression: ts.Node = navigation;
  while (ts.isParenthesizedExpression(navigationExpression.parent))
    navigationExpression = navigationExpression.parent;
  assert.ok(ts.isBinaryExpression(navigationExpression.parent));
  navigationExpression = navigationExpression.parent;
  function evaluate(
    expression: ts.Node,
    tab: string,
    recordLibraryOpen: boolean,
  ) {
    const fixtureModule = { exports: {} as { value: unknown } };
    const compiled = ts.transpileModule(
      `export const value = ${expression.getText(app)};`,
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    );
    runInNewContext(compiled.outputText, {
      module: fixtureModule,
      exports: fixtureModule.exports,
      require: (name: string) => {
        assert.equal(name, 'react/jsx-runtime');
        const jsx = (type: unknown, props: Node['props']) => ({ type, props });
        return { jsx, jsxs: jsx };
      },
      tab,
      recordLibraryOpen,
      canWrite: true,
      navigate() {},
      openEditor() {},
      setSettingsOpen() {},
      Flame: 'Flame',
      BookOpen: 'BookOpen',
      Disc3: 'Disc3',
      Globe2: 'Globe2',
      Plus: 'Plus',
      Settings2: 'Settings2',
    });
    return fixtureModule.exports.value;
  }
  for (const tab of ['terrace', 'journal', 'atlas']) {
    for (const recordLibraryOpen of [false, true]) {
      const render = evaluate(
        frame.initializer.expression,
        tab,
        recordLibraryOpen,
      ) as (controls: Node) => Node | null;
      const header = render({ type: 'controls', props: {} });
      const nav = evaluate(navigationExpression, tab, recordLibraryOpen) as
        | Node
        | false;
      assert.equal(header === null, tab === 'terrace' && !recordLibraryOpen);
      assert.equal(nav === false, tab === 'terrace');
      for (const element of [header, nav]) {
        if (!element) continue;
        assert.equal(element.props.hidden, undefined);
        assert.equal(element.props['aria-hidden'], undefined);
      }
    }
  }
  assert.equal((source.match(/<RecordPlayer\b/g) || []).length, 1);
});

void test('app keeps one mounted music player and the paper photo preserves intrinsic proportions', () => {
  const app = readFileSync(
    new URL('../app/EmberApp.tsx', import.meta.url),
    'utf8',
  );
  const paper = readFileSync(
    new URL('../components/JournalDeck.css', import.meta.url),
    'utf8',
  );
  assert.equal((app.match(/<RecordPlayer\b/g) || []).length, 1);
  assert.match(app, /useState<Tab>\('terrace'\)/);
  assert.match(app, /else if \(tab !== 'terrace'\) navigate\('terrace'\)/);
  assert.match(
    paper,
    /\.journal-deck-photo img\s*\{[^}]*width: auto;[^}]*height: auto;[^}]*object-fit: contain;/,
  );
});

void test('the pine work surface wins against the shared app background in either stylesheet order', () => {
  const terrace = readFileSync(
    new URL('../components/terrace-shell.css', import.meta.url),
    'utf8',
  );
  const shared = readFileSync(
    new URL('../app/ember.css', import.meta.url),
    'utf8',
  );
  // Only simple class selectors can directly match this root. Compare their
  // specificity and source order, including the native bundle's terrace-first order.
  const classes = new Set(['ember-app', 'terrace-experiment', 'terrace-work']);
  for (const css of [terrace + shared, shared + terrace]) {
    let winner = { specificity: 0, background: '' };
    for (const match of css.matchAll(
      /(?:^|\})\s*((?:\.[\w-]+)+)\s*\{([^{}]*)\}/g,
    )) {
      const names = match[1].slice(1).split('.');
      if (!names.every((name) => classes.has(name))) continue;
      const background = /(?:^|;)\s*background:\s*([^;]+)/
        .exec(match[2])?.[1]
        .trim();
      if (background && names.length >= winner.specificity)
        winner = { specificity: names.length, background };
    }
    assert.equal(winner.background, '#254b45');
  }
});
