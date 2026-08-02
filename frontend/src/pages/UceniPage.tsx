/** #page-uceni — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';
import { initiallyDisabled } from '../util/initiallyDisabled';

export function UceniPage() {
  return (
    <div id="page-uceni" className="editor-area">
      <div className="page-header-row">
        <h2 data-i18n="page.uceni.title">Učení — Trénování a evaluace</h2>
      </div>
      <div className="setup-wizard-tabs">
        <button
          className="setup-wizard-tab-btn active"
          data-tab="train"
          onClick={(event: any) => { App.switchUceniTab('train') }}
        >
          <span data-i18n="tab.uceni.train">Imitační učení</span>
        </button>
        {' '}
        <button
          className="setup-wizard-tab-btn"
          data-tab="advanced"
          onClick={(event: any) => { App.switchUceniTab('advanced') }}
        >
          <span data-i18n="tab.uceni.advanced">Pokročilé & Evaluace</span>
        </button>
      </div>
      <div className="setup-wizard-panel" data-tab-panel="train">
        <div className="setup-section" style={{ gridTemplateColumns: "1fr" }}>
          <div className="setup-block" style={{ display: "flex", flexDirection: "column" }}>
            <div className="block-head-row">
              <h3 style={{ margin: "0" }}>
                <span data-i18n="blk.train.title"></span>
              </h3>
            </div>
            <div className="setup-block-content">
              <div className="merge-cols merge-cols-3">
                {/* Both branches of the project's comparison are trainable from here, because both come out of the SAME recording: the whole dataset (ACT baseline) and the sub-datasets cut from it by the splitter (orchestration). Readiness comes from GET /api/training/targets, which resolves through the trainer's own helpers — a row marked untrainable really would be refused at spawn time. */}
                <section className="merge-col">
                  <h4 className="merge-col-title" data-i18n="blk.learn.targets">Cíle tréninku</h4>
                  <div className="train-stats">
                    <div className="train-stat">
                      <span className="train-stat-val" id="train-stat-tasks">–</span>
                      {' '}
                      <span className="train-stat-lbl" data-i18n="stat.tasks">Úkolů</span>
                    </div>
                    <div className="train-stat">
                      <span className="train-stat-val" id="train-stat-datasets">–</span>
                      {' '}
                      <span className="train-stat-lbl" data-i18n="stat.datasetsRec">Datasetů nahráno</span>
                    </div>
                    <div className="train-stat">
                      <span className="train-stat-val" id="train-stat-ckpts">–</span>
                      {' '}
                      <span className="train-stat-lbl" data-i18n="stat.ckptsTrained">Natrénováno</span>
                    </div>
                    <div className="train-stat">
                      <span className="train-stat-val" id="train-stat-arch">–</span>
                      {' '}
                      <span className="train-stat-lbl" data-i18n="stat.arch">Architektura</span>
                    </div>
                  </div>
                  <div className="train-targets" id="train-skills-checklist-container">{/* Dynamically filled by renderTrainingSkillsTree() */}</div>
                  <div className="block-actions">
                    <button
                      className="btn btn-xs"
                      id="btn-train-reload"
                      onClick={(event: any) => { App.loadTrainingTargets() }}
                      data-i18n="btn.reload"
                    >Načíst znovu</button>
                  </div>
                </section>
                <section className="merge-col">
                  <h4 className="merge-col-title" data-i18n="blk.learn.config">Konfigurace Tréninku</h4>
                  <div
                    className="setup-block-content"
                    style={{ flex: "1", display: "flex", flexDirection: "column", gap: "12px" }}
                  >
                    <div className="form-group policy-pick-group">
                      <div className="label-with-tooltip">
                        <label id="policy-pick-label" data-i18n="lbl.policyArch">Model Policy (Architektura)</label>
                        {' '}
                        <span className="info-tooltip-trigger" data-i18n-tooltip="tip.policyArch">ⓘ</span>
                      </div>
                      <select id="train-policy-type" style={{ display: "none" }} aria-hidden="true" defaultValue="act">
                        <option value="act">ACT</option>
                        <option value="diffusion">Diffusion Policy</option>
                        <option value="smolvla">SmolVLA</option>
                        <option value="vqbet">VQ-BeT</option>
                        <option value="pi0">π0</option>
                      </select>
                      <div className="policy-pick" role="radiogroup" aria-labelledby="policy-pick-label">
                        <div
                          className="policy-pick-card active"
                          data-value="act"
                          role="radio"
                          aria-checked="true"
                          tabIndex={0}
                          onClick={(event: any) => { App.selectPolicyCard('act') }}
                          onKeyDown={(event: any) => { if(event.key==='Enter'||event.key===' '){event.preventDefault();App.selectPolicyCard('act')} }}
                        >
                          <strong>ACT</strong>
                          {' '}
                          <span data-i18n="pol.act">Přesné trajektorie — doporučeno pro SO-100/101</span>
                        </div>
                        <div
                          className="policy-pick-card"
                          data-value="diffusion"
                          role="radio"
                          aria-checked="false"
                          tabIndex={0}
                          onClick={(event: any) => { App.selectPolicyCard('diffusion') }}
                          onKeyDown={(event: any) => { if(event.key==='Enter'||event.key===' '){event.preventDefault();App.selectPolicyCard('diffusion')} }}
                        >
                          <strong>Diffusion</strong>
                          {' '}
                          <span data-i18n="pol.diffusion">Robustní vůči šumu a chybám operátora</span>
                        </div>
                        <div
                          className="policy-pick-card"
                          data-value="smolvla"
                          role="radio"
                          aria-checked="false"
                          tabIndex={0}
                          onClick={(event: any) => { App.selectPolicyCard('smolvla') }}
                          onKeyDown={(event: any) => { if(event.key==='Enter'||event.key===' '){event.preventDefault();App.selectPolicyCard('smolvla')} }}
                        >
                          <strong>SmolVLA</strong>
                          {' '}
                          <span data-i18n="pol.smolvla">Malý jazykově řízený VLA model</span>
                        </div>
                        <div
                          className="policy-pick-card"
                          data-value="vqbet"
                          role="radio"
                          aria-checked="false"
                          tabIndex={0}
                          onClick={(event: any) => { App.selectPolicyCard('vqbet') }}
                          onKeyDown={(event: any) => { if(event.key==='Enter'||event.key===' '){event.preventDefault();App.selectPolicyCard('vqbet')} }}
                        >
                          <strong>VQ-BeT</strong>
                          {' '}
                          <span data-i18n="pol.vqbet">Dlouhé úkoly (long-horizon)</span>
                        </div>
                        <div
                          className="policy-pick-card"
                          data-value="pi0"
                          role="radio"
                          aria-checked="false"
                          tabIndex={0}
                          onClick={(event: any) => { App.selectPolicyCard('pi0') }}
                          onKeyDown={(event: any) => { if(event.key==='Enter'||event.key===' '){event.preventDefault();App.selectPolicyCard('pi0')} }}
                        >
                          <strong>π0</strong>
                          {' '}
                          <span data-i18n="pol.pi0">Physical Intelligence VLA</span>
                        </div>
                      </div>
                    </div>
                    {/* Same recipe the recording config uses: an auto-fit grid so the fields keep a sane width instead of one of them stretching across the whole window, and only the genuinely long value (the CLI argument line) spans two tracks. */}
                    <div className="rec-config-grid">
                      <div className="form-group">
                        <div className="label-with-tooltip">
                          <label htmlFor="train-steps" data-i18n="lbl.trainSteps">Tréninkové kroky (steps)</label>
                          {' '}
                          <span className="info-tooltip-trigger" data-i18n-tooltip="tip.trainSteps">ⓘ</span>
                        </div>
                        <input
                          type="number"
                          id="train-steps"
                          defaultValue="10000"
                          min="100"
                          step="100"
                          style={{ fontSize: "13.5px", fontFamily: "var(--font-mono)" }}
                        />
                      </div>
                      <div className="form-group">
                        <div className="label-with-tooltip">
                          <label htmlFor="train-batch-size">Batch size</label>
                          {' '}
                          <span className="info-tooltip-trigger" data-i18n-tooltip="tip.trainBatchSize">ⓘ</span>
                        </div>
                        <input
                          type="number"
                          id="train-batch-size"
                          defaultValue="8"
                          min="1"
                          style={{ fontSize: "13.5px", fontFamily: "var(--font-mono)" }}
                        />
                      </div>
                      <div className="form-group">
                        <div className="label-with-tooltip">
                          <label htmlFor="train-device" data-i18n="lbl.trainDevice">Trénovací Zařízení</label>
                          {' '}
                          <span className="info-tooltip-trigger" data-i18n-tooltip="tip.trainDevice">ⓘ</span>
                        </div>
                        <select id="train-device" style={{ fontSize: "13.5px" }}>
                          <option value="cuda" data-i18n="opt.cudaRec">CUDA GPU (Doporučeno)</option>
                          <option value="mps">MPS Apple Silicon</option>
                          <option value="cpu">Pouze CPU</option>
                        </select>
                      </div>
                      <div className="form-group rec-cfg-wide">
                        <div className="label-with-tooltip">
                          <label htmlFor="train-extra-args" data-i18n="lbl.extraArgsTrain">Vlastní LeRobot CLI argumenty (Trénování)</label>
                          {' '}
                          <span className="info-tooltip-trigger" data-i18n-tooltip="tip.trainExtraArgs">ⓘ</span>
                        </div>
                        <input
                          type="text"
                          id="train-extra-args"
                          placeholder="např. --policy.n_obs_steps=8 --optimizer.lr=1e-4"
                          style={{ fontSize: "13.5px", fontFamily: "var(--font-mono)" }}
                          data-i18n-ph="ph.trainExtra"
                        />
                      </div>
                      <div className="rec-cfg-flags">
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <input type="checkbox" id="train-wandb" style={{ width: "14px", height: "14px" }} />
                          {' '}
                          <label
                            htmlFor="train-wandb"
                            style={{ fontSize: "12.5px", cursor: "pointer", color: "var(--text-muted)", fontWeight: "700" }}
                            data-i18n="lbl.logWandb"
                          >LOGOVAT WANDB</label>
                          {' '}
                          <span className="info-tooltip-trigger" data-i18n-tooltip="tip.trainWandb">ⓘ</span>
                        </div>
                      </div>
                    </div>
                    {/* What the checked rows will really turn into, spelled out as the command line that gets spawned. */}
                    <div className="train-cmd-preview">
                      <span className="train-cmd-label" data-i18n="lbl.trainCmdPreview">Spustí se</span>
                      {' '}
                      <code id="train-cmd-preview-text">–</code>
                    </div>
                  </div>
                  <div className="block-actions">
                    <span className="block-actions-hint" id="train-scope-hint" data-i18n="hint.trainScope">
                      Spustí lerobot-train pro cíle zaškrtnuté vlevo, každý jako samostatný běh.
                    </span>
                    {' '}
                    <button
                      className="btn btn-xs btn-primary"
                      id="btn-start-training"
                      onClick={(event: any) => { App.startWorkflowTraining() }}
                      data-i18n="btn.startTraining"
                    >Spustit Trénink</button>
                    {' '}
                    <button
                      className="btn btn-xs btn-danger"
                      id="btn-stop-training"
                      onClick={(event: any) => { App.stopWorkflowTraining() }}
                      ref={initiallyDisabled}
                      title="Žádný trénink neběží"
                      data-i18n="btn.stop"
                    >Zastavit</button>
                  </div>
                </section>
                <section className="merge-col">
                  <h4 className="merge-col-title" data-i18n="blk.learn.loss">Loss Telemetrie & Průběh</h4>
                  <div
                    className="setup-block-content"
                    style={{ flex: "1", display: "flex", flexDirection: "column", gap: "8px" }}
                  >
                    <div className="chart-header">
                      <span
                        style={{ fontSize: "11.5px", fontWeight: "700", color: "var(--text-light)", textTransform: "uppercase" }}
                        data-i18n="hint.trainProgress"
                      >Průběh trénování</span>
                      <div className="progress-bar-container">
                        <div className="progress-bar-fill" id="training-progress-bar"></div>
                      </div>
                    </div>
                    <div className="chart-container-docked" style={{ flex: "1", minHeight: "200px" }}>
                      <canvas id="loss-chart" style={{ width: "100%", height: "100%" }}></canvas>
                    </div>
                    <div
                      className="latch-status-indicator"
                      id="training-status-indicator"
                      data-i18n="status.trainReady"
                    >Připraveno. Vyberte cíle vlevo a spusťte trénink.</div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* ── Tab 2: Pokročilé & Evaluace ──────────────────────────────── */}
      <div className="setup-wizard-panel" data-tab-panel="advanced" style={{ display: "none" }}>
        <div className="setup-section" style={{ gridTemplateColumns: "1fr" }}>
          <div className="setup-block" style={{ display: "flex", flexDirection: "column" }}>
            <div className="block-head-row">
              <h3 style={{ margin: "0" }}>
                <span data-i18n="blk.adv.title"></span>
              </h3>
            </div>
            <div className="setup-block-content">
              <div className="merge-cols">
                <section className="merge-col">
                  <h4 className="merge-col-title" data-i18n="blk.adv.resume">Pokračování tréninku (Resume)</h4>
                  <div
                    className="setup-block-content"
                    style={{ flex: "1", display: "flex", flexDirection: "column", gap: "14px", minHeight: "0" }}
                  >
                    <div className="form-group">
                      <div className="label-with-tooltip">
                        <label htmlFor="adv-resume-skill" data-i18n="lbl.skillWithCkpt">Dovednost s existujícím checkpointem</label>
                        {' '}
                        <span className="info-tooltip-trigger" data-i18n-tooltip="tip.advResumeSkill">ⓘ</span>
                      </div>
                      <select id="adv-resume-skill">
                        <option value="">-- Vyberte dovednost --</option>
                      </select>
                    </div>
                    <div
                      style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.5" }}
                      data-i18n-html="desc.resume"
                    >
                      Najde poslední checkpoint v{' '}
                      <code>checkpoints/last/pretrained_model</code>
                      {' '}a pokračuje v tréninku (
                      <code>lerobot-train --config_path=... --resume=true</code>
                      ). Pokud checkpoint neexistuje, spustí se nový trénink.
                    </div>
                    <button
                      className="btn btn-xs btn-primary"
                      style={{ alignSelf: "flex-start" }}
                      onClick={(event: any) => { App.advResumeTraining() }}
                      data-i18n="btn.resumeTraining"
                    >Pokračovat v tréninku</button>
                    <h3 style={{ marginTop: "14px" }}>
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
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                        <line x1="8" y1="21" x2="16" y2="21"></line>
                        <line x1="12" y1="17" x2="12" y2="21"></line>
                      </svg>
                      {' '}
                      <span data-i18n="blk.adv.eval">Simulační evaluace (lerobot-eval)</span>
                    </h3>
                    <div className="form-group">
                      <div className="label-with-tooltip">
                        <label htmlFor="adv-eval-policy" data-i18n="lbl.policyPathOrHub">Policy (cesta nebo Hub id)</label>
                        {' '}
                        <span className="info-tooltip-trigger" data-i18n-tooltip="tip.advEvalPolicy">ⓘ</span>
                      </div>
                      <input
                        type="text"
                        id="adv-eval-policy"
                        placeholder="např. lerobot/diffusion_pusht nebo outputs/training/..."
                        style={{ fontFamily: "var(--font-mono)", fontSize: "12.5px" }}
                        data-i18n-ph="ph.evalPolicy"
                      />
                    </div>
                    <div className="form-row" style={{ margin: "0", gap: "10px" }}>
                      <div className="form-group">
                        <div className="label-with-tooltip">
                          <label htmlFor="adv-eval-env" data-i18n="lbl.env">Prostředí</label>
                          {' '}
                          <span className="info-tooltip-trigger" data-i18n-tooltip="tip.advEvalEnv">ⓘ</span>
                        </div>
                        <select id="adv-eval-env">
                          <option value="pusht" data-i18n="opt.pusht">PushT (2D tlačení)</option>
                          <option value="aloha">ALOHA (bimanual)</option>
                          <option value="xarm">XArm</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ width: "90px" }}>
                        <div className="label-with-tooltip">
                          <label htmlFor="adv-eval-episodes" data-i18n="lbl.episodes">Epizody</label>
                          {' '}
                          <span className="info-tooltip-trigger" data-i18n-tooltip="tip.advEvalEpisodes">ⓘ</span>
                        </div>
                        <input
                          type="number"
                          id="adv-eval-episodes"
                          defaultValue="10"
                          min="1"
                          style={{ fontFamily: "var(--font-mono)", fontSize: "13.5px" }}
                        />
                      </div>
                      <div className="form-group">
                        <div className="label-with-tooltip">
                          <label htmlFor="adv-eval-device" data-i18n="lbl.device">Zařízení</label>
                          {' '}
                          <span className="info-tooltip-trigger" data-i18n-tooltip="tip.advEvalDevice">ⓘ</span>
                        </div>
                        <select id="adv-eval-device">
                          <option value="cuda">CUDA</option>
                          <option value="mps">MPS</option>
                          <option value="cpu">CPU</option>
                        </select>
                      </div>
                    </div>
                    <button
                      className="btn btn-xs btn-primary"
                      style={{ alignSelf: "flex-start" }}
                      onClick={(event: any) => { App.advStartEval() }}
                      data-i18n="btn.runEval"
                    >Spustit evaluaci</button>
                  </div>
                </section>
                <section className="merge-col">
                  <h4 className="merge-col-title" data-i18n="blk.adv.modes">Pokročilé režimy tréninku</h4>
                  <div
                    className="setup-block-content"
                    style={{ flex: "1", display: "flex", flexDirection: "column", gap: "10px", overflowY: "auto" }}
                  >
                    <p
                      style={{ fontSize: "12px", color: "var(--text-muted)", margin: "0", lineHeight: "1.5" }}
                      data-i18n-html="desc.advModes"
                    >
                      Tyto režimy se aktivují přes pole{' '}
                      <strong>„Vlastní LeRobot CLI argumenty“</strong>
                      {' '}na stránce Imitační učení, nebo příkazem v terminálu. Kliknutím vložíte šablonu do terminálové konzole.
                    </p>
                    <div
                      className="adv-mode-card"
                      role="button"
                      tabIndex={0}
                      onClick={(event: any) => { App.advInsertTemplate('peft') }}
                      onKeyDown={(event: any) => { if(event.key==='Enter')App.advInsertTemplate('peft') }}
                    >
                      <strong data-i18n="adv.peft.title">PEFT / LoRA fine-tuning</strong>
                      {' '}
                      <code>--peft.type=lora --peft.r=16 --peft.lora_alpha=32</code>
                      {' '}
                      <span data-i18n="adv.peft.desc">Paměťově úsporné doladění velkých VLA modelů (SmolVLA, π0).</span>
                    </div>
                    <div
                      className="adv-mode-card"
                      role="button"
                      tabIndex={0}
                      onClick={(event: any) => { App.advInsertTemplate('multigpu') }}
                      onKeyDown={(event: any) => { if(event.key==='Enter')App.advInsertTemplate('multigpu') }}
                    >
                      <strong data-i18n="adv.multigpu.title">Multi-GPU trénink (accelerate)</strong>
                      {' '}
                      <code>
                        accelerate launch --num_processes=2 -m lerobot.scripts.lerobot_train ...
                      </code>
                      {' '}
                      <span data-i18n="adv.multigpu.desc">Distribuovaný trénink na více grafických kartách.</span>
                    </div>
                    <div
                      className="adv-mode-card"
                      role="button"
                      tabIndex={0}
                      onClick={(event: any) => { App.advInsertTemplate('rl') }}
                      onKeyDown={(event: any) => { if(event.key==='Enter')App.advInsertTemplate('rl') }}
                    >
                      <strong data-i18n="adv.rl.title">Reinforcement Learning (HIL-SERL / SAC)</strong>
                      {' '}
                      <code>--policy.type=sac --env.type=gym_hil ...</code>
                      {' '}
                      <span data-i18n="adv.rl.desc">Učení posilováním s člověkem ve smyčce — vyžaduje gym_hil prostředí.</span>
                    </div>
                    <div
                      className="adv-mode-card"
                      role="button"
                      tabIndex={0}
                      onClick={(event: any) => { App.advInsertTemplate('tokenizer') }}
                      onKeyDown={(event: any) => { if(event.key==='Enter')App.advInsertTemplate('tokenizer') }}
                    >
                      <strong data-i18n="adv.tok.title">Trénink akčního tokenizéru (π0-FAST)</strong>
                      {' '}
                      <code>lerobot-train-tokenizer --dataset.repo_id=...</code>
                      {' '}
                      <span data-i18n="adv.tok.desc">Předpočítá FAST tokenizér akcí pro autoregresivní VLA modely.</span>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
