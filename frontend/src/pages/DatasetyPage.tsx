/**
 * #page-datasety — both tabs render from published state (`state/collect` for
 * "Sběr dat & Dovednosti", `state/datasets` for "Správa datasetů") instead of
 * from innerHTML strings and `el.disabled = …` writes in `legacy/app.ts`.
 */

import { useEffect, useState } from 'react';
import { App } from '../legacy/app';
import { useDatasets, type DatasetsSnapshot } from '../state/datasets';
import {
  useCollect, isSplittable, markState, startState,
  type CollectSnapshot,
} from '../state/collect';
import {
  useSkills, badgeOf,
  type SkillsSnapshot, type SkillGroup, type SkillStep,
} from '../state/skills';

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
                <div className="form-group" style={{ maxWidth: "420px" }}>
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
                  <div className="form-group" style={{ maxWidth: "220px" }}>
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
                  {/* Same cap as .rec-cfg-wide (600px) — this is the same kind of
                      field (a single_task sentence), just editing an existing
                      dataset instead of a new recording, and the app should
                      treat the two consistently. */}
                  <div className="form-group" style={{ flex: "1", maxWidth: "600px" }}>
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

/**
 * Episode count shown next to one sub-step, and what it means.
 *
 * A count of 0 and "we could not read the count" are not the same answer, and
 * the old badge could only say `0 ep` for both — the fetch's `.catch` logged to
 * the console and left whatever text was there. Here a failed read renders as
 * `?` and says so on hover.
 */
function EpisodeBadge({ slug }: { slug: string }) {
  const s: SkillsSnapshot = useSkills();
  const badge = badgeOf(s, slug);

  if (badge.status === 'loading') {
    return (
      <span className="ep-badge" id={`ep-badge-${slug}`} title={App.t('tip.epBadgeLoading')}>
        {PENDING}
      </span>
    );
  }
  if (badge.status === 'error') {
    return (
      <span
        className="ep-badge"
        id={`ep-badge-${slug}`}
        title={App.t('tip.epBadgeError')}
        style={{ background: "rgba(255,255,255,0.03)", color: "var(--text-muted)" }}
      >?</span>
    );
  }
  const recorded = badge.episodes > 0;
  return (
    <span
      className="ep-badge"
      id={`ep-badge-${slug}`}
      title={App.t('tip.epBadgeCount')}
      style={recorded
        ? { background: "var(--green-light)", color: "var(--green)" }
        : { background: "rgba(255,255,255,0.03)", color: "var(--text-muted)" }}
    >{badge.episodes} ep</span>
  );
}

