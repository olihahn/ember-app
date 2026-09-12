import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Node = { type: unknown; props: Record<string, unknown> };
type Listener = (event: Event) => void;

class Target {
  listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string) {
    const event = new Event(type, { cancelable: true });
    this.listeners.get(type)?.forEach((listener) => listener(event));
    return event;
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce(
      (count, value) => count + value.size,
      0,
    );
  }
}

type ComponentOptions = {
  onReady: () => void;
  onFailure: () => void;
  motion: boolean;
  playing: boolean;
  active: boolean;
};
function componentFixture(canAdd = true, reducedMotion = false) {
  const slots: unknown[] = [];
  let cursor = 0;
  let dirty = false;
  let scheduled: (() => void)[] = [];
  const effects = new Map<
    number,
    { dependencies: unknown[]; cleanup?: () => void }
  >();
  const nodes: Node[] = [];
  const media = Object.assign(new Target(), { matches: reducedMotion });
  let resolveImport: ((value: unknown) => void) | undefined;
  let rejectImport: ((reason?: unknown) => void) | undefined;
  const imported = new Promise((resolve, reject) => {
    resolveImport = resolve;
    rejectImport = reject;
  });
  const instances: {
    options: ComponentOptions;
    disposed: number;
    motion: boolean[];
    playing: boolean[];
    titles: (string | undefined)[];
    active: boolean[];
  }[] = [];
  const opened: string[] = [];
  const timers: { callback: () => void; ms: number }[] = [];
  let settings = 0;
  let flicks = 0;
  const props = {
    establishedLabel: 'EST. NOW',
    canAdd,
    musicOpen: false,
    playing: false,
    trackTitle: undefined as string | undefined,
    active: true,
    onOpen: (destination: string) => opened.push(destination),
    onFlickRecords: () => flicks++,
    onSettings: () => settings++,
  };
  const fakeModule = {
    createPlatesRenderer(options: ComponentOptions) {
      const instance = {
        options,
        disposed: 0,
        motion: [] as boolean[],
        playing: [] as boolean[],
        titles: [] as (string | undefined)[],
        active: [] as boolean[],
      };
      instances.push(instance);
      return {
        dispose: () => instance.disposed++,
        setMotion: (value: boolean) => {
          instance.motion.push(value);
        },
        setPlaying: (value: boolean, title?: string) => {
          instance.playing.push(value);
          instance.titles.push(title);
        },
        setActive: (value: boolean) => {
          instance.active.push(value);
        },
        enter: (_destination: string, done: () => void) => done(),
        resetView() {},
      };
    },
  };
  const jsx = (type: unknown, props: Node['props']) => {
    const node = { type, props };
    nodes.push(node);
    if (type === 'div' && props.className === 'living-terrace-renderer')
      (props.ref as { current: unknown }).current = {};
    if (type === 'button' && typeof props.ref === 'function') props.ref({});
    return node;
  };
  const componentModule = {
    exports: {} as { LivingTerrace: (props: unknown) => unknown },
  };
  runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL('../components/LivingTerrace.tsx', import.meta.url),
        'utf8',
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      module: componentModule,
      exports: componentModule.exports,
      window: {
        matchMedia: () => media,
        setTimeout: (callback: () => void, ms: number) => {
          timers.push({ callback, ms });
          return timers.length;
        },
        clearTimeout: (id: number) => {
          timers[id - 1] = { callback: () => {}, ms: 0 };
        },
      },
      require(name: string) {
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (name === '@/lib/terrace/plates/stage') return imported;
        if (name === 'lucide-react')
          return new Proxy({}, { get: (_target, key) => key });
        if (name.endsWith('.css')) return {};
        if (name === 'react')
          return {
            useRef(initial: unknown) {
              return (slots[cursor++] ??= { current: initial });
            },
            useState(initial: unknown) {
              const index = cursor++;
              if (!(index in slots))
                slots[index] =
                  typeof initial === 'function' ? initial() : initial;
              return [
                slots[index],
                (next: unknown) => {
                  const value =
                    typeof next === 'function' ? next(slots[index]) : next;
                  if (!Object.is(value, slots[index])) {
                    slots[index] = value;
                    dirty = true;
                  }
                },
              ];
            },
            useEffect(
              effect: () => (() => void) | undefined,
              dependencies: unknown[],
            ) {
              const index = cursor++;
              const previous = effects.get(index);
              if (
                previous &&
                dependencies.every((value, i) =>
                  Object.is(value, previous.dependencies[i]),
                )
              )
                return;
              scheduled.push(() => {
                previous?.cleanup?.();
                const cleanup = effect();
                effects.set(index, {
                  dependencies,
                  cleanup: typeof cleanup === 'function' ? cleanup : undefined,
                });
              });
            },
          };
        throw new Error(`Unexpected component dependency: ${name}`);
      },
    },
  );
  function render() {
    let pass = 0;
    do {
      assert.ok(pass++ < 12, 'component render loop');
      dirty = false;
      cursor = 0;
      nodes.length = 0;
      scheduled = [];
      componentModule.exports.LivingTerrace(props);
      scheduled.forEach((effect) => effect());
    } while (dirty);
  }
  render();
  return {
    instances,
    opened,
    props,
    nodes,
    media,
    render,
    settings: () => settings,
    finishImport: () => resolveImport?.(fakeModule),
    failImport: () => rejectImport?.(new Error('test import failed')),
    settle: async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
      render();
    },
    unmount: () => effects.forEach((effect) => effect.cleanup?.()),
    timers,
    flicks: () => flicks,
    section: () => nodes.find((node) => node.type === 'section')!,
    status: () =>
      nodes.find((node) => node.type === 'section')?.props['data-status'],
    button: (label: string) => {
      const button = nodes.find(
        (node) => node.type === 'button' && node.props['aria-label'] === label,
      );
      assert.ok(button, `Missing button ${label}`);
      return button;
    },
    click: (label: string) => {
      const button = nodes.find(
        (node) =>
          node.type === 'button' &&
          (node.props['aria-label'] === label || node.props.children === label),
      );
      assert.ok(button, `Missing button ${label}`);
      (button.props.onClick as () => void)();
      render();
    },
  };
}

