// Mask geometry for the terrace theme, authored by eye against gridded
// overlays of the source plates (see docs/ART-PIPELINE.md). All coordinates are
// stage-canvas pixels (1024 × 1536, origin top-left) unless noted.

export const CANVAS = { width: 1024, height: 1536 };

/** Parapet top edge (cream stone top) as a line y = a + b·x. */
export const parapetTop = (x) => 757 + 0.047 * x;
/** Parapet bottom edge where paving begins. */
export const parapetBottom = (x) => 882 + 0.11 * x;
/** Sea horizon; the distant hills sit on it left of x = 585. */
export const horizon = (x) => (x < 585 ? 456 : 452);

/** Round tabletop and rim, painted into the scene plate. */
export const table = {
  top: { cx: 655, cy: 990, rx: 352, ry: 100 },
  rim: { cx: 655, cy: 1012, rx: 352, ry: 100 },
};

/** Far hills across the horizon (distance layer). */
export const hills = [
  [180, 455],
  [205, 440],
  [235, 425],
  [262, 415],
  [290, 410],
  [320, 405],
  [345, 406],
  [370, 412],
  [400, 418],
  [440, 425],
  [470, 432],
  [500, 440],
  [535, 447],
  [565, 452],
  [590, 458],
  [180, 458],
];

/** Left promontory: houses, cypress, cliff, rocks and bushes. Bottom is
 *  clipped to the parapet top line at build time. */
export const promontory = [
  [0, 336],
  [40, 346],
  [60, 349],
  [70, 347],
  [78, 392],
  [95, 390],
  [105, 392],
  [120, 408],
  [135, 398],
  [145, 400],
  [158, 428],
  [172, 424],
  [180, 426],
  [188, 445],
  [200, 455],
  [212, 462],
  [228, 472],
  [245, 490],
  [268, 505],
  [300, 510],
  [325, 520],
  [350, 530],
  [370, 545],
  [388, 562],
  [405, 585],
  [432, 600],
  [455, 600],
  [475, 612],
  [497, 628],
  [506, 640],
  [490, 648],
  [455, 648],
  [420, 645],
  [390, 640],
  [355, 634],
  [320, 632],
  [285, 634],
  [250, 636],
  [215, 638],
  [185, 640],
  [165, 648],
  [152, 668],
  [158, 685],
  [190, 695],
  [225, 700],
  [255, 700],
  [283, 690],
  [305, 698],
  [325, 706],
  [348, 722],
  [368, 738],
  [383, 752],
  [393, 768],
  [396, 800],
  [396, 830],
  [0, 830],
];

/** Sailboat painted into the sea; becomes a sprite and is painted out. */
export const boat = {
  // Tight outline for the sprite (combined with a colour key against the sea).
  sprite: [
    [
      [856, 440],
      [884, 440],
      [913, 522],
      [852, 526],
    ],
    [
      [846, 517],
      [916, 517],
      [911, 542],
      [851, 542],
    ],
  ],
  // Generous outline for painting the boat out of the sea and sky: every
  // antialiased sail/mast/hull pixel must go, or a ghost outline remains.
  hole: [
    [
      [850, 434],
      [890, 434],
      [919, 524],
      [847, 528],
    ],
    [
      [841, 514],
      [921, 514],
      [915, 546],
      [847, 546],
    ],
  ],
};

/** Ashtray with cigar in the original poster (1536 × 1024 poster pixels). */
export const posterAshtray = {
  polygons: [
    // ashtray body
    [
      [961, 662],
      [980, 657],
      [1067, 659],
      [1113, 660],
      [1140, 667],
      [1163, 687],
      [1167, 720],
      [1160, 737],
      [1113, 747],
      [1047, 753],
      [980, 748],
      [963, 737],
      [959, 707],
      [959, 680],
    ],
    // cigar resting across it
    [
      [913, 609],
      [930, 606],
      [1093, 680],
      [1088, 695],
      [1067, 690],
      [912, 630],
    ],
  ],
  rect: { x: 908, y: 602, w: 264, h: 156 },
  /** Lit tip in poster pixels. */
  ember: { x: 1090, y: 686 },
};

