import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { installBreakUiFetchStub } from './breakUiFetch.ts';
import { BreakUiToggle } from './BreakUiToggle.tsx';

export function initBreakUiDev(): void {
  installBreakUiFetchStub();
  if (typeof document === 'undefined') return;
  if (document.getElementById('break-ui-dev-root')) return;
  const host = document.createElement('div');
  host.id = 'break-ui-dev-root';
  document.body.appendChild(host);
  createRoot(host).render(createElement(BreakUiToggle));
}