/** One sub-step row: select it, or act on it without selecting it. */
function SkillStepRow({ step, active }: { step: SkillStep; active: boolean }) {
  return (
    <li style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <button
        className={`skills-tree-item${active ? ' active' : ''}`}
        onClick={() => App.selectSkill(step.slug)}
        title={App.t('tip.selectStep')}
        style={{
          margin: "3px 0", flex: "1", display: "flex", alignItems: "center", gap: "8px",
          border: "none", background: "transparent", padding: "6px 10px", cursor: "pointer",
          textAlign: "left", transition: "all 0.2s",
        }}
      >
        <span className={`step-check-indicator${active ? ' active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </span>
        <span>{step.name}</span>
        <EpisodeBadge slug={step.slug} />
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
        <button
          className="btn btn-xs btn-secondary btn-icon"
          onClick={() => App.showEditSkillModal(step.slug)}
          title={App.t('tip.editStep')}
        >
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ width: "11px", height: "11px" }}
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button
          className="btn btn-xs btn-secondary btn-icon"
          onClick={() => App.openManageEpisodesModal(step.slug)}
          title={App.t('tip.manageEpisodes')}
        >
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ width: "12px", height: "12px" }}
          >
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
        <button
          className="btn btn-xs btn-danger btn-icon"
          onClick={() => App.deleteSkill(step.slug)}
          title={App.t('btn.delete')}
        >✕</button>
      </div>
    </li>
  );
}

/** One top-level task: its header row, its actions, and its sub-steps. */
function SkillGroupCard({ group, activeSkill }: { group: SkillGroup; activeSkill: string }) {
  return (
    <div
      className="skill-group-card"
      style={{
        background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.05)",
        padding: "6px", marginBottom: "12px", transition: "all 0.2s",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "2px 4px 6px", borderBottom: "1px solid rgba(255,255,255,0.02)",
        marginBottom: "4px",
      }}>
        <button
          className={`skills-tree-folder${group.collapsed ? ' collapsed' : ''}`}
          data-folder={group.slug}
          onClick={() => App.toggleSkillsFolder(group.slug)}
          // Says what the click will do, not what the control is — the row can
          // be in either state and the label has to follow it.
          title={App.t(group.collapsed ? 'tip.unfoldSkill' : 'tip.foldSkill')}
          style={{
            flex: "1", display: "flex", alignItems: "center", border: "none", background: "none",
            color: "var(--text-light)", textAlign: "left", padding: "4px", gap: "8px",
            fontWeight: 700, fontSize: "13px", cursor: "pointer", transition: "all 0.2s",
          }}
        >
          <span
            className="chevron-icon"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              transform: `rotate(${group.collapsed ? '0deg' : '90deg'})`,
              transition: "transform 0.2s", color: "var(--text-muted)",
            }}
          >
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ width: "10px", height: "10px" }}
            >
              <path d="M9 5l7 7-7 7"></path>
            </svg>
          </span>
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ width: "14px", height: "14px", color: "var(--cyan)", flexShrink: 0 }}
          >
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="12" r="4"></circle>
          </svg>
          <span>{group.name}</span>
          <span
            className="count-badge"
            title={App.t('tip.stepCount')}
            style={{
              background: "rgba(0, 188, 212, 0.1)", color: "var(--cyan)", fontSize: "9px",
              padding: "1px 6px", fontWeight: 600, marginLeft: "auto",
            }}
          >{group.steps.length}</span>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            className="btn btn-xs btn-secondary btn-icon"
            onClick={() => App.showEditSkillModal(group.slug)}
            title={App.t('tip.editSkill')}
          >
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ width: "10px", height: "10px" }}
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button
            className="btn btn-xs btn-danger btn-icon"
            onClick={() => App.deleteSkill(group.slug)}
            title={App.t('btn.delete')}
          >✕</button>
          <button
            className="btn btn-xs btn-primary btn-icon"
            onClick={() => App.showNewSubSkillModal(group.slug)}
            title={App.t('tip.addStep')}
          >+</button>
        </div>
      </div>
      <ul
        className={`skills-tree-subs${group.collapsed ? ' collapsed' : ''}`}
        id={`folder-subs-${group.slug}`}
        style={{
          listStyle: "none", paddingLeft: "14px", margin: "4px 0 4px 10px",
          borderLeft: "1.5px solid rgba(0, 188, 212, 0.15)",
        }}
      >
        {group.steps.length === 0 ? (
          <li style={{ padding: "6px 12px 6px 10px", fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic" }}>
            {App.t('hint.noSteps')}
          </li>
        ) : group.steps.map(step => (
          <SkillStepRow key={step.slug} step={step} active={step.slug === activeSkill} />
        ))}
      </ul>
    </div>
  );
}

/**
 * The project's skill tree — top-level tasks and the sub-steps beneath them.
 *
 * Picking a row here is what the rest of the tab reads from, so this is where
 * "which skill are we talking about" is decided. It used to be an `innerHTML`
 * string assembled by `renderSkillsFull()` in `legacy/app.ts`; see
 * `state/skills.ts` for what
 * that cost (raw skill names in markup, a `dataset_info` fetch per sub-step on
 * every repaint, answers landing by element id).
 */
function SkillsTree() {
  const s: SkillsSnapshot = useSkills();

  if (!s.groups.length) {
    return (
      <div className="empty-state" style={{ padding: "12px" }}>
        <div className="empty-state-icon">
          <svg
            width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
          </svg>
        </div>
        <div className="empty-state-text">{App.t('hint.createFirstSkill')}</div>
      </div>
    );
  }

  return (
    <>
      {s.groups.map(g => (
        <SkillGroupCard key={g.slug} group={g} activeSkill={s.activeSkill} />
      ))}
    </>
  );
}

/**
 * Elapsed time of the current take.
 *
 * The ticking lives here rather than in the published snapshot on purpose: a
 * 10 Hz value in the store would re-render the whole marking column ten times a
 * second, for one readout. It is display-only either way — a mark's real
 * timestamp is taken inside the recording process, from the frames already
 * written to the episode, and arrives back over the WebSocket.
 */
function TaggingTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [startedAt]);
  const elapsed = startedAt ? Math.max(0, (now - startedAt) / 1000) : 0;
  return <strong id="rec-tagging-timer">{elapsed.toFixed(1)}s</strong>;
}

/**
 * "Značkování pod-úkolů" — the column this whole project is about.
 *
 * It answers, before a take is even started, whether this skill can feed BOTH
 * branches of the comparison (whole dataset = ACT baseline, cut on the marks =
 * orchestration) or only the baseline. During a take it turns into the progress
 * of the phases being marked.
 */
function TaggingPanel() {
  const c: CollectSnapshot = useCollect();
  const splittable = isSplittable(c);
  const mark = markState(c);
  // Outside a take there is no "current" phase yet, so no row may claim to be
  // active — the list is then a plan, not a progress indicator.
  const live = c.phase === 'record' || c.marks.length > 0;
  const phaseKey = c.phase === 'record' ? 'rec.phaseRecording'
    : c.phase === 'reset' ? 'rec.phaseReset' : 'rec.phaseIdle';
  // A sub-step selected on its own is a perfectly good ACT baseline take; a
  // top-level task with no sub-steps cannot be recorded at all. Both have zero
  // boundaries, so the count alone must not decide the wording.
  const verdictKey = splittable ? 'hint.verdictBoth'
    : c.subSteps.length === 1 ? 'hint.verdictOneStep'
    : c.isStep ? 'hint.verdictLeafStep' : 'hint.verdictNoSteps';

  return (
    <div id="rec-tagging-wizard" className="tagging-panel">
      <div className="tagging-header">
        <span className="sidebar-subtitle" data-i18n="hint.activeTagging">Aktivní fázování (Active Tagging)</span>
        {' '}
        <span
          id="rec-tagging-phase"
          className={'tag ' + (c.phase === 'record' ? 'tag-live' : 'tag-idle')}
        >{App.t(phaseKey)}</span>
      </div>
      <div id="rec-step-verdict" className="rec-verdict">
        {c.skill ? (
          <>
            <span className={'pd-task-mode ' + (splittable ? 'ok' : 'baseline')}>
              {App.t(splittable ? 'val.modeBoth' : 'val.modeBaseline')}
            </span>
            <span className="rec-verdict-text">
              {App.t(verdictKey, { n: c.subSteps.length, marks: Math.max(0, c.subSteps.length - 1) })}
            </span>
          </>
        ) : null}
      </div>
      <div id="rec-tagging-steps" className="tagging-steps">
        {!c.skill ? (
          <div className="tagging-empty">{App.t('hint.pickSkillForPlan')}</div>
        ) : !c.subSteps.length ? (
          <div className="tagging-empty">{App.t('hint.noStepsToMark')}</div>
        ) : c.subSteps.map((sub, idx) => {
          const done = live && idx < c.activeIndex;
          const active = live && idx === c.activeIndex;
          const state = done ? 'done' : active ? 'active' : 'waiting';
          return (
            <div key={sub.slug} className={`tagging-step is-${state}`}>
              <span className="tagging-step-idx">{idx + 1}</span>
              <span className="tagging-step-name">{sub.name}</span>
              {/* Boundary marks sit BETWEEN steps, so the last step never gets one. */}
              {done && idx < c.marks.length ? (
                <span className="tagging-step-t">{c.marks[idx].toFixed(2)}s</span>
              ) : null}
              <span className={`tag tag-${state}`}>{App.t(`tag.${state}`)}</span>
            </div>
          );
        })}
      </div>
      <div className="tagging-actions">
        <button
          className="btn btn-xs btn-success-light"
          id="btn-tagging-next"
          onClick={() => App.taggingNextStep()}
          disabled={!mark.enabled}
          title={App.t('rec.markPhaseEndTip')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          {' '}
          {/* The disabled state has three different causes — say which one it is. */}
          <span>{App.t(mark.labelKey)}</span>
        </button>
        {' '}
        <button
          className="btn btn-xs btn-secondary"
          id="btn-tagging-undo"
          onClick={() => App.taggingUndoStep()}
          disabled={!c.marks.length}
          title={App.t(c.marks.length ? 'rec.undoMarkTip' : 'tip.undoNoMarks')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="9 14 4 9 9 4"></polyline>
            <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
          </svg>
          {' '}
          <span>{App.t('rec.undoMark')}</span>
        </button>
      </div>
      <div className="tagging-meta">
        <span>
          <span data-i18n="rec.episodeLbl">Epizoda</span>
          :{' '}
          <strong id="rec-tagging-episode">{c.episode >= 0 ? c.episode : '–'}</strong>
        </span>
        {' '}
        <span>
          <span data-i18n="rec.timeLbl">Čas</span>
          :{' '}
          <TaggingTimer startedAt={c.startedAt} />
        </span>
        {' '}
        <span>
          <span data-i18n="rec.marksLbl">Značky</span>
          :{' '}
          <strong id="rec-tagging-points" className="is-count">{c.marks.length}</strong>
        </span>
      </div>
    </div>
  );
}

/**
 * Episodes already on disk for the selected skill.
 *
 * One element carries the id and the branch only decides what goes inside it.
 * Four `return`s each repeating the same id would be four declarations of it
 * in one file, and only one of them can ever be the element a lookup finds —
 * which is exactly what the duplicate-id gate is there to catch.
 */
function EpisodesList() {
  const c: CollectSnapshot = useCollect();

  let body;
  if (!c.recordable) {
    body = <div className="rec-episodes-empty">{App.t('hint.noRecordableSkill')}</div>;
  } else if (c.episodes < 0) {
    // Reading the dataset directory is a round trip; the list says it is
    // working instead of leaving the previous skill's episodes on screen as
    // if they were this one's.
    body = <div className="rec-episodes-empty pulse-light-cyan">{App.t('val.loadingShort')}</div>;
  } else if (c.episodes === 0) {
    body = <div className="rec-episodes-empty">{App.t('hint.noEpisodesIn', { repo: c.repoId })}</div>;
  } else {
    body = Array.from({ length: c.episodes }, (_, idx) => (
      <div className="rec-episode-row" key={idx}>
        <span className="rec-episode-name">{App.t('rec.episodeLbl')} {idx}</span>
        <div className="rec-episode-actions">
          <button
            className="btn btn-xs btn-success"
            onClick={() => App.playSpecificEpisode(idx)}
            title={App.t('tip.replayEp')}
          >{App.t('btn.replayEp')}</button>
          <button
            className="btn btn-xs btn-danger"
            onClick={() => App.deleteSpecificEpisode(idx)}
            title={App.t('tip.deleteEp')}
          >{App.t('btn.delete')}</button>
        </div>
      </div>
    ));
  }

  return <div id="rec-episodes-list-container" className="rec-episodes-list">{body}</div>;
}

/** Placeholder for a readout whose value is still being fetched. */
const LOADING_DASH = '…';
/** Placeholder for a readout that has no value to show at all. */
const NOT_APPLICABLE = '—';

/**
 * The two halves of the recording column: the "pick a skill" hint and the
 * configuration itself. One switch for both, because they are two states of the
 * same thing and letting them drift apart means the panel shows a recording
 * configuration for a skill that cannot be recorded.
 *
 * The configuration markup is passed in as children so it is built once by the
 * page: React reuses the same elements when only this wrapper re-renders, so a
 * boundary mark does not repaint every field in the panel.
 */
function RecordPanels({ children }: { children: React.ReactNode }) {
  const c: CollectSnapshot = useCollect();
  return (
    <>
      <div
        id="rec-empty-state"
        className="empty-state"
        style={{ flex: "1", display: c.recordable ? "none" : "flex" }}
      >
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
        style={{ display: c.recordable ? "flex" : "none", flexDirection: "column", gap: "10px", flex: "1" }}
      >{children}</div>
    </>
  );
}

/** What the project is missing before lerobot-record could run at all. */
function RecordHardwareWarning() {
  const c: CollectSnapshot = useCollect();
  return (
    <div
      id="rec-hw-warning"
      style={{ display: c.hwErrorKey ? "block" : "none", background: "rgba(218, 55, 60, 0.12)", border: "1px solid var(--red)", color: "var(--red)", padding: "8px 10px", fontSize: "12.5px" }}
    >
      <strong style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "2px" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        {' '}
        <span data-i18n="rec.hwErrorTitle">Chyba hardwaru</span>
      </strong>
      {' '}
      <span id="rec-hw-warning-text">{App.t(c.hwErrorKey || 'rec.warnDefault')}</span>
    </div>
  );
}

/**
 * Where the take is written. Derived from the selected skill's place in the
 * tree (`local/<parent>/<step>`), which is why the field is read-only — typing
 * a different repo id here would record into a dataset the rest of the app
 * would then fail to find.
 */
function RecordRepoIdField() {
  const c: CollectSnapshot = useCollect();
  return (
    <input
      type="text"
      id="rec-repo-id"
      style={{ fontSize: "13.5px", fontFamily: "var(--font-mono)" }}
      readOnly={true}
      value={c.repoId}
      onChange={() => { /* read-only: the tree owns this value */ }}
    />
  );
}

/**
 * The three controls lerobot_record's own key listener exposes. Only on screen
 * while a take is running — outside one they would post into no process.
 */
function RecordLiveControls() {
  const c: CollectSnapshot = useCollect();
  return (
    <div
      id="rec-live-controls"
      className="rec-live-controls"
      style={{ display: c.recordingActive ? "flex" : "none" }}
    >
      <span className="panel-toolbar-label" data-i18n="hint.liveRecCtrl">Řízení nahrávání</span>
      <div className="rec-live-buttons">
        <button
          className="btn btn-xs btn-success"
          onClick={() => App.sendRecordingAction('next')}
          title={App.t('tip.recNextEpisode')}
          data-i18n="btn.nextEpisode"
        >Uložit epizodu a pokračovat</button>
        {' '}
        <button
          className="btn btn-xs btn-secondary"
          onClick={() => App.sendRecordingAction('reset')}
          title={App.t('tip.recDiscardRetry')}
          data-i18n="btn.discardRetry"
        >Zahodit a opakovat</button>
        {' '}
        <button
          className="btn btn-xs btn-danger"
          onClick={() => App.sendRecordingAction('stop')}
          title={App.t('tip.recFinishSave')}
          data-i18n="btn.finishSave"
        >Ukončit nahrávání</button>
      </div>
    </div>
  );
}

/**
 * Start / stop, at the bottom of the panel they belong to.
 *
 * Both reasons a start can be refused — the serial bus is busy, or the project
 * has no port/camera — are resolved in one place (`startState`). They used to
 * be written onto this button by two different functions, and the later one
 * silently overrode the earlier one's verdict.
 */
function RecordActions() {
  const c: CollectSnapshot = useCollect();
  const start = startState(c);
  // The registry flag lags the app's own switch by one WebSocket round trip, so
  // stopping stays available from the moment the request goes out.
  const stopEnabled = c.recordingActive || c.recordRunning;
  return (
    <div className="block-actions">
      <button
        className={'btn btn-xs btn-primary' + (!start.enabled && c.busBusy ? ' btn-busy-locked' : '')}
        id="btn-start-record"
        onClick={() => App.startWorkflowRecord()}
        disabled={!start.enabled}
        title={App.t(start.titleKey)}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <circle cx="12" cy="12" r="10"></circle>
        </svg>
        {' '}
        <span>{App.t(c.starting ? 'btn.startingRecording' : 'btn.startRecording')}</span>
      </button>
      {' '}
      <button
        className="btn btn-xs btn-danger"
        id="btn-stop-record"
        onClick={() => App.stopWorkflowRecord()}
        disabled={!stopEnabled}
        title={App.t(stopEnabled ? 'tip.stopRecording' : 'tip.notRecording')}
      >{App.t('btn.stopRecording')}</button>
    </div>
  );
}

/** Live facts about the selected skill, above the recording configuration. */
function ActiveSkillStats() {
  const c: CollectSnapshot = useCollect();
  // Three different answers, and they must not look alike: a dash for a skill
  // that has no dataset to describe, an ellipsis while the disk is being read,
  // and the number itself once it is known. The old panel had only the last
  // one, so an unanswerable selection kept showing the previous skill's counts.
  const pending = c.recordable ? LOADING_DASH : NOT_APPLICABLE;
  const policyLabel = c.policy === 'trained' ? App.t('val.trained')
    : c.policy === 'untrained' ? App.t('val.notTrained')
    : c.policy === 'unknown' ? App.t('val.unknownState') : pending;
  const policyColor = c.policy === 'trained' ? 'var(--green)'
    : c.policy === 'untrained' ? 'var(--yellow)' : 'var(--text-muted)';

  return (
    <div className="active-skill-stats-row">
      <span>
        <span data-i18n="lbl.skillColon">Dovednost:</span>
        {' '}
        <strong id="active-sub-skill-title" style={{ color: "var(--cyan)" }}>{c.skillName || NOT_APPLICABLE}</strong>
      </span>
      {' '}
      <span>
        <span data-i18n="lbl.demosColon">Demonstrace:</span>
        {' '}
        <strong id="active-skill-episodes" style={{ color: "var(--green)" }}>
          {c.episodes < 0 ? pending : App.t('val.nEpisodes', { n: c.episodes })}
        </strong>
      </span>
      {' '}
      <span>
        <span data-i18n="lbl.sizeColon">Velikost:</span>
        {' '}
        <strong id="active-skill-size">{c.sizeMb ? `${c.sizeMb} MB` : pending}</strong>
      </span>
      {' '}
      <span>
        <span data-i18n="lbl.policyColon">Policy:</span>
        {' '}
        <strong id="active-skill-training" style={{ color: policyColor }}>{policyLabel}</strong>
      </span>
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
              <div id="skill-list-full" style={{ padding: "8px 0" }}><SkillsTree /></div>
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
              <RecordPanels>
                {/* hardware setup warnings */}
                <RecordHardwareWarning />
                <ActiveSkillStats />
                {/* Two-column config grid. A single column stretched every input to the full width of the panel (~990 px at 1600×900), which is what the brief calls out as the main layout defect. */}
                <div className="rec-config-grid">
                  <div className="form-group rec-cfg-wide">
                    <div className="label-with-tooltip">
                      <label htmlFor="rec-repo-id">Dataset Repo ID</label>
                      {' '}
                      <span className="info-tooltip-trigger" data-i18n-tooltip="tip.recRepoId">ⓘ</span>
                    </div>
                    <RecordRepoIdField />
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
                <RecordLiveControls />
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
              </RecordPanels>
            </div>
            {/* /.datacollection-block-body */}
            <RecordActions />
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
              <TaggingPanel />
              <div className="rec-episodes">
                <span className="sidebar-subtitle" data-i18n="hint.recordedEps">Nahrané epizody (demonstrace)</span>
                <EpisodesList />
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
