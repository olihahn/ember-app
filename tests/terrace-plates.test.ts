import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { breezeWeight, BREEZE_HOLD_PX, BREEZE_RAMP } from '../lib/terrace/plates/breeze.ts';
import * as manifestModule from '../lib/terrace/plates/manifest.ts';
import type { SceneController, StageOptions } from '../lib/terrace/plates/types.ts';

type Listener = (event: unknown) => void;
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
  emit(type: string, payload?: Record<string, unknown>) {
    const event = payload ?? new Event(type, { cancelable: true });
    this.listeners.get(type)?.forEach((listener) => listener(event));
    return event as Event;
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((count, value) => count + value.size, 0);
  }
}

const CANVAS = { width: 1024, height: 1536 };
const unitsAt = (depth: number) => (2 * depth * Math.tan(THREE.MathUtils.degToRad(20))) / CANVAS.height;

function themeFixture() {
  return {
    version: 1,
    canvas: { ...CANVAS },
    paper: '#f2dba2',
    established: { rect: { x: 300, y: 1400, w: 200, h: 40 } },
    layers: [
      { id: 'far', file: 'far.png', rect: { x: 0, y: 0, w: 1024, h: 1536 }, depth: 40, kind: 'static' },
      { id: 'streaks', file: 'streaks.png', rect: { x: 300, y: 40, w: 700, h: 300 }, depth: 36, kind: 'drift' },
      { id: 'water', file: 'water.png', rect: { x: 0, y: 440, w: 1024, h: 420 }, depth: 18, kind: 'sea' },
      { id: 'sparkle', file: 'sparkle.png', rect: { x: 0, y: 440, w: 1024, h: 420 }, depth: 17.6, kind: 'flecks' },
      { id: 'ground', file: 'ground.png', rect: { x: 0, y: 860, w: 1024, h: 676 }, depth: 4.2, kind: 'static' },
      { id: 'swaying', file: 'swaying.png', rect: { x: 0, y: 0, w: 640, h: 1200 }, depth: 1.55, kind: 'breeze', anchor: { x: 90, y: 1180 } },
    ],
    sprites: [
      { id: 'vessel', file: 'vessel.png', rect: { x: 850, y: 470, w: 70, h: 80 }, depth: 18, kind: 'boat' },
      { id: 'bird', file: 'bird-level.png', files: ['bird-up.png', 'bird-level.png', 'bird-down.png'], rect: { x: 500, y: 250, w: 64, h: 40 }, depth: 20, kind: 'gull' },
      { id: 'dish', file: 'dish.png', rect: { x: 600, y: 1010, w: 150, h: 90 }, depth: 4.1, kind: 'static', ember: { x: 690, y: 1030 } },
      { id: 'book', file: 'book.png', rect: { x: 400, y: 980, w: 170, h: 130 }, depth: 4, kind: 'prop', destination: 'journal', caption: { dx: 0, dy: -90 } },
      { id: 'sphere', file: 'sphere.png', rect: { x: 700, y: 900, w: 140, h: 170 }, depth: 4, kind: 'prop', destination: 'atlas' },
      { id: 'lens', file: 'lens.png', rect: { x: 480, y: 1120, w: 120, h: 100 }, depth: 4, kind: 'prop', destination: 'identify' },
      { id: 'player', file: 'player.png', rect: { x: 640, y: 1080, w: 200, h: 130 }, depth: 4, kind: 'prop', destination: 'records' },
    ],
  };
}

function playerFixture() {
  const theme = themeFixture();
  theme.sprites = theme.sprites.filter((sprite) => sprite.id !== 'player');
  theme.sprites.push({
    id: 'turntable', file: 'turntable-body.png', rect: { x: 640, y: 1080, w: 200, h: 130 }, depth: 4, kind: 'player',
    caption: { dx: 0, dy: -80 },
    parts: {
      body: { file: 'turntable-body.png', rect: { x: 640, y: 1080, w: 200, h: 130 } },
      disc: { file: 'turntable-disc.png', centre: { x: 730, y: 1140 }, radius: 40, tilt: 55, yaw: -12 },
      arm: { file: 'turntable-arm.png', rect: { x: 780, y: 1090, w: 40, h: 70 }, pivot: { x: 810, y: 1100 }, restAngle: 0, playAngle: -22 },
    },
  } as never);
  return theme;
}

type FixtureOptions = {
  motion?: boolean;
  active?: boolean;
  hidden?: boolean;
  manifest?: unknown;
  status?: number;
  deferTextures?: boolean;
  host?: { width: number; height: number };
  theme?: string;
  lean?: { x: number; y: number };
  playing?: boolean;
  random?: () => number;
  imageSize?: number;
};

function stageFixture(options: FixtureOptions = {}) {
  let now = 0;
  let frameId = 0;
  const frames = new Map<number, (now: number) => void>();
  const tasks: (() => void)[] = [];
  const canvas = Object.assign(new Target(), {
    className: '',
    attributes: {} as Record<string, string>,
    removed: 0,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
    setPointerCapture() {},
    remove() {
      this.removed++;
    },
  });
  const document = Object.assign(new Target(), { hidden: options.hidden ?? false });
  const size = options.host ?? { width: 412, height: 780 };
  const host = {
    children: [] as unknown[],
    appendChild(child: unknown) {
      this.children.push(child);
      return child;
    },
    getBoundingClientRect: () => ({ width: size.width, height: size.height }),
  };
  function element() {
    const vars: Record<string, string> = {};
    return {
      style: Object.assign({} as Record<string, string>, { setProperty: (name: string, value: string) => { vars[name] = value; } }),
      vars,
      dataset: {} as Record<string, string>,
    };
  }
  const buttons = { journal: element(), atlas: element(), identify: element(), records: element() };
  const established = element();
  let resize: (() => void) | undefined;
  let disconnected = 0;
  let ready = 0;
  let failed = 0;
  let renderCount = 0;
  let disposed = 0;
  let pixelRatio = 0;
  let compiled = 0;
  const uploaded: THREE.Texture[] = [];
  const urls: string[] = [];
  const created: THREE.Texture[] = [];
  const pendingTextures: { success: (texture: THREE.Texture) => void; failure: () => void; texture: THREE.Texture }[] = [];
  let rendered: { scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;
  let fetched = '';
  const stageModule = { exports: {} as { createPlatesRenderer: (options: StageOptions) => SceneController } };
  class FakeRenderer {
    domElement = canvas;
    shadowMap = {};
    setPixelRatio(value: number) {
      pixelRatio = value;
    }
    setSize() {
      assert.equal(disposed, 0, 'resize after renderer disposal');
    }
    render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
      assert.equal(disposed, 0, 'render after renderer disposal');
      renderCount++;
      rendered = { scene, camera };
    }
    compileAsync() {
      compiled++;
      return Promise.resolve();
    }
    initTexture(texture: THREE.Texture) {
      assert.equal(disposed, 0, 'upload after renderer disposal');
      uploaded.push(texture);
    }
    dispose() {
      disposed++;
    }
    forceContextLoss() {}
  }
  const source = ts.transpileModule(
    readFileSync(new URL('../lib/terrace/plates/stage.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  );
  runInNewContext(source.outputText, {
    module: stageModule,
    exports: stageModule.exports,
    window: { devicePixelRatio: 4 },
    document,
    performance: { now: () => now },
    setTimeout: (callback: () => void) => tasks.push(callback),
    requestAnimationFrame: (callback: (now: number) => void) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    fetch: (url: string) => {
      fetched = url;
      const status = options.status ?? 200;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(options.manifest ?? themeFixture()),
      });
    },
    ResizeObserver: class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
    require(name: string) {
      if (name === 'three')
        return {
          ...THREE,
          WebGLRenderer: FakeRenderer,
          TextureLoader: class {
            load(url: string, success: (texture: THREE.Texture) => void, _progress: unknown, failure: () => void) {
              urls.push(url);
              const texture = new THREE.Texture();
              texture.image = { width: options.imageSize ?? 256, height: options.imageSize ?? 256 };
              created.push(texture);
              if (options.deferTextures) pendingTextures.push({ success, failure, texture });
              else success(texture);
              return texture;
            }
          },
        };
      if (name === './manifest') return manifestModule;
      if (name === './breeze') return { breezeWeight, BREEZE_HOLD_PX, BREEZE_RAMP };
      throw new Error(`Unexpected stage dependency: ${name}`);
    },
  });
  const controller = stageModule.exports.createPlatesRenderer({
    host: host as unknown as HTMLElement,
    buttons: buttons as unknown as StageOptions['buttons'],
    established: established as unknown as HTMLElement,
    motion: options.motion ?? true,
    playing: options.playing ?? false,
    active: options.active ?? true,
    theme: options.theme ?? '/plates/test-room/',
    lean: options.lean,
    random: options.random ?? (() => 0.37),
    onReady: () => ready++,
    onFailure: () => failed++,
  });
  let clock = 0;
  return {
    controller,
    canvas,
    document,
    frames,
    host,
    buttons,
    established,
    urls,
    created,
    uploaded,
    pendingTextures,
    fetched: () => fetched,
    rendered: () => {
      assert.ok(rendered, 'nothing rendered yet');
      return rendered;
    },
    resize: () => resize?.(),
    stats: () => ({ ready, failed, renderCount, disposed, pixelRatio, compiled, disconnected }),
    step: (time: number) => {
      now = time;
      clock = time;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(time));
    },
    /** Scene time advances at most 60 ms per frame: advance in 50 ms frames. */
    advance(ms: number) {
      for (let i = 0; i < ms / 50; i++) {
        clock += 50;
        now = clock;
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(clock));
      }
    },
    /** Let the manifest fetch, decode callbacks, compile and yielded uploads run. */
    async settle() {
      for (let round = 0; round < 24; round++) {
        for (let tick = 0; tick < 6; tick++) await Promise.resolve();
        while (tasks.length) {
          tasks.shift()!();
          await Promise.resolve();
        }
      }
    },
  };
}

