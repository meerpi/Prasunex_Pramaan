import { useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowDownUp, Search } from 'lucide-react';
import { formatCount } from '../../utils/format.ts';
import { EmptyState } from './EmptyState.tsx';
import { PaginationBar } from './PaginationBar.tsx';

export interface DataColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Array<DataColumn<T>>;
  rowKey: (row: T, idx: number) => string;
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  /** Only render search bar when rows exceed this threshold (default 10) unless user is actively filtering. */
  searchThreshold?: number;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  dense?: boolean;
  minWidthClassName?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = 'Filter records…',
  searchThreshold = 10,
  pageSize = 25,
  emptyTitle = 'No matching records',
  emptyDescription = 'Adjust filters or wait for new verification entries.',
  dense = false,
  minWidthClassName,
}: DataTableProps<T>) {
  const searchInputId = useId();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const showSearch = Boolean(searchText) && (rows.length > searchThreshold || query.trim().length > 0);
  const allowSort = rows.length > 5;
  const activeSortCol = allowSort ? sortCol : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !searchText) return rows;
    return rows.filter((r) => searchText(r).toLowerCase().includes(q));
  }, [rows, query, searchText]);

  const sorted = useMemo(() => {
    if (!activeSortCol) return filtered;
    const col = columns.find((c) => c.key === activeSortCol);
    if (!col?.sortValue) return filtered;
    const getter = col.sortValue;
    return [...filtered].sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortAsc ? av - bv : bv - av;
      }
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [filtered, activeSortCol, sortAsc, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const toggleSort = (key: string) => {
    if (sortCol === key) {
      setSortAsc((v) => !v);
    } else {
      setSortCol(key);
      setSortAsc(true);
    }
    setPage(0);
  };

  return (
    <div className="min-w-0 space-y-3">
      {showSearch && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted"
              aria-hidden="true"
            />
            <input
              id={searchInputId}
              name="table-search"
              type="search"
              aria-label={searchPlaceholder}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder={searchPlaceholder}
              className="w-full min-h-11 lg:min-h-9 rounded border border-rule bg-surface py-1.5 ps-9 pe-3 text-sm text-ink placeholder-ink-muted focus:border-action focus-visible:outline-2 focus-visible:outline-action"
            />
          </div>
          <span className="text-xs text-ink-secondary tabular">
            Showing {formatCount(pageRows.length)} of {formatCount(sorted.length)}
          </span>
        </div>
      )}

      {pageRows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div
          className={`max-w-full overflow-auto border-y border-rule ${
            pageRows.length > 12 ? 'max-h-[620px]' : ''
          }`}
        >
          <table
            className={`w-full border-collapse text-start text-sm ${
              minWidthClassName ??
              (columns.length >= 4
                ? 'min-w-[560px] sm:min-w-0'
                : columns.length >= 3
                  ? 'min-w-[460px] sm:min-w-0'
                  : '')
            }`}
          >
            <thead className="sticky top-0 z-10 bg-subtle text-xs text-ink-secondary">
              <tr className="border-b border-rule">
                {columns.map((col) => {
                  const sortable = allowSort && Boolean(col.sortValue);
                  const active = activeSortCol === col.key;
                  return (
                    <th
                      key={col.key}
                      aria-sort={
                        sortable ? (active ? (sortAsc ? 'ascending' : 'descending') : 'none') : undefined
                      }
                      className={`font-semibold sm:whitespace-nowrap ${
                        dense ? 'px-3 py-2.5' : 'px-3.5 py-3'
                      } ${col.align === 'right' ? 'text-end' : 'text-start'} ${
                        col.headerClassName ?? ''
                      }`}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className="btn-interactive inline-flex min-h-11 lg:min-h-7 items-center gap-1 rounded px-0.5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
                        >
                          <span>{col.header}</span>
                          <ArrowDownUp
                            className={`h-3 w-3 shrink-0 ${active ? 'text-action' : 'text-ink-muted'}`}
                            aria-hidden="true"
                          />
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-rule-subtle bg-surface/65">
              {pageRows.map((row, idx) => (
                <tr key={rowKey(row, safePage * pageSize + idx)} className="row-hoverable">
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`align-top text-ink tabular wrap-anywhere ${
                        dense ? 'px-3 py-2.5' : 'px-3.5 py-3'
                      } ${col.align === 'right' ? 'text-end' : 'text-start'} ${
                        col.cellClassName ?? ''
                      }`}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaginationBar page={safePage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