/** Quadrants of terrace-objects.png (1254 × 1254). */
export const objectQuadrants = {
  journal: { x: 40, y: 60, w: 580, h: 520 },
  recordPlayer: { x: 620, y: 100, w: 620, h: 450 },
  globe: { x: 90, y: 560, w: 480, h: 640 },
  magnifier: { x: 640, y: 600, w: 600, h: 590 },
};

/**
 * Placement of everything that is not sliced from the scene plate. `rect`
 * gives the canvas rectangle at rest; `rotate` is applied to the sprite
 * image before trimming (degrees, clockwise positive).
 */
export const placements = {
  chair: {
    rect: { x: 20, y: 1075, w: 529 },
    depth: 2.7,
    // Blue-ink ellipse falling lower-right (light from upper-left), in its
    // own `chair-shadow` layer at paving depth. Canvas coordinates.
    shadow: { cx: 480, cy: 1290, rx: 200, ry: 55, angle: -0.14 },
  },
  // Scaled to 88 % about the trunk base (anchor unchanged). The right lobe
  // is trimmed along an inward diagonal sweep (widest near the crown top,
  // sweeping left going down, like the poster's crown) with hand-drawn
  // lobes; the flat file top gets the same lobed treatment.
  tree: {
    rect: { x: 127, y: 184 },
    scale: 0.88,
    cutX: 740,
    cutSlope: 0.3,
    cutSlopeFrom: 70,
    depth: 1.55,
    anchor: { x: 178, y: 1530 },
    // Vertices within `hold` px above the anchor row stay still (trunk);
    // the sway ramps in above that (canopy, fronds).
    breeze: { hold: 780 },
  },
  ashtray: { rect: { x: 520, y: 1000, w: 182 }, depth: 4.1 },
  journal: {
    rect: { x: 300, y: 950, w: 160 },
    rotate: -6,
    depth: 4.0,
    destination: 'journal',
    caption: { dx: 0, dy: -95 },
  },
  // Off the table, on the paving lower right as in the poster. Its floor
  // shadow lives in its own `records-shadow` layer at paving depth.
  recordPlayer: {
    rect: { x: 569, y: 1180, w: 290 },
    rotate: 4,
    depth: 3.0,
    destination: 'records',
    caption: { dx: -70, dy: -118 },
    shadow: { cx: 770, cy: 1330, rx: 175, ry: 45, angle: -0.14 },
    // Turntable parts in sprite pixels (290 × 201): record ellipse, tone-arm
    // pivot and the arm outline as drawn (playing, over the record).
    disc: { cx: 136, cy: 60, rx: 95, ry: 46, yaw: 8 },
    pivot: { x: 258, y: 45 },
    armPolygon: [
      [232, 42],
      [246, 56],
      [190, 97],
      [167, 92],
      [171, 77],
    ],
    playAngle: -22,
  },
  globe: {
    rect: { x: 518, y: 759, w: 126 },
    rotate: 0,
    depth: 4.0,
    destination: 'atlas',
    caption: { dx: -95, dy: 80 },
  },
  magnifier: {
    rect: { x: 690, y: 903, w: 160 },
    rotate: -32,
    depth: 4.0,
    destination: 'identify',
    caption: { dx: -40, dy: 70 },
  },
  // Rest position in open sea, right of the near coast; the stage tacks it.
  boat: {
    rect: { x: 690, y: 470 },
    depth: 18,
    route: { amplitude: 50, period: 45 },
  },
  // Second, different boat: gaff-rigged, rust sail, darker hull.
  boat2: {
    rect: { x: 800, y: 470 },
    depth: 18.5,
    route: { amplitude: 50, period: 60 },
  },
  gull: { rect: { x: 700, y: 250, w: 72 }, depth: 20 },
};

/** The painted table sits right of centre in the scene plate; shift the
 *  paving/table layer left so the table is centred on a portrait phone. */
export const pavingOffsetX = -143;

/** Tree canopy tone toward the poster's ink foliage (greens only). */
export const treeTone = {
  hueMin: 55,
  hueMax: 175,
  minSaturation: 0.12,
  brightness: 0.78,
  saturation: 0.9,
  hueShift: 7,
};