function meshes(scene: THREE.Scene) {
  const found: THREE.Mesh[] = [];
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh) found.push(node);
  });
  return found;
}
const canvasX = (world: THREE.Vector3, depth: number) => world.x / unitsAt(depth) + CANVAS.width / 2;
/** The stage's clamp, restated: each layer edge outside the rest window bounds the lean. */
function expectedLean(theme: ReturnType<typeof themeFixture>, camera: THREE.PerspectiveCamera, configured = { x: 0.26, y: 0.16 }) {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const lean = { ...configured };
  for (const layer of theme.layers) {
    const d = layer.depth;
    const rate = Math.abs(1 - d / 6);
    if (rate < 1e-6) continue;
    const u = unitsAt(d);
    const halfHeight = d * tanHalf;
    const halfWidth = halfHeight * camera.aspect;
    const left = (layer.rect.x - CANVAS.width / 2) * u;
    const right = (layer.rect.x + layer.rect.w - CANVAS.width / 2) * u;
    const top = (CANVAS.height / 2 - layer.rect.y) * u;
    const bottom = (CANVAS.height / 2 - layer.rect.y - layer.rect.h) * u;
    const safe = new Set((layer as { safeEdges?: string[] }).safeEdges ?? []);
    for (const [edge, margin] of [['right', right - halfWidth], ['left', -halfWidth - left]] as const)
      if (!safe.has(edge) && margin >= 0 && margin < 1.08 * 2 * halfWidth) lean.x = Math.min(lean.x, margin / rate);
    for (const [edge, margin] of [['top', top - halfHeight], ['bottom', -halfHeight - bottom]] as const)
      if (!safe.has(edge) && margin >= 0 && margin < 1.08 * 2 * halfHeight) lean.y = Math.min(lean.y, margin / rate);
  }
  return lean;
}
const canvasY = (world: THREE.Vector3, depth: number) => CANVAS.height / 2 - world.y / unitsAt(depth);

void test('the stage waits for manifest, every texture, shader preparation and a first painted frame before ready', async () => {
  const stage = stageFixture();
  assert.equal(stage.host.children.length, 1);
  assert.equal(stage.canvas.attributes['aria-hidden'], 'true');
  assert.equal(stage.stats().pixelRatio, 1.6);
  assert.equal(stage.frames.size, 0, 'no loop before the theme is prepared');
  await stage.settle();
  assert.equal(stage.fetched(), '/plates/test-room/manifest.json');
  assert.deepEqual(stage.urls, ['/plates/test-room/far.png', '/plates/test-room/streaks.png', '/plates/test-room/water.png', '/plates/test-room/sparkle.png', '/plates/test-room/ground.png', '/plates/test-room/swaying.png', '/plates/test-room/vessel.png', '/plates/test-room/bird-level.png', '/plates/test-room/bird-up.png', '/plates/test-room/bird-down.png', '/plates/test-room/dish.png', '/plates/test-room/book.png', '/plates/test-room/sphere.png', '/plates/test-room/lens.png', '/plates/test-room/player.png']);
  assert.equal(stage.stats().compiled, 1);
  assert.equal(stage.uploaded.length, stage.created.length + 3, 'every plate texture, the halo, the ember dot and the smoke grain are uploaded before the first frame');
  assert.equal(stage.stats().ready, 0, 'decoding alone is not a painted frame');
  assert.equal(stage.frames.size, 1);
  stage.step(40);
  assert.equal(stage.stats().renderCount, 1);
  assert.equal(stage.stats().ready, 1);
  assert.equal(stage.frames.size, 1, 'motion keeps one bounded loop');
  for (const texture of stage.created) {
    assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(texture.generateMipmaps, false);
    assert.equal(texture.minFilter, THREE.LinearFilter);
  }
  const { camera, scene } = stage.rendered();
  // Portrait host 412×780 is narrower than the 2:3 canvas, so only overscan shrinks the fov:
  // fov = 2·atan(tan(20°)/1.08) ≈ 37.3°.
  assert.ok(Math.abs(camera.fov - 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) / 1.08))) < 1e-9);
  assert.equal((scene.background as THREE.Color).getHexString(), 'f2dba2', 'paper shows wherever no plate covers the view');
  stage.controller.dispose();
});

void test('cover mode narrows the field of view for a wide viewport, a custom theme path is honoured, and a theme without paper falls back to neutral', async () => {
  const theme = themeFixture();
  delete (theme as { paper?: string }).paper;
  const stage = stageFixture({ host: { width: 800, height: 400 }, theme: '/plates/salon', manifest: theme });
  await stage.settle();
  stage.step(40);
  assert.equal(stage.fetched(), '/plates/salon/manifest.json');
  assert.equal(stage.urls[0], '/plates/salon/far.png');
  const { camera, scene } = stage.rendered();
  const expected = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) * ((1024 / 1536) / 2) / 1.08));
  assert.ok(Math.abs(camera.fov - expected) < 1e-9);
  assert.equal((scene.background as THREE.Color).getHexString(), 'efefef', 'a theme that declares no paper gets a neutral ground');
  stage.controller.dispose();
});

