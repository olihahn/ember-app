import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as music from '../lib/music.ts';
import {
  RecordTransport,
  isRecordFlick,
  recordLibraryLayout,
  type PlaybackState,
  type RecordAudio,
} from '../lib/record-player.ts';

class FakeAudio implements RecordAudio {
  src = '';
  preload = '';
  volume = 1;
  paused = true;
  playCount = 0;
  pauseCount = 0;
  loadCount = 0;
  pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
  listeners = new Map<string, Set<() => void>>();
  play() {
    this.playCount++;
    this.paused = false;
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }
  pause() {
    this.paused = true;
    this.pauseCount++;
  }
  load() {
    this.loadCount++;
  }
  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string) {
    this.listeners.get(type)?.forEach((listener) => listener());
  }
}

function setup() {
  const audio = new FakeAudio();
  const states: PlaybackState[] = [];
  let ended = 0;
  const player = new RecordTransport(
    audio,
    (state) => states.push(state),
    () => ended++,
  );
  player.select('/audio/cool-vibes.m4a');
  return { audio, states, player, ended: () => ended };
}

void test('a new record player does not autoplay or preload and begins at gentle volume', () => {
  const { audio, player, states } = setup();
  assert.equal(audio.playCount, 0);
  assert.equal(audio.preload, 'none');
  assert.equal(audio.volume, 0.35);
  assert.equal(player.wantsPlayback, false);
  assert.deepEqual(states, ['paused']);
});

void test('vinyl spins only after an actual playing event, not a fulfilled play promise', async () => {
  const { audio, player, states } = setup();
  const pending = player.play();
  assert.equal(states.at(-1), 'loading');
  audio.pending[0].resolve();
  await pending;
  assert.equal(states.at(-1), 'loading');
  audio.emit('playing');
  assert.equal(states.at(-1), 'playing');
  await player.play(); // Another flick of the record is idempotent.
  assert.equal(audio.playCount, 1);
  assert.equal(states.at(-1), 'playing');
});

void test('a late play completion or playing event cannot restart a paused record', async () => {
  const { audio, player, states } = setup();
  const pending = player.play();
  player.pause();
  audio.pending[0].resolve();
  await pending;
  audio.paused = false;
  audio.emit('playing');
  assert.equal(audio.paused, true);
  assert.equal(player.wantsPlayback, false);
  assert.equal(states.at(-1), 'paused');
});

void test('an aborted old track cannot cancel a newly selected playing track', async () => {
  const { audio, player, states } = setup();
  const previous = player.play();
  player.select('/audio/jazz-brunch.m4a', true);
  audio.pending[0].reject(new Error('old source aborted'));
  await previous;
  assert.equal(player.wantsPlayback, true);
  assert.equal(states.at(-1), 'loading');
  audio.pending[1].resolve();
  await Promise.resolve();
  audio.emit('playing');
  assert.equal(states.at(-1), 'playing');
});

void test('external audio pauses, errors, and a finished side stop the animation', async () => {
  const { audio, player, states, ended } = setup();
  const pending = player.play();
  audio.pending[0].resolve();
  await pending;
  audio.emit('playing');
  audio.paused = true;
  audio.emit('pause');
  assert.equal(player.wantsPlayback, false);
  assert.equal(states.at(-1), 'paused');
  const next = player.play();
  audio.pending[1].reject(new Error('decode error'));
  await next;
  assert.equal(states.at(-1), 'error');
  const last = player.play();
  audio.pending[2].resolve();
  await last;
  audio.emit('ended');
  assert.equal(states.at(-1), 'paused');
  assert.equal(ended(), 1);
  assert.equal(audio.playCount, 3); // No automatic next track.
});

void test('unmount cancels pending playback, releases audio, and removes event listeners', async () => {
  const { audio, player, states } = setup();
  const pending = player.play();
  player.dispose();
  const reported = states.length;
  audio.pending[0].resolve();
  await pending;
  assert.equal(audio.paused, true);
  assert.equal(audio.src, '');
  assert.equal(audio.loadCount, 1);
  assert.ok(
    [...audio.listeners.values()].every((listeners) => listeners.size === 0),
  );
  await player.play();
  assert.equal(audio.playCount, 1);
  assert.equal(states.length, reported);
});

void test('record gestures distinguish a deliberate flick from scrolling or a tap', () => {
  assert.equal(isRecordFlick(23, 3), true);
  assert.equal(isRecordFlick(-80, 7), true);
  assert.equal(isRecordFlick(50, 90), false);
  assert.equal(isRecordFlick(10, 1), false);
  assert.equal(isRecordFlick(50, 50), false);
});