void test('component imports once, forwards live preferences, and disposes on unmount', async () => {
  const scene = componentFixture(true, true);
  scene.finishImport();
  await scene.settle();
  assert.equal(scene.instances.length, 1);
  const instance = scene.instances[0];
  assert.equal(instance.options.motion, false);
  instance.options.onReady();
  scene.render();
  assert.equal(scene.status(), 'ready');
  scene.props.playing = true;
  scene.props.active = false;
  scene.render();
  assert.deepEqual(instance.playing, [true]);
  assert.deepEqual(instance.active, [false]);
  scene.media.matches = false;
  scene.media.emit('change');
  scene.render();
  assert.deepEqual(instance.motion, [true]);
  assert.equal(scene.instances.length, 1);
  scene.unmount();
  assert.equal(instance.disposed, 1);
  assert.equal(scene.media.listenerCount, 0);
});

void test('unmount before lazy import completes never creates a renderer', async () => {
  const scene = componentFixture();
  scene.unmount();
  scene.finishImport();
  await scene.settle();
  assert.equal(scene.instances.length, 0);
});

void test('failed component attempts cannot be revived by old callbacks, even before React renders', async () => {
  const scene = componentFixture();
  scene.finishImport();
  await scene.settle();
  const failed = scene.instances[0];
  failed.options.onFailure();
  failed.options.onReady();
  scene.render();
  assert.equal(scene.status(), 'unavailable');
  assert.equal(failed.disposed, 1);
  scene.click('Try the terrace again');
  await scene.settle();
  assert.equal(scene.instances.length, 2);
  failed.options.onFailure();
  failed.options.onReady();
  scene.render();
  assert.equal(scene.status(), 'loading');
  scene.instances[1].options.onReady();
  scene.render();
  assert.equal(scene.status(), 'ready');
  scene.unmount();
});

void test('semantic object and shortcut controls remain usable when WebGL is unavailable', async () => {
  const scene = componentFixture(false);
  scene.failImport();
  await scene.settle();
  assert.equal(scene.status(), 'unavailable');
  for (const [label, destination] of [
    ['Journal', 'journal'],
    ['Atlas', 'atlas'],
    ['Records', 'records'],
  ]) {
    assert.equal(scene.button(label).props.type, 'button');
    scene.click(label);
    scene.click(`Open ${label.toLowerCase()}`);
    assert.deepEqual(scene.opened.slice(-2), [destination, destination]);
  }
  assert.equal(scene.button('Add a cigar').props.disabled, true);
  assert.equal(scene.button('Open add a cigar').props.disabled, true);
  scene.click('Add a cigar');
  assert.equal(scene.opened.includes('identify'), false);
  scene.click('Settings');
  assert.equal(scene.settings(), 1);
  scene.unmount();
});

