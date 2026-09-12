import { handleIdentify } from './identify';

export interface MobileApiEnv {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  EMBER_DEVICE_TOKEN?: string;
}

const allowedOrigins = new Set([
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
]);
const windowMs = 60_000;
const scansPerWindow = 6;
const encoder = new TextEncoder();

/**
 * One factory instance per Worker isolate. The throttle is best effort: it is
 * neither shared across isolates nor durable across restarts. The random owner
 * token provides access control; never embed it or an OpenAI key in the APK.
 */
export function createMobileApi(
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): (request: Request, env: MobileApiEnv) => Promise<Response> {
  let active = false;
  let recent: number[] = [];

  return async function handleMobileApi(request, env) {
    const origin = request.headers.get('origin');
    const corsOrigin = origin && allowedOrigins.has(origin) ? origin : null;
    const respond = (response: Response) =>
      withResponseHeaders(response, corsOrigin);
    try {
      const path = new URL(request.url).pathname;
      const expectedMethod =
        path === '/api/status'
          ? 'GET'
          : path === '/api/identify'
            ? 'POST'
            : null;
      if (!expectedMethod) {
        return respond(
          failure(404, 'NOT_FOUND', 'This endpoint does not exist.'),
        );
      }
      if (origin !== null && !corsOrigin) {
        return respond(
          failure(
            403,
            'ORIGIN_NOT_ALLOWED',
            'Open the Android app to use this backend.',
          ),
        );
      }

      // Browser preflight carries no bearer token. It grants only permission to
      // send a request; both actual endpoints still authenticate below.
      if (request.method === 'OPTIONS') {
        const requestedHeaders = (
          request.headers.get('access-control-request-headers') ?? ''
        )
          .split(',')
          .map((header) => header.trim().toLowerCase())
          .filter(Boolean);
        if (
          !corsOrigin ||
          request.headers.get('access-control-request-method') !==
            expectedMethod ||
          requestedHeaders.some(
            (header) => header !== 'authorization' && header !== 'content-type',
          )
        ) {
          return respond(
            failure(
              403,
              'PREFLIGHT_NOT_ALLOWED',
              'This request is not allowed.',
            ),
          );
        }
        return respond(
          new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Methods': `${expectedMethod}, OPTIONS`,
              'Access-Control-Allow-Headers': 'Authorization, Content-Type',
              'Access-Control-Max-Age': '600',
            },
          }),
        );
      }
      if (request.method !== expectedMethod) {
        return respond(
          failure(
            405,
            'METHOD_NOT_ALLOWED',
            `Use ${expectedMethod} for this endpoint.`,
            {
              Allow: `${expectedMethod}, OPTIONS`,
            },
          ),
        );
      }

      const configuredToken = env.EMBER_DEVICE_TOKEN;
      if (
        typeof configuredToken !== 'string' ||
        !/^[\x21-\x7e]{32,256}$/.test(configuredToken)
      ) {
        return respond(notConfigured());
      }
      const authorization = request.headers.get('authorization') ?? '';
      const token = /^Bearer ([\x21-\x7e]{32,256})$/i.exec(authorization)?.[1];
      if (!token || !(await equalToken(token, configuredToken))) {
        return respond(
          failure(
            401,
            'UNAUTHORIZED',
            'The device pairing token is missing or incorrect.',
            {
              'WWW-Authenticate': 'Bearer',
            },
          ),
        );
      }
      if (!env.OPENAI_API_KEY?.trim()) return respond(notConfigured());

      if (path === '/api/status') {
        return respond(json({ ready: true, configured: true }));
      }

      const time = now();
      recent = recent.filter((startedAt) => startedAt > time - windowMs);
      if (active) {
        return respond(
          failure(
            429,
            'SCAN_IN_PROGRESS',
            'A scan is already running. Wait for it to finish before starting another.',
          ),
        );
      }
      if (recent.length >= scansPerWindow) {
        const retryAfter = Math.max(
          1,
          Math.ceil((recent[0] + windowMs - time) / 1000),
        );
        return respond(
          failure(
            429,
            'SCAN_LIMIT_REACHED',
            'You have reached the scan limit. Wait a moment before trying again.',
            {
              'Retry-After': String(retryAfter),
            },
          ),
        );
      }
      recent.push(time);
      active = true;
      try {
        // Native app origins differ from the Worker URL. Origin validation and
        // owner authentication have already happened here; the web handler
        // receives only the content headers it needs, never the pairing token.
        const contentHeaders = new Headers();
        for (const header of ['content-type', 'content-length']) {
          const value = request.headers.get(header);
          if (value !== null) contentHeaders.set(header, value);
        }
        const internalRequest = new Request(request, {
          headers: contentHeaders,
          // The deployed Workers compatibility date supports manual/follow,
          // not the browser/Node-only "error" value. Never follow redirects.
          redirect: 'manual',
        });
        return respond(
          await handleIdentify(
            internalRequest,
            {
              apiKey: env.OPENAI_API_KEY,
              model: env.OPENAI_MODEL,
            },
            fetcher,
          ),
        );
      } finally {
        active = false;
      }
    } catch {
      return respond(
        failure(
          500,
          'BACKEND_UNAVAILABLE',
          'The identification backend could not finish this request. Please try again later.',
        ),
      );
    }
  };
}

async function equalToken(
  supplied: string,
  expected: string,
): Promise<boolean> {
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(suppliedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  // Both SHA-256 digests have exactly 32 bytes. Compare every byte without
  // exiting at the first mismatch; never compare secret strings directly.
  for (let index = 0; index < 32; index++)
    difference |= left[index] ^ right[index];
  return difference === 0;
}

function notConfigured(): Response {
  return failure(
    503,
    'BACKEND_NOT_CONFIGURED',
    'The identification backend is not configured yet. You can still add cigars manually.',
  );
}

function failure(
  status: number,
  code: string,
  error: string,
  headers: Record<string, string> = {},
): Response {
  return json({ error, code }, status, headers);
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function withResponseHeaders(
  response: Response,
  origin: string | null,
): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Vary', 'Origin');
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(response.body, { status: response.status, headers });
}