void test('expanded music credits stay above native navigation and dock in short viewports', () => {
  const normal = recordLibraryLayout(298, 0, 798);
  assert.equal(normal.docked, false);
  assert.ok(normal.top + normal.maxHeight < 798);
  const landscape = recordLibraryLayout(280, 0, 300);
  assert.equal(landscape.docked, true);
  assert.ok(landscape.top + landscape.maxHeight < 300);
});

void test('player connects lifecycle pause, accessible controls, reduced motion and discoverable credits', () => {
  const source = readFileSync(
    new URL('../components/RecordPlayer.tsx', import.meta.url),
    'utf8',
  );
  const css = readFileSync(
    new URL('../components/RecordPlayer.css', import.meta.url),
    'utf8',
  );
  assert.match(source, /visibilitychange/);
  // Leaving Ember pauses the record; our own camera and gallery do not.
  assert.match(
    source,
    /if \(!isActive && !isDevicePickerOpen\(\)\) controls.pause\(\)/,
  );
  assert.match(
    source,
    /document.hidden && !isDevicePickerOpen\(\)\) controls.pause\(\)/,
  );
  assert.match(source, /aria-label="Next record"/);
  assert.match(source, /Music credits/);
  assert.match(source, /musicModificationNote/);
  // CC BY 4.0 requires the copyright notice to survive in the credit itself.
  assert.match(source, /Copyright Kevin MacLeod/);
  assert.doesNotMatch(source, /autoPlay/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /touch-action: pan-y/);
});

interface PlayerNode {
  type: unknown;
  props: {
    children?: unknown;
    className?: string;
    viewBox?: string;
    cx?: string;
    cy?: string;
    'aria-label'?: string;
    onClick?: (event: { detail: number }) => void;
  };
}

function componentPlayer() {
  // Execute the real JSX and effects while replacing browser primitives only.
  // Hook dependency tracking is intentional: panel changes must not recreate
  // the Audio instance or run the transport's disposal effect.
  const slots: unknown[] = [];
  const effects = new Map<
    number,
    { dependencies: unknown[]; cleanup?: () => void }
  >();
  const audios: FakeAudio[] = [];
  let cursor = 0;
  let scheduled: (() => void)[] = [];
  let tree: PlayerNode | null;
  let open = false;
  let presentation: 'standard' | 'compact' = 'compact';
  let renderFrame: ((player: PlayerNode) => PlayerNode | null) | undefined;
  let transportInLibrary = false;
  const titles: string[] = [];
  let handle: { toggle: () => void } | null = null;
  const setOpen = (next: boolean) => {
    open = next;
  };
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
    useId() {
      return `record-test-${cursor++}`;
    },
    useEffect(effect: () => (() => void) | undefined, dependencies: unknown[]) {
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
        effects.set(index, { dependencies, cleanup: effect() });
      });
    },
  };
  const jsx = (type: unknown, props: PlayerNode['props']): PlayerNode => ({
    type,
    props,
  });
  const listeners = new Map<string, (event: unknown) => void>();
  let pickerOpen = false;
  const document = {
    hidden: false,
    addEventListener: (name: string, handler: (event: unknown) => void) =>
      listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const componentModule = {
    exports: {} as { RecordPlayer: (props: unknown) => PlayerNode | null },
  };
  const compiled = ts.transpileModule(
    readFileSync(
      new URL('../components/RecordPlayer.tsx', import.meta.url),
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
    Audio: class extends FakeAudio {
      constructor() {
        super();
        audios.push(this);
      }
    },
    document,
    window: { addEventListener() {}, removeEventListener() {} },
    require(name: string) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime')
        return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === 'lucide-react')
        return new Proxy({}, { get: (_target, key) => key });
      if (name === '@capacitor/app') return { App: {} };
      if (name === '@/lib/native-bridge') return { isNative: () => false };
      if (name === '@/lib/mobile')
        return { isDevicePickerOpen: () => pickerOpen };
      if (name === '@/lib/music') return music;
      if (name === '@/lib/record-player')
        return { RecordTransport, isRecordFlick, recordLibraryLayout };
      if (name === './RecordPlayer.css') return {};
      throw new Error(`Unexpected player dependency: ${name}`);
    },
  });
  function nodes(value: unknown): PlayerNode[] {
    if (Array.isArray(value)) return value.flatMap((child) => nodes(child));
    if (!value || typeof value !== 'object' || !('props' in value)) return [];
    const node = value as PlayerNode;
    return [node, ...nodes(node.props.children)];
  }
  function render() {
    cursor = 0;
    scheduled = [];
    tree = componentModule.exports.RecordPlayer({
      libraryOpen: open,
      onLibraryOpenChange: setOpen,
      presentation,
      renderFrame,
      transportInLibrary,
      onTrackChange: (title: string) => titles.push(title),
      onControls: (controls: { toggle: () => void } | null) => {
        handle = controls;
      },
    });
    scheduled.forEach((effect) => effect());
  }
  return {
    audios,
    nodes: () => nodes(tree),
    render,
    document,
    setPresentation(next: 'standard' | 'compact') {
      presentation = next;
    },
    setFrame(next: (player: PlayerNode) => PlayerNode | null) {
      renderFrame = next;
    },
    setTransportInLibrary(next: boolean) {
      transportInLibrary = next;
    },
    openLibrary() {
      open = true;
      render();
    },
    titles,
    handle: () => handle,
    click(label: string) {
      const node = nodes(tree).find(
        ({ props }) =>
          props['aria-label'] === label || props.children === label,
      );
      assert.ok(node?.props.onClick, `Expected clickable ${label}`);
      node.props.onClick({ detail: 0 });
      render();
    },
    escape() {
      listeners.get('keydown')?.({ key: 'Escape' });
      render();
    },
    hide() {
      document.hidden = true;
      listeners.get('visibilitychange')?.({});
      render();
    },
    /** Ember's own camera or gallery takes the screen, then hands it back. */
    pickPhoto(during: () => void) {
      pickerOpen = true;
      document.hidden = true;
      listeners.get('visibilitychange')?.({});
      render();
      during();
      pickerOpen = false;
      document.hidden = false;
      listeners.get('visibilitychange')?.({});
      render();
    },
    unmount() {
      effects.forEach(({ cleanup }) => cleanup?.());
    },
  };
}

