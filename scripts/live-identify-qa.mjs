// Local, opt-in QA only. The provider key remains in this process's memory.
// Run: node --import tsx scripts/live-identify-qa.mjs
// stdin: {"action":"identify","file":"/absolute/test-photo.jpg","label":"case"}
// stdin: {"action":"status"} or {"action":"stop"}
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const evidenceDir = resolve('outputs/qa');
const ledgerPath = resolve(evidenceDir, 'live-usage.json');
await mkdir(evidenceDir, { recursive: true });
let ledger;
try {
  ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  if (!Array.isArray(ledger.calls)) throw new Error('Invalid ledger');
} catch (error) {
  if (error.code !== 'ENOENT')
    throw new Error('Cannot safely read existing cost ledger');
  ledger = { maxReservedUsd: 20, reservePerProviderCallUsd: 1, calls: [] };
}
// $1 is a deliberately conservative reservation for this specific model:
// even its entire ~1M context at $0.40/M, <=4k output at $1.60/M,
// and at most two web-search calls remain below that reservation.
// Reservations are never released, including after transport failures.
const saveLedger = () =>
  writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', {
    mode: 0o600,
  });
const report = (value) => process.stdout.write(JSON.stringify(value) + '\n');
let apiKey;
try {
  apiKey = execFileSync(
    '/usr/bin/security',
    // Name your own Keychain item and point EMBER_OPENAI_KEYCHAIN_SERVICE at it.
    ['find-generic-password', '-s', process.env.EMBER_OPENAI_KEYCHAIN_SERVICE ?? '', '-w'],
    {
      encoding: 'utf8',
      maxBuffer: 16384,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
} catch {
  report({ status: 'keychain_unavailable', secretDisplayed: false });
  process.exit(2);
}
if (!apiKey.startsWith('sk-') || apiKey.length < 24) {
  report({ status: 'unexpected_key_format', secretDisplayed: false });
  process.exit(2);
}
try {
  const response = await fetch(
    'https://api.openai.com/v1/models/gpt-4.1-mini',
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    },
  );
  report({
    status: response.ok ? 'ready' : 'provider_auth_check_failed',
    httpStatus: response.status,
    pid: process.pid,
    secretDisplayed: false,
  });
  await response.body?.cancel();
} catch {
  report({
    status: 'key_loaded_network_check_failed',
    pid: process.pid,
    secretDisplayed: false,
  });
}
const input = createInterface({ input: process.stdin, terminal: false });
for await (const line of input) {
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    report({ error: 'Use one JSON command per line' });
    continue;
  }
  if (command.action === 'stop') break;
  if (command.action === 'status') {
    report({
      status: 'key_in_memory',
      pid: process.pid,
      reservedUsd: ledger.calls.length,
      calls: ledger.calls.length,
    });
    continue;
  }
  if (command.action !== 'identify') {
    report({ error: 'Unsupported command' });
    continue;
  }
  try {
    const fixturePath = resolve(command.file);
    if (!fixturePath.startsWith(resolve(evidenceDir, 'fixtures') + '/'))
      throw new Error('Only dedicated public QA fixtures are permitted');
    const bytes = await readFile(fixturePath);
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Fixture too large');
    const mime = /\.png$/i.test(fixturePath) ? 'image/png' : 'image/jpeg';
    const boundedFetch = async (url, options) => {
      const body = JSON.parse(options.body);
      if (
        String(url) !== 'https://api.openai.com/v1/responses' ||
        body.model !== 'gpt-4.1-mini' ||
        body.max_output_tokens > 4000 ||
        (body.tools?.length && body.max_tool_calls > 2)
      )
        throw new Error('Request exceeds tested limits');
      if (ledger.calls.length >= 20)
        throw new Error('Hard QA spending ceiling reached');
      const call = {
        label: String(command.label || 'unnamed').slice(0, 100),
        startedAt: new Date().toISOString(),
        reservedUsd: 1,
        outcome: 'pending',
      };
      ledger.calls.push(call);
      await saveLedger();
      try {
        const response = await fetch(url, { ...options, redirect: 'error' });
        call.httpStatus = response.status;
        call.requestId = response.headers.get('x-request-id');
        const data = await response.clone().json();
        call.usage = data.usage;
        call.searchCalls =
          data.output?.filter((item) => item.type === 'web_search_call')
            .length || 0;
        call.outcome = response.ok ? 'completed' : 'provider_error';
        // Public QA fixtures only. Keep evidence needed to diagnose pipeline
        // parsing/identity defects, never the request image or auth headers.
        if (response.ok)
          call.providerOutput = JSON.parse(
            JSON.stringify(data.output || [])
              .split(apiKey)
              .join('[redacted]'),
          );
        // Provider error messages may echo secrets. Keep only typed error codes.
        if (data.error)
          call.errorCode = String(
            data.error.code || data.error.type || 'provider_error',
          ).slice(0, 80);
        await saveLedger();
        return response;
      } catch (error) {
        call.outcome = 'transport_or_decode_error';
        await saveLedger();
        throw error;
      }
    };
    const { handleIdentify } = await import(
      new URL(`../lib/server/identify.ts?qa=${Date.now()}`, import.meta.url)
    );
    const result = await handleIdentify(
      new Request('https://ember-qa.invalid/api/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: `data:${mime};base64,${bytes.toString('base64')}`,
          hint: command.hint || '',
        }),
      }),
      { apiKey, model: 'gpt-4.1-mini' },
      boundedFetch,
    );
    const data = await result.json();
    const evidence = {
      label: command.label,
      httpStatus: result.status,
      result: data,
      reservedUsd: ledger.calls.length,
    };
    await writeFile(
      resolve(
        evidenceDir,
        `live-${String(command.label || 'case').replace(/[^a-zA-Z0-9_-]/g, '_')}.json`,
      ),
      JSON.stringify(evidence, null, 2) + '\n',
    );
    report(evidence);
  } catch {
    report({
      label: command.label,
      error: 'QA request failed; inspect sanitized usage ledger',
      reservedUsd: ledger.calls.length,
    });
  }
}
apiKey = undefined;
input.close();
process.stdin.pause();
report({ status: 'stopped', reservedUsd: ledger.calls.length });
process.exit(0);
