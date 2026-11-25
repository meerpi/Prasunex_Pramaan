import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCount } from '../../utils/format.ts';
import { Button } from './Button.tsx';

interface PaginationBarProps {
  page: number;
  totalPages: number;
  onPageChange: (nextPage: number) => void;
  className?: string;
}

export function PaginationBar({
  page,
  totalPages,
  onPageChange,
  className = '',
}: PaginationBarProps) {
  if (totalPages <= 1) return null;
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 text-xs text-ink-secondary tabular ${className}`}
    >
      <span>
        Page {formatCount(safePage + 1)} of {formatCount(totalPages)}
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          disabled={safePage === 0}
          onClick={() => onPageChange(Math.max(0, safePage - 1))}
        >
          <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
          Prev
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={safePage >= totalPages - 1}
          onClick={() => onPageChange(Math.min(totalPages - 1, safePage + 1))}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
