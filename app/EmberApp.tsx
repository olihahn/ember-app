'use client';

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type SyntheticEvent,
} from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Disc3,
  Check,
  CheckCheck,
  ChevronDown,
  Download,
  ExternalLink,
  Flame,
  Globe2,
  LayoutGrid,
  Leaf,
  List,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { OriginMap } from '@/components/OriginMap';
import { PhotoViewer } from '@/components/PhotoViewer';
import { CigarLoader } from '@/components/CigarLoader';
import { BeachCompanion } from '@/components/BeachCompanion';
import '@/components/BeachCompanion.css';
import { IdentificationSummary } from '@/components/IdentificationSummary';
import { JournalDeck } from '@/components/JournalDeck';
import { LivingTerrace } from '@/components/LivingTerrace';
import { AlbumGlyph, CameraGlyph } from '@/components/print-glyphs';
import { RecordPlayer } from '@/components/RecordPlayer';
import { useFocusVisibility } from '@/hooks/use-focus-visibility';
import {
  exportJournal,
  getJournalEstablishedOn,
  importJournalBackup,
  loadEntries,
  saveEntries,
} from '@/lib/journal';
import { fileToImage } from '@/lib/image';
import {
  entryDate,
  statusOf,
  withStatus,
  type CigarStatus,
} from '@/lib/lifecycle';
import { parseIdentifySubjectRejection } from '@/lib/identify-response';
import { App as NativeApp, type RestoredListenerEvent } from '@capacitor/app';
import { isNative } from '@/lib/native-bridge';
import { NativeConnection } from '@/components/NativeConnection';
import {
  devicePhoto,
  currentPosition,
  identifyPhoto,
  photoFileFromResult,
  saveCameraRecovery,
  readCameraRecovery,
  clearCameraRecovery,
} from '@/lib/mobile';
import type {
  CigarDraft,
  CigarEntry,
  IdentificationEvidence,
  IdentifyResult,
  IdentifyRejectedOutcome,
} from '@/lib/types';

type Tab = 'terrace' | 'journal' | 'atlas';
type Notice = { message: string; undo?: CigarEntry };
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

const countryFlags: Record<string, string> = {
  Cuba: '🇨🇺',
  Nicaragua: '🇳🇮',
  'Dominican Republic': '🇩🇴',
  Honduras: '🇭🇳',
  Mexico: '🇲🇽',
  Brazil: '🇧🇷',
  Ecuador: '🇪🇨',
  'United States': '🇺🇸',
  Indonesia: '🇮🇩',
  Cameroon: '🇨🇲',
};
const countryOptions = [
  'Cuba',
  'Nicaragua',
  'Dominican Republic',
  'Honduras',
  'Mexico',
  'Brazil',
  'Ecuador',
  'United States',
  'Indonesia',
  'Cameroon',
  'Costa Rica',
  'Panama',
  'Peru',
  'Philippines',
];

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function blankDraft(): CigarDraft {
  return {
    fullName: '',
    brand: '',
    country: '',
    region: '',
    wrapper: '',
    strength: '',
    vitola: '',
    flavorNotes: [],
    photo: '',
    rating: 0,
    status: 'humidor',
    addedAt: today(),
    smokedAt: '',
    notes: '',
    purchasePlace: '',
    purchaseLat: null,
    purchaseLng: null,
  };
}

function displayDate(date: string, long = false) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Date not set';
  return parsed.toLocaleDateString(undefined, {
    month: long ? 'long' : 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function shortPlace(country: string) {
  return country || 'Origin not set';
}

function visibleRating(entry: CigarEntry) {
  return statusOf(entry) === 'humidor' ? 0 : entry.rating;
}

const sampleEntries: CigarEntry[] = [
  {
    fullName: 'Havana Reserva',
    brand: 'The Havana collection',
    country: 'Cuba',
    region: 'Vuelta Abajo',
    wrapper: 'Natural',
    strength: 'Medium',
    vitola: 'Robusto',
    flavorNotes: ['Cedar', 'Coffee', 'Cream'],
    rating: 5,
    smokedAt: '2026-09-06',
    notes:
      'A slow Sunday on the terrace. Beautiful cedar notes, a little coffee, and the kind of evening you wish would last a little longer.',
    purchasePlace: 'Havana, Cuba',
    purchaseLat: 23.1136,
    purchaseLng: -82.3666,
  },
  {
    fullName: 'Estelí No. 12',
    brand: 'The Estelí collection',
    country: 'Nicaragua',
    region: 'Estelí',
    wrapper: 'Maduro',
    strength: 'Full',
    vitola: 'Toro',
    flavorNotes: ['Cocoa', 'Pepper', 'Earth'],
    rating: 4,
    smokedAt: '2026-09-03',
    notes:
      'Rich and peppery to start, with a lovely cocoa finish. Took my time with this one.',
    purchasePlace: 'San Francisco, California',
    purchaseLat: 37.7749,
    purchaseLng: -122.4194,
  },
  {
    fullName: 'Valle Dorado',
    brand: 'The Santiago collection',
    country: 'Dominican Republic',
    region: 'Cibao Valley',
    wrapper: 'Connecticut',
    strength: 'Mild',
    vitola: 'Corona',
    flavorNotes: ['Cream', 'Almond', 'Hay'],
    rating: 4,
    smokedAt: '2026-08-29',
    notes:
      'An easygoing afternoon smoke. Soft, creamy, and a touch of toasted almond.',
    purchasePlace: 'Santiago, Dominican Republic',
    purchaseLat: 19.4517,
    purchaseLng: -70.697,
  },
  {
    fullName: 'Copán Clásico',
    brand: 'The Copán collection',
    country: 'Honduras',
    region: 'Copán',
    wrapper: 'Habano',
    strength: 'Medium',
    vitola: 'Robusto',
    flavorNotes: ['Leather', 'Spice', 'Wood'],
    rating: 3,
    smokedAt: '2026-08-24',
    notes:
      'Earthy and straightforward. A good companion to an afternoon outside.',
    purchasePlace: '',
    purchaseLat: null,
    purchaseLng: null,
  },
].map((item, index) => ({
  ...item,
  id: `sample-${index}`,
  photo: '/images/cigars.png',
  createdAt: `${item.smokedAt}T12:00:00.000Z`,
  updatedAt: `${item.smokedAt}T12:00:00.000Z`,
}));

const ratingVerdicts = [
  'The jury is still out.',
  'Not invited back.',
  'An interesting mistake.',
  'Perfectly respectable.',
  'A place at the table.',
  'The good china comes out.',
];

function Stars({
  value,
  onChange,
  size = 'normal',
}: {
  value: number;
  onChange?: (rating: number) => void;
  size?: 'normal' | 'large';
}) {
  if (!onChange)
    return (
      <span
        className={`ember-stars ${size}`}
        aria-label={value ? `${value} out of 5 stars` : 'Not yet rated'}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            size={size === 'large' ? 22 : 14}
            aria-hidden="true"
            className={star <= value ? 'filled' : ''}
          />
        ))}
      </span>
    );
  return (
    <fieldset
      className={`ember-stars interactive ${size}`}
      aria-label="Your rating"
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          aria-label={`Rate ${star} ${star === 1 ? 'star' : 'stars'}`}
          aria-pressed={value === star}
          onClick={() => onChange(star)}
        >
          <Star
            size={28}
            aria-hidden="true"
            className={star <= value ? 'filled' : ''}
          />
        </button>
      ))}
      {value > 0 && (
        <button
          className="rating-clear"
          type="button"
          onClick={() => onChange(0)}
          aria-label="Clear rating"
        >
          Clear
        </button>
      )}
    </fieldset>
  );
}

function Evidence({
  evidence,
  previous = false,
}: {
  evidence: IdentificationEvidence;
  previous?: boolean;
}) {
  const content = (
    <div className={`ember-evidence ${evidence.confidence}`}>
      <div className="evidence-heading">
        <Sparkles size={15} />
        <span>
          {evidence.confidence === 'high'
            ? 'Strong possible match'
            : evidence.confidence === 'medium'
              ? 'Possible match'
              : 'Uncertain identification'}
        </span>
        <span className="confidence">{evidence.confidence} confidence</span>
      </div>
      <IdentificationSummary explanation={evidence.explanation} />
      {Boolean(evidence.alternatives?.length) && (
        <p className="evidence-alternatives">
          Other possibilities: {evidence.alternatives?.join(' · ')}
        </p>
      )}
      {evidence.sources?.length > 0 && (
        <details className="evidence-source-disclosure">
          <summary>
            Sources <span>{evidence.sources.length}</span>
          </summary>
          <div className="evidence-sources">
            {evidence.sources.map((source, index) => {
              const href = safeUrl(source.url);
              return href ? (
                <a
                  key={`${source.url}-${index}`}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.title || 'View source'}
                  <ExternalLink size={11} />
                </a>
              ) : null;
            })}
          </div>
        </details>
      )}
    </div>
  );
  return previous ? (
    <details className="saved-identification">
      <summary>
        Identification details
        <span className={`saved-confidence ${evidence.confidence}`}>
          {evidence.confidence} confidence
        </span>
      </summary>
      {content}
    </details>
  ) : (
    content
  );
}

