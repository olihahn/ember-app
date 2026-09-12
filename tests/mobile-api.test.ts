import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMobileApi } from '../lib/server/mobile-api.ts';
import type { MobileApiEnv } from '../lib/server/mobile-api.ts';

const URL_BASE = 'https://ember-android-api.example';
const DEVICE_TOKEN = 'test-device-pairing-token-not-a-real-secret-000000';
const OPENAI_KEY = 'test-openai-key-never-network';
const ENV: MobileApiEnv = {
  EMBER_DEVICE_TOKEN: DEVICE_TOKEN,
  OPENAI_API_KEY: OPENAI_KEY,
};
const PHOTO = `data:image/jpeg;base64,${btoa('\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01')}`;

function statusRequest(headers: Record<string, string> = {}): Request {
  return new Request(`${URL_BASE}/api/status`, {
    headers: { Authorization: `Bearer ${DEVICE_TOKEN}`, ...headers },
  });
}

function scanRequest(
  headers: Record<string, string> = {},
  body: unknown = { image: PHOTO },
): Request {
  return new Request(`${URL_BASE}/api/identify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEVICE_TOKEN}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function nonCigarResponse(): Response {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                subject: {
                  kind: 'no_cigar',
                  visibleCount: 0,
                  confidence: 'high',
                },
                brand: '',
                line: '',
                visibleText: '',
                confidence: 'low',
                explanation: 'No readable cigar band found.',
                alternatives: [],
              }),
            },
          ],
        },
      ],
    }),
  );
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  assert.ok(typeof body === 'object' && body !== null && !Array.isArray(body));
  return body as Record<string, unknown>;
}

function providerMock() {
  const calls: { url: string; authorization: string | null; body: string }[] =
    [];
  const fetcher: typeof fetch = async (url, init) => {
    assert.ok(typeof url === 'string' && typeof init?.body === 'string');
    if (typeof url !== 'string' || typeof init?.body !== 'string')
      throw new Error('Expected provider request');
    calls.push({
      url,
      authorization: new Headers(init.headers).get('authorization'),
      body: init.body,
    });
    return nonCigarResponse();
  };
  return { calls, fetcher };
}

function forbiddenFetch(): typeof fetch {
  return async () => {
    assert.fail('This request must not contact OpenAI');
  };
}

void test('status requires pairing and returns only readiness without a provider call', async () => {
  const handle = createMobileApi(forbiddenFetch());
  const response = await handle(statusRequest(), ENV);
  assert.equal(response.status, 200);
  assert.deepEqual(await bodyOf(response), { ready: true, configured: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('location'), null);
});

void test('both endpoints reject missing, malformed and incorrect bearer tokens before provider access', async () => {
  const mock = providerMock();
  const handle = createMobileApi(mock.fetcher);
  for (const authorization of [
    '',
    'Basic token',
    `Bearer ${'x'.repeat(DEVICE_TOKEN.length)}`,
    `Bearer X${DEVICE_TOKEN.slice(1)}`,
    `Bearer ${DEVICE_TOKEN.slice(0, -1)}X`,
    `Bearer ${'a'.repeat(257)}`,
  ]) {
    for (const input of [
      statusRequest({ Authorization: authorization }),
      scanRequest({ Authorization: authorization }),
    ]) {
      const response = await handle(input, ENV);
      assert.equal(response.status, 401);
      const body = await bodyOf(response);
      assert.equal(body.code, 'UNAUTHORIZED');
      assert.ok(!JSON.stringify(body).includes(DEVICE_TOKEN));
      assert.ok(!JSON.stringify(body).includes(OPENAI_KEY));
    }
  }
  assert.equal(mock.calls.length, 0);
});

void test('a token in a query string or JSON body does not authenticate', async () => {
  const handle = createMobileApi(forbiddenFetch());
  const requests = [
    new Request(`${URL_BASE}/api/status?token=${DEVICE_TOKEN}`),
    scanRequest({ Authorization: '' }, { image: PHOTO, token: DEVICE_TOKEN }),
  ];
  for (const input of requests)
    assert.equal((await handle(input, ENV)).status, 401);
});

void test('missing, short or whitespace-containing configured secrets fail closed', async () => {
  const handle = createMobileApi(forbiddenFetch());
  const configs: MobileApiEnv[] = [
    {},
    { OPENAI_API_KEY: OPENAI_KEY },
    { ...ENV, EMBER_DEVICE_TOKEN: 'too-short' },
    { ...ENV, EMBER_DEVICE_TOKEN: `${DEVICE_TOKEN} ` },
    { ...ENV, OPENAI_API_KEY: '' },
    { ...ENV, OPENAI_API_KEY: '  ' },
  ];
  for (const config of configs) {
    for (const input of [statusRequest(), scanRequest()]) {
      const response = await handle(input, config);
      assert.equal(response.status, 503);
      assert.equal((await bodyOf(response)).code, 'BACKEND_NOT_CONFIGURED');
    }
  }
});

void test('rotating the runtime pairing secret immediately revokes the old token', async () => {
  const handle = createMobileApi(forbiddenFetch());
  const replacement = `${DEVICE_TOKEN.slice(0, -4)}9999`;
  const config = { ...ENV, EMBER_DEVICE_TOKEN: replacement };
  assert.equal((await handle(statusRequest(), config)).status, 401);
  assert.equal(
    (
      await handle(
        statusRequest({ Authorization: `Bearer ${replacement}` }),
        config,
      )
    ).status,
    200,
  );
});

void test('authenticated native and Capacitor requests reach identification without forwarding the pairing secret', async () => {
  const mock = providerMock();
  const handle = createMobileApi(mock.fetcher);
  for (const origin of [
    null,
    'https://localhost',
    'http://localhost',
    'capacitor://localhost',
  ]) {
    const headers: Record<string, string> = origin
      ? { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }
      : {};
    const response = await handle(
      scanRequest(headers, { image: PHOTO, hint: 'Unreadable band' }),
      ENV,
    );
    assert.equal(response.status, 422);
    const body = await bodyOf(response);
    assert.equal(body.outcome, 'no_cigar');
    assert.equal(body.error, 'No cigar in sight.');
    assert.equal('candidate' in body, false);
    assert.equal('sources' in body, false);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
  }
  assert.equal(mock.calls.length, 4);
  for (const call of mock.calls) {
    assert.equal(call.url, 'https://api.openai.com/v1/responses');
    assert.equal(call.authorization, `Bearer ${OPENAI_KEY}`);
    assert.ok(call.body.includes(PHOTO));
    assert.ok(call.body.includes('Unreadable band'));
    assert.ok(!call.body.includes(DEVICE_TOKEN));
  }
});

void test('the scan body excludes journal notes and other unrelated fields', async () => {
  const handle = createMobileApi(forbiddenFetch());
  const response = await handle(
    scanRequest(
      {},
      { image: PHOTO, notes: 'A private tasting note', rating: 5 },
    ),
    ENV,
  );
  assert.equal(response.status, 400);
  assert.equal((await bodyOf(response)).code, 'INVALID_REQUEST');
});

void test('untrusted origins cannot call either endpoint, even with a correct token', async () => {
  const handle = createMobileApi(forbiddenFetch());
  for (const origin of [
    'https://evil.example',
    'https://localhost.evil.example',
    'null',
    'http://localhost:3000',
  ]) {
    for (const input of [
      statusRequest({ Origin: origin }),
      scanRequest({ Origin: origin }),
    ]) {
      const response = await handle(input, ENV);
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      assert.equal((await bodyOf(response)).code, 'ORIGIN_NOT_ALLOWED');
    }
  }
});

void test('preflight allows only Capacitor origins, the actual route method, and authorization/content-type', async () => {
  const handle = createMobileApi(forbiddenFetch());
  const preflight = (
    path: string,
    origin: string,
    method: string,
    headers = 'Authorization, Content-Type',
  ) =>
    new Request(`${URL_BASE}${path}`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': headers,
      },
    });
  const response = await handle(
    preflight('/api/identify', 'https://localhost', 'POST'),
    {},
  );
  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    'https://localhost',
  );
  assert.equal(
    response.headers.get('access-control-allow-methods'),
    'POST, OPTIONS',
  );
  assert.equal(
    response.headers.get('access-control-allow-headers'),
    'Authorization, Content-Type',
  );
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  for (const input of [
    preflight('/api/identify', 'https://evil.example', 'POST'),
    preflight('/api/identify', 'https://localhost', 'DELETE'),
    preflight('/api/status', 'https://localhost', 'POST'),
    preflight('/api/identify', 'https://localhost', 'POST', 'X-Admin'),
    new Request(`${URL_BASE}/api/identify`, { method: 'OPTIONS' }),
  ])
    assert.equal((await handle(input, ENV)).status, 403);
  assert.equal(
    (
      await handle(
        scanRequest({ Authorization: '', Origin: 'https://localhost' }),
        ENV,
      )
    ).status,
    401,
  );
});

void test('unknown routes and methods fail without redirects or provider calls', async () => {
  const handle = createMobileApi(forbiddenFetch());
  const cases: [Request, number][] = [
    [new Request(`${URL_BASE}/`), 404],
    [new Request(`${URL_BASE}/api/identify/`), 404],
    [new Request(`${URL_BASE}/api/identify`), 405],
    [new Request(`${URL_BASE}/api/status`, { method: 'POST' }), 405],
  ];
  for (const [input, status] of cases) {
    const response = await handle(input, ENV);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('location'), null);
  }
});

void test('one scan per isolate can be active and the flag clears when it finishes', async () => {
  let announceStart: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    announceStart = resolve;
  });
  let finish: (response: Response) => void = () => undefined;
  const providerPending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    if (calls === 1) {
      announceStart();
      return providerPending;
    }
    return nonCigarResponse();
  };
  const handle = createMobileApi(fetcher);
  const first = handle(scanRequest(), ENV);
  await started;
  const busy = await handle(scanRequest(), ENV);
  assert.equal(busy.status, 429);
  assert.equal((await bodyOf(busy)).code, 'SCAN_IN_PROGRESS');
  assert.equal(calls, 1);
  assert.equal((await handle(statusRequest(), ENV)).status, 200);
  finish(nonCigarResponse());
  assert.equal((await first).status, 422);
  assert.equal((await handle(scanRequest(), ENV)).status, 422);
  assert.equal(calls, 2);
});

void test('six scan starts per minute are allowed, status checks do not count, and the window expires', async () => {
  let time = 1_000_000;
  const mock = providerMock();
  const handle = createMobileApi(mock.fetcher, () => time);
  for (let index = 0; index < 6; index++) {
    assert.equal((await handle(statusRequest(), ENV)).status, 200);
    assert.equal((await handle(scanRequest(), ENV)).status, 422);
  }
  const limited = await handle(scanRequest(), ENV);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal((await bodyOf(limited)).code, 'SCAN_LIMIT_REACHED');
  assert.equal(mock.calls.length, 6);
  time += 60_000;
  assert.equal((await handle(scanRequest(), ENV)).status, 422);
  assert.equal(mock.calls.length, 7);
});

void test('unauthorized attempts do not consume the authenticated scan allowance', async () => {
  const mock = providerMock();
  const handle = createMobileApi(mock.fetcher);
  for (let index = 0; index < 10; index++) {
    assert.equal(
      (await handle(scanRequest({ Authorization: '' }), ENV)).status,
      401,
    );
  }
  for (let index = 0; index < 6; index++)
    assert.equal((await handle(scanRequest(), ENV)).status, 422);
  assert.equal(mock.calls.length, 6);
});

void test('a provider failure releases the active flag without retrying or exposing secrets', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    if (calls === 1)
      return new Response(`Provider failure ${OPENAI_KEY} ${DEVICE_TOKEN}`, {
        status: 500,
      });
    return nonCigarResponse();
  };
  const handle = createMobileApi(fetcher);
  const failed = await handle(scanRequest(), ENV);
  assert.equal(failed.status, 502);
  const body = await bodyOf(failed);
  assert.equal(body.code, 'UPSTREAM_UNAVAILABLE');
  assert.ok(!JSON.stringify(body).includes(OPENAI_KEY));
  assert.ok(!JSON.stringify(body).includes(DEVICE_TOKEN));
  assert.equal(calls, 1);
  assert.equal((await handle(scanRequest(), ENV)).status, 422);
  assert.equal(calls, 2);
});
