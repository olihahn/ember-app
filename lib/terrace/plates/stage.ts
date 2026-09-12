import * as THREE from 'three';
import { BREEZE_HOLD_PX, BREEZE_RAMP } from './breeze';
import { manifestFiles, parseManifest, type PlateEntry, type PlateRect, type PlatesManifest } from './manifest';
import type { SceneController, StageOptions, TerraceDestination } from './types';

export type { SceneController, StageOptions, TerraceDestination } from './types';
export type { PlatesManifest } from './manifest';

/** Reference vertical field of view spanning the canvas height at any depth. */
const REFERENCE_FOV = 40;
const OVERSCAN = 1.08;
const LOOK_DEPTH = 6;
// With a foreground plate at depth ≈ 1.5–1.9, a larger lean pushes it out of frame.
const DEFAULT_LEAN = { x: 0.26, y: 0.16 };
/** Shows wherever no plate covers the view. A theme should set its own in
 *  the manifest; this neutral is only a fallback. */
const FALLBACK_PAPER = '#efefef';
const MASTHEAD = { w: 380, h: 180 };
/** Birds fly only in open air above this fraction of the canvas height. */
const GULL_HORIZON = 0.26;
const DISC_RPM = 100 / 3;

type Animated = {
  material: THREE.Material;
  uniforms: Record<string, THREE.IUniform>;
};
type Mover = (time: number) => void;
type Leg = { start: number; end: number; fromLeft: boolean; y0: number; y1: number; curve: number; burst: number; glide: number };

/** Small deterministic generator so flights are random-looking yet reproducible. */
function seeded(seed: number) {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state = (state * 1103515245 + 12345) >>> 0;
    return (state >>> 8) / 0x1000000;
  };
}

function radialGlow(size = 32) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const fall = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2);
      const alpha = fall * fall;
      const offset = (y * size + x) * 4;
      // Warm core (#ff9a4a) cooling to rust (#b8492b) at the edge.
      data[offset] = Math.round(184 + (255 - 184) * alpha);
      data[offset + 1] = Math.round(73 + (154 - 73) * alpha);
      data[offset + 2] = Math.round(43 + (74 - 43) * alpha);
      data[offset + 3] = Math.round(255 * alpha);
    }
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** A rust disc, darker at its core (#a03f24 → #b8492b), soft one-pixel rim, sRGB. */
function radialDot(size = 32) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const alpha = 1 - Math.min(1, Math.max(0, (r - 0.82) / 0.18));
      const rim = Math.min(1, r);
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(0xa0 + (0xb8 - 0xa0) * rim);
      data[offset + 1] = Math.round(0x3f + (0x49 - 0x3f) * rim);
      data[offset + 2] = Math.round(0x24 + (0x2b - 0x24) * rim);
      data[offset + 3] = Math.round(255 * alpha);
    }
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
/** Tileable soft grain for the smoke wisps: a white coverage mask with noise in alpha. */
function wispGrain(size = 64) {
  const data = new Uint8Array(size * size * 4);
  const random = seeded(7);
  const cells = 8;
  const lattice = Array.from({ length: cells * cells }, random);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // Bilinear value noise on a wrapping lattice so the scroll never seams.
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const at = (i: number, j: number) => lattice[((j % cells) + cells) % cells * cells + ((i % cells) + cells) % cells];
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      const value = top * (1 - ty) + bottom * ty;
      const offset = (y * size + x) * 4;
      // A pure coverage mask: white RGB so the ink comes from material.color,
      // which three converts through the working colour space correctly.
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(255 * (0.35 + 0.65 * value));
    }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
/** A stroke widens this many times from its base to its top. */
const WISP_SPREAD = 2;
/** Whole-line swing on top of the curl: amplitude in canvas px. */
const WISP_SWING_PX = 6;
/** Curl amplitudes of the two centreline sines, in canvas px, at the top. */
const WISP_CURL_PX = { main: 26, fine: 12 };
/** The faint breath of smoke behind the strokes. */
const WISP_HAZE = { halfWidth: 20, height: 300, opacity: 0.06 };

/**
 * A faint cream highlight that sweeps across a surface: the record's sheen,
 * a glint on the lens. `mask` limits it to the object's own silhouette;
 * without one the sweep is clipped to a disc.
 */
function sweepMaterial(mask: THREE.Texture | null, period: number, width: number, strength: number) {
  const uniforms: Record<string, THREE.IUniform> = {
    plateTime: { value: 0 },
    sweepMask: { value: mask },
    sweepPeriod: { value: period },
    sweepWidth: { value: width },
    sweepStrength: { value: strength },
    sweepActive: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms,
    defines: mask ? { SWEEP_MASK: 1 } : {},
    vertexShader: `varying vec2 sweepUv;
      void main() { sweepUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 sweepUv;
      uniform float plateTime; uniform float sweepPeriod; uniform float sweepWidth; uniform float sweepStrength; uniform float sweepActive;
      #ifdef SWEEP_MASK
      uniform sampler2D sweepMask;
      #endif
      void main() {
        float sweep = fract(plateTime / sweepPeriod) * (1.0 + sweepWidth * 4.0) - sweepWidth * 2.0;
        float band = 1.0 - smoothstep(0.0, sweepWidth, abs(sweepUv.x + sweepUv.y * 0.35 - sweep));
        #ifdef SWEEP_MASK
        float shape = texture2D(sweepMask, sweepUv).a;
        #else
        float shape = 1.0 - smoothstep(0.46, 0.5, distance(sweepUv, vec2(0.5)));
        #endif
        gl_FragColor = vec4(vec3(1.0, 0.94, 0.80), band * shape * sweepStrength * sweepActive);
        #include <colorspace_fragment>
      }`,
  });
  material.userData.uniforms = uniforms;
  return { material, uniforms };
}

/**
 * A manifest-driven multiplane stage: painted layers at real depths, a seated
 * camera that leans, and quiet life only where the theme asks for it.
 * No theme-specific ids, files or colours live here; kinds drive behaviour.
 */
