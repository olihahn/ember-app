import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(
  new URL('../public/sw.js', import.meta.url),
  'utf8',
);
function runtime(fetcher: (request: unknown) => Promise<Response>) {
  const handlers: Record<string, (event: Record<string, unknown>) => void> = {};
  const stored = new Map<unknown, Response>();
  const cache = {
    add: async () => {},
    put: async (key: unknown, response: Response) => {
      stored.set(key, response);
    },
  };
  runInNewContext(script, {
    self: {
      location: { origin: 'https://ember.example' },
      addEventListener: (event: string, handler: (typeof handlers)[string]) => {
        handlers[event] = handler;
      },
      clients: { claim: async () => {} },
    },
    caches: {
      open: async () => cache,
      match: async (key: unknown) => stored.get(key),
      keys: async () => ['unrelated-cache'],
      delete: async () => {},
    },
    fetch: fetcher,
    URL,
    Response,
    Promise,
  });
  return { handlers, stored };
}
void test('service worker never intercepts API, uploads, identity routes or external requests', () => {
  const sw = runtime(async () => new Response('network'));
  for (const request of [
    { url: 'https://ember.example/api/identify', method: 'POST', mode: 'cors' },
    { url: 'https://ember.example/api/status', method: 'GET', mode: 'cors' },
    { url: 'https://ember.example/__auth', method: 'GET', mode: 'navigate' },
    {
      url: 'https://ember.example/signin-with-chatgpt',
      method: 'GET',
      mode: 'navigate',
    },
    { url: 'https://api.openai.com/v1/responses', method: 'GET', mode: 'cors' },
  ]) {
    let intercepted = false;
    sw.handlers.fetch({
      request,
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, request.url);
  }
});
void test('offline navigation returns the cached app shell', async () => {
  const sw = runtime(async () => {
    throw new TypeError('offline');
  });
  sw.stored.set('/', new Response('cached app'));
  let response!: Promise<Response>;
  sw.handlers.fetch({
    request: { url: 'https://ember.example/', method: 'GET', mode: 'navigate' },
    respondWith: (value: Promise<Response>) => {
      response = value;
    },
  });
  assert.equal(await (await response).text(), 'cached app');
});
void test('a login page cannot replace the cached app shell', async () => {
  const sw = runtime(
    async () =>
      new Response('<html>Sign in</html>', {
        headers: { 'Content-Type': 'text/html' },
      }),
  );
  sw.stored.set('/', new Response('original shell'));
  let response!: Promise<Response>;
  sw.handlers.fetch({
    request: { url: 'https://ember.example/', method: 'GET', mode: 'navigate' },
    respondWith: (value: Promise<Response>) => {
      response = value;
    },
  });
  await response;
  assert.equal(await sw.stored.get('/')!.text(), 'original shell');
});
void test('offline first visit explains why the shell is unavailable', async () => {
  const sw = runtime(async () => {
    throw new TypeError('offline');
  });
  let response!: Promise<Response>;
  sw.handlers.fetch({
    request: { url: 'https://ember.example/', method: 'GET', mode: 'navigate' },
    respondWith: (value: Promise<Response>) => {
      response = value;
    },
  });
  assert.equal((await response).status, 503);
  assert.match(await (await response).text(), /once while online/);
});
