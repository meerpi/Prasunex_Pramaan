interface PramaanSealProps {
  size?: number;
  tone?: 'light' | 'dark';
  className?: string;
}

/** Stark Indian Gazette institutional stamp unifying Pramaan across headers, rails, and credentials. */
export function PramaanSeal({ size = 28, tone = 'light', className = '' }: PramaanSealProps) {
  const onDark = tone === 'dark';
  const fill = onDark ? '#182C52' : '#EEF4FF';
  const outerStroke = onDark ? '#93C5FD' : '#1E40AF';
  const innerStroke = onDark ? '#3B62A0' : '#93C5FD';
  const glyphFill = onDark ? '#F8FAFC' : '#1E3A8A';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <rect
        x="2"
        y="2"
        width="32"
        height="32"
        rx="4"
        fill={fill}
        stroke={outerStroke}
        strokeWidth="1.6"
      />
      <rect
        x="5.5"
        y="5.5"
        width="25"
        height="25"
        rx="2"
        fill="none"
        stroke={innerStroke}
        strokeWidth="0.9"
      />
      <text
        x="18"
        y="23.5"
        textAnchor="middle"
        fontSize="16"
        fontWeight="700"
        fontFamily="'AnekDevaPramaan', 'AnekLatinCustom', sans-serif"
        fill={glyphFill}
      >
        प्र
      </text>
    </svg>
  );
}
