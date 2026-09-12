// Explicit, owner-authorized deployment/QA commands only. No credential values
// are accepted in arguments, printed, or written to files. macOS Keychain holds
// the owner token; Wrangler receives secrets through its documented JSON stdin.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Your own deployment. Nothing here is a credential: the account id and the
// service origin identify where to talk, and the token itself lives in the
// macOS Keychain under the service/account names below.
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
// Keychain item names are yours to choose; nothing here names a real one.
const tokenService = process.env.EMBER_TOKEN_KEYCHAIN_SERVICE;
const openaiKeychainService = process.env.EMBER_OPENAI_KEYCHAIN_SERVICE;
const tokenAccount = process.env.EMBER_WORKER_NAME || 'ember-android-api';
const deployedOrigin = process.env.EMBER_SERVICE_ORIGIN;
const evidenceDir = resolve('outputs/qa');
const report = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const action = process.argv[2];
const baseUrl = process.argv[3];
if (!accountId || !deployedOrigin || !tokenService || !openaiKeychainService)
  throw new Error(
    'Set CLOUDFLARE_ACCOUNT_ID, EMBER_SERVICE_ORIGIN (https://<your-worker>.workers.dev) EMBER_TOKEN_KEYCHAIN_SERVICE and EMBER_OPENAI_KEYCHAIN_SERVICE. See docs/BACKEND.md.',
  );
let lastRequest;
const environment = {
  ...process.env,
  CLOUDFLARE_ACCOUNT_ID: accountId,
  WRANGLER_WRITE_LOGS: 'false',
  WRANGLER_LOG_SANITIZE: 'true',
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_LOG: 'error',
};

function readCredential(service, account) {
  return execFileSync(
    '/usr/bin/security',
    [
      'find-generic-password',
      '-s',
      service,
      ...(account ? ['-a', account] : []),
      '-w',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16384 },
  ).trim();
}

function readToken() {
  const token = readCredential(tokenService, tokenAccount);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid saved token');
  return token;
}

function prepareToken() {
  try {
    readToken();
    return 'existing';
  } catch (error) {
    // Security's item-not-found status only. Never replace a credential merely
    // because its access was denied or its contents were unexpected.
    if (error.status !== 44)
      throw new Error('Cannot read existing owner token');
  }
  const token = randomBytes(32).toString('hex');
  // security -i parses this in-process. The token is not a process argument.
  // No -A (allow all apps), no -U (overwrite), and all output stays in memory.
  execFileSync('/usr/bin/security', ['-i'], {
    input: `add-generic-password -a ${tokenAccount} -s "${tokenService}" -w ${token}\n`,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 16384,
  });
  if (!timingSafeEqual(Buffer.from(readToken()), Buffer.from(token)))
    throw new Error('Owner token did not round-trip');
  return 'created';
}

function validateServiceUrl() {
  if (baseUrl !== deployedOrigin)
    throw new Error('Expected the deployed Ember Workers HTTPS origin');
  return baseUrl;
}

async function request(path, options = {}, authenticated = true) {
  lastRequest = { path, authenticated };
  const headers = new Headers(options.headers);
  if (authenticated) headers.set('Authorization', `Bearer ${readToken()}`);
  const response = await fetch(validateServiceUrl() + path, {
    ...options,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(100000),
  });
  lastRequest.httpStatus = response.status;
  return {
    httpStatus: response.status,
    cacheControl: response.headers.get('cache-control'),
    ray: response.headers.get('cf-ray'),
    body: await response.json(),
  };
}

async function reserveScan(label) {
  // This is the SAME conservative ledger used for earlier direct OpenAI QA.
  // A hosted scan has at most two provider calls. Reserve both before sending,
  // and never release reservations after uncertain external outcomes.
  const path = resolve(evidenceDir, 'live-usage.json');
  const ledger = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(ledger.calls) || ledger.calls.length + 2 > 20)
    throw new Error('QA spending reservation ceiling reached');
  for (let index = 0; index < 2; index++) {
    ledger.calls.push({
      label,
      startedAt: new Date().toISOString(),
      reservedUsd: 1,
      outcome: 'hosted_scan_reserved_provider_usage_not_exposed',
    });
  }
  await writeFile(path, JSON.stringify(ledger, null, 2) + '\n', {
    mode: 0o600,
  });
  return ledger.calls.length;
}