void test('kinds build the expected planes: depth-ordered unlit plates, sea/flecks/drift uniforms, subdivided breeze, boat, flock, props, smoke and ember', async () => {
  const stage = stageFixture();
  await stage.settle();
  stage.step(40);
  const { scene } = stage.rendered();
  const all = meshes(scene);
  const byKind = (kind: string) => all.filter((mesh) => mesh.userData.plateKind === kind);
  assert.equal(byKind('static').length, 3);
  assert.equal(byKind('gull').length, 3);
  assert.equal(byKind('prop').length, 4);
  assert.ok(scene.getObjectByName('sphere') instanceof THREE.Group, 'the globe rocks about its base');
  const plates = all.filter((mesh) => mesh.userData.plateKind && mesh.userData.plateKind !== 'gull');
  const orders = plates.map((mesh) => mesh.renderOrder);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'plates draw in ascending render order');
  const depthOf = (mesh: THREE.Mesh) => -mesh.getWorldPosition(new THREE.Vector3()).z;
  const sortedByDepth = [...plates].sort((a, b) => depthOf(b) - depthOf(a) || a.renderOrder - b.renderOrder);
  assert.deepEqual(plates.map((mesh) => mesh.name), sortedByDepth.map((mesh) => mesh.name), 'far to near by depth across layers and sprites');
  const ground = scene.getObjectByName('ground')!;
  const book = scene.getObjectByName('book')!;
  assert.ok(book.renderOrder > ground.renderOrder, 'a prop at depth 4.0 draws after the layer at 4.2 behind it');
  const flockOrder = byKind('gull')[0].renderOrder;
  assert.ok(plates.filter((mesh) => depthOf(mesh) < 20).every((mesh) => mesh.renderOrder > flockOrder), 'the flock draws before everything nearer than its depth');
  for (const mesh of plates) {
    const material = mesh.material as THREE.MeshBasicMaterial;
    assert.ok(material instanceof THREE.MeshBasicMaterial, `${mesh.name} is unlit`);
    assert.equal(material.transparent, true);
    assert.equal(material.depthWrite, false);
    assert.equal(material.alphaTest, 0.02);
    assert.equal(material.toneMapped, false);
  }
  const water = byKind('sea')[0].material as THREE.MeshBasicMaterial;
  assert.deepEqual(Object.keys(water.userData.uniforms).sort(), ['plateAmp', 'plateClock', 'platePhase', 'plateScroll', 'plateTime']);
  const periods = (clock: THREE.Vector3) => [clock.x, clock.y, clock.z].map((w) => (Math.PI * 2) / w);
  assert.deepEqual(periods(water.userData.uniforms.plateClock.value).map((p) => Math.round(p * 10) / 10), [7.3, 11, 9.7], 'sea strokes breathe on 7.3 s and 11 s clocks');
  assert.ok(Math.abs(water.userData.uniforms.plateAmp.value.x - 8 / 1024) < 1e-12, 'sea strokes breathe eight canvas pixels sideways');
  assert.ok(Math.abs(water.userData.uniforms.plateAmp.value.y - 1.5 / 420) < 1e-12, 'with a slow 1.5 px lift');
  assert.equal(water.userData.uniforms.plateScroll.value, 0, 'the sea itself does not scroll');
  assert.equal(water.customProgramCacheKey(), 'plates-sea-v3');
  assert.equal(water.map!.wrapS, THREE.ClampToEdgeWrapping);
  const sparkle = byKind('flecks')[0].material as THREE.MeshBasicMaterial;
  assert.ok(Math.abs(sparkle.userData.uniforms.plateAmp.value.x - 6 / 1024) < 1e-12, 'flecks drift six canvas pixels');
  assert.ok(Math.abs(sparkle.userData.uniforms.plateScroll.value - 10 / 1024) < 1e-12, 'flecks glide ten canvas px per second');
  assert.equal(sparkle.map!.wrapS, THREE.RepeatWrapping, 'only the flecks texture repeats for the scroll');
  assert.equal(sparkle.map!.wrapT, THREE.ClampToEdgeWrapping);
  const streaks = byKind('drift')[0].material as THREE.MeshBasicMaterial;
  assert.ok(streaks.userData.uniforms.plateDrift);
  assert.ok(streaks.userData.uniforms.platePhase, 'clouds start somewhere along their drift');
  assert.deepEqual(periods(sparkle.userData.uniforms.plateClock.value).map((p) => Math.round(p * 10) / 10), [8.3, 12.6, 6.1], 'flecks keep their own clocks');
  assert.equal(streaks.map!.wrapS, THREE.RepeatWrapping, 'drift repeats horizontally');
  const swaying = byKind('breeze')[0];
  const parameters = (swaying.geometry as THREE.PlaneGeometry).parameters;
  assert.equal(parameters.widthSegments, 16);
  assert.equal(parameters.heightSegments, 24);
  const sway = (swaying.material as THREE.MeshBasicMaterial).userData.uniforms;
  assert.ok(sway.plateAnchor && sway.plateReach && sway.plateSway && sway.plateHold);
  assert.deepEqual(periods(sway.plateClock.value).map((p) => Math.round(p * 10) / 10), [5, 13, 8.6], 'the breeze gusts on 5 s and 13 s clocks, unrelated to the sea');
  assert.ok(Math.abs(sway.plateSway.value - 10 * unitsAt(1.55)) < 1e-12, 'breeze amplitude is ten canvas pixels');
  assert.ok(Math.abs(swaying.position.z + 1.55) < 1e-12);
  const far = byKind('static').find((mesh) => mesh.name === 'far')!;
  assert.ok(Math.abs(far.position.x) < 1e-12 && Math.abs(far.position.y) < 1e-12, 'a full-canvas layer is centred on the axis');
  assert.ok(byKind('boat')[0]);
  const unitsAtDish = unitsAt(4.1);
  const smokeGroup = scene.getObjectByName('smoke wisps')!;
  const strokes = smokeGroup.children.filter((child) => child.name.startsWith('wisp-')) as THREE.Mesh[];
  const haze = smokeGroup.children.find((child) => child.name === 'haze') as THREE.Mesh;
  assert.equal(strokes.length, 3, 'three ink strokes');
  assert.ok(haze, 'over one faint haze');
  assert.equal(smokeGroup.children[0], haze, 'the haze draws first, behind the strokes');
  assert.ok((haze.material as THREE.MeshBasicMaterial).opacity <= 0.06 + 1e-12);
  const expected = [
    { half: 3, height: 260, opacity: 0.7 },
    { half: 4, height: 245, opacity: 0.55 },
    { half: 5, height: 230, opacity: 0.4 },
  ];
  const rates = new Set<number>();
  strokes.forEach((stroke, i) => {
    const material = stroke.material as THREE.MeshBasicMaterial;
    assert.equal(material.color.getHexString(), '173e42', 'ink strokes');
    assert.ok(Math.abs(material.opacity - expected[i].opacity) < 1e-12, `stroke ${i} opacity`);
    assert.equal(material.blending, THREE.NormalBlending, 'ink over paper, never additive');
    assert.equal(material.customProgramCacheKey(), 'plates-wisp-v4');
    const mask = (material.map as THREE.DataTexture).image.data as Uint8Array;
    for (let p = 0; p < mask.length; p += 4) assert.ok(mask[p] === 255 && mask[p + 1] === 255 && mask[p + 2] === 255, 'the grain is a white coverage mask');
    const uniforms = material.userData.uniforms;
    const period = (Math.PI * 2) / uniforms.wispRate.value;
    assert.ok(period >= 6 && period <= 9, `sway period ${period.toFixed(2)} s`);
    rates.add(uniforms.wispRate.value);
    const geometry = (stroke.geometry as THREE.PlaneGeometry).parameters;
    const planeWidth = geometry.width / unitsAtDish;
    const baseHalf = uniforms.wispHalf.value.x * planeWidth;
    const topHalf = uniforms.wispHalf.value.y * planeWidth;
    assert.ok(Math.abs(baseHalf - expected[i].half) < 1e-9, `stroke ${i} base half-width`);
    assert.ok(Math.abs(topHalf / baseHalf - 2) < 1e-9, 'widens only 2× toward the top');
    assert.ok(Math.abs(geometry.height / unitsAtDish - expected[i].height) < 1e-9, `stroke ${i} height`);
    assert.ok(Math.abs(uniforms.wispCurl.value.x * planeWidth - 26) < 1e-9 && Math.abs(uniforms.wispCurl.value.y * planeWidth - 12) < 1e-9, 'curl amplitudes of 26 and 12 canvas px');
    const swing = uniforms.wispSwing.value * planeWidth;
    const swingPeriod = (Math.PI * 2) / uniforms.wispSwingRate.value;
    assert.ok(Math.abs(swing - 6) < 1e-9 && swingPeriod >= 9 && swingPeriod <= 13, 'a slow ±6 px swing of the whole line');
    assert.ok(planeWidth >= 2 * (26 + 12 + 6) + topHalf * 2, 'the plane holds the full excursion plus the top width');
    assert.ok(Math.abs(uniforms.wispEdge.value * planeWidth - 1.5) < 1e-9, 'a soft 1.5 px edge');
    assert.ok(Math.abs(uniforms.wispGrainMix.value - 0.3) < 1e-12, 'grain breaks the line as 0.7 + 0.3·grain');
  });
  assert.equal(rates.size, 3, 'each stroke curls on its own period');
  assert.deepEqual(strokes.map((stroke) => Math.round(stroke.position.x / unitsAtDish)), [-4, 0, 4], 'strokes start ±4 px apart at the base');
  const sprites: THREE.Sprite[] = [];
  scene.traverse((node) => {
    if (node instanceof THREE.Sprite) sprites.push(node);
  });
  assert.equal(sprites.length, 2, 'an ember dot and its halo');
  const halo = scene.getObjectByName('ember halo') as THREE.Sprite;
  const ember = scene.getObjectByName('ember') as THREE.Sprite;
  assert.equal((halo.material as THREE.SpriteMaterial).blending, THREE.AdditiveBlending);
  assert.ok((halo.material as THREE.SpriteMaterial).opacity <= 0.35 + 1e-12);
  assert.ok(Math.abs(halo.scale.x - 32 * unitsAtDish) < 1e-12, 'a soft 16 px radius warm halo');
  assert.equal(((halo.material as THREE.SpriteMaterial).map as THREE.DataTexture).colorSpace, THREE.SRGBColorSpace);
  assert.equal((ember.material as THREE.SpriteMaterial).blending, THREE.NormalBlending, 'the dot is solid ink, not additive');
  assert.ok(Math.abs(ember.scale.x - 8 * unitsAtDish) < 1e-12, 'a 4 px radius rust dot');
  const dotPixels = ((ember.material as THREE.SpriteMaterial).map as THREE.DataTexture).image.data as Uint8Array;
  const centre = (16 * 32 + 16) * 4;
  assert.ok(dotPixels[centre] <= 0xa2 && dotPixels[centre + 1] <= 0x41 && dotPixels[centre + 2] <= 0x26 && dotPixels[centre + 3] === 255, 'darker rust #a03f24 at the core, opaque');
  const rim = (16 * 32 + 28) * 4;
  assert.ok(dotPixels[rim] > dotPixels[centre], 'lightening toward the rim');
  assert.ok(ember.renderOrder > halo.renderOrder, 'the dot sits on the halo');
  const bird = scene.getObjectByName('bird-0') as THREE.Mesh;
  const birdUv = bird.geometry.getAttribute('uv');
  assert.deepEqual([Math.min(...birdUv.array), Math.max(...birdUv.array)], [0, 1], 'gull planes sample the whole frame once');
  assert.equal((bird.material as THREE.MeshBasicMaterial).map!.wrapS, THREE.ClampToEdgeWrapping, 'no repeat on bird textures');
  for (const destination of ['journal', 'atlas', 'identify', 'records'] as const) {
    const button = stage.buttons[destination];
    assert.equal(button.dataset.projected, 'true');
    assert.equal(button.style.visibility, 'visible');
    assert.ok(Number.parseFloat(button.style.width) >= 44);
  }
  stage.controller.dispose();
});

