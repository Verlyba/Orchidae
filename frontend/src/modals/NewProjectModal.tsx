/** #modal-new-project — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function NewProjectModal() {
  return (
    <div
      className="modal-overlay"
      id="modal-new-project"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-modal-title"
      data-static=""
    >
      <div className="modal-container" style={{ maxWidth: "540px" }}>
        <div className="modal-header">
          <h4 id="new-project-modal-title" data-i18n="h4.modal.newProject">Vytvořit Nový Projekt</h4>
          <button
            className="modal-close-btn"
            onClick={(event: any) => { App.closeModal('modal-new-project') }}
          >✕</button>
        </div>
        <div className="modal-body">
          {/* Step 1: Mode Selection */}
          <div id="new-project-mode-selection" style={{ display: "block" }}>
            <label
              style={{ marginBottom: "12px", display: "block", fontSize: "13.5px", color: "var(--text-light)" }}
              data-i18n="lbl.selectProjectMode"
            >Vyberte způsob vytvoření projektu:</label>
            <div style={{ display: "flex", gap: "16px" }}>
              {/* Quick Setup Mode Card */}
              <div
                id="new-proj-card-quick"
                className="setup-block active"
                style={{ flex: "1", padding: "20px 16px", cursor: "pointer", transition: "all 0.2s", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "140px" }}
                onClick={(event: any) => { App.selectNewProjectModeDirect('quick') }}
              >
                <div
                  style={{ width: "40px", height: "40px", background: "rgba(220, 220, 170, 0.08)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "10px" }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="2.5"
                  >
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                </div>
                <div
                  style={{ fontWeight: "700", fontSize: "14.5px", color: "var(--accent)", marginBottom: "6px" }}
                  data-i18n="wiz.quickSetup"
                >Rychlý Setup</div>
                <div
                  style={{ fontSize: "11.5px", color: "var(--text-muted)", lineHeight: "1.4" }}
                  data-i18n="wiz.quickSetupDesc"
                >Nakonfiguruje robota a kamery krok za krokem pomocí průvodce.</div>
              </div>
              {/* Plain Project Mode Card */}
              <div
                id="new-proj-card-plain"
                className="setup-block"
                style={{ flex: "1", padding: "20px 16px", cursor: "pointer", transition: "all 0.2s", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "140px" }}
                onClick={(event: any) => { App.selectNewProjectModeDirect('plain') }}
              >
                <div
                  style={{ width: "40px", height: "40px", background: "rgba(255, 255, 255, 0.03)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "10px" }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--text-light)"
                    strokeWidth="2.5"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="9" y1="9" x2="15" y2="9"></line>
                    <line x1="9" y1="13" x2="15" y2="13"></line>
                    <line x1="9" y1="17" x2="13" y2="17"></line>
                  </svg>
                </div>
                <div
                  style={{ fontWeight: "700", fontSize: "14.5px", color: "var(--text-light)", marginBottom: "6px" }}
                  data-i18n="wiz.plainProject"
                >Prostý projekt</div>
                <div
                  style={{ fontSize: "11.5px", color: "var(--text-muted)", lineHeight: "1.4" }}
                  data-i18n="wiz.plainProjectDesc"
                >Vytvoří čistý projekt bez okamžité konfigurace hardware.</div>
              </div>
            </div>
          </div>
          {/* Step 2: Name & Details Form (shown only if Plain Project is selected) */}
          <div
            id="new-project-details-form"
            style={{ display: "none", flexDirection: "column", gap: "12px", animation: "fadeIn 0.3s ease" }}
          >
            <div className="form-group">
              <div className="label-with-tooltip">
                <label htmlFor="new-project-name" data-i18n="lbl.projectNameCz">Název projektu</label>
                {' '}
                <span className="info-tooltip-trigger" data-i18n-tooltip="tip.projectName">ⓘ</span>
              </div>
              <input
                type="text"
                id="new-project-name"
                placeholder="např. Můj robotický workbench"
                data-i18n-ph="ph.projectName"
              />
            </div>
            <div className="form-group">
              <div className="label-with-tooltip">
                <label htmlFor="new-project-slug" data-i18n="lbl.slug">Identifikátor (Slug)</label>
                {' '}
                <span className="info-tooltip-trigger" data-i18n-tooltip="tip.projectSlug">ⓘ</span>
              </div>
              <input type="text" id="new-project-slug" placeholder="automaticky-generovany-slug" />
              <div className="slug-status" id="new-project-slug-status" role="status" aria-live="polite"></div>
            </div>
            <div className="form-group">
              <div className="label-with-tooltip">
                <label htmlFor="new-project-parent-dir" data-i18n="lbl.parentDir">Rodičovský adresář (Nepovinné)</label>
                {' '}
                <span className="info-tooltip-trigger" data-i18n-tooltip="tip.parentDir">ⓘ</span>
              </div>
              <input
                type="text"
                id="new-project-parent-dir"
                placeholder="např. /home/verlyba/OrchidayProjects"
                data-i18n-ph="ph.parentDir"
              />
            </div>
            <div className="form-group">
              <label htmlFor="new-project-scene-desc" data-i18n="lbl.sceneDesc">
                Popis scény{' '}
                <span className="required-mark">*</span>
              </label>
              <div className="cfg-card-desc" style={{ marginBottom: "6px" }} data-i18n="hint.sceneDesc">
                Popište fyzické uspořádání pracoviště: kde jsou kamery, co je na stole, jaké je pozadí a osvětlení. Tento popis dostane jak CEO plánovač, tak VLM inspektor jako trvalý kontext ke každému promptu.
              </div>
              <textarea
                id="new-project-scene-desc"
                rows={4}
                placeholder="např. Robotické rameno SO-101 je upevněno na hraně dřevěného stolu. Kamera 'overhead_cam' snímá stůl shora, kamera 'wrist_cam' je na zápěstí robota. Na stole je bílá miska vlevo a modrá krabice vpravo."
                data-i18n-ph="ph.sceneDesc"
              ></textarea>
            </div>
          </div>
        </div>
        {/* Modal Footer (hidden in selection step, shown in details form step) */}
        <div className="modal-footer" id="new-project-modal-footer" style={{ display: "none" }}>
          <button
            className="btn btn-xs btn-secondary"
            onClick={(event: any) => { App.showNewProjectModeSelection() }}
            data-i18n="btn.back"
          >Zpět</button>
          {' '}
          <button
            className="btn btn-xs btn-primary"
            id="new-project-submit-btn"
            onClick={(event: any) => { App.createProject() }}
            data-i18n="btn.createProject"
          >Vytvořit projekt</button>
        </div>
      </div>
    </div>
  );
}