export const depths = {
  sky: 40,
  clouds: 36,
  'far-coast': 26,
  sea: 18,
  'sea-flecks': 17.6,
  'near-coast': 11,
  parapet: 6.5,
  paving: 4.2,
};

/**
 * Colour-grade measurement patches. Poster patches are flat, low-variance
 * areas of the reference print (poster pixels); plate patches are scene-plate
 * pixels (canvas). The build measures both and derives per-layer linear maps.
 */
export const gradePatches = {
  poster: {
    sky: [
      { x: 1100, y: 140, w: 400, h: 40 },
      { x: 700, y: 300, w: 300, h: 50 },
    ],
    sea: [{ x: 700, y: 420, w: 350, h: 100 }],
    pavingLit: [
      { x: 620, y: 820, w: 60, h: 40 },
      { x: 720, y: 820, w: 60, h: 40 },
    ],
  },
  plate: {
    sky: [{ x: 60, y: 60, w: 340, h: 240 }],
    sea: [{ x: 560, y: 480, w: 340, h: 240 }],
    // Lit tile faces only (luminance above `litMin`); shadows are the anchor
    // that must not move (luminance below `darkMax`).
    pavingLit: [{ x: 60, y: 1150, w: 200, h: 150 }],
    pavingDark: [{ x: 700, y: 1350, w: 300, h: 150 }],
    litMin: 180,
    darkMax: 110,
  },
};

/** Fill reach under nearer layers, in canvas pixels. */
export const FILL_REACH = 64;
/** The near coast extends further under the parapet so its cut edge sits
 *  well inside the wall's opaque band on vertical lean. */
export const NEAR_COAST_REACH = 80;
/** Mirrored extension of the paving layer's right edge after its left shift. */
export const PAVING_EXTEND = 160;
/** Soft alpha fade over the tree file's cut left border, in file pixels. */
export const TREE_EDGE_FADE = 32;
/** The parapet layer takes over this many px above its painted top edge so
 *  the cream stone strip never separates from the wall on lean. */
export const parapetOverlap = 12;

/** Print inks (from the contract and measured poster foliage). */
export const inks = {
  paper: [242, 220, 170],
  cream: [250, 236, 205],
  turquoise: [63, 143, 151],
  ink: [23, 62, 66],
  navy: [46, 92, 116],
  rust: [184, 73, 43],
  ochre: [201, 154, 74],
  brass: [150, 108, 46],
  foliageInk: [26, 55, 52],
  foliageOlive: [59, 80, 51],
};

/** Canopy print pass (coordinates in the scaled tree file). The canopy
 *  keeps its toned texture; only the frond mass is flattened to ink. */
export const treePrint = {
  ink: inks.foliageInk,
  olive: inks.foliageOlive,
  // Far-left canopy mass with the hanging fronds (file x < 300 above
  // y 330, narrowing to the trunk's left edge below). Scaled-file coordinates.
  // Only the hanging fronds painted over the source's opaque ochre-paper
  // block (file x 60..228, y 170..548) minus the trunk crossing it; there
  // leaves separate cleanly from paper. Scaled-file coordinates.
  frond: (x, y) => {
    const fx = x / 0.88,
      fy = y / 0.88;
    if (fy < 170 || fy >= 548 || fx < 60) return false;
    return fx < Math.min(228, 150 + 0.21 * Math.max(0, fy - 330) - 4);
  },
  frondInkLum: 40,
  frondPaperLum: 120,
  holeRadius: 2,
  holeSolidity: 0.6,
  grain: 3,
  // Frond thinning: open by this radius (drops interstitial fill), then
  // erode so individual leaves and the gaps between them read.
  frondOpen: 1,
  frondErode: 1,
  // Paper-noise backing behind the far-left mass and fronds (scaled-file
  // box) is keyed to transparency; only leaf/ink paint survives there.
  backing: (x, y) => x < 270 && y < 500,
};

