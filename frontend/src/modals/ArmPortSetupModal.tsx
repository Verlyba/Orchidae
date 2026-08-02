/** #modal-arm-port-setup — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function ArmPortSetupModal() {
  return (
    <div id="modal-arm-port-setup" className="modal-overlay">
      <div className="modal-dialog modal-md">
        <div className="modal-header">
          <h3 id="modal-arm-port-title" data-i18n="lbl.selectArmPort">Nastavení portu ramene</h3>
          <button
            className="modal-close"
            onClick={(event: any) => { App.closeModal('modal-arm-port-setup') }}
          >×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label id="modal-arm-port-label">Vybrat sériový port</label>
            <select id="modal-arm-port-select" className="form-control"></select>
          </div>
          <div className="modal-actions-row">
            <button
              className="btn btn-secondary"
              onClick={(event: any) => { App.startArmAutoDetectInModal() }}
              data-i18n="btn.autoDetectPort"
            >Automatická detekce</button>
            {' '}
            <button
              className="btn btn-primary"
              onClick={(event: any) => { App.saveArmPortFromModal() }}
              data-i18n="btn.save"
            >Uložit port</button>
          </div>
          <div
            id="modal-arm-next-step"
            style={{ display: "none", marginTop: "15px", paddingTop: "15px", borderTop: "1px solid var(--border)" }}
          >
            <p
              id="modal-arm-next-msg"
              style={{ fontWeight: "700", color: "var(--cyan)", marginBottom: "10px" }}
            >Port byl úspěšně nastaven.</p>
            <button
              className="btn btn-primary"
              id="btn-modal-arm-continue"
              onClick={(event: any) => { App.continueArmPortSetupNext() }}
              data-i18n="btn.continueNextArm"
            >Pokračovat na druhé rameno</button>
          </div>
        </div>
      </div>
    </div>
  );
}
