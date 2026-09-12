import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { EmberNative, isNative } from './native-bridge';
import type { CigarDraft } from './types';

export async function photoFileFromResult(result: unknown): Promise<File> {
  if (!result || typeof result !== 'object')
    throw new Error('No photo was returned.');
  const value = result as { webPath?: unknown };
  if (typeof value.webPath !== 'string')
    throw new Error('The camera did not return a readable photo.');
  const url = new URL(value.webPath, window.location.href);
  if (url.origin !== window.location.origin)
    throw new Error('The photo must come from this device.');
  const response = await fetch(url);
  if (!response.ok) throw new Error('The selected photo could not be opened.');
  const blob = await response.blob();
  return new File([blob], 'cigar-photo.jpg', {
    type: blob.type || 'image/jpeg',
  });
}

let pickerDepth = 0;
let pickerGrace = 0;
/**
 * True while one of Ember's own native pickers owns the screen. Leaving Ember
 * still pauses the record; stepping into our camera to photograph the cigar in
 * front of you does not, so the music carries through the whole flow. The
 * grace period covers the lifecycle events that arrive just after the picker
 * hands control back.
 */
export function isDevicePickerOpen() {
  return pickerDepth > 0 || Date.now() < pickerGrace;
}

/* oxlint-disable typescript/no-deprecated -- Public v8 picker fallback for the observed Ion loading-activity race below. */
export async function devicePhoto(source: 'camera' | 'gallery'): Promise<File> {
  pickerDepth++;
  try {
    return await photoFileFromResult(await openPicker(source));
  } finally {
    pickerDepth--;
    pickerGrace = Date.now() + 1500;
  }
}

async function openPicker(source: 'camera' | 'gallery') {
  const result =
    source === 'camera'
      ? await Camera.takePhoto({
          quality: 90,
          saveToGallery: false,
          includeMetadata: false,
          targetWidth: 1600,
          targetHeight: 1600,
        })
      : await Camera.getPhoto({
          // Camera 8.2.4's newer gallery flow can send its loading-dismiss
          // broadcast before the activity registers its receiver. This public
          // v8 single-photo path uses PickVisualMedia without that overlay.
          // Revisit this workaround when upgrading the pinned Camera plugin.
          source: CameraSource.Photos,
          resultType: CameraResultType.Uri,
          // The picker has no includeMetadata option; the width/height resize
          // below re-encodes, which drops EXIF from gallery picks in practice.
          allowEditing: false,
          saveToGallery: false,
          correctOrientation: true,
          quality: 90,
          width: 1600,
          height: 1600,
        });
  return result;
}
/* oxlint-enable typescript/no-deprecated */

export function currentPosition() {
  if (isNative())
    return Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 15000,
      maximumAge: 60000,
    });
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(
        new Error('Location is not available. Add coordinates manually.'),
      );
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 15000,
      maximumAge: 60000,
    });
  });
}

export async function identifyPhoto(
  body: string,
  signal: AbortSignal,
): Promise<Response> {
  if (isNative()) {
    const result = await EmberNative.identify({ body });
    return new Response(JSON.stringify(result.data), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // Native goes through the Java bridge above. The browser build posts to an
  // `/api/identify` of your own: this repository ships the Cloudflare Worker in
  // `worker/`, not a web route. See docs/BACKEND.md.
  return fetch('/api/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal,
  });
}

// Android may reclaim the WebView while the separate camera activity is open.
// This one temporary draft stays on-device and is removed after the activity returns.
type Recovery = {
  draft: CigarDraft;
  editingId: string | null;
  savedAt: number;
};
async function recoveryStore(
  mode: IDBTransactionMode,
  value?: Recovery | null,
): Promise<Recovery | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('ember-camera-recovery', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('pending');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () =>
      reject(
        new Error('Could not protect the draft before opening the camera.'),
      );
  });
  try {
    return await new Promise<Recovery | undefined>((resolve, reject) => {
      const tx = db.transaction('pending', mode);
      const store = tx.objectStore('pending');
      const request =
        value === undefined
          ? store.get('camera')
          : value === null
            ? store.delete('camera')
            : store.put(value, 'camera');
      tx.oncomplete = () =>
        resolve(
          value === undefined
            ? (request.result as Recovery | undefined)
            : undefined,
        );
      tx.onerror = () =>
        reject(new Error('The camera draft could not be saved.'));
      tx.onabort = () =>
        reject(new Error('The camera draft could not be saved.'));
    });
  } finally {
    db.close();
  }
}
export async function saveCameraRecovery(
  draft: CigarDraft,
  editingId: string | null,
) {
  await recoveryStore('readwrite', { draft, editingId, savedAt: Date.now() });
}
export async function readCameraRecovery() {
  const item = await recoveryStore('readonly');
  return item && Date.now() - item.savedAt < 24 * 60 * 60 * 1000
    ? item
    : undefined;
}
export async function clearCameraRecovery() {
  await recoveryStore('readwrite', null);
}