function CigarCard({
  entry,
  sample,
  onOpen,
}: {
  entry: CigarEntry;
  sample: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="cigar-card"
      onClick={onOpen}
      aria-label={`View ${entry.fullName}`}
    >
      <div className={`cigar-card-photo ${entry.photo ? '' : 'without-photo'}`}>
        {entry.photo ? (
          <img
            src={entry.photo}
            alt={
              sample
                ? 'Illustrative cigar photograph for sample entry'
                : `Your photograph of ${entry.fullName}`
            }
            loading="lazy"
          />
        ) : (
          <div className="photo-placeholder">
            <Leaf size={28} strokeWidth={1.2} aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="cigar-card-body">
        <h3>{entry.fullName}</h3>
        <div className="card-origin">
          {countryFlags[entry.country] && (
            <span aria-hidden="true">{countryFlags[entry.country]}</span>
          )}
          {shortPlace(entry.country)}
        </div>
        {statusOf(entry) === 'humidor' && (
          <span className="entry-status">In the humidor</span>
        )}
        <div className="card-bottom">
          <span>
            {statusOf(entry) === 'humidor' ? 'Added ' : ''}
            {displayDate(entryDate(entry))}
          </span>
          {visibleRating(entry) > 0 && (
            <span
              className="card-rating"
              aria-label={`${entry.rating} out of 5 stars`}
            >
              <Star size={12} fill="currentColor" aria-hidden="true" />
              {entry.rating}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function useWorkPageHeadingFocus(tab: Tab, blocked: boolean) {
  const heading = useRef<HTMLHeadingElement>(null);
  const previousTab = useRef(tab);
  useEffect(() => {
    const enteringFromTerrace = previousTab.current === 'terrace';
    previousTab.current = tab;
    if (!enteringFromTerrace || tab === 'terrace' || blocked) return;
    // Give an entered page a useful keyboard/screen-reader starting point,
    // without taking focus from a form or a dialog opened during navigation.
    if (
      document.activeElement?.closest(
        'input, textarea, select, form, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"]',
      )
    )
      return;
    heading.current?.focus({ preventScroll: true });
  }, [tab, blocked]);
  return heading;
}

export default function EmberApp() {
  useFocusVisibility();
  const [tab, setTab] = useState<Tab>('terrace');
  const [recordPlaying, setRecordPlaying] = useState(false);
  const [recordTitle, setRecordTitle] = useState('');
  const recordControls = useRef<{ toggle: () => void } | null>(null);
  const [entries, setEntries] = useState<CigarEntry[]>([]);
  const [establishedOn, setEstablishedOn] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [sample, setSample] = useState(false);
  const [search, setSearch] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | CigarStatus>('all');
  const [sort, setSort] = useState('newest');
  const [layout, setLayout] = useState<'deck' | 'grid' | 'list'>('deck');
  const [collectionToolsOpen, setCollectionToolsOpen] = useState(false);
  const [mapMode, setMapMode] = useState<'origin' | 'purchase'>('origin');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recordLibraryOpen, setRecordLibraryOpen] = useState(false);
  const [installHelp, setInstallHelp] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CigarEntry | null>(null);
  const [draft, setDraft] = useState<CigarDraft>(blankDraft);
  const [initialDraft, setInitialDraft] = useState('');
  const [formError, setFormError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationStatus, setLocationStatus] = useState('');
  const [identifying, setIdentifying] = useState(false);
  const [identifyError, setIdentifyError] = useState('');
  const [subjectRejection, setSubjectRejection] =
    useState<IdentifyRejectedOutcome | null>(null);
  const [hint, setHint] = useState('');
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CigarEntry | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const identifyAbort = useRef<AbortController | null>(null);
  const entriesRef = useRef<CigarEntry[]>([]);
  const mutationLock = useRef(false);
  const editorGeneration = useRef(0);
  const photoGeneration = useRef(0);
  const workHeading = useWorkPageHeadingFocus(
    tab,
    editorOpen ||
      settingsOpen ||
      selectedId !== null ||
      deleteTarget !== null ||
      photoViewerOpen,
  );

  useEffect(() => {
    let mounted = true;
    loadEntries()
      .then((result) => {
        if (mounted) {
          entriesRef.current = result.entries;
          setEntries(result.entries);
          setEstablishedOn(result.establishedOn ?? null);
          setStorageError(result.error || '');
          setLoaded(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setStorageError(
            'Your journal could not be opened. Reload this page to try again. Your existing data has not been changed.',
          );
          setLoaded(true);
        }
      });
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    return () => {
      mounted = false;
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      identifyAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!notice || notice.undo) return;
    const timer = window.setTimeout(() => setNotice(null), 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const restoreCamera = useEffectEvent(
    async (event: RestoredListenerEvent, isDisposed: () => boolean) => {
      if (event.pluginId !== 'Camera' || !event.success) return;
      try {
        const recovery = await readCameraRecovery();
        const data: unknown = event.data;
        const result =
          event.methodName === 'chooseFromGallery' &&
          data &&
          typeof data === 'object' &&
          'results' in data &&
          Array.isArray(data.results)
            ? data.results[0]
            : data;
        const file = await photoFileFromResult(result);
        if (isDisposed()) return;
        const original = entriesRef.current.find(
          (entry) => entry.id === recovery?.editingId,
        );
        openEditor(original);
        if (recovery) {
          setDraft(recovery.draft);
          setNeedsConfirmation(Boolean(recovery.draft.identification));
          setConfirmed(false);
        }
        await preparePhoto(file);
        await clearCameraRecovery();
        setNotice({
          message:
            'Your camera photo and draft were recovered after Android reopened the app. Review them before saving.',
        });
      } catch {
        if (!isDisposed())
          setNotice({
            message:
              'The camera result could not be recovered. Your saved journal is unchanged; please take the photo again.',
          });
      }
    },
  );

  useEffect(() => {
    if (!isNative() || !loaded || storageError) return;
    let disposed = false;
    const listener = NativeApp.addListener('appRestoredResult', (event) => {
      void restoreCamera(event, () => disposed);
    });
    return () => {
      disposed = true;
      void listener.then((handle) => handle.remove());
    };
  }, [loaded, storageError]);

  const nativeBack = useEffectEvent(() => {
    if (photoViewerOpen) {
      setPhotoViewerOpen(false);
      return;
    }
    if (saving) return;
    if (deleteTarget) setDeleteTarget(null);
    else if (settingsOpen) setSettingsOpen(false);
    else if (editorOpen) closeEditor(false);
    else if (selectedId) setSelectedId(null);
    else if (recordLibraryOpen) setRecordLibraryOpen(false);
    else if (tab !== 'terrace') navigate('terrace');
    else void NativeApp.minimizeApp();
  });

  useEffect(() => {
    if (!isNative()) return;
    const listener = NativeApp.addListener('backButton', () => nativeBack());
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, []);

  const visibleEntries = sample ? sampleEntries : entries;
  const selected =
    visibleEntries.find((entry) => entry.id === selectedId) || null;
  const countries = [
    ...new Set(
      visibleEntries.map((entry) => entry.country.trim()).filter(Boolean),
    ),
  ].sort();
  const locations = visibleEntries.filter(
    (entry) => entry.purchaseLat !== null && entry.purchaseLng !== null,
  );
  const originCounts = countries
    .map((country) => ({
      country,
      count: visibleEntries.filter((entry) => entry.country.trim() === country)
        .length,
    }))
    .sort((a, b) => b.count - a.count);
  const filteredEntries = useMemo(() => {
    const needle = search.toLocaleLowerCase().trim();
    return visibleEntries
      .filter(
        (entry) =>
          (!needle ||
            [
              entry.fullName,
              entry.brand,
              entry.country,
              entry.notes,
              entry.purchasePlace,
              ...entry.flavorNotes,
            ]
              .join(' ')
              .toLocaleLowerCase()
              .includes(needle)) &&
          (!countryFilter || entry.country.trim() === countryFilter) &&
          (statusFilter === 'all' || statusOf(entry) === statusFilter) &&
          (ratingFilter === 'all' ||
            (ratingFilter === 'unrated'
              ? visibleRating(entry) === 0
              : visibleRating(entry) >= Number(ratingFilter))),
      )
      .sort((a, b) =>
        sort === 'rating'
          ? visibleRating(b) - visibleRating(a) ||
            entryDate(b).localeCompare(entryDate(a))
          : sort === 'name'
            ? a.fullName.localeCompare(b.fullName)
            : entryDate(b).localeCompare(entryDate(a)) ||
              b.createdAt.localeCompare(a.createdAt),
      );
  }, [visibleEntries, search, countryFilter, ratingFilter, statusFilter, sort]);

  const canWrite = loaded && !storageError && !importBusy && !saving;

  // oxlint-disable-next-line react/react-compiler -- Checker crashes with PruneHoistedContexts on native effect events; no React Compiler transform is used.
  function navigate(next: Tab) {
    setTab(next);
    setSelectedId(null);
    setRecordLibraryOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function toggleSample(next: boolean) {
    setSample(next);
    setSearch('');
    setCountryFilter('');
    setRatingFilter('all');
    setStatusFilter('all');
    setSelectedId(null);
  }
  function resetFilters() {
    setSearch('');
    setCountryFilter('');
    setRatingFilter('all');
    setStatusFilter('all');
  }

  function openEditor(entry?: CigarEntry, nextStatus?: CigarStatus) {
    if (!canWrite || mutationLock.current) return;
    setPhotoViewerOpen(false);
    editorGeneration.current += 1;
    photoGeneration.current += 1;
    const initial = entry
      ? { ...entry, flavorNotes: [...entry.flavorNotes] }
      : blankDraft();
    const next = nextStatus
      ? withStatus(initial, nextStatus, today())
      : initial;
    setDraft(next);
    setInitialDraft(JSON.stringify(initial));
    setEditing(entry || null);
    setFormError('');
    setIdentifyError('');
    setSubjectRejection(null);
    setHint('');
    setPhotoBusy(false);
    setLocationBusy(false);
    setLocationStatus('');
    setNeedsConfirmation(false);
    setConfirmed(false);
    setSelectedId(null);
    setEditorOpen(true);
  }

  function closeEditor(open: boolean) {
    if (open) {
      setEditorOpen(true);
      return;
    }
    if (saving) return;
    if (
      JSON.stringify(draft) !== initialDraft &&
      !window.confirm(
        "Discard the changes to this cigar? They haven't been saved yet.",
      )
    )
      return;
    editorGeneration.current += 1;
    photoGeneration.current += 1;
    identifyAbort.current?.abort();
    identifyAbort.current = null;
    setIdentifying(false);
    setPhotoBusy(false);
    setLocationBusy(false);
    setEditorOpen(false);
    setPhotoViewerOpen(false);
  }

  async function commit(
    next: CigarEntry[],
    importedEstablishedOn?: string | null,
  ) {
    try {
      const result = await saveEntries(next, importedEstablishedOn);
      if (!result.ok)
        throw new Error(
          result.error ||
            'Your journal could not be saved. Please download this entry and try again.',
        );
      entriesRef.current = next;
      setEntries(next);
      setEstablishedOn(getJournalEstablishedOn());
      return true;
    } catch (error) {
      setNotice({
        message:
          error instanceof Error
            ? error.message
            : 'Your changes could not be saved. Please try again.',
      });
      return false;
    }
  }

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await preparePhoto(file);
  }

  async function preparePhoto(
    file: File,
    generation = editorGeneration.current,
    selection = ++photoGeneration.current,
  ) {
    identifyAbort.current?.abort();
    identifyAbort.current = null;
    setIdentifying(false);
    setPhotoBusy(true);
    setIdentifyError('');
    setSubjectRejection(null);
    try {
      const photo = await fileToImage(file);
      if (
        generation !== editorGeneration.current ||
        selection !== photoGeneration.current
      )
        return;
      setDraft((previous) => ({
        ...previous,
        photo,
        identification: undefined,
      }));
      setNeedsConfirmation(false);
      setConfirmed(false);
    } catch (error) {
      if (
        generation === editorGeneration.current &&
        selection === photoGeneration.current
      )
        setIdentifyError(
          error instanceof Error
            ? error.message
            : "That photo couldn't be opened. Try a JPEG or PNG.",
        );
    } finally {
      if (
        generation === editorGeneration.current &&
        selection === photoGeneration.current
      )
        setPhotoBusy(false);
    }
  }

  async function chooseDevicePhoto(source: 'camera' | 'gallery') {
    if (!isNative()) {
      (source === 'camera' ? cameraInput : photoInput).current?.click();
      return;
    }
    if (photoBusy) return;
    const generation = editorGeneration.current;
    const selection = ++photoGeneration.current;
    setPhotoBusy(true);
    setIdentifyError('');
    identifyAbort.current?.abort();
    setIdentifying(false);
    try {
      await saveCameraRecovery(draft, editing?.id ?? null);
      const file = await devicePhoto(source);
      if (
        generation === editorGeneration.current &&
        selection === photoGeneration.current
      )
        await preparePhoto(file, generation, selection);
    } catch (error) {
      if (
        generation === editorGeneration.current &&
        selection === photoGeneration.current
      ) {
        const message =
          error instanceof Error
            ? error.message
            : 'The camera could not open. You can upload a photo instead.';
        if (!/cancel/i.test(message)) setIdentifyError(message);
      }
    } finally {
      await clearCameraRecovery().catch(() => undefined);
      if (
        generation === editorGeneration.current &&
        selection === photoGeneration.current
      )
        setPhotoBusy(false);
    }
  }

  async function useCurrentLocation() {
    if (locationBusy) return;
    const generation = editorGeneration.current;
    setLocationBusy(true);
    setLocationStatus('');
    try {
      const position = await currentPosition();
      if (generation !== editorGeneration.current) return;
      setDraft((previous) => ({
        ...previous,
        purchaseLat: position.coords.latitude,
        purchaseLng: position.coords.longitude,
      }));
      setLocationBusy(false);
      setLocationStatus(
        "Location added. Give this place a name above so you'll remember it.",
      );
    } catch {
      if (generation !== editorGeneration.current) return;
      setLocationBusy(false);
      setLocationStatus(
        'Location was unavailable or permission was declined. You can still add coordinates manually.',
      );
    }
  }

  async function identify() {
    if (!draft.photo || identifying) return;
    if (!navigator.onLine) {
      setIdentifyError(
        "You're offline. Add the details manually, or try identification when you're connected.",
      );
      return;
    }
    const controller = new AbortController();
    identifyAbort.current = controller;
    const generation = editorGeneration.current;
    const selection = photoGeneration.current;
    setIdentifying(true);
    setIdentifyError('');
    setSubjectRejection(null);
    const timeout = window.setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await identifyPhoto(
        JSON.stringify({
          image: draft.photo,
          ...(hint.trim() ? { hint: hint.trim() } : {}),
        }),
        controller.signal,
      );
      const payload = (await response.json()) as {
        error?: string | { message?: string };
        candidate?: unknown;
        confidence?: unknown;
        explanation?: unknown;
        sources?: unknown;
        alternatives?: unknown;
      };
      if (
        generation !== editorGeneration.current ||
        selection !== photoGeneration.current ||
        identifyAbort.current !== controller ||
        controller.signal.aborted
      )
        return;
      const rejected = parseIdentifySubjectRejection(payload);
      if (rejected) {
        setSubjectRejection(rejected.outcome);
        setDraft((previous) => ({ ...previous, identification: undefined }));
        // A rejected re-scan must not approve a previous, unreviewed suggestion.
        setConfirmed(false);
        return;
      }
      if (!response.ok)
        throw new Error(
          typeof payload.error === 'string'
            ? payload.error
            : payload.error?.message ||
                'Identification is unavailable right now. Your photo is still here; you can enter the details manually.',
        );
      if (
        !payload.candidate ||
        typeof payload.candidate !== 'object' ||
        typeof payload.confidence !== 'string' ||
        !['high', 'medium', 'low'].includes(payload.confidence)
      )
        throw new Error(
          'The identification response was incomplete. Please retry or add the details yourself.',
        );
      const result = payload as IdentifyResult;
      const evidence: IdentificationEvidence = {
        confidence: result.confidence,
        explanation:
          typeof result.explanation === 'string'
            ? result.explanation
            : 'Please check the suggested details before saving.',
        sources: Array.isArray(result.sources)
          ? result.sources.filter(
              (source) =>
                typeof source?.url === 'string' &&
                typeof source?.title === 'string',
            )
          : [],
        alternatives: Array.isArray(result.alternatives)
          ? result.alternatives.filter((value) => typeof value === 'string')
          : [],
      };
      setDraft((previous) => {
        const next = { ...previous, identification: evidence };
        for (const key of [
          'fullName',
          'brand',
          'country',
          'region',
          'wrapper',
          'strength',
          'vitola',
        ] as const) {
          const value = result.candidate[key];
          if (typeof value === 'string' && value.trim())
            next[key] = value.trim();
        }
        if (Array.isArray(result.candidate.flavorNotes))
          next.flavorNotes = result.candidate.flavorNotes.filter(
            (note) => typeof note === 'string',
          );
        return next;
      });
      setNeedsConfirmation(true);
      setConfirmed(false);
    } catch (error) {
      if (identifyAbort.current === controller)
        setIdentifyError(
          error instanceof Error && error.name === 'AbortError'
            ? 'Identification timed out or was cancelled. Try a clearer photo, or continue manually.'
            : error instanceof Error
              ? error.message
              : 'Unable to identify this photo. You can still enter the details yourself.',
        );
    } finally {
      window.clearTimeout(timeout);
      if (identifyAbort.current === controller) {
        setIdentifying(false);
        identifyAbort.current = null;
      }
    }
  }

  async function saveCigar(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    if (!draft.fullName.trim()) {
      setFormError('Give this cigar a name before saving.');
      return;
    }
    if (needsConfirmation && !confirmed) {
      setFormError('Check the suggested details, then confirm them below.');
      return;
    }
    if ((draft.purchaseLat === null) !== (draft.purchaseLng === null)) {
      setFormError(
        'Add both latitude and longitude to place your purchase on the map, or leave both blank.',
      );
      return;
    }
    if (
      (draft.purchaseLat !== null &&
        (!Number.isFinite(draft.purchaseLat) ||
          draft.purchaseLat < -90 ||
          draft.purchaseLat > 90)) ||
      (draft.purchaseLng !== null &&
        (!Number.isFinite(draft.purchaseLng) ||
          draft.purchaseLng < -180 ||
          draft.purchaseLng > 180))
    ) {
      setFormError(
        'Latitude must be between −90 and 90, and longitude between −180 and 180.',
      );
      return;
    }
    if (!canWrite || mutationLock.current) {
      setFormError(
        "Your journal isn't ready to save yet. Wait for any import or save to finish, then try again.",
      );
      return;
    }
    mutationLock.current = true;
    setSaving(true);
    const now = new Date().toISOString();
    const entry: CigarEntry = {
      ...draft,
      fullName: draft.fullName.trim(),
      brand: draft.brand.trim(),
      country: draft.country.trim(),
      region: draft.region.trim(),
      purchasePlace: draft.purchasePlace.trim(),
      id: editing?.id || crypto.randomUUID(),
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    };
    const next = editing
      ? entriesRef.current.map((item) =>
          item.id === editing.id ? entry : item,
        )
      : [entry, ...entriesRef.current];
    if (await commit(next)) {
      setEditorOpen(false);
      toggleSample(false);
      setTab('journal');
      setNotice({
        message: editing
          ? 'Your cigar has been updated.'
          : draft.status === 'humidor'
            ? 'Added to your humidor.'
            : 'Saved to your journal.',
      });
    } else
      setFormError(
        "This cigar hasn't been saved. Your photo and notes are still here. Download this entry to preserve it before reloading, then import it from Settings.",
      );
    mutationLock.current = false;
    setSaving(false);
  }

  async function downloadDraft() {
    const now = new Date().toISOString();
    const entry: CigarEntry = {
      ...draft,
      fullName: draft.fullName.trim() || 'Untitled cigar',
      smokedAt: draft.status === 'humidor' ? '' : draft.smokedAt || today(),
      id: editing?.id || crypto.randomUUID(),
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    };
    try {
      const saved = await exportJournal([entry]);
      if (!saved) return;
      setNotice({
        message:
          'This entry is ready to download. Import it from Settings to restore it later.',
      });
    } catch (error) {
      setNotice({
        message:
          error instanceof Error
            ? error.message
            : "This entry couldn't be downloaded. Please keep this form open and try again.",
      });
    }
  }

  async function deleteCigar() {
    if (!deleteTarget || mutationLock.current || !canWrite) return;
    mutationLock.current = true;
    setSaving(true);
    if (
      await commit(
        entriesRef.current.filter((entry) => entry.id !== deleteTarget.id),
      )
    ) {
      setNotice({
        message: `${deleteTarget.fullName} removed.`,
        undo: deleteTarget,
      });
      setDeleteTarget(null);
      setSelectedId(null);
    }
    mutationLock.current = false;
    setSaving(false);
  }

  async function undoDelete() {
    if (!notice?.undo || mutationLock.current || !canWrite) return;
    const removed = notice.undo;
    mutationLock.current = true;
    setSaving(true);
    if (
      await commit([
        ...entriesRef.current.filter((entry) => entry.id !== removed.id),
        removed,
      ])
    )
      setNotice({ message: 'Cigar restored to your journal.' });
    mutationLock.current = false;
    setSaving(false);
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canWrite || mutationLock.current) return;
    mutationLock.current = true;
    setImportBusy(true);
    try {
      const backup = await importJournalBackup(file);
      const incoming = backup.entries;
      const merged = new Map(
        entriesRef.current.map((entry) => [entry.id, entry]),
      );
      for (const entry of incoming) {
        const existing = merged.get(entry.id);
        if (!existing || entry.updatedAt > existing.updatedAt)
          merged.set(entry.id, entry);
      }
      if (await commit([...merged.values()], backup.establishedOn)) {
        toggleSample(false);
        setNotice({
          message: `${incoming.length} ${incoming.length === 1 ? 'entry' : 'entries'} imported. Your existing journal was merged safely.`,
        });
      }
    } catch (error) {
      setNotice({
        message:
          error instanceof Error
            ? error.message
            : "This backup couldn't be imported. Your journal has not changed.",
      });
    } finally {
      mutationLock.current = false;
      setImportBusy(false);
    }
  }

  async function exportBackup() {
    try {
      const saved = await exportJournal(entries, establishedOn);
      if (!saved) return;
      setNotice({ message: 'Your journal backup is ready to download.' });
    } catch (error) {
      setNotice({
        message:
          error instanceof Error
            ? error.message
            : "The backup couldn't be created. Please try again.",
      });
    }
  }

  async function install() {
    if (!installPrompt) {
      setInstallHelp((value) => !value);
      return;
    }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted')
        setNotice({ message: 'Ember is being added to your home screen.' });
      setInstallPrompt(null);
    } catch {
      setInstallHelp(true);
    }
  }

  const updateDraft = <K extends keyof CigarDraft>(
    key: K,
    value: CigarDraft[K],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));

  return (
    <div
      className={`ember-app terrace-experiment ${tab === 'terrace' ? 'terrace-home' : 'terrace-work'}`}
    >
      <aside className="ember-sidebar">
        <button
          className="ember-logo"
          onClick={() => navigate('terrace')}
          aria-label="Ember terrace home"
        >
          <span>ember</span>
          <Flame
            className="logo-spark"
            size={15}
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </button>
        <nav className="desktop-nav" aria-label="Main navigation">
          <button
            className={tab === 'journal' ? 'active' : ''}
            onClick={() => navigate('journal')}
          >
            <BookOpen size={19} />
            My journal
          </button>
          <button
            className={tab === 'atlas' ? 'active' : ''}
            onClick={() => navigate('atlas')}
          >
            <Globe2 size={19} />
            World atlas
          </button>
          <button onClick={() => openEditor()} disabled={!canWrite}>
            <Plus size={19} />
            Add a cigar
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button
            className="sidebar-settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={18} />
            Settings & backup
          </button>
          <div className="local-status">
            <span className={`status-dot ${storageError ? 'error' : ''}`} />
            {loaded
              ? storageError
                ? 'Storage needs attention'
                : 'Saved on this device'
              : 'Opening your journal…'}
            <ShieldCheck size={13} />
          </div>
        </div>
      </aside>

      <div className="ember-main-shell">
        <RecordPlayer
          presentation="compact"
          libraryOpen={recordLibraryOpen}
          onLibraryOpenChange={setRecordLibraryOpen}
          onPlayingChange={setRecordPlaying}
          onTrackChange={setRecordTitle}
          onControls={(controls) => {
            recordControls.current = controls;
          }}
          transportInLibrary={tab === 'terrace'}
          renderFrame={(controls) =>
            tab === 'terrace' ? (
              recordLibraryOpen ? (
                <div className="living-terrace-records">{controls}</div>
              ) : null
            ) : (
              <header
                className={`ember-topbar ${recordLibraryOpen ? 'music-open' : ''}`}
              >
                <button
                  className="ember-logo mobile-logo"
                  onClick={() => navigate('terrace')}
                  aria-label="Ember terrace home"
                >
                  <span>ember</span>
                  <Flame
                    className="logo-spark"
                    size={15}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                </button>
                <span className="topbar-note">Good taste.</span>
                <div className="terrace-player-slot">{controls}</div>
              </header>
            )
          }
        />
        <main className="ember-main">
          {storageError && (
            <div className="ember-alert" role="alert">
              <ShieldCheck size={19} />
              <div>{storageError}</div>
              <button onClick={() => window.location.reload()}>Reload</button>
            </div>
          )}
          {sample && (
            <div className="sample-banner">
              <Sparkles size={17} />
              <div>
                <strong>You’re exploring a sample journal.</strong>
                <span>
                  {' '}
                  Fictional entries and illustrative photos. Your own journal is
                  separate.
                </span>
              </div>
              <button onClick={() => toggleSample(false)}>
                Back to mine
                <ArrowRight size={14} />
              </button>
            </div>
          )}

          {tab === 'terrace' ? (
            <LivingTerrace
              establishedLabel={`EST. ${loaded && !storageError ? (establishedOn ? displayDate(establishedOn) : 'NOW') : '…'}`}
              canAdd={canWrite}
              musicOpen={recordLibraryOpen}
              playing={recordPlaying}
              trackTitle={recordTitle}
              active={!editorOpen && !settingsOpen}
              onOpen={(destination) => {
                if (destination === 'identify') openEditor();
                else if (destination === 'records') setRecordLibraryOpen(true);
                else navigate(destination);
              }}
              onFlickRecords={() => recordControls.current?.toggle()}
              onSettings={() => setSettingsOpen(true)}
            />
          ) : (
            <section className="terrace-work-heading">
              <div>
                <h1 ref={workHeading} tabIndex={-1}>
                  {tab === 'journal' ? 'The Journal.' : 'The Atlas.'}
                </h1>
                <div className="journal-established">
                  EST.{' '}
                  {loaded && !storageError
                    ? establishedOn
                      ? displayDate(establishedOn)
                      : 'NOW'
                    : '…'}
                </div>
              </div>
              <button
                type="button"
                className="terrace-return"
                onClick={() => navigate('terrace')}
              >
                <ArrowLeft size={16} aria-hidden="true" />
                Terrace
              </button>
            </section>
          )}

          {tab === 'journal' ? (
            <>
              {(!loaded || visibleEntries.length === 0) && (
                <section
                  className="journal-feature"
                  aria-label="Start your cigar journal"
                >
                  <div className="journal-start">
                    {!loaded ? (
                      <p>
                        <LoaderCircle size={18} className="spinning" /> Opening
                        your journal…
                      </p>
                    ) : (
                      <>
                        <p>Log a cigar to begin.</p>
                        <button
                          className="text-button"
                          onClick={() => toggleSample(true)}
                        >
                          Explore a sample journal <ArrowRight size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </section>
              )}

              {visibleEntries.length > 0 && (
                <section
                  className="journal-collection"
                  aria-label="Cigar collection"
                >
                  <div className="collection-heading">
                    <h2>
                      <button
                        type="button"
                        className="collection-toggle"
                        aria-expanded={collectionToolsOpen}
                        aria-controls="journal-collection-tools"
                        onClick={() => setCollectionToolsOpen((open) => !open)}
                      >
                        Entries
                        <ChevronDown size={18} aria-hidden="true" />
                        {(search.trim() ||
                          countryFilter ||
                          statusFilter !== 'all' ||
                          ratingFilter !== 'all') && (
                          <span className="collection-filter-status">
                            Filtered
                          </span>
                        )}
                      </button>
                    </h2>
                  </div>
                  <div
                    id="journal-collection-tools"
                    className="collection-tools"
                    hidden={!collectionToolsOpen}
                  >
                    <div
                      className="layout-switch"
                      aria-label="Collection layout"
                    >
                      <button
                        onClick={() => setLayout('deck')}
                        aria-label="Card deck view"
                        aria-pressed={layout === 'deck'}
                      >
                        <BookOpen size={18} />
                      </button>
                      <button
                        onClick={() => setLayout('grid')}
                        aria-label="Grid view"
                        aria-pressed={layout === 'grid'}
                      >
                        <LayoutGrid size={17} />
                      </button>
                      <button
                        onClick={() => setLayout('list')}
                        aria-label="List view"
                        aria-pressed={layout === 'list'}
                      >
                        <List size={18} />
                      </button>
                    </div>
                    <div className="collection-toolbar">
                      <label className="search-field">
                        <Search size={17} />
                        <input
                          aria-label="Search your cigars"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Search your journal…"
                        />
                        {search && (
                          <button
                            onClick={() => setSearch('')}
                            aria-label="Clear search"
                          >
                            <X size={15} />
                          </button>
                        )}
                      </label>
                      <label className="select-field lifecycle-filter">
                        <select
                          aria-label="Filter by cigar status"
                          value={statusFilter}
                          onChange={(event) =>
                            setStatusFilter(
                              event.target.value as 'all' | CigarStatus,
                            )
                          }
                        >
                          <option value="all">All cigars</option>
                          <option value="humidor">Humidor</option>
                          <option value="enjoyed">Enjoyed</option>
                        </select>
                        <ChevronDown size={12} />
                      </label>
                      <label className="select-field">
                        <Star size={14} />
                        <select
                          aria-label="Filter by rating"
                          value={ratingFilter}
                          onChange={(event) =>
                            setRatingFilter(event.target.value)
                          }
                        >
                          <option value="all">All ratings</option>
                          <option value="5">5 stars</option>
                          <option value="4">4 stars & up</option>
                          <option value="3">3 stars & up</option>
                          <option value="unrated">Not rated</option>
                        </select>
                        <ChevronDown size={12} />
                      </label>
                      <label className="select-field sort-field">
                        <select
                          aria-label="Sort cigars"
                          value={sort}
                          onChange={(event) => setSort(event.target.value)}
                        >
                          <option value="newest">Newest first</option>
                          <option value="rating">Highest rated</option>
                          <option value="name">Name A–Z</option>
                        </select>
                        <ChevronDown size={12} />
                      </label>
                    </div>
                    {countries.length > 0 && (
                      <div
                        className="country-filters"
                        aria-label="Filter by origin"
                      >
                        <button
                          className={!countryFilter ? 'selected' : ''}
                          aria-pressed={!countryFilter}
                          onClick={() => setCountryFilter('')}
                        >
                          All origins
                        </button>
                        {countries.map((country) => (
                          <button
                            key={country}
                            className={
                              countryFilter === country ? 'selected' : ''
                            }
                            aria-pressed={countryFilter === country}
                            onClick={() => setCountryFilter(country)}
                          >
                            {countryFlags[country]} {country}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {filteredEntries.length === 0 ? (
                    <div className="journal-empty filtered-empty">
                      <Search size={30} strokeWidth={1.2} />
                      <h3>No cigars found.</h3>
                      <button
                        className="ember-button secondary"
                        onClick={resetFilters}
                      >
                        Clear filters
                      </button>
                    </div>
                  ) : layout === 'deck' ? (
                    <JournalDeck
                      entries={filteredEntries}
                      sample={sample}
                      onOpen={(entry) => setSelectedId(entry.id)}
                    />
                  ) : (
                    <div
                      className={`cigar-grid ${layout === 'list' ? 'list-layout' : ''}`}
                    >
                      {filteredEntries.map((entry) => (
                        <CigarCard
                          key={entry.id}
                          entry={entry}
                          sample={sample}
                          onOpen={() => setSelectedId(entry.id)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          ) : tab === 'atlas' ? (
            <>
              <section className="atlas-map-card" aria-label="Journal atlas">
                <div className="atlas-map-heading">
                  <div className="map-mode-switch">
                    <button
                      className={mapMode === 'origin' ? 'selected' : ''}
                      aria-pressed={mapMode === 'origin'}
                      onClick={() => setMapMode('origin')}
                    >
                      <Globe2 size={14} />
                      Origins
                    </button>
                    <button
                      className={mapMode === 'purchase' ? 'selected' : ''}
                      aria-pressed={mapMode === 'purchase'}
                      onClick={() => setMapMode('purchase')}
                    >
                      <MapPin size={14} />
                      Discoveries
                    </button>
                  </div>
                </div>
                <div className="atlas-map">
                  <OriginMap entries={visibleEntries} mode={mapMode} />
                </div>
                <div className="atlas-map-footer">
                  <span>
                    <span className="map-legend-dot" />
                    {mapMode === 'origin'
                      ? `${countries.length} ${countries.length === 1 ? 'origin' : 'origins'} explored`
                      : `${locations.length} ${locations.length === 1 ? 'purchase location' : 'purchase locations'} pinned`}
                  </span>
                  <span>
                    {mapMode === 'origin'
                      ? 'Origin describes where the cigar was made.'
                      : 'Discovery describes where you bought the cigar.'}
                  </span>
                </div>
              </section>
              <div className="atlas-bottom-grid">
                <section className="origin-list-card">
                  <div className="section-mini-header">
                    <h2>
                      {mapMode === 'origin'
                        ? 'Your origins'
                        : 'Your discoveries'}
                    </h2>
                    <span>
                      {mapMode === 'origin'
                        ? countries.length
                        : locations.length}
                    </span>
                  </div>
                  {mapMode === 'origin' ? (
                    originCounts.length ? (
                      originCounts.map(({ country, count }, index) => (
                        <button
                          className="origin-row"
                          key={country}
                          onClick={() => {
                            setCountryFilter(country);
                            setSearch('');
                            setRatingFilter('all');
                            setStatusFilter('all');
                            navigate('journal');
                          }}
                        >
                          <span className="origin-number">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="origin-flag">
                            {countryFlags[country] || '◌'}
                          </span>
                          <span>{country}</span>
                          <span className="origin-count">
                            {count} {count === 1 ? 'cigar' : 'cigars'}
                          </span>
                          <ArrowRight size={15} />
                        </button>
                      ))
                    ) : (
                      <div className="small-empty">
                        <Globe2 size={28} strokeWidth={1.2} />
                        <h3>No origins yet.</h3>
                        <p>Add a cigar’s country of origin to place it here.</p>
                      </div>
                    )
                  ) : locations.length ? (
                    locations.map((entry) => (
                      <button
                        key={entry.id}
                        className="origin-row"
                        onClick={() => setSelectedId(entry.id)}
                      >
                        <span className="origin-flag">
                          <MapPin size={20} />
                        </span>
                        <span>
                          <strong>
                            {entry.purchasePlace || 'Pinned location'}
                          </strong>
                          <small>{entry.fullName}</small>
                        </span>
                        <ArrowRight size={15} />
                      </button>
                    ))
                  ) : (
                    <div className="small-empty">
                      <MapPin size={28} strokeWidth={1.2} />
                      <h3>No purchase places yet.</h3>
                      <p>
                        Use “Where found” in a cigar’s details to add a map pin.
                      </p>
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : null}
        </main>
      </div>

      {tab !== 'terrace' && (
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          <button
            className={tab === 'journal' ? 'active' : ''}
            onClick={() => navigate('journal')}
          >
            <BookOpen size={20} />
            <span>Journal</span>
          </button>
          <button
            className={tab === 'atlas' ? 'active' : ''}
            onClick={() => navigate('atlas')}
          >
            <Globe2 size={20} />
            <span>Atlas</span>
          </button>
          <button
            className="mobile-add"
            onClick={() => openEditor()}
            disabled={!canWrite}
          >
            <span>
              <Plus size={24} />
            </span>
            <span>Add a cigar</span>
          </button>
          <button
            aria-label="Open records"
            onClick={() => setRecordLibraryOpen(true)}
          >
            <Disc3 size={20} />
            <span>Records</span>
          </button>
          <button onClick={() => setSettingsOpen(true)}>
            <Settings2 size={20} />
            <span>Settings</span>
          </button>
        </nav>
      )}

      <Dialog open={editorOpen} onOpenChange={closeEditor}>
        <DialogContent
          className="ember-dialog editor-dialog"
          showCloseButton={false}
        >
          <div className="dialog-titlebar">
            <div>
              <DialogTitle>
                {editing ? 'Edit cigar' : 'Add a cigar'}
              </DialogTitle>
              <DialogDescription className="visually-hidden">
                Photo, identification, rating, and notes.
              </DialogDescription>
            </div>
            <button
              className="icon-button"
              onClick={() => closeEditor(false)}
              aria-label="Close cigar form"
              disabled={saving}
            >
              <X size={20} />
            </button>
          </div>
          <form className="cigar-editor" onSubmit={saveCigar}>
            <div className="editor-scroll">
              <div className="editor-photo-column">
                <div
                  className={`editor-photo ${draft.photo ? 'has-photo' : ''}`}
                >
                  {draft.photo ? (
                    <>
                      <img src={draft.photo} alt="Selected cigar photograph" />
                      <button
                        type="button"
                        className="remove-photo"
                        aria-label="Remove selected photograph"
                        onClick={() => {
                          identifyAbort.current?.abort();
                          updateDraft('photo', '');
                          updateDraft('identification', undefined);
                          setNeedsConfirmation(false);
                          setIdentifying(false);
                          setSubjectRejection(null);
                        }}
                        disabled={identifying || photoBusy}
                      >
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <div className="photo-upload-placeholder">
                      <p>A photo of the band.</p>
                    </div>
                  )}
                  {photoBusy && (
                    <div className="photo-loading">
                      <CigarLoader phase="preparing" />
                    </div>
                  )}
                </div>
                {draft.photo && (
                  <PhotoViewer
                    src={draft.photo}
                    alt="Selected cigar photograph"
                    open={photoViewerOpen && editorOpen}
                    onOpenChange={setPhotoViewerOpen}
                    disabled={photoBusy}
                    className="editor-photo-view-trigger"
                  />
                )}
                <div className="photo-actions">
                  <button
                    className="ember-button secondary glyph-button"
                    type="button"
                    aria-label="Camera"
                    title="Camera"
                    onClick={() => chooseDevicePhoto('camera')}
                    disabled={photoBusy || identifying}
                  >
                    <CameraGlyph />
                  </button>
                  <button
                    className="ember-button secondary glyph-button"
                    type="button"
                    aria-label="Gallery"
                    title="Gallery"
                    onClick={() => chooseDevicePhoto('gallery')}
                    disabled={photoBusy || identifying}
                  >
                    <AlbumGlyph />
                  </button>
                </div>
                {subjectRejection && (
                  <BeachCompanion reason={subjectRejection} />
                )}
                <input
                  ref={cameraInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="visually-hidden"
                  aria-label="Take a cigar photo"
                  onChange={choosePhoto}
                  disabled={photoBusy || identifying}
                />
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  className="visually-hidden"
                  aria-label="Upload a cigar photo"
                  onChange={choosePhoto}
                  disabled={photoBusy || identifying}
                />
                {draft.photo && (
                  <div className="editor-identification">
                    <details className="band-hint">
                      <summary>
                        Band hint <span>optional</span>
                      </summary>
                      <label className="form-field hint-field">
                        <span className="visually-hidden">
                          What can you read on the band?
                        </span>
                        <Input
                          value={hint}
                          onChange={(event) => setHint(event.target.value)}
                          placeholder="A brand, initials, or a few words…"
                          maxLength={300}
                        />
                      </label>
                    </details>
                    <button
                      type="button"
                      className="ember-button identify-button"
                      onClick={identify}
                      disabled={!draft.photo || photoBusy || identifying}
                    >
                      <Sparkles size={17} />
                      Identify cigar
                    </button>
                    {identifying && (
                      <CigarLoader
                        phase="identifying"
                        className="identify-loading"
                      />
                    )}
                    <div className="privacy-note">
                      <ShieldCheck size={12} />
                      <span>
                        Identify sends this photo and any hint to OpenAI.
                      </span>
                    </div>
                  </div>
                )}
                {identifyError && (
                  <div className="form-message error" role="alert">
                    {identifyError}
                  </div>
                )}
              </div>
              <div className="editor-fields-column">
                {draft.identification && (
                  <Evidence
                    key={editing?.id || 'new-identification'}
                    evidence={draft.identification}
                    previous={Boolean(editing) && !needsConfirmation}
                  />
                )}
                <label className="form-field">
                  <span>
                    Cigar name <span className="required">*</span>
                  </span>
                  <Input
                    required
                    autoComplete="off"
                    value={draft.fullName}
                    onChange={(event) =>
                      updateDraft('fullName', event.target.value)
                    }
                    placeholder="The full name, or your own name for it"
                    maxLength={180}
                  />
                </label>
                <fieldset className="cigar-status-choice">
                  <legend className="visually-hidden">Cigar status</legend>
                  <button
                    type="button"
                    aria-pressed={draft.status === 'humidor'}
                    onClick={() =>
                      setDraft((previous) =>
                        withStatus(previous, 'humidor', today()),
                      )
                    }
                  >
                    In the humidor
                  </button>
                  <button
                    type="button"
                    aria-pressed={draft.status === 'enjoyed'}
                    onClick={() =>
                      setDraft((previous) =>
                        withStatus(previous, 'enjoyed', today()),
                      )
                    }
                  >
                    Enjoyed
                  </button>
                </fieldset>
                {!draft.status && (
                  <p className="status-unclassified">
                    Status not set for this earlier entry.
                  </p>
                )}
                <div className="form-row">
                  <label className="form-field">
                    <span>Brand</span>
                    <Input
                      value={draft.brand}
                      onChange={(event) =>
                        updateDraft('brand', event.target.value)
                      }
                      placeholder="e.g. Padrón"
                      maxLength={120}
                    />
                  </label>
                  <label className="form-field">
                    <span>Country of origin</span>
                    <Input
                      list="ember-countries"
                      value={draft.country}
                      onChange={(event) =>
                        updateDraft('country', event.target.value)
                      }
                      placeholder="Where it was made"
                      maxLength={100}
                    />
                    <datalist id="ember-countries">
                      {countryOptions.map((country) => (
                        <option key={country} value={country}>
                          {country}
                        </option>
                      ))}
                    </datalist>
                  </label>
                </div>
                {draft.status !== 'humidor' && (
                  <div className="rating-date-row">
                    <div className="form-field">
                      <span>Your rating</span>
                      <Stars
                        value={draft.rating}
                        onChange={(rating) => updateDraft('rating', rating)}
                        size="large"
                      />
                      <output className="rating-verdict" aria-live="polite">
                        {ratingVerdicts[draft.rating]}
                      </output>
                    </div>
                    <label className="form-field date-field">
                      <span>
                        {draft.status === 'enjoyed'
                          ? 'Date enjoyed'
                          : 'Date recorded'}{' '}
                        <span className="required">*</span>
                      </span>
                      <Input
                        type="date"
                        required
                        value={draft.smokedAt}
                        onChange={(event) =>
                          updateDraft('smokedAt', event.target.value)
                        }
                      />
                    </label>
                  </div>
                )}
                <label className="form-field">
                  <span>Notes</span>
                  <textarea
                    value={draft.notes}
                    onChange={(event) =>
                      updateDraft('notes', event.target.value)
                    }
                    placeholder="Anything worth remembering."
                    rows={4}
                    maxLength={6000}
                  />
                </label>
                <details className="editor-details" open={Boolean(editing)}>
                  <summary>
                    <span>
                      <Leaf size={16} />
                      The finer details
                    </span>
                    <ChevronDown size={16} />
                  </summary>
                  <div className="details-fields">
                    <div className="form-row">
                      <label className="form-field">
                        <span>Vitola / size</span>
                        <Input
                          value={draft.vitola}
                          onChange={(event) =>
                            updateDraft('vitola', event.target.value)
                          }
                          placeholder="e.g. Robusto"
                          maxLength={100}
                        />
                      </label>
                      <label className="form-field">
                        <span>Strength</span>
                        <select
                          value={draft.strength}
                          onChange={(event) =>
                            updateDraft('strength', event.target.value)
                          }
                        >
                          <option value="">Not sure yet</option>
                          {[
                            'Mild',
                            'Mild–medium',
                            'Medium',
                            'Medium–full',
                            'Full',
                          ].map((strength) => (
                            <option key={strength}>{strength}</option>
                          ))}
                          {draft.strength &&
                            ![
                              'Mild',
                              'Mild–medium',
                              'Medium',
                              'Medium–full',
                              'Full',
                            ].includes(draft.strength) && (
                              <option>{draft.strength}</option>
                            )}
                        </select>
                      </label>
                    </div>
                    <div className="form-row">
                      <label className="form-field">
                        <span>Wrapper</span>
                        <Input
                          value={draft.wrapper}
                          onChange={(event) =>
                            updateDraft('wrapper', event.target.value)
                          }
                          placeholder="e.g. Maduro"
                          maxLength={120}
                        />
                      </label>
                      <label className="form-field">
                        <span>Origin region</span>
                        <Input
                          value={draft.region}
                          onChange={(event) =>
                            updateDraft('region', event.target.value)
                          }
                          placeholder="e.g. Estelí"
                          maxLength={120}
                        />
                      </label>
                    </div>
                    <label className="form-field">
                      <span>
                        Flavour notes <small>Separate with commas</small>
                      </span>
                      <Input
                        value={draft.flavorNotes.join(', ')}
                        onChange={(event) =>
                          updateDraft(
                            'flavorNotes',
                            event.target.value
                              .split(',')
                              .map((note) => note.trimStart()),
                          )
                        }
                        onBlur={() =>
                          updateDraft(
                            'flavorNotes',
                            draft.flavorNotes
                              .map((note) => note.trim())
                              .filter(Boolean),
                          )
                        }
                        placeholder="Cedar, cocoa, a little pepper…"
                        maxLength={500}
                      />
                    </label>
                  </div>
                </details>
                <details
                  className="editor-details"
                  open={Boolean(editing?.purchasePlace)}
                >
                  <summary>
                    <span>
                      <MapPin size={16} />
                      Where you found it
                    </span>
                    <ChevronDown size={16} />
                  </summary>
                  <div className="details-fields">
                    <label className="form-field">
                      <span>Purchase place</span>
                      <Input
                        value={draft.purchasePlace}
                        onChange={(event) =>
                          updateDraft('purchasePlace', event.target.value)
                        }
                        placeholder="A shop, a city, a memorable trip…"
                        maxLength={200}
                      />
                    </label>
                    <button
                      type="button"
                      className="ember-button secondary location-button"
                      onClick={useCurrentLocation}
                      disabled={locationBusy}
                    >
                      {locationBusy ? (
                        <LoaderCircle size={15} className="spinning" />
                      ) : (
                        <MapPin size={15} />
                      )}
                      {locationBusy
                        ? 'Finding your location…'
                        : 'Use my current location'}
                    </button>
                    {locationStatus && (
                      <output className="field-help">{locationStatus}</output>
                    )}
                    <p className="field-help">
                      Use your location while at the shop, or add coordinates
                      from your map app. These coordinates mark where you found
                      the cigar, separate from its origin.
                    </p>
                    <div className="form-row">
                      <label className="form-field">
                        <span>Latitude</span>
                        <Input
                          type="number"
                          min={-90}
                          max={90}
                          step="any"
                          value={draft.purchaseLat ?? ''}
                          onChange={(event) =>
                            updateDraft(
                              'purchaseLat',
                              event.target.value === ''
                                ? null
                                : Number(event.target.value),
                            )
                          }
                          placeholder="e.g. 23.1136"
                        />
                      </label>
                      <label className="form-field">
                        <span>Longitude</span>
                        <Input
                          type="number"
                          min={-180}
                          max={180}
                          step="any"
                          value={draft.purchaseLng ?? ''}
                          onChange={(event) =>
                            updateDraft(
                              'purchaseLng',
                              event.target.value === ''
                                ? null
                                : Number(event.target.value),
                            )
                          }
                          placeholder="e.g. −82.3666"
                        />
                      </label>
                    </div>
                  </div>
                </details>
                {needsConfirmation && (
                  <label className="confirm-recognition">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>
                      I’ve checked the suggested identification and corrected
                      any uncertain details.
                    </span>
                  </label>
                )}
                {formError && (
                  <div className="form-message error" role="alert">
                    {formError}
                    <button
                      type="button"
                      className="text-button draft-download"
                      onClick={downloadDraft}
                    >
                      <Download size={14} />
                      Download this entry
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="editor-footer">
              <span>
                <ShieldCheck size={14} />
                Saved privately on this device
              </span>
              <div>
                <button
                  type="button"
                  className="ember-button secondary"
                  onClick={() => closeEditor(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="ember-button primary"
                  disabled={
                    saving ||
                    photoBusy ||
                    locationBusy ||
                    identifying ||
                    (needsConfirmation && !confirmed)
                  }
                >
                  {saving ? (
                    <LoaderCircle size={16} className="spinning" />
                  ) : (
                    <Check size={17} />
                  )}
                  {saving
                    ? 'Saving…'
                    : editing
                      ? 'Save changes'
                      : draft.status === 'humidor'
                        ? 'Add to humidor'
                        : 'Save to journal'}
                </button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent
          className="ember-dialog detail-dialog"
          showCloseButton={false}
        >
          {selected && (
            <>
              <div
                className={`detail-cover ${selected.photo ? '' : 'no-photo'}`}
              >
                <div className="detail-photo-bar">
                  <span className="detail-country">
                    {countryFlags[selected.country]}{' '}
                    {shortPlace(selected.country)}
                  </span>
                  {sample && (
                    <span className="detail-sample-label">Sample photo</span>
                  )}
                  <button
                    className="detail-close"
                    onClick={() => setSelectedId(null)}
                    aria-label="Close cigar details"
                  >
                    <X size={20} />
                  </button>
                </div>
                {selected.photo ? (
                  <img
                    src={selected.photo}
                    alt={
                      sample
                        ? 'Illustrative sample cigar photograph'
                        : selected.fullName
                    }
                  />
                ) : (
                  <div className="detail-cover-placeholder">
                    <Leaf size={56} strokeWidth={1} />
                  </div>
                )}
              </div>
              <div className="detail-scroll">
                {selected.photo && (
                  <PhotoViewer
                    src={selected.photo}
                    alt={
                      sample
                        ? 'Illustrative sample cigar photograph'
                        : selected.fullName
                    }
                    open={photoViewerOpen && Boolean(selected)}
                    onOpenChange={setPhotoViewerOpen}
                    className="detail-photo-view-trigger"
                  />
                )}
                <div className="detail-heading">
                  <div className="eyebrow">
                    {selected.brand || 'FROM YOUR PERSONAL COLLECTION'}
                  </div>
                  <DialogTitle>{selected.fullName}</DialogTitle>
                  <DialogDescription>
                    {[
                      selected.vitola,
                      selected.strength,
                      `${selected.status === 'humidor' ? 'Added ' : ''}${displayDate(entryDate(selected), true)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </DialogDescription>
                  <div className="detail-status-line">
                    <span className="entry-status">
                      {selected.status === 'humidor'
                        ? 'In the humidor'
                        : selected.status === 'enjoyed'
                          ? 'Enjoyed'
                          : 'Status not set'}
                    </span>
                    {!sample && selected.status !== 'enjoyed' && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={!canWrite}
                        onClick={() => openEditor(selected, 'enjoyed')}
                      >
                        Mark enjoyed <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                  {selected.status !== 'humidor' && (
                    <div className="detail-rating">
                      <Stars value={selected.rating} size="large" />
                      <span>
                        {selected.rating
                          ? `${selected.rating} / 5 · Your rating`
                          : 'Not yet rated'}
                      </span>
                    </div>
                  )}
                </div>
                <div className="detail-facts">
                  {[
                    [
                      'Origin',
                      [selected.country, selected.region]
                        .filter(Boolean)
                        .join(' · '),
                    ],
                    ['Wrapper', selected.wrapper],
                    ['Strength', selected.strength],
                    ['Vitola', selected.vitola],
                  ]
                    .filter(([, value]) => value)
                    .map(([label, value]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                </div>
                {selected.flavorNotes.length > 0 && (
                  <div className="detail-flavors">
                    <div className="eyebrow">TASTING NOTES</div>
                    <div className="flavor-tags">
                      {selected.flavorNotes.map((note, index) => (
                        <span key={`${note}-${index}`}>{note}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="detail-memory">
                  <div className="eyebrow">NOTES</div>
                  <p>
                    {selected.notes.trim() ? selected.notes : 'No notes yet.'}
                  </p>
                </div>
                {selected.purchasePlace && (
                  <div className="detail-purchase">
                    <MapPin size={19} />
                    <div>
                      <span>Found at</span>
                      <strong>{selected.purchasePlace}</strong>
                      {selected.purchaseLat !== null &&
                        selected.purchaseLng !== null && (
                          <a
                            href={`https://www.openstreetmap.org/?mlat=${selected.purchaseLat}&mlon=${selected.purchaseLng}#map=13/${selected.purchaseLat}/${selected.purchaseLng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View purchase location
                            <ExternalLink size={12} />
                          </a>
                        )}
                    </div>
                  </div>
                )}
                {selected.identification && (
                  <div className="detail-identification">
                    <div className="eyebrow">IDENTIFICATION RECORD</div>
                    <Evidence evidence={selected.identification} />
                  </div>
                )}
              </div>
              <div className="detail-footer">
                {sample ? (
                  <>
                    <span>Just a glimpse of what your journal could be.</span>
                    <button
                      className="ember-button primary"
                      onClick={() => openEditor()}
                      disabled={!canWrite}
                    >
                      <Plus size={16} />
                      Log your own
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="delete-link"
                      onClick={() => {
                        setDeleteTarget(selected);
                        setSelectedId(null);
                      }}
                      disabled={!canWrite}
                    >
                      <Trash2 size={16} />
                      Delete
                    </button>
                    <button
                      className="ember-button primary"
                      onClick={() => openEditor(selected)}
                      disabled={!canWrite}
                    >
                      <Pencil size={15} />
                      Edit cigar
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !saving) setDeleteTarget(null);
        }}
      >
        <DialogContent className="ember-dialog small-dialog">
          <div className="delete-dialog-icon">
            <Trash2 size={25} />
          </div>
          <DialogTitle>Remove this cigar?</DialogTitle>
          <DialogDescription>
            “{deleteTarget?.fullName}” and its photo and notes will be removed
            from your journal. You can undo this right after deleting.
          </DialogDescription>
          <div className="small-dialog-actions">
            <button
              className="ember-button secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={saving}
            >
              Keep it
            </button>
            <button
              className="ember-button danger"
              onClick={deleteCigar}
              disabled={saving}
            >
              {saving ? (
                <LoaderCircle size={16} className="spinning" />
              ) : (
                <Trash2 size={16} />
              )}
              Remove cigar
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent
          className="ember-dialog settings-dialog"
          showCloseButton={false}
        >
          <div className="dialog-titlebar">
            <div>
              <div className="eyebrow">MAKE YOURSELF AT HOME</div>
              <DialogTitle>Your journal, your way.</DialogTitle>
              <DialogDescription>
                A few things to keep your memories close.
              </DialogDescription>
            </div>
            <button
              className="icon-button"
              onClick={() => setSettingsOpen(false)}
              aria-label="Close settings"
            >
              <X size={20} />
            </button>
          </div>
          <div className="settings-scroll">
            {isNative() && <NativeConnection />}
            {!isNative() && (
              <section className="settings-section install-section">
                <span className="settings-section-icon">
                  <Smartphone size={24} strokeWidth={1.5} />
                </span>
                <div>
                  <h3>A home on your phone.</h3>
                  <p>
                    Keep Ember one tap away. Install it on your Android home
                    screen for a full-screen journal.
                  </p>
                  <button className="ember-button primary" onClick={install}>
                    <ArrowDownToLine size={16} />
                    {installPrompt ? 'Install Ember' : 'How to install'}
                  </button>
                  {installHelp && (
                    <ol className="install-instructions">
                      <li>
                        Open this site’s HTTPS address in Chrome on your Android
                        phone.
                      </li>
                      <li>Tap Chrome’s three-dot menu in the top right.</li>
                      <li>
                        Choose <strong>Add to Home screen</strong>, then{' '}
                        <strong>Install</strong> if offered.
                      </li>
                      <li>
                        Launch Ember from its new home-screen icon. Online
                        identification requires a connection.
                      </li>
                    </ol>
                  )}
                </div>
              </section>
            )}
            <section className="settings-section">
              <span className="settings-section-icon">
                <Download size={24} strokeWidth={1.5} />
              </span>
              <div>
                <h3>Take your memories with you.</h3>
                <p>
                  Your journal lives only on this device. Export a backup
                  regularly, especially before clearing app data or changing
                  phones.
                </p>
                <div className="backup-count">
                  <BookOpen size={14} />
                  {entries.length} {entries.length === 1 ? 'cigar' : 'cigars'}{' '}
                  in your personal journal
                  {sample && <span>Sample entries aren’t included.</span>}
                </div>
                <div className="settings-actions">
                  <button
                    className="ember-button secondary"
                    onClick={exportBackup}
                    disabled={!loaded || importBusy}
                  >
                    <Download size={16} />
                    Export backup
                  </button>
                  <button
                    className="ember-button secondary"
                    onClick={() => importInput.current?.click()}
                    disabled={!canWrite || importBusy}
                  >
                    {importBusy ? (
                      <LoaderCircle size={16} className="spinning" />
                    ) : (
                      <Upload size={16} />
                    )}
                    {importBusy ? 'Importing…' : 'Import backup'}
                  </button>
                  <input
                    className="visually-hidden"
                    ref={importInput}
                    type="file"
                    accept=".json,application/json"
                    onChange={importBackup}
                    aria-label="Import journal backup"
                  />
                </div>
                <p className="field-help">
                  Imports merge with your journal. Matching entries keep the
                  most recently updated version.
                </p>
              </div>
            </section>
            <section className="settings-section">
              <span className="settings-section-icon">
                <ShieldCheck size={24} strokeWidth={1.5} />
              </span>
              <div>
                <h3>Private by default.</h3>
                <p>
                  Your journal belongs to this device. Photos, ratings, and
                  notes are stored here. They aren’t synced between devices.
                </p>
                <p>
                  Only when you tap <strong>Identify cigar</strong> is the
                  selected photo and optional hint sent to OpenAI through this
                  app’s server for online identification. Your other journal
                  entries aren’t included.
                </p>
                <p className="field-help">
                  Identification is a suggestion: check the cigar’s name and
                  origin before confirming. You can always enter everything
                  manually.
                </p>
              </div>
            </section>
            <section className="settings-section sample-setting">
              <span className="settings-section-icon">
                <Sparkles size={23} strokeWidth={1.5} />
              </span>
              <div>
                <h3>A little inspiration.</h3>
                <p>
                  Explore a fictional sample journal to see how a collection
                  comes together.
                </p>
                <button
                  className="text-button"
                  onClick={() => {
                    toggleSample(!sample);
                    setSettingsOpen(false);
                  }}
                >
                  {sample
                    ? 'Back to my own journal'
                    : 'Explore a sample journal'}
                  <ArrowRight size={15} />
                </button>
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      {notice && (
        <output className="ember-toast" aria-live="polite">
          <CheckCheck size={18} />
          <span>{notice.message}</span>
          {notice.undo && (
            <button
              className="toast-undo"
              onClick={undoDelete}
              disabled={saving}
            >
              Undo
            </button>
          )}
          <button
            className="toast-close"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </output>
      )}
    </div>
  );
}
