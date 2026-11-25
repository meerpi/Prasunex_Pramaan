import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { FindingRow } from '../api/types.ts';

export const findingHighlightsKey = new PluginKey('pramaanFindingHighlights');

export interface HighlightsMeta {
  findings: FindingRow[];
  paragraphIds: string[];
  activeFindingId: number | null;
}

/** Build a O(1)-lookup codepoint-to-UTF16 table for a single text block. */
function buildCpToUtf16Table(text: string): number[] {
  const table: number[] = [0];
  let u16 = 0;
  for (const ch of text) {
    u16 += ch.length;
    table.push(u16);
  }
  return table;
}

export const FindingHighlightsExtension = Extension.create<{
  onSelectFinding?: (rowId: number) => void;
}>({
  name: 'pramaanFindingHighlights',

  addOptions() {
    return {
      onSelectFinding: undefined,
    };
  },

  addProseMirrorPlugins() {
    const onSelect = this.options.onSelectFinding;
    return [
      new Plugin<DecorationSet>({
        key: findingHighlightsKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, prev) {
            const meta = tr.getMeta(findingHighlightsKey) as HighlightsMeta | undefined;
            if (!meta) return prev.map(tr.mapping, tr.doc);

            const paragraphBase: Record<string, { pos: number; text: string; cpTable?: number[] }> = {};
            let pIdx = 0;
            tr.doc.forEach((node, pos) => {
              if (node.isTextblock) {
                const pid = meta.paragraphIds[pIdx] ?? `p-${pIdx}`;
                paragraphBase[pid] = { pos: pos + 1, text: node.textContent };
                pIdx += 1;
              }
            });

            const decos: Decoration[] = [];
            for (const f of meta.findings) {
              if (f.resolution !== 'open') continue;
              const loc = f.payload.locator;
              if (loc.kind !== 'span') continue;
              const target = paragraphBase[f.node_id];
              if (!target) continue;

              const table = (target.cpTable ??= buildCpToUtf16Table(target.text));
              const maxCp = table.length - 1;
              const uStart = table[Math.min(Math.max(0, loc.start), maxCp)];
              const uEnd = table[Math.min(Math.max(0, loc.end), maxCp)];
              if (uEnd <= uStart) continue;

              const from = target.pos + uStart;
              const to = Math.min(target.pos + target.text.length, target.pos + uEnd);
              if (to <= from) continue;

              const tierCls =
                f.payload.trace?.tier === 'tier_1_5_smt'
                  ? 'pramaan-hl-smt'
                  : f.severity >= 50
                    ? 'pramaan-hl-blocker'
                    : 'pramaan-hl-warning';
              const activeCls = f.row_id === meta.activeFindingId ? ' pramaan-hl-active' : '';
              decos.push(
                Decoration.inline(from, to, {
                  class: `${tierCls}${activeCls}`,
                  'data-finding-row': String(f.row_id),
                }),
              );
            }
            return DecorationSet.create(tr.doc, decos);
          },
        },
        props: {
          decorations(state) {
            return findingHighlightsKey.getState(state);
          },
          handleClick(_view, _pos, event) {
            const el = (event.target as HTMLElement | null)?.closest('[data-finding-row]');
            if (el && onSelect) {
              const rid = Number(el.getAttribute('data-finding-row'));
              if (!Number.isNaN(rid)) {
                onSelect(rid);
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});

