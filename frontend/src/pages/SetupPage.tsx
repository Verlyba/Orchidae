/** #page-setup — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';
import { useConnect, usableCount, type DeviceType } from '../state/connect';
import { useCameras, type Camera } from '../state/cameras';

/** One row: what LeRobot calls this device, how it connects, and whether
 * this single-serial-port setup can actually drive it. Unsupported rows stay
 * visible (so the user can see LeRobot knows about the device) but are
 * disabled and say why, instead of being selectable and dying at spawn time. */
function DeviceTypeRow({ device, active }: { device: DeviceType; active: boolean }) {
  const cls = ['conn-type-row'];
  if (active) cls.push('is-active');
  if (!device.supported) cls.push('is-blocked');
  const title = device.supported
    ? App.t('tip.deviceSupported', { robot: device.robot_type, leader: device.leader_type || '–' })
    : App.t('tip.deviceBlocked', {
        robot: device.robot_type,
        conn: App.t('conn.' + device.connection),
        flag: device.port_flag,
      });
  return (
    <div
      className={cls.join(' ')}
      data-value={device.robot_type}
      role="button"
      tabIndex={0}
      title={title}
      onClick={() => App.selectRobot(device.robot_type)}
      onKeyDown={(e: any) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); App.selectRobot(device.robot_type); }
      }}
    >
      <div className="conn-type-main">
        <span className="conn-type-label">{device.label}</span>
        <span className="conn-type-conn">{App.t('conn.' + device.connection)}</span>
      </div>
    </div>
  );
}

/** The device catalogue LeRobot really registers, one row per device. Reads
 * from `state/connect`, published by `App.renderRobotTypeList()` once the
 * catalogue loads (`GET /api/hardware/device_types`) and again on every
 * selection change — nothing here derives `--robot.type` on its own. */
function DeviceTypeList() {
  const s = useConnect();
  if (!s.deviceTypes.length) {
    return <div className="conn-empty">{App.t('hint.deviceTypesUnavailable')}</div>;
  }
  return (
    <>
      {s.deviceTypes.map(d => (
        <DeviceTypeRow key={d.robot_type} device={d} active={d.robot_type === s.activeRobotType} />
      ))}
    </>
  );
}

/** "N / M drivable" next to the list title — same count the list itself is
 * filtered by, so the two cannot silently disagree. */
function DeviceTypeCount() {
  const s = useConnect();
  if (!s.deviceTypes.length) return <>-</>;
  return <>{App.t('lbl.nOfMDrivable', { n: usableCount(s), m: s.deviceTypes.length })}</>;
}

/** One camera the project has added — click selects it for the live preview
 * (`App.hwOnSelectConfiguredCamera`), the ✕ removes it. Passing `camera.id`
 * straight to the handlers (instead of building an `onclick="...('${id}')"`
 * string) is what closes the escaping gap the legacy `innerHTML` version had:
 * a camera id/role with `<`/`"` in it used to be able to break out of the
 * markup, now it's just a JS value. */
function CameraCard({ camera, active }: { camera: Camera; active: boolean }) {
  return (
    <div
      className="camera-card"
      style={{ cursor: 'pointer', padding: '10px 12px' }}
      onClick={() => App.hwOnSelectConfiguredCamera(camera.id)}
    >
      <div className="camera-card-head" style={{ marginBottom: 0 }}>
        <span className="camera-card-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
          {' '}
          <strong>{camera.id}</strong> <span className="camera-card-role">({camera.role})</span> — Source: {camera.source}
        </span>
        <div className="camera-card-actions">
          {active && (
            <span className="arm-status-badge" style={{ background: 'rgba(76, 175, 80, 0.15)', color: 'var(--green)', marginRight: 6 }}>
              {App.t('tag.active')}
            </span>
          )}
          <button
            className="btn btn-xs btn-danger btn-icon"
            onClick={(e: any) => { e.stopPropagation(); App.removeCamera(camera.id); }}
            title={App.t('btn.delete')}
          >✕</button>
        </div>
      </div>
    </div>
  );
}

/** The cameras the project has actually added, one card per camera. Reads
 * from `state/cameras`, published by `App.renderCameras()` on project load
 * and on every camera add/remove/start/stop. */
