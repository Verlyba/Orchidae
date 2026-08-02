/** #modal-export-bundle — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';
import { initiallyDisabled } from '../util/initiallyDisabled';

export function ExportBundleModal() {
  return (
    <div
      className="modal-overlay"
      id="modal-export-bundle"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-export-title"
    >
      <div className="modal-container" style={{ maxWidth: "480px" }}>
        <div className="modal-header">
          <h4 id="modal-export-title" data-i18n="export.title">Exportovat přenositelný balíček</h4>
          <button
            className="modal-close-btn"
            onClick={(event: any) => { App.closeModal('modal-export-bundle') }}
          >✕</button>
        </div>
        <div className="modal-body">
          <div
            style={{ fontSize: "12.5px", color: "var(--text-muted)", lineHeight: "1.5" }}
            data-i18n="export.desc"
          >
            Balíček (.orchiday) obsahuje definici projektu a popisy dovedností. Volitelně přidejte nasbírané datasety a natrénované modely — balíček pak plně funguje po přenosu na jiné zařízení.
          </div>
          <label className="export-opt">
            <input type="checkbox" id="export-project" defaultChecked={true} ref={initiallyDisabled} />
            {' '}
            <span>
              <strong data-i18n="export.project">Projekt & dovednosti</strong>
              <small data-i18n="export.projectHint">definice, popisy, roboti, kamery, orchestrace (vždy)</small>
            </span>
          </label>
          {' '}
          <label className="export-opt">
            <input type="checkbox" id="export-datasets" defaultChecked={true} />
            {' '}
            <span>
              <strong data-i18n="export.datasets">Datasety</strong>
              <small data-i18n="export.datasetsHint">nasbírané epizody (pro trénink jinde)</small>
            </span>
          </label>
          {' '}
          <label className="export-opt">
            <input type="checkbox" id="export-models" />
            {' '}
            <span>
              <strong data-i18n="export.models">Natrénované modely</strong>
              <small data-i18n="export.modelsHint">checkpointy policy (velké soubory)</small>
            </span>
          </label>
        </div>
        <div className="modal-footer">
          <button
            className="btn btn-xs btn-secondary"
            onClick={(event: any) => { App.closeModal('modal-export-bundle') }}
            data-i18n="btn.cancel"
          >Storno</button>
          {' '}
          <button
            className="btn btn-xs btn-primary"
            onClick={(event: any) => { App.doExportBundle() }}
            data-i18n="btn.download"
          >Stáhnout balíček</button>
        </div>
      </div>
    </div>
  );
}
