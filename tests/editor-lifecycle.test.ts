import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { withStatus } from '../lib/lifecycle.ts';
import { parseIdentifySubjectRejection } from '../lib/identify-response.ts';
import type { CigarDraft, CigarEntry } from '../lib/types';

const source = readFileSync(
  new URL('../app/EmberApp.tsx', import.meta.url),
  'utf8',
);
const parsed = ts.createSourceFile(
  'EmberApp.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function appFunction<T>(name: string, bindings: Record<string, unknown>): T {
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name)
      declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(declaration, `Missing actual app function: ${name}`);
  const compiled = ts.transpileModule(
    `${declaration.getFullText(parsed)}\nexports.target = ${name};`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  );
  const exports = {} as { target: T };
  runInNewContext(compiled.outputText, { exports, ...bindings });
  return exports.target;
}

const draft: CigarDraft = {
  fullName: 'My own name',
  brand: 'Owner brand',
  country: 'Nicaragua',
  region: '',
  wrapper: '',
  strength: '',
  vitola: '',
  flavorNotes: [],
  photo: 'data:image/jpeg;base64,fixture',
  rating: 4,
  smokedAt: '2026-09-01',
  notes: 'Keep my note.',
  purchasePlace: '',
  purchaseLat: null,
  purchaseLng: null,
  identification: {
    confidence: 'high',
    explanation: 'Previous result.',
    sources: [],
  },
};

void test('a new actual editor draft starts in the humidor without claiming it was smoked', () => {
  const blankDraft = appFunction<() => CigarDraft>('blankDraft', {
    today: () => '2026-09-08',
  });
  const next = blankDraft();
  assert.equal(next.status, 'humidor');
  assert.equal(next.addedAt, '2026-09-08');
  assert.equal(next.smokedAt, '');
  assert.equal(next.rating, 0);
});

void test('Mark enjoyed prepares an unsaved editor change while retaining the original discard baseline', () => {
  const entry: CigarEntry = {
    ...withStatus(draft, 'humidor', '2026-09-08'),
    id: 'one',
    createdAt: '2026-09-08T10:00:00.000Z',
    updatedAt: '2026-09-08T10:00:00.000Z',
  };
  const state: Record<string, unknown> = {};
  const bindings: Record<string, unknown> = {
    canWrite: true,
    mutationLock: { current: false },
    editorGeneration: { current: 0 },
    photoGeneration: { current: 0 },
    today: () => '2026-09-09',
    withStatus,
  };
  for (const key of [
    'PhotoViewerOpen',
    'Draft',
    'InitialDraft',
    'Editing',
    'FormError',
    'IdentifyError',
    'SubjectRejection',
    'Hint',
    'PhotoBusy',
    'LocationBusy',
    'LocationStatus',
    'NeedsConfirmation',
    'Confirmed',
    'SelectedId',
    'EditorOpen',
  ])
    bindings[`set${key}`] = (value: unknown) => {
      state[key] = value;
    };
  const openEditor = appFunction<
    (entry: CigarEntry, status: 'enjoyed') => void
  >('openEditor', bindings);
  openEditor(entry, 'enjoyed');
  assert.equal((state.Draft as CigarDraft).status, 'enjoyed');
  assert.equal((state.Draft as CigarDraft).smokedAt, '2026-09-09');
  assert.equal((state.Draft as CigarDraft).notes, draft.notes);
  assert.equal((state.Draft as CigarDraft).rating, 4);
  assert.equal(state.InitialDraft, JSON.stringify(entry));
  assert.equal(state.Editing, entry);
  assert.equal(entry.status, 'humidor');
  assert.equal(entry.smokedAt, '');
});

