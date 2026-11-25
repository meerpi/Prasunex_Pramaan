import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

async function bootstrap() {
  if (import.meta.env.DEV) {
    const { initBreakUiDev } = await import('./dev/initBreakUi.ts');
    initBreakUiDev();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
