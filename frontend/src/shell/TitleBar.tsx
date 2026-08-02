/** Title bar — migrated verbatim from the pre-React web/index.html. */

export function TitleBar() {
  return (
    <header className="title-bar">
      <div className="title-bar-left">
        <span className="title-brand">Orchiday OS</span>
      </div>
      <div
        className="title-bar-center"
        id="title-active-project"
        aria-live="polite"
        data-i18n="title.noProject"
      >Žádný vybraný projekt</div>
      <div className="title-bar-right"></div>
    </header>
  );
}
