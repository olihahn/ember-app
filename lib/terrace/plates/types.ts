export type TerraceDestination = 'journal' | 'atlas' | 'identify' | 'records';
export type SceneController = {
  dispose: () => void;
  setMotion: (enabled: boolean) => void;
  /** Playback state, with the current record's title for the caption. */
  setPlaying: (playing: boolean, trackTitle?: string) => void;
  setActive: (active: boolean) => void;
  enter: (destination: TerraceDestination, done: () => void) => void;
  resetView: () => void;
  /** Read-only diagnostics; not part of the component contract. */
  inspect?: () => { lean: { x: number; y: number }; trackTitle?: string };
};
export type StageOptions = {
  host: HTMLElement;
  buttons: Partial<Record<TerraceDestination, HTMLButtonElement>>;
  /** Accepted for older callers; the stage no longer letters a plaque. */
  established?: HTMLElement;
  motion: boolean;
  playing: boolean;
  active: boolean;
  onReady: () => void;
  onFailure: () => void;
  /** Folder holding this room's manifest and plates, served under the app origin. */
  /** Folder holding this room's manifest and plates, e.g. `/plates/<name>/`. */
  theme: string;
  /** Class put on the canvas element so the host can style it. */
  canvasClass?: string;
  /** Seated lean limits in world units. */
  lean?: { x: number; y: number };
  /** Source of the once-per-scene animation phases; tests pass a fixed one. */
  random?: () => number;
};
