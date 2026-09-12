import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {
  CameraResultType,
  CameraSource,
  MediaTypeSelection,
} from '@capacitor/camera';

// Exercise the real adapter with native calls replaced, without opening a device
// or letting a local-photo fetch make a network request.
function cameraHarness(
  result: unknown = { webPath: '/_capacitor_file_/picked.jpg' },
  failure?: Error,
) {
  const calls: { method: string; options: unknown }[] = [];
  let reads = 0;
  const invoke = (method: string) => async (options: unknown) => {
    calls.push({ method, options });
    if (failure) throw failure;
    return method === 'chooseFromGallery' ? { results: [result] } : result;
  };
  const exports: { devicePhoto?: (source: string) => Promise<File> } = {};
  const code = ts.transpileModule(
    readFileSync(new URL('../lib/mobile.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name === '@capacitor/camera')
        return {
          Camera: {
            getPhoto: invoke('getPhoto'),
            takePhoto: invoke('takePhoto'),
            chooseFromGallery: invoke('chooseFromGallery'),
          },
          CameraSource,
          CameraResultType,
          MediaTypeSelection,
        };
      if (name === '@capacitor/geolocation' || name === './native-bridge')
        return {};
      throw new Error(`Unexpected import: ${name}`);
    },
    URL,
    File,
    window: {
      location: { href: 'https://localhost/', origin: 'https://localhost' },
    },
    fetch: async (url: URL) => {
      assert.equal(url.href, 'https://localhost/_capacitor_file_/picked.jpg');
      reads++;
      return new Response(new Uint8Array([255, 216, 255, 217]), {
        headers: { 'Content-Type': 'image/jpeg' },
      });
    },
  });
  return {
    devicePhoto: exports.devicePhoto!,
    calls,
    reads: () => reads,
  };
}

void test('single-photo gallery uses the public picker path without the Ion loading activity', async () => {
  const harness = cameraHarness();
  const file = await harness.devicePhoto('gallery');
  assert.deepEqual(JSON.parse(JSON.stringify(harness.calls)), [
    {
      method: 'getPhoto',
      options: {
        source: 'PHOTOS',
        resultType: 'uri',
        allowEditing: false,
        saveToGallery: false,
        correctOrientation: true,
        quality: 90,
        width: 1600,
        height: 1600,
      },
    },
  ]);
  assert.equal(file.type, 'image/jpeg');
  assert.equal(file.size, 4);
  assert.equal(harness.reads(), 1);
});

void test('camera capture keeps its existing API and bounded local-image options', async () => {
  const harness = cameraHarness();
  await harness.devicePhoto('camera');
  assert.deepEqual(JSON.parse(JSON.stringify(harness.calls)), [
    {
      method: 'takePhoto',
      options: {
        quality: 90,
        saveToGallery: false,
        includeMetadata: false,
        targetWidth: 1600,
        targetHeight: 1600,
      },
    },
  ]);
  assert.equal(harness.reads(), 1);
});

void test('gallery cancellation does not fetch a photo or reopen another picker', async () => {
  const cancelled = new Error('User cancelled photos app');
  const harness = cameraHarness(undefined, cancelled);
  await assert.rejects(
    harness.devicePhoto('gallery'),
    (error) => error === cancelled,
  );
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.reads(), 0);
});