void test('the playing record titles the records caption, and the plaque lives in the objects layer for the stage to place', async () => {
  const scene = componentFixture();
  scene.finishImport();
  await scene.settle();
  const instance = scene.instances[0];
  instance.options.onReady();
  scene.render();
  const records = () =>
    scene.nodes.find((node) => node.type === 'button' && String(node.props['aria-label']).startsWith('Records'))!;
  const caption = () => records().props.children as Node;
  assert.equal(caption().props.children, 'Records');
  scene.props.playing = true;
  scene.props.trackTitle = 'Sunset Bossa';
  scene.render();
  assert.equal(caption().props.children, 'Sunset Bossa', 'the record on the turntable names the caption');
  assert.equal(records().props['aria-label'], 'Records, playing Sunset Bossa', 'and the accessible name says so too');
  assert.deepEqual(instance.titles.at(-1), 'Sunset Bossa');
  scene.props.playing = false;
  scene.render();
  assert.equal(caption().props.children, 'Records', 'and the caption returns when playback stops');
  assert.equal(records().props['aria-label'], 'Records');
  assert.ok(!JSON.stringify(scene.nodes.map((node) => node.props.className)).includes('living-terrace-established'), 'no EST. plaque on the terrace');
  assert.ok(!scene.nodes.some((node) => node.type === 'button' && /scene motion|Reset terrace view/.test(String(node.props['aria-label']))), 'no pause or reset controls');
  scene.unmount();
});

void test('a quick sideways flick on the record player toggles playback without opening it; a tap still opens the records', async () => {
  const scene = componentFixture();
  scene.finishImport();
  await scene.settle();
  scene.instances[0].options.onReady();
  scene.render();
  const records = () => scene.button('Records');
  const captured: number[] = [];
  const target = { setPointerCapture: (id: number) => captured.push(id) };
  const pointer = (overrides: Record<string, unknown>) => ({
    isPrimary: true, button: 0, pointerId: 3, clientX: 100, clientY: 500, timeStamp: 1000, currentTarget: target, ...overrides,
  });
  (records().props.onPointerDown as (event: unknown) => void)(pointer({}));
  assert.deepEqual(captured, [3], 'the pointer is captured on the button, so the canvas never leans');
  (records().props.onPointerUp as (event: unknown) => void)(pointer({ clientX: 160, clientY: 505, timeStamp: 1300 }));
  (records().props.onClick as () => void)();
  scene.render();
  assert.equal(scene.flicks(), 1, 'a 60 px flick within 300 ms toggles playback');
  assert.deepEqual(scene.opened, [], 'and the click that follows is swallowed');
  (records().props.onPointerDown as (event: unknown) => void)(pointer({ timeStamp: 2000 }));
  (records().props.onPointerUp as (event: unknown) => void)(pointer({ clientX: 30, clientY: 505, timeStamp: 2900 }));
  (records().props.onClick as () => void)();
  scene.render();
  assert.equal(scene.flicks(), 1, 'a slow drag is not a flick');
  assert.deepEqual(scene.opened, ['records'], 'so the tap opens the records');
  (records().props.onPointerDown as (event: unknown) => void)(pointer({ timeStamp: 4000 }));
  (records().props.onPointerUp as (event: unknown) => void)(pointer({ clientX: 110, clientY: 600, timeStamp: 4200 }));
  (records().props.onClick as () => void)();
  scene.render();
  assert.equal(scene.flicks(), 1, 'a mostly vertical move is not a flick');
  assert.deepEqual(scene.opened, ['records', 'records']);
  (records().props.onPointerDown as (event: unknown) => void)(pointer({ timeStamp: 5000 }));
  (records().props.onPointerUp as (event: unknown) => void)(pointer({ clientX: 20, clientY: 500, timeStamp: 5200 }));
  (records().props.onClick as () => void)();
  scene.render();
  assert.equal(scene.flicks(), 2, 'a flick to the left toggles too');
  assert.equal(scene.button('Journal').props.onPointerDown, undefined, 'only the record player listens for flicks');
  scene.unmount();
});

void test('the terrace stays active behind the record panel, and the flick reaches the transport', () => {
  const source = readFileSync(new URL('../app/EmberApp.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('active={!editorOpen && !settingsOpen}'), 'the open record library no longer pauses the scene');
  assert.ok(!source.includes('!recordLibraryOpen}'), 'no leftover library term in the active flag');
  assert.ok(source.includes('onFlickRecords={() => recordControls.current?.toggle()}'));
  assert.ok(source.includes('onControls={(controls) => {'));
});