export function createPlatesRenderer(options: StageOptions): SceneController {
  const { host, buttons } = options;
  const themePath = options.theme.replace(/\/?$/, '/');
  // Every rhythm gets its own period and a phase drawn once per scene, so no
  // two animated kinds pulse on one clock and no two launches look identical.
  // Motion off still evaluates at t = 0.
  const random = options.random ?? Math.random;
  const scenePhase = () => random() * Math.PI * 2;
  const CLOCKS = {
    sea: [7.3, 11, 9.7],
    flecks: [8.3, 12.6, 6.1],
    breeze: [5, 13, 8.6],
  } as const;
  const rate = (period: number) => (Math.PI * 2) / period;
  // Options win, then the theme's own limits, then the stage default; the
  // plates then clamp that further so no plate edge can ever enter the view.
  let configuredLean = options.lean ?? DEFAULT_LEAN;
  const lean = { ...configuredLean };
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = false;
  const canvas = renderer.domElement;
  canvas.className = options.canvasClass ?? 'plates-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FALLBACK_PAPER);
  const camera = new THREE.PerspectiveCamera(REFERENCE_FOV, 1, 0.1, 400);
  const lookTarget = new THREE.Vector3(0, 0, -LOOK_DEPTH);
  camera.position.set(0, 0, 0);
  camera.lookAt(lookTarget);

  let manifest: PlatesManifest | null = null;
  let disposed = false;
  let motion = options.motion;
  let playing = options.playing;
  let trackTitle: string | undefined;
  let active = options.active;
  let ready = false;
  let preparing = false;
  let prepared = false;
  let raf = 0;
  let lastFrame = 0;
  let elapsed = 0;
  let width = 1;
  let height = 1;
  let drag: { id: number; x: number; y: number; leanX: number; leanY: number } | null = null;
  const desired = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  let entrance: {
    object: THREE.Object3D;
    base: THREE.Vector3;
    started: number;
    done: () => void;
  } | null = null;
  const objects: Partial<Record<TerraceDestination, THREE.Object3D>> = {};
  const captions: Partial<Record<TerraceDestination, { dx: number; dy: number; depth: number }>> = {};
  const textures = new Map<string, THREE.Texture>();
  const releasedTextures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const animated: Animated[] = [];
  const movers: Mover[] = [];
  const steppers: ((dt: number, still: boolean) => void)[] = [];
  let smoke: THREE.Group | null = null;
  let wispTexture: THREE.DataTexture | null = null;
  let halo: THREE.Sprite | null = null;
  let emberDot: THREE.Sprite | null = null;
  let glowTexture: THREE.Texture | null = null;
  let dotTexture: THREE.Texture | null = null;
  const playingSweeps: Record<string, THREE.IUniform>[] = [];
  const point = new THREE.Vector3();
  const box = new THREE.Box3();

  // Canvas maths. A plane at depth d spanning the whole canvas height is
  // 2·d·tan(REFERENCE_FOV/2) world units tall, so one canvas pixel at depth d
  // is unitsPerPixel(d) = 2·d·tan(REFERENCE_FOV/2) / canvas.height.
  const tanReference = Math.tan(THREE.MathUtils.degToRad(REFERENCE_FOV / 2));
  function unitsPerPixel(depth: number) {
    return (2 * depth * tanReference) / (manifest?.canvas.height ?? 1);
  }
  function toWorld(x: number, y: number, depth: number, target: THREE.Vector3) {
    if (!manifest) return target.set(0, 0, -depth);
    const u = unitsPerPixel(depth);
    return target.set(
      (x - manifest.canvas.width / 2) * u,
      (manifest.canvas.height / 2 - y) * u,
      -depth,
    );
  }
  function toScreen(world: THREE.Vector3) {
    const projected = world.clone().project(camera);
    return { x: (projected.x * 0.5 + 0.5) * width, y: (-projected.y * 0.5 + 0.5) * height, z: projected.z };
  }

  function releaseTexture(texture: THREE.Texture) {
    if (releasedTextures.has(texture)) return;
    releasedTextures.add(texture);
    texture.dispose();
  }

  function projectButtons() {
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    for (const [destination, object] of Object.entries(objects)) {
      const button = buttons[destination as TerraceDestination];
      if (!button || !object) continue;
      box.setFromObject(object);
      const centre = box.getCenter(point).clone();
      const screen = toScreen(centre);
      let x0 = width,
        y0 = height,
        x1 = 0,
        y1 = 0;
      for (let corner = 0; corner < 8; corner++) {
        const projected = new THREE.Vector3(
          corner & 1 ? box.max.x : box.min.x,
          corner & 2 ? box.max.y : box.min.y,
          corner & 4 ? box.max.z : box.min.z,
        ).project(camera);
        const px = (projected.x * 0.5 + 0.5) * width;
        const py = (-projected.y * 0.5 + 0.5) * height;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
      button.style.left = `${screen.x}px`;
      button.style.top = `${screen.y}px`;
      button.style.width = `${Math.max(44, Math.min(width * 0.35, x1 - x0))}px`;
      button.style.height = `${Math.max(44, Math.min(height * 0.22, y1 - y0))}px`;
      // Captions sit where the theme puts them, relative to the object centre.
      const caption = captions[destination as TerraceDestination];
      if (caption) {
        const u = unitsPerPixel(caption.depth);
        const label = toScreen(centre.clone().add(new THREE.Vector3(caption.dx * u, -caption.dy * u, 0)));
        button.style.setProperty('--caption-dx', `${label.x - screen.x}px`);
        button.style.setProperty('--caption-dy', `${label.y - screen.y}px`);
      } else {
        button.style.setProperty('--caption-dx', '0px');
        button.style.setProperty('--caption-dy', `${(y1 - y0) / 2 + 10}px`);
      }
      button.dataset.projected = 'true';
      button.style.visibility =
        screen.z < 1 && screen.x > -30 && screen.x < width + 30 && screen.y > 0 && screen.y < height
          ? 'visible'
          : 'hidden';
    }
  }

  function placeCamera() {
    camera.position.set(current.x, current.y, 0);
    camera.lookAt(lookTarget);
  }

  function render(now = performance.now()) {
    raf = 0;
    if (disposed || !prepared || !active || document.hidden) return;
    if (now - lastFrame < 30 && motion && !entrance) {
      raf = requestAnimationFrame(render);
      return;
    }
    const dt = Math.min(0.06, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (motion) elapsed += dt;
    // With motion off every animated element sits at its rest pose.
    const time = motion ? elapsed : 0;
    for (const item of animated) item.uniforms.plateTime.value = time;
    for (const move of movers) move(time);
    for (const step of steppers) step(motion ? dt : 0, !motion);
    // The ember breathes on a 2.5 s period: dot 0.75–1.0, halo 0.15–0.35.
    const breath = Math.sin((time * Math.PI * 2) / 2.5);
    if (emberDot) emberDot.material.opacity = 0.875 + breath * 0.125;
    if (halo) halo.material.opacity = 0.25 + breath * 0.1;
    for (const sweep of playingSweeps) sweep.sweepActive.value = playing && motion ? 1 : 0;
    current.x += (desired.x - current.x) * 0.16;
    current.y += (desired.y - current.y) * 0.16;
    placeCamera();
    if (entrance) {
      const progress = Math.min(1, (now - entrance.started) / 360);
      entrance.object.position.y =
        entrance.base.y + Math.sin((progress * Math.PI) / 2) * 0.06;
      camera.position.lerp(
        entrance.base.clone().add(new THREE.Vector3(0, 0.05, 1.2)),
        progress * 0.15,
      );
      camera.lookAt(lookTarget.clone().lerp(entrance.base, progress * 0.3));
      if (progress === 1) {
        const finished = entrance;
        entrance = null;
        finished.object.position.copy(finished.base);
        finished.done();
      }
    }
    // A destination callback may synchronously unmount/deactivate the scene.
    if (disposed || !active) return;
    renderer.render(scene, camera);
    projectButtons();
    if (!ready) {
      ready = true;
      options.onReady();
      if (disposed || !active) return;
    }
    if (
      motion ||
      entrance ||
      Math.abs(current.x - desired.x) > 0.0005 ||
      Math.abs(current.y - desired.y) > 0.0005
    )
      raf = requestAnimationFrame(render);
  }
  function schedule() {
    if (!disposed && prepared && !raf && active && !document.hidden) {
      lastFrame = performance.now();
      raf = requestAnimationFrame(render);
    }
  }
  /**
   * Clamp the lean so no layer edge can enter the view. Leaning by L moves
   * the window at depth d by L·(1 − d/LOOK_DEPTH) (the camera translates and
   * re-aims at the look target). Each layer edge outside the rest window by a
   * margin m (world units at its depth) therefore allows |L| ≤ m / |1 − d/LOOK|.
   * Edges already inside the view are the theme's trimmed art, edges the theme
   * lists in `safeEdges` are real painted boundaries, and edges more than
   * OVERSCAN viewports away can never be reached. Sprites are never constrained.
   */
  function clampLean() {
    lean.x = configuredLean.x;
    lean.y = configuredLean.y;
    if (!manifest) return;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    for (const layer of manifest.layers) {
      const d = layer.depth;
      const rate = Math.abs(1 - d / LOOK_DEPTH);
      if (rate < 1e-6) continue;
      const u = unitsPerPixel(d);
      const halfHeight = d * tanHalf;
      const halfWidth = halfHeight * camera.aspect;
      const left = (layer.rect.x - manifest.canvas.width / 2) * u;
      const right = (layer.rect.x + layer.rect.w - manifest.canvas.width / 2) * u;
      const top = (manifest.canvas.height / 2 - layer.rect.y) * u;
      const bottom = (manifest.canvas.height / 2 - layer.rect.y - layer.rect.h) * u;
      const safe = new Set(layer.safeEdges ?? []);
      for (const [edge, margin] of [['right', right - halfWidth], ['left', -halfWidth - left]] as const) {
        if (safe.has(edge) || margin < 0 || margin >= OVERSCAN * 2 * halfWidth) continue;
        lean.x = Math.min(lean.x, margin / rate);
      }
      for (const [edge, margin] of [['top', top - halfHeight], ['bottom', -halfHeight - bottom]] as const) {
        if (safe.has(edge) || margin < 0 || margin >= OVERSCAN * 2 * halfHeight) continue;
        lean.y = Math.min(lean.y, margin / rate);
      }
    }
    desired.x = THREE.MathUtils.clamp(desired.x, -lean.x, lean.x);
    desired.y = THREE.MathUtils.clamp(desired.y, -lean.y, lean.y);
  }
  // Cover mode: the visible frustum never exceeds the canvas at any depth.
  // tan(vfov/2) = tan(REFERENCE_FOV/2) · min(1, canvasAspect/viewportAspect) / OVERSCAN
  function fitCamera() {
    const canvasAspect = manifest ? manifest.canvas.width / manifest.canvas.height : 2 / 3;
    const viewportAspect = width / height;
    const scale = Math.min(1, canvasAspect / viewportAspect) / OVERSCAN;
    camera.aspect = viewportAspect;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanReference * scale));
    camera.updateProjectionMatrix();
    clampLean();
  }
  function resize() {
    if (disposed) return;
    const bounds = host.getBoundingClientRect();
    // A retained stage is display:none on work pages; keep its buffers intact.
    if (bounds.width <= 0 || bounds.height <= 0) return;
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    fitCamera();
    renderer.setSize(width, height, false);
    schedule();
  }
  function visibility() {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else schedule();
  }
  function down(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, leanX: desired.x, leanY: desired.y };
    canvas.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    // Dragging right leans the viewer right; the world then slides left.
    desired.x = THREE.MathUtils.clamp(
      drag.leanX + ((event.clientX - drag.x) / width) * lean.x * 2,
      -lean.x,
      lean.x,
    );
    desired.y = THREE.MathUtils.clamp(
      drag.leanY - ((event.clientY - drag.y) / height) * lean.y * 2,
      -lean.y,
      lean.y,
    );
    schedule();
  }
  function up() {
    drag = null;
  }
  function contextLost(event: Event) {
    event.preventDefault();
    fail();
  }
  function fail() {
    if (disposed) return;
    // Failure is terminal immediately; no pending load may revive this stage.
    dispose();
    options.onFailure();
  }

  function paintedMaterial(texture: THREE.Texture, entry: PlateEntry) {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
      depthTest: true,
      opacity: entry.opacity ?? 1,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    materials.add(material);
    return material;
  }
  function needTexture(file: string) {
    const texture = textures.get(file);
    if (!texture) throw new Error(`missing texture ${file}`);
    return texture;
  }

  /** UV motion for sea, flecks and drift; vertex sway for breeze. */
  function animate(material: THREE.MeshBasicMaterial, entry: PlateEntry, u: number) {
    const uniforms: Record<string, THREE.IUniform> = { plateTime: { value: 0 } };
    const rect = entry.rect;
    let vertex = '';
    let fragment = '';
    if (entry.kind === 'sea' || entry.kind === 'flecks') {
      // Sea strokes breathe ≈ 8 canvas px sideways on two slow rhythms with a
      // 1.5 px lift. Flecks additionally glide ≈ 10 canvas px/s across the
      // water (repeat wrap on that texture only), drift ≈ 6 px and fade strip
      // by strip, peaking at 0.7 opacity. Rates differ so nothing is in step.
      const sea = entry.kind === 'sea';
      uniforms.plateAmp = {
        value: new THREE.Vector2((sea ? 8 : 6) / rect.w, (sea ? 1.5 : 1) / rect.h),
      };
      const periods = sea ? CLOCKS.sea : CLOCKS.flecks;
      uniforms.plateClock = { value: new THREE.Vector3(rate(periods[0]), rate(periods[1]), rate(periods[2])) };
      uniforms.platePhase = { value: new THREE.Vector3(scenePhase(), scenePhase(), scenePhase()) };
      uniforms.plateScroll = { value: sea ? 0 : 10 / rect.w };
      if (!sea && material.map) material.map.wrapS = THREE.RepeatWrapping;
      fragment = `
        vec2 plateUv = vMapUv + vec2(
          (sin(vMapUv.y * 23.0 + plateTime * plateClock.x + platePhase.x) * 0.65
            + sin(vMapUv.y * 7.0 - plateTime * plateClock.y + platePhase.y + vMapUv.x * 3.0) * 0.35) * plateAmp.x
            - plateScroll * plateTime,
          sin(vMapUv.x * 9.0 + plateTime * plateClock.z + platePhase.z) * plateAmp.y);
        plateUv.x = fract(plateUv.x);
        vec4 sampledDiffuseColor = texture2D(map, plateUv);
        diffuseColor *= sampledDiffuseColor;
        ${sea
          ? ''
          : `float plateStrip = floor(vMapUv.y * 12.0);
        diffuseColor.a *= 0.7 * (0.45 + 0.55 * sin(plateTime * plateClock.z + platePhase.z + plateStrip * 1.7 + vMapUv.x * 5.0));`}`;
    } else if (entry.kind === 'drift') {
      // Canvas widths per second, expressed in this plate's uv space.
      const canvasWidth = manifest?.canvas.width ?? rect.w;
      const canvasHeight = manifest?.canvas.height ?? rect.h;
      const dx = ((entry.drift?.x ?? 1 / 720) * canvasWidth) / rect.w;
      const dy = ((entry.drift?.y ?? 0) * canvasHeight) / rect.h;
      uniforms.plateDrift = { value: new THREE.Vector2(dx, dy) };
      // A drifting layer starts somewhere along its travel, never twice alike.
      uniforms.platePhase = { value: new THREE.Vector2(random(), random()) };
      if (material.map) material.map.wrapS = material.map.wrapT = THREE.RepeatWrapping;
      fragment = `
        vec2 plateUv = fract(vMapUv - plateDrift * plateTime + platePhase);
        vec4 sampledDiffuseColor = texture2D(map, plateUv);
        diffuseColor *= sampledDiffuseColor;`;
    } else if (entry.kind === 'breeze') {
      const anchor = entry.anchor ?? { x: rect.x, y: rect.y + rect.h };
      const local = new THREE.Vector2(
        (anchor.x - (rect.x + rect.w / 2)) * u,
        (rect.y + rect.h / 2 - anchor.y) * u,
      );
      const corners = [
        [-rect.w / 2, -rect.h / 2], [rect.w / 2, -rect.h / 2],
        [-rect.w / 2, rect.h / 2], [rect.w / 2, rect.h / 2],
      ];
      const reach = Math.max(...corners.map(([x, y]) => Math.hypot(x * u - local.x, y * u - local.y)), 1e-6);
      uniforms.plateAnchor = { value: local };
      uniforms.plateReach = { value: reach };
      uniforms.plateSway = { value: 10 * u };
      uniforms.plateHold = { value: (entry.breeze?.hold ?? BREEZE_HOLD_PX) * u };
      uniforms.plateRamp = { value: BREEZE_RAMP * rect.h * u };
      uniforms.plateClock = { value: new THREE.Vector3(rate(CLOCKS.breeze[0]), rate(CLOCKS.breeze[1]), rate(CLOCKS.breeze[2])) };
      uniforms.platePhase = { value: new THREE.Vector3(scenePhase(), scenePhase(), scenePhase()) };
      // Mirrors breezeWeight(): nothing at or below the anchor row, nor within
      // the hold distance above it; movement then ramps in over a quarter of
      // the plate height, so a trunk stays still while the crown moves most.
      vertex = `
        float plateRise = position.y - plateAnchor.y;
        float plateWeight = plateRise <= plateHold ? 0.0 : smoothstep(0.0, plateReach, distance(position.xy, plateAnchor));
        plateWeight *= sqrt(plateWeight) * smoothstep(plateHold, plateHold + plateRamp, plateRise);
        float plateGust = sin(plateTime * plateClock.x + platePhase.x + position.y * 0.9) * 0.7
          + sin(plateTime * plateClock.y + platePhase.y + position.x * 0.4) * 0.3;
        transformed.x += plateGust * plateSway * plateWeight;
        transformed.y += sin(plateTime * plateClock.z + platePhase.z + position.x * 1.1) * plateSway * 0.25 * plateWeight;`;
    } else return;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      if (fragment)
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
            uniform float plateTime;
            ${uniforms.plateAmp ? 'uniform vec2 plateAmp; uniform vec3 plateClock; uniform vec3 platePhase; uniform float plateScroll;' : ''}
            ${uniforms.plateDrift ? 'uniform vec2 plateDrift; uniform vec2 platePhase;' : ''}`)
          .replace('#include <map_fragment>', `#ifdef USE_MAP
            ${fragment}
            #endif`);
      if (vertex)
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float plateTime; uniform vec2 plateAnchor; uniform float plateReach; uniform float plateSway; uniform float plateHold; uniform float plateRamp;
            uniform vec3 plateClock; uniform vec3 platePhase;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            ${vertex}`);
    };
    material.customProgramCacheKey = () => `plates-${entry.kind}-v3`;
    material.userData.plateKind = entry.kind;
    material.userData.uniforms = uniforms;
    animated.push({ material, uniforms });
  }

  function planeFor(rect: PlateRect, depth: number, texture: THREE.Texture, entry: PlateEntry, segments = false) {
    const u = unitsPerPixel(depth);
    const geometry = segments
      ? new THREE.PlaneGeometry(rect.w * u, rect.h * u, 16, 24)
      : new THREE.PlaneGeometry(rect.w * u, rect.h * u);
    geometries.add(geometry);
    const material = paintedMaterial(texture, entry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    toWorld(rect.x + rect.w / 2, rect.y + rect.h / 2, depth, mesh.position);
    return mesh;
  }

  function makePlane(entry: PlateEntry, texture: THREE.Texture) {
    const mesh = planeFor(entry.rect, entry.depth, texture, entry, entry.kind === 'breeze');
    animate(mesh.material as THREE.MeshBasicMaterial, entry, unitsPerPixel(entry.depth));
    mesh.name = entry.id;
    mesh.userData.plateKind = entry.kind;
    return mesh;
  }

  /** A crossing schedule: legs across the canvas separated by off-screen waits. */
  function crossings(seed: number, options: {
    canvasWidth: number; halfWidth: number; duration: () => number; wait: () => number;
    firstWait: () => number; band: [number, number]; curve: number; startVisibleAt?: number; startFromLeft?: boolean;
    /** Seconds into a leg at which a given progress is reached (default: linear). */
    localFor?: (progress: number, duration: number) => number;
    /** Force every crossing in one direction (a side-view sprite never mirrors). */
    direction?: 'right';
  }) {
    const random = seeded(seed);
    const legs: Leg[] = [];
    const span = options.canvasWidth + options.halfWidth * 2;
    const pickSide = () => (options.direction === 'right' ? true : random() < 0.5);
    const make = (start: number, fromLeft: boolean): Leg => {
      const duration = options.duration();
      const y0 = options.band[0] + random() * (options.band[1] - options.band[0]);
      const y1 = options.band[0] + random() * (options.band[1] - options.band[0]);
      return {
        start, end: start + duration, fromLeft, y0, y1,
        curve: (random() * 2 - 1) * options.curve,
        burst: 1 + random(), glide: 3 + random() * 3,
      };
    };
    if (options.startVisibleAt !== undefined) {
      // Already on screen at rest: back-date the first leg so t = 0 sits there.
      const first = make(0, options.startFromLeft ?? true);
      const progress = (options.startVisibleAt + options.halfWidth) / span;
      const along = first.fromLeft ? progress : 1 - progress;
      const shift = options.localFor ? options.localFor(along, first.end - first.start) : along * (first.end - first.start);
      first.start -= shift;
      first.end -= shift;
      legs.push(first);
    } else legs.push(make(options.firstWait(), pickSide()));
    const legAt = (time: number) => {
      while (legs[legs.length - 1].end < time) {
        const last = legs[legs.length - 1];
        legs.push(make(last.end + options.wait(), pickSide()));
      }
      let index = legs.length - 1;
      while (index > 0 && legs[index].start > time) index--;
      return { leg: legs[index], next: legs[index + 1] ?? legs[index] };
    };
    return {
      legs,
      at(time: number) {
        const { leg, next } = legAt(time);
        const local = time - leg.start;
        const progress = local / (leg.end - leg.start);
        const onScreen = progress >= 0 && progress <= 1;
        // While waiting out of sight the sprite already faces its next crossing.
        const heading = progress > 1 ? next.fromLeft : leg.fromLeft;
        const along = Math.min(1, Math.max(0, progress));
        const x = leg.fromLeft ? -options.halfWidth + along * span : options.canvasWidth + options.halfWidth - along * span;
        const ease = along * along * (3 - 2 * along);
        const y = leg.y0 + (leg.y1 - leg.y0) * ease + leg.curve * Math.sin(along * Math.PI);
        // Slope of the path in canvas px per px of travel, for banking.
        const dy = (leg.y1 - leg.y0) * 6 * along * (1 - along) + leg.curve * Math.PI * Math.cos(along * Math.PI);
        return { leg, local, progress, onScreen, heading, x, y, slope: dy / span };
      },
    };
  }

  function build(theme: PlatesManifest) {
    let order = 0;
    let boats = 0;
    let flock: { entry: PlateEntry; files: string[]; order: number } | null = null;
    // Draw far to near by depth across layers and sprites together; the
    // manifest's listing order only breaks ties (Array.prototype.sort is stable).
    const ordered = [...theme.layers, ...theme.sprites].sort((a, b) => b.depth - a.depth);
    for (const entry of ordered) {
      if (entry.kind === 'gull') {
        // Every gull entry contributes wing frames to ONE flock; the first
        // entry fixes size, depth and draw order.
        if (!flock) flock = { entry, files: [], order: order++ };
        for (const file of entry.files?.length ? entry.files : [entry.file])
          if (!flock.files.includes(file)) flock.files.push(file);
        continue;
      }
      if (entry.kind === 'player' && entry.parts) {
        buildPlayer(entry, order++);
        continue;
      }
      const texture = needTexture(entry.file);
      const mesh = makePlane(entry, texture);
      mesh.renderOrder = order++;
      if (entry.kind === 'prop' && entry.destination) {
        if (entry.caption) captions[entry.destination] = { ...entry.caption, depth: entry.depth };
        const u = unitsPerPixel(entry.depth);
        if (entry.destination === 'atlas') {
          // Rocks ±1.5° about its base on a ~7 s period.
          const stand = new THREE.Group();
          stand.name = entry.id;
          stand.userData.plateKind = 'prop';
          toWorld(entry.rect.x + entry.rect.w / 2, entry.rect.y + entry.rect.h, entry.depth, stand.position);
          mesh.position.set(0, (entry.rect.h * u) / 2, 0);
          mesh.name = `${entry.id}-plate`;
          stand.add(mesh);
          scene.add(stand);
          objects.atlas = stand;
          movers.push((time) => {
            stand.rotation.z = Math.sin((time * Math.PI * 2) / 7) * THREE.MathUtils.degToRad(1.5);
          });
        } else {
          scene.add(mesh);
          objects[entry.destination] = mesh;
          if (entry.destination === 'identify' || entry.destination === 'records') {
            // A glint crossing the lens every ~9 s; a soft sheen on a record
            // only while it plays.
            const sweep = sweepMaterial(texture, entry.destination === 'identify' ? 9 : 4, 0.08, entry.destination === 'identify' ? 0.35 : 0.12);
            materials.add(sweep.material);
            animated.push(sweep);
            const glint = new THREE.Mesh(mesh.geometry, sweep.material);
            glint.position.z = 0.002;
            glint.frustumCulled = false;
            glint.renderOrder = order++;
            mesh.add(glint);
            if (entry.destination === 'records') playingSweeps.push(sweep.uniforms);
          }
        }
      } else scene.add(mesh);
      if (entry.kind === 'boat') buildBoat(entry, mesh, theme, boats++);
      if (entry.ember) buildEmber(entry, () => order++);
    }
    if (flock) buildFlock(flock, theme);
    // `theme.established` is accepted for older manifests but no longer lettered.
  }

  function buildBoat(entry: PlateEntry, mesh: THREE.Mesh, theme: PlatesManifest, index: number) {
    const u = unitsPerPixel(entry.depth);
    const rest = mesh.position.clone();
    const restX = entry.rect.x + entry.rect.w / 2;
    const period = entry.route?.period ?? 90;
    // A faint wake: one tiny additive stroke behind the hull, fading with speed.
    const wakeMaterial = new THREE.MeshBasicMaterial({
      color: '#fff4dc',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    materials.add(wakeMaterial);
    const wakeGeometry = new THREE.PlaneGeometry(entry.rect.w * 0.7 * u, 2.5 * u);
    geometries.add(wakeGeometry);
    const wake = new THREE.Mesh(wakeGeometry, wakeMaterial);
    wake.position.set(-entry.rect.w * 0.75 * u, -entry.rect.h * 0.42 * u, -0.001);
    wake.frustumCulled = false;
    mesh.add(wake);
    const surgePeriod = 11;
    // Progress integrates a speed that surges ±25 % every 11 s.
    const travelled = (time: number) =>
      time + 0.25 * (surgePeriod / (Math.PI * 2)) * (1 - Math.cos((Math.PI * 2 * time) / surgePeriod));
    // Each boat has its own seed, so two boats never sail in step.
    const random = seeded(31 + index * 101);
    // Seconds into a leg at which the surging hull reaches a progress (bisection).
    const localFor = (progress: number, duration: number) => {
      let low = 0;
      let high = duration * 1.5;
      for (let i = 0; i < 48; i++) {
        const mid = (low + high) / 2;
        if (travelled(mid) / duration < progress) low = mid;
        else high = mid;
      }
      return (low + high) / 2;
    };
    // One crossing per leg, then 5–15 s out of sight before returning already
    // mirrored from the other side. It sits at its rest spot at t = 0.
    const route = crossings(29 + index * 53, {
      canvasWidth: theme.canvas.width,
      halfWidth: entry.rect.w / 2,
      duration: () => period,
      wait: () => 5 + random() * 10,
      firstWait: () => 0,
      band: [entry.rect.y + entry.rect.h / 2, entry.rect.y + entry.rect.h / 2],
      curve: 0,
      startVisibleAt: restX,
      startFromLeft: true,
      localFor,
    });
    movers.push((time) => {
      const sample = route.at(time);
      const leg = sample.leg;
      const span = theme.canvas.width + entry.rect.w;
      const along = Math.min(1, Math.max(0, travelled(Math.max(0, sample.local)) / (leg.end - leg.start)));
      const x = leg.fromLeft ? -entry.rect.w / 2 + along * span : theme.canvas.width + entry.rect.w / 2 - along * span;
      const visible = sample.local >= 0 && along < 1;
      mesh.visible = visible;
      toWorld(x, entry.rect.y + entry.rect.h / 2, entry.depth, mesh.position);
      mesh.position.y = rest.y + Math.sin(time * 0.9) * 3 * u;
      // The mirror is fixed for the whole leg: it only changes off screen.
      mesh.scale.x = sample.heading ? 1 : -1;
      const speed = 1 + 0.25 * Math.sin((Math.PI * 2 * time) / surgePeriod);
      const heel = THREE.MathUtils.degToRad(4 + 2 * Math.abs(Math.sin(along * Math.PI)));
      mesh.rotation.z = -mesh.scale.x * heel;
      wakeMaterial.opacity = visible ? 0.22 * Math.max(0, speed - 0.8) : 0;
    });
  }

  function buildFlock(flock: { entry: PlateEntry; files: string[]; order: number }, theme: PlatesManifest) {
    const { entry } = flock;
    const u = unitsPerPixel(entry.depth);
    const frames = flock.files.map((file) => {
      const frame = needTexture(file);
      // One frame per draw: never repeat a bird texture across its plane.
      frame.wrapS = frame.wrapT = THREE.ClampToEdgeWrapping;
      return paintedMaterial(frame, entry);
    });
    // Wing poses: [up, level, down]; fewer frames degrade gracefully.
    const pose = frames.length >= 3 ? { up: 0, level: 1, down: 2 } : frames.length === 2 ? { up: 0, level: 1, down: 0 } : { up: 0, level: 0, down: 0 };
    const beat = [pose.up, pose.level, pose.down, pose.level];
    const count = 3;
    for (let i = 0; i < count; i++) {
      const scale = [0.8, 1.2, 1.0][i];
      const halfW = (entry.rect.w * scale) / 2;
      const halfH = (entry.rect.h * scale) / 2;
      const geometry = new THREE.PlaneGeometry(entry.rect.w * u, entry.rect.h * u);
      geometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, frames[pose.level]);
      mesh.name = `${entry.id}-${i}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = flock.order;
      mesh.userData.plateKind = entry.kind;
      mesh.scale.set(scale, scale, 1);
      scene.add(mesh);
      // Open air only: below the masthead corner, above the horizon line.
      const band: [number, number] = [MASTHEAD.h + halfH + 8, Math.max(MASTHEAD.h + halfH + 8, theme.canvas.height * GULL_HORIZON - halfH)];
      const random = seeded(101 + i * 17);
      // Side-view frames face right: every crossing runs left to right and
      // the sprite is never mirrored.
      const route = crossings(7 + i * 13, {
        canvasWidth: theme.canvas.width,
        halfWidth: halfW,
        duration: () => 18 + random() * 12,
        wait: () => 4 + random() * 10,
        firstWait: () => i * 3 + random() * 5,
        band,
        curve: 40,
        direction: 'right',
      });
      movers.push((time) => {
        const sample = route.at(time);
        mesh.visible = sample.onScreen;
        toWorld(sample.x, Math.min(band[1], Math.max(band[0], sample.y)), entry.depth, mesh.position);
        mesh.scale.x = scale;
        // Bank gently with the path's curvature, at most ±6°.
        mesh.rotation.z = THREE.MathUtils.clamp(-Math.atan(sample.slope) * 0.6, -THREE.MathUtils.degToRad(6), THREE.MathUtils.degToRad(6));
        // Flap bursts of 1–2 s at ~6 frames/s, then a 3–6 s glide on `level`.
        const cycle = sample.leg.burst + sample.leg.glide;
        const phase = ((sample.local % cycle) + cycle) % cycle;
        const frame = phase < sample.leg.burst ? beat[Math.floor(phase * 6) % beat.length] : pose.level;
        mesh.material = frames[frame];
      });
    }
  }

  function buildPlayer(entry: PlateEntry, renderOrder: number) {
    const parts = entry.parts!;
    const u = unitsPerPixel(entry.depth);
    const player = new THREE.Group();
    player.name = entry.id;
    player.userData.plateKind = 'player';
    // The group sits at the body's centre; parts are placed relative to it.
    const origin = toWorld(parts.body.rect.x + parts.body.rect.w / 2, parts.body.rect.y + parts.body.rect.h / 2, entry.depth, new THREE.Vector3());
    player.position.copy(origin);
    const relative = (x: number, y: number) => toWorld(x, y, entry.depth, new THREE.Vector3()).sub(origin);
    const body = planeFor(parts.body.rect, entry.depth, needTexture(parts.body.file), entry);
    body.position.set(0, 0, 0);
    body.name = `${entry.id}-body`;
    body.renderOrder = renderOrder;
    player.add(body);
    // The disc (optional): a circle tilted to the body's ellipse, spinning
    // about its own axis while a record plays.
    let disc: THREE.Mesh | null = null;
    if (parts.disc) {
      const pivot = new THREE.Group();
      pivot.name = `${entry.id}-disc-pivot`;
      pivot.position.copy(relative(parts.disc.centre.x, parts.disc.centre.y)).setZ(0.001);
      pivot.rotation.set(THREE.MathUtils.degToRad(parts.disc.tilt), 0, THREE.MathUtils.degToRad(parts.disc.yaw), 'ZXY');
      const discGeometry = new THREE.CircleGeometry(parts.disc.radius * u, 48);
      geometries.add(discGeometry);
      disc = new THREE.Mesh(discGeometry, paintedMaterial(needTexture(parts.disc.file), entry));
      disc.name = `${entry.id}-disc`;
      disc.frustumCulled = false;
      disc.renderOrder = renderOrder;
      pivot.add(disc);
      const sheen = sweepMaterial(null, 4, 0.12, 0.18);
      materials.add(sheen.material);
      animated.push(sheen);
      playingSweeps.push(sheen.uniforms);
      const gloss = new THREE.Mesh(discGeometry, sheen.material);
      gloss.position.z = 0.0005;
      gloss.frustumCulled = false;
      gloss.renderOrder = renderOrder;
      pivot.add(gloss);
      player.add(pivot);
    }
    // The arm pivots at `pivot`, easing between rest and play over 1.2 s.
    const armRect = parts.arm.rect;
    const arm = planeFor(armRect, entry.depth, needTexture(parts.arm.file), entry);
    const armPivot = relative(parts.arm.pivot.x, parts.arm.pivot.y);
    const armCentre = relative(armRect.x + armRect.w / 2, armRect.y + armRect.h / 2);
    arm.geometry.translate(armCentre.x - armPivot.x, armCentre.y - armPivot.y, 0);
    arm.position.copy(armPivot).setZ(0.002);
    arm.name = `${entry.id}-arm`;
    arm.renderOrder = renderOrder;
    player.add(arm);
    const rest = THREE.MathUtils.degToRad(parts.arm.restAngle);
    const play = THREE.MathUtils.degToRad(parts.arm.playAngle);
    let armProgress = 0;
    let spin = 0;
    arm.rotation.z = rest;
    steppers.push((dt, still) => {
      const target = playing ? 1 : 0;
      if (still) armProgress = target;
      else armProgress += Math.sign(target - armProgress) * Math.min(Math.abs(target - armProgress), dt / 1.2);
      const ease = armProgress * armProgress * (3 - 2 * armProgress);
      arm.rotation.z = rest + (play - rest) * ease;
      // 33⅓ rpm, only while a record actually plays and motion is on.
      if (playing && !still) spin += dt * ((DISC_RPM / 60) * Math.PI * 2);
      if (disc) disc.rotation.z = spin;
    });
    scene.add(player);
    objects.records = player;
    if (entry.caption) captions.records = { ...entry.caption, depth: entry.depth };
  }

  function buildEmber(entry: PlateEntry, nextOrder: () => number) {
    const ember = entry.ember!;
    const emberPoint = toWorld(ember.x, ember.y, entry.depth, new THREE.Vector3());
    const u = unitsPerPixel(entry.depth);
    // Painted smoke: thin sinuous ink strokes over one faint haze, the way a
    // print draws smoke. Half-widths are in canvas px at the base.
    smoke = new THREE.Group();
    smoke.name = 'smoke wisps';
    wispTexture ??= wispGrain();
    // The haze is listed first so it draws behind the strokes.
    const strokes = [
      { half: WISP_HAZE.halfWidth, height: WISP_HAZE.height, period: 10.5, slow: 14.2, swing: 12, opacity: WISP_HAZE.opacity, offset: 0, haze: true },
      { half: 3, height: 260, period: 6.4, slow: 13.1, swing: 9.5, opacity: 0.7, offset: -4, haze: false },
      { half: 4, height: 245, period: 7.3, slow: 11.7, swing: 11.2, opacity: 0.55, offset: 0, haze: false },
      { half: 5, height: 230, period: 8.9, slow: 15.0, swing: 12.8, opacity: 0.4, offset: 4, haze: false },
    ];
    strokes.forEach((stroke, index) => {
      // The plane holds the widened top plus the full curl excursion.
      const excursion = stroke.haze ? 0 : (WISP_CURL_PX.main + WISP_CURL_PX.fine + WISP_SWING_PX) * 2;
      const planeWidth = stroke.half * 2 * WISP_SPREAD + excursion + 8;
      const geometry = new THREE.PlaneGeometry(planeWidth * u, stroke.height * u, 4, 24);
      geometry.translate(0, (stroke.height * u) / 2, 0);
      geometries.add(geometry);
      const material = new THREE.MeshBasicMaterial({
        color: '#173e42',
        map: wispTexture,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        opacity: stroke.opacity,
        toneMapped: false,
      });
      materials.add(material);
      const uniforms: Record<string, THREE.IUniform> = {
        plateTime: { value: 0 },
        wispRate: { value: (Math.PI * 2) / stroke.period },
        wispSlow: { value: (Math.PI * 2) / stroke.slow },
        wispPhase: { value: index * 1.9 + 0.7 },
        wispScroll: { value: 0.11 + index * 0.02 },
        wispHalf: { value: new THREE.Vector2(stroke.half / planeWidth, (stroke.half * WISP_SPREAD) / planeWidth) },
        // Curl amplitudes as fractions of the plane width; the haze barely moves.
        wispCurl: {
          value: stroke.haze
            ? new THREE.Vector2(3 / planeWidth, 0)
            : new THREE.Vector2(WISP_CURL_PX.main / planeWidth, WISP_CURL_PX.fine / planeWidth),
        },
        // Edge softness in uv: about 1.5 canvas px for strokes, soft for haze.
        wispEdge: { value: (stroke.haze ? stroke.half * 0.8 : 1.5) / planeWidth },
        // A slow swing of the whole line, base included.
        wispSwing: { value: (stroke.haze ? 2 : WISP_SWING_PX) / planeWidth },
        wispSwingRate: { value: (Math.PI * 2) / stroke.swing },
        wispGrainMix: { value: stroke.haze ? 0.15 : 0.3 },
      };
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
            uniform float plateTime; uniform float wispRate; uniform float wispSlow; uniform float wispPhase;
            uniform float wispScroll; uniform vec2 wispHalf; uniform vec2 wispCurl; uniform float wispEdge; uniform float wispGrainMix;
            uniform float wispSwing; uniform float wispSwingRate;`)
          .replace('#include <map_fragment>', `#ifdef USE_MAP
            vec2 wispUv = vec2(vMapUv.x, fract(vMapUv.y * 2.0 - plateTime * wispScroll));
            float wispGrain = texture2D(map, wispUv).a;
            // The centreline curls: two sines (3.0 and 6.5 cycles over the
            // height) on their own periods, anchored at the ember by height^0.9.
            float wispAnchor = pow(vMapUv.y, 0.9);
            float wispCurlX = sin(vMapUv.y * ${(Math.PI * 2 * 3).toFixed(4)} + plateTime * wispRate + wispPhase) * wispCurl.x
              + sin(vMapUv.y * ${(Math.PI * 2 * 6.5).toFixed(4)} - plateTime * wispSlow + wispPhase * 1.7) * wispCurl.y;
            float wispCentre = 0.5 + wispCurlX * wispAnchor
              + sin(plateTime * wispSwingRate + wispPhase * 0.6) * wispSwing;
            float wispWide = mix(wispHalf.x, wispHalf.y, vMapUv.y);
            float wispBody = 1.0 - smoothstep(wispWide - wispEdge, wispWide + wispEdge, abs(vMapUv.x - wispCentre));
            float wispRise = smoothstep(0.0, 0.03, vMapUv.y) * pow(1.0 - vMapUv.y, 1.4);
            diffuseColor.a *= wispBody * wispRise * ((1.0 - wispGrainMix) + wispGrainMix * wispGrain);
            #endif`);
      };
      material.customProgramCacheKey = () => `plates-wisp-v4${stroke.haze ? '-haze' : ''}`;
      material.userData.plateKind = stroke.haze ? 'haze' : 'wisp';
      material.userData.uniforms = uniforms;
      animated.push({ material, uniforms });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = stroke.haze ? 'haze' : `wisp-${index - 1}`;
      mesh.frustumCulled = false;
      // The haze sits behind the strokes; strokes start ±4 px apart at the base.
      mesh.position.set(stroke.offset * u, 0, stroke.haze ? -0.0005 : index * 0.0005);
      mesh.renderOrder = nextOrder();
      smoke!.add(mesh);
    });
    smoke.position.copy(emberPoint).add(new THREE.Vector3(0, 0, 0.01));
    scene.add(smoke);
    // A visible ember: a rust dot at the tip with a soft warm halo behind it.
    dotTexture ??= radialDot();
    const dotMaterial = new THREE.SpriteMaterial({
      map: dotTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      opacity: 1,
      toneMapped: false,
    });
    materials.add(dotMaterial);
    glowTexture ??= radialGlow();
    const haloMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.35,
      toneMapped: false,
    });
    materials.add(haloMaterial);
    halo = new THREE.Sprite(haloMaterial);
    halo.name = 'ember halo';
    halo.scale.setScalar(32 * u);
    halo.position.copy(emberPoint).add(new THREE.Vector3(0, 0, 0.004));
    halo.renderOrder = nextOrder();
    scene.add(halo);
    emberDot = new THREE.Sprite(dotMaterial);
    emberDot.name = 'ember';
    emberDot.scale.setScalar(8 * u);
    emberDot.position.copy(emberPoint).add(new THREE.Vector3(0, 0, 0.005));
    emberDot.renderOrder = nextOrder();
    scene.add(emberDot);
  }

  async function finishLoading() {
    if (disposed || preparing || !manifest) return;
    preparing = true;
    try {
      build(manifest);
      camera.lookAt(lookTarget);
      scene.updateMatrixWorld(true);
      await renderer.compileAsync(scene, camera);
      if (disposed) return;
      // Move texture uploads out of the first visible draw, yielding between
      // them so the journal shortcuts stay usable while the print prepares.
      for (const texture of [...textures.values(), ...(glowTexture ? [glowTexture] : []), ...(dotTexture ? [dotTexture] : []), ...(wispTexture ? [wispTexture] : [])]) {
        if (disposed) return;
        renderer.initTexture(texture);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (disposed) return;
      prepared = true;
      schedule();
    } catch {
      fail();
    }
  }

  function loadTextures(theme: PlatesManifest) {
    const files = manifestFiles(theme);
    let remaining = files.length;
    for (const file of files) {
      const pending = new THREE.TextureLoader().load(
        `${themePath}${file}`,
        (texture) => {
          if (disposed) {
            releaseTexture(texture);
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.generateMipmaps = false;
          texture.minFilter = texture.magFilter = THREE.LinearFilter;
          texture.anisotropy = 1;
          texture.needsUpdate = true;
          textures.set(file, texture);
          if (--remaining === 0) void finishLoading();
        },
        undefined,
        fail,
      );
      if (disposed) releaseTexture(pending);
      else if (!textures.has(file)) textures.set(file, pending);
    }
    if (files.length === 0) fail();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  document.addEventListener('visibilitychange', visibility);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('webglcontextlost', contextLost);
  resize();
  void (async () => {
    try {
      const response = await fetch(`${themePath}manifest.json`);
      if (!response.ok) throw new Error(`manifest ${response.status}`);
      const parsed = parseManifest(await response.json());
      if (disposed) return;
      manifest = parsed;
      configuredLean = options.lean ?? parsed.lean ?? DEFAULT_LEAN;
      (scene.background as THREE.Color).set(parsed.paper ?? FALLBACK_PAPER);
      fitCamera();
      loadTextures(parsed);
    } catch {
      fail();
    }
  })();

  function dispose() {
    if (disposed) return;
    disposed = true;
    entrance = null;
    cancelAnimationFrame(raf);
    raf = 0;
    resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('webglcontextlost', contextLost);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures.values()) releaseTexture(texture);
    if (glowTexture) releaseTexture(glowTexture);
    if (dotTexture) releaseTexture(dotTexture);
    if (wispTexture) releaseTexture(wispTexture);
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }

  return {
    setMotion(enabled) {
      motion = enabled;
      schedule();
    },
    setPlaying(value, title) {
      playing = value;
      trackTitle = title;
      schedule();
    },
    setActive(value) {
      active = value;
      if (!value) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else resize();
    },
    resetView() {
      desired.x = 0;
      desired.y = 0;
      schedule();
    },
    enter(destination, done) {
      if (disposed || entrance) return;
      const object = objects[destination];
      if (!ready || !motion || !object || destination === 'records') {
        done();
        return;
      }
      entrance = {
        object,
        base: object.position.clone(),
        started: performance.now(),
        done,
      };
      schedule();
    },
    dispose,
    /** Diagnostics for tests and QA: effective lean and the current track. */
    inspect: () => ({ lean: { ...lean }, trackTitle }),
  } as SceneController;
}