function identifyFixture(
  payload: unknown,
  ok: boolean,
  stale = false,
  pendingReview = false,
) {
  let currentDraft = { ...draft };
  const state: Record<string, unknown> = { NeedsConfirmation: pendingReview };
  const editorGeneration = { current: 1 };
  const identifyAbort = { current: null as AbortController | null };
  let requests = 0;
  const bindings: Record<string, unknown> = {
    draft: currentDraft,
    identifying: false,
    hint: '',
    navigator: { onLine: true },
    AbortController,
    identifyAbort,
    editorGeneration,
    photoGeneration: { current: 1 },
    parseIdentifySubjectRejection,
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    identifyPhoto: async () => {
      requests += 1;
      if (stale) editorGeneration.current += 1;
      return { ok, json: async () => payload };
    },
    setDraft: (update: (value: CigarDraft) => CigarDraft) => {
      currentDraft = update(currentDraft);
    },
  };
  for (const key of [
    'Identifying',
    'IdentifyError',
    'SubjectRejection',
    'NeedsConfirmation',
    'Confirmed',
  ])
    bindings[`set${key}`] = (value: unknown) => {
      state[key] = value;
    };
  return {
    run: appFunction<() => Promise<void>>('identify', bindings),
    state,
    draft: () => currentDraft,
    requests: () => requests,
  };
}

void test('each actual rejected-subject handler preserves the photo and manual fields without attaching evidence', async () => {
  const cases = [
    {
      outcome: 'no_cigar',
      code: 'NO_CIGAR',
      error: 'No cigar in sight.',
      subject: { kind: 'no_cigar', visibleCount: 0, confidence: 'high' },
    },
    {
      outcome: 'multiple_cigars',
      code: 'MULTIPLE_CIGARS',
      error: 'One cigar at a time.',
      subject: { kind: 'multiple_cigars', visibleCount: 2, confidence: 'high' },
    },
    {
      outcome: 'unclear_photo',
      code: 'UNCLEAR_PHOTO',
      error: 'A clearer photo, please.',
      subject: { kind: 'uncertain', visibleCount: null, confidence: 'low' },
    },
  ];
  for (const payload of cases) {
    const fixture = identifyFixture(payload, false);
    await fixture.run();
    assert.equal(fixture.requests(), 1);
    assert.equal(fixture.state.SubjectRejection, payload.outcome);
    assert.equal(fixture.state.IdentifyError, '');
    assert.equal(fixture.state.NeedsConfirmation, false);
    assert.equal(fixture.state.Identifying, false);
    assert.equal(fixture.draft().identification, undefined);
    for (const key of [
      'photo',
      'fullName',
      'country',
      'rating',
      'notes',
    ] as const)
      assert.equal(fixture.draft()[key], draft[key]);
  }
});

void test('a new single-cigar suggestion still requires explicit review and cannot auto-save', async () => {
  const fixture = identifyFixture(
    {
      candidate: { fullName: 'Suggested cigar', country: 'Honduras' },
      confidence: 'low',
      explanation: 'Please check the band.',
      sources: [],
    },
    true,
  );
  await fixture.run();
  assert.equal(fixture.state.SubjectRejection, null);
  assert.equal(fixture.state.NeedsConfirmation, true);
  assert.equal(fixture.state.Confirmed, false);
  assert.equal(fixture.draft().fullName, 'Suggested cigar');
  assert.equal(fixture.draft().identification?.confidence, 'low');
  assert.equal(fixture.draft().photo, draft.photo);
});

void test('a rejected re-scan cannot approve an earlier unreviewed suggestion', async () => {
  const fixture = identifyFixture(
    {
      outcome: 'no_cigar',
      code: 'NO_CIGAR',
      error: 'No cigar in sight.',
      subject: { kind: 'no_cigar', visibleCount: 0, confidence: 'high' },
    },
    false,
    false,
    true,
  );
  await fixture.run();
  assert.equal(fixture.state.NeedsConfirmation, true);
  assert.equal(fixture.state.Confirmed, false);
  assert.equal(fixture.draft().identification, undefined);
});

void test('a late rejected response cannot alter a newly opened editor', async () => {
  const fixture = identifyFixture(
    {
      outcome: 'no_cigar',
      code: 'NO_CIGAR',
      error: 'No cigar in sight.',
      subject: { kind: 'no_cigar', visibleCount: 0, confidence: 'high' },
    },
    false,
    true,
  );
  await fixture.run();
  assert.equal(fixture.state.SubjectRejection, null);
  assert.equal(fixture.draft().identification, draft.identification);
  assert.equal(fixture.draft().notes, draft.notes);
});
