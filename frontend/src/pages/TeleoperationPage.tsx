/** #page-teleoperation — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';
import { initiallyDisabled } from '../util/initiallyDisabled';

export function TeleoperationPage() {
  return (
    <div id="page-teleoperation" className="editor-area">
      <div className="page-header-row">
        <h2 data-i18n="page.teleoperation.title">Manuální Řízení & Teleoperace</h2>
      </div>
      <div
        className="setup-block"
        style={{ flex: "1", display: "flex", flexDirection: "column", gap: "16px", minHeight: "0" }}
      >
        <div
          className="block-head-row"
          style={{ marginBottom: "0", paddingBottom: "10px", borderBottom: "1px solid var(--border-dark)" }}
        >
          <h3
            style={{ margin: "0", border: "none", padding: "0", display: "flex", alignItems: "center", gap: "8px" }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 15V9a4 4 0 0 0-8 0v6M6 15V9a4 4 0 0 1 8 0v6"></path>
              <circle cx="12" cy="18" r="3"></circle>
            </svg>
            {' '}
            <span data-i18n="blk.tele.control">Ovládání a telemetrie teleoperace</span>
          </h3>
        </div>
        <div className="teleop-unified-grid">
          {/* Column 1: everything about the session — what hardware and calibration it will use, its runtime settings, and the live telemetry it produces. Stacks from the top; the arm visualization next to it is what absorbs spare height. */}
          <div className="teleop-col" id="teleop-session-col">
            {/* Active hardware, mirrored from the Setup > Connect tab */}
            <section className="teleop-sub">
              <h4 className="teleop-sub-title" data-i18n="h4.tele.activeHw">Aktivní Konfigurace Hardware</h4>
              <div className="teleop-hw-grid">
                <div>
                  <span data-i18n="lbl.robotShort">Robot</span>
                  :{' '}
                  <strong id="tele-info-robot-type">-</strong>
                </div>
                <div>
                  <span data-i18n="lbl.leaderPortShort">Leader port</span>
                  :{' '}
                  <strong id="tele-info-leader-port">-</strong>
                </div>
                <div>
                  <span data-i18n="lbl.leaderTypeShort">Leader typ</span>
                  :{' '}
                  <strong id="tele-info-leader-type">-</strong>
                </div>
                <div>
                  <span data-i18n="lbl.followerPortShort">Follower port</span>
                  :{' '}
                  <strong id="tele-info-follower-port">-</strong>
                </div>
              </div>
            </section>
            {/* Which calibration file each arm will actually run with. "default" here means LeRobot has no calibration bound for that arm and generic ranges are used — worth seeing BEFORE starting teleoperation, not after. */}
            <section className="teleop-sub">
              <h4 className="teleop-sub-title">
                <span data-i18n="h4.tele.calibration">Kalibrace použitá pro tuto relaci</span>
                {' '}
                <span className="info-tooltip-trigger" data-i18n-tooltip="tip.teleCalibration">ⓘ</span>
              </h4>
              <div className="tele-cal-list">
                <div className="tele-cal-row" id="tele-cal-row-leader">
                  <span className="tele-cal-dot"></span>
                  {' '}
                  <span className="tele-cal-side" data-i18n="lbl.leaderArm">Leader (řídicí)</span>
                  {' '}
                  <span className="tele-cal-device" id="tele-cal-device-leader">-</span>
                  {' '}
                  <span className="tele-cal-file" id="tele-cal-file-leader">-</span>
                </div>
                <div className="tele-cal-row" id="tele-cal-row-follower">
                  <span className="tele-cal-dot"></span>
                  {' '}
                  <span className="tele-cal-side" data-i18n="lbl.followerArm">Follower (vykonávací)</span>
                  {' '}
                  <span className="tele-cal-device" id="tele-cal-device-follower">-</span>
                  {' '}
                  <span className="tele-cal-file" id="tele-cal-file-follower">-</span>
                </div>
              </div>
            </section>
            {/* Teleop runtime settings */}
            <section className="teleop-sub">
              <h4 className="teleop-sub-title" data-i18n="h4.tele.session">Nastavení relace teleoperace</h4>
              <div className="teleop-field-row">
                <div className="form-group" style={{ margin: "0" }}>
                  <div className="label-with-tooltip" style={{ marginBottom: "4px" }}>
                    <label htmlFor="tele-fps" className="teleop-field-label" data-i18n="lbl.fps">Snímková frekvence (FPS)</label>
                    {' '}
                    <span className="info-tooltip-trigger" data-i18n-tooltip="tip.teleFps">ⓘ</span>
                  </div>
                  <input
                    type="number"
                    id="tele-fps"
                    defaultValue="30"
                    min="1"
                    max="240"
                    className="form-control teleop-input"
                  />
                </div>
                <div className="form-group" style={{ margin: "0" }}>
                  <div className="label-with-tooltip" style={{ marginBottom: "4px" }}>
                    <label htmlFor="tele-time-s" className="teleop-field-label" data-i18n="lbl.sessionDuration">Doba trvání relace (s)</label>
                    {' '}
                    <span className="info-tooltip-trigger" data-i18n-tooltip="tip.teleDuration">ⓘ</span>
                  </div>
                  <div className="teleop-input-with-btn">
                    <input
                      type="number"
                      id="tele-time-s"
                      placeholder="Nekonečno"
                      min="1"
                      className="form-control teleop-input"
                      data-i18n-ph="ph.infinity"
                    />
                    {' '}
                    <button
                      type="button"
                      className="btn btn-xs btn-secondary btn-icon"
                      onClick={(event: any) => { (document.getElementById('tele-time-s') as HTMLInputElement).value='' }}
                      data-i18n-title="tip.teleInfinite"
                      title="Vymaže dobu trvání — relace poběží, dokud ji nezastavíte"
                    >∞</button>
                  </div>
                </div>
              </div>
              <div className="teleop-check-row" id="display-visual-group">
                <input type="checkbox" id="tele-display-data" defaultChecked={true} />
                {' '}
                <label htmlFor="tele-display-data" data-i18n="lbl.showRerun">Zobrazovat Rerun vizualizaci</label>
                {' '}
                <span className="info-tooltip-trigger" data-i18n-tooltip="tip.teleShowRerun">ⓘ</span>
              </div>
            </section>
            {/* Live telemetry */}
            <section className="teleop-sub">
              <h4 className="teleop-sub-title">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
                {' '}
                <span data-i18n="blk.tele.telemetry">Telemetrie motorů a kloubů</span>
              </h4>
              <div className="teleop-stat-row">
                <div className="teleop-stat">
                  <span
                    className="teleop-stat-label"
                    data-i18n="hint.settleStatus"
                    title="Settle Status (Uklidnění)"
                  >Settle Status</span>
                  {' '}
                  <span id="tele-infer-settle-frames" className="teleop-stat-value is-cyan">0/5</span>
                </div>
                <div className="teleop-stat">
                  <span className="teleop-stat-label" data-i18n="hint.gripperLoadShort">Proud gripperu</span>
                  {' '}
                  <span id="tele-infer-gripper-load" className="teleop-stat-value is-yellow">0.0 mA</span>
                </div>
                <div className="teleop-stat">
                  <span className="teleop-stat-label" data-i18n="hint.maxDeltaShort">Max odchylka</span>
                  {' '}
                  <span id="tele-infer-max-delta" className="teleop-stat-value">0.0000 rad</span>
                </div>
              </div>
              <div className="teleop-joints-wrap">
                <div className="teleop-joints-caption" data-i18n="hint.jointAngles">Úhly kloubů (Aktuální vs Cíl)</div>
                <div id="tele-joints-grid" className="teleop-joints-grid">
                  <div className="joint-telemetry-box">
                    <div className="joint-telemetry-name">J1</div>
                    <div id="tele-joint-val-0" className="joint-telemetry-val">0.0000</div>
                    <div id="tele-joint-tgt-0" className="joint-telemetry-tgt">0.0000</div>
                  </div>
                  <div className="joint-telemetry-box">
                    <div className="joint-telemetry-name">J2</div>
                    <div id="tele-joint-val-1" className="joint-telemetry-val">0.0000</div>
                    <div id="tele-joint-tgt-1" className="joint-telemetry-tgt">0.0000</div>
                  </div>
                  <div className="joint-telemetry-box">
                    <div className="joint-telemetry-name">J3</div>
                    <div id="tele-joint-val-2" className="joint-telemetry-val">0.0000</div>
                    <div id="tele-joint-tgt-2" className="joint-telemetry-tgt">0.0000</div>
                  </div>
                  <div className="joint-telemetry-box">
                    <div className="joint-telemetry-name">J4</div>
                    <div id="tele-joint-val-3" className="joint-telemetry-val">0.0000</div>
                    <div id="tele-joint-tgt-3" className="joint-telemetry-tgt">0.0000</div>
                  </div>
                  <div className="joint-telemetry-box">
                    <div className="joint-telemetry-name">J5</div>
                    <div id="tele-joint-val-4" className="joint-telemetry-val">0.0000</div>
                    <div id="tele-joint-tgt-4" className="joint-telemetry-tgt">0.0000</div>
                  </div>
                  <div className="joint-telemetry-box">
                    <div className="joint-telemetry-name">J6 (Grip)</div>
                    <div id="tele-joint-val-5" className="joint-telemetry-val">0.0000</div>
                    <div id="tele-joint-tgt-5" className="joint-telemetry-tgt">0.0000</div>
                  </div>
                </div>
              </div>
            </section>
          </div>
          {/* Column 2: Arm Visualization — the one element that scales with available height, so it takes the spare space. */}
          <div id="arm-visual-block" className="teleop-col">
            <div className="block-head-row teleop-sub-title-row">
              <h4 className="teleop-sub-title">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 15V9a4 4 0 0 0-8 0v6M6 15V9a4 4 0 0 1 8 0v6"></path>
                  <circle cx="12" cy="18" r="3"></circle>
                </svg>
                {' '}
                <span id="arm-visual-title" data-i18n="blk.tele.armVisual">Vizualizace ramen</span>
                {' '}
                <span className="info-tooltip-trigger" data-i18n-tooltip="tip.armVisual">ⓘ</span>
              </h4>
              <button
                className="btn btn-xs btn-secondary btn-icon"
                id="arm-visual-toggle-btn"
                onClick={(event: any) => { App.toggleArmVisualPanel() }}
                data-i18n-title="tip.toggleArmVisual"
                title="Skrýt vizualizaci ramen"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
              </button>
            </div>
            <div className="setup-block-content" id="arm-visual-content-wrap">
              <div id="arm-visual-empty" className="empty-state" style={{ display: "none" }}>
                <div className="empty-state-text" data-i18n="hint.armVisualNoRobot">
                  Otevřete projekt s nakonfigurovaným robotem, aby se zobrazila vizualizace ramen.
                </div>
              </div>
              <div id="arm-visual-grid" className="arm-visual-grid">
                <div className="arm-visual-legend" id="arm-visual-legend"></div>
                <div className="arm-visual-cols">
                  <div className="arm-visual-col">
                    <div className="arm-visual-label" data-i18n="lbl.leaderArm">Leader (řídicí)</div>
                    <div className="arm-visual-svg-wrap" id="arm-visual-leader-wrap"></div>
                    <div className="arm-visual-meta" id="arm-visual-leader-meta"></div>
                  </div>
                  <div className="arm-visual-col">
                    <div className="arm-visual-label" data-i18n="lbl.followerArm">Follower (vykonávací)</div>
                    <div className="arm-visual-svg-wrap" id="arm-visual-follower-wrap"></div>
                    <div className="arm-visual-meta" id="arm-visual-follower-meta"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Footer Action Bar */}
        <div
          className="block-actions"
          style={{ marginTop: "4px", paddingTop: "12px", borderTop: "1px solid var(--border-dark)", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "12px" }}
        >
          <span
            id="tele-running-badge"
            className="running-badge"
            style={{ display: "none" }}
            role="status"
          >● TELEOP AKTIVNÍ</span>
          {' '}
          <button
            className="btn btn-xs btn-primary"
            id="btn-start-teleop"
            ref={initiallyDisabled}
            onClick={(event: any) => { App.startTeleop() }}
            data-i18n="btn.startTeleop"
          >Spustit Teleop</button>
          {' '}
          <button
            className="btn btn-xs btn-danger"
            id="btn-stop-teleop"
            onClick={(event: any) => { App.stopTeleop() }}
            ref={initiallyDisabled}
            title="Teleoperace neběží"
            data-i18n="btn.stopTeleop"
          >Zastavit Teleop</button>
        </div>
      </div>
    </div>
  );
}
