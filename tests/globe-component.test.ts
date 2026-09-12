import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as d3 from 'd3-geo';
import * as geometry from '../lib/globe-geometry.ts';
import * as pins from '../lib/globe-pins.ts';
import type { CigarEntry } from '../lib/types.ts';

interface Node {
  type: unknown;
  props: Record<string, unknown>;
}
const entry: CigarEntry = {
  id: 'globe-component',
  fullName: 'A saved cigar',
  brand: '',
  country: 'Japan',
  region: '',
  wrapper: '',
  strength: '',
  vitola: '',
  flavorNotes: [],
  photo: '',
  rating: 4,
  smokedAt: '2026-09-08',
  notes: '',
  purchasePlace: 'Tokyo shop',
  purchaseLat: 35.7,
  purchaseLng: 139.7,
  createdAt: '2026-09-08T12:00:00Z',
  updatedAt: '2026-09-08T12:00:00Z',
};

function harness() {
  // Execute the actual component with real D3 and pin grouping. Only hooks, JSX,
  // icons and the reduced-motion browser boundary are replaced; no device/DOM.
  const slots: unknown[] = [];
  let cursor = 0;
  let nodes: Node[] = [];
  const hooks = {
    useId: () => 'globe-test',
    useMemo: (factory: () => unknown) => factory(),
    useEffect: () => {},
    useState<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (next: T) => {
          slots[index] = next;
        },
      ];
    },
    useRef<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => {
    const node = { type, props };
    nodes.push(node);
    return node;
  };
  const componentModule = {
    exports: {} as {
      OriginMap: (props: {
        entries: CigarEntry[];
        mode: 'origin' | 'purchase';
      }) => unknown;
    },
  };
  const compiled = ts.transpileModule(
    readFileSync(
      new URL('../components/OriginMap.tsx', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2020,
      },
    },
  );
  runInNewContext(compiled.outputText, {
    module: componentModule,
    exports: componentModule.exports,
    window: { matchMedia: () => ({ matches: true }) },
    requestAnimationFrame: () => {
      throw new Error('Reduced-motion globe must not animate.');
    },
    cancelAnimationFrame: () => {},
    require(name: string) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'd3-geo') return d3;
      if (name === '@/lib/globe-geometry') return geometry;
      if (name === '@/lib/globe-pins') return pins;
      if (name === './origin-globe.css') return {};
      if (name === 'lucide-react')
        return new Proxy({}, { get: (_target, key) => key });
      throw new Error(`Unexpected component dependency: ${name}`);
    },
  });
  const render = (mode: 'origin' | 'purchase' = 'purchase') => {
    cursor = 0;
    nodes = [];
    componentModule.exports.OriginMap({ entries: [entry], mode });
    return nodes;
  };
  const find = (predicate: (node: Node) => boolean) => {
    const found = nodes.find(predicate);
    assert.ok(found, 'Expected component control');
    return found;
  };
  const activate = (node: Node, name: string, event?: unknown) => {
    const handler = node.props[name] as (event?: unknown) => void;
    assert.equal(typeof handler, 'function');
    handler(event);
  };
  return { render, find, activate };
}

void test('actual place button brings a hidden pin forward, preserves its details, and respects reduced motion', () => {
  const ui = harness();
  let nodes = ui.render();
  assert.equal(
    nodes.filter((node) => node.props.className === 'origin-globe-pin').length,
    0,
  );
  const place = ui.find(
    (node) => node.type === 'button' && Array.isArray(node.props.children),
  );
  assert.equal(place.props['aria-pressed'], false);
  ui.activate(place, 'onClick');
  nodes = ui.render();
  const pin = ui.find((node) => node.props.className === 'origin-globe-pin');
  assert.equal(pin.props['aria-label'], 'Tokyo shop, 1 cigar');
  assert.equal(pin.props['aria-pressed'], true);
  const [x, y] = String(pin.props.transform)
    .replace('translate(', '')
    .replace(')', '')
    .split(',')
    .map(Number);
  assert.ok(Math.abs(x - 280) < 0.001 && Math.abs(y - 243) < 0.001);
  assert.ok(
    nodes.some(
      (node) => node.type === 'strong' && node.props.children === 'Tokyo shop',
    ),
  );
  assert.ok(
    nodes.some(
      (node) => node.type === 'p' && node.props.children === 'A saved cigar',
    ),
  );
  nodes = ui.render('origin');
  assert.equal(
    nodes.filter(
      (node) => node.type === 'button' && node.props['aria-pressed'] === true,
    ).length,
    0,
  );
});

void test('actual globe leaves vertical-first touch to page scrolling, but captures horizontal drag without a pin click', () => {
  const ui = harness();
  ui.render();
  const svg = ui.find((node) => node.type === 'svg');
  let captured = false;
  let prevented = false;
  let stopped = false;
  const target = {
    getBoundingClientRect: () => ({ width: 320 }),
    setPointerCapture: () => {
      captured = true;
    },
    hasPointerCapture: () => captured,
    releasePointerCapture: () => {
      captured = false;
    },
  };
  const event = {
    isPrimary: true,
    button: 0,
    pointerId: 1,
    pointerType: 'touch',
    clientX: 100,
    clientY: 100,
    currentTarget: target,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
  };
  ui.activate(svg, 'onPointerDown', event);
  ui.activate(svg, 'onPointerMove', { ...event, clientY: 130 });
  assert.equal(captured, false);
  assert.equal(prevented, false);
  ui.activate(svg, 'onPointerUp', event);
  ui.activate(svg, 'onPointerDown', event);
  ui.activate(svg, 'onPointerMove', { ...event, clientX: 140, clientY: 102 });
  assert.equal(captured, true);
  assert.equal(prevented, true);
  ui.render();
  assert.match(
    String(ui.find((node) => node.type === 'svg').props.className),
    /is-turning/,
  );
  // Transferring implicit capture from a child pin must not end the SVG drag.
  ui.activate(svg, 'onLostPointerCapture', { ...event, target: {} });
  assert.equal(captured, true);
  ui.activate(svg, 'onPointerUp', event);
  ui.activate(svg, 'onClickCapture', event);
  assert.equal(stopped, true);
  assert.equal(captured, false);
  ui.render();
  assert.doesNotMatch(
    String(ui.find((node) => node.type === 'svg').props.className),
    /is-turning/,
  );
});
