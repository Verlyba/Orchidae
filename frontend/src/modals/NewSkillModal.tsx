/** #modal-new-skill — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function NewSkillModal() {
  return (
    <div
      className="modal-overlay"
      id="modal-new-skill"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-new-skill-title"
      data-static=""
    >
      <div className="modal-container" style={{ maxWidth: "640px", width: "100%" }}>
        <div className="modal-header">
          <h4 id="modal-new-skill-title" data-i18n="h4.modal.newSkill">Vytvořit novou Dovednost nebo Krok</h4>
          <button
            className="modal-close-btn"
            onClick={(event: any) => { App.closeModal('modal-new-skill') }}
          >✕</button>
        </div>
        {/* STEP 1: Select Type */}
        <div id="skill-wizard-step1" style={{ display: "block", padding: "10px 0" }}>
          <label
            style={{ marginBottom: "16px", display: "block", fontSize: "14px", fontWeight: "500", color: "var(--text-light)" }}
            data-i18n="lbl.selectItemType"
          >Vyberte typ přidávané položky:</label>
          <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
            {/* Card 1: Dovednost */}
            <div
              id="skill-type-card-main"
              className="wizard-type-card type-main active"
              onClick={(event: any) => { App.selectSkillWizardType('main') }}
            >
              <div className="wizard-card-icon-wrapper">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--cyan)"
                  strokeWidth="2.5"
                  style={{ width: "20px", height: "20px" }}
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <circle cx="12" cy="12" r="4"></circle>
                </svg>
              </div>
              <div
                className="wizard-card-title"
                style={{ fontWeight: "700", fontSize: "15px", color: "var(--cyan)", marginBottom: "8px", letterSpacing: "0.3px" }}
                data-i18n="wiz.mainSkillTitle"
              >Hlavní dovednost (cíl)</div>
              <div
                className="wizard-card-desc"
                style={{ fontSize: "12.5px", color: "var(--text-muted)", lineHeight: "1.4", padding: "0 10px" }}
                data-i18n="wiz.mainSkillDesc"
              >Cíl plánovaný LLM modelem (např. Uklidit stůl). Obsahuje dílčí kroky.</div>
            </div>
            {/* Card 2: Motoric Step */}
            <div
              id="skill-type-card-step"
              className="wizard-type-card type-step"
              onClick={(event: any) => { App.selectSkillWizardType('step') }}
            >
              <div className="wizard-card-icon-wrapper">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--yellow)"
                  strokeWidth="2.5"
                  style={{ width: "20px", height: "20px" }}
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
              </div>
              <div
                className="wizard-card-title"
                style={{ fontWeight: "700", fontSize: "15px", color: "var(--yellow)", marginBottom: "8px", letterSpacing: "0.3px" }}
                data-i18n="wiz.stepTitle"
              >Motorický krok (akce)</div>
              <div
                className="wizard-card-desc"
                style={{ fontSize: "12.5px", color: "var(--text-muted)", lineHeight: "1.4", padding: "0 10px" }}
                data-i18n="wiz.stepDesc"
              >
                Fyzická akce trénovaná z demonstrací (např. Uchopit kostku). Patří pod cíl.
              </div>
            </div>
          </div>
          <div className="modal-footer modal-footer-flush">
            <button
              className="btn btn-xs btn-secondary"
              onClick={(event: any) => { App.closeModal('modal-new-skill') }}
              data-i18n="btn.cancel"
            >Storno</button>
            {' '}
            <button
              className="btn btn-xs btn-primary"
              onClick={(event: any) => { App.nextSkillWizardStep() }}
              data-i18n="btn.continue"
            >Pokračovat</button>
          </div>
        </div>
        {/* STEP 2: Details Form */}
        <div id="skill-wizard-step2" style={{ display: "none", padding: "10px 0" }}>
          <div
            className="form-group"
            id="new-skill-parent-group"
            style={{ display: "none", marginBottom: "16px" }}
          >
            <div className="label-with-tooltip">
              <label htmlFor="new-skill-parent" data-i18n="lbl.parentSkill">Nadřazená dovednost (Hlavní cíl)</label>
              {' '}
              <span className="info-tooltip-trigger" data-i18n-tooltip="tip.skillParent">ⓘ</span>
            </div>
            <select id="new-skill-parent" style={{ width: "100%" }}>{/* Populated dynamically */}</select>
          </div>
          <div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>
            <div className="form-group" style={{ flex: "1" }}>
              <div className="label-with-tooltip">
                <label htmlFor="new-skill-name" id="new-skill-name-label" data-i18n="lbl.name">Název</label>
                {' '}
                <span className="info-tooltip-trigger" data-i18n-tooltip="tip.skillName">ⓘ</span>
              </div>
              <input
                type="text"
                id="new-skill-name"
                placeholder="např. Uklidit stůl"
                style={{ width: "100%" }}
                data-i18n-ph="ph.skillName"
              />
            </div>
            <div className="form-group" style={{ flex: "1" }}>
              <div className="label-with-tooltip">
                <label htmlFor="new-skill-slug" data-i18n="lbl.slug">Identifikátor (Slug)</label>
                {' '}
                <span className="info-tooltip-trigger" data-i18n-tooltip="tip.skillSlug">ⓘ</span>
              </div>
              <input
                type="text"
                id="new-skill-slug"
                placeholder="např. uklidit_stul"
                style={{ width: "100%" }}
                data-i18n-ph="ph.skillSlug"
              />
            </div>
          </div>
          {/* What the identifier becomes: the LeRobot repo_id the recorder and the trainer will use, or the reason it cannot be used at all. */}
          <div className="slug-status" id="new-skill-slug-status" role="status" aria-live="polite"></div>
          <div className="form-group" style={{ marginBottom: "16px" }}>
            <label htmlFor="new-skill-desc" id="new-skill-desc-label" data-i18n="lbl.plannerDesc">Bližší popis a instrukce pro plánovač</label>
            {' '}
            <span className="required-mark">*</span>
            <div
              id="new-skill-desc-hint"
              style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px", lineHeight: "1.4" }}
            ></div>
            <textarea
              id="new-skill-desc"
              rows={5}
              placeholder="Zde zadejte podrobný popis..."
              style={{ width: "100%" }}
            ></textarea>
          </div>
          <div
            id="new-skill-warning-box"
            style={{ display: "none", background: "rgba(220, 220, 170, 0.04)", border: "1px solid rgba(220, 220, 170, 0.2)", padding: "10px 14px", color: "var(--yellow)", fontSize: "13px", lineHeight: "1.45", marginBottom: "16px" }}
          >
            <strong>Pozor:</strong>
            {' '}Změna nadřazené dovednosti u kroku s nahranými daty vyžaduje ruční přesunutí datové složky na disku do nového umístění.
          </div>
          <div className="modal-footer modal-footer-flush">
            <button
              className="btn btn-xs btn-secondary"
              id="new-skill-back-btn"
              onClick={(event: any) => { App.prevSkillWizardStep() }}
              data-i18n="btn.back"
            >Zpět</button>
            {' '}
            <button
              className="btn btn-xs btn-primary"
              id="new-skill-submit-btn"
              onClick={(event: any) => { App.submitSkillWizard() }}
              data-i18n="btn.create"
            >Vytvořit</button>
          </div>
        </div>
      </div>
    </div>
  );
}