void test('captions follow the theme offset from the object centre and default below the object', async () => {
  const stage = stageFixture();
  await stage.settle();
  stage.step(40);
  const book = stage.buttons.journal;
  const dy = Number.parseFloat(book.vars['--caption-dy']);
  const dx = Number.parseFloat(book.vars['--caption-dx']);
  assert.ok(dy < -20 && Math.abs(dx) < 1e-6, `a caption 90 canvas px above the book sits above it on screen (${dy.toFixed(1)} px)`);
  const lens = stage.buttons.identify;
  assert.ok(Number.parseFloat(lens.vars['--caption-dy']) > 20, 'without a theme offset the caption sits below the object');
  assert.equal(lens.vars['--caption-dx'], '0px');
  assert.equal(stage.established.dataset.projected, undefined, 'an established rect in the manifest is accepted but no longer lettered');
  stage.controller.dispose();
});

void test('the lean is clamped by the plates: no layer edge can enter the view, and a theme lean or explicit option still bounds it', async () => {
  const theme = themeFixture();
  // A near layer whose sides sit just outside the rest window at depth 2.
  theme.layers.push({ id: 'near', file: 'near.png', rect: { x: 100, y: -30, w: 824, h: 1596 }, depth: 2, kind: 'static' });
  const stage = stageFixture({ manifest: theme });
  await stage.settle();
  stage.step(40);
  const { camera } = stage.rendered();
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const u = unitsAt(2);
  const halfWidth = 2 * tanHalf * camera.aspect;
  const nearLimit = ((924 - 512) * u - halfWidth) / Math.abs(1 - 2 / 6);
  const expected = expectedLean(theme, camera);
  const lean = stage.controller.inspect!().lean;
  assert.ok(nearLimit < 0.26, 'the fixture really needs a clamp');
  assert.ok(Math.abs(expected.x - nearLimit) < 1e-9, 'the near layer is the tightest side margin');
  assert.ok(Math.abs(lean.x - expected.x) < 1e-9, `lean.x clamps to ${expected.x.toFixed(4)}`);
  assert.ok(Math.abs(lean.y - expected.y) < 1e-9);
  const expectedX = expected.x;
  stage.canvas.emit('pointerdown', { isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  stage.canvas.emit('pointermove', { pointerId: 1, clientX: 4000, clientY: 0 });
  stage.advance(4000);
  assert.ok(Math.abs(camera.position.x - expectedX) < 1e-6, 'the camera never leans past the plate margin');
  stage.controller.dispose();
  const themed = { ...themeFixture(), lean: { x: 0.05, y: 0.03 } };
  for (const [options, expected] of [
    [{ manifest: themed }, 0.05],
    [{ manifest: themed, lean: { x: 0.3, y: 0.2 } }, 0.26],
  ] as [FixtureOptions, number][]) {
    const bounded = stageFixture(options);
    await bounded.settle();
    bounded.step(40);
    const view = bounded.rendered().camera;
    bounded.canvas.emit('pointerdown', { isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    bounded.canvas.emit('pointermove', { pointerId: 1, clientX: 4000, clientY: 0 });
    bounded.advance(4000);
    assert.ok(Math.abs(view.position.x - Math.min(expected, bounded.controller.inspect!().lean.x)) < 1e-6);
    bounded.controller.dispose();
  }
});

void test('safe edges are painted boundaries: a layer marked right/top only constrains the lean on its left and bottom', async () => {
  const theme = themeFixture();
  // Without the fixture's own foreground plate, the near layer is the only clamp.
  theme.layers = theme.layers.filter((layer) => layer.id !== 'swaying');
  // Its top edge sits inside the view (trimmed art, ignored); left, right and bottom sit just outside.
  const near = { id: 'near', file: 'near.png', rect: { x: 100, y: 200, w: 824, h: 1300 }, depth: 2, kind: 'static' };
  theme.layers.push(near as never);
  const tight = stageFixture({ manifest: theme });
  await tight.settle();
  tight.step(40);
  const before = tight.controller.inspect!().lean;
  const camera = tight.rendered().camera;
  assert.ok(Math.abs(before.x - expectedLean(theme, camera).x) < 1e-9 && before.x < 0.26 && before.y < 0.16, 'both axes are clamped by the near layer');
  tight.controller.dispose();
  (near as { safeEdges?: string[] }).safeEdges = ['right', 'top'];
  const eased = stageFixture({ manifest: theme });
  await eased.settle();
  eased.step(40);
  const after = eased.controller.inspect!().lean;
  const expected = expectedLean(theme, eased.rendered().camera);
  assert.ok(Math.abs(after.x - expected.x) < 1e-9 && Math.abs(after.y - expected.y) < 1e-9);
  // The left and bottom margins of the near layer are symmetric with the safe
  // right and top ones, so the limits are unchanged in value but now come
  // only from the constrained sides; widen those sides and the lean grows.
  (near as { rect: { x: number; w: number; y: number; h: number } }).rect = { x: -300, y: 200, w: 1224, h: 1700 };
  const roomy = stageFixture({ manifest: theme });
  await roomy.settle();
  roomy.step(40);
  const widened = roomy.controller.inspect!().lean;
  assert.ok(widened.x > after.x && widened.y > after.y, 'a wider left/bottom margin eases the clamp');
  assert.ok(Math.abs(widened.x - expectedLean(theme, roomy.rendered().camera).x) < 1e-9);
  (near as { safeEdges?: string[] }).safeEdges = ['left', 'right', 'top', 'bottom'];
  const free = stageFixture({ manifest: theme });
  await free.settle();
  free.step(40);
  const unconstrained = free.controller.inspect!().lean;
  const rest = { ...theme, layers: theme.layers.filter((layer) => layer.id !== 'near') };
  assert.ok(Math.abs(unconstrained.x - expectedLean(rest, free.rendered().camera).x) < 1e-9, 'with every edge safe the layer no longer clamps at all');
  roomy.controller.dispose();
  eased.controller.dispose();
  free.controller.dispose();
});

void test('motion drives time; motion off is a deterministic rest frame with the boat at its manifest spot, the ember still and the glint idle', async () => {
  const stage = stageFixture({ motion: false });
  await stage.settle();
  stage.step(40);
  const { scene } = stage.rendered();
  const all = meshes(scene);
  const water = all.find((mesh) => mesh.userData.plateKind === 'sea')!.material as THREE.MeshBasicMaterial;
  const vessel = all.find((mesh) => mesh.userData.plateKind === 'boat')!;
  const bird = all.find((mesh) => mesh.userData.plateKind === 'gull')!;
  const restX = vessel.position.x;
  const restBird = bird.position.clone();
  assert.ok(Math.abs(restX - (850 + 35 - 512) * unitsAt(18)) < 1e-12, 'the rest pose is the manifest placement');
  assert.equal(vessel.visible, true);
  stage.controller.setMotion(true);
  stage.advance(3000);
  assert.ok(water.userData.uniforms.plateTime.value > 0);
  assert.notEqual(vessel.position.x, restX);
  const dotMaterial = (scene.getObjectByName('ember') as THREE.Sprite).material as THREE.SpriteMaterial;
  const haloMaterial = (scene.getObjectByName('ember halo') as THREE.Sprite).material as THREE.SpriteMaterial;
  const pulses = new Set<number>();
  for (let i = 0; i < 12; i++) {
    stage.advance(50);
    pulses.add(dotMaterial.opacity);
    assert.ok(dotMaterial.opacity >= 0.75 - 1e-9 && dotMaterial.opacity <= 1 + 1e-9);
    assert.ok(haloMaterial.opacity >= 0.15 - 1e-9 && haloMaterial.opacity <= 0.35 + 1e-9);
  }
  assert.ok(pulses.size > 3, 'the ember pulses with motion');
  stage.controller.setMotion(false);
  stage.advance(50);
  assert.equal(water.userData.uniforms.plateTime.value, 0);
  assert.ok(Math.abs(vessel.position.x - restX) < 1e-12, 'the boat returns to its rest position');
  assert.ok(bird.position.equals(restBird));
  assert.equal(dotMaterial.opacity, 0.875, 'with motion off the ember is static');
  assert.equal(haloMaterial.opacity, 0.25);
  assert.equal(stage.frames.size, 0, 'a still print needs no loop');
  const glint = all.find((mesh) => mesh.parent?.name === 'player' && mesh.material instanceof THREE.ShaderMaterial)!;
  assert.equal((glint.material as THREE.ShaderMaterial).uniforms.sweepActive.value, 0);
  stage.controller.setMotion(true);
  stage.controller.setPlaying(true, 'Sunset Bossa');
  stage.advance(100);
  assert.equal((glint.material as THREE.ShaderMaterial).uniforms.sweepActive.value, 1, 'playing records shows a slow sheen');
  assert.equal(stage.controller.inspect!().trackTitle, 'Sunset Bossa');
  stage.controller.dispose();
});

void test('props idle quietly: the globe rocks ±1.5° about its base on a 7 s period and a glint crosses the lens every ~9 s', async () => {
  const stage = stageFixture();
  await stage.settle();
  stage.step(40);
  const { scene } = stage.rendered();
  const globe = scene.getObjectByName('sphere') as THREE.Group;
  assert.ok(Math.abs(canvasY(globe.position, 4) - 1070) < 1e-9, 'the group sits at the base of the rect');
  const angles: number[] = [];
  for (let i = 0; i < 160; i++) {
    stage.advance(50);
    angles.push(globe.rotation.z);
  }
  const limit = THREE.MathUtils.degToRad(1.5);
  assert.ok(Math.max(...angles) <= limit + 1e-9 && Math.min(...angles) >= -limit - 1e-9);
  assert.ok(Math.max(...angles) > limit * 0.9 && Math.min(...angles) < -limit * 0.9, 'it reaches both extremes within eight seconds');
  const lens = scene.getObjectByName('lens') as THREE.Mesh;
  const glint = lens.children[0] as THREE.Mesh;
  const material = glint.material as THREE.ShaderMaterial;
  assert.equal(material.blending, THREE.AdditiveBlending);
  assert.equal(material.uniforms.sweepPeriod.value, 9);
  assert.equal(material.uniforms.sweepActive.value, 1, 'the lens glint does not depend on playback');
  assert.ok(material.uniforms.sweepMask.value, 'the glint is masked to the lens silhouette');
  stage.controller.dispose();
});

void test('the loop pauses for hidden, inactive and reduced motion, and disposal releases everything exactly once', async () => {
  const stage = stageFixture();
  await stage.settle();
  stage.step(40);
  const { scene } = stage.rendered();
  const geometryDisposals = new Map<THREE.BufferGeometry, number>();
  const materialDisposals = new Map<THREE.Material, number>();
  for (const mesh of meshes(scene)) {
    if (!geometryDisposals.has(mesh.geometry)) {
      geometryDisposals.set(mesh.geometry, 0);
      mesh.geometry.addEventListener('dispose', () => geometryDisposals.set(mesh.geometry, geometryDisposals.get(mesh.geometry)! + 1));
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (materialDisposals.has(material)) continue;
      materialDisposals.set(material, 0);
      material.addEventListener('dispose', () => materialDisposals.set(material, materialDisposals.get(material)! + 1));
    }
  }
  // 6 layers + boat + wake + 3 gulls + ashtray + 4 props + 4 smoke = 20 geometries;
  // the lens and record glints share their prop's geometry.
  assert.equal(geometryDisposals.size, 20);
  assert.ok(materialDisposals.size >= 20 && materialDisposals.size <= 22, 'gulls show one to three frame materials at this instant');
  const textureDisposals = new Map<THREE.Texture, number>();
  for (const texture of stage.created) {
    textureDisposals.set(texture, 0);
    texture.addEventListener('dispose', () => textureDisposals.set(texture, textureDisposals.get(texture)! + 1));
  }
  stage.document.hidden = true;
  stage.document.emit('visibilitychange');
  assert.equal(stage.frames.size, 0);
  stage.controller.setPlaying(true);
  assert.equal(stage.frames.size, 0);
  stage.document.hidden = false;
  stage.document.emit('visibilitychange');
  assert.equal(stage.frames.size, 1);
  stage.controller.setActive(false);
  assert.equal(stage.frames.size, 0);
  stage.controller.setActive(true);
  assert.equal(stage.frames.size, 1);
  stage.controller.setMotion(false);
  stage.step(80);
  assert.equal(stage.frames.size, 0);
  stage.controller.dispose();
  stage.controller.dispose();
  assert.equal(stage.stats().disposed, 1);
  assert.equal(stage.stats().disconnected, 1);
  assert.equal(stage.document.listenerCount, 0);
  assert.equal(stage.canvas.listenerCount, 0);
  assert.equal(stage.canvas.removed, 1);
  for (const [geometry, count] of geometryDisposals) assert.equal(count, 1, `geometry ${geometry.uuid}`);
  for (const [material, count] of materialDisposals) assert.equal(count, 1, `material ${material.uuid}`);
  for (const [texture, count] of textureDisposals) assert.equal(count, 1, `texture ${texture.uuid}`);
  assert.equal(stage.frames.size, 0);
  stage.resize();
  stage.controller.setActive(true);
  assert.equal(stage.frames.size, 0, 'a disposed stage never schedules again');
});

void test('an invalid manifest, a failed fetch, or a failed texture is terminal and disposes without a frame', async () => {
  const broken = themeFixture();
  broken.sprites[3].destination = 'nowhere';
  for (const options of [
    { manifest: broken },
    { status: 404 },
    { manifest: { version: 1 } },
  ] as FixtureOptions[]) {
    const stage = stageFixture(options);
    await stage.settle();
    assert.equal(stage.stats().failed, 1);
    assert.equal(stage.stats().disposed, 1);
    assert.equal(stage.stats().ready, 0);
    assert.equal(stage.frames.size, 0);
    assert.equal(stage.canvas.removed, 1);
    let opened = 0;
    stage.controller.enter('journal', () => opened++);
    assert.equal(opened, 0, 'a dead stage ignores late entrances; the component navigates directly when not ready');
  }
  const deferred = stageFixture({ deferTextures: true });
  await deferred.settle();
  assert.equal(deferred.pendingTextures.length, 15);
  const released = new Map<THREE.Texture, number>();
  for (const pending of deferred.pendingTextures) {
    released.set(pending.texture, 0);
    pending.texture.addEventListener('dispose', () => released.set(pending.texture, released.get(pending.texture)! + 1));
  }
  deferred.pendingTextures[2].failure();
  assert.equal(deferred.stats().failed, 1);
  assert.equal(deferred.stats().disposed, 1);
  deferred.pendingTextures[5].success(deferred.pendingTextures[5].texture);
  await deferred.settle();
  for (const [texture, count] of released) assert.equal(count, 1, `pending texture ${texture.uuid} released exactly once, including the late decode`);
  assert.equal(deferred.stats().ready, 0);
  assert.equal(deferred.stats().compiled, 0);
  assert.equal(deferred.frames.size, 0);
});

void test('context loss is terminal before pending decodes can revive the stage', async () => {
  const stage = stageFixture({ deferTextures: true });
  await stage.settle();
  const event = stage.canvas.emit('webglcontextlost');
  assert.equal(event.defaultPrevented, true);
  assert.equal(stage.stats().failed, 1);
  assert.equal(stage.stats().disposed, 1);
  for (const pending of stage.pendingTextures) pending.success(pending.texture);
  await stage.settle();
  assert.equal(stage.stats().ready, 0);
  assert.equal(stage.stats().compiled, 0);
  assert.equal(stage.frames.size, 0);
});

void test('dragging leans the seated camera within limits and eases back on reset', async () => {
  const stage = stageFixture();
  await stage.settle();
  stage.step(40);
  const { camera } = stage.rendered();
  assert.deepEqual([camera.position.x, camera.position.y], [0, 0]);
  const lean = stage.controller.inspect!().lean;
  const expected = expectedLean(themeFixture(), camera);
  assert.ok(Math.abs(lean.x - expected.x) < 1e-12 && Math.abs(lean.y - expected.y) < 1e-12, 'the fixture\'s foreground plate bounds the default lean');
  assert.ok(lean.x <= 0.26 && lean.y <= 0.16);
  stage.canvas.emit('pointerdown', { isPrimary: true, button: 0, pointerId: 7, clientX: 200, clientY: 400 });
  stage.canvas.emit('pointermove', { pointerId: 7, clientX: 900, clientY: -900 });
  stage.advance(4000);
  assert.ok(Math.abs(camera.position.x - lean.x) < 1e-6, 'x lean clamps at the limit');
  assert.ok(Math.abs(camera.position.y - lean.y) < 1e-6, 'y lean clamps at the limit');
  const lookedAt = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  assert.ok(lookedAt.x < 0 && lookedAt.y < 0, 'the camera still looks at the fixed target');
  stage.canvas.emit('pointermove', { pointerId: 9, clientX: 0, clientY: 0 });
  stage.advance(50);
  assert.ok(Math.abs(camera.position.x - lean.x) < 1e-6, 'another pointer does not steer');
  stage.canvas.emit('pointerup', { pointerId: 7 });
  stage.controller.setMotion(false);
  stage.controller.resetView();
  const before = camera.position.x;
  stage.advance(50);
  assert.ok(camera.position.x < before && camera.position.x > 0, 'reset eases rather than snaps');
  stage.advance(6000);
  assert.ok(Math.abs(camera.position.x) < 0.001 && Math.abs(camera.position.y) < 0.001);
  assert.equal(stage.frames.size, 0, 'the loop stops once the lean has settled');
  stage.controller.dispose();
});

void test('the boat sails one way across the open water, leaves, waits out of sight and returns already mirrored; it never turns on screen', async () => {
  const stage = stageFixture();
  await stage.settle();
  stage.step(40);
  const { scene } = stage.rendered();
  const vessel = scene.getObjectByName('vessel') as THREE.Mesh;
  const wake = vessel.children[0] as THREE.Mesh;
  assert.equal((wake.material as THREE.MeshBasicMaterial).blending, THREE.AdditiveBlending, 'one tiny additive wake stroke');
  assert.equal(vessel.scale.x, 1, 'sails right at rest');
  let mirror = vessel.scale.x;
  let crossings = 0;
  let hidden = 0;
  let mirrorChangesOnScreen = 0;
  let wasVisible = vessel.visible;
  const heels: number[] = [];
  for (let sample = 0; sample < 1200; sample++) {
    stage.advance(250);
    const x = canvasX(vessel.position, 18);
    const offScreen = !vessel.visible || x + 35 <= 0 || x - 35 >= CANVAS.width;
    if (vessel.scale.x !== mirror) {
      if (!offScreen) mirrorChangesOnScreen++;
      mirror = vessel.scale.x;
    }
    if (!vessel.visible) hidden++;
    if (vessel.visible && !wasVisible) crossings++;
    wasVisible = vessel.visible;
    if (vessel.visible) {
      assert.ok(Math.sign(vessel.rotation.z) === -Math.sign(vessel.scale.x), 'heels into the direction of travel');
      heels.push(THREE.MathUtils.radToDeg(Math.abs(vessel.rotation.z)));
    }
  }
  assert.equal(mirrorChangesOnScreen, 0, 'the mirror only changes while fully off screen');
  assert.ok(crossings >= 2, 'it returns for later crossings');
  assert.ok(hidden > 40, 'and waits out of sight between them');
  assert.ok(Math.min(...heels) >= 3.99 && Math.max(...heels) <= 6.01, 'heel stays between 4° and 6°');
  stage.controller.setMotion(false);
  stage.advance(50);
  assert.equal(vessel.scale.x, 1, 'motion off returns to the rest heading');
  assert.equal(vessel.visible, true);
  stage.controller.dispose();
});

void test('gulls only ever fly left to right, never mirror, flap in bursts then glide, bank at most 6° and stay above the horizon', async () => {
  const stage = stageFixture();
  await stage.settle();
  stage.step(40);
  const { scene } = stage.rendered();
  const birds = [0, 1, 2].map((i) => scene.getObjectByName(`bird-${i}`) as THREE.Mesh);
  assert.deepEqual(birds.map((bird) => bird.scale.y), [0.8, 1.2, 1.0]);
  const frames = new Set<THREE.Material>();
  const visibleSamples = [0, 0, 0];
  const heights = [new Set<number>(), new Set<number>(), new Set<number>()];
  const entries = [0, 0, 0];
  const lastX = [-Infinity, -Infinity, -Infinity];
  const wasVisible = birds.map((bird) => bird.visible);
  const waits: number[] = [];
  let waitStart: number | null = null;
  for (let sample = 0; sample < 2400; sample++) {
    stage.advance(100);
    birds.forEach((bird, i) => {
      frames.add(bird.material as THREE.Material);
      assert.equal(bird.scale.x, bird.scale.y, `bird ${i} is never mirrored`);
      const x = canvasX(bird.position, 20);
      const y = canvasY(bird.position, 20);
      const halfH = (40 * bird.scale.y) / 2;
      if (bird.visible) {
        visibleSamples[i]++;
        if (wasVisible[i]) assert.ok(x >= lastX[i] - 1e-6, `bird ${i} only travels left to right`);
        assert.ok(y + halfH <= CANVAS.height * 0.26 + 1e-6, `bird ${i} stays above the horizon`);
        assert.ok(y - halfH >= 180 - 1e-6, `bird ${i} stays below the masthead corner`);
        assert.ok(Math.abs(bird.rotation.z) <= THREE.MathUtils.degToRad(6) + 1e-9, 'banks at most six degrees');
        heights[i].add(Math.round(y / 20));
        if (!wasVisible[i]) {
          entries[i]++;
          assert.ok(x < 100, `bird ${i} re-enters from the left`);
          if (i === 0 && waitStart !== null) waits.push((sample * 100 - waitStart) / 1000);
        }
        lastX[i] = x;
      } else if (i === 0 && wasVisible[i]) waitStart = sample * 100;
      wasVisible[i] = bird.visible;
    });
  }
  assert.equal(frames.size, 3, 'up, level and down frames all appear');
  birds.forEach((_bird, i) => {
    assert.ok(visibleSamples[i] > 100, `bird ${i} crosses the screen`);
    assert.ok(entries[i] >= 2, `bird ${i} leaves and comes back`);
    assert.ok(heights[i].size >= 2, `bird ${i} drifts in altitude`);
  });
  assert.ok(waits.length >= 1 && waits.every((wait) => wait >= 3.9 && wait <= 14.3), `waits of 4–14 s between crossings (${waits.map((w) => w.toFixed(1)).join(', ')})`);
  const paths = birds.map((_bird, i) => [...heights[i]].join(','));
  assert.equal(new Set(paths).size, 3, 'no two birds fly the same path');
  let switches = 0;
  for (let i = 0; i < 120; i++) {
    const before = birds[0].material;
    stage.advance(50);
    if (birds[0].material !== before) switches++;
  }
  assert.ok(switches > 0, 'wings beat');
  stage.controller.dispose();
});

void test('several boats sail independently, each on its own period and wait, mirroring only off screen', async () => {
  const theme = themeFixture();
  theme.sprites.push({ id: 'skiff', file: 'skiff.png', rect: { x: 300, y: 520, w: 50, h: 60 }, depth: 19, kind: 'boat', route: { period: 60 } } as never);
  const stage = stageFixture({ manifest: theme });
  await stage.settle();
  stage.step(40);
  const { scene } = stage.rendered();
  const boats = [scene.getObjectByName('vessel') as THREE.Mesh, scene.getObjectByName('skiff') as THREE.Mesh];
  const mirrors = boats.map((boat) => boat.scale.x);
  const onScreenMirrorChanges = [0, 0];
  const bothVisible: number[] = [];
  let anyVisible = 0;
  const hidden = [0, 0];
  const halves = [35, 25];
  const depths = [18, 19];
  const relative: number[] = [];
  for (let sample = 0; sample < 1600; sample++) {
    stage.advance(250);
    boats.forEach((boat, i) => {
      const x = canvasX(boat.position, depths[i]);
      const offScreen = !boat.visible || x + halves[i] <= 0 || x - halves[i] >= CANVAS.width;
      if (boat.scale.x !== mirrors[i]) {
        if (!offScreen) onScreenMirrorChanges[i]++;
        mirrors[i] = boat.scale.x;
      }
      if (!boat.visible) hidden[i]++;
    });
    if (boats[0].visible || boats[1].visible) anyVisible++;
    if (boats[0].visible && boats[1].visible) {
      bothVisible.push(sample);
      relative.push(canvasX(boats[0].position, 18) - canvasX(boats[1].position, 19));
    }
  }
  assert.deepEqual(onScreenMirrorChanges, [0, 0], 'neither boat turns on screen');
  assert.ok(hidden[0] > 20 && hidden[1] > 20, 'each boat spends time out of sight');
  assert.ok(anyVisible / 1600 > 0.75, 'with two boats one is usually in view');
  assert.ok(new Set(relative.map((value) => Math.round(value / 20))).size > 5, 'their spacing keeps changing: they are not in step');
  stage.controller.dispose();
});

void test('all gull entries form one flock of three birds sharing a draw slot, and fewer frames degrade gracefully', async () => {
  const theme = themeFixture();
  theme.sprites.push({ id: 'bird-glide', file: 'bird-soar.png', rect: { x: 500, y: 250, w: 64, h: 40 }, depth: 20, kind: 'gull' });
  const stage = stageFixture({ manifest: theme });
  await stage.settle();
  stage.step(40);
  const { scene } = stage.rendered();
  const birds = meshes(scene).filter((mesh) => mesh.userData.plateKind === 'gull');
  assert.equal(birds.length, 3, 'two gull entries still make exactly three birds');
  assert.equal(new Set(birds.map((bird) => bird.renderOrder)).size, 1, 'the flock shares one draw slot');
  stage.controller.dispose();
  const single = themeFixture();
  delete (single.sprites[1] as { files?: string[] }).files;
  const lone = stageFixture({ manifest: single });
  await lone.settle();
  lone.step(40);
  const flock = meshes(lone.rendered().scene).filter((mesh) => mesh.userData.plateKind === 'gull');
  assert.equal(flock.length, 3);
  lone.advance(3000);
  assert.equal(new Set(flock.map((bird) => bird.material)).size, 1, 'a single frame simply glides');
  lone.controller.dispose();
});

void test('a player kind builds body, tilted disc and pivoting arm; the disc spins and the arm swings only while a record plays', async () => {
  const stage = stageFixture({ manifest: playerFixture() });
  await stage.settle();
  stage.step(40);
  const { scene } = stage.rendered();
  const player = scene.getObjectByName('turntable') as THREE.Group;
  assert.ok(player instanceof THREE.Group);
  assert.equal(player.userData.plateKind, 'player');
  assert.equal(stage.buttons.records.dataset.projected, 'true', 'the whole player is the records object');
  const body = scene.getObjectByName('turntable-body') as THREE.Mesh;
  const pivot = scene.getObjectByName('turntable-disc-pivot') as THREE.Group;
  const disc = scene.getObjectByName('turntable-disc') as THREE.Mesh;
  const arm = scene.getObjectByName('turntable-arm') as THREE.Mesh;
  assert.ok(body && pivot && disc && arm);
  const u = unitsAt(4);
  assert.ok(Math.abs((body.geometry as THREE.PlaneGeometry).parameters.width - 200 * u) < 1e-12);
  assert.ok(Math.abs((disc.geometry as THREE.CircleGeometry).parameters.radius - 40 * u) < 1e-12);
  assert.ok(Math.abs(pivot.rotation.x - THREE.MathUtils.degToRad(55)) < 1e-12 && Math.abs(pivot.rotation.z - THREE.MathUtils.degToRad(-12)) < 1e-12);
  assert.equal(pivot.rotation.order, 'ZXY', 'tilt about x, then yaw about z');
  const discWorld = pivot.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(canvasX(discWorld, 4) - 730) < 1e-6 && Math.abs(canvasY(discWorld, 4) - 1140) < 1e-6, 'the disc sits at its centre');
  const armWorld = arm.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(canvasX(armWorld, 4) - 810) < 1e-6 && Math.abs(canvasY(armWorld, 4) - 1100) < 1e-6, 'the arm pivots at its pivot');
  const caption = stage.buttons.records.vars['--caption-dy'];
  assert.ok(Number.parseFloat(caption) < 0, 'the theme caption offset applies to the player');
  assert.equal(arm.rotation.z, 0, 'at rest the arm is at its rest angle');
  const sheen = pivot.children.find((child) => child !== disc) as THREE.Mesh;
  assert.equal((sheen.material as THREE.ShaderMaterial).uniforms.sweepActive.value, 0, 'no sheen while silent');
  stage.advance(1000);
  assert.equal(disc.rotation.z, 0, 'the disc does not spin while silent');
  stage.controller.setPlaying(true, 'Sunset Bossa');
  stage.advance(600);
  const halfway = arm.rotation.z;
  assert.ok(halfway < 0 && halfway > THREE.MathUtils.degToRad(-22), 'the arm is easing toward the record');
  stage.advance(800);
  assert.ok(Math.abs(arm.rotation.z - THREE.MathUtils.degToRad(-22)) < 1e-9, 'and rests on it after 1.2 s');
  const spun = disc.rotation.z;
  assert.ok(spun > 0, 'the disc spins');
  stage.advance(1000);
  assert.ok(Math.abs(disc.rotation.z - spun - (100 / 3 / 60) * Math.PI * 2) < 1e-6, 'at 33⅓ rpm');
  assert.equal((sheen.material as THREE.ShaderMaterial).uniforms.sweepActive.value, 1, 'a soft sheen sweeps the record');
  assert.equal((sheen.material as THREE.ShaderMaterial).uniforms.sweepPeriod.value, 4);
  stage.controller.setPlaying(false);
  stage.advance(1400);
  assert.ok(Math.abs(arm.rotation.z) < 1e-9, 'the arm returns when playback stops');
  const parked = disc.rotation.z;
  stage.advance(500);
  assert.equal(disc.rotation.z, parked, 'and the disc stops');
  stage.controller.setMotion(false);
  stage.controller.setPlaying(true);
  stage.advance(50);
  assert.ok(Math.abs(arm.rotation.z - THREE.MathUtils.degToRad(-22)) < 1e-9, 'with motion off the arm snaps to its state');
  stage.controller.dispose();
});

void test('a player without a disc renders body and arm only, and the arm still swings while a record plays', async () => {
  const theme = playerFixture();
  const player = theme.sprites.find((sprite) => sprite.id === 'turntable') as unknown as { parts: { disc?: unknown } };
  delete player.parts.disc;
  const stage = stageFixture({ manifest: theme });
  await stage.settle();
  stage.step(40);
  const { scene } = stage.rendered();
  assert.ok(scene.getObjectByName('turntable-body'));
  assert.ok(scene.getObjectByName('turntable-arm'));
  assert.equal(scene.getObjectByName('turntable-disc'), undefined, 'no disc, no disc pivot');
  assert.equal(scene.getObjectByName('turntable-disc-pivot'), undefined);
  assert.ok(!stage.urls.includes('/plates/test-room/turntable-disc.png'), 'no disc texture is requested');
  const arm = scene.getObjectByName('turntable-arm') as THREE.Mesh;
  stage.controller.setPlaying(true);
  stage.advance(1400);
  assert.ok(Math.abs(arm.rotation.z - THREE.MathUtils.degToRad(-22)) < 1e-9, 'the arm rests on the record');
  stage.controller.dispose();
});

void test('animation phases are drawn once per scene: two launches differ, one launch is deterministic at rest, and periods stay unrelated', async () => {
  const phases = (stage: ReturnType<typeof stageFixture>) => {
    const all = meshes(stage.rendered().scene);
    const pick = (kind: string) => (all.find((mesh) => mesh.userData.plateKind === kind)!.material as THREE.MeshBasicMaterial).userData.uniforms.platePhase.value;
    return { sea: pick('sea').clone(), breeze: pick('breeze').clone(), flecks: pick('flecks').clone(), drift: pick('drift').clone() };
  };
  let seed = 1;
  const rolling = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const first = stageFixture({ random: rolling });
  await first.settle();
  first.step(40);
  const a = phases(first);
  const second = stageFixture({ random: () => 0.91 });
  await second.settle();
  second.step(40);
  const b = phases(second);
  assert.ok(!a.sea.equals(b.sea) && !a.breeze.equals(b.breeze) && !a.flecks.equals(b.flecks) && !a.drift.equals(b.drift), 'different randomness, different phases');
  assert.ok(a.sea.x !== a.sea.y && a.breeze.x !== a.breeze.y, 'each rhythm draws its own phase');
  assert.ok([a.sea, a.breeze, a.flecks].every((v) => [v.x, v.y, v.z].every((p) => p >= 0 && p < Math.PI * 2)));
  first.controller.setMotion(false);
  first.advance(100);
  const stillA = phases(first);
  first.advance(3000);
  assert.deepEqual(phases(first), stillA, 'phases are fixed for the life of the scene');
  const water = meshes(first.rendered().scene).find((mesh) => mesh.userData.plateKind === 'sea')!.material as THREE.MeshBasicMaterial;
  assert.equal(water.userData.uniforms.plateTime.value, 0, 'and motion off evaluates every rhythm at t = 0');
  first.controller.dispose();
  second.controller.dispose();
});

void test('planes take their size from the manifest rect, never from the image: a 2× file only samples finer', async () => {
  const low = stageFixture({ imageSize: 128 });
  await low.settle();
  low.step(40);
  const high = stageFixture({ imageSize: 4096 });
  await high.settle();
  high.step(40);
  for (const name of ['far', 'water', 'vessel', 'book', 'bird-0', 'swaying', 'dish']) {
    const a = low.rendered().scene.getObjectByName(name) as THREE.Mesh;
    const b = high.rendered().scene.getObjectByName(name) as THREE.Mesh;
    const pa = (a.geometry as THREE.PlaneGeometry).parameters;
    const pb = (b.geometry as THREE.PlaneGeometry).parameters;
    assert.ok(Math.abs(pa.width - pb.width) < 1e-12 && Math.abs(pa.height - pb.height) < 1e-12, `${name} keeps its rect size`);
    assert.ok(a.position.equals(b.position), `${name} keeps its rect position`);
    const imageWidth = (mesh: THREE.Mesh) =>
      ((mesh.material as THREE.MeshBasicMaterial).map!.image as { width: number }).width;
    assert.equal(imageWidth(a), 128);
    assert.equal(imageWidth(b), 4096, 'the texture itself is the finer file');
  }
  const bird = high.rendered().scene.getObjectByName('bird-0') as THREE.Mesh;
  assert.ok(Math.abs((bird.geometry as THREE.PlaneGeometry).parameters.width - 64 * unitsAt(20)) < 1e-12, 'a gull plane is still 64 canvas px wide');
  low.controller.dispose();
  high.controller.dispose();
});

void test('entrance lifts the prop once, tolerates a synchronous dispose in its callback, and records opens immediately', async () => {
  const stage = stageFixture();
  await stage.settle();
  stage.step(40);
  const { scene } = stage.rendered();
  const book = scene.getObjectByName('book')!;
  const base = book.position.clone();
  let opened = 0;
  stage.controller.enter('journal', () => {
    opened++;
    assert.ok(Math.abs(book.position.y - base.y) < 1e-12, 'the prop is back at rest when the destination opens');
    stage.controller.dispose();
  });
  stage.controller.enter('atlas', () => opened++);
  stage.step(200);
  assert.ok(book.position.y > base.y, 'the prop lifts during the entrance');
  stage.step(440);
  assert.equal(opened, 1);
  assert.equal(stage.frames.size, 0);
  assert.equal(stage.stats().disposed, 1);
  const direct = stageFixture();
  await direct.settle();
  direct.step(40);
  let records = 0;
  direct.controller.enter('records', () => records++);
  assert.equal(records, 1);
  direct.controller.setMotion(false);
  direct.controller.enter('journal', () => records++);
  assert.equal(records, 2, 'reduced motion opens without an animation');
  direct.controller.dispose();
});

void test('breeze holds the trunk still: nothing moves within the hold band above the anchor, then sway ramps in over a quarter of the plate', async () => {
  assert.equal(BREEZE_HOLD_PX, 60);
  assert.equal(BREEZE_RAMP, 0.25);
  assert.equal(breezeWeight(0, 0.5, 1, 0.1), 0, 'the anchor row never moves');
  assert.equal(breezeWeight(-0.2, 0.9, 1, 0.1), 0, 'nor anything below it');
  assert.equal(breezeWeight(0.1, 0.9, 1, 0.1), 0, 'nor the hold band just above it');
  assert.ok(breezeWeight(0.11, 0.9, 1, 0.1) > 0, 'movement begins above the hold band');
  assert.ok(breezeWeight(0.9, 1, 1, 0.1) > breezeWeight(0.5, 0.5, 1, 0.1), 'and grows toward the crown');
  const ramped = [0.1, 0.15, 0.2, 0.3, 0.35].map((rise) => breezeWeight(rise, 1, 1, 0.1, 0.2));
  assert.equal(ramped[0], 0);
  assert.ok(ramped[1] > 0 && ramped[1] < ramped[2] && ramped[2] < ramped[3], 'the ramp fades sway in above the hold');
  assert.ok(Math.abs(ramped[3] - ramped[4]) < 1e-12 && Math.abs(ramped[3] - 1) < 1e-12, 'full sway once the ramp is over');
  const theme = themeFixture();
  (theme.layers[5] as { breeze?: { hold: number } }).breeze = { hold: 780 };
  const stage = stageFixture({ manifest: theme });
  await stage.settle();
  stage.step(40);
  const { scene } = stage.rendered();
  const swaying = meshes(scene).find((mesh) => mesh.userData.plateKind === 'breeze')!;
  const material = swaying.material as THREE.MeshBasicMaterial;
  const u = unitsAt(1.55);
  assert.ok(Math.abs(material.userData.uniforms.plateHold.value - 780 * u) < 1e-12, 'the theme sets the hold band');
  assert.ok(Math.abs(material.userData.uniforms.plateRamp.value - 0.25 * 1200 * u) < 1e-12, 'the ramp spans a quarter of the plate height');
  const shader = { vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> };
  material.onBeforeCompile(shader as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0], {} as THREE.WebGLRenderer);
  assert.ok(shader.vertexShader.includes('float plateRise = position.y - plateAnchor.y;'));
  assert.ok(shader.vertexShader.includes('plateRise <= plateHold ? 0.0 : smoothstep(0.0, plateReach, distance(position.xy, plateAnchor))'), 'the shader mirrors breezeWeight');
  assert.ok(shader.vertexShader.includes('smoothstep(plateHold, plateHold + plateRamp, plateRise)'), 'including the ramp');
  assert.equal(shader.uniforms.plateHold, material.userData.uniforms.plateHold);
  stage.controller.dispose();
  const plain = stageFixture();
  await plain.settle();
  plain.step(40);
  const defaultHold = (meshes(plain.rendered().scene).find((mesh) => mesh.userData.plateKind === 'breeze')!.material as THREE.MeshBasicMaterial).userData.uniforms.plateHold.value;
  assert.ok(Math.abs(defaultHold - 60 * u) < 1e-12, 'without tuning the hold band is sixty canvas pixels');
  plain.controller.dispose();
});

void test('the stage is theme-agnostic: no theme file names or scene ids live in its source', () => {
  const folder = new URL('../lib/terrace/plates/', import.meta.url);
  for (const file of readdirSync(folder)) {
    const source = readFileSync(new URL(file, folder), 'utf8');
    assert.doesNotMatch(source, /\.(png|jpe?g|webp)/i, `${file} names an image file`);
    assert.doesNotMatch(source, /\b(terrace|cigar|tree|chair|parapet|paving|coast|clouds?|sky|ashtray|globe|magnifier)\b/i, `${file} names a scene element`);
    for (const kind of ['sea', 'boat', 'gull']) {
      const uses = source.match(new RegExp(`'${kind}'`, 'g')) ?? [];
      const kindUses = source.match(new RegExp(`(kind === |kind: |'${kind}',\\n|\\| '${kind}'|-\\$\\{|plates-)`, 'g')) ?? [];
      assert.ok(uses.length <= kindUses.length + 2, `${file} uses '${kind}' outside kind handling`);
    }
  }
});
