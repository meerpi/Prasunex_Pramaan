import { useState } from 'react';

interface ExpandableTextProps {
  text: string;
  maxChars?: number;
  preserveLines?: boolean;
  className?: string;
}

/** Clamps verbose user/API text above maxChars with an inline Show more/less toggle. */
export function ExpandableText({
  text,
  maxChars = 280,
  preserveLines = false,
  className = '',
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trim();
  const needsClamp = trimmed.length > maxChars;
  const shown = !needsClamp || expanded ? trimmed : `${trimmed.slice(0, maxChars).trimEnd()}…`;

  return (
    <span className={className}>
      <span dir="auto" className={preserveLines ? 'whitespace-pre-line wrap-anywhere' : 'wrap-anywhere'}>
        {shown}
      </span>
      {needsClamp && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="ms-1.5 inline font-semibold text-xs text-action hover:underline focus-visible:outline-2 focus-visible:outline-action"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </span>
  );
}