/** Stone and paving print pass. */
export const stonePrint = {
  median: 5,
  cream: [240, 209, 148],
  shadowLum: 80,
  midLum: 150,
  inkShade: 0.6,
  shadowTone: [44, 68, 71],
  harden: 0.5,
  flatten: 0.7,
  speckDepth: 35,
  speckCell: 6,
  speckKeep: 0.33,
  ink: inks.ink,
  grain: 4,
};

/** Posterisation palettes for the three digital props. */
export const propPrint = {
  options: { median: 3, edgeNoise: 30, grain: 4, lumWeight: 1.5 },
  globe: [inks.paper, inks.turquoise, inks.ochre, inks.ink, inks.brass],
  recordPlayer: [
    inks.ink,
    inks.navy,
    inks.paper,
    inks.ochre,
    inks.cream,
    inks.brass,
  ],
  magnifier: [inks.ink, inks.navy, inks.brass, inks.turquoise, inks.paper],
  lens: {
    turquoise: inks.turquoise,
    tolerance: 34,
    erode: 6,
    paper: inks.paper,
    pale: [118, 184, 186],
    cream: inks.cream,
  },
};

/** Parapet-only print overrides and its face target from the poster's wall. */
export const parapetPrint = {
  speckKeep: 0.08,
  inkShade: 0.23,
  flatten: 0.82,
  horizontalFlecks: 7,
  faceTarget: [145, 142, 106],
  faceRows: { fromTop: 40, toBottom: 10 },
  /** Cap strip (from the layer's top down to this many px below the painted
   *  top edge) flattened to a clean lighter stone. */
  capDepth: 14,
  capFlatten: 0.8,
};

/** One shadow family: blue ink, elliptical, lower-right. */
export const shadowFamily = { opacity: 0.55, feather: 4, grain: 0.05 };

/** Pedestal plinth softened into an ellipse (scene-plate pixels). */
export const plinth = {
  box: { x: 560, y: 1138, w: 140, h: 36 },
  ellipse: { cx: 631, cy: 1158, rx: 68, ry: 12 },
};

/** Ink ellipse baked under the tabletop props (same style as the ashtray). */
export const propShadow = {
  opacity: 0.55,
  feather: 3,
  padSide: 6,
  padBottom: 24,
  rx: 0.46,
  ry: 0.11,
  dx: 4,
  lift: 4,
};

/** Carved stone plaque for the engraved date: wall-face texture from the
 *  parapet (scene-plate pixels), ink border, light inner bevel, no text. */
export const plaque = {
  rect: { x: 300, y: 816, w: 210, h: 52 },
  source: { x: 600, y: 828 },
  depth: 6.4,
};

/** Tree plate extension to the left (scaled-file px) so no cut edge can
 *  show on a left lean: mirrored trunk/mass columns plus mirrored leaf sprays. */
export const TREE_EXTEND = 180;
/** Longest mirrored trunk/mass run in the extension (px); beyond it only
 *  leaf sprays, so the trunk does not double in width. */
export const TREE_MIRROR_RUN = 90;

/** Layer margins the stage may lean into: paint beyond the visible band. */
export const bandMargins = { left: 120, right: 120, top: 60, bottom: 60 };

/** Edges of each plate that are real painted boundaries and may enter the
 *  view on lean (the stage clamps lean away from the other, cut edges). */
export const safeEdges = {
  tree: ['top', 'right'],
  'far-coast': ['right', 'top', 'bottom'],
  'near-coast': ['right', 'top'],
  chair: ['top', 'right', 'left'],
  clouds: ['top', 'right', 'bottom', 'left'],
  'sea-flecks': ['top', 'right', 'bottom', 'left'],
  sea: ['top'],
  'chair-shadow': ['top', 'right', 'bottom', 'left'],
  'records-shadow': ['top', 'right', 'bottom', 'left'],
  // The plaque is a sprite; sprites are never edge-constrained and the stage
  // rejects safeEdges on them.
};


/** Cloud streak layer: harder edges, sage-grey tint, tileable fades. */
export const cloudPrint = {
  hardLo: 0.3,
  hardSpan: 0.4,
  tint: [169, 188, 178],
  tintMix: 0.6,
  edgeFade: 40,
  opacity: 0.75,
};