try {
  await mkdir(evidenceDir, { recursive: true });
  if (action === 'prepare-token') {
    report({
      action,
      token: prepareToken(),
      storage: 'macOS Keychain',
      secretDisplayed: false,
    });
  } else if (action === 'upload-secrets') {
    const apiKey = readCredential(openaiKeychainService);
    if (!apiKey.startsWith('sk-') || apiKey.length < 24)
      throw new Error('Unexpected OpenAI credential format');
    execFileSync(
      resolve('node_modules/.bin/wrangler'),
      [
        'secret',
        'bulk',
        '--config',
        'wrangler.api.jsonc',
        '--name',
        tokenAccount,
      ],
      {
        input: JSON.stringify({
          OPENAI_API_KEY: apiKey,
          EMBER_DEVICE_TOKEN: readToken(),
        }),
        env: environment,
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024,
        timeout: 120000,
      },
    );
    report({
      action,
      uploaded: ['OPENAI_API_KEY', 'EMBER_DEVICE_TOKEN'],
      secretDisplayed: false,
    });
  } else if (action === 'check') {
    const cases = [];
    for (const path of ['/api/status', '/api/identify']) {
      const options = path.endsWith('identify')
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }
        : {};
      const noToken = await request(path, options, false);
      if (noToken.httpStatus !== 401)
        throw new Error('Missing token was not rejected');
      cases.push({ label: `unauthenticated ${path}`, ...noToken });
      const wrongToken = await request(
        path,
        {
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${'0'.repeat(64)}`,
          },
        },
        false,
      );
      if (wrongToken.httpStatus !== 401)
        throw new Error('Incorrect token was not rejected');
      cases.push({ label: `wrong token ${path}`, ...wrongToken });
    }
    const status = await request('/api/status');
    if (status.httpStatus !== 200 || status.body.ready !== true)
      throw new Error('Authenticated service is not ready');
    cases.push({ label: 'authenticated status', ...status });
    const invalid = await request('/api/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (invalid.httpStatus !== 400)
      throw new Error('Invalid image was not rejected');
    cases.push({ label: 'authenticated invalid image', ...invalid });
    await writeFile(
      resolve(evidenceDir, 'hosted-access-checks.json'),
      JSON.stringify(cases, null, 2) + '\n',
    );
    report({
      action,
      passed: cases.map(({ label, httpStatus }) => ({ label, httpStatus })),
      providerCalls: 0,
    });
  } else if (action === 'scan-padron') {
    validateServiceUrl();
    const bytes = await readFile(
      resolve(evidenceDir, 'fixtures/padron-1964-anniversary-exclusivo.jpg'),
    );
    const reservedUsd = await reserveScan('hosted-padron');
    const result = await request('/api/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: `data:image/jpeg;base64,${bytes.toString('base64')}`,
        hint: '',
      }),
    });
    await writeFile(
      resolve(evidenceDir, 'hosted-padron.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
    report({
      action,
      ...result,
      reservedUsd,
      reservationIsNotActualSpend: true,
    });
    if (result.httpStatus !== 200) process.exitCode = 1;
  } else if (action === 'pair-qa' || action === 'pair-phone') {
    const target =
      action === 'pair-qa'
        ? ['--qa']
        : (() => {
            const phone = process.env.EMBER_PHONE_SERIAL;
            if (!phone)
              throw new Error('Set EMBER_PHONE_SERIAL to the exact device serial to pair a phone.');
            return ['--phone', phone, '--confirm-phone', phone];
          })();
    const child = spawnSync(
      process.execPath,
      ['scripts/pairing-input.mjs', ...target, '--save'],
      {
        input: readToken(),
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000,
      },
    );
    const result = JSON.parse(child.stdout.toString());
    if (child.status !== 0 || result.success !== true) {
      const allowedStages = [
        'TARGET_ARGUMENTS', 'TARGET_QA', 'TARGET_PHONE', 'BUILD_JAVA', 'BUILD_DEX',
        'PUSH_HELPER', 'STDIN', 'NATIVE_TRANSPORT', 'NATIVE_START', 'NATIVE_CONNECT',
        'NATIVE_FIELD', 'NATIVE_STDIN', 'NATIVE_FORMAT', 'NATIVE_RECHECK', 'NATIVE_TYPE',
        'NATIVE_VERIFY_TYPED', 'NATIVE_SAVE_BUTTON', 'NATIVE_SAVE_CLICK', 'NATIVE_VERIFY_SAVED',
      ];
      report({ action, pairingStage: allowedStages.includes(result.stage) ? result.stage : 'UNCLASSIFIED' });
      throw new Error('Pairing input failed');
    }
    report({
      action,
      inputCompleted: true,
      connectionSaved: true,
      secretDisplayed: false,
    });
  } else if (action === 'check-source-secrets') {
    const secrets = [readToken(), readCredential(openaiKeychainService)];
    const files = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
      .toString()
      .split('\0')
      .filter(Boolean);
    for (const file of files) {
      const bytes = await readFile(file);
      if (secrets.some((secret) => bytes.includes(Buffer.from(secret))))
        throw new Error('Credential found in source');
    }
    report({
      action,
      filesChecked: files.length,
      credentialValuesFound: false,
    });
  } else if (action === 'reserve-native-scan') {
    report({
      action,
      reservedUsd: await reserveScan('native-hosted-padron'),
      reservationIsNotActualSpend: true,
    });
  } else {
    throw new Error('Unknown explicit deployment or QA action');
  }
} catch (error) {
  // Child-process errors can contain stdin, provider errors or secret values.
  // Never serialize the exception, stdout, stderr, command, or environment.
  report({
    action,
    failed: true,
    secretDisplayed: false,
    childExitStatus: Number.isInteger(error.status) ? error.status : undefined,
    lastRequest,
    transportCode: /^[A-Z_]{3,60}$/.test(error.cause?.code || '')
      ? error.cause.code
      : undefined,
  });
  process.exitCode = 1;
}
