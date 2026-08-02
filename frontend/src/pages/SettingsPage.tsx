/** #page-settings — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function SettingsPage() {
  return (
    <div id="page-settings" className="editor-area">
      <div className="page-header-row">
        <h2 data-i18n="page.settings.title">Globální Nastavení & Diagnostika</h2>
      </div>
      <div className="setup-wizard-tabs">
        <button
          className="setup-wizard-tab-btn active"
          data-tab="paths"
          onClick={(event: any) => { App.switchSettingsTab('paths') }}
        >
          <span data-i18n="tab.settings.paths">Cesty a diagnostika</span>
        </button>
        {' '}
        <button
          className="setup-wizard-tab-btn"
          data-tab="tools"
          onClick={(event: any) => { App.switchSettingsTab('tools') }}
        >
          <span data-i18n="tab.settings.tools">Nástroje LeRobot CLI</span>
        </button>
      </div>
      <div className="setup-wizard-panel" data-tab-panel="paths">
        <div className="setup-block settings-block">
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
                <circle cx="12" cy="12" r="3"></circle>
                <path
                  d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                ></path>
              </svg>
              {' '}
              <span data-i18n="settings.title">Cesty, prostředí a diagnostika</span>
            </h3>
          </div>
          <div className="settings-unified-grid">
            {/* Left pane: configurable values */}
            <div className="settings-pane">
              <h4 className="settings-pane-title" data-i18n="settings.paths.title">Cesty & Prostředí</h4>
              <div className="cfg-card lang-card">
                <div className="cfg-card-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path
                      d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
                    ></path>
                  </svg>
                </div>
                <div className="cfg-card-body lang-row">
                  <div className="lang-info">
                    <div className="cfg-card-title" data-i18n="settings.language.title">Jazyk aplikace / Application language</div>
                  </div>
                  <div className="lang-toggle" role="group" aria-label="Language">
                    <button type="button" data-lang="cs" onClick={(event: any) => { App.setLang('cs') }}>Čeština</button>
                    {' '}
                    <button type="button" data-lang="en" onClick={(event: any) => { App.setLang('en') }}>English</button>
                  </div>
                </div>
              </div>
              <div className="cfg-card">
                <div className="cfg-card-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                </div>
                <div className="cfg-card-body">
                  <div className="cfg-card-title">
                    <span data-i18n="lbl.sceneDesc">Popis scény</span>
                    {' '}
                    <span className="required-mark">*</span>
                  </div>
                  <textarea
                    id="settings-scene-desc"
                    rows={2}
                    className="cfg-card-textarea"
                    placeholder="např. Robotické rameno SO-101 je upevněno na hraně dřevěného stolu. Kamera 'overhead_cam' snímá stůl shora, kamera 'wrist_cam' je na zápěstí robota. Na stole je bílá miska vlevo a modrá krabice vpravo."
                    data-i18n-ph="ph.sceneDesc"
                  ></textarea>
                </div>
              </div>
              {/* Three path pickers side by side: as one card per row each was 800 px wide for a single input. */}
              <div className="settings-path-grid">
                <div className="cfg-card">
                  <div className="cfg-card-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="4 17 10 11 4 5"></polyline>
                      <line x1="12" y1="19" x2="20" y2="19"></line>
                    </svg>
                  </div>
                  <div className="cfg-card-body">
                    <div className="cfg-card-title" data-i18n="settings.python.title">Python Executable</div>
                    <div className="cfg-card-input">
                      <input
                        type="text"
                        id="settings-python-path"
                        defaultValue=""
                        placeholder="Cesta k python.exe / bin/python"
                        data-i18n-ph="settings.python.ph"
                      />
                      {' '}
                      <button
                        className="btn btn-xs btn-secondary"
                        onClick={(event: any) => { App.browseFile('settings-python-path', 'dlg.pickPython') }}
                        data-i18n="btn.browse"
                        data-i18n-title="tip.browseFile"
                        title="Otevře systémový dialog pro výběr souboru"
                      >Procházet</button>
                    </div>
                  </div>
                </div>
                <div className="cfg-card">
                  <div className="cfg-card-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                  </div>
                  <div className="cfg-card-body">
                    <div className="cfg-card-title" data-i18n="settings.lerobotDir.title">Repozitář LeRobot</div>
                    <div className="cfg-card-input">
                      <input
                        type="text"
                        id="settings-lerobot-dir-global"
                        defaultValue=""
                        placeholder="Cesta k repozitáři lerobot"
                        data-i18n-ph="settings.lerobotDir.ph"
                      />
                      {' '}
                      <button
                        className="btn btn-xs btn-secondary"
                        onClick={(event: any) => { App.browseDirectory('settings-lerobot-dir-global', 'dlg.pickLerobotDir') }}
                        data-i18n="btn.browse"
                        data-i18n-title="tip.browseDir"
                        title="Otevře systémový dialog pro výběr složky"
                      >Procházet</button>
                    </div>
                  </div>
                </div>
                <div className="cfg-card">
                  <div className="cfg-card-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                    </svg>
                  </div>
                  <div className="cfg-card-body">
                    <div className="cfg-card-title" data-i18n="settings.storage.title">Úložiště datasetů a modelů</div>
                    <div className="cfg-card-input">
                      <input
                        type="text"
                        id="settings-dataset-storage-dir"
                        defaultValue=""
                        placeholder="Výchozí HuggingFace Cache cesta…"
                        data-i18n-ph="settings.storage.ph"
                        onChange={(event: any) => { App.syncDatasetStorageDir('settings-dataset-storage-dir') }}
                      />
                      {' '}
                      <button
                        className="btn btn-xs btn-secondary"
                        onClick={(event: any) => { App.browseDirectory('settings-dataset-storage-dir', 'dlg.pickStorageDir') }}
                        data-i18n="btn.browse"
                        data-i18n-title="tip.browseDir"
                        title="Otevře systémový dialog pro výběr složky"
                      >Procházet</button>
                    </div>
                  </div>
                </div>
                <div className="cfg-card">
                  <div className="cfg-card-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                  </div>
                  <div className="cfg-card-body">
                    <div className="cfg-card-title" data-i18n="settings.projectsDir.title">Umístění projektů</div>
                    <div className="cfg-card-input">
                      <input
                        type="text"
                        id="settings-projects-dir"
                        defaultValue=""
                        placeholder="Cesta k adresáři projektů"
                        data-i18n-ph="settings.projectsDir.ph"
                        readOnly={true}
                      />
                    </div>
                  </div>
                </div>
              </div>
              {/* /.settings-path-grid */}
            </div>
            {/* /.settings-pane (config) */}
            {/* Right pane: read-only environment diagnostics */}
            <div className="settings-pane">
              <div className="settings-pane-head">
                <h4 className="settings-pane-title" data-i18n="settings.diag.title">Systémová Diagnostika</h4>
                <button
                  className="btn btn-xs btn-secondary btn-refresh-sysinfo"
                  onClick={(event: any) => { App.loadSysInfo() }}
                  data-i18n-title="tip.refreshDiag"
                  title="Znovu spustí detekci prostředí"
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ verticalAlign: "-1px" }}
                  >
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                  </svg>
                  {' '}
                  <span data-i18n="btn.refresh">Obnovit</span>
                </button>
              </div>
              <div className="diag-list">
                <div className="diag-row">
                  <div className="diag-row-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="3" width="20" height="14" rx="2"></rect>
                      <line x1="8" y1="21" x2="16" y2="21"></line>
                      <line x1="12" y1="17" x2="12" y2="21"></line>
                    </svg>
                  </div>
                  <div className="diag-row-text">
                    <span className="diag-row-label" data-i18n="diag.platform">Operační systém</span>
                    {' '}
                    <span id="diag-platform" className="diag-row-value" data-i18n="val.loading">Načítání…</span>
                  </div>
                </div>
                <div className="diag-row">
                  <div className="diag-row-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="16 18 22 12 16 6"></polyline>
                      <polyline points="8 6 2 12 8 18"></polyline>
                    </svg>
                  </div>
                  <div className="diag-row-text">
                    <span className="diag-row-label" data-i18n="diag.python">Verze Pythonu</span>
                    {' '}
                    <span id="diag-python-version" className="diag-row-value" data-i18n="val.loading">Načítání…</span>
                  </div>
                </div>
                <div className="diag-row">
                  <div className="diag-row-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                      <circle cx="8" cy="16" r="1.4"></circle>
                      <circle cx="16" cy="16" r="1.4"></circle>
                      <path d="M12 2v9"></path>
                    </svg>
                  </div>
                  <div className="diag-row-text">
                    <span className="diag-row-label" data-i18n="diag.lerobot">Verze LeRobotu</span>
                    {' '}
                    <span id="diag-lerobot-version" className="diag-row-value" data-i18n="val.loading">Načítání…</span>
                  </div>
                </div>
                <div className="diag-row">
                  <div className="diag-row-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2v6"></path>
                      <path d="m4.9 4.9 4.2 4.2"></path>
                      <circle cx="12" cy="14" r="7"></circle>
                    </svg>
                  </div>
                  <div className="diag-row-text">
                    <span className="diag-row-label" data-i18n="diag.torch">Verze PyTorch</span>
                    {' '}
                    <span id="diag-torch-version" className="diag-row-value" data-i18n="val.loading">Načítání…</span>
                  </div>
                </div>
                <div className="diag-row">
                  <div className="diag-row-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="4" y="4" width="16" height="16" rx="2"></rect>
                      <rect x="9" y="9" width="6" height="6"></rect>
                      <line x1="9" y1="1" x2="9" y2="4"></line>
                      <line x1="15" y1="1" x2="15" y2="4"></line>
                      <line x1="9" y1="20" x2="9" y2="23"></line>
                      <line x1="15" y1="20" x2="15" y2="23"></line>
                      <line x1="20" y1="9" x2="23" y2="9"></line>
                      <line x1="20" y1="15" x2="23" y2="15"></line>
                      <line x1="1" y1="9" x2="4" y2="9"></line>
                      <line x1="1" y1="15" x2="4" y2="15"></line>
                    </svg>
                  </div>
                  <div className="diag-row-text">
                    <span className="diag-row-label" data-i18n="diag.device">Výpočetní zařízení</span>
                    {' '}
                    <span id="diag-compute-device" className="diag-row-value" data-i18n="val.loading">Načítání…</span>
                  </div>
                </div>
                <div className="diag-row">
                  <div className="diag-row-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polygon points="23 7 16 12 23 17 23 7"></polygon>
                      <rect x="1" y="5" width="15" height="14" rx="2"></rect>
                    </svg>
                  </div>
                  <div className="diag-row-text">
                    <span className="diag-row-label" data-i18n="diag.ffmpeg">ffmpeg (kódování videa)</span>
                    {' '}
                    <span id="diag-ffmpeg" className="diag-row-value" data-i18n="val.loading">Načítání…</span>
                  </div>
                </div>
                <div className="diag-row">
                  <div className="diag-row-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path
                        d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
                      ></path>
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                    </svg>
                  </div>
                  <div className="diag-row-text">
                    <span className="diag-row-label" data-i18n="diag.conda">Conda Prostředí</span>
                    {' '}
                    <span id="diag-conda-env" className="diag-row-value" data-i18n="val.loading">Načítání…</span>
                  </div>
                </div>
                <div className="diag-row">
                  <div className="diag-row-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                  </div>
                  <div className="diag-row-text">
                    <span className="diag-row-label" data-i18n="diag.miniconda">Složka Minicondy</span>
                    {' '}
                    <span id="diag-miniconda-path" className="diag-row-value" data-i18n="val.loading">Načítání…</span>
                  </div>
                </div>
                <div className="diag-row">
                  <div className="diag-row-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="22" y1="12" x2="2" y2="12"></line>
                      <path
                        d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
                      ></path>
                      <line x1="6" y1="16" x2="6.01" y2="16"></line>
                      <line x1="10" y1="16" x2="10.01" y2="16"></line>
                    </svg>
                  </div>
                  <div className="diag-row-text">
                    <span className="diag-row-label" data-i18n="diag.disk">Volné místo v úložišti</span>
                    {' '}
                    <span id="diag-disk-free" className="diag-row-value" data-i18n="val.loading">Načítání…</span>
                    {' '}
                    <span id="diag-storage-root" className="diag-row-path"></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="block-actions">
            <div className="block-actions-buttons">
              <button
                className="btn btn-xs btn-cyan-dashed btn-install-lerobot"
                onClick={(event: any) => { App.installLerobotFromSettings() }}
                data-i18n="btn.installLerobot"
                data-i18n-title="tip.installLerobot"
                title="Nainstaluje LeRobot a jeho závislosti do conda prostředí"
              >Instalovat / opravit prostředí LeRobot</button>
              {' '}
              <button
                className="btn btn-xs btn-primary btn-save-settings"
                data-i18n="settings.save"
                onClick={(event: any) => { App.saveGlobalSettings() }}
                data-i18n-title="tip.saveSettings"
                title="Zapíše popis scény, cestu k Pythonu, k repozitáři LeRobot a k úložišti datasetů"
              >Uložit Globální Nastavení</button>
            </div>
          </div>
        </div>
        {/* /.setup-block.settings-block */}
      </div>
      {/* /.setup-wizard-panel[paths] */}
      <div className="setup-wizard-panel" data-tab-panel="tools" style={{ display: "none" }}>
        <div className="setup-block" style={{ display: "flex", flexDirection: "column" }}>
          <div className="block-head-row">
            <h3 style={{ margin: "0" }}>
              <span data-i18n="blk.tools.title">Nástroje LeRobot CLI</span>
            </h3>
          </div>
          <div className="setup-block-content">
            <div className="tools-grid">
              {/* find-cameras */}
              <div className="tool-card">
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
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </svg>
                  {' '}
                  <span data-i18n="blk.tool.cams">Detekce kamer</span>
                </h3>
                <p className="tool-desc" data-i18n-html="tool.cams.desc">
                  Najde připojené kamery a uloží testovací snímky (
                  <code>lerobot-find-cameras</code>
                  ).
                </p>
                <div className="form-group">
                  <div className="label-with-tooltip">
                    <label htmlFor="tool-cam-backend" data-i18n="lbl.camTypeFilter">Typ kamer</label>
                    {' '}
                    <span className="info-tooltip-trigger" data-i18n-tooltip="tip.toolCamBackend">ⓘ</span>
                  </div>
                  <select id="tool-cam-backend">
                    <option value="" data-i18n="opt.all">Všechny</option>
                    <option value="opencv">OpenCV (USB webkamery)</option>
                    <option value="realsense">Intel RealSense</option>
                  </select>
                </div>
                <button
                  className="btn btn-xs btn-primary tool-run-btn"
                  onClick={(event: any) => { App.runHwTool('find_cameras') }}
                  data-i18n="btn.runDetect"
                >Spustit detekci</button>
              </div>
              {/* find-port */}
              <div className="tool-card">
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
                    <path d="M4 17l6-6-6-6M12 19h8"></path>
                  </svg>
                  {' '}
                  <span data-i18n="blk.tool.port">Detekce sériového portu</span>
                </h3>
                <p className="tool-desc" data-i18n-html="tool.port.desc">
                  Interaktivní průvodce odpojením USB kabelu (
                  <code>lerobot-find-port</code>
                  ). Odpovídejte v terminálu dole.
                </p>
                <button
                  className="btn btn-xs btn-primary tool-run-btn"
                  onClick={(event: any) => { App.runHwTool('find_port') }}
                  data-i18n="btn.runWizardTool"
                >Spustit průvodce</button>
              </div>
              {/* setup-motors */}
              <div className="tool-card">
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
                      d="M12 1v6m0 10v6M5.6 5.6l4.2 4.2m4.4 4.4l4.2 4.2M1 12h6m10 0h6M5.6 18.4l4.2-4.2m4.4-4.4l4.2-4.2"
                    ></path>
                  </svg>
                  {' '}
                  <span data-i18n="blk.tool.motors">Nastavení ID motorů</span>
                </h3>
                <p className="tool-desc" data-i18n-html="tool.motors.desc">
                  Přiřadí ID servomotorům nového ramene — připojujte motory jeden po druhém dle pokynů v terminálu (
                  <code>lerobot-setup-motors</code>
                  ).
                </p>
                <div className="form-group">
                  <div className="label-with-tooltip">
                    <label htmlFor="tool-motors-arm" data-i18n="lbl.arm">Rameno</label>
                    {' '}
                    <span className="info-tooltip-trigger" data-i18n-tooltip="tip.toolMotorsArm">ⓘ</span>
                  </div>
                  <select id="tool-motors-arm">
                    <option value="follower" data-i18n="opt.followerExec">Follower (vykonávací)</option>
                    <option value="leader" data-i18n="opt.leaderCtrl">Leader (řídicí)</option>
                  </select>
                </div>
                <button
                  className="btn btn-xs btn-primary tool-run-btn"
                  onClick={(event: any) => { App.runHwTool('setup_motors') }}
                  data-i18n="btn.runSetup"
                >Spustit nastavení</button>
              </div>
              {/* find-joint-limits */}
              <div className="tool-card">
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
                    <path d="M21 12a9 9 0 1 1-9-9"></path>
                    <path d="M12 7v5l3 3"></path>
                  </svg>
                  {' '}
                  <span data-i18n="blk.tool.limits">Limity kloubů</span>
                </h3>
                <p className="tool-desc" data-i18n-html="tool.limits.desc">
                  Změří minimální a maximální rozsahy kloubů pohybem leader ramene (
                  <code>lerobot-find-joint-limits</code>
                  ).
                </p>
                <button
                  className="btn btn-xs btn-primary tool-run-btn"
                  onClick={(event: any) => { App.runHwTool('find_joint_limits') }}
                  data-i18n="btn.measureLimits"
                >Změřit limity</button>
              </div>
              {/* info */}
              <div className="tool-card">
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
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  {' '}
                  <span data-i18n="blk.tool.info">Systémové info LeRobot</span>
                </h3>
                <p className="tool-desc" data-i18n-html="tool.info.desc">
                  Vypíše verzi LeRobotu, PyTorch, CUDA a prostředí (
                  <code>lerobot-info</code>
                  ).
                </p>
                <button
                  className="btn btn-xs btn-primary tool-run-btn"
                  onClick={(event: any) => { App.runHwTool('info') }}
                  data-i18n="btn.showInfo"
                >Zobrazit info</button>
              </div>
              {/* HF login */}
              <div className="tool-card">
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
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                    <polyline points="10 17 15 12 10 7"></polyline>
                    <line x1="15" y1="12" x2="3" y2="12"></line>
                  </svg>
                  {' '}
                  <span data-i18n="blk.tool.hf">Hugging Face přihlášení</span>
                </h3>
                <p className="tool-desc" data-i18n-html="tool.hf.desc">
                  Přihlášení k HF Hub pro nahrávání datasetů a modelů. Token se nezobrazí v konzoli.
                </p>
                <div className="form-group">
                  <div className="label-with-tooltip">
                    <label htmlFor="tool-hf-token" data-i18n="lbl.hfToken">Access token (write)</label>
                    {' '}
                    <span className="info-tooltip-trigger" data-i18n-tooltip="tip.hfToken">ⓘ</span>
                  </div>
                  <input
                    type="password"
                    id="tool-hf-token"
                    placeholder="hf_..."
                    autoComplete="off"
                    style={{ fontFamily: "var(--font-mono)", fontSize: "12.5px" }}
                  />
                </div>
                <button
                  className="btn btn-xs btn-primary tool-run-btn"
                  onClick={(event: any) => { App.hfLogin() }}
                  data-i18n="btn.login"
                >Přihlásit se</button>
              </div>
            </div>
          </div>
        </div>
        {/* /.setup-block */}
      </div>
      {/* /.setup-wizard-panel[tools] */}
    </div>
  );
}
