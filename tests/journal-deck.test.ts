import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { CigarEntry } from '../lib/types';
import {
  deckIndex,
  deckPage,
  deckSwipeDirection,
} from '../components/journal-deck-state.ts';
import * as deckState from '../components/journal-deck-state.ts';
import * as lifecycle from '../lib/lifecycle.ts';

void test('deck retains a selected entry across reordering and safely resets after filtering', () => {
  assert.equal(deckIndex(['a', 'b', 'c'], 'b'), 1);
  assert.equal(deckIndex(['b', 'a', 'c'], 'b'), 0);
  assert.equal(deckIndex(['a', 'c'], 'b'), 0);
  assert.equal(deckIndex([], 'b'), 0);
});
void test('page navigation is bounded, including Home and End', () => {
  assert.equal(deckPage(0, -1, 3), 0);
  assert.equal(deckPage(2, 1, 3), 2);
  assert.equal(deckPage(1, 1, 3), 2);
  assert.equal(deckPage(1, -3, 3), 0);
  assert.equal(deckPage(1, 3, 3), 2);
  assert.equal(deckPage(0, 1, 0), 0);
});
void test('deliberate horizontal swipes turn pages in either direction', () => {
  assert.equal(deckSwipeDirection(-90, 5, 320), 1);
  assert.equal(deckSwipeDirection(90, -5, 320), -1);
});
void test('native vertical scrolling and small gestures never turn a page', () => {
  assert.equal(deckSwipeDirection(75, 120, 320), 0);
  assert.equal(deckSwipeDirection(-75, -120, 320), 0);
  assert.equal(deckSwipeDirection(20, 2, 320), 0);
  assert.equal(deckSwipeDirection(0, 0, 320), 0);
});
void test('invalid and zero-size gestures cannot turn pages', () => {
  assert.equal(deckSwipeDirection(Number.NaN, 0, 320), 0);
  assert.equal(deckSwipeDirection(100, 0, 0), 0);
});

void test('real deck handlers preserve keyboard target, swipe without opening, and leave vertical gestures alone', () => {
  // Exercise the real component with local hook/JSX stand-ins; Android rendering
  // and native scrolling are verified separately in the emulator.
  const slots: unknown[] = [];
  let cursor = 0;
  const nodes: {
    type: unknown;
    props: Record<string, unknown>;
    key?: unknown;
  }[] = [];
  const timers: (() => void)[] = [];
  const opened: string[] = [];
  let captures = 0;
  const hooks = {
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
    useId: () => 'deck-hint',
  };
  const jsx = (
    type: unknown,
    props: Record<string, unknown>,
    key?: unknown,
  ) => {
    const node = { type, props, key };
    nodes.push(node);
    return node;
  };
  const componentModule = {
    exports: {} as {
      JournalDeck: (props: {
        entries: CigarEntry[];
        sample: boolean;
        onOpen: (entry: CigarEntry) => void;
      }) => unknown;
    },
  };
  const compiled = ts.transpileModule(
    readFileSync(
      new URL('../components/JournalDeck.tsx', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  runInNewContext(compiled.outputText, {
    module: componentModule,
    exports: componentModule.exports,
    window: { setTimeout: (callback: () => void) => timers.push(callback) },
    require(name: string) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === './journal-deck-state') return deckState;
      if (name === '@/lib/lifecycle') return lifecycle;
      if (name === './JournalDeck.css') return {};
      if (name === 'lucide-react')
        return new Proxy({}, { get: (_target, key) => key });
      throw new Error(`Unexpected deck dependency: ${name}`);
    },
  });
  const entries = ['a', 'b', 'c'].map(
    (id): CigarEntry => ({
      id,
      fullName: `Cigar ${id}`,
      brand: '',
      country: 'Nicaragua',
      region: '',
      wrapper: '',
      strength: '',
      vitola: '',
      flavorNotes: [],
      photo: '',
      rating: 3,
      smokedAt: '2026-09-08',
      notes: '',
      purchasePlace: '',
      purchaseLat: null,
      purchaseLng: null,
      createdAt: '2026-09-08T12:00:00Z',
      updatedAt: '2026-09-08T12:00:00Z',
    }),
  );
  function render() {
    cursor = 0;
    nodes.length = 0;
    componentModule.exports.JournalDeck({
      entries,
      sample: false,
      onOpen: (entry) => opened.push(entry.id),
    });
  }
  function card() {
    const node = nodes.find((value) =>
      String(value.props.className).startsWith('journal-deck-card '),
    );
    assert.ok(node);
    return node;
  }
  function call(name: string, event?: unknown) {
    (card().props[name] as (event?: unknown) => void)(event);
  }
  const target = {
    clientWidth: 320,
    setPointerCapture: () => {
      captures++;
    },
    hasPointerCapture: () => false,
    releasePointerCapture: () => undefined,
  };
  const pointer = (x: number, y: number, type = 'pointerup') => ({
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: x,
    clientY: y,
    type,
    currentTarget: target,
  });

  render();
  assert.equal(
    card().key,
    undefined,
    'card focus target must not remount on page changes',
  );
  call('onKeyDown', { key: 'ArrowRight', preventDefault() {} });
  render();
  assert.equal(card().props['aria-label'], 'Open Cigar b');
  assert.equal(card().key, undefined);
  call('onKeyDown', { key: 'Home', preventDefault() {} });
  render();
  call('onPointerDown', pointer(240, 50));
  call('onPointerMove', pointer(100, 54));
  call('onPointerUp', pointer(100, 54));
  render();
  call('onClick');
  assert.deepEqual(opened, []);
  assert.equal(card().props['aria-label'], 'Open Cigar b');
  assert.equal(captures, 1);
  timers.splice(0).forEach((callback) => callback());
  call('onClick');
  assert.deepEqual(opened, ['b']);
  call('onPointerDown', pointer(240, 50));
  call('onPointerMove', pointer(230, 170));
  call('onPointerCancel', pointer(230, 170, 'pointercancel'));
  render();
  assert.equal(card().props['aria-label'], 'Open Cigar b');
  assert.equal(captures, 1, 'vertical gestures must not capture the pointer');
});
