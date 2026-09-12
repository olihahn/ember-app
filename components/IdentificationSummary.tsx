import { identificationSummary } from '@/lib/identification-display';
import './identification-summary.css';

export function IdentificationSummary({
  explanation,
  className = '',
}: {
  explanation: string;
  className?: string;
}) {
  const { full, preview, expandable } = identificationSummary(explanation);
  if (!full) return null;

  return (
    <div className={`identification-summary ${className}`}>
      <p className="identification-summary-preview">{preview}</p>
      {expandable && (
        <details className="identification-summary-details">
          <summary>Why this match?</summary>
          <p>{full}</p>
        </details>
      )}
    </div>
  );
}
