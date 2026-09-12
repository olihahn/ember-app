export interface CigarEntry {
  id: string;
  fullName: string;
  brand: string;
  country: string;
  region: string;
  wrapper: string;
  strength: string;
  vitola: string;
  flavorNotes: string[];
  photo: string;
  rating: number;
  smokedAt: string;
  notes: string;
  purchasePlace: string;
  purchaseLat: number | null;
  purchaseLng: number | null;
  createdAt: string;
  updatedAt: string;
  identification?: IdentificationEvidence;
  /** Absent on legacy entries: do not infer that a scan was smoked. */
  status?: 'humidor' | 'enjoyed';
  addedAt?: string;
}

export type CigarDraft = Omit<CigarEntry, 'id' | 'createdAt' | 'updatedAt'>;

export interface IdentificationEvidence {
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
  sources: { title: string; url: string }[];
  alternatives?: string[];
}

export interface IdentifyResult extends IdentificationEvidence {
  /** Optional so already-installed clients and older service results remain usable. */
  outcome?: 'identified' | 'tentative';
  subject?: IdentifySubject;
  candidate: Partial<
    Pick<
      CigarEntry,
      | 'fullName'
      | 'brand'
      | 'country'
      | 'region'
      | 'wrapper'
      | 'strength'
      | 'vitola'
      | 'flavorNotes'
    >
  >;
}

export interface IdentifySubject {
  kind: 'single_cigar' | 'multiple_cigars' | 'no_cigar' | 'uncertain';
  /** 2 means at least two physical cigars, not an exact count; null means unclear. */
  visibleCount: 0 | 1 | 2 | null;
  /** Qualitative visual evidence, not a measured probability. */
  confidence: 'high' | 'medium' | 'low';
}

export type IdentifyRejectedOutcome =
  | 'no_cigar'
  | 'multiple_cigars'
  | 'unclear_photo';

/** Returned with HTTP 422. Rejections deliberately contain no savable evidence. */
export interface IdentifySubjectRejection {
  outcome: IdentifyRejectedOutcome;
  code: 'NO_CIGAR' | 'MULTIPLE_CIGARS' | 'UNCLEAR_PHOTO';
  error: string;
  subject: IdentifySubject;
}
