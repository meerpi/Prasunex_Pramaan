import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from './format.ts';

export function useCopyFeedback<K extends string = string>(durationMs = 1800) {
  const [copiedKey, setCopiedKey] = useState<K | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const copy = useCallback(
    async (key: K, text: string): Promise<boolean> => {
      if (!text) return false;
      const ok = await copyText(text);
      if (ok) {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
        }
        setCopiedKey(key);
        timerRef.current = window.setTimeout(() => {
          setCopiedKey((cur) => (cur === key ? null : cur));
          timerRef.current = null;
        }, durationMs);
      }
      return ok;
    },
    [durationMs],
  );

  return { copiedKey, copy };
}
