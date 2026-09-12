// Real local workerd runtime; dummy bindings and intercepted provider traffic.
// No Keychain reads, real credentials, public photos, or paid requests.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const token = 'dummy-ember-worker-runtime-token-000000000000';
const providerKey = 'dummy-openai-key-never-network';
const image = `data:image/jpeg;base64,${btoa('\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01')}`;
const bundled = await build({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
});
let providerCalls = 0;
let redirectProvider = false;
let providerSubject = { kind: 'no_cigar', visibleCount: 0, confidence: 'high' };
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    name: 'ember-runtime-regression',
    modules: true,
    script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-15',
    bindings: {
      OPENAI_MODEL: 'gpt-4.1-mini',
      OPENAI_API_KEY: providerKey,
      EMBER_DEVICE_TOKEN: token,
    },
    outboundService: async (request) => {
      providerCalls++;
      assert.equal(request.url, 'https://api.openai.com/v1/responses');
      assert.equal(
        request.headers.get('authorization'),
        `Bearer ${providerKey}`,
      );
      const input = await request.json();
      assert.equal(input.store, false);
      assert.equal(
        input.tools,
        undefined,
        'Rejected subjects must not reach web search',
      );
      if (redirectProvider)
        return new Response(null, {
          status: 302,
          headers: {
            Location: 'https://must-never-receive-credentials.invalid/',
          },
        });
      return Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  subject: providerSubject,
                  brand: '',
                  line: '',
                  visibleText: '',
                  confidence: 'low',
                  explanation: 'No cigar in the dummy fixture.',
                  alternatives: [],
                }),
              },
            ],
          },
        ],
      });
    },
  }),
);

async function call(path, body, authenticated = true) {
  const response = await runtime.dispatchFetch(
    `https://ember-runtime.invalid${path}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  return { status: response.status, body: await response.json() };
}

try {
  assert.equal((await call('/api/status', undefined, false)).status, 401);
  assert.equal((await call('/api/identify', {}, false)).status, 401);
  assert.equal((await call('/api/status')).status, 200);
  assert.equal((await call('/api/identify', {})).status, 400);
  assert.equal(providerCalls, 0);
  const negative = await call('/api/identify', { image });
  assert.equal(negative.status, 422);
  assert.equal(negative.body.outcome, 'no_cigar');
  assert.equal(negative.body.error, 'No cigar in sight.');
  assert.equal('candidate' in negative.body, false);
  assert.equal('sources' in negative.body, false);
  assert.equal(providerCalls, 1);
  for (const [subject, outcome, error] of [
    [
      { kind: 'multiple_cigars', visibleCount: 2, confidence: 'high' },
      'multiple_cigars',
      'One cigar at a time.',
    ],
    [
      { kind: 'uncertain', visibleCount: null, confidence: 'low' },
      'unclear_photo',
      'A clearer photo, please.',
    ],
  ]) {
    providerSubject = subject;
    const before = providerCalls;
    const rejected = await call('/api/identify', { image });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.outcome, outcome);
    assert.equal(rejected.body.error, error);
    assert.deepEqual(Object.keys(rejected.body).sort(), [
      'code',
      'error',
      'outcome',
      'subject',
    ]);
    assert.equal(providerCalls, before + 1);
  }
  providerSubject = {
    kind: 'single_cigar',
    visibleCount: 1.5,
    confidence: 'high',
  };
  const malformed = await call('/api/identify', { image });
  assert.equal(malformed.status, 502);
  assert.equal(malformed.body.code, 'INVALID_PROVIDER_RESPONSE');
  assert.equal(providerCalls, 4);
  redirectProvider = true;
  const redirected = await call('/api/identify', { image });
  assert.equal(redirected.status, 502);
  assert.equal(redirected.body.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(providerCalls, 5, 'A provider redirect must never be followed');
  console.log(
    JSON.stringify({
      runtime: 'workerd',
      passed: [
        'authentication',
        'invalid image',
        'no cigar / multiple cigars / unclear photo without search',
        'malformed count rejected',
        'redirect refusal',
      ],
      externalProviderCalls: 0,
    }),
  );
} finally {
  await runtime.dispose();
}
