import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Demo } from './Demo';
import '../styles.css';

createRoot(document.getElementById('racine')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
