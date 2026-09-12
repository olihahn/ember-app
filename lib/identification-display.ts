/** Presentation only: the original identification record is never rewritten. */
export function cleanIdentificationExplanation(value: string): string {
  const plain = value
    // Sources already have their own validated link list. Keep meaningful link
    // labels as prose, but remove domain-only citations and raw URLs here.
    .replace(
      /\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/giu,
      (_match, label: string) =>
        /^(?:https?:\/\/)?(?:www\.)?[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/iu.test(label)
          ? ''
          : label,
    )
    .replace(/https?:\/\/[^\s<>]+/giu, '')
    .replace(/\(\s*\)/gu, '')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`/gu, '$1$2$3')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;!?])/gu, '$1')
    .trim();
  const seen = new Set<string>();
  return sentences(plain)
    .filter((sentence) => {
      const key = sentence.normalize('NFKC').toLocaleLowerCase('en-US');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' ');
}

function sentences(value: string): string[] {
  return (value.match(/.+?(?:[.!?]+(?=\s|$)|$)/gu) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

const caution =
  /\b(?:uncertain|unclear|unreadable|unverified|tentative|ambiguous|conflicting|cannot|can't|could not|not (?:readable|verified|confirmed|visible)|does not match|no (?:verified|reliable|readable))\b/iu;

export function identificationSummary(value: string): {
  full: string;
  preview: string;
  expandable: boolean;
} {
  const full = cleanIdentificationExplanation(value);
  if (full.length <= 230) return { full, preview: full, expandable: false };

  const parts = sentences(full);
  // Never bury a known uncertainty beneath a long positive visual description.
  const chosen = parts.find((sentence) => caution.test(sentence)) ?? parts[0];
  let preview = chosen ?? '';
  if (preview.length > 230) {
    const end = preview.lastIndexOf(' ', 229);
    preview = `${preview.slice(0, end > 160 ? end : 229).trimEnd()}…`;
    // A long sentence can put its caveat after the cutoff. Do not leave a
    // positive-only fragment when the original sentence explicitly warned us.
    if (caution.test(chosen ?? '') && !caution.test(preview))
      preview =
        'Some details need checking. Open “Why this match?” to read the full explanation.';
  }
  return { full, preview, expandable: preview !== full };
}
