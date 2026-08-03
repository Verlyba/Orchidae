/**
 * #page-datasety — the collect tab is still the markup migrated verbatim from
 * the pre-React web/index.html; the manage tab below renders from
 * `state/datasets` instead of from innerHTML strings and `el.disabled = …`
 * writes in `legacy/app.ts`.
 */

import { App } from '../legacy/app';
import { initiallyDisabled } from '../util/initiallyDisabled';
import { useDatasets, type DatasetsSnapshot } from '../state/datasets';

/** Placeholder shown while a value is being fetched — never a blank field. */
const PENDING = '…';

/**
 * "Správa datasetů" — one dataset picked from the project's skill tree, its
 * on-disk facts, and every operation LeRobot offers over it.
 *
 * Which buttons are live is derived here from the published snapshot, not
 * pushed in by `el.disabled = false` from app.ts: React decides whether to
 * dispatch a click from PROPS, so a button whose props say `disabled` swallows
 * clicks no matter what the DOM property says.
 */
function DatasetManagePanel() {
  const ds: DatasetsSnapshot = useDatasets();
  const busy = !!ds.busyOp;
  // Every operation below rewrites or reads the dataset directory, so all of
  // them need it to exist. Until the detail answer is in we do not know.
  const opsEnabled = !!ds.info?.exists && !ds.detailLoading && !busy;
  const opTitle = (key: string) => (ds.info?.exists ? App.t(key) : App.t('tip.dsOpsNeedDataset'));
  const opLabel = (op: string, key: string) => (ds.busyOp === op ? App.t('btn.startingShort') : App.t(key));
  const stat = (v: string) => (ds.detailLoading ? PENDING : v);
  const info = ds.info;

  const options = ds.datasets.map(d => (
    <option key={d.repo_id} value={d.repo_id}>
      {d.name} — {d.repo_id}{d.exists ? '' : ` (${App.t('val.dsNotRecorded')})`}
    </option>
  ));

  return (
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
                    {ds.refreshing ? (
                      <span className="field-note pulse-light-cyan">{App.t('val.loadingShort')}</span>
                    ) : null}
                  </div>
                  <select
                    id="ds-select"
                    value={ds.selectedRepo}
                    onChange={(e) => App.dsSelect(e.target.value)}
                    disabled={!ds.datasets.length}
                  >
                    {ds.datasets.length ? options : <option value="">{App.t('opt.noDatasets')}</option>}
                  </select>
                </div>
                <div id="ds-info-box" className="ds-info-box">
                  <div className="ds-stat">
                    <span className="ds-stat-label" data-i18n="lbl.dsDiskState">Stav na disku</span>
                    <strong id="ds-info-exists" className="ds-stat-value">
                      {stat(info ? App.t(info.exists ? 'val.dsOnDisk' : 'val.dsMissing') : '—')}
                    </strong>
                  </div>
                  <div className="ds-stat">
                    <span className="ds-stat-label" data-i18n="lbl.episodes">Epizody</span>
                    <strong id="ds-info-episodes" className="ds-stat-value">
                      {stat(info?.exists ? String(info.episodes) : '—')}
                    </strong>
                  </div>
                  <div className="ds-stat">
                    <span className="ds-stat-label" data-i18n="lbl.dsFps">FPS</span>
                    <strong id="ds-info-fps" className="ds-stat-value">
                      {stat(info?.exists ? String(info.fps) : '—')}
                    </strong>
                  </div>
                  <div className="ds-stat">
                    <span className="ds-stat-label" data-i18n="lbl.dsSize">Velikost</span>
                    <strong id="ds-info-size" className="ds-stat-value">
                      {stat(info?.exists ? App.t('val.dsMegabytes', { n: info.sizeMb }) : '—')}
                    </strong>
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
                      onClick={() => App.dsVisualize()}
                      disabled={!opsEnabled}
                      title={opTitle('tip.dsVisualize')}
                    >{App.t('btn.visualize')}</button>
                    {' '}
                    <button
                      className="btn btn-xs btn-secondary"
                      id="ds-btn-replay"
                      onClick={() => App.startReplay()}
                      disabled={!opsEnabled}
                      title={opTitle('tip.dsReplay')}
                    >{App.t('btn.replay')}</button>
                    {' '}
                    <button
                      className="btn btn-xs btn-secondary"
                      id="ds-btn-info"
                      onClick={() => App.dsRunOp('info')}
                      disabled={!opsEnabled}
                      title={opTitle('tip.dsInfo')}
                    >{opLabel('info', 'btn.detailInfo')}</button>
                    {' '}
                    <button
                      className="btn btn-xs btn-secondary"
                      id="ds-btn-stats"
                      onClick={() => App.dsRunOp('recompute_stats')}
                      disabled={!opsEnabled}
                      title={opTitle('tip.dsStats')}
                    >{opLabel('recompute_stats', 'btn.recomputeStats')}</button>
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
                      onClick={() => App.dsPush()}
                      disabled={!opsEnabled}
                      title={opTitle('tip.dsPush')}
                    >{ds.busyOp === 'push' ? App.t('btn.dsPushing') : App.t('btn.pushHub')}</button>
                  </div>
                </div>
              </div>
              <div className="block-actions">
                <button
                  className="btn btn-xs btn-secondary"
                  onClick={() => App.dsRefreshList()}
                  disabled={ds.refreshing}
                  title={App.t('tip.refreshList')}
                >{ds.refreshing ? App.t('val.loadingShort') : App.t('btn.refreshList')}</button>
                {' '}
                <button
                  className="btn btn-xs btn-secondary"
                  onClick={() => App.importSkillModel()}
                  data-i18n="btn.importModel"
                  data-i18n-title="tip.importModel"
                  title="Importovat natrénovaný model (checkpoint) z jiného zařízení"
                >Importovat model</button>
                {' '}
                <button
                  className="btn btn-xs btn-secondary"
                  id="ds-btn-export-model"
                  onClick={() => App.exportSkillModel(App.dsSelectedSkill())}
                  disabled={!ds.modelExists || ds.detailLoading}
                  title={App.t(ds.modelExists ? 'tip.exportModel' : 'tip.noModelYet')}
                >{App.t('btn.exportModel')}</button>
                {' '}
                <button
                  className="btn btn-xs btn-primary"
                  id="ds-btn-split-steps"
                  onClick={() => App.splitDatasetSteps()}
                  disabled={!ds.splitStepsEnabled || ds.detailLoading || busy}
                  title={App.t(ds.splitStepsTipKey)}
                >{ds.busyOp === 'split_steps' ? App.t('btn.startingShort') : App.t('btn.splitSteps')}</button>
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
                    onClick={() => App.dsDeleteEpisodes()}
                    disabled={!opsEnabled}
                    title={opTitle('tip.dsDelete')}
                  >{opLabel('delete_episodes', 'btn.delete')}</button>
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
                    onClick={() => App.dsModifyTask()}
                    disabled={!opsEnabled}
                    title={opTitle('tip.dsRewriteTask')}
                  >{opLabel('modify_tasks', 'btn.rewriteTask')}</button>
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
                    onClick={() => App.dsSplit()}
                    disabled={!opsEnabled}
                    title={opTitle('tip.dsSplitRun')}
                  >{opLabel('split', 'btn.split')}</button>
                </div>
                <div className="ds-op-row">
                  <div className="form-group" style={{ flex: "1" }}>
                    <div className="label-with-tooltip">
                      <label htmlFor="ds-merge-source" data-i18n="lbl.mergeWith">Sloučit s datasetem (repo id)</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.dsMergeSource">ⓘ</span>
                    </div>
                    <select
                      id="ds-merge-source"
                      value={ds.mergeRepo}
                      onChange={(e) => App.dsSelectMergeSource(e.target.value)}
                    >
                      <option value="">{App.t('opt.selectSecondDs')}</option>
                      {options}
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
                    onClick={() => App.dsMerge()}
                    disabled={!opsEnabled}
                    title={opTitle('tip.dsMergeRun')}
                  >{opLabel('merge', 'btn.merge')}</button>
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
  );
}

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
      {/* ── Tab 2: Správa datasetů — rendered from state/datasets ──── */}
      {/* The wrapper stays a plain, never-re-rendered element on purpose:
          switchDatasetyTab() shows and hides it by writing style.display, and
          a React re-render of the same style prop must not fight that. */}
      <div className="setup-wizard-panel" data-tab-panel="manage" style={{ display: "none" }}>
        <DatasetManagePanel />
      </div>
      {/* /.setup-wizard-panel[manage] */}
    </div>
  );
}
