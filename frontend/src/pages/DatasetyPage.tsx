/** #page-datasety — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';
import { initiallyDisabled } from '../util/initiallyDisabled';

export function DatasetyPage() {
  return (
    <div id="page-datasety" className="editor-area">
      <div className="page-header-row">
        <h2 data-i18n="page.datasety.title">Datasety — Sběr dat a správa</h2>
      </div>
      <div className="setup-wizard-tabs">
        <button
          className="setup-wizard-tab-btn active"
          data-tab="collect"
          onClick={(event: any) => { App.switchDatasetyTab('collect') }}
        >
          <span data-i18n="tab.datasety.collect">Sběr dat & Dovednosti</span>
        </button>
        {' '}
        <button
          className="setup-wizard-tab-btn"
          data-tab="manage"
          onClick={(event: any) => { App.switchDatasetyTab('manage') }}
        >
          <span data-i18n="tab.datasety.manage">Správa datasetů</span>
        </button>
      </div>
      <div className="setup-wizard-panel" data-tab-panel="collect">
        <div className="datacollection-grid">
          <div className="datacollection-block">
            <div className="datacollection-block-header">
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
                <path
                  d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-4.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2z"
                ></path>
              </svg>
              {' '}
              <span data-i18n="blk.dc.skillTree">Strom dovedností</span>
            </div>
            <div className="datacollection-block-body" style={{ padding: "0", overflowY: "auto" }}>
              <div id="skill-list-full" style={{ padding: "8px 0" }}>{/* Collapsible skills tree populated dynamically */}</div>
            </div>
            <div className="block-actions">
              <button
                className="btn btn-xs btn-primary"
                onClick={(event: any) => { App.showNewSkillModal('') }}
                data-i18n="btn.addSkill"
                data-i18n-title="tip.addSkill"
                title="Vytvořit novou hlavní dovednost / cíl"
              >+ Dovednost</button>
              {' '}
              <button
                className="btn btn-xs btn-secondary"
                onClick={(event: any) => { App.exportAllDatasets() }}
                data-i18n="btn.exportZip"
                data-i18n-title="tip.exportZip"
                title="Exportovat všechny dovednosti do ZIP archivu"
              >Exportovat (.zip)</button>
            </div>
          </div>
          <div className="datacollection-block">
            <div className="datacollection-block-header">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <circle cx="12" cy="12" r="10"></circle>
              </svg>
              {' '}
              <span data-i18n="blk.dc.recording">Nahrávání (lerobot-record)</span>
            </div>
            <div className="datacollection-block-body">
              <div id="rec-empty-state" className="empty-state" style={{ flex: "1" }}>
                <div className="empty-state-icon">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <circle cx="12" cy="12" r="6"></circle>
                    <circle cx="12" cy="12" r="2"></circle>
                  </svg>
                </div>
                <div
                  className="empty-state-text"
                  style={{ maxWidth: "230px" }}
                  data-i18n-html="hint.recSelectSkill"
                >
                  Vyberte konkrétní{' '}
                  <strong>dovednost / sub-skill</strong>
                  {' '}ze seznamu dovedností vlevo.
                </div>
              </div>
              <div
                id="rec-active-panel"
                style={{ display: "none", flexDirection: "column", gap: "10px", flex: "1" }}
              >
                {/* hardware setup warnings */}
                <div
                  id="rec-hw-warning"
                  style={{ display: "none", background: "rgba(218, 55, 60, 0.12)", border: "1px solid var(--red)", color: "var(--red)", padding: "8px 10px", fontSize: "12.5px" }}
                >
                  <strong style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "2px" }}>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path
                        d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                      ></path>
                      <line x1="12" y1="9" x2="12" y2="13"></line>
                      <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    {' '}Chyba hardwaru
                  </strong>
                  {' '}
                  <span id="rec-hw-warning-text" data-i18n="rec.warnDefault">Zkontrolujte porty a přiřazení kamer.</span>
                </div>
                <div className="active-skill-stats-row">
                  <span>
                    <span data-i18n="lbl.skillColon">Dovednost:</span>
                    {' '}
                    <strong id="active-sub-skill-title" style={{ color: "var(--cyan)" }}>pick_cube</strong>
                  </span>
                  {' '}
                  <span>
                    <span data-i18n="lbl.demosColon">Demonstrace:</span>
                    {' '}
                    <strong id="active-skill-episodes" style={{ color: "var(--green)" }}>0 ep</strong>
                  </span>
                  {' '}
                  <span>
                    <span data-i18n="lbl.sizeColon">Velikost:</span>
                    {' '}
                    <strong id="active-skill-size">—</strong>
                  </span>
                  {' '}
                  <span>
                    <span data-i18n="lbl.policyColon">Policy:</span>
                    {' '}
                    <strong id="active-skill-training">—</strong>
                  </span>
                </div>
                {/* Two-column config grid. A single column stretched every input to the full width of the panel (~990 px at 1600×900), which is what the brief calls out as the main layout defect. */}
                <div className="rec-config-grid">
                  <div className="form-group rec-cfg-wide">
                    <div className="label-with-tooltip">
                      <label htmlFor="rec-repo-id">Dataset Repo ID</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.recRepoId">ⓘ</span>
                    </div>
                    <input
                      type="text"
                      id="rec-repo-id"
                      style={{ fontSize: "13.5px", fontFamily: "var(--font-mono)" }}
                      readOnly={true}
                    />
                  </div>
                  <div className="form-group">
                    <div className="label-with-tooltip">
                      <label htmlFor="rec-episodes" data-i18n="lbl.episodes">Epizody</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.recEpisodes">ⓘ</span>
                    </div>
                    <input
                      type="number"
                      id="rec-episodes"
                      defaultValue="50"
                      min="1"
                      style={{ fontSize: "13.5px", fontFamily: "var(--font-mono)" }}
                    />
                  </div>
                  <div className="form-group">
                    <div className="label-with-tooltip">
                      <label htmlFor="rec-duration" data-i18n="lbl.maxEpTime">Max čas / ep. (s)</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.recDuration">ⓘ</span>
                    </div>
                    <input
                      type="number"
                      id="rec-duration"
                      defaultValue="15"
                      min="1"
                      style={{ fontSize: "13.5px", fontFamily: "var(--font-mono)" }}
                    />
                  </div>
                  <div className="form-group rec-cfg-wide">
                    <div className="label-with-tooltip">
                      <label htmlFor="rec-task-desc" data-i18n="lbl.taskDesc">Popis úkolu — single_task anotace (povinné v LeRobot)</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.recTaskDesc">ⓘ</span>
                    </div>
                    <input
                      type="text"
                      id="rec-task-desc"
                      defaultValue="Uchop kostku a zvedni ji"
                      style={{ fontSize: "13.5px" }}
                    />
                  </div>
                  <div className="form-group rec-cfg-wide">
                    <div className="label-with-tooltip">
                      <label htmlFor="rec-dataset-storage-dir" data-i18n="lbl.dataStorageFolder">Složka pro ukládání dat (HF Cache)</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.dataStorageFolder">ⓘ</span>
                    </div>
                    <input
                      type="text"
                      id="rec-dataset-storage-dir"
                      placeholder="např. /home/verlyba/OrchidayProjects/data (volitelné)"
                      style={{ fontSize: "13.5px" }}
                      onChange={(event: any) => { App.syncDatasetStorageDir('rec-dataset-storage-dir') }}
                      data-i18n-ph="ph.dataDir"
                    />
                  </div>
                  <div className="form-group rec-cfg-wide">
                    <div className="label-with-tooltip">
                      <label htmlFor="rec-extra-args" data-i18n="lbl.extraArgsRecord">Vlastní LeRobot CLI argumenty (Sběr dat)</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.recExtraArgs">ⓘ</span>
                    </div>
                    <input
                      type="text"
                      id="rec-extra-args"
                      placeholder="např. --dataset.streaming_encoding=true"
                      style={{ fontSize: "13.5px", fontFamily: "var(--font-mono)" }}
                      data-i18n-ph="ph.recExtra"
                    />
                  </div>
                  <div className="rec-cfg-flags">
                    <div className="rec-cfg-flag">
                      <input type="checkbox" id="rec-push-hub" />
                      {' '}
                      <label htmlFor="rec-push-hub">PUSH TO HF HUB</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.recPushHub">ⓘ</span>
                    </div>
                    <div
                      className="rec-cfg-flag"
                      title="Pokračovat v nahrávání do existujícího datasetu (--resume=true)"
                    >
                      <input type="checkbox" id="rec-resume" />
                      {' '}
                      <label htmlFor="rec-resume" data-i18n="lbl.resume">POKRAČOVAT (RESUME)</label>
                    </div>
                  </div>
                </div>
                {/* Clickable Step Control buttons during recording! */}
                {/* Maps 1:1 onto lerobot_record's control flags: exit_early (Right / n), rerecord_episode (Left / r), stop_recording (Esc / q). */}
                <div id="rec-live-controls" className="rec-live-controls" style={{ display: "none" }}>
                  <span className="panel-toolbar-label" data-i18n="hint.liveRecCtrl">Řízení nahrávání</span>
                  <div className="rec-live-buttons">
                    <button
                      className="btn btn-xs btn-success"
                      onClick={(event: any) => { App.sendRecordingAction('next') }}
                      title="Ukončí aktuální epizodu dřív a uloží ji (lerobot: exit_early — klávesa → / n)"
                      data-i18n="btn.nextEpisode"
                    >Uložit epizodu a pokračovat</button>
                    {' '}
                    <button
                      className="btn btn-xs btn-secondary"
                      onClick={(event: any) => { App.sendRecordingAction('reset') }}
                      title="Zahodí aktuální epizodu a nahraje ji znovu (lerobot: rerecord_episode — klávesa ← / r)"
                      data-i18n="btn.discardRetry"
                    >Zahodit a opakovat</button>
                    {' '}
                    <button
                      className="btn btn-xs btn-danger"
                      onClick={(event: any) => { App.sendRecordingAction('stop') }}
                      title="Ukončí celé nahrávání a uloží dataset (lerobot: stop_recording — klávesa Esc / q)"
                      data-i18n="btn.finishSave"
                    >Ukončit nahrávání</button>
                  </div>
                </div>
                {/* Recording is a loop of phases, not a page of settings: lerobot_record alternates capture with an unrecorded reset pause, and the marks only mean anything during capture. The rail says which one is live. */}
                <ol className="phase-rail" id="rec-rail">
                  <li data-step="1">
                    <span className="phase-rail-n">1</span>
                    <span data-i18n="rec.step1.short">Příprava</span>
                  </li>
                  <li data-step="2">
                    <span className="phase-rail-n">2</span>
                    <span data-i18n="rec.step2.short">Nahrávání epizody</span>
                  </li>
                  <li data-step="3">
                    <span className="phase-rail-n">3</span>
                    <span data-i18n="rec.step3.short">Reset scény</span>
                  </li>
                  <li data-step="4">
                    <span className="phase-rail-n">4</span>
                    <span data-i18n="rec.step4.short">Uložení datasetu</span>
                  </li>
                </ol>
                <div className="phase-now">
                  <h4 className="phase-now-title" id="rec-now-title" data-i18n="rec.now.idle.title">Nahrávání neběží</h4>
                  <p className="phase-now-text" id="rec-now-text" data-i18n="rec.now.idle.text">
                    Vyberte dovednost vlevo, zkontrolujte nastavení a spusťte nahrávání tlačítkem dole.
                  </p>
                  <div className="phase-now-actions">
                    <button
                      className="btn btn-xs btn-secondary"
                      onClick={(event: any) => { App.openModal('modal-record-keys') }}
                      data-i18n="btn.recKeys"
                    >Klávesy během nahrávání</button>
                  </div>
                </div>
              </div>
              {/* /#rec-active-panel */}
            </div>
            {/* /.datacollection-block-body */}
            <div className="block-actions">
              <button
                className="btn btn-xs btn-primary"
                id="btn-start-record"
                onClick={(event: any) => { App.startWorkflowRecord() }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <circle cx="12" cy="12" r="10"></circle>
                </svg>
                {' '}
                <span data-i18n="btn.startRecording">Spustit nahrávání</span>
              </button>
              {' '}
              <button
                className="btn btn-xs btn-danger"
                id="btn-stop-record"
                onClick={(event: any) => { App.stopWorkflowRecord() }}
                ref={initiallyDisabled}
                title="Nahrávání neběží"
                data-i18n="btn.stopRecording"
              >Zastavit nahrávání</button>
            </div>
          </div>
          {/* /.datacollection-block */}
          {/* Column 3 — sub-task boundary marking, the thing this whole project is about. Marks are timestamped inside the lerobot-record process from the frames already written to the episode (LeRobot stores a frame timestamp as frame_index / fps), so they line up with the column the dataset splitter cuts on. The panel is visible before recording too: whether a skill can feed the orchestration branch at all is decided by its sub-step list, and that has to be readable BEFORE the take, not during. */}
          <div className="datacollection-block">
            <div className="datacollection-block-header">
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
                <path d="M12 2v20"></path>
                <path d="M5 7h14"></path>
                <path d="M5 17h14"></path>
              </svg>
              {' '}
              <span data-i18n="blk.dc.marking">Značkování pod-úkolů</span>
            </div>
            <div className="datacollection-block-body">
              <div id="rec-tagging-wizard" className="tagging-panel">
                <div className="tagging-header">
                  <span className="sidebar-subtitle" data-i18n="hint.activeTagging">Aktivní fázování (Active Tagging)</span>
                  {' '}
                  <span className="tag tag-idle" id="rec-tagging-phase" data-i18n="rec.phaseIdle">Nenahrává se</span>
                </div>
                <div id="rec-step-verdict" className="rec-verdict">
                  {/* Populated by renderStepPlan(): ACT + orchestrace vs jen ACT baseline */}
                </div>
                <div id="rec-tagging-steps" className="tagging-steps">{/* Populated dynamically: ordered sub-steps with their state */}</div>
                <div className="tagging-actions">
                  <button
                    className="btn btn-xs btn-success-light"
                    id="btn-tagging-next"
                    onClick={(event: any) => { App.taggingNextStep() }}
                    data-i18n-title="rec.markPhaseEndTip"
                    title="Uloží hranici mezi aktuální a následující fází na aktuálním snímku epizody (klávesa mezerník / M)"
                    ref={initiallyDisabled}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                    {' '}
                    <span data-i18n="rec.markPhaseEnd">Označit konec fáze</span>
                  </button>
                  {' '}
                  <button
                    className="btn btn-xs btn-secondary"
                    id="btn-tagging-undo"
                    onClick={(event: any) => { App.taggingUndoStep() }}
                    data-i18n-title="rec.undoMarkTip"
                    title="Vrátit poslední značku (překlik) — klávesa Backspace / U"
                    ref={initiallyDisabled}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="9 14 4 9 9 4"></polyline>
                      <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
                    </svg>
                    {' '}
                    <span data-i18n="rec.undoMark">Zpět</span>
                  </button>
                </div>
                <div className="tagging-meta">
                  <span>
                    <span data-i18n="rec.episodeLbl">Epizoda</span>
                    :{' '}
                    <strong id="rec-tagging-episode">–</strong>
                  </span>
                  {' '}
                  <span>
                    <span data-i18n="rec.timeLbl">Čas</span>
                    :{' '}
                    <strong id="rec-tagging-timer">0.0s</strong>
                  </span>
                  {' '}
                  <span>
                    <span data-i18n="rec.marksLbl">Značky</span>
                    :{' '}
                    <strong id="rec-tagging-points" className="is-count">0</strong>
                  </span>
                </div>
              </div>
              <div className="rec-episodes">
                <span className="sidebar-subtitle" data-i18n="hint.recordedEps">Nahrané epizody (demonstrace)</span>
                <div id="rec-episodes-list-container" className="rec-episodes-list">{/* Populated dynamically via JS */}</div>
              </div>
            </div>
            <div className="block-actions">
              <button
                className="btn btn-xs btn-secondary"
                id="btn-rec-open-manage"
                onClick={(event: any) => { App.switchDatasetyTab('manage') }}
                data-i18n="btn.openDatasetManage"
                data-i18n-title="tip.openDatasetManage"
                title="Přepne na kartu Správa datasetů"
              >Přejít na správu datasetů</button>
            </div>
          </div>
          {/* /.datacollection-block (marking) */}
        </div>
        {/* /.datacollection-grid */}
      </div>
      {/* /.setup-wizard-panel[collect] */}
      {/* ── Tab 2: Správa datasetů ────────────────────────────────── */}
      <div className="setup-wizard-panel" data-tab-panel="manage" style={{ display: "none" }}>
        <div className="setup-section" style={{ gridTemplateColumns: "1fr" }}>
          <div className="setup-block" style={{ display: "flex", flexDirection: "column" }}>
            <div className="block-head-row">
              <h3 style={{ margin: "0" }}>
                <span data-i18n="blk.manage.title"></span>
              </h3>
            </div>
            <div className="setup-block-content">
              <div className="merge-cols">
                <section className="merge-col">
                  <h4 className="merge-col-title" data-i18n="blk.ds.local">Lokální datasety dovedností</h4>
                  <div
                    className="setup-block-content"
                    style={{ flex: "1", display: "flex", flexDirection: "column", gap: "10px" }}
                  >
                    <div className="form-group">
                      <div className="label-with-tooltip">
                        <label htmlFor="ds-select" data-i18n="lbl.dsFromTree">Dataset (z projektového stromu dovedností)</label>
                        {' '}
                        <span className="info-tooltip-trigger" data-i18n-tooltip="tip.dsSelect">ⓘ</span>
                      </div>
                      <select id="ds-select" onChange={(event: any) => { App.dsOnSelect() }}>
                        <option value="" data-i18n="opt.noDatasets">-- Žádné datasety --</option>
                      </select>
                    </div>
                    <div id="ds-info-box" className="ds-info-box">
                      <div className="ds-stat">
                        <span className="ds-stat-label">Stav na disku</span>
                        <strong id="ds-info-exists" className="ds-stat-value">—</strong>
                      </div>
                      <div className="ds-stat">
                        <span className="ds-stat-label">Epizody</span>
                        <strong id="ds-info-episodes" className="ds-stat-value">—</strong>
                      </div>
                      <div className="ds-stat">
                        <span className="ds-stat-label">FPS</span>
                        <strong id="ds-info-fps" className="ds-stat-value">—</strong>
                      </div>
                      <div className="ds-stat">
                        <span className="ds-stat-label">Velikost</span>
                        <strong id="ds-info-size" className="ds-stat-value">—</strong>
                      </div>
                    </div>
                    <div className="form-group">
                      <div className="label-with-tooltip">
                        <label htmlFor="ds-viz-episode" data-i18n="lbl.vizEpisode">Epizoda pro vizualizaci (Rerun)</label>
                        {' '}
                        <span className="info-tooltip-trigger" data-i18n-tooltip="tip.dsVizEpisode">ⓘ</span>
                      </div>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <input
                          type="number"
                          id="ds-viz-episode"
                          defaultValue="0"
                          min="0"
                          style={{ width: "80px", fontFamily: "var(--font-mono)", fontSize: "13.5px" }}
                        />
                        {' '}
                        <button
                          className="btn btn-xs btn-secondary"
                          id="ds-btn-viz"
                          onClick={(event: any) => { App.dsVisualize() }}
                          ref={initiallyDisabled}
                          data-i18n="btn.visualize"
                        >Vizualizovat</button>
                        {' '}
                        <button
                          className="btn btn-xs btn-secondary"
                          id="ds-btn-replay"
                          onClick={(event: any) => { App.startReplay() }}
                          ref={initiallyDisabled}
                          title="Přehraje epizodu na reálném follower rameni (lerobot-replay)"
                          data-i18n="btn.replay"
                        >Přehrát na rameni</button>
                        {' '}
                        <button
                          className="btn btn-xs btn-secondary"
                          id="ds-btn-info"
                          onClick={(event: any) => { App.dsRunOp('info') }}
                          ref={initiallyDisabled}
                          title="Vypíše metadata datasetu do konzole"
                          data-i18n="btn.detailInfo"
                        >Detailní info</button>
                        {' '}
                        <button
                          className="btn btn-xs btn-secondary"
                          id="ds-btn-stats"
                          onClick={(event: any) => { App.dsRunOp('recompute_stats') }}
                          ref={initiallyDisabled}
                          title="Přepočítá normalizační statistiky (nutné po ruční úpravě dat)"
                          data-i18n="btn.recomputeStats"
                        >Přepočítat statistiky</button>
                      </div>
                    </div>
                    <div
                      className="form-group"
                      style={{ borderTop: "1px solid var(--border)", paddingTop: "12px" }}
                    >
                      <div className="label-with-tooltip">
                        <label htmlFor="ds-hub-id" data-i18n="lbl.publishHub">Publikovat na Hugging Face Hub</label>
                        {' '}
                        <span className="info-tooltip-trigger" data-i18n-tooltip="tip.dsHubId">ⓘ</span>
                      </div>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <input
                          type="text"
                          id="ds-hub-id"
                          placeholder="uzivatel/nazev_datasetu"
                          style={{ flex: "1", fontFamily: "var(--font-mono)", fontSize: "12.5px" }}
                        />
                        {' '}
                        <input
                          type="checkbox"
                          id="ds-hub-private"
                          defaultChecked={true}
                          style={{ width: "14px", height: "14px" }}
                        />
                        {' '}
                        <label
                          htmlFor="ds-hub-private"
                          style={{ fontSize: "11.5px", color: "var(--text-muted)", fontWeight: "700" }}
                        >PRIVATE</label>
                        {' '}
                        <span className="info-tooltip-trigger" data-i18n-tooltip="tip.dsHubPrivate">ⓘ</span>
                        {' '}
                        <button
                          className="btn btn-xs btn-primary"
                          id="ds-btn-push"
                          onClick={(event: any) => { App.dsPush() }}
                          ref={initiallyDisabled}
                          data-i18n="btn.pushHub"
                        >Push na Hub</button>
                      </div>
                    </div>
                  </div>
                  <div className="block-actions">
                    <button
                      className="btn btn-xs btn-secondary"
                      data-i18n="btn.refreshList"
                      onClick={(event: any) => { App.dsRefreshList() }}
                      data-i18n-title="tip.refreshList"
                      title="Znovu načte seznam datasetů a jejich stav na disku"
                    >Obnovit seznam</button>
                    {' '}
                    <button
                      className="btn btn-xs btn-secondary"
                      data-i18n="btn.importModel"
                      onClick={(event: any) => { App.importSkillModel() }}
                      data-i18n-title="tip.importModel"
                      title="Importovat natrénovaný model (checkpoint) z jiného zařízení"
                    >Importovat model</button>
                    {' '}
                    <button
                      className="btn btn-xs btn-secondary"
                      id="ds-btn-export-model"
                      onClick={(event: any) => { App.exportSkillModel(App.dsSelectedSkill()) }}
                      ref={initiallyDisabled}
                      data-i18n="btn.exportModel"
                      data-i18n-title="tip.exportModel"
                      title="Exportovat natrénovaný model vybrané dovednosti"
                    >Exportovat model</button>
                    {' '}
                    <button
                      className="btn btn-xs btn-primary"
                      id="ds-btn-split-steps"
                      onClick={(event: any) => { App.splitDatasetSteps() }}
                      ref={initiallyDisabled}
                      data-i18n="btn.splitSteps"
                      data-i18n-title="tip.splitSteps"
                      title="Rozdělit dataset podle značek kroků na dílčí datasety pro trénink orchestrace"
                    >Rozdělit podle kroků</button>
                  </div>
                </section>
                <section className="merge-col">
                  <h4 className="merge-col-title" data-i18n="blk.ds.ops">Operace s datasetem (lerobot-edit-dataset)</h4>
                  <div
                    className="setup-block-content"
                    style={{ flex: "1", display: "flex", flexDirection: "column", gap: "14px", overflowY: "auto" }}
                  >
                    <div className="ds-op-row">
                      <div className="form-group" style={{ flex: "1" }}>
                        <div className="label-with-tooltip">
                          <label htmlFor="ds-del-indices" data-i18n="lbl.deleteEpisodes">Smazat epizody (indexy oddělené čárkou)</label>
                          {' '}
                          <span className="info-tooltip-trigger" data-i18n-tooltip="tip.dsDelIndices">ⓘ</span>
                        </div>
                        <input
                          type="text"
                          id="ds-del-indices"
                          placeholder="např. 0, 2, 5"
                          style={{ fontFamily: "var(--font-mono)", fontSize: "13.5px" }}
                          data-i18n-ph="ph.delIndices"
                        />
                      </div>
                      <button
                        className="btn btn-xs btn-danger"
                        id="ds-btn-del"
                        onClick={(event: any) => { App.dsDeleteEpisodes() }}
                        ref={initiallyDisabled}
                        data-i18n="btn.delete"
                      >Smazat</button>
                    </div>
                    <div className="ds-op-row">
                      <div className="form-group" style={{ flex: "1" }}>
                        <div className="label-with-tooltip">
                          <label htmlFor="ds-newtask" data-i18n="lbl.changeTaskAnno">Změnit textovou anotaci úkolu (všechny epizody)</label>
                          {' '}
                          <span className="info-tooltip-trigger" data-i18n-tooltip="tip.dsNewTask">ⓘ</span>
                        </div>
                        <input
                          type="text"
                          id="ds-newtask"
                          placeholder="např. Pick up the cube and place it in the bowl"
                          style={{ fontSize: "13.5px" }}
                        />
                      </div>
                      <button
                        className="btn btn-xs btn-secondary"
                        id="ds-btn-task"
                        onClick={(event: any) => { App.dsModifyTask() }}
                        ref={initiallyDisabled}
                        data-i18n="btn.rewriteTask"
                      >Přepsat task</button>
                    </div>
                    <div className="ds-op-row">
                      <div className="form-group" style={{ width: "110px" }}>
                        <div className="label-with-tooltip">
                          <label htmlFor="ds-split-train" data-i18n="lbl.trainSplit">Train podíl</label>
                          {' '}
                          <span className="info-tooltip-trigger" data-i18n-tooltip="tip.dsSplitTrain">ⓘ</span>
                        </div>
                        <input
                          type="number"
                          id="ds-split-train"
                          defaultValue="0.8"
                          min="0.1"
                          max="0.95"
                          step="0.05"
                          style={{ fontFamily: "var(--font-mono)", fontSize: "13.5px" }}
                        />
                      </div>
                      <div
                        style={{ flex: "1", fontSize: "11.5px", color: "var(--text-muted)", alignSelf: "center" }}
                        data-i18n-html="hint.dsSplit"
                      >
                        Rozdělí dataset na{' '}
                        <code>train</code>
                        /
                        <code>val</code>
                        {' '}části.
                      </div>
                      <button
                        className="btn btn-xs btn-secondary"
                        id="ds-btn-split"
                        onClick={(event: any) => { App.dsSplit() }}
                        ref={initiallyDisabled}
                        data-i18n="btn.split"
                      >Rozdělit</button>
                    </div>
                    <div className="ds-op-row">
                      <div className="form-group" style={{ flex: "1" }}>
                        <div className="label-with-tooltip">
                          <label htmlFor="ds-merge-source" data-i18n="lbl.mergeWith">Sloučit s datasetem (repo id)</label>
                          {' '}
                          <span className="info-tooltip-trigger" data-i18n-tooltip="tip.dsMergeSource">ⓘ</span>
                        </div>
                        <select id="ds-merge-source">
                          <option value="" data-i18n="opt.selectSecondDs">-- Vyberte druhý dataset --</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ flex: "1" }}>
                        <div className="label-with-tooltip">
                          <label htmlFor="ds-merge-target" data-i18n="lbl.newRepoId">Nový repo id</label>
                          {' '}
                          <span className="info-tooltip-trigger" data-i18n-tooltip="tip.dsMergeTarget">ⓘ</span>
                        </div>
                        <input
                          type="text"
                          id="ds-merge-target"
                          placeholder="local/merged_dataset"
                          style={{ fontFamily: "var(--font-mono)", fontSize: "13.5px" }}
                        />
                      </div>
                      <button
                        className="btn btn-xs btn-secondary"
                        id="ds-btn-merge"
                        onClick={(event: any) => { App.dsMerge() }}
                        ref={initiallyDisabled}
                        data-i18n="btn.merge"
                      >Sloučit</button>
                    </div>
                    <div
                      style={{ fontSize: "11.5px", color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: "8px", lineHeight: "1.5" }}
                      data-i18n-html="desc.dsOps"
                    >
                      Operace se provádějí{' '}
                      <strong>na místě</strong>
                      {' '}— LeRobot vytvoří zálohu původního datasetu. Průběh sledujte v terminálové konzoli. Po smazání epizod či úpravách doporučujeme spustit „Přepočítat statistiky“.
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* /.setup-wizard-panel[manage] */}
    </div>
  );
}
