/**
 * `disabled` for a control that `legacy/app.ts` is still allowed to flip.
 *
 * React decides whether to dispatch a click by looking at the element's
 * PROPS, not at the DOM (`shouldPreventMouseEvent`: a click on a button whose
 * props say `disabled` is dropped before any listener runs). So a button
 * rendered as `disabled={true}` and later enabled imperatively —
 * `el.disabled = false`, which is how every page still does it — looks
 * enabled, is enabled as far as the browser is concerned, and yet swallows
 * every click. Silently: no error, no warning, nothing in the console.
 *
 * That is what happened to the Projects page's Open / Export / Delete buttons
 * after the React port, and to 15 more buttons on Datasety, Teleoperace,
 * Učení and Spuštění modelu.
 *
 * Until a page owns its state in React (see `pages/ProjectsPage.tsx` and
 * `state/projects.ts` for what that looks like), the DOM property has to be
 * the single source of truth: no `disabled` prop at all, and the initial
 * value set once on mount through this ref.
 *
 *   <button ref={initiallyDisabled} onClick={() => App.stop()}>Stop</button>
 *
 * Nothing is lost by leaving the prop out: the browser does not fire click
 * events on a disabled control either, so `el.disabled = true` still blocks
 * the button on its own.
 */
export function initiallyDisabled(el: HTMLButtonElement | HTMLInputElement | null): void {
  if (el) el.disabled = true;
}
