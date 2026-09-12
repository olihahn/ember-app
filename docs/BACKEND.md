# The identification backend

The app bundles the journal and the camera. Recognition is done by OpenAI, and
a small [Cloudflare Worker](../worker/index.ts) sits in between for one reason:
to keep the OpenAI key off the phone. Any server that can hold a secret and
speak HTTPS could play the same role.

Manual entries, ratings, notes, purchase places and saved photos all work with
no backend at all. Identification is the only feature that needs one.

## The pairing model

The phone stores two things: a service address and a **device pairing token**.
The token is not an OpenAI key, is never built into the APK, and is encrypted
with the Android Keystore; the native bridge never hands it back to JavaScript.
Requests carry `Authorization: Bearer <device token>`, and only to the address
you configured.

The OpenAI key exists only as a Worker secret. It is never entered on the phone.

## Deploying your own

```sh
npx wrangler deploy --config wrangler.api.jsonc --strict
npx wrangler secret put OPENAI_API_KEY      # your API Platform key
npx wrangler secret put EMBER_DEVICE_TOKEN  # a long random string you generate
```

The Worker fails closed until both secrets exist: without a well-formed
`EMBER_DEVICE_TOKEN` or an `OPENAI_API_KEY` it answers every request with a
"not configured" response and never contacts OpenAI. Deploying without them
succeeds; the service simply refuses to work, which is the safe direction.

Then in the app, open **Settings → Photo identification**, enter your service
address (`https://<your-worker>.workers.dev`) and the same device token, and
save. Saving validates and encrypts the configuration locally; it does not
contact the service or verify the token. The first **Identify cigar** exercises
the whole path.

To revoke a lost phone, put a new value into `EMBER_DEVICE_TOKEN` and enter the
replacement only on devices you still have.

Never put credential values into source files, shell arguments, screenshots,
Wrangler variables or a published repository.

## The web build has no identify route, and why

The Android app is the product here, and it talks to `worker/index.ts`. The
optional browser build calls `/api/identify` on its own origin, and this
repository does not ship that route.

It used to. The route authenticated on the presence of an
`oai-authenticated-user-id` request header, which the hosting edge it was
written for supplies and strips. That is fine behind that edge and unsafe
anywhere else: the header is attacker-controlled, and the per-minute throttle
was keyed on the same value, so rotating it defeated the limit and every
request spent the owner's OpenAI credit. Rather than publish a gate that is
only safe in one deployment, the route is gone.

### Building your own

If you want the browser build to identify cigars, add a server route at
`/api/identify` that accepts `{ image, hint }` and returns the shape in
`lib/identify-response.ts`. Two sane implementations:

- **Forward to your Worker.** Deploy the Worker as above, then have your route
  attach the device token server-side and proxy the request. The token never
  reaches the browser and you inherit the Worker's validation and throttling.
- **Call the model directly.** `lib/server/identify.ts` exports the same
  pipeline the Worker uses. Import it, hold `OPENAI_API_KEY` in your server's
  secret store, and return its result.

Whichever you choose, authenticate the caller with something they cannot set
themselves: a session cookie, a signed token, an origin-locked key. Do not trust
a request header for identity, and do not key a rate limit on a value the caller
chooses. Put a spending cap on the provider account before you expose anything,
because an identification costs real money and an open endpoint will be found.

## Why not just use a ChatGPT subscription

A standalone Android app wants a dedicated API Platform key with only the
permissions it needs, held in a server's secret store and revocable on its own.
OpenAI's own guidance is to keep API credentials out of browsers and mobile
apps.

MCP does not change that: its OAuth login lets ChatGPT call tools on your
server, and grants an Android app nothing. Workload identity federation can
remove a long-lived key on compatible infrastructure, but it needs an identity
provider and administrator-configured trust, and Cloudflare Workers was not a
named provider when this was checked, so no keyless integration is claimed here.

## API

- `GET /api/status` — requires the device token, checks configuration, and does
  not contact OpenAI. A configured service returns `{"ready":true,"configured":true}`.
  A wrong token returns 401; missing Worker secrets return 503.
- `POST /api/identify` — requires the device token and `Content-Type:
  application/json`. The body is only `{"image":"data:image/jpeg;base64,...",
  "hint":"optional label hint"}`. PNG and WebP are accepted too. The decoded
  image may be at most 4 MB and the hint at most 300 characters. Any other JSON
  field is rejected.

A successful identification returns an editable candidate, a qualitative
confidence, an explanation, grounded source links and optional alternatives.
The result is always presented for review before it can be saved.

Subject rejection returns HTTP 422 with a validated `outcome` of `no_cigar`,
`multiple_cigars` or `unclear_photo`, plus a code, a short error and a
structured subject, and no candidate or sources. The first vision request
already distinguishes a physical cigar from a band or packaging, so these checks
cost no extra model call. `lib/identify-response.ts` holds the strict parser.

Unknown routes return 404 and no route redirects. The native bridge refuses
HTTP redirects outright, so credentials and photos cannot follow one. Browser
CORS is limited to `https://localhost`, `http://localhost` and
`capacitor://localhost`; preflight advertises only the allowed methods and
headers, and the real requests still require authentication.

## What is sent, and what is kept

The identification request contains the photo and the optional label hint. The
verification request contains the extracted label observations and that hint.
Ratings, tasting notes, the rest of the journal and purchase locations are never
part of either.

The Worker does not store the image and does not log request bodies, hints,
tokens or keys. Full invocation logging is off. Cloudflare's sampled traces
(5%) can retain operational metadata such as timing, URL, status, device and
network information and approximate geography; they do not include the
`Authorization` header or photo bodies. No third-party log destination is
configured.

Provider requests are sent with `store: false`. That is a request, not a
guarantee: it does not override OpenAI's own API retention policy.

## Honest limits

- The service URL is publicly reachable. URL secrecy and CORS are not access
  control; the token is.
- Anyone who steals the token can spend your OpenAI credit. Anyone with
  Worker-write access to your account can change the code and read its bound
  secrets. Cloudflare and OpenAI are trusted processors in this design.
- Rate limiting is best-effort: one active scan and at most six scan starts per
  minute *per Worker isolate*. Cloudflare may run several isolates, so this is
  not a global quota. Set spending controls on your own provider account.
- Each scan makes at most two OpenAI requests, with at most two search-tool
  invocations in the verification request. Provider calls have a 45-second
  deadline and the scan an 80-second one. The server never retries
  automatically; a 429 tells the phone to wait for you rather than loop.

## Checking it without spending anything

These use mocked provider responses, deploy nothing and contact no one:

```sh
node --import tsx --test tests/mobile-api.test.ts tests/identify.test.ts
node scripts/check-worker-runtime.mjs
```

The runtime check runs the Worker under real workerd and covers authentication,
invalid-image validation, a mocked scan and redirect refusal. It caught a real
incompatibility once: `redirect: 'error'` is unsupported at the pinned
compatibility date, so both the internal request and the provider call now use
`manual` and reject any non-2xx response.

Against the live provider, the pipeline has correctly identified real cigars
with sources, stayed tentative on a poor photograph, and abstained on
non-cigars. That is evidence that the path works, not a measure of accuracy
across all cigars.
