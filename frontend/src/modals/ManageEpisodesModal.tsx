/** #modal-manage-episodes — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function ManageEpisodesModal() {
  return (
    <div
      className="modal-overlay"
      id="modal-manage-episodes"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-episodes-title"
    >
      <div className="modal-container" style={{ maxWidth: "750px", width: "100%" }}>
        <div className="modal-header">
          <h4 id="manage-episodes-title" data-i18n="h4.modal.episodes">Správa epizod</h4>
          <button
            className="modal-close-btn"
            onClick={(event: any) => { App.closeModal('modal-manage-episodes') }}
          >✕</button>
        </div>
        <div className="modal-body">
          <div
            id="manage-episodes-stats"
            style={{ marginBottom: "12px", fontSize: "13.5px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: "8px 12px", display: "flex", justifyContent: "space-between" }}
          >
            <span>
              Dataset:{' '}
              <strong id="manage-episodes-path" style={{ color: "var(--cyan)", fontFamily: "var(--font-mono)" }}>-</strong>
            </span>
            {' '}
            <span>
              Velikost:{' '}
              <strong id="manage-episodes-size" style={{ color: "var(--text-light)" }}>-</strong>
            </span>
          </div>
          <div id="manage-episodes-list" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{/* List of episodes populated dynamically */}</div>
        </div>
        <div className="modal-footer">
          <button
            className="btn btn-xs btn-secondary"
            onClick={(event: any) => { App.closeModal('modal-manage-episodes') }}
            data-i18n="btn.close"
          >Zavřít</button>
        </div>
      </div>
    </div>
  );
}