void test('route frames mount fresh visible controls without replacing or pausing the audio', async () => {
  const component = componentPlayer();
  const visibleFrame = (player: PlayerNode): PlayerNode => ({
    type: 'header',
    props: { className: 'ember-topbar', children: player },
  });
  component.setFrame(() => null);
  component.render();
  assert.equal(component.nodes().length, 0);
  assert.equal(component.audios.length, 1);

  component.setFrame(visibleFrame);
  component.render();
  assert.equal(
    component.nodes().filter(({ type }) => type === 'header').length,
    1,
  );
  component.click('Play music');
  const audio = component.audios[0];
  audio.pending[0].resolve();
  await Promise.resolve();
  audio.emit('playing');
  component.render();
  const pauseCount = audio.pauseCount;
  const loadCount = audio.loadCount;
  const source = audio.src;

  component.setFrame(() => null);
  component.render();
  assert.equal(component.nodes().length, 0);
  assert.equal(audio.paused, false);
  component.setFrame(visibleFrame);
  component.render();
  assert.equal(component.audios.length, 1);
  assert.equal(audio.paused, false);
  assert.equal(audio.pauseCount, pauseCount);
  assert.equal(audio.loadCount, loadCount);
  assert.equal(audio.src, source);
  assert.ok(
    component
      .nodes()
      .some(({ props }) => props['aria-label'] === 'Pause music'),
  );
  component.unmount();
});

void test('compact record dock opens its physical player and credits without mounting or starting another audio', () => {
  const component = componentPlayer();
  component.render();
  const matches = (className: string) =>
    component.nodes().filter(({ props }) => props.className === className);
  assert.equal(component.audios.length, 1);
  assert.equal(component.audios[0].playCount, 0);
  assert.equal(matches('record-player-scene').length, 0);
  assert.equal(matches('record-player-library').length, 0);
  component.click('Choose a record and view music credits');
  assert.equal(matches('record-player-scene').length, 1);
  assert.equal(matches('record-player-library').length, 1);
  assert.equal(matches('record-player-credits').length, 1);
  const label = matches('record-player-label')[0];
  assert.equal(label.type, 'svg');
  assert.equal(label.props.viewBox, '0 0 100 100');
  assert.equal(matches('record-player-spindle')[0].props.cx, '50');
  assert.equal(matches('record-player-spindle')[0].props.cy, '50');
  assert.equal(
    component.nodes().filter(({ type }) => type === 'small').length,
    0,
  );
  assert.equal(component.audios.length, 1);
  assert.equal(component.audios[0].playCount, 0);
  component.setPresentation('standard');
  component.render();
  assert.equal(
    component.nodes().filter(({ type }) => type === 'small').length,
    3,
  );
  assert.equal(component.audios.length, 1);
  component.unmount();
});

