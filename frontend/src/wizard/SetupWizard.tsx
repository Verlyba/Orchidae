/** First-run / quick-setup wizard — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function SetupWizard() {
  return (
    <div id="setup-wizard-overlay" className="wizard-overlay" style={{ display: "none" }}>
      <div className="wizard-container">
        <button
          id="wizard-close-button"
          className="wizard-close-btn"
          onClick={(event: any) => { App.wizardSkip() }}
        >✕</button>
        {/* PAGE 1: Welcome & Project creation */}
        <div id="wizard-page-1" className="wizard-page active">
          <div className="wizard-header">
            <div className="welcome-text">WELCOME TO</div>
            <h1 className="brand-title">Orchidae</h1>
          </div>
          <p className="wizard-subtitle">
            Let's start by creating your first{' '}
            <span className="highlight-yellow">project</span>
            .
          </p>
          <div className="wizard-divider-container">
            <div className="wizard-divider"></div>
          </div>
          <div className="wizard-form">
            <div className="wizard-form-group">
              <label htmlFor="wizard-project-name" data-i18n="lbl.projectNameEn">Name of your project</label>
              {' '}
              <input type="text" id="wizard-project-name" defaultValue="Pepe" autoComplete="off" />
            </div>
            <div className="wizard-form-group">
              <label htmlFor="wizard-scene-desc" data-i18n="lbl.sceneDesc">
                Popis scény{' '}
                <span className="required-mark">*</span>
              </label>
              <div className="wizard-field-hint" data-i18n="hint.sceneDesc">
                Popište fyzické uspořádání pracoviště: kde jsou kamery, co je na stole, jaké je pozadí a osvětlení. Tento popis dostane jak CEO plánovač, tak VLM inspektor jako trvalý kontext ke každému promptu.
              </div>
              <textarea
                id="wizard-scene-desc"
                rows={3}
                placeholder="např. Robotické rameno je upevněno na hraně stolu. Kamera shora snímá pracovní plochu s kostkami a miskou."
                data-i18n-ph="ph.sceneDesc"
              ></textarea>
            </div>
            <div className="wizard-form-group">
              <div className="label-with-tooltip">
                <label htmlFor="wizard-robot-select" data-i18n="lbl.selectRobot">Select your robot</label>
                {' '}
                <span className="info-tooltip-trigger" data-i18n-tooltip="tip.wizardRobotSelect">ⓘ</span>
              </div>
              <div className="select-wrapper">
                <select id="wizard-robot-select">
                  <option value="SO-ARM 101">SO-ARM 101</option>
                  <option value="SO-100">SO-100</option>
                  <option value="Koch v1.1">Koch v1.1</option>
                  <option value="Moss v1">Moss v1</option>
                  <option value="Aloha">Aloha</option>
                  <option value="Stretch">Stretch</option>
                  <option value="LeKiwi">LeKiwi</option>
                  <option value="Custom">Custom</option>
                </select>
                <span className="select-arrow"></span>
              </div>
            </div>
            <button
              id="wizard-btn-continue"
              className="btn btn-primary"
              onClick={(event: any) => { App.wizardNextPage() }}
              data-i18n="btn.wizContinue"
            >Continue</button>
          </div>
        </div>
        {/* PAGE 2: LeRobot connection selection */}
        <div id="wizard-page-2" className="wizard-page">
          <div className="wizard-header">
            <h1 className="brand-title">Orchidae</h1>
          </div>
          <p className="wizard-subtitle" id="wizard-page-2-title">
            We couldn't find your{' '}
            <span className="highlight-yellow">LeRobot</span>
            {' '}repository.
          </p>
          <div className="wizard-divider-container">
            <div className="wizard-divider"></div>
          </div>
          <p className="wizard-description-text" id="wizard-page-2-desc">
            Would you like us to perform a new installation, or would you prefer to connect it yourself?
          </p>
          <div
            id="wizard-requirements-checklist"
            style={{ margin: "0 auto 12px auto", fontSize: "13px", display: "none", flexDirection: "column", gap: "6px", background: "rgba(255,255,255,0.02)", padding: "10px", border: "1px solid var(--border)", maxWidth: "400px", width: "100%", textAlign: "left" }}
          >{/* Populated dynamically via JS */}</div>
          <div className="wizard-options" id="wizard-page-2-options-container">
            <button
              id="wizard-opt-new-installation"
              className="btn-white-pill active"
              onClick={(event: any) => { App.wizardSelectOption('install') }}
              data-i18n="btn.wizNewInstall"
            >New installation</button>
            {' '}
            <button
              id="wizard-opt-connect"
              className="btn-white-pill"
              onClick={(event: any) => { App.wizardSelectOption('connect') }}
              data-i18n="btn.wizConnect"
            >Connect</button>
          </div>
          <div className="wizard-actions-row">
            <button
              className="btn btn-secondary"
              onClick={(event: any) => { App.wizardPrevPage() }}
              data-i18n="btn.wizBack"
            >Back</button>
            {' '}
            <button
              className="btn btn-primary"
              id="wizard-page-2-next-btn"
              onClick={(event: any) => { App.wizardNextPage() }}
              data-i18n="btn.wizNext"
            >Next</button>
          </div>
        </div>
        {/* PAGE 3: Connect Path OR Install Progress */}
        <div id="wizard-page-3" className="wizard-page">
          <div className="wizard-header">
            <h1 className="brand-title">Orchidae</h1>
          </div>
          <p className="wizard-subtitle" id="wizard-page-3-title">
            Connect your{' '}
            <span className="highlight-yellow">LeRobot</span>
            {' '}repository.
          </p>
          <div className="wizard-divider-container">
            <div className="wizard-divider"></div>
          </div>
          {/* Option: Connect path selection */}
          <div id="wizard-connect-section" className="wizard-sub-section">
            <div className="wizard-form-group">
              <div className="label-with-tooltip">
                <label htmlFor="wizard-lerobot-path" data-i18n="lbl.lerobotPath">Path to LeRobot directory</label>
                {' '}
                <span className="info-tooltip-trigger" data-i18n-tooltip="tip.wizardLerobotPath">ⓘ</span>
              </div>
              <div className="input-with-button" style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  id="wizard-lerobot-path"
                  defaultValue="/home/verlyba/robotics/lerobot"
                  autoComplete="off"
                  style={{ flex: "1" }}
                />
                {' '}
                <button
                  className="btn btn-secondary"
                  onClick={(event: any) => { App.wizardBrowseLeRobotPath() }}
                  style={{ height: "36px", padding: "0 12px" }}
                >Browse</button>
              </div>
            </div>
          </div>
          {/* Option: Install progress log */}
          <div id="wizard-install-section" className="wizard-sub-section" style={{ display: "none" }}>
            <p className="wizard-description-text" style={{ marginBottom: "10px" }}>Installation logs:</p>
            <div className="wizard-log-terminal" id="wizard-log-terminal">{/* Simulated logs appear here */}</div>
            <div className="wizard-progress-bar-container">
              <div className="wizard-progress-bar" id="wizard-progress-bar" style={{ width: "0%" }}></div>
            </div>
          </div>
          <div className="wizard-actions-row">
            <button
              className="btn btn-secondary"
              id="wizard-page-3-back"
              onClick={(event: any) => { App.wizardPrevPage() }}
              data-i18n="btn.wizBack"
            >Back</button>
            {' '}
            <button
              className="btn btn-primary"
              id="wizard-btn-finish"
              onClick={(event: any) => { App.wizardNextPage() }}
              data-i18n="btn.wizNext"
            >Next</button>
          </div>
        </div>
        {/* PAGE 4: Connect Leader Arm (Auto-Detection) */}
        <div id="wizard-page-4" className="wizard-page">
          <div className="wizard-header">
            <h1 className="brand-title">Orchidae</h1>
          </div>
          <p className="wizard-subtitle">
            Connect your{' '}
            <span className="highlight-yellow">Leader</span>
            {' '}arm.
          </p>
          <div className="wizard-divider-container">
            <div className="wizard-divider"></div>
          </div>
          {/* Step 4.1: Start automatic search */}
          <div id="wizard-leader-step-1" className="wizard-sub-section">
            <p className="wizard-description-text">Press the button below to automatically detect your Leader Arm.</p>
            <button
              id="wizard-leader-btn-search"
              className="btn btn-primary"
              onClick={(event: any) => { App.wizardStartDetectArm('leader') }}
              data-i18n="btn.startAutoSearch"
            >Start automatic search</button>
          </div>
          {/* Step 4.2: Now unplug USB cable */}
          <div id="wizard-leader-step-2" className="wizard-sub-section" style={{ display: "none" }}>
            <p className="wizard-description-text">Now unplug the USB cable from Leader arm and press Enter.</p>
            <button
              id="wizard-leader-btn-confirm"
              className="btn btn-primary"
              onClick={(event: any) => { App.wizardConfirmUnplugArm('leader') }}
              data-i18n="btn.wizConfirmUnplug"
            >Confirm Unplug (Enter)</button>
          </div>
          {/* Step 4.3: Detected success */}
          <div id="wizard-leader-step-3" className="wizard-sub-section" style={{ display: "none" }}>
            <p className="wizard-description-text" id="wizard-leader-detected-text">Great! Leader arm detected at usb port 1.</p>
          </div>
          <div className="wizard-actions-row" style={{ marginTop: "20px" }}>
            <button
              className="btn btn-secondary"
              onClick={(event: any) => { App.wizardPrevPage() }}
              data-i18n="btn.wizBack"
            >Back</button>
            {' '}
            <button
              className="btn btn-primary"
              id="wizard-leader-next-btn"
              onClick={(event: any) => { App.wizardNextPage() }}
              data-i18n="btn.wizSkip"
            >Skip</button>
          </div>
        </div>
        {/* PAGE 5: Connect Follower Arm (Auto-Detection) */}
        <div id="wizard-page-5" className="wizard-page">
          <div className="wizard-header">
            <h1 className="brand-title">Orchidae</h1>
          </div>
          <p className="wizard-subtitle">
            Connect your{' '}
            <span className="highlight-yellow">Follower</span>
            {' '}arm.
          </p>
          <div className="wizard-divider-container">
            <div className="wizard-divider"></div>
          </div>
          {/* Step 5.1: Start automatic search */}
          <div id="wizard-follower-step-1" className="wizard-sub-section">
            <p className="wizard-description-text">Press the button below to automatically detect your Follower Arm.</p>
            <button
              id="wizard-follower-btn-search"
              className="btn btn-primary"
              onClick={(event: any) => { App.wizardStartDetectArm('follower') }}
              data-i18n="btn.startAutoSearch"
            >Start automatic search</button>
          </div>
          {/* Step 5.2: Now unplug USB cable */}
          <div id="wizard-follower-step-2" className="wizard-sub-section" style={{ display: "none" }}>
            <p className="wizard-description-text">Now unplug the USB cable from Follower arm and press Enter.</p>
            <button
              id="wizard-follower-btn-confirm"
              className="btn btn-primary"
              onClick={(event: any) => { App.wizardConfirmUnplugArm('follower') }}
              data-i18n="btn.wizConfirmUnplug"
            >Confirm Unplug (Enter)</button>
          </div>
          {/* Step 5.3: Detected success */}
          <div id="wizard-follower-step-3" className="wizard-sub-section" style={{ display: "none" }}>
            <p className="wizard-description-text" id="wizard-follower-detected-text">Great! Follower arm detected at usb port 1.</p>
          </div>
          <div className="wizard-actions-row" style={{ marginTop: "20px" }}>
            <button
              className="btn btn-secondary"
              onClick={(event: any) => { App.wizardPrevPage() }}
              data-i18n="btn.wizBack"
            >Back</button>
            {' '}
            <button
              className="btn btn-primary"
              id="wizard-follower-finish-btn"
              onClick={(event: any) => { App.wizardNextPage() }}
              data-i18n="btn.wizNext"
            >Next</button>
          </div>
        </div>
        {/* PAGE 6: Connect Cameras */}
        <div id="wizard-page-6" className="wizard-page">
          <div className="wizard-header">
            <h1 className="brand-title">Orchidae</h1>
          </div>
          <p className="wizard-subtitle">
            Now connect your{' '}
            <span className="highlight-yellow">cameras</span>
            .
          </p>
          <div className="wizard-divider-container">
            <div className="wizard-divider"></div>
          </div>
          <div
            className="wizard-form"
            style={{ maxWidth: "480px", width: "100%", display: "flex", flexDirection: "column", gap: "12px" }}
          >
            {/* Select Video Port */}
            <div className="wizard-form-group">
              <div className="label-with-tooltip">
                <label htmlFor="wizard-camera-port-select" data-i18n="lbl.selectVideoEn">Select video port</label>
                {' '}
                <span className="info-tooltip-trigger" data-i18n-tooltip="tip.wizardCameraPort">ⓘ</span>
              </div>
              <div className="select-wrapper">
                <select
                  id="wizard-camera-port-select"
                  onChange={(event: any) => { App.wizardOnCameraPortChange() }}
                >
                  <option value="">-- No cameras detected --</option>
                </select>
                <span className="select-arrow"></span>
              </div>
            </div>
            {/* Preview & Type Row */}
            <div style={{ display: "flex", gap: "16px", alignItems: "stretch", width: "100%" }}>
              {/* Preview Box */}
              <div style={{ flex: "1.2", display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "13.5px", fontWeight: "bold", color: "var(--text-light)" }}>Preview</span>
                <div
                  id="wizard-camera-preview-box"
                  style={{ aspectRatio: "4/3", background: "#000", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }}
                >
                  <img
                    id="wizard-camera-preview-img"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "none" }}
                  />
                  {' '}
                  <span
                    id="wizard-camera-preview-placeholder"
                    style={{ fontSize: "12.5px", color: "var(--text-muted)", textAlign: "center", padding: "10px" }}
                  >Select a port to show live feed</span>
                </div>
              </div>
              {/* Role & Add Buttons */}
              <div
                style={{ flex: "1", display: "flex", flexDirection: "column", gap: "12px", justifyContent: "space-between" }}
              >
                <div className="wizard-form-group">
                  <div className="label-with-tooltip">
                    <label htmlFor="wizard-camera-role-select" data-i18n="lbl.camTypeEn">Camera type</label>
                    {' '}
                    <span className="info-tooltip-trigger" data-i18n-tooltip="tip.wizardCameraRole">ⓘ</span>
                  </div>
                  <div className="select-wrapper">
                    <select id="wizard-camera-role-select">
                      <option value="overhead" data-i18n="opt.overheadScene">Overhead (Scéna)</option>
                      <option value="wrist" data-i18n="opt.wristGripper">Wrist (Kleště)</option>
                    </select>
                    <span className="select-arrow"></span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <button
                    className="btn btn-primary"
                    onClick={(event: any) => { App.wizardAddCamera() }}
                    style={{ margin: "0", height: "36px", fontSize: "13.5px" }}
                    data-i18n="btn.addCamera"
                  >Přidat kameru</button>
                  {' '}
                  <button
                    className="btn btn-secondary"
                    onClick={(event: any) => { App.wizardClearCameras() }}
                    style={{ margin: "0", height: "36px", fontSize: "13.5px", color: "var(--text-muted)" }}
                    data-i18n="btn.removeAll"
                  >Odebrat všechny</button>
                </div>
              </div>
            </div>
            {/* List of Added Cameras */}
            <div
              style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}
            >
              <span
                style={{ fontSize: "12.5px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase" }}
                data-i18n="hint.configuredCams"
              >Nakonfigurované kamery:</span>
              <div
                id="wizard-camera-list"
                style={{ maxHeight: "80px", overflowY: "auto", background: "var(--bg-sidebar)", border: "1px solid var(--border)", padding: "6px", display: "flex", flexDirection: "column", gap: "4px" }}
              >
                <div
                  style={{ fontSize: "12.5px", color: "var(--text-muted)", textAlign: "center", padding: "4px" }}
                  data-i18n="hint.noCamsAdded"
                >Žádné přidané kamery.</div>
              </div>
            </div>
          </div>
          <div className="wizard-actions-row" style={{ marginTop: "24px" }}>
            <button
              className="btn btn-secondary"
              onClick={(event: any) => { App.wizardPrevPage() }}
              data-i18n="btn.wizBack"
            >Back</button>
            {' '}
            <button
              className="btn btn-primary"
              onClick={(event: any) => { App.wizardNextPage() }}
              data-i18n="btn.wizNext"
            >Next</button>
          </div>
        </div>
        {/* PAGE 7: Setup Complete */}
        <div id="wizard-page-7" className="wizard-page">
          <div className="wizard-header">
            <h1 className="brand-title">Orchidae</h1>
          </div>
          <p className="wizard-subtitle">
            Your first project setup is{' '}
            <span className="highlight-yellow">complete</span>
            !
          </p>
          <div className="wizard-divider-container">
            <div className="wizard-divider"></div>
          </div>
          <p className="wizard-description-text" style={{ maxWidth: "360px" }}>
            Vše je připraveno! Váš první projekt a hardware byly úspěšně nakonfigurovány. Kliknutím na tlačítko níže dokončíte nastavení a vstoupíte do pracovního prostředí.
          </p>
          <div className="wizard-actions-row" style={{ marginTop: "30px" }}>
            <button
              className="btn btn-secondary"
              onClick={(event: any) => { App.wizardPrevPage() }}
              data-i18n="btn.wizBack"
            >Back</button>
            {' '}
            <button
              className="btn btn-primary"
              onClick={(event: any) => { App.wizardFinish() }}
              data-i18n="btn.wizFinish"
            >Finish</button>
          </div>
        </div>
        {/* Bottom controls (indicators & skip setup) */}
        <div className="wizard-footer">
          <div className="dots-indicator">
            <span className="dot active" id="wizard-dot-1"></span>
            {' '}
            <span className="dot" id="wizard-dot-2"></span>
            {' '}
            <span className="dot" id="wizard-dot-3"></span>
            {' '}
            <span className="dot" id="wizard-dot-4"></span>
            {' '}
            <span className="dot" id="wizard-dot-5"></span>
            {' '}
            <span className="dot" id="wizard-dot-6"></span>
            {' '}
            <span className="dot" id="wizard-dot-7"></span>
          </div>
        </div>
        {/* Morphing Skip Setup Button at bottom right */}
        <div className="skip-setup-container" onClick={(event: any) => { App.wizardSkip() }}>
          <span className="skip-text">Skip setup</span>
          <div className="arrow-circle">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
