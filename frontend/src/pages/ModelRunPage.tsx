/** #page-modelrun — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function ModelRunPage() {
  return (
    <div id="page-modelrun" className="editor-area">
      <div className="page-header-row">
        <h2 data-i18n="page.modelrun.title">Spuštění & Běh Modelu (Orchestrace)</h2>
      </div>
      <div className="modelrun-grid">
        {/* ── Column 1: what an orchestration run would execute ────── */}
        <div className="modelrun-block">
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
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
            {' '}
            <span data-i18n="blk.run.plan">Plán a modely</span>
          </div>
          <div className="modelrun-block-body">
            <div className="orch-preview-stats">
              <div className="orch-stat">
                <span className="orch-stat-label" data-i18n="lbl.orchTasks">Úkolů</span>
                {' '}
                <span className="orch-stat-value" id="orch-stat-tasks">–</span>
              </div>
              <div className="orch-stat">
                <span className="orch-stat-label" data-i18n="lbl.orchOrchestrated">Orchestrovaných</span>
                {' '}
                <span className="orch-stat-value" id="orch-stat-orchestrated">–</span>
              </div>
              <div className="orch-stat">
                <span className="orch-stat-label" data-i18n="lbl.orchCkptReady">Checkpointů</span>
                {' '}
                <span className="orch-stat-value" id="orch-stat-checkpoints">–</span>
              </div>
              <div className="orch-stat">
                <span className="orch-stat-label" data-i18n="lbl.orchArch">Architektura</span>
                {' '}
                <span className="orch-stat-value" id="orch-stat-arch">–</span>
              </div>
            </div>
            <div id="orch-preview-tasks" className="orch-preview-tasks">
              {/* Populated by renderOrchPreview() from /api/orchestration/plan_preview */}
            </div>
          </div>
          <div className="block-actions">
            <button
              className="btn btn-xs btn-secondary"
              id="btn-orch-preview-refresh"
              onClick={(event: any) => { App.loadOrchPreview() }}
              data-i18n-title="tip.reloadPlanPreview"
              title="Znovu načte plán a přepočítá, které checkpointy existují na disku"
              data-i18n="btn.reload"
            >Načíst znovu</button>
          </div>
        </div>
        {/* ── Column 2: the live CEO plan and the VLM verdict ──────── */}
        <div className="modelrun-block">
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
              <path
                d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-4.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2z"
              ></path>
            </svg>
            {' '}
            <span data-i18n="blk.run.ceo">Orchestrace (CEO → VLM)</span>
          </div>
          <div className="modelrun-block-body">
            <div className="brain-card mr-card">
              <div className="brain-card-header">
                <span className="brain-card-title" data-i18n="lbl.llmPlanner">LLM plánovač (high-level)</span>
                {' '}
                <span className="brain-badge ceo">CEO</span>
              </div>
              <div className="mr-input-row">
                <input
                  type="text"
                  id="orch-input"
                  aria-label="Instrukce pro CEO plánovač"
                  placeholder="např. Uchop červenou kostku a polož ji..."
                  data-i18n-ph="ph.orchInput"
                />
                {' '}
                <button
                  className="btn btn-xs btn-primary"
                  id="btn-run-plan"
                  onClick={(event: any) => { App.executeOrchestration() }}
                  data-i18n-title="tip.runPlan"
                  title="Odešle instrukci CEO plánovači (POST /api/orchestrate); ten ji rozloží na kroky vlevo"
                  data-i18n="btn.runPlan"
                >Spustit plán</button>
              </div>
            </div>
            {/* The step list is the element that earns extra height here: it is the only one whose content grows with the plan. */}
            <div className="mr-section mr-section-grow">
              <span className="sidebar-subtitle" data-i18n="hint.resolvedPlan">Rozložený plán (pořadí provádění)</span>
              <div className="pipeline-steps-container" id="pipeline-steps">
                <div className="empty-state-text" data-i18n="hint.noPlan">Žádný běžící plán.</div>
              </div>
            </div>
            <div className="latch-status-indicator" id="orch-status-indicator" data-i18n="hint.orchIdle">Nečinné — čeká se na instrukci pro CEO plánovač.</div>
            <div className="task-latch-banner unlocked" id="task-latch-card-banner">
              <span className="latch-status-icon" id="task-latch-visual-icon">
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
                  <rect x="3" y="11" width="18" height="11"></rect>
                  <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
                </svg>
              </span>
              <div className="latch-texts">
                <span id="task-latch-title-text" data-i18n="latch.unlockedTitle">Task Latch: odemčeno</span>
                {' '}
                <span id="task-latch-desc-text" className="latch-desc" data-i18n="latch.unlockedDesc">
                  Motor dojel krok. VLM inspektor kontroluje scénu na hranici pod-úkolů.
                </span>
              </div>
            </div>
            {/* The snapshot the VLM judged is the second element in this column worth extra height: at thumbnail size a human cannot check the verdict against the scene. The frame scales by height and keeps 4:3, so it never stretches out of shape. */}
            <div className="brain-card mr-card mr-vlm-card">
              <div className="brain-card-header">
                <span className="brain-card-title" data-i18n="lbl.vlmInspector">VLM inspektor</span>
                {' '}
                <span id="vlm-inspect-badge" className="brain-badge is-idle" data-i18n="val.vlmIdle">Nečinný</span>
              </div>
              <div className="mr-vlm-text" data-i18n="hint.vlmInspectDesc">Vizuální kontrola scény po každém kroku plánu.</div>
              <div id="vlm-frame-placeholder" className="mr-vlm-frame">
                <img id="vlm-inspect-image" alt="" />
                <div id="vlm-inspect-none" data-i18n="val.vlmNoFrame">Bez snímku</div>
              </div>
            </div>
          </div>
          <div className="block-actions"></div>
        </div>
        {/* ── Column 3: the worker daemon and its live telemetry ───── */}
        <div className="modelrun-block">
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
              <rect x="2" y="7" width="20" height="14"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
            {' '}
            <span data-i18n="blk.run.worker">Worker — inferenční daemon</span>
          </div>
          <div className="modelrun-block-body">
            <div className="mr-section">
              <span className="sidebar-subtitle" data-i18n="hint.manualDeploy">Ruční nasazení jednoho checkpointu (ACT baseline)</span>
              <div className="mr-config-grid">
                <div className="form-group mr-span-2">
                  <label data-i18n="lbl.policyCkpt">Policy Checkpoint</label>
                  {' '}
                  <input type="text" id="eval-policy-path" placeholder="outputs/training/..." className="is-mono" />
                </div>
                <div className="form-group">
                  <label data-i18n="lbl.activeSubtask">Aktivní pod-úkol</label>
                  {' '}
                  <input type="text" id="eval-task-name" placeholder="eval_…" readOnly={true} />
                </div>
                <div className="form-group">
                  <label data-i18n="lbl.daemonState">Stav daemona</label>
                  <div className="mr-daemon-state">
                    <span id="infer-daemon-status" className="mr-tag is-off" data-i18n="val.daemonOff">NEBĚŽÍ</span>
                  </div>
                </div>
              </div>
            </div>
            {/* Everything below only exists while a daemon is deployed. */}
            <div id="infer-persistent-panel" className="mr-daemon-panel">
              <div className="mr-section mr-section-grow">
                <div className="mr-subhead">
                  <span className="sidebar-subtitle" data-i18n="hint.dispatchSubtask">Odeslat pod-úkol daemonu (stdin SET_TASK)</span>
                  {' '}
                  <button
                    className="btn btn-xs btn-danger"
                    onClick={(event: any) => { App.sendInferenceStopSignal() }}
                    data-i18n-title="tip.stopCurrentTask"
                    title="Zastaví aktuálně běžící pod-úkol, daemon zůstane připravený na další."
                    data-i18n="btn.stopTask"
                  >Stop úkolu</button>
                </div>
                <div id="infer-subtasks-container" className="mr-subtasks"></div>
              </div>
              <div className="mr-section">
                <span className="sidebar-subtitle" data-i18n="hint.liveTelemetry">Telemetrie z daemona</span>
                <div className="mr-metrics">
                  <div className="mr-metric">
                    <span className="mr-metric-label" data-i18n="hint.settleStatus">Settle Status (Uklidnění)</span>
                    {' '}
                    <span id="infer-settle-frames" className="mr-metric-value is-cyan">0/5</span>
                  </div>
                  <div className="mr-metric">
                    <span className="mr-metric-label" data-i18n="lbl.gripperLoad">Proud gripperu (Load)</span>
                    {' '}
                    <span id="infer-gripper-load" className="mr-metric-value is-yellow">0.0 mA</span>
                  </div>
                  <div className="mr-metric">
                    <span className="mr-metric-label" data-i18n="lbl.maxJointDelta">Max odchylka kloubů</span>
                    {' '}
                    <span id="infer-max-delta" className="mr-metric-value">0.0000 rad</span>
                  </div>
                </div>
              </div>
              <div className="mr-section">
                <span className="sidebar-subtitle" data-i18n="hint.jointAngles">Úhly kloubů (Aktuální vs Cíl)</span>
                <div id="infer-joints-grid" className="mr-joints">
                  <div className="joint-telemetry-box">
                    <div className="jt-name">J1</div>
                    <div className="jt-val" id="joint-val-0">0.0000</div>
                    <div className="jt-tgt" id="joint-tgt-0">0.0000</div>
                  </div>
                  <div className="joint-telemetry-box">
                    <div className="jt-name">J2</div>
                    <div className="jt-val" id="joint-val-1">0.0000</div>
                    <div className="jt-tgt" id="joint-tgt-1">0.0000</div>
                  </div>
                  <div className="joint-telemetry-box">
                    <div className="jt-name">J3</div>
                    <div className="jt-val" id="joint-val-2">0.0000</div>
                    <div className="jt-tgt" id="joint-tgt-2">0.0000</div>
                  </div>
                  <div className="joint-telemetry-box">
                    <div className="jt-name">J4</div>
                    <div className="jt-val" id="joint-val-3">0.0000</div>
                    <div className="jt-tgt" id="joint-tgt-3">0.0000</div>
                  </div>
                  <div className="joint-telemetry-box">
                    <div className="jt-name">J5</div>
                    <div className="jt-val" id="joint-val-4">0.0000</div>
                    <div className="jt-tgt" id="joint-tgt-4">0.0000</div>
                  </div>
                  <div className="joint-telemetry-box">
                    <div className="jt-name">J6</div>
                    <div className="jt-val" id="joint-val-5">0.0000</div>
                    <div className="jt-tgt" id="joint-tgt-5">0.0000</div>
                  </div>
                </div>
              </div>
            </div>
            {/* /#infer-persistent-panel */}
            <div id="infer-idle-hint" className="mr-idle-hint" data-i18n="hint.daemonIdle">Daemon neběží. Po nasazení se sem doplní pod-úkoly a živá telemetrie.</div>
          </div>
          <div className="block-actions">
            <button
              className="btn btn-xs btn-primary"
              id="btn-deploy-policy"
              onClick={(event: any) => { App.startWorkflowInference() }}
              data-i18n="btn.deployPolicy"
            >Nasadit Policy</button>
            {' '}
            <button
              className="btn btn-xs btn-danger"
              id="btn-stop-inference"
              onClick={(event: any) => { App.stopWorkflowInference() }}
              disabled={true}
              data-i18n="btn.stop"
            >Zastavit</button>
          </div>
        </div>
      </div>
      {/* /.modelrun-grid */}
    </div>
  );
}
