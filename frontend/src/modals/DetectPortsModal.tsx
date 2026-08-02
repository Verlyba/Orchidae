/** #modal-detect-ports — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function DetectPortsModal() {
  return (
    <div
      className="modal-overlay"
      id="modal-detect-ports"
      role="dialog"
      aria-modal="true"
      aria-label="Průvodce detekcí portů"
      data-static=""
    >
      <div className="modal-container" style={{ maxWidth: "550px", width: "100%" }}>
        <div className="modal-header">
          <h4 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--cyan)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
            {' '}Průvodce detekcí portů
          </h4>
          <button
            className="modal-close-btn"
            onClick={(event: any) => { App.closeModal('modal-detect-ports') }}
          >✕</button>
        </div>
        <div className="modal-body">
          {/* Progressive Steps indicator */}
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", padding: "0 10px" }}
          >
            <div
              id="detect-step-indicator-leader"
              style={{ fontSize: "12.5px", fontWeight: "bold", color: "var(--cyan)", display: "flex", alignItems: "center", gap: "6px", transition: "var(--transition)" }}
            >
              <span
                id="detect-step-badge-leader"
                style={{ background: "rgba(0, 188, 212, 0.15)", border: "1px solid var(--cyan)", width: "20px", height: "20px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >1</span>
              {' '}
              <span data-i18n="wiz.leaderArm">Leader Rameno</span>
            </div>
            <div style={{ flexGrow: "1", borderBottom: "1px dashed var(--border)", margin: "0 12px" }}></div>
            <div
              id="detect-step-indicator-follower"
              style={{ fontSize: "12.5px", fontWeight: "bold", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px", transition: "var(--transition)" }}
            >
              <span
                id="detect-step-badge-follower"
                style={{ background: "rgba(255, 255, 255, 0.05)", border: "1px solid var(--border)", width: "20px", height: "20px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >2</span>
              {' '}
              <span data-i18n="wiz.followerArm">Follower Rameno</span>
            </div>
          </div>
          {/* Leader Arm Section */}
          <div id="detect-leader-section" className="detect-arm-section">
            {/* Step 1: Scan */}
            <div id="detect-leader-step-1" className="detect-sub-step">
              <p
                style={{ fontSize: "13.5px", lineHeight: "1.5", color: "var(--text-light)", marginBottom: "16px" }}
                data-i18n-html="wiz.leaderScanInstr"
              >
                Ujistěte se, že{' '}
                <strong>Leader (Řídicí)</strong>
                {' '}rameno je připojené k počítači přes USB kabel a zapnuté. Jakmile je připraveno, klikněte na tlačítko níže pro uložení výchozího stavu.
              </p>
              <div style={{ display: "flex", justifyContent: "center", margin: "20px 0" }}>
                <button
                  className="btn btn-primary"
                  id="btn-detect-leader-scan"
                  onClick={(event: any) => { App.autoDetectStart('leader') }}
                  data-i18n="btn.scanDevices"
                >Skenovat připojená zařízení</button>
              </div>
            </div>
            {/* Step 2: Unplug */}
            <div id="detect-leader-step-2" className="detect-sub-step" style={{ display: "none" }}>
              <div
                style={{ background: "rgba(233, 30, 99, 0.05)", border: "1px solid rgba(233, 30, 99, 0.2)", padding: "12px", marginBottom: "16px" }}
              >
                <p
                  style={{ fontSize: "13.5px", lineHeight: "1.5", color: "var(--text-light)", margin: "0", display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2">
                    <path
                      d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                    ></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  {' '}
                  <span data-i18n-html="wiz.unplugLeader">
                    Nyní{' '}
                    <strong>ODPOJTE</strong>
                    {' '}USB kabel Leader ramene od počítače.
                  </span>
                </p>
              </div>
              <p
                style={{ fontSize: "13.5px", lineHeight: "1.5", color: "var(--text-muted)", marginBottom: "16px" }}
                data-i18n="wiz.detectExplain"
              >
                Systém detekuje, který port zmizel, a tím automaticky identifikuje správné rozhraní. Po odpojení klikněte na tlačítko níže.
              </p>
              <div style={{ display: "flex", justifyContent: "center", margin: "20px 0" }}>
                <button
                  className="btn btn-danger"
                  id="btn-detect-leader-confirm"
                  onClick={(event: any) => { App.autoDetectConfirmUnplug('leader') }}
                  data-i18n="btn.confirmUnplugCable"
                >Potvrdit odpojení kabelu</button>
              </div>
            </div>
            {/* Step 3: Success */}
            <div id="detect-leader-step-3" className="detect-sub-step" style={{ display: "none" }}>
              <div
                style={{ background: "rgba(76, 175, 80, 0.05)", border: "1px solid rgba(76, 175, 80, 0.2)", padding: "16px", textAlign: "center", marginBottom: "20px" }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--green)"
                  strokeWidth="2"
                  style={{ marginBottom: "8px", display: "inline-block" }}
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                <h5
                  style={{ color: "var(--green)", margin: "0 0 8px 0", fontSize: "14.5px", fontWeight: "bold" }}
                  data-i18n="wiz.leaderDetected"
                >Leader rameno úspěšně detekováno!</h5>
                <p
                  style={{ fontSize: "13.5px", color: "var(--text-light)", margin: "0" }}
                  id="detect-leader-detected-text"
                >
                  Port:{' '}
                  <strong>-</strong>
                  {' '}(ID: -)
                </p>
              </div>
              <p
                style={{ fontSize: "13.5px", lineHeight: "1.5", color: "var(--text-muted)", marginBottom: "16px" }}
                data-i18n="wiz.leaderReconnect"
              >
                Můžete Leader rameno opět zapojit a pokračovat k detekci Follower ramene.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button
                  className="btn btn-xs btn-secondary"
                  onClick={(event: any) => { App.autoDetectGoToNextStep() }}
                  data-i18n="btn.toFollower"
                >Pokračovat k detekci Follower</button>
              </div>
            </div>
          </div>
          {/* Follower Arm Section */}
          <div id="detect-follower-section" className="detect-arm-section" style={{ display: "none" }}>
            {/* Step 1: Scan */}
            <div id="detect-follower-step-1" className="detect-sub-step">
              <p
                style={{ fontSize: "13.5px", lineHeight: "1.5", color: "var(--text-light)", marginBottom: "16px" }}
                data-i18n-html="wiz.followerScanInstr"
              >
                Ujistěte se, že{' '}
                <strong>Follower (Vykonávací)</strong>
                {' '}rameno je připojené k počítači přes USB kabel a zapnuté. Jakmile je připraveno, klikněte na tlačítko níže pro uložení stavu.
              </p>
              <div style={{ display: "flex", justifyContent: "center", margin: "20px 0" }}>
                <button
                  className="btn btn-primary"
                  id="btn-detect-follower-scan"
                  onClick={(event: any) => { App.autoDetectStart('follower') }}
                  data-i18n="btn.scanDevices"
                >Skenovat připojená zařízení</button>
              </div>
            </div>
            {/* Step 2: Unplug */}
            <div id="detect-follower-step-2" className="detect-sub-step" style={{ display: "none" }}>
              <div
                style={{ background: "rgba(233, 30, 99, 0.05)", border: "1px solid rgba(233, 30, 99, 0.2)", padding: "12px", marginBottom: "16px" }}
              >
                <p
                  style={{ fontSize: "13.5px", lineHeight: "1.5", color: "var(--text-light)", margin: "0", display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2">
                    <path
                      d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                    ></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  {' '}
                  <span data-i18n-html="wiz.unplugFollower">
                    Nyní{' '}
                    <strong>ODPOJTE</strong>
                    {' '}USB kabel Follower ramene od počítače.
                  </span>
                </p>
              </div>
              <p
                style={{ fontSize: "13.5px", lineHeight: "1.5", color: "var(--text-muted)", marginBottom: "16px" }}
                data-i18n="wiz.detectExplain"
              >
                Systém detekuje, který port zmizel, a tím automaticky identifikuje správné rozhraní. Po odpojení klikněte na tlačítko níže.
              </p>
              <div style={{ display: "flex", justifyContent: "center", margin: "20px 0" }}>
                <button
                  className="btn btn-danger"
                  id="btn-detect-follower-confirm"
                  onClick={(event: any) => { App.autoDetectConfirmUnplug('follower') }}
                  data-i18n="btn.confirmUnplugCable"
                >Potvrdit odpojení kabelu</button>
              </div>
            </div>
            {/* Step 3: Success */}
            <div id="detect-follower-step-3" className="detect-sub-step" style={{ display: "none" }}>
              <div
                style={{ background: "rgba(76, 175, 80, 0.05)", border: "1px solid rgba(76, 175, 80, 0.2)", padding: "16px", textAlign: "center", marginBottom: "20px" }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--green)"
                  strokeWidth="2"
                  style={{ marginBottom: "8px", display: "inline-block" }}
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                <h5
                  style={{ color: "var(--green)", margin: "0 0 8px 0", fontSize: "14.5px", fontWeight: "bold" }}
                  data-i18n="wiz.followerDetected"
                >Follower rameno úspěšně detekováno!</h5>
                <p
                  style={{ fontSize: "13.5px", color: "var(--text-light)", margin: "0" }}
                  id="detect-follower-detected-text"
                >
                  Port:{' '}
                  <strong>-</strong>
                  {' '}(ID: -)
                </p>
              </div>
              <p
                style={{ fontSize: "13.5px", lineHeight: "1.5", color: "var(--text-muted)", marginBottom: "16px" }}
                data-i18n="wiz.followerReconnect"
              >Můžete Follower rameno opět zapojit. Detekce portů je kompletní!</p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button
                  className="btn btn-xs btn-primary"
                  onClick={(event: any) => { App.closeModal('modal-detect-ports') }}
                  data-i18n="btn.finishClose"
                >Dokončit a zavřít</button>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer" style={{ justifyContent: "space-between" }}>
          <button
            className="btn btn-xs btn-secondary"
            id="detect-ports-back-btn"
            style={{ visibility: "hidden" }}
            onClick={(event: any) => { App.autoDetectPrevStep() }}
            data-i18n="btn.back"
          >Zpět</button>
          {' '}
          <button
            className="btn btn-xs btn-secondary"
            onClick={(event: any) => { App.closeModal('modal-detect-ports') }}
            data-i18n="btn.cancelClose"
          >Storno / Zavřít</button>
        </div>
      </div>
    </div>
  );
}
