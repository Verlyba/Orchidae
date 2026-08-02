/**
 * Entry point. Mounts the shell, then hands control to the logic layer.
 *
 * Ordering is the whole point of this file: App.init() reads and writes DOM
 * nodes by id, so it must not run until React has put them on the page. The
 * old index.html got this for free from DOMContentLoaded.
 *
 * It has to be an effect, not a statement after render(): React 19 renders
 * concurrently, so `root.render(...)` returns before the tree is committed and
 * even a requestAnimationFrame callback can beat it to the DOM. That failure
 * is quiet and only partial — init() finds some elements and misses others,
 * and the app comes up looking fine with (measured, not guessed) the camera
 * dock never initialised. useEffect is the only hook guaranteed to run after
 * the commit.
 */
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { App as Shell } from './App';
import { App as Logic } from './legacy/app';

import './styles/tailwind.css';
import './styles/app.css';

let booted = false;

function Boot() {
  useEffect(() => {
    // Cheap insurance: init() opens a WebSocket and registers window-level
    // listeners, so a second run would double every log line.
    if (booted) return;
    booted = true;
    Logic.init();
  }, []);
  return <Shell />;
}

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

// StrictMode is deliberately not used. It mounts, unmounts and remounts every
// component on purpose, which would run App.init() twice — opening two
// WebSockets and duplicating every listener it registers. Once the logic layer
// is React state instead of DOM mutation, StrictMode becomes safe to turn on.
createRoot(container).render(<Boot />);