void test('compact panel Done and Escape preserve playing audio; presentation changes do not remount it', async () => {
  const component = componentPlayer();
  component.render();
  component.click('Play music');
  const audio = component.audios[0];
  audio.pending[0].resolve();
  await Promise.resolve();
  audio.emit('playing');
  component.render();
  const pauseCount = audio.pauseCount;
  component.click('Choose a record and view music credits');
  component.click('Done');
  assert.equal(audio.paused, false);
  assert.equal(audio.pauseCount, pauseCount);
  component.click('Choose a record and view music credits');
  component.escape();
  assert.equal(audio.pauseCount, pauseCount);
  component.setPresentation('standard');
  component.render();
  assert.equal(component.audios.length, 1);
  assert.equal(audio.playCount, 1);
  assert.equal(audio.paused, false);
  component.hide();
  assert.equal(audio.paused, true);
  component.unmount();
  assert.equal(audio.src, '');
});

void test('with the transport inside the library there is no standalone bar, the panel row plays and skips, and the track title is reported', async () => {
  const component = componentPlayer();
  component.setTransportInLibrary(true);
  component.render();
  const matches = (className: string) =>
    component.nodes().filter(({ props }) => props.className === className);
  assert.equal(matches('record-player-controls').length, 0, 'no transport bar on the terrace');
  assert.equal(matches('record-player-library').length, 0);
  assert.ok(
    component.nodes().some(({ props }) => typeof props.className === 'string' && props.className.includes('record-player--panel')),
  );
  assert.equal(typeof component.titles[0], 'string', 'the current title is reported on mount');
  assert.equal(component.audios.length, 1);
  assert.equal(component.audios[0].playCount, 0);
  // Open the library the way the terrace does: through the open prop.
  component.openLibrary();
  assert.equal(matches('record-player-library').length, 1);
  assert.equal(matches('record-player-controls').length, 1, 'one transport row, inside the library');
  const library = matches('record-player-library')[0];
  const rowInside = nodesOf(library).some(({ props }) => props.className === 'record-player-controls');
  assert.ok(rowInside, 'the row is a child of the library panel');
  component.click('Play music');
  const audio = component.audios[0];
  assert.equal(audio.playCount, 1);
  audio.pending[0].resolve();
  await Promise.resolve();
  audio.emit('playing');
  component.render();
  assert.ok(component.nodes().some(({ props }) => props['aria-label'] === 'Pause music'));
  const before = component.titles.length;
  component.click('Next record');
  assert.ok(component.titles.length > before, 'skipping reports the new title');
  assert.notEqual(component.titles.at(-1), component.titles[0]);
  assert.equal(component.audios.length, 1, 'still one audio element');
  component.unmount();
});

function nodesOf(value: unknown): PlayerNode[] {
  if (Array.isArray(value)) return value.flatMap((child) => nodesOf(child));
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as PlayerNode;
  return [node, ...nodesOf(node.props.children)];
}

void test('the controls handle toggles playback from an outside gesture and is withdrawn on unmount', async () => {
  const component = componentPlayer();
  component.render();
  const handle = component.handle();
  assert.ok(handle, 'a handle is offered once mounted');
  assert.equal(component.audios[0].playCount, 0, 'nothing plays until a gesture');
  handle!.toggle();
  const audio = component.audios[0];
  assert.equal(audio.playCount, 1, 'a flick starts the record');
  audio.pending[0].resolve();
  await Promise.resolve();
  audio.emit('playing');
  component.render();
  assert.equal(audio.paused, false);
  const pauseCount = audio.pauseCount;
  component.handle()!.toggle();
  assert.equal(audio.pauseCount, pauseCount + 1, 'a second flick pauses it');
  assert.equal(component.audios.length, 1);
  component.unmount();
  assert.equal(component.handle(), null, 'the handle is withdrawn on unmount');
});

void test("Ember's own camera keeps the record playing; leaving Ember still pauses it", async () => {
  const component = componentPlayer();
  component.render();
  component.click('Play music');
  const audio = component.audios[0];
  audio.pending[0].resolve();
  await Promise.resolve();
  audio.emit('playing');
  component.render();
  const pauseCount = audio.pauseCount;
  let pausedDuringPick = false;
  component.pickPhoto(() => {
    pausedDuringPick = audio.paused;
  });
  assert.equal(
    pausedDuringPick,
    false,
    'photographing the cigar is part of the same sitting',
  );
  assert.equal(audio.paused, false);
  assert.equal(audio.pauseCount, pauseCount, 'no pause on the way out or back');
  component.hide();
  assert.equal(audio.paused, true, 'actually leaving Ember still pauses');
  component.unmount();
});
