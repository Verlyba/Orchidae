/**
 * Applies inline declarations that carry `!important`.
 *
 * React's `style` prop cannot express priority: it assigns through the CSSOM,
 * which rejects any value ending in `!important` and drops the declaration on
 * the floor without a warning. The hand-written index.html used inline
 * `!important` in a couple of places to outrank a rule in app.css, so dropping
 * them would quietly change the layout — which is exactly the kind of silent
 * regression this migration must not produce.
 *
 * Usage (the `style` prop keeps the normal-priority declarations):
 *
 *   <div style={{ position: 'relative' }}
 *        ref={important({ width: '48%', flex: '1 1 48%' })} />
 */
export function important(decls: Record<string, string>) {
  return (el: HTMLElement | null) => {
    if (!el) return;
    for (const [prop, value] of Object.entries(decls)) {
      // React-style camelCase keys, CSS-style custom properties untouched.
      const cssProp = prop.startsWith('--')
        ? prop
        : prop.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
      el.style.setProperty(cssProp, value, 'important');
    }
  };
}
