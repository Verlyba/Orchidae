/** #modal-calibration-files — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function CalibrationFilesModal() {
  return (
    <div
      className="modal-overlay"
      id="modal-calibration-files"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-cal-files-title"
    >
      <div className="modal-container" style={{ maxWidth: "750px", width: "100%" }}>
        <div className="modal-header">
          <h4 id="modal-cal-files-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span data-i18n="h4.modal.calFiles">Správa a výběr kalibračních souborů</span>
          </h4>
          <button
            className="modal-close-btn"
            onClick={(event: any) => { App.closeModal('modal-calibration-files') }}
          >✕</button>
        </div>
        <div className="modal-body">
          <p className="cfg-card-desc" style={{ marginBottom: "12px" }}>
            Přehled všech uložených kalibrací (v projektu i vyrovnávací paměti LeRobot). Můžete aktivovat dřívější funkční kalibraci nebo smazat poškozené/chybové soubory.
          </p>
          <div id="cal-files-list" className="cal-files-scroll">
            {/* Seznam kalibračních souborů renderovaný v App.renderCalibrationFilesList */}
          </div>
        </div>
        <div className="modal-footer" style={{ justifyContent: "space-between" }}>
          <button
            className="btn btn-xs btn-secondary"
            onClick={(event: any) => { App.manualRefreshCalibration() }}
          >Načíst znovu</button>
          {' '}
          <button
            className="btn btn-xs btn-secondary"
            onClick={(event: any) => { App.closeModal('modal-calibration-files') }}
            data-i18n="btn.close"
          >Zavřít</button>
        </div>
      </div>
    </div>
  );
}