function CameraList() {
  const s = useCameras();
  if (!s.loaded) {
    return <div className="conn-empty">{App.t('hint.noCamerasYet')}</div>;
  }
  if (!s.cameras.length) {
    return <div className="conn-empty">{App.t('hint.noCamsConfigured')}</div>;
  }
  return (
    <>
      {s.cameras.map(c => (
        <CameraCard key={c.id} camera={c} active={s.activeCameraIds.includes(c.id)} />
      ))}
    </>
  );
}

/** Count next to "Nakonfigurované kamery:" — "-" before any project has
 * loaded (so it doesn't lie and claim zero before it actually knows),
 * the real count once `renderCameras()` has published a snapshot. */
function CameraCount() {
  const s = useCameras();
  return <>{s.loaded ? s.cameras.length : '-'}</>;
}

export function SetupPage() {
  return (
    <div id="page-setup" className="editor-area">
      <div className="page-header-row">
        <h2 data-i18n="page.setup.title">Setup — Připojení, kalibrace a modely</h2>
      </div>
      <div className="setup-wizard-tabs">
        <button
          className="setup-wizard-tab-btn active"
          data-tab="connect"
          onClick={(event: any) => { App.switchSetupTab('connect') }}
        >
          <span className="setup-wizard-tab-num">1</span>
          {' '}
          <span data-i18n="tab.setup.connect">Connect</span>
        </button>
        {' '}
        <button
          className="setup-wizard-tab-btn"
          data-tab="calibrate"
          onClick={(event: any) => { App.switchSetupTab('calibrate') }}
        >
          <span className="setup-wizard-tab-num">2</span>
          {' '}
          <span data-i18n="tab.setup.calibrate">Kalibrace</span>
        </button>
        {' '}
        <button
          className="setup-wizard-tab-btn"
          data-tab="models"
          onClick={(event: any) => { App.switchSetupTab('models') }}
        >
          <span className="setup-wizard-tab-num">3</span>
          {' '}
          <span data-i18n="tab.setup.models">Modely</span>
        </button>
      </div>
      <div className="setup-wizard-panel" data-tab-panel="connect">
        <div className="setup-section" style={{ gridTemplateColumns: "1fr" }}>
          <div className="setup-block" style={{ display: "flex", flexDirection: "column" }}>
            <div className="block-head-row">
              <h3 style={{ margin: "0" }}>
                <span data-i18n="blk.connect.title"></span>
              </h3>
            </div>
            <div className="setup-block-content">
              <div className="merge-cols merge-cols-3">
                {/* Column 1: what the robot IS, and which two ports its arms sit on. The device-type rows are rendered from /api/hardware/device_types so the names shown here are the ones LeRobot registers — deriving them a second time in the browser is exactly how they drifted before. */}
                <section className="merge-col">
                  <h4 className="merge-col-title" data-i18n="blk.hw.arms">Konfigurace robotických ramen</h4>
                  <div className="setup-block-content conn-col-body">
                    {/* hidden fields: the resolved types the rest of the app reads. Written only by onRobotTypeChange(). */}
                    <input type="hidden" id="tele-leader-type" defaultValue="so100_leader" />
                    {' '}
                    <input type="hidden" id="tele-follower-type" defaultValue="so100_follower" />
                    {' '}
                    <input type="hidden" id="tele-leader-port-custom" defaultValue="" />
                    {' '}
                    <input type="hidden" id="tele-leader-id" defaultValue="my_leader_arm" />
                    {' '}
                    <input type="hidden" id="tele-follower-port-custom" defaultValue="" />
                    {' '}
                    <input type="hidden" id="tele-follower-id" defaultValue="my_follower_arm" />
                    <select
                      id="robot-type-select"
                      onChange={(event: any) => { App.onRobotTypeChange() }}
                      style={{ display: "none" }}
                    ></select>
                    {/* Source of truth for the resolved arm ports — written by
                        ArmPortSetupModal's "Uložit port" (saveArmPortFromModal)
                        and by the auto-detect wizard, read by
                        updateArmStatusCards()/saveSettingsState()/startTeleop().
                        Not rendered directly: the modal is the actual UI. */}
                    <select
                      id="tele-leader-port"
                      onChange={(event: any) => { App.onTelePortChange('leader') }}
                      style={{ display: "none" }}
                    ><option value="">-- Vyberte port --</option></select>
                    {' '}
                    <select
                      id="tele-follower-port"
                      onChange={(event: any) => { App.onTelePortChange('follower') }}
                      style={{ display: "none" }}
                    ><option value="">-- Vyberte port --</option></select>
                    <div className="conn-sect conn-sect-grow">
                      <div className="teleop-sub-title-row">
                        <h4 className="teleop-sub-title" data-i18n="blk.hw.deviceType">Typ zařízení</h4>
                        <span className="cal-arm-state"><DeviceTypeCount /></span>
                      </div>
                      <div className="conn-type-list"><DeviceTypeList /></div>
                    </div>
                  </div>
                </section>
                {/* Column 2: Follower and Leader Connection Status Cards */}
                <section className="merge-col">
                  <h4 className="merge-col-title">Připojení ramen</h4>
                  <div className="setup-block-content conn-col-body">
                    {/* Leader Arm Setup Block */}
                    <div className="conn-arm-block" id="connect-card-leader">
                      {/* Before Setup: Simple large button */}
                      <button
                        className="btn btn-secondary conn-arm-setup-btn"
                        id="conn-btn-setup-leader"
                        onClick={(event: any) => { App.openArmPortSetupModal('leader') }}
                      >
                        <span className="conn-arm-setup-label">
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                          </svg>
                          {' '}
                          <span data-i18n="btn.setupLeaderArm">Nastavit Leader rameno (Řídicí)</span>
                        </span>
                        {' '}
                        <span className="btn-text conn-arm-setup-arrow">→</span>
                      </button>
                      {/* After Setup: Info details (hidden by default) */}
                      <div
                        className="conn-arm-details teleop-sub"
                        id="conn-details-leader"
                        style={{ display: "none", padding: "14px", gap: "10px" }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <strong style={{ fontSize: "14px" }}>Leader Rameno (Řídicí)</strong>
                          {' '}
                          <span className="arm-status-badge" id="conn-badge-leader">PŘIPOJENO</span>
                        </div>
                        <div style={{ fontSize: "13px", color: "var(--text-muted)", display: "flex", gap: "16px" }}>
                          <span>
                            Typ:{' '}
                            <strong id="conn-type-leader-name" style={{ color: "var(--text-white)" }}>-</strong>
                          </span>
                          {' '}
                          <span>
                            Port:{' '}
                            <strong id="conn-port-leader-name" style={{ color: "var(--text-white)" }}>-</strong>
                          </span>
                        </div>
                        <button
                          className="btn btn-xs btn-secondary"
                          onClick={(event: any) => { App.openArmPortSetupModal('leader') }}
                          style={{ alignSelf: "flex-start", marginTop: "4px" }}
                        >Změnit port</button>
                      </div>
                    </div>
                    {/* Follower Arm Setup Block */}
                    <div className="conn-arm-block" id="connect-card-follower" style={{ marginTop: "12px" }}>
                      {/* Before Setup: Simple large button */}
                      <button
                        className="btn btn-secondary conn-arm-setup-btn"
                        id="conn-btn-setup-follower"
                        onClick={(event: any) => { App.openArmPortSetupModal('follower') }}
                      >
                        <span className="conn-arm-setup-label">
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                          </svg>
                          {' '}
                          <span data-i18n="btn.setupFollowerArm">Nastavit Follower rameno (Vykonávací)</span>
                        </span>
                        {' '}
                        <span className="btn-text conn-arm-setup-arrow">→</span>
                      </button>
                      {/* After Setup: Info details (hidden by default) */}
                      <div
                        className="conn-arm-details teleop-sub"
                        id="conn-details-follower"
                        style={{ display: "none", padding: "14px", gap: "10px" }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <strong style={{ fontSize: "14px" }}>Follower Rameno (Vykonávací)</strong>
                          {' '}
                          <span className="arm-status-badge" id="conn-badge-follower">PŘIPOJENO</span>
                        </div>
                        <div style={{ fontSize: "13px", color: "var(--text-muted)", display: "flex", gap: "16px" }}>
                          <span>
                            Typ:{' '}
                            <strong id="conn-type-follower-name" style={{ color: "var(--text-white)" }}>-</strong>
                          </span>
                          {' '}
                          <span>
                            Port:{' '}
                            <strong id="conn-port-follower-name" style={{ color: "var(--text-white)" }}>-</strong>
                          </span>
                        </div>
                        <button
                          className="btn btn-xs btn-secondary"
                          onClick={(event: any) => { App.openArmPortSetupModal('follower') }}
                          style={{ alignSelf: "flex-start", marginTop: "4px" }}
                        >Změnit port</button>
                      </div>
                    </div>
                  </div>
                  <div className="block-actions">
                    <button
                      className="btn btn-xs btn-primary btn-save-hw-config"
                      onClick={(event: any) => { App.saveModelConfig() }}
                      data-i18n="btn.saveHw"
                    >Uložit nastavení hardwaru</button>
                  </div>
                </section>
                {/* Column 3: cameras — pick a video device, see it, add it to the project. */}
                <section className="merge-col">
                  <h4 className="merge-col-title" data-i18n="blk.hw.cameras">Nakonfigurované USB Kamery</h4>
                  <div className="setup-block-content conn-col-body conn-cam-body">
                    {/* Vlevo: Volba a náhled */}
                    <div className="conn-cam-side">
                      <div className="conn-cam-pick">
                        <div className="form-group">
                          <label data-i18n="lbl.selectVideoPort">Vybrat video port</label>
                          <select id="hw-camera-port-select" onChange={(event: any) => { App.hwOnCameraPortChange() }}>
                            <option value="" data-i18n="opt.noCameras">-- Žádné kamery nenačteny --</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label data-i18n="lbl.camTypeRole">Typ kamery (Role)</label>
                          <select id="hw-camera-role-select">
                            <option value="overhead" data-i18n="opt.overheadScene">Overhead (Scéna)</option>
                            <option value="wrist" data-i18n="opt.wristGripper">Wrist (Kleště)</option>
                          </select>
                        </div>
                      </div>
                      <div className="conn-sect conn-sect-grow conn-cam-preview-sect">
                        <div className="teleop-sub-title-row">
                          <h4 className="teleop-sub-title" data-i18n="hint.livePreview">Live náhled</h4>
                          <span className="cal-arm-state" id="hw-camera-preview-state" data-i18n="cam.previewIdle">vypnuto</span>
                        </div>
                        <div id="hw-camera-preview-box" className="conn-cam-preview">
                          <img id="hw-camera-preview-img" />
                          {' '}
                          <span id="hw-camera-preview-placeholder" data-i18n="hint.camPreview">Vyberte port pro zobrazení náhledu</span>
                        </div>
                      </div>
                    </div>
                    {/* Vpravo: Seznam nakonfigurovaných */}
                    <div className="conn-cam-side">
                      <div className="conn-sect conn-sect-grow">
                        <div className="teleop-sub-title-row">
                          <h4 className="teleop-sub-title" data-i18n="hint.configuredCams">Nakonfigurované kamery:</h4>
                          <span className="cal-arm-state"><CameraCount /></span>
                        </div>
                        <div className="conn-cam-list"><CameraList /></div>
                      </div>
                    </div>
                  </div>
                  <div className="block-actions">
                    <button
                      className="btn btn-xs btn-secondary"
                      onClick={(event: any) => { App.hwClearCameras() }}
                      data-i18n="btn.clearAll"
                    >Vymazat všechny</button>
                    {' '}
                    <button
                      className="btn btn-xs btn-primary"
                      onClick={(event: any) => { App.hwAddCamera() }}
                      data-i18n="btn.addCamera"
                    >Přidat kameru</button>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* ── Tab 2: Kalibrace ─────────────────────────────────────── */}
      <div className="setup-wizard-panel" data-tab-panel="calibrate" style={{ display: "none" }}>
        <div className="setup-section" style={{ gridTemplateColumns: "1fr" }}>
          <div className="setup-block" style={{ display: "flex", flexDirection: "column" }}>
            <div className="block-head-row">
              <h3 style={{ margin: "0" }}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="4" y="4" width="4" height="16" rx="1"></rect>
                  <rect x="12" y="10" width="8" height="10" rx="1"></rect>
                  <path d="M8 8h4v4H8z"></path>
                  <circle cx="10" cy="10" r="2"></circle>
                </svg>
                {' '}
                <span data-i18n="blk.calibrate.title">Kalibrace ramen</span>
              </h3>
            </div>
            <div
              className="setup-block-content"
              id="cal-main-container"
              style={{ display: "flex", flexDirection: "column", gap: "20px" }}
            >
              {/* DEFAULT VIEW: Files on left, stacked buttons on right */}
              <div id="cal-default-view" style={{ display: "flex", gap: "20px", flex: "1", minHeight: "0" }}>
                {/* Left Column: Calibration Files */}
                <section className="teleop-sub" style={{ flex: "1", display: "flex", flexDirection: "column" }}>
                  <div className="teleop-sub-title-row">
                    <h4 className="teleop-sub-title" data-i18n="blk.calStore.title">Uložené kalibrace</h4>
                    <span className="cal-arm-state" id="cal-files-count">-</span>
                  </div>
                  <div
                    className="cal-store-note"
                    id="cal-files-summary"
                    data-i18n="hint.calStoreIdle"
                    style={{ marginBottom: "8px" }}
                  >
                    Načtěte stav, ať se zjistí, kolik kalibračních souborů projekt a cache LeRobotu obsahují.
                  </div>
                  {/* Inline Calibration Files List */}
                  <div id="cal-files-inline-list" style={{ flex: "1", overflowY: "auto", marginBottom: "12px" }}></div>
                  <div className="cal-arm-actions" style={{ display: "flex", gap: "8px" }}>
                    <button
                      className="btn btn-xs btn-secondary"
                      onClick={(event: any) => { App.openCalibrationFilesModal() }}
                      data-i18n-title="tip.calManage"
                      data-i18n="btn.calManage"
                    >Spravovat soubory</button>
                    {' '}
                    <button
                      className="btn btn-xs btn-secondary"
                      id="btn-refresh-calibration"
                      onClick={(event: any) => { App.manualRefreshCalibration() }}
                      data-i18n-title="tip.calRefresh"
                      data-i18n="btn.loadState"
                    >Načíst stav</button>
                  </div>
                </section>
                {/* Right Column: Stacked Calibration Buttons */}
                <div style={{ flex: "1", display: "flex", flexDirection: "column", gap: "14px" }}>
                  {/* Leader Calibration */}
                  <div id="cal-arm-leader">
                    <button
                      className="btn btn-secondary"
                      id="cal-btn-setup-leader"
                      onClick={(event: any) => { App.calibrateArm('leader') }}
                      style={{ width: "100%", textAlign: "left", padding: "16px 18px", fontSize: "14.5px", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                    >
                      <span style={{ fontWeight: "600" }}>Kalibrovat Leader rameno (řídicí)</span>
                      {' '}
                      <span className="btn-text" style={{ fontSize: "12px", color: "var(--accent)" }}>Spustit →</span>
                    </button>
                    <div
                      className="teleop-sub"
                      id="cal-details-leader"
                      style={{ display: "none", padding: "14px", gap: "8px" }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: "600", fontSize: "14px" }}>Leader (řídicí)</span>
                        {' '}
                        <span className="arm-status-badge" id="cal-state-leader">neznámý</span>
                      </div>
                      <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                        <span>
                          Typ:{' '}
                          <strong id="cal-device-leader" style={{ color: "var(--text-white)" }}>-</strong>
                        </span>
                      </div>
                      <button
                        className="btn btn-xs btn-secondary"
                        onClick={(event: any) => { App.calibrateArm('leader') }}
                        style={{ alignSelf: "flex-start", marginTop: "6px" }}
                      >Kalibrovat znovu</button>
                    </div>
                    {/* hidden elements for backward compat */}
                    <strong id="cal-id-leader" style={{ display: "none" }}>-</strong>
                    {' '}
                    <strong id="cal-port-leader" style={{ display: "none" }}>-</strong>
                    {' '}
                    <strong id="cal-file-leader" style={{ display: "none" }}>-</strong>
                    {' '}
                    <strong id="cal-joints-leader" style={{ display: "none" }}>-</strong>
                    {' '}
                    <span id="cal-tab-leader-port" style={{ display: "none" }}>-</span>
                    {' '}
                    <button id="btn-calibrate-leader" style={{ display: "none" }}></button>
                  </div>
                  {/* Follower Calibration */}
                  <div id="cal-arm-follower">
                    <button
                      className="btn btn-secondary"
                      id="cal-btn-setup-follower"
                      onClick={(event: any) => { App.calibrateArm('follower') }}
                      style={{ width: "100%", textAlign: "left", padding: "16px 18px", fontSize: "14.5px", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                    >
                      <span style={{ fontWeight: "600" }}>Kalibrovat Follower rameno (vykonávací)</span>
                      {' '}
                      <span className="btn-text" style={{ fontSize: "12px", color: "var(--accent)" }}>Spustit →</span>
                    </button>
                    <div
                      className="teleop-sub"
                      id="cal-details-follower"
                      style={{ display: "none", padding: "14px", gap: "8px" }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: "600", fontSize: "14px" }}>Follower (vykonávací)</span>
                        {' '}
                        <span className="arm-status-badge" id="cal-state-follower">neznámý</span>
                      </div>
                      <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                        <span>
                          Typ:{' '}
                          <strong id="cal-device-follower" style={{ color: "var(--text-white)" }}>-</strong>
                        </span>
                      </div>
                      <button
                        className="btn btn-xs btn-secondary"
                        onClick={(event: any) => { App.calibrateArm('follower') }}
                        style={{ alignSelf: "flex-start", marginTop: "6px" }}
                      >Kalibrovat znovu</button>
                    </div>
                    {/* hidden elements for backward compat */}
                    <strong id="cal-id-follower" style={{ display: "none" }}>-</strong>
                    {' '}
                    <strong id="cal-port-follower" style={{ display: "none" }}>-</strong>
                    {' '}
                    <strong id="cal-file-follower" style={{ display: "none" }}>-</strong>
                    {' '}
                    <strong id="cal-joints-follower" style={{ display: "none" }}>-</strong>
                    {' '}
                    <span id="cal-tab-follower-port" style={{ display: "none" }}>-</span>
                    {' '}
                    <button id="btn-calibrate-follower" style={{ display: "none" }}></button>
                  </div>
                </div>
              </div>
              {/* ACTIVE CALIBRATION VIEW: Shown only when calibrating */}
              <div
                className="cal-col-run"
                id="cal-active-view"
                style={{ display: "none", flexDirection: "column", gap: "16px" }}
              >
                <div className="teleop-sub-title-row">
                  <h4 className="teleop-sub-title">
                    <span data-i18n="cal.liveTitle">Živá kalibrace</span>
                    {' '}
                    <strong id="calibration-live-robot" className="cal-live-robot"></strong>
                  </h4>
                  <span className="cal-live-phase" id="cal-live-phase" data-i18n="cal.phaseIdle">nespuštěno</span>
                </div>
                <div className="phase-now" style={{ marginTop: "0" }}>
                  <h4 className="phase-now-title" id="cal-now-title" data-i18n="cal.now.idle.title">Kalibrace neběží</h4>
                  <p
                    className="phase-now-text cal-step-instruction-big"
                    id="cal-now-text"
                    data-i18n="cal.now.idle.text"
                  >Spusťte kalibraci výběrem ramene.</p>
                  <div className="phase-now-actions" style={{ justifyContent: "center", gap: "12px" }}>
                    <button
                      className="btn btn-primary"
                      id="cal-btn-confirm"
                      style={{ display: "none", padding: "12px 24px", fontSize: "16px" }}
                      onClick={(event: any) => { App.confirmCalibrationStep() }}
                      data-i18n-title="tip.calConfirm"
                      data-i18n="cal.confirm"
                    >Potvrdit (Enter)</button>
                    {' '}
                    <button
                      className="btn btn-secondary"
                      id="cal-btn-recal"
                      style={{ display: "none" }}
                      onClick={(event: any) => { App.forceNewCalibration() }}
                      data-i18n-title="tip.calForceNew"
                      data-i18n="cal.recalibrate"
                    >Kalibrovat znovu (c)</button>
                    {' '}
                    <button
                      className="btn btn-danger"
                      id="cal-btn-cancel"
                      style={{ display: "none" }}
                      onClick={(event: any) => { App.cancelCalibration() }}
                      data-i18n-title="tip.calCancel"
                      data-i18n="cal.cancel"
                    >Přerušit</button>
                  </div>
                </div>
                {/* Running: streamed MIN/POS/MAX rows + the answers to the gates above. */}
                <div id="calibration-live-panel" className="cal-live-panel" style={{ display: "none" }}>
                  <table className="cal-live-table">
                    <thead>
                      <tr>
                        <th data-i18n="cal.motor">Motor</th>
                        <th data-i18n="cal.min">MIN</th>
                        <th data-i18n="cal.pos">POS</th>
                        <th data-i18n="cal.max">MAX</th>
                        <th data-i18n="cal.span">ROZPĚTÍ</th>
                      </tr>
                    </thead>
                    <tbody id="calibration-live-tbody"></tbody>
                  </table>
                  <div id="cal-live-note" className="cal-live-note"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* ── Tab 3: Modely (orchestrace LLM/VLM) ─────────────────────── */}
      <div className="setup-wizard-panel" data-tab-panel="models" style={{ display: "none" }}>
        <div className="setup-section" style={{ gridTemplateColumns: "1fr" }}>
          <div className="setup-block" style={{ display: "flex", flexDirection: "column" }}>
            <h3>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3"></circle>
                <path
                  d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                ></path>
              </svg>
              {' '}
              <span data-i18n="blk.orch.models">Nastavení kognitivních modelů</span>
            </h3>
            <div className="setup-block-content">
              <div className="merge-cols merge-cols-2">
                <section className="merge-col">
                  <h4 className="merge-col-title" data-i18n="h4.orch.llm">LLM Plánovač (CEO)</h4>
                  <div className="form-group">
                    <div className="label-with-tooltip">
                      <label data-i18n="lbl.modelName">Název modelu</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.llmModelName">ⓘ</span>
                    </div>
                    <input
                      type="text"
                      id="llm-model"
                      defaultValue="qwen2.5-7b-instruct"
                      placeholder="Např. qwen2.5-7b-instruct"
                      data-i18n-ph="ph.llmModel"
                    />
                  </div>
                  <div className="form-group">
                    <div className="label-with-tooltip">
                      <label data-i18n="lbl.serverAddr">Adresa serveru</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.llmEndpoint">ⓘ</span>
                    </div>
                    <input
                      type="text"
                      id="llm-endpoint"
                      defaultValue="http://localhost:1234/v1"
                      placeholder="http://localhost:1234/v1"
                    />
                  </div>
                  <div className="form-group">
                    <div className="label-with-tooltip">
                      <label data-i18n="lbl.ceoPrompt">Systémový Prompt pro CEO Plánovač</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.ceoPrompt">ⓘ</span>
                    </div>
                    <textarea
                      id="llm-prompt"
                      placeholder="Systémový prompt..."
                      style={{ minHeight: "180px", resize: "vertical", fontFamily: "var(--font-mono)" }}
                      data-i18n-ph="ph.systemPrompt"
                    ></textarea>
                  </div>
                </section>
                <section className="merge-col">
                  <h4 className="merge-col-title" data-i18n="h4.orch.vlm">VLM Inspektor (Manager)</h4>
                  <div className="form-group">
                    <div className="label-with-tooltip">
                      <label data-i18n="lbl.modelName">Název modelu</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.vlmModelName">ⓘ</span>
                    </div>
                    <input
                      type="text"
                      id="vlm-model"
                      defaultValue="qwen2-vl-7b-instruct"
                      placeholder="Např. qwen2-vl-7b-instruct"
                      data-i18n-ph="ph.vlmModel"
                    />
                  </div>
                  <div className="form-group">
                    <div className="label-with-tooltip">
                      <label data-i18n="lbl.serverAddr">Adresa serveru</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.vlmEndpoint">ⓘ</span>
                    </div>
                    <input
                      type="text"
                      id="vlm-endpoint"
                      defaultValue="http://localhost:1234/v1"
                      placeholder="http://localhost:1234/v1"
                    />
                  </div>
                  <div className="form-group">
                    <div className="label-with-tooltip">
                      <label data-i18n="lbl.vlmLoopFreq">Frekvence sekvenční smyčky VLM (sekundy)</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.vlmLoopFreq">ⓘ</span>
                    </div>
                    <input
                      type="number"
                      id="settings-loop-interval"
                      defaultValue="5"
                      min="1"
                      step="0.5"
                      style={{ width: "110px", fontFamily: "var(--font-mono)" }}
                    />
                  </div>
                </section>
              </div>
            </div>
            <div className="block-actions">
              <button
                className="btn btn-xs btn-primary btn-save-hw-config"
                onClick={(event: any) => { App.saveModelConfig() }}
                data-i18n="btn.saveHw"
                data-i18n-title="tip.saveHw"
                title="Uloží typ robota, porty ramen a nastavení modelů do projektu"
              >Uložit nastavení hardwaru</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
