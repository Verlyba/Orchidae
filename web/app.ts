/**
 * Orchiday Web Frontend — Upgraded Application Logic (TypeScript)
 * 
 * Strict alignment with the PySide6 unified architecture:
 * - 2 Main stacked pages: Setup / Konfigurace and Learning / Sber dat.
 * - Coordinates Environment, Camera feeds, Model Config + CEO Planner split, and Motor Skills + Telemetry split.
 * - Exposes real-time WebSocket bindings for log console, orchestration pipeline, and loss chart telemetry.
 */

interface Project {
  name: string;
  slug: string;
  path: string;
  robots: Robot[];
  cameras: Camera[];
  skills: string[];
  skills_details: Record<string, SkillDetail>;
  models?: {
    llm_ceo?: ModelConfig;
    vlm_inspector?: ModelConfig;
  };
  policy_architecture?: string;
  lerobot_dir?: string;
  dataset_storage_dir?: string;
  leader_port?: string;
  follower_port?: string;
  robot_type?: string;
}

interface Robot {
  id: string;
  type: string;
  port: string;
  device_id?: string;
  label?: string;
  cameras?: string[];
  leader_port?: string;
  follower_port?: string;
  leader_calibration?: string;
  follower_calibration?: string;
}

interface Camera {
  id: string;
  source: number | string;
  device_id?: string;
  role: string;
  resolution?: number[];
  fps?: number;
}

interface SkillDetail {
  name: string;
  slug: string;
  description?: string;
  parent_slug?: string | null;
}

interface ModelConfig {
  endpoint?: string;
  model_name?: string;
  system_prompt?: string;
}

interface LossPoint {
  epoch: number;
  loss: number;
}

interface WSMessage {
  event: string;
  data: any;
}

declare const I18N: Record<string, Record<string, string>>;

const App = {
  ws: null as WebSocket | null,
  project: null as Project | null,
  // UI language ('cs' default; falls back to Czech for any untranslated key)
  lang: ((typeof localStorage !== 'undefined' && localStorage.getItem('orchiday_lang')) || 'cs') as 'cs' | 'en',
  lossData: [] as LossPoint[],
  pipelineTasks: [] as string[],
  _consoleLines: 0,
  activeStep: 1,
  activeSkill: null as string | null,
  calibratingRobotId: null as string | null,
  // Joints whose recorded range is still (near) zero — i.e. never moved during
  // this run. Saving those writes range_min == range_max, which leaves the
  // joint unusable, so the confirm step checks this first.
  _calUnmeasured: [] as string[],
  // A few encoder counts of slack: a motionless joint still jitters by 1-2.
  _CAL_MIN_SPAN: 10,
  // Whether `import lerobot` actually succeeds in the configured Python
  // interpreter — checked live via /api/settings/sysinfo, never assumed.
  // Starts false (safe default) so calibrate/teleop stay gated until confirmed.
  lerobotAvailable: false,
  activeTrainingSkill: null as string | null,
  trainingQueue: [] as string[],
  _trainTotalSteps: 0,
  // Running LeRobot subprocesses: key -> kind (teleop/record/train/infer/calibrate/replay/eval/dataset_edit)
  runningProcs: {} as Record<string, string>,
  activeCameras: [] as string[],
  availablePorts: [] as any[],
  availableCameras: [] as any[],
  // The robot/teleoperator types LeRobot registers, fetched once from
  // /api/hardware/device_types. The browser never derives the pair itself.
  deviceTypes: [] as any[],
  isProjectLoading: false,
  projectOpenInFlight: false,
  // Projects page is master/detail: the list only *selects*, the detail panel
  // opens. Kept as the path (stable identity) plus the last listing, so the
  // detail panel survives a re-render triggered by an unrelated event.
  selectedProjectPath: '' as string,
  knownProjects: [] as any[],
  wsConnectedOnce: false,
  collapsedFolders: new Set<string>(),
  taggingStartTime: 0,
  taggingActiveIndex: 0,
  taggingPoints: [] as number[],
  taggingInterval: null as any,
  taggingEpisode: -1,
  // Phase of lerobot's record loop: 'record' | 'reset' | 'idle'
  taggingPhase: 'idle',
  // True between a successful /recording/start and the process ending. The
  // recording keys and the live controls are both gated on this instead of on
  // an element's inline display, which stopped being a reliable signal once the
  // marking panel became permanently visible.
  recordingActive: false,
  // Last /orchestration/plan_preview response, kept so a language switch can
  // repaint the plan column without refetching (and without silently showing
  // checkpoint readiness from a different moment than the numbers above it).
  orchPreview: null as any,
  // Last /api/training/targets response. Cached so a language switch or a
  // progress event repaints the list without another round trip; refetched
  // whenever something on disk could have changed (page opened, run finished).
  trainTargets: null as any,
  // Which targets the user ticked. Kept in state, not read off the DOM: the
  // list re-renders whenever readiness changes (a run in the queue finishes and
  // writes a checkpoint), and re-rendering must not silently drop the rest of
  // the user's selection mid-queue.
  trainSelected: new Set<string>(),
  trainStatusKey: null as { key: string; params?: Record<string, string | number>; color?: string } | null,
  // Sub-steps currently offered to the inference daemon, plus which one it was
  // last told to run. Held in state because the rows are rebuilt on a language
  // switch and the running row must survive that.
  inferenceSubSkills: [] as string[],
  inferenceActiveSubSkill: '' as string,
  inferenceDoneSubSkills: [] as string[],
  // Last orchestration status line as key + params, so a language switch can
  // re-render a message that carries a step name instead of leaving it in the
  // previous language.
  orchStatusKey: null as { key: string, params?: Record<string, string | number> } | null,
  armVisualConfig: null as any,
  armJointRanges: { leader: {}, follower: {} } as { leader: Record<string, {min: number, max: number}>, follower: Record<string, {min: number, max: number}> },
  wizardActivePage: 1,
  wizardSelectedOption: 'install', // 'install' or 'connect'
  wizardLeaderPort: '',
  wizardLeaderDeviceId: '',
  wizardFollowerPort: '',
  wizardFollowerDeviceId: '',
  wizardLeaderSubStep: 1,
  wizardFollowerSubStep: 1,
  wizardLeRobotParentDir: '',
  wizardCameras: [] as any[],
  wizardFoundLeRobotPath: '',
  wizardMode: 'initial' as 'initial' | 'quick',
  newProjectSetupMode: 'quick' as 'quick' | 'plain',
  autoDetectActiveArm: 'leader' as 'leader' | 'follower',
  autoDetectLeaderStep: 1,
  autoDetectFollowerStep: 1,
  lastCamerasWidth: '520px',
  cameraLayout: 'auto',

  // Skill/step wizard state
  skillWizardType: 'main' as 'main' | 'step',
  skillWizardIsEdit: false,
  skillWizardEditSlug: '',
  skillWizardPrefilledParent: '',

  // ── Internationalization (i18n) ─────────────────────────────────────
  /**
   * Translate a key for the current language, falling back to Czech then the key.
   * Optional `params` substitutes `{name}` placeholders in the translated string.
   */
  t(key: string, params?: Record<string, string | number>): string {
    const dict = (typeof I18N !== 'undefined' && I18N) || {};
    let s = (dict[this.lang] && dict[this.lang][key]) || (dict.cs && dict.cs[key]) || key;
    if (params) {
      for (const p in params) s = s.replace(new RegExp('\\{' + p + '\\}', 'g'), String(params[p]));
    }
    return s;
  },

  /** Apply translations to every tagged element under `root`. */
  applyI18n(root: Document | HTMLElement = document): void {
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      if (k) el.textContent = this.t(k);
    });
    root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(el => {
      const k = el.getAttribute('data-i18n-html');
      if (k) el.innerHTML = this.t(k);
    });
    root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach(el => {
      const k = el.getAttribute('data-i18n-ph');
      if (k) el.placeholder = this.t(k);
    });
    root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
      const k = el.getAttribute('data-i18n-title');
      if (k) el.title = this.t(k);
    });
    root.querySelectorAll<HTMLElement>('[data-i18n-tooltip]').forEach(el => {
      const k = el.getAttribute('data-i18n-tooltip');
      if (k) el.setAttribute('data-tooltip', this.t(k));
    });
    document.documentElement.lang = this.lang;
    // Keep the language toggle in sync with the active language
    document.querySelectorAll<HTMLElement>('.lang-toggle [data-lang]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === this.lang);
    });
  },

  /** Switch language, persist it, and re-render translatable surfaces. */
  setLang(lang: 'cs' | 'en'): void {
    if (lang !== 'cs' && lang !== 'en') return;
    this.lang = lang;
    try { localStorage.setItem('orchiday_lang', lang); } catch (_) {}
    this.applyI18n();
    // Reflect the choice in the language toggle buttons
    document.querySelectorAll<HTMLElement>('.lang-toggle [data-lang]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });
    // Re-render dynamically-built surfaces — they bake t() at render time, so
    // they must be rebuilt for the new language (skill trees, robots, cameras…).
    this.rerenderDynamic();
    // Persist server-side (best effort; ignored if no project is open)
    this.api('POST', '/settings', { language: lang }).catch(() => {});
  },

  /** Rebuild all JS-rendered content so it reflects the current language. */
  rerenderDynamic(): void {
    try {
      // The Projects page is entirely JS-rendered (row meta, counters, detail
      // panel), and it is the landing page — so it must rebuild regardless of
      // whether a project is open. Rendering from the cached listing avoids a
      // refetch just to change the language.
      this.renderProjectList(this.knownProjects, []);
      if (this.project) {
        this.renderSkillsFull();
        this.renderRobots();
        this.renderCameras();
      }
      // The marking column and the episode rows are built in JS too, so they
      // would otherwise keep the previous language.
      if (this.activeSkill) this.selectSkill(this.activeSkill);
      else this.renderStepPlan();
      // Both lists live inside a tab of a bigger page, so the page id is what
      // decides whether they are on screen (they used to be looked up under
      // ids that no element carries, which made a language switch leave the
      // dataset list and the resume-skill picker in the previous language).
      const dsPage = document.getElementById('page-datasety');
      if (dsPage && dsPage.classList.contains('active-page')) this.dsRefreshList();
      const trainPage = document.getElementById('page-uceni');
      if (trainPage && trainPage.classList.contains('active-page')) {
        this.advPopulateResumeSkills();
        // Built in JS from the cached response, so it would otherwise keep the
        // previous language — no refetch just to change the wording.
        this.renderTrainingSkillsTree();
        // The status line carries runtime values (a step, a loss, an error), so
        // it has no static data-i18n to repaint it — re-render from the
        // remembered key instead.
        if (this.trainStatusKey) {
          const k = this.trainStatusKey;
          this.updateTrainingStatus(this.t(k.key, k.params), k.color, k.key, k.params);
        }
      }
      // The orchestration page builds its plan preview and its sub-task queue
      // in JS as well, so both would keep the previous language. Rendered from
      // the cached response — no refetch just to change the wording.
      if (this.orchPreview) this.renderOrchPreview(this.orchPreview);
      if (this.orchStatusKey?.params) {
        const el = document.getElementById('orch-status-indicator');
        if (el) el.textContent = this.t(this.orchStatusKey.key, this.orchStatusKey.params);
      }
      this.renderInferenceSubtasks(this.inferenceSubSkills);
      // The Connect tab builds its device-type rows and both hardware tables
      // in JS from cached responses, so they would otherwise keep the previous
      // language. The command preview carries runtime values (ports, ids) and
      // has no static data-i18n, so it repaints from state too.
      this.renderRobotTypeList();
      this.renderDetectedHardware();
      this.updateConnectCmdPreview();
    } catch (_) { /* renders are best-effort */ }
  },

  // ── Init ────────────────────────────────────────────────────────────
  init(): void {
    this.applyI18n();
    this.connectWS();
    this.bindConsoleInput();
    this.bindAutoSlug();
    this.loadProjects();
    this.bindResizers();
    this.bindModals();
    // Paint the marking column before any project is open, so it reads as
    // "nothing selected yet" instead of an empty box.
    this.renderStepPlan();
    // The Connect tab renders its choices from LeRobot's registry, so the
    // catalogue is fetched before a project can select one of them.
    this.loadDeviceTypes();
    this.renderDetectedHardware();

    // Default tab
    this.changeTab('projects');

    // Camera layout setup
    this.cameraLayout = localStorage.getItem('orchiday_camera_layout') || 'auto';
    const layoutSelect = document.getElementById('camera-layout-select') as HTMLSelectElement | null;
    if (layoutSelect) {
      layoutSelect.value = this.cameraLayout;
    }

    // Setup Wizard Check
    const completed = localStorage.getItem('orchiday_setup_completed');
    if (!completed) {
      this.showSetupWizard();
    }

    // Keyboard Enter listener for arm unplug detection
    window.addEventListener('keydown', (e) => {
      const overlay = document.getElementById('setup-wizard-overlay');
      if (overlay && overlay.style.display !== 'none') {
        if (e.key === 'Enter') {
          if (this.wizardActivePage === 4 && this.wizardLeaderSubStep === 2) {
            e.preventDefault();
            this.wizardConfirmUnplugArm('leader');
          } else if (this.wizardActivePage === 5 && this.wizardFollowerSubStep === 2) {
            e.preventDefault();
            this.wizardConfirmUnplugArm('follower');
          }
        }
      }
    });

    window.addEventListener('resize', () => {
      this.drawLossChart();
    });

    // Live recording keys. lerobot's own listener needs pynput or a TTY and has
    // neither under our subprocess, so the app is what turns a key press into a
    // recording control (the same three flags lerobot's listener sets) and into
    // a sub-task boundary mark. They therefore only work while this window has
    // focus, which is what the on-screen key map says.
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const recordingActive = this.recordingActive;

      // Never steal keys from a field the user is typing into.
      const target = e.target as HTMLElement | null;
      const typing = !!target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' || target.isContentEditable);

      if (recordingActive && !typing) {
        if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          this.sendRecordingAction('next');
        } else if (e.key === 'ArrowLeft' || e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          this.sendRecordingAction('reset');
        } else if (e.key === 'Escape' || e.key === 'q' || e.key === 'Q') {
          e.preventDefault();
          this.sendRecordingAction('stop');
        }
      }
      // The marking panel is on screen whether or not a take is running, so the
      // marking keys are gated on the session, not on the panel being visible.
      if (recordingActive && !typing) {
        if (e.key === ' ' || e.key === 'm' || e.key === 'M') {
          e.preventDefault();
          this.taggingNextStep();
        } else if (e.key === 'Backspace' || e.key === 'u' || e.key === 'U') {
          e.preventDefault();
          this.taggingUndoStep();
        }
      }
      // Escape closes the topmost modal dialog (unless a recording session owns the key)
      if (e.key === 'Escape' && !recordingActive) {
        if (this.closeTopModal()) e.preventDefault();
      }
    });
  },

  // ── WebSocket Connection ────────────────────────────────────────────
  connectWS(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.host || 'localhost:8000';
    this.ws = new WebSocket(`${proto}://${host}/ws`);

    this.ws.onopen = () => {
      const el = document.getElementById('status-ws');
      if (el) el.className = 'status-dot connected';
      this.log('SUCCESS', 'Connected to Orchiday server');
      // Re-sync subprocess state after every (re)connect so button gating is accurate
      this.syncRunningProcesses();
      // On a RECONNECT (not the first connect — init() already loads once),
      // re-hydrate project state in case the server restarted or project
      // state changed while the socket was down.
      if (this.wsConnectedOnce) this.loadProjects();
      this.wsConnectedOnce = true;
    };

    this.ws.onclose = () => {
      const el = document.getElementById('status-ws');
      if (el) el.className = 'status-dot error';
      setTimeout(() => this.connectWS(), 3000);
    };

    this.ws.onerror = () => {
      const el = document.getElementById('status-ws');
      if (el) el.className = 'status-dot error';
    };

    this.ws.onmessage = (e: MessageEvent) => {
      try {
        this.handleEvent(JSON.parse(e.data));
      } catch (_) {}
    };
  },

  // ── Real-Time Event Dispatcher ──────────────────────────────────────
  handleEvent(msg: WSMessage): void {
    const { event, data } = msg;
    switch (event) {
      case 'log_message':
        this.log(data.level, data.message);
        break;
      case 'process_started':
        this.runningProcs[data.key] = data.kind;
        this.updateActionButtonStates();
        break;
      case 'process_finished':
        delete this.runningProcs[data.key];
        this.updateActionButtonStates();
        this.updateHardwareButtonStates();
        // robot_calibrated only fires on success — also hide the live table
        // here so a FAILED calibration doesn't leave it stuck on screen.
        if (data.kind === 'calibrate') {
          this.hideCalibrationLivePanel();
          this.refreshProject();
        }
        break;
      case 'console_output':
        if (data.startsWith('[TELEMETRY]')) {
          this.handleInferenceTelemetry(data);
        } else {
          this.logRaw(data);
          this.handleInferenceTelemetry(data);
        }
        break;
      case 'project_opened':
        this.onProjectOpened(data);
        break;
      case 'project_closed':
        this.onProjectClosed();
        break;
      case 'robot_added':
      case 'robot_removed':
      case 'camera_added':
      case 'camera_removed':
      case 'skill_created':
      case 'skill_deleted':
        this.refreshProject();
        break;
      case 'robot_connected':
        const rEl = document.getElementById('status-robot');
        if (rEl) rEl.className = 'status-dot connected';
        this.log('INFO', 'Robot hardware connected successfully');
        break;
      case 'robot_disconnected':
        const rdEl = document.getElementById('status-robot');
        if (rdEl) rdEl.className = 'status-dot';
        this.log('WARN', 'Robot hardware disconnected');
        break;
      case 'model_connection_ok':
        const lmEl = document.getElementById('status-lm');
        if (lmEl) lmEl.className = 'status-dot connected';
        this.log('SUCCESS', `Connection to LM Studio established: ${data}`);
        break;
      case 'model_connection_fail':
        const lmfEl = document.getElementById('status-lm');
        if (lmfEl) lmfEl.className = 'status-dot error';
        this.log('ERROR', `LM Studio model connection failed: ${data.error || data}`);
        break;
      case 'camera_started':
        if (!this.activeCameras) this.activeCameras = [];
        if (!this.activeCameras.includes(data)) this.activeCameras.push(data);
        this.renderCameras();
        this.log('SUCCESS', `Camera ${data} started streaming feed`);
        break;
      case 'camera_stopped':
        if (this.activeCameras) this.activeCameras = this.activeCameras.filter(cid => cid !== data);
        this.renderCameras();
        this.log('INFO', `Camera ${data} feed offline`);
        break;
      case 'camera_error':
        // The backend already retries/guards internally — this is purely
        // "tell the user why", which was previously silent (no case here at
        // all), so a failing camera looked like an endless unexplained retry.
        if (this.activeCameras) this.activeCameras = this.activeCameras.filter(cid => cid !== data?.id);
        this.renderCameras();
        this.log('ERROR', `Kamera '${data?.id}': ${data?.error || 'neznámá chyba'}`);
        break;
      case 'camera_suspended':
        // A robot process took exclusive access — preview resumes automatically
        if (this.activeCameras) this.activeCameras = this.activeCameras.filter(cid => cid !== data);
        this.renderCameras();
        this.log('INFO', this.t('log.camSuspended', {c: data}));
        break;
      case 'robot_calibrating':
        this.showCalibrationLivePanel(data);
        break;
      case 'robot_calibrated':
        this.hideCalibrationLivePanel();
        this.refreshProject();
        if (document.getElementById('modal-calibration-files')?.classList.contains('open')) {
          this.loadCalibrationFiles();
        }
        this.log('SUCCESS', `Kalibrace ramene '${data}' byla dokončena.`);
        break;
      case 'calibration_progress':
        this.renderCalibrationLiveTable(data?.id, data?.values);
        break;
      case 'calibration_list_changed':
        // Keep robots[].leader_calibration/follower_calibration (and thus the
        // teleop-requires-calibration button gate) in sync without the heavy
        // full project_opened re-init (AI models, hardware rescan, LM Studio
        // reconnect) — a plain GET /api/project is enough here.
        this.refreshProject();
        if (document.getElementById('modal-calibration-files')?.classList.contains('open')) {
          this.loadCalibrationFiles();
        }
        break;
      case 'recording_started':
        this.log('INFO', `Demonstration recording started for skill: ${data}`);
        this.updateTrainingStatus(`Recording demonstration for '${data}'...`, 'var(--yellow)');
        // The process may also have been started from another client.
        this.setRecordingUiActive(true);
        break;
      case 'recording_progress':
        this.log('INFO', `Recording episode progress: ${Math.round(data.progress * 100)}%`);
        this.updateTrainingStatus(`Recording... ${Math.round(data.progress * 100)}%`, 'var(--yellow)');
        break;
      case 'recording_episode':
        this.log('INFO', this.t('log.episodeStarted', {n: data.episode}));
        this.onRecordingEpisodeStarted(data.episode);
        break;
      case 'recording_phase':
        this.onRecordingPhase(data.phase);
        break;
      case 'recording_episode_discarded':
        this.onRecordingEpisodeDiscarded(data.episode);
        break;
      case 'step_marked':
        // The recording process confirmed a mark — this is what advances the
        // wizard, whichever client (or key) asked for it.
        this.onStepMarked(data);
        break;
      case 'recording_stopped':
        this.log('SUCCESS', `Demonstration episode recorded successfully for: ${data.skill}`);
        this.updateTrainingStatus(`Recording complete! Saved ${data.episode_count || 0} episodes.`, 'var(--green)');
        this.setRecordingUiActive(false);
        this.finishTaggingPostProcess();
        this.refreshProject();
        break;
      case 'training_started':
        this.log('INFO', this.t('log.trainStarted', {s: data}));
        this.activeTrainingSkill = data;
        if (this.trainingQueue) {
          this.trainingQueue = this.trainingQueue.filter(s => s !== data);
        }
        this.renderTrainingSkillsTree();
        this.updateTrainingStatus(this.t('status.trainingStep', {s: data}), 'var(--cyan)',
          'status.trainingStep', {s: data});
        break;
      case 'training_progress':
        this.addLossPoint(data.epoch, data.loss);
        this.updateTrainingProgress(data.epoch, data.loss, data.skill);
        break;
      case 'training_finished':
        this.log('SUCCESS', this.t('log.trainDone', {s: data.skill}));
        this.updateTrainingStatus(this.t('status.trainDoneCkpt'), 'var(--green)',
          'status.trainDoneCkpt');
        if (data.skill) {
          const fill = document.getElementById(`train-progress-fill-${data.skill}`);
          if (fill) fill.style.width = `100%`;
          const txt = document.getElementById(`train-progress-text-${data.skill}`);
          if (txt) txt.textContent = this.t('status.done');
        }
        if (this.activeTrainingSkill === data.skill) {
          this.activeTrainingSkill = null;
        }
        this.refreshProject();
        // A checkpoint now exists that did not before, so the readiness flags
        // on the target list are stale until they are re-read from disk.
        this.loadTrainingTargets();
        break;
      case 'training_error':
        this.log('ERROR', this.t('log.trainErr', {s: data.skill, e: data.error}));
        this.updateTrainingStatus(this.t('status.trainErrShort', {e: data.error}), 'var(--red)',
          'status.trainErrShort', {e: data.error});
        if (data.skill) {
          const txt = document.getElementById(`train-progress-text-${data.skill}`);
          if (txt) txt.textContent = this.t('val.error');
        }
        if (this.activeTrainingSkill === data.skill) {
          this.activeTrainingSkill = null;
        }
        this.refreshProject();
        break;
      case 'orchestration_plan_ready':
        this.renderPipeline(data);
        break;
      case 'orchestration_task_started':
        this.setPipelineStep(data, 'active');
        // Carries the step name, so it must not keep a data-i18n key.
        this.updateOrchStatus(this.t('orch.activeStep', { task: data }), 'var(--yellow)',
          'orch.activeStep', { task: data });
        // The daemon is executing this step's own policy now — reflect that in
        // the worker column so the two columns cannot disagree about which
        // sub-task is live.
        const evalTaskEl = document.getElementById('eval-task-name') as HTMLInputElement | null;
        if (evalTaskEl) {
          evalTaskEl.value = data;
        }
        this.setInferenceSubtaskRunning(data);
        break;
      case 'orchestration_task_completed':
        this.setPipelineStep(data.task, data.success ? 'done' : 'failed');
        this.setVlmVerdict(data.success ? 'ok' : 'failed');
        break;
      case 'orchestration_locked':
        this.setTaskLatch(true);
        break;
      case 'orchestration_unlocked':
        this.setTaskLatch(false);
        break;
      case 'orchestration_vlm_snap':
        const snapImg = document.getElementById('vlm-inspect-image') as HTMLImageElement | null;
        const snapNone = document.getElementById('vlm-inspect-none');
        if (snapImg && snapNone) {
          snapImg.src = `data:image/jpeg;base64,${data}`;
          snapImg.style.display = 'block';
          snapNone.style.display = 'none';
        }
        this.setVlmVerdict('verifying');
        break;
      case 'orchestration_finished':
        this.updateOrchStatus(this.t(data ? 'orch.finishedOk' : 'orch.finishedErr'),
          data ? 'var(--green)' : 'var(--yellow)', data ? 'orch.finishedOk' : 'orch.finishedErr');
        // A finished run may have produced nothing new on disk, but a failed
        // one is very often a missing checkpoint — re-read the flags.
        this.loadOrchPreview();
        break;
      case 'orchestration_error':
        this.updateOrchStatus(this.t('orch.error', { msg: String(data) }), 'var(--red)',
          'orch.error', { msg: String(data) });
        break;
      case 'pong':
        break;
    }
  },

  // ── Tab Router (Upgraded for dynamically changing Sidebar content) ────
  // Maps a tab id to its parent navigation category (two-level nav)
  _navCategoryOf(tabId: string): string | null {
    const map: Record<string, string> = {
      setup: 'setup',
      datasety: 'datasets',
      uceni: 'learning',
      modelrun: 'orchestration',
    };
    return map[tabId] || null;
  },

  // ── Process-aware button gating ─────────────────────────────────────
  hasRunning(kind: string): boolean {
    return Object.values(this.runningProcs).includes(kind);
  },

  async syncRunningProcesses(): Promise<void> {
    try {
      const res = await this.api('GET', '/processes');
      this.runningProcs = res?.processes || {};
    } catch (_) {
      this.runningProcs = {};
    }
    this.updateActionButtonStates();
  },

  /**
   * Enable/disable workflow action buttons based on what is actually running.
   * Stop buttons are only active while their process runs; start buttons are
   * blocked while the serial bus is occupied by another robot process.
   */
  updateActionButtonStates(): void {
    const teleopRunning = this.hasRunning('teleop');
    const recordRunning = this.hasRunning('record');
    const trainRunning = this.hasRunning('train');
    const inferRunning = this.hasRunning('infer');
    const calibrating = this.hasRunning('calibrate');
    const replayRunning = this.hasRunning('replay');
    // Any process holding the robot's serial bus blocks other hardware actions
    const busBusy = teleopRunning || recordRunning || inferRunning || calibrating || replayRunning;

    const setDisabled = (id: string, disabled: boolean, title?: string) => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (!el) return;
      el.disabled = disabled;
      el.classList.toggle('btn-busy-locked', disabled && busBusy);
      if (title !== undefined) el.title = title;
    };

    // Teleoperation
    setDisabled('btn-stop-teleop', !teleopRunning,
      teleopRunning ? this.t('tip.stopTeleop') : this.t('tip.teleopNotRunning'));
    if (busBusy) {
      setDisabled('btn-start-teleop', true,
        teleopRunning ? this.t('tip.teleopAlready') : this.t('tip.busBusy'));
    } else {
      // Re-enable start button when nothing holds the bus (port/calibration
      // gating is handled separately in updateHardwareButtonStates).
      const btn = document.getElementById('btn-start-teleop') as HTMLButtonElement | null;
      if (btn && btn.title === this.t('tip.teleopAlready') || btn?.title === this.t('tip.busBusy')) {
        btn!.disabled = false;
        btn!.title = this.t('tip.startsTeleop');
        btn!.classList.remove('btn-busy-locked');
      }
    }

    // Recording (any bus-holding process blocks a new recording)
    setDisabled('btn-start-record', busBusy,
      recordRunning ? this.t('tip.recordAlready') : (busBusy ? this.t('tip.busBusy') : this.t('tip.startsRecord')));
    setDisabled('btn-stop-record', !recordRunning,
      recordRunning ? this.t('tip.stopsRecord') : this.t('tip.recordNotRunning'));

    // Training (GPU-bound, not bus-bound)
    setDisabled('btn-start-training', trainRunning,
      trainRunning ? this.t('tip.trainAlready') : this.t('tip.startsTrain'));
    setDisabled('btn-stop-training', !trainRunning,
      trainRunning ? this.t('tip.stopsTrain') : this.t('tip.trainNotRunning'));

    // Inference / deployment (any bus-holding process blocks a new deployment)
    setDisabled('btn-deploy-policy', busBusy,
      inferRunning ? this.t('tip.inferAlready') : (busBusy ? this.t('tip.busBusy') : this.t('tip.deploysPolicy')));
    setDisabled('btn-stop-inference', !inferRunning,
      inferRunning ? this.t('tip.stopsInfer') : this.t('tip.inferNotRunning'));

    // Calibration buttons: block while the bus is in use, otherwise port logic applies
    if (busBusy) {
      setDisabled('btn-calibrate-leader', true, this.t('tip.busBusyShort'));
      setDisabled('btn-calibrate-follower', true, this.t('tip.busBusyShort'));
    }

    // Live status pulse on the teleop indicator (if present)
    const teleBadge = document.getElementById('tele-running-badge');
    if (teleBadge) teleBadge.style.display = teleopRunning ? 'inline-flex' : 'none';
  },

  changeTab(tabId: string): void {
    // Guard: Must have active project to select tabs other than 'projects'.
    // The Help page is pure documentation — always accessible.
    if (tabId !== 'projects' && tabId !== 'help' && !this.project) {
      alert(this.t('alert.openProjectFirst'));
      this.changeTab('projects');
      return;
    }

    // Stop camera preview if leaving the setup page
    if (tabId !== 'setup') {
      this.hwStopCameraPreview();
    }

    // 1. Toggles activitybar buttons active state (+ a11y current marker)
    document.querySelectorAll('.activitybar .activity-btn').forEach(btn => {
      btn.classList.remove('active', 'active-parent');
      btn.removeAttribute('aria-current');
    });
    const activeBtn = document.getElementById(`btn-${tabId}`);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.setAttribute('aria-current', 'page');
    }

    // 2. Toggles workspace page visibility.
    // Selected by class alone, not '.workspace .editor-area': scoping it to a
    // container makes hiding depend on the markup nesting staying intact, and
    // a single stray </div> earlier in the file put half the pages outside
    // .workspace — they then kept .active-page forever and five pages
    // rendered stacked on top of each other, 32px tall each.
    document.querySelectorAll('.editor-area').forEach(page => {
      page.classList.remove('active-page');
    });
    const activePage = document.getElementById(`page-${tabId}`);
    if (activePage) {
      activePage.classList.add('active-page');
    }

    // 3. Update breadcrumbs trail dynamically
    const bcSection = document.getElementById('breadcrumb-section');
    const bcFile = document.getElementById('breadcrumb-file');
    if (bcSection) {
      if (tabId === 'projects') bcSection.textContent = 'projects';
      else if (tabId === 'setup') bcSection.textContent = 'setup';
      else if (tabId === 'teleoperation') bcSection.textContent = 'teleoperation';
      else if (tabId === 'datasety') bcSection.textContent = 'datasets';
      else if (tabId === 'uceni') bcSection.textContent = 'learning';
      else if (tabId === 'modelrun') bcSection.textContent = 'model_run';
      else if (tabId === 'settings') bcSection.textContent = 'settings';
      else if (tabId === 'help') bcSection.textContent = 'help';
    }
    if (bcFile) {
      if (tabId === 'projects') bcFile.textContent = 'projects.json';
      else if (tabId === 'setup') bcFile.textContent = 'setup.json';
      else if (tabId === 'teleoperation') bcFile.textContent = 'teleoperation.json';
      else if (tabId === 'datasety') bcFile.textContent = this.activeSkill || 'pick_cube';
      else if (tabId === 'uceni') bcFile.textContent = 'policy_training.json';
      else if (tabId === 'modelrun') bcFile.textContent = 'ceo_execution.json';
      else if (tabId === 'settings') bcFile.textContent = 'config.json';
      else if (tabId === 'help') bcFile.textContent = 'orchestration_schema';
    }

    if (tabId === 'uceni') {
      // Sync the policy picker cards with the project's stored architecture
      this.syncPolicyCards();
      // Force chart redraw to fill container
      setTimeout(() => this.drawLossChart(), 100);
      // Datasets and checkpoints appear on disk between visits (a recording
      // finished, a training run completed), so readiness is only true as of
      // the moment it was fetched — re-read it every time the page opens
      // rather than trusting the cached answer.
      this.api('GET', '/training/status')
        .then(status => {
          this.activeTrainingSkill = status.active_skill;
          this.trainingQueue = status.queue || [];
        })
        .catch(err => {
          console.error("Failed to fetch training status", err);
        })
        .finally(() => this.loadTrainingTargets());
    } else if (tabId === 'settings') {
      this.loadSysInfo();
    } else if (tabId === 'datasety') {
      this.dsRefreshList();
    } else if (tabId === 'teleoperation' || tabId === 'setup') {
      // Also needed on 'setup': the calibration tab's mini arm SVG and
      // joint-ID legend reuse this same config.
      this.loadArmVisualConfig();
    } else if (tabId === 'modelrun') {
      // Checkpoints appear on disk while training runs, so the readiness
      // flags are only true as of the moment they were fetched — re-read
      // them every time the page is opened rather than caching.
      this.loadOrchPreview();
    }
  },

  /** Switches between the Setup wizard's Connect / Kalibrace / Modely tabs.
   * All three live in the same page-setup DOM (not separate pages), so this
   * is pure show/hide — no data reload needed on its own. */
  switchSetupTab(tab: 'connect' | 'calibrate' | 'models'): void {
    const page = document.getElementById('page-setup');
    if (!page) return;
    page.querySelectorAll('.setup-wizard-tab-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
    });
    page.querySelectorAll('.setup-wizard-panel').forEach(panel => {
      (panel as HTMLElement).style.display = (panel as HTMLElement).dataset.tabPanel === tab ? '' : 'none';
    });
    if (tab === 'calibrate') this.refreshCalibrationTab();
  },

  /** Fills the Kalibrace tab from state that already exists elsewhere: the
   * Connect tab's port/id fields and the arm_visual_config response that also
   * drives the teleop page. No extra endpoint, and no stale card left behind
   * when the user edits the hardware config and switches tabs. */
  refreshCalibrationTab(): void {
    this.renderCalibrationArmCards(this.armVisualConfig);
    // Drawn even with no project open: the schematic is what fills the run
    // column's height, and an empty box there is exactly the dead space this
    // layout exists to remove. Without a config it renders the neutral
    // outline and the motor-id legend stays empty.
    this.renderCalibrationIdleVisual();
    if (!this.armVisualConfig && this.project) this.loadArmVisualConfig();
    // Switching a tab must never fail on a backend hiccup — the summary just
    // stays in its "load state" wording.
    this.loadCalibrationFiles().catch(() => {});
  },

  /** Per-arm state cards on the Kalibrace tab. `source: "default"` means
   * nothing is bound and LeRobot would run with generic ranges — worth seeing
   * before starting, not after the arm moves wrong. */
  renderCalibrationArmCards(cfg: any): void {
    const portOf = (role: 'leader' | 'follower'): string => {
      const sel = document.getElementById(`tele-${role}-port`) as HTMLSelectElement | null;
      const v = sel?.value || '';
      if (v === '__custom__') {
        return (document.getElementById(`tele-${role}-port-custom`) as HTMLInputElement | null)?.value.trim() || '';
      }
      return v;
    };

    for (const side of ['leader', 'follower'] as const) {
      const card = document.getElementById(`cal-arm-${side}`);
      if (!card) continue;
      const arm = cfg?.[side];
      const calibrated = arm?.source === 'calibration' && !!arm.filename;
      card.classList.toggle('is-calibrated', !!calibrated);
      card.classList.toggle('is-default', !!arm && !calibrated);

      const set = (id: string, text: string, isDefault = false) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        el.classList.toggle('is-default', isDefault);
      };
      const stateKey = !arm ? 'cal.stateUnknown' : calibrated ? 'cal.stateCalibrated' : 'cal.stateDefault';
      const stateEl = document.getElementById(`cal-state-${side}`);
      if (stateEl) {
        stateEl.textContent = this.t(stateKey);
        stateEl.setAttribute('data-i18n', stateKey);
      }

      const jointNames = Object.keys(arm?.joints || {});
      set(`cal-device-${side}`, arm?.device_type || '-');
      // The id is what LeRobot names the calibration file after
      // (<cache>/<category>/<type>/<id>.json), so it comes from the same
      // field calibrateArm() passes as --robot.id / --teleop.id.
      const activeRobot = (this.project?.robots || [])[0];
      set(`cal-id-${side}`, (document.getElementById(`tele-${side}-id`) as HTMLInputElement | null)?.value
        || (side === 'leader' ? activeRobot?.leader_id : activeRobot?.follower_id) || '-');
      set(`cal-port-${side}`, portOf(side) || '-');
      set(`cal-file-${side}`, calibrated ? arm.filename : arm ? this.t('cal.fileDefault') : '-', !!arm && !calibrated);
      set(`cal-joints-${side}`, jointNames.length ? String(jointNames.length) : '-');

      const portHint = document.getElementById(`cal-tab-${side}-port`);
      if (portHint) portHint.textContent = portOf(side) || '-';
    }
  },

  /** Switches between the Datasety wizard's Sběr / Správa tabs — both live
   * in the same page-datasety DOM, pure show/hide like switchSetupTab. */
  switchDatasetyTab(tab: 'collect' | 'manage'): void {
    const page = document.getElementById('page-datasety');
    if (!page) return;
    page.querySelectorAll('.setup-wizard-tab-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
    });
    page.querySelectorAll('.setup-wizard-panel').forEach(panel => {
      (panel as HTMLElement).style.display = (panel as HTMLElement).dataset.tabPanel === tab ? '' : 'none';
    });
  },

  /** Switches between the Učení wizard's Imitační učení / Pokročilé tabs. */
  switchUceniTab(tab: 'train' | 'advanced'): void {
    const page = document.getElementById('page-uceni');
    if (!page) return;
    page.querySelectorAll('.setup-wizard-tab-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
    });
    page.querySelectorAll('.setup-wizard-panel').forEach(panel => {
      (panel as HTMLElement).style.display = (panel as HTMLElement).dataset.tabPanel === tab ? '' : 'none';
    });
    if (tab === 'advanced') this.advPopulateResumeSkills();
  },

  /** Switches the Settings wizard between "Cesty a diagnostika" and the
   * LeRobot CLI utilities, which used to be a separate top-level page. */
  switchSettingsTab(tab: 'paths' | 'tools'): void {
    const page = document.getElementById('page-settings');
    if (!page) return;
    page.querySelectorAll('.setup-wizard-tab-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
    });
    page.querySelectorAll('.setup-wizard-panel').forEach(panel => {
      (panel as HTMLElement).style.display = (panel as HTMLElement).dataset.tabPanel === tab ? '' : 'none';
    });
  },

  // ── Policy architecture picker (learning page) ──────────────────────
  selectPolicyCard(value: string): void {
    const select = document.getElementById('train-policy-type') as HTMLSelectElement | null;
    if (select) select.value = value;
    document.querySelectorAll('.policy-pick-card').forEach(card => {
      const active = card.getAttribute('data-value') === value;
      card.classList.toggle('active', active);
      card.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  },

  syncPolicyCards(): void {
    const stored = this.project?.policy_architecture
      || (document.getElementById('train-policy-type') as HTMLSelectElement | null)?.value
      || 'act';
    // Only adopt architectures that have a card; otherwise keep the select value as-is
    if (document.querySelector(`.policy-pick-card[data-value="${stored}"]`)) {
      this.selectPolicyCard(stored);
    }
  },

  // ── Hardware Tools page (LeRobot CLI utilities) ─────────────────────
  async runHwTool(tool: string): Promise<void> {
    const robot = this.project?.robots?.[0] as any;
    const args: string[] = [];

    if (tool === 'find_cameras') {
      const backend = (document.getElementById('tool-cam-backend') as HTMLSelectElement | null)?.value;
      if (backend) args.push(backend);
    } else if (tool === 'setup_motors') {
      const arm = (document.getElementById('tool-motors-arm') as HTMLSelectElement | null)?.value || 'follower';
      if (arm === 'leader') {
        const lType = robot?.leader_type || 'so100_leader';
        const lPort = robot?.leader_port || this.project?.leader_port || '';
        if (!lPort) { alert(this.t('alert.noLeaderPort')); return; }
        args.push(`--teleop.type=${lType}`, `--teleop.port=${lPort}`);
      } else {
        const rType = robot?.follower_type || robot?.type || 'so100_follower';
        const rPort = robot?.follower_port || robot?.port || '';
        if (!rPort) { alert(this.t('alert.noFollowerPort')); return; }
        args.push(`--robot.type=${rType}`, `--robot.port=${rPort}`);
      }
    } else if (tool === 'find_joint_limits') {
      const rType = robot?.follower_type || robot?.type || 'so100_follower';
      const rPort = robot?.follower_port || robot?.port || '';
      const lType = robot?.leader_type || 'so100_leader';
      const lPort = robot?.leader_port || this.project?.leader_port || '';
      if (!rPort || !lPort) { alert(this.t('alert.needBothPorts')); return; }
      args.push(`--robot.type=${rType}`, `--robot.port=${rPort}`,
                `--teleop.type=${lType}`, `--teleop.port=${lPort}`);
    }

    this.log('INFO', `Spouštím LeRobot nástroj '${tool}' — výstup v terminálu dole.`);
    this.toggleTerminalOpen();
    const res = await this.api('POST', '/tools/run', { tool, args });
    if (res && res.ok === false) {
      this.log('ERROR', `Nástroj selhal: ${res.error}`);
    }
  },

  async hfLogin(): Promise<void> {
    const tokenEl = document.getElementById('tool-hf-token') as HTMLInputElement | null;
    const token = tokenEl?.value.trim() || '';
    if (!token) { alert(this.t('alert.enterHfToken')); return; }
    const res = await this.api('POST', '/tools/hf-login', { token });
    if (res && res.ok) {
      this.log('SUCCESS', 'Přihlášení k Hugging Face Hub proběhlo úspěšně.');
      if (tokenEl) tokenEl.value = '';
    } else {
      this.log('ERROR', `HF přihlášení selhalo: ${res?.error || 'neznámá chyba'}`);
      alert(`Přihlášení selhalo: ${res?.error || 'neznámá chyba'}`);
    }
  },

  // Ensure the bottom terminal is visible when a tool writes into it
  toggleTerminalOpen(): void {
    const dock = document.getElementById('bottom-dock-container') || document.getElementById('terminal-area');
    if (dock && dock.style.height === '40px') {
      this.toggleTerminal();
    }
  },

  // ── Dataset Management page ─────────────────────────────────────────
  _dsList: [] as any[],

  async dsRefreshList(): Promise<void> {
    const res = await this.api('GET', '/datasets/list');
    this._dsList = res?.datasets || [];
    const sel = document.getElementById('ds-select') as HTMLSelectElement | null;
    const mergeSel = document.getElementById('ds-merge-source') as HTMLSelectElement | null;
    if (!sel) return;
    const prev = sel.value;
    const opts = this._dsList.map((d: any) =>
      `<option value="${this.esc(d.repo_id)}" data-skill="${this.esc(d.skill)}">${this.esc(d.name)} — ${this.esc(d.repo_id)}${d.exists ? '' : ' (zatím nenahráno)'}</option>`
    ).join('');
    sel.innerHTML = opts || '<option value="">-- Žádné datasety v projektu --</option>';
    if (mergeSel) mergeSel.innerHTML = '<option value="">-- Vyberte druhý dataset --</option>' + opts;
    if (prev && this._dsList.some((d: any) => d.repo_id === prev)) sel.value = prev;
    this.dsOnSelect();
  },

  dsSelectedRepo(): string {
    return (document.getElementById('ds-select') as HTMLSelectElement | null)?.value || '';
  },

  dsSelectedSkill(): string {
    const sel = document.getElementById('ds-select') as HTMLSelectElement | null;
    return sel?.selectedOptions[0]?.getAttribute('data-skill') || '';
  },

  async dsOnSelect(): Promise<void> {
    const skill = this.dsSelectedSkill();
    const setVal = (id: string, v: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    // Dataset operations only make sense for a dataset that exists on disk
    const setOpsEnabled = (enabled: boolean) => {
      ['ds-btn-viz', 'ds-btn-replay', 'ds-btn-info', 'ds-btn-stats', 'ds-btn-push',
       'ds-btn-del', 'ds-btn-task', 'ds-btn-split', 'ds-btn-merge'].forEach(id => {
        const btn = document.getElementById(id) as HTMLButtonElement | null;
        if (btn) {
          btn.disabled = !enabled;
          btn.title = enabled ? '' : 'Dataset zatím není nahraný na disku — nejprve nahrajte demonstrace (Sběr dat).';
        }
      });
    };
    const exportBtn = document.getElementById('ds-btn-export-model') as HTMLButtonElement | null;
    const splitBtn = document.getElementById('ds-btn-split-steps') as HTMLButtonElement | null;
    if (!skill) {
      ['ds-info-exists', 'ds-info-episodes', 'ds-info-fps', 'ds-info-size'].forEach(id => setVal(id, '—'));
      setOpsEnabled(false);
      if (exportBtn) exportBtn.disabled = true;
      if (splitBtn) splitBtn.disabled = true;
      return;
    }
    const info = await this.api('GET', `/skills/${skill}/dataset_info`);
    setVal('ds-info-exists', info?.exists ? 'Na disku ✓' : 'Nenalezen');
    setVal('ds-info-episodes', info?.exists ? String(info.num_episodes) : '—');
    setVal('ds-info-fps', info?.exists ? String(info.fps) : '—');
    setVal('ds-info-size', info?.exists ? `${info.size_mb} MB` : '—');
    setOpsEnabled(!!info?.exists);
    // "Export model" is only meaningful once a policy has been trained for this skill
    if (exportBtn) {
      const status = await this.api('GET', `/skills/${skill}/policy_status`);
      exportBtn.disabled = !status?.exists;
      exportBtn.title = status?.exists ? '' : this.t('tip.noModelYet');
    }
    // "Split by steps" needs: dataset on disk + >=2 ordered sub-skills + step marks
    if (splitBtn) {
      let enabled = false;
      let tip = '';
      if (info?.exists) {
        const marks = await this.api('GET', `/skills/${skill}/step_marks`);
        const nSteps = (marks?.steps || []).length;
        const nMarked = Object.keys(marks?.episodes || {}).length;
        if (nSteps < 2) tip = this.t('tip.splitNeedsSubskills');
        else if (nMarked === 0) tip = this.t('tip.splitNeedsMarks');
        else { enabled = true; tip = this.t('tip.splitSteps'); }
      } else {
        tip = this.t('tip.splitNeedsDataset');
      }
      splitBtn.disabled = !enabled;
      splitBtn.title = tip;
    }
  },

  async splitDatasetSteps(): Promise<void> {
    const skill = this.dsSelectedSkill();
    if (!skill) { alert(this.t('msg.selectDatasetFirst')); return; }
    this.log('INFO', this.t('log.splitStart', {s: skill}));
    const res = await this.api('POST', '/datasets/split_steps', { skill_slug: skill });
    if (res && res.ok === false) {
      this.log('ERROR', this.t('log.splitFail', {e: res.error || '?'}));
      alert(res.error || 'Split failed');
    }
  },

  async dsRunOp(operation: string, params: any = {}, newRepoId: string = ''): Promise<void> {
    const repo = this.dsSelectedRepo();
    if (!repo && operation !== 'merge') { alert('Nejprve vyberte dataset.'); return; }
    this.toggleTerminalOpen();
    const res = await this.api('POST', '/datasets/edit', {
      operation, repo_id: operation === 'merge' ? '' : repo, new_repo_id: newRepoId, params
    });
    if (res && res.ok === false) {
      this.log('ERROR', `Operace '${operation}' selhala: ${res.error}`);
    } else {
      this.log('INFO', `Operace '${operation}' spuštěna — průběh v terminálu.`);
    }
  },

  dsDeleteEpisodes(): void {
    const raw = (document.getElementById('ds-del-indices') as HTMLInputElement | null)?.value.trim() || '';
    const indices = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 0);
    if (indices.length === 0) { alert(this.t('alert.enterEpIndices')); return; }
    if (!confirm(`Opravdu smazat epizody [${indices.join(', ')}] z datasetu '${this.dsSelectedRepo()}'? LeRobot vytvoří zálohu.`)) return;
    this.dsRunOp('delete_episodes', { episode_indices: indices });
  },

  dsModifyTask(): void {
    const task = (document.getElementById('ds-newtask') as HTMLInputElement | null)?.value.trim() || '';
    if (!task) { alert(this.t('alert.enterTask')); return; }
    this.dsRunOp('modify_tasks', { new_task: task });
  },

  dsSplit(): void {
    const train = parseFloat((document.getElementById('ds-split-train') as HTMLInputElement | null)?.value || '0.8');
    if (isNaN(train) || train <= 0 || train >= 1) { alert(this.t('alert.trainSplitRange')); return; }
    const val = Math.round((1 - train) * 100) / 100;
    this.dsRunOp('split', { splits: { train: train, val: val } });
  },

  dsMerge(): void {
    const source = this.dsSelectedRepo();
    const other = (document.getElementById('ds-merge-source') as HTMLSelectElement | null)?.value || '';
    const target = (document.getElementById('ds-merge-target') as HTMLInputElement | null)?.value.trim() || '';
    if (!source || !other) { alert(this.t('alert.selectBothDs')); return; }
    if (source === other) { alert(this.t('alert.selectTwoDiff')); return; }
    if (!target) { alert(this.t('alert.enterMergeRepo')); return; }
    this.dsRunOp('merge', { repo_ids: [source, other] }, target);
  },

  async dsPush(): Promise<void> {
    const repo = this.dsSelectedRepo();
    const hubId = (document.getElementById('ds-hub-id') as HTMLInputElement | null)?.value.trim() || '';
    const priv = (document.getElementById('ds-hub-private') as HTMLInputElement | null)?.checked ?? true;
    if (!repo) { alert('Nejprve vyberte dataset.'); return; }
    if (!hubId.includes('/')) { alert(this.t('alert.hubIdFormat')); return; }
    this.toggleTerminalOpen();
    const res = await this.api('POST', '/datasets/push', { repo_id: repo, hub_id: hubId, private: priv });
    if (res && res.ok === false) this.log('ERROR', `Push selhal: ${res.error}`);
    else this.log('INFO', `Nahrávání datasetu na Hub spuštěno — průběh v terminálu.`);
  },

  dsVisualize(): void {
    const repo = this.dsSelectedRepo();
    if (!repo) { alert('Nejprve vyberte dataset.'); return; }
    const ep = parseInt((document.getElementById('ds-viz-episode') as HTMLInputElement | null)?.value || '0', 10) || 0;
    this.toggleTerminalOpen();
    this.api('POST', '/tools/run', { tool: 'dataset_viz', args: [`--repo-id`, repo, `--episode-index`, String(ep)] });
    this.log('INFO', `Spouštím Rerun vizualizaci datasetu ${repo}, epizoda ${ep}...`);
  },

  // ── Advanced Training & Evaluation page ─────────────────────────────
  advPopulateResumeSkills(): void {
    const sel = document.getElementById('adv-resume-skill') as HTMLSelectElement | null;
    if (!sel) return;
    const skills = this.project?.skills || [];
    const details = this.project?.skills_details || {};
    const prev = sel.value;
    sel.innerHTML = skills.length
      ? skills.map(s => `<option value="${this.esc(s)}">${this.esc(details[s]?.name || s)} (${this.esc(s)})</option>`).join('')
      : '<option value="">-- Žádné dovednosti v projektu --</option>';
    if (prev && skills.includes(prev)) sel.value = prev;
  },

  async advResumeTraining(): Promise<void> {
    const skill = (document.getElementById('adv-resume-skill') as HTMLSelectElement | null)?.value || '';
    if (!skill) { alert('Vyberte dovednost.'); return; }
    const policy = this.project?.policy_architecture || 'act';
    this.toggleTerminalOpen();
    this.log('INFO', `Pokračuji v tréninku dovednosti '${skill}' (poslední checkpoint, policy=${policy})...`);
    const res = await this.api('POST', '/training/start', { skills: [skill], policy_type: policy });
    if (res && res.ok === false) this.log('ERROR', `Resume selhal: ${res.error}`);
  },

  async advStartEval(): Promise<void> {
    const policyPath = (document.getElementById('adv-eval-policy') as HTMLInputElement | null)?.value.trim() || '';
    const envType = (document.getElementById('adv-eval-env') as HTMLSelectElement | null)?.value || 'pusht';
    const episodes = parseInt((document.getElementById('adv-eval-episodes') as HTMLInputElement | null)?.value || '10', 10) || 10;
    const device = (document.getElementById('adv-eval-device') as HTMLSelectElement | null)?.value || 'cuda';
    if (!policyPath) { alert('Zadejte cestu k policy checkpointu nebo Hub id.'); return; }
    this.toggleTerminalOpen();
    const res = await this.api('POST', '/eval/start', {
      policy_path: policyPath, env_type: envType, n_episodes: episodes, batch_size: Math.min(episodes, 10), device
    });
    if (res && res.ok === false) this.log('ERROR', `Evaluace selhala: ${res.error}`);
    else this.log('INFO', `Simulační evaluace v '${envType}' spuštěna — metriky v terminálu.`);
  },

  advInsertTemplate(kind: string): void {
    const templates: Record<string, string> = {
      peft: '--peft.type=lora --peft.r=16 --peft.lora_alpha=32',
      multigpu: 'accelerate launch --num_processes=2 -m lerobot.scripts.lerobot_train --dataset.repo_id=local/SKILL --policy.type=act --policy.push_to_hub=false',
      rl: 'python -m lerobot.scripts.lerobot_train --policy.type=sac --env.type=gym_hil --policy.push_to_hub=false',
      tokenizer: 'python -m lerobot.scripts.lerobot_train_tokenizer --dataset.repo_id=local/SKILL',
    };
    const tpl = templates[kind];
    if (!tpl) return;
    if (kind === 'peft') {
      // PEFT flags belong in the training extra-args field
      const extra = document.getElementById('train-extra-args') as HTMLInputElement | null;
      if (extra) {
        extra.value = (extra.value ? extra.value + ' ' : '') + tpl;
        this.log('INFO', 'PEFT/LoRA argumenty vloženy do pole „Vlastní CLI argumenty“ na kartě Imitační učení.');
        this.changeTab('uceni');
        this.switchUceniTab('train');
        return;
      }
    }
    this.toggleTerminalOpen();
    const input = document.getElementById('console-input') as HTMLInputElement | null;
    if (input) {
      input.value = tpl;
      input.focus();
      this.log('INFO', 'Šablona příkazu vložena do terminálu — upravte SKILL/parametry a potvrďte Enterem.');
    }
  },

  /**
   * Write one diagnostic row. `value` empty means the environment does not
   * provide it (no LeRobot, no ffmpeg…) — shown as the localized "not found"
   * in the muted style, never as a blank row the user cannot interpret.
   */
  setDiagValue(elementId: string, value: string, missingKey = 'val.notFound'): void {
    const el = document.getElementById(elementId);
    if (!el) return;
    const has = !!(value && value.trim());
    el.textContent = has ? value : this.t(missingKey);
    el.classList.toggle('is-missing', !has);
    // The placeholder carries data-i18n="val.loading"; once real data is in,
    // applyI18n() must not overwrite it on the next language switch.
    el.removeAttribute('data-i18n');
  },

  async loadSysInfo(): Promise<void> {
    const btn = document.querySelector('.btn-refresh-sysinfo') as HTMLButtonElement | null;
    const btnLabel = btn ? btn.querySelector('span') : null;
    const prevLabel = btnLabel ? btnLabel.textContent : '';
    // Probing the environment imports torch in a subprocess — seconds, not
    // milliseconds — so the button has to show that something is happening.
    if (btn) btn.disabled = true;
    if (btnLabel) btnLabel.textContent = this.t('btn.detecting');
    try {
      this.log('INFO', 'Loading system diagnostic information...');
      const sysinfo = await this.api('GET', '/settings/sysinfo');
      if (sysinfo) {
        // Pre-fill paths
        const pyPathInput = document.getElementById('settings-python-path') as HTMLInputElement | null;
        if (pyPathInput) pyPathInput.value = sysinfo.python_path || '';
        
        const lerobotDirInput = document.getElementById('settings-lerobot-dir-global') as HTMLInputElement | null;
        if (lerobotDirInput) lerobotDirInput.value = sysinfo.lerobot_dir || '';
        
        const storageDirInput = document.getElementById('settings-dataset-storage-dir') as HTMLInputElement | null;
        const recStorageDirInput = document.getElementById('rec-dataset-storage-dir') as HTMLInputElement | null;
        const val = this.project?.dataset_storage_dir || '';
        if (storageDirInput) storageDirInput.value = val;
        if (recStorageDirInput) recStorageDirInput.value = val;

        const sceneDescInput = document.getElementById('settings-scene-desc') as HTMLTextAreaElement | null;
        if (sceneDescInput) sceneDescInput.value = this.project?.scene_description || '';

        // Populate diagnostic labels
        this.setDiagValue('diag-platform', sysinfo.platform, 'val.unknownN');
        this.setDiagValue('diag-python-version', sysinfo.python_version, 'val.unknownF');
        this.setDiagValue('diag-lerobot-version', sysinfo.lerobot_version);
        this.setDiagValue('diag-torch-version', sysinfo.torch_version);
        this.setDiagValue('diag-compute-device', sysinfo.compute_device, 'val.unknownN');
        this.setDiagValue('diag-ffmpeg', sysinfo.ffmpeg_version);
        this.setDiagValue('diag-conda-env', sysinfo.conda_env, 'val.unknownN');
        this.setDiagValue('diag-miniconda-path', sysinfo.miniconda_path);
        this.setDiagValue('diag-disk-free', sysinfo.disk_free, 'val.unknownN');

        const storageRoot = document.getElementById('diag-storage-root');
        if (storageRoot) storageRoot.textContent = sysinfo.storage_root || '';

        this.lerobotAvailable = !!(sysinfo.lerobot_version && sysinfo.lerobot_version.trim());
        this.updateHardwareButtonStates();

        this.log('SUCCESS', 'System diagnostic information loaded');
      }
    } catch (err) {
      this.lerobotAvailable = false;
      this.updateHardwareButtonStates();
      this.log('ERROR', 'Failed to load system diagnostics info.');
    } finally {
      if (btn) btn.disabled = false;
      if (btnLabel) btnLabel.textContent = prevLabel || this.t('btn.refresh');
    }
  },

  async installLerobotFromSettings(): Promise<void> {
    if (!confirm(this.t('cal.confirmInstallLerobot'))) return;
    this.log('INFO', this.t('log.installingLerobot'));
    try {
      const res = await this.api('POST', '/setup/install-lerobot', {parent_dir: ''});
      (res.logs || []).forEach((line: string) => this.log('INFO', line));
      if (res.ok) {
        this.log('SUCCESS', this.t('log.lerobotInstalled'));
      } else {
        this.log('ERROR', `${this.t('log.lerobotInstallFailed')}: ${res.error || ''}`);
      }
    } catch (err) {
      this.log('ERROR', this.t('log.lerobotInstallFailed'));
    }
    await this.loadSysInfo();
  },

  async saveGlobalSettings(): Promise<void> {
    // Only fields that are actually on the page are sent. The backend
    // overwrites every key it receives, so posting a value read from a missing
    // element would silently erase the stored one (this wiped the project's
    // scene description once already).
    const payload: Record<string, string> = {};
    const put = (key: string, id: string) => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) payload[key] = el.value.trim();
    };
    put('python_path', 'settings-python-path');
    put('lerobot_dir', 'settings-lerobot-dir-global');
    put('dataset_storage_dir', 'settings-dataset-storage-dir');
    put('scene_description', 'settings-scene-desc');

    if (this.project && 'scene_description' in payload && !payload.scene_description) {
      this.log('WARN', this.t('log.sceneDescEmptyWarn'));
    }

    const saveBtn = document.querySelector('.btn-save-settings') as HTMLButtonElement | null;
    const prevLabel = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = this.t('btn.saving'); }

    this.log('INFO', 'Saving global and project settings...');
    let r: any = null;
    try {
      r = await this.api('POST', '/settings', payload);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = prevLabel || this.t('settings.save');
      }
    }

    if (r && r.ok) {
      this.log('SUCCESS', 'Settings saved successfully');
      this.loadSysInfo();
    } else {
      this.log('ERROR', 'Failed to save settings');
    }
  },

  // ── API Communicator ────────────────────────────────────────────────
  async api(method: string, path: string, body?: any): Promise<any> {
    const host = location.host || 'localhost:8000';
    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(`http://${host}/api${path}`, opts);
    return r.json();
  },

  // ── Projects Controller ─────────────────────────────────────────────
  async loadProjects(): Promise<void> {
    try {
      const data = await this.api('GET', '/projects');
      this.renderProjectList(data.projects || [], data.recent || []);
      
      const cur = await this.api('GET', '/project');
      if (cur.project) this.onProjectOpened(cur.project);
    } catch (_) {}
  },

  /** Human label + palette class for a robot type string, e.g. "so101_follower". */
  robotTypeLabel(type: string): { label: string; cls: string } {
    const t = (type || '').toLowerCase();
    if (!t) return { label: this.t('val.notConfigured'), cls: 'none' };
    if (t.includes('soarm') || t.includes('so-arm')) return { label: 'SO-ARM 101', cls: 'soarm101' };
    if (t.includes('so101') || t.includes('so-101')) return { label: 'SO-101', cls: 'soarm101' };
    if (t.includes('so100') || t.includes('so-100')) return { label: 'SO-100', cls: 'so100' };
    if (t.includes('koch')) return { label: 'Koch v1.1', cls: 'koch' };
    if (t.includes('aloha')) return { label: 'Aloha', cls: 'aloha' };
    if (t.includes('moss')) return { label: 'Moss v1', cls: 'moss' };
    if (t.includes('stretch')) return { label: 'Stretch', cls: 'stretch' };
    if (t.includes('lekiwi')) return { label: 'LeKiwi', cls: 'lekiwi' };
    if (t.includes('openarm')) return { label: 'OpenArm', cls: 'custom' };
    return { label: type, cls: 'custom' };
  },

  /**
   * Task structure of a project listing entry.
   *
   * A skill with no `parent_slug` is a top-level task; its children are the
   * ordered sub-steps marked during recording. Only a task with >= 2 ordered
   * sub-steps can be split into sub-datasets, i.e. only such a task can feed
   * the orchestration branch — everything else is ACT-baseline only. That is
   * the single most useful thing to know about a project before opening it,
   * so it drives both the list row and the detail panel.
   */
  projectTaskTree(p: any): { slug: string; name: string; steps: any[] }[] {
    const summary: any[] = p?.skills_summary || [];
    const roots = summary.filter(s => !s.parent_slug);
    return roots.map(r => ({
      slug: r.slug,
      name: r.name || r.slug,
      steps: summary.filter(s => s.parent_slug === r.slug),
    }));
  },

  renderProjectList(projects: any[], recent: any[]): void {
    const all = projects.length ? projects : recent.map(r => ({ name: r.name, _path: r.path, slug: r.slug, skills: [], robots: (r as any).robots || [] }));
    this.knownProjects = all;

    // Default the selection to the open project, else the first row, so the
    // detail panel is never blank when there is something to show.
    if (!all.some(p => p._path === this.selectedProjectPath)) {
      this.selectedProjectPath = (this.project && this.project.path) || (all[0]?._path ?? '');
    }

    const el = document.getElementById('project-list');
    if (el) {
      if (!all.length) {
        el.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></div>
            <div class="empty-state-text">${this.esc(this.t('hint.noProjects'))}</div>
          </div>`;
      } else {
        el.innerHTML = all.map(p => {
          const isOpen = !!(this.project && this.project.path === p._path);
          const isSel = p._path === this.selectedProjectPath;
          const robot = (p.robots && p.robots.length) ? p.robots[0] : null;
          const rt = this.robotTypeLabel(robot ? (robot.type || robot.follower_type || '') : '');
          const tasks = this.projectTaskTree(p);
          const steps = tasks.reduce((n, t) => n + t.steps.length, 0);
          return `
            <div class="project-row ${isSel ? 'selected' : ''} ${isOpen ? 'open' : ''}"
                 role="option" aria-selected="${isSel}" tabindex="0"
                 onclick="App.selectProject(this.dataset.path)"
                 ondblclick="App.openProject(this.dataset.path)"
                 onkeydown="if(event.key==='Enter'){App.openProject(this.dataset.path);}else if(event.key===' '){event.preventDefault();App.selectProject(this.dataset.path);}"
                 data-path="${this.esc(p._path || '')}">
              <div class="project-row-head">
                <span class="project-row-name">${this.esc(p.name)}</span>
                ${isOpen ? `<span class="project-row-flag">${this.esc(this.t('val.projectOpen'))}</span>` : ''}
              </div>
              <div class="project-row-meta">
                <span class="mono">${this.esc(p.slug || '—')}</span>
                <span class="robot-badge ${rt.cls}">${this.esc(rt.label)}</span>
                <span>${tasks.length} ${this.esc(this.t('val.tasksShort'))}</span>
                <span>${steps} ${this.esc(this.t('val.stepsShort'))}</span>
                ${p.created_at ? `<span>${this.esc(new Date(p.created_at).toLocaleDateString())}</span>` : ''}
              </div>
            </div>`;
        }).join('');
      }
    }

    const countEl = document.getElementById('project-list-count');
    if (countEl) countEl.textContent = `${all.length} ${this.t('val.projectsShort')}`;

    // Where the listed projects live on disk. Derived from the paths already
    // in the listing (no extra endpoint), and answers a question the UI could
    // not answer at all before: "kam se to vlastně ukládá?".
    const rootEl = document.getElementById('project-list-root');
    if (rootEl) {
      const dirs = new Set(all.map(p => String(p._path || '').replace(/[\\/][^\\/]*$/, '')).filter(Boolean));
      rootEl.textContent = dirs.size === 1 ? [...dirs][0] : (dirs.size ? this.t('val.mixedLocations') : '—');
    }

    this.renderProjectDetail();

    // Sidebar small project shortcuts
    const sideEl = document.getElementById('sidebar-projects-list-container');
    if (sideEl) {
      if (!all.length) {
         sideEl.innerHTML = `<div style="font-size: 10px; color: var(--text-muted);">${App.t('hint.noProjects')}</div>`;
      } else {
        sideEl.innerHTML = all.map(p => {
          const isActive = this.project && this.project.path === p._path;
          return `
            <div class="sidebar-project-item ${isActive ? 'active' : ''}" onclick="App.openProject(this.dataset.path)" data-path="${this.esc(p._path || '')}">
              <div class="name">${this.esc(p.name)}</div>
              <div class="meta">${p.slug || ''}</div>
            </div>
          `;
        }).join('');
      }
    }
  },

  selectProject(path: string): void {
    if (!path) return;
    this.selectedProjectPath = path;
    document.querySelectorAll<HTMLElement>('#project-list .project-row').forEach(row => {
      const on = row.dataset.path === path;
      row.classList.toggle('selected', on);
      row.setAttribute('aria-selected', String(on));
    });
    this.renderProjectDetail();
  },

  /** Small key/value row of the detail panel. */
  _detailRow(label: string, value: string, mono = false): string {
    return `<div class="pd-row"><span class="pd-key">${this.esc(label)}</span>` +
           `<span class="pd-val${mono ? ' mono' : ''}">${this.esc(value || '—')}</span></div>`;
  },

  /**
   * Everything about the selected project that is knowable from its
   * project.json and skills/ directory — i.e. without opening it.
   */
  renderProjectDetail(): void {
    const host = document.getElementById('project-detail');
    const stateEl = document.getElementById('project-detail-state');
    const hintEl = document.getElementById('project-detail-hint');
    const btnOpen = document.getElementById('btn-project-open') as HTMLButtonElement | null;
    const btnExport = document.getElementById('btn-project-export') as HTMLButtonElement | null;
    const btnDelete = document.getElementById('btn-project-delete') as HTMLButtonElement | null;
    if (!host) return;

    const p = this.knownProjects.find(x => x._path === this.selectedProjectPath);
    if (!p) {
      host.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18"></rect><path d="M3 9h18M9 21V9"></path></svg></div>
          <div class="empty-state-text">${this.esc(this.t('hint.projectDetailEmpty'))}</div>
        </div>`;
      if (stateEl) stateEl.textContent = '';
      if (hintEl) hintEl.textContent = this.t('hint.projectDetail');
      [btnOpen, btnExport, btnDelete].forEach(b => { if (b) b.disabled = true; });
      return;
    }

    const isOpen = !!(this.project && this.project.path === p._path);
    if (btnOpen) { btnOpen.disabled = isOpen; }
    if (btnExport) { btnExport.disabled = !isOpen; }
    if (btnDelete) { btnDelete.disabled = false; }
    if (stateEl) stateEl.textContent = isOpen ? this.t('val.projectOpen') : this.t('val.projectClosed');
    if (hintEl) {
      // Export runs over the *open* project server-side, so say so instead of
      // letting a disabled button look broken.
      hintEl.textContent = isOpen ? this.t('hint.projectDetailOpen') : this.t('hint.projectDetailClosed');
    }

    const robots: any[] = p.robots || [];
    const cameras: any[] = p.cameras || [];
    const tasks = this.projectTaskTree(p);
    const splittable = tasks.filter(t => t.steps.length >= 2);
    const created = p.created_at ? new Date(p.created_at).toLocaleString() : '';

    const stat = (v: string | number, label: string, warn = false) =>
      `<div class="pd-stat${warn ? ' warn' : ''}"><span class="pd-stat-num">${this.esc(String(v))}</span>` +
      `<span class="pd-stat-label">${this.esc(label)}</span></div>`;

    const robotsHtml = robots.length
      ? robots.map(r => {
          const rt = this.robotTypeLabel(r.type || r.follower_type || '');
          return `<tr><td><span class="robot-badge ${rt.cls}">${this.esc(rt.label)}</span></td>` +
                 `<td class="mono">${this.esc(r.id || '—')}</td>` +
                 `<td class="mono">${this.esc(r.port || r.device_id || '—')}</td></tr>`;
        }).join('')
      : `<tr><td colspan="3" class="pd-none">${this.esc(this.t('val.noRobots'))}</td></tr>`;

    const camerasHtml = cameras.length
      ? cameras.map(c => `<tr><td class="mono">${this.esc(c.id || '—')}</td>` +
          `<td>${this.esc(c.role || '—')}</td>` +
          `<td class="mono">${Array.isArray(c.resolution) ? c.resolution.join('×') : '—'} @ ${this.esc(String(c.fps ?? '—'))}</td></tr>`).join('')
      : `<tr><td colspan="3" class="pd-none">${this.esc(this.t('val.noCameras'))}</td></tr>`;

    const tasksHtml = tasks.length
      ? tasks.map(t => {
          const ok = t.steps.length >= 2;
          return `
            <div class="pd-task">
              <div class="pd-task-head">
                <span class="pd-task-name">${this.esc(t.name)}</span>
                <span class="pd-task-mode ${ok ? 'ok' : 'baseline'}">${this.esc(this.t(ok ? 'val.modeBoth' : 'val.modeBaseline'))}</span>
              </div>
              <div class="pd-task-steps">${
                t.steps.length
                  ? t.steps.map((s, i) => `<span class="pd-step"><span class="pd-step-num">${i + 1}</span>${this.esc(s.name || s.slug)}</span>`).join('')
                  : `<span class="pd-none">${this.esc(this.t('val.noSubSteps'))}</span>`
              }</div>
            </div>`;
        }).join('')
      : `<div class="pd-none">${this.esc(this.t('val.noTasks'))}</div>`;

    host.innerHTML = `
      <div class="pd-ident">
        <div class="pd-title">${this.esc(p.name)}</div>
        <div class="pd-sub mono">${this.esc(p._path || '')}</div>
      </div>

      <div class="pd-stats">
        ${stat(robots.length, this.t('val.robots'), robots.length === 0)}
        ${stat(cameras.length, this.t('val.cameras'))}
        ${stat(tasks.length, this.t('val.tasks'))}
        ${stat(splittable.length, this.t('val.splittable'))}
      </div>

      <div class="pd-cols">
        <div class="pd-col">
          <section class="pd-sect">
            <h4 class="pd-h">${this.esc(this.t('blk.pd.identity'))}</h4>
            ${this._detailRow(this.t('lbl.slug'), p.slug || '', true)}
            ${this._detailRow(this.t('lbl.created'), created)}
            ${this._detailRow(this.t('lbl.policyArch'), p.policy_architecture || '')}
          </section>

          <section class="pd-sect">
            <h4 class="pd-h">${this.esc(this.t('blk.pd.scene'))}</h4>
            ${p.scene_description
              ? `<p class="pd-scene">${this.esc(p.scene_description)}</p>`
              : `<p class="pd-scene warn">${this.esc(this.t('warn.noSceneDesc'))}</p>`}
          </section>
        </div>

        <section class="pd-sect">
          <h4 class="pd-h">${this.esc(this.t('blk.pd.hardware'))}</h4>
          <table class="pd-table">
            <thead><tr><th>${this.esc(this.t('lbl.device'))}</th><th>${this.esc(this.t('lbl.id'))}</th><th>${this.esc(this.t('lbl.port'))}</th></tr></thead>
            <tbody>${robotsHtml}</tbody>
          </table>
          <table class="pd-table">
            <thead><tr><th>${this.esc(this.t('lbl.camera'))}</th><th>${this.esc(this.t('lbl.role'))}</th><th>${this.esc(this.t('lbl.resFps'))}</th></tr></thead>
            <tbody>${camerasHtml}</tbody>
          </table>
        </section>
      </div>

      <section class="pd-sect">
        <h4 class="pd-h">${this.esc(this.t('blk.pd.tasks'))}</h4>
        <p class="pd-note">${this.esc(this.t('hint.splitRule'))}</p>
        ${tasksHtml}
      </section>`;
  },

  openSelectedProject(): void {
    if (this.selectedProjectPath) this.openProject(this.selectedProjectPath);
  },

  deleteSelectedProject(): void {
    if (!this.selectedProjectPath) return;
    const p = this.knownProjects.find(x => x._path === this.selectedProjectPath);
    if (!confirm(`${this.t('confirm.deleteProject')}\n\n${p ? p.name : ''}\n${this.selectedProjectPath}`)) return;
    this.deleteProjectAt(this.selectedProjectPath);
  },

  showNewProjectModal(): void {
    this.showNewProjectModeSelection();
    this.openModal('modal-new-project');
  },

  showNewProjectModeSelection(): void {
    const title = document.getElementById('new-project-modal-title');
    const selection = document.getElementById('new-project-mode-selection');
    const detailsForm = document.getElementById('new-project-details-form');
    const footer = document.getElementById('new-project-modal-footer');
    
    if (title) title.textContent = this.t('modal.newProjectTitle');
    if (selection) selection.style.display = 'block';
    if (detailsForm) detailsForm.style.display = 'none';
    if (footer) footer.style.display = 'none';
  },

  selectNewProjectModeDirect(mode: 'quick' | 'plain'): void {
    this.newProjectSetupMode = mode;
    if (mode === 'quick') {
      this.closeModal('modal-new-project');
      this.showSetupWizard('quick');
    } else {
      const title = document.getElementById('new-project-modal-title');
      const selection = document.getElementById('new-project-mode-selection');
      const detailsForm = document.getElementById('new-project-details-form');
      const footer = document.getElementById('new-project-modal-footer');
      
      if (title) title.textContent = this.t('modal.plainProjectTitle');
      if (selection) selection.style.display = 'none';
      if (detailsForm) detailsForm.style.display = 'flex';
      if (footer) footer.style.display = 'flex';
      
      const nameInput = document.getElementById('new-project-name') as HTMLInputElement;
      if (nameInput) {
        nameInput.value = '';
        nameInput.focus();
      }
      const slugInput = document.getElementById('new-project-slug') as HTMLInputElement;
      if (slugInput) slugInput.value = '';
      const sceneDescInput = document.getElementById('new-project-scene-desc') as HTMLTextAreaElement | null;
      if (sceneDescInput) sceneDescInput.value = '';
    }
  },

  async createProject(): Promise<void> {
    const name = (document.getElementById('new-project-name') as HTMLInputElement).value.trim();
    const slug = (document.getElementById('new-project-slug') as HTMLInputElement).value.trim();
    const parentDir = (document.getElementById('new-project-parent-dir') as HTMLInputElement | null)?.value.trim() || '';
    const sceneDescription = (document.getElementById('new-project-scene-desc') as HTMLTextAreaElement | null)?.value.trim() || '';
    if (!name || !slug) return;
    if (!sceneDescription) {
      alert(this.t('alert.sceneDescRequired'));
      return;
    }
    const r = await this.api('POST', '/projects', { name, slug, parent_dir: parentDir, scene_description: sceneDescription });
    if (r.ok) {
      this.closeModal('modal-new-project');
      this.loadProjects();
    } else {
      this.log('ERROR', r.error || 'Failed to create project');
      alert('Chyba při vytváření projektu: ' + (r.error || 'neznámá chyba'));
    }
  },

  async openProject(path: string): Promise<void> {
    if (!path || this.projectOpenInFlight) return;
    if (this.project && this.project.path === path) return; // already the active project — nothing to do
    this.selectedProjectPath = path;
    this.projectOpenInFlight = true;
    // Opening runs hardware auto-detection and deploys the project's
    // calibration files into LeRobot's cache server-side, so it is not
    // instant — mark the row and the button as busy for the whole round trip.
    const rows = document.querySelectorAll<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);
    rows.forEach(c => c.classList.add('opening'));
    const btn = document.getElementById('btn-project-open') as HTMLButtonElement | null;
    const btnText = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = this.t('btn.opening'); }
    try {
      const r = await this.api('POST', '/projects/open', { path });
      if (r && r.ok === false) {
        alert(this.t('alert.openProjectFailed') + ' ' + (r.error || ''));
      }
    } finally {
      this.projectOpenInFlight = false;
      rows.forEach(c => c.classList.remove('opening'));
      if (btn) { btn.textContent = btnText; }
      // Do not rely on the project_opened socket event for the refresh: the
      // page must settle into the right state even when /ws is unavailable.
      await this.loadProjects();
    }
  },

  /** Delete a project directory. Caller is responsible for confirming. */
  async deleteProjectAt(path: string): Promise<void> {
    const r = await this.api('POST', '/projects/delete', { path });
    if (r.ok) {
      if (this.project && this.project.path === path) {
        this.onProjectClosed();
      }
      if (this.selectedProjectPath === path) this.selectedProjectPath = '';
      this.loadProjects();
    } else {
      alert(this.t('alert.deleteProjectFailed') + ' ' + (r.error || ''));
    }
  },

  onProjectOpened(data: any): void {
    this.isProjectLoading = true;
    this.project = data.project || data;
    this.activeCameras = data.active_cameras || [];
    
    // Update global workspace badge in Title bar
    const titleBarActive = document.getElementById('title-active-project');
    if (titleBarActive && this.project) {
      titleBarActive.textContent = this.project.name;
      // The element carries data-i18n="title.noProject" for the empty state.
      // Left in place, the next applyI18n() (i.e. any language switch)
      // overwrote the open project's name with "No project selected".
      titleBarActive.removeAttribute('data-i18n');
    }

    // Update sidebar project badge details
    const sideProjName = document.getElementById('sidebar-proj-name');
    if (sideProjName && this.project) {
      sideProjName.textContent = this.project.name;
    }

    // Update unified global project badges across all tabs!
    document.querySelectorAll('.project-badge-global').forEach(badge => {
      badge.textContent = this.project?.name || 'Unnamed Project';
    });
    
    // Select first skill by default
    const skills = this.project?.skills || [];
    this.activeSkill = skills[0] || 'pick_cube';

    // Re-render project cards to reflect the new active state (without refetching from server)
    this.updateProjectCardsActiveState();

    this.renderRobots();
    this.renderCameras();
    this.renderSkillsFull();
    // A different project means different targets and different files on disk,
    // so the cached readiness answers no longer apply — re-read them.
    this.loadTrainingTargets();
    this.loadModelConfig();
    this.scanHardware().then(() => {
      this.prefillWorkflowData();
      this.isProjectLoading = false;
      this.startAllProjectCameras();
      // Live check — never assume lerobot is installed just because a
      // previous session or a different machine had it.
      this.loadSysInfo();
    }).catch(() => {
      this.isProjectLoading = false;
    });
  },

  onProjectClosed(): void {
    this.project = null;
    this.activeCameras = [];
    
    // Reset global workspace badge in Title bar
    const titleBarActive = document.getElementById('title-active-project');
    if (titleBarActive) {
      titleBarActive.textContent = this.t('title.noProject');
      titleBarActive.setAttribute('data-i18n', 'title.noProject');
    }

    // Reset unified global project badges across all tabs!
    document.querySelectorAll('.project-badge-global').forEach(badge => {
      badge.textContent = 'No project loaded';
    });
    
    this.changeTab('projects');
    this.loadProjects();
  },

  /** Mark which row is the open project, without refetching from the server. */
  updateProjectCardsActiveState(): void {
    const activePath = this.project?.path || '';

    document.querySelectorAll<HTMLElement>('#project-list .project-row').forEach(row => {
      const isOpen = !!(activePath && (row.dataset.path || '') === activePath);
      row.classList.toggle('open', isOpen);
      const flag = row.querySelector('.project-row-flag');
      if (isOpen && !flag) {
        const span = document.createElement('span');
        span.className = 'project-row-flag';
        span.textContent = this.t('val.projectOpen');
        row.querySelector('.project-row-head')?.appendChild(span);
      } else if (!isOpen && flag) {
        flag.remove();
      }
    });

    // Update sidebar project shortcuts
    document.querySelectorAll('#sidebar-projects-list-container .sidebar-project-item').forEach(item => {
      const itemPath = (item as HTMLElement).dataset.path || '';
      item.classList.toggle('active', !!(activePath && itemPath === activePath));
    });

    // The detail panel's Open/Export buttons are keyed off the open project.
    this.renderProjectDetail();
  },

  async refreshProject(): Promise<void> {
    try {
      const r = await this.api('GET', '/project');
      if (r.project) {
        this.project = r.project;
        this.activeCameras = r.active_cameras || [];
        this.renderRobots();
        this.renderCameras();
        this.renderSkillsFull();
        this.renderTrainingSkillsTree();
        
        const skills = this.project?.skills || [];
        if (this.activeSkill && skills.includes(this.activeSkill)) {
          this.selectSkill(this.activeSkill);
        } else if (skills.length > 0) {
          this.selectSkill(skills[0]);
        } else {
          const emptyState = document.getElementById('rec-empty-state');
          const activePanel = document.getElementById('rec-active-panel');
          if (emptyState) emptyState.style.display = 'flex';
          if (activePanel) activePanel.style.display = 'none';
          this.activeSkill = null;
          this.renderStepPlan();
          const listContainer = document.getElementById('rec-episodes-list-container');
          if (listContainer) {
            listContainer.innerHTML = `<div class="rec-episodes-empty">${this.esc(this.t('hint.noRecordableSkill'))}</div>`;
          }
        }

        await this.scanHardware();
        this.prefillWorkflowData();
        const dock = document.getElementById('docked-cameras-area');
        if (dock && dock.style.width !== '0px') {
          this.startAllProjectCameras();
        }
      }
    } catch (_) {}
  },

  // ── Hardware Scan & Dynamic Pair ────────────────────────────────────
  async scanHardware(): Promise<void> {
    try {
      const res = await this.api('GET', '/hardware/scan');
      this.availablePorts = res.ports || [];
      this.availableCameras = res.cameras || [];
      
      this.populatePortDropdowns();
      this.populateCameraDropdowns();
      // The Connect tab shows the scan itself, not only the two dropdowns
      // distilled out of it, so it repaints from the same result.
      this.renderDetectedHardware();
      this.updateConnectCmdPreview();
    } catch (err) {
      this.log('WARN', 'Failed to scan USB/serial or video hardware devices.');
    }
  },

  populatePortDropdowns(): void {
    const dropdownIds = ['robot-port', 'tele-leader-port', 'tele-follower-port'];
    dropdownIds.forEach(id => {
      const select = document.getElementById(id) as HTMLSelectElement | null;
      if (!select) return;

      const currentVal = select.value || select.getAttribute('data-last-val');
      
      let html = `<option value="">${this.esc(this.t('opt.pickPort'))}</option>`;
      this.availablePorts.forEach(p => {
        html += `<option value="${p.device}" data-persistent-id="${p.persistent_id}">${this.esc(p.friendly_name)}</option>`;
      });
      html += `<option value="__custom__">${this.esc(this.t('opt.manualPath'))}</option>`;
      
      select.innerHTML = html;

      // Restore value. If it's custom and not in scanned ports list, add it dynamically!
      if (currentVal) {
        let opt = select.querySelector(`option[value="${currentVal}"]`);
        if (!opt && currentVal !== '__custom__') {
          const newOpt = document.createElement('option');
          newOpt.value = currentVal;
          newOpt.textContent = currentVal;
          select.insertBefore(newOpt, select.lastElementChild);
        }
        select.value = currentVal;
        select.setAttribute('data-last-val', currentVal);
      }
    });
    this.updateHardwareButtonStates();
  },

  populateCameraDropdowns(): void {
    const select = document.getElementById('camera-source') as HTMLSelectElement | null;
    if (select) {
      const currentVal = select.value || select.getAttribute('data-last-val');
      let html = `<option value="">${this.esc(this.t('opt.pickCamera'))}</option>`;
      this.availableCameras.forEach(c => {
        html += `<option value="${c.index}" data-persistent-id="${c.persistent_id}">${this.esc(c.friendly_name)}</option>`;
      });
      html += `<option value="__custom__">${this.esc(this.t('opt.manualIndex'))}</option>`;
      select.innerHTML = html;
      if (currentVal) {
        let opt = select.querySelector(`option[value="${currentVal}"]`);
        if (!opt && currentVal !== '__custom__') {
          const newOpt = document.createElement('option');
          newOpt.value = currentVal;
          newOpt.textContent = currentVal;
          select.insertBefore(newOpt, select.lastElementChild);
        }
        select.value = currentVal;
        select.setAttribute('data-last-val', currentVal);
      }
    }

    const hwSelect = document.getElementById('hw-camera-port-select') as HTMLSelectElement | null;
    if (hwSelect) {
      const currentVal = hwSelect.value || hwSelect.getAttribute('data-last-val');
      let html = `<option value="">${this.esc(this.t('opt.pickCameraPort'))}</option>`;
      this.availableCameras.forEach(c => {
        html += `<option value="${c.index}" data-persistent-id="${c.persistent_id}">${this.esc(c.friendly_name)}</option>`;
      });
      html += `<option value="__custom__">${this.esc(this.t('opt.manualIndex'))}</option>`;
      hwSelect.innerHTML = html;
      if (currentVal) {
        let opt = hwSelect.querySelector(`option[value="${currentVal}"]`);
        if (!opt && currentVal !== '__custom__') {
          const newOpt = document.createElement('option');
          newOpt.value = currentVal;
          newOpt.textContent = currentVal;
          hwSelect.insertBefore(newOpt, hwSelect.lastElementChild);
        }
        hwSelect.value = currentVal;
        hwSelect.setAttribute('data-last-val', currentVal);
      }
    }
  },

  onRobotPortSelectChange(): void {
    const select = document.getElementById('robot-port') as HTMLSelectElement | null;
    if (select && select.value === '__custom__') {
      const val = prompt(this.t('prompt.robotPort'), select.getAttribute('data-last-val') || '/dev/ttyUSB0');
      if (val && val.trim()) {
        let opt = select.querySelector(`option[value="${val.trim()}"]`) as HTMLOptionElement | null;
        if (!opt) {
          opt = document.createElement('option') as HTMLOptionElement;
          opt.value = val.trim();
          opt.textContent = val.trim();
          select.insertBefore(opt, select.lastElementChild);
        }
        select.value = val.trim();
        select.setAttribute('data-last-val', val.trim());
      } else {
        select.value = select.getAttribute('data-last-val') || '';
      }
    } else if (select) {
      select.setAttribute('data-last-val', select.value);
    }
  },

  onCameraSourceSelectChange(): void {
    const select = document.getElementById('camera-source') as HTMLSelectElement | null;
    if (select && select.value === '__custom__') {
      const val = prompt(this.t('prompt.cameraIndex'), select.getAttribute('data-last-val') || '0');
      if (val && val.trim()) {
        let opt = select.querySelector(`option[value="${val.trim()}"]`) as HTMLOptionElement | null;
        if (!opt) {
          opt = document.createElement('option') as HTMLOptionElement;
          opt.value = val.trim();
          opt.textContent = val.trim();
          select.insertBefore(opt, select.lastElementChild);
        }
        select.value = val.trim();
        select.setAttribute('data-last-val', val.trim());
      } else {
        select.value = select.getAttribute('data-last-val') || '';
      }
    } else if (select) {
      select.setAttribute('data-last-val', select.value);
    }
  },

  onTelePortChange(role: string): void {
    const select = document.getElementById(`tele-${role}-port`) as HTMLSelectElement | null;
    if (select && select.value === '__custom__') {
      const val = prompt(this.t('prompt.armPort', { role: role.toUpperCase() }), select.getAttribute('data-last-val') || (role === 'leader' ? '/dev/ttyUSB1' : '/dev/ttyUSB0'));
      if (val && val.trim()) {
        let opt = select.querySelector(`option[value="${val.trim()}"]`) as HTMLOptionElement | null;
        if (!opt) {
          opt = document.createElement('option') as HTMLOptionElement;
          opt.value = val.trim();
          opt.textContent = val.trim();
          select.insertBefore(opt, select.lastElementChild);
        }
        select.value = val.trim();
        select.setAttribute('data-last-val', val.trim());
      } else {
        select.value = select.getAttribute('data-last-val') || '';
      }
    } else if (select) {
      select.setAttribute('data-last-val', select.value);
    }
    
    // Auto-save port changes immediately
    this.saveSettingsState();
    this.updateConnectCmdPreview();
    this.renderDetectedHardware();
    this.updateHardwareButtonStates();
  },

  updateHardwareButtonStates(): void {
    const leaderPort = (document.getElementById('tele-leader-port') as HTMLSelectElement | null)?.value || '';
    const followerPort = (document.getElementById('tele-follower-port') as HTMLSelectElement | null)?.value || '';
    const leaderType = (document.getElementById('tele-leader-type') as HTMLInputElement | null)?.value || '';
    const followerType = (document.getElementById('tele-follower-type') as HTMLInputElement | null)?.value || '';

    // Sync active hardware info labels to teleoperation page
    const infoRobotEl = document.getElementById('tele-info-robot-type');
    const infoLeaderPortEl = document.getElementById('tele-info-leader-port');
    const infoLeaderTypeEl = document.getElementById('tele-info-leader-type');
    const infoFollowerPortEl = document.getElementById('tele-info-follower-port');
    
    if (infoRobotEl) infoRobotEl.textContent = followerType ? followerType.replace('_follower', '').toUpperCase() : '-';
    if (infoLeaderPortEl) infoLeaderPortEl.textContent = leaderPort || '-';
    if (infoLeaderTypeEl) infoLeaderTypeEl.textContent = leaderType ? leaderType.replace('_leader', '').toUpperCase() : '-';
    if (infoFollowerPortEl) infoFollowerPortEl.textContent = followerPort || '-';

    // The Kalibrace cards read the very same port/id fields, so they refresh
    // from the same trigger instead of going stale until the tab is reopened.
    this.renderCalibrationArmCards(this.armVisualConfig);

    const btnCalLeader = document.getElementById('btn-calibrate-leader');
    const btnCalFollower = document.getElementById('btn-calibrate-follower');
    const btnStartTele = document.getElementById('btn-start-teleop');
    const noLerobotTip = this.t('tip.lerobotMissing');

    if (btnCalLeader) {
      if (leaderPort && this.lerobotAvailable) {
        btnCalLeader.className = 'btn btn-xs btn-success';
        (btnCalLeader as HTMLButtonElement).disabled = false;
        btnCalLeader.title = '';
      } else {
        btnCalLeader.className = 'btn btn-xs btn-secondary';
        (btnCalLeader as HTMLButtonElement).disabled = true;
        btnCalLeader.title = !this.lerobotAvailable ? noLerobotTip : '';
      }
    }

    if (btnCalFollower) {
      if (followerPort && this.lerobotAvailable) {
        btnCalFollower.className = 'btn btn-xs btn-success';
        (btnCalFollower as HTMLButtonElement).disabled = false;
        btnCalFollower.title = '';
      } else {
        btnCalFollower.className = 'btn btn-xs btn-secondary';
        (btnCalFollower as HTMLButtonElement).disabled = true;
        btnCalFollower.title = !this.lerobotAvailable ? noLerobotTip : '';
      }
    }

    if (btnStartTele) {
      const activeRobot = (this.project?.robots || [])[0];
      const isCalibrated = !!activeRobot?.leader_calibration && !!activeRobot?.follower_calibration;
      const canStart = !!leaderPort && !!followerPort && isCalibrated && this.lerobotAvailable;

      if (canStart) {
        btnStartTele.className = 'btn btn-xs btn-primary';
        (btnStartTele as HTMLButtonElement).disabled = false;
        btnStartTele.title = this.t('tip.startsTeleop');
      } else {
        btnStartTele.className = 'btn btn-xs btn-secondary';
        (btnStartTele as HTMLButtonElement).disabled = true;
        btnStartTele.title = !this.lerobotAvailable
          ? noLerobotTip
          : !leaderPort || !followerPort
          ? 'Nejprve vyberte leader i follower port (Setup → Connect)'
          : 'Nejprve zkalibruj obě ramena (Setup → Kalibrace)';
      }
    }

    // Re-apply running-process gating on top of the port-based logic
    this.updateActionButtonStates();
  },

  // ── Hardware Page Auto-detection & Cameras ───────────────────────
  async hwStartDetectArm(role: 'leader' | 'follower'): Promise<void> {
    try {
      this.log('INFO', `Spouštím skenování portů pro detekci ${role} ramene...`);
      const res = await this.api('POST', '/setup/detect-arms/start');
      if (res.ok) {
        const step1El = document.getElementById(`hw-${role}-step-1`);
        const step2El = document.getElementById(`hw-${role}-step-2`);
        const step3El = document.getElementById(`hw-${role}-step-3`);
        if (step1El) step1El.style.display = 'none';
        if (step2El) step2El.style.display = 'block';
        if (step3El) step3El.style.display = 'none';
      }
    } catch (err) {
      alert(`Chyba při zahájení detekce: ${err}`);
    }
  },

  async hwConfirmUnplugArm(role: 'leader' | 'follower'): Promise<void> {
    try {
      this.log('INFO', `Ověřuji odpojené zařízení pro ${role} rameno...`);
      const res = await this.api('POST', '/setup/detect-arms/unplugged');
      if (res.ok && res.device) {
        const step1El = document.getElementById(`hw-${role}-step-1`);
        const step2El = document.getElementById(`hw-${role}-step-2`);
        const step3El = document.getElementById(`hw-${role}-step-3`);
        if (step1El) step1El.style.display = 'none';
        if (step2El) step2El.style.display = 'none';
        if (step3El) step3El.style.display = 'block';

        const textEl = document.getElementById(`hw-${role}-detected-text`);
        if (textEl) {
          textEl.textContent = `Detekováno: ${res.device} (${res.persistent_id})`;
        }

        // Save persistent ID and update select values
        if (role === 'leader') {
          const leaderIdInput = document.getElementById('tele-leader-id') as HTMLInputElement;
          if (leaderIdInput) leaderIdInput.value = res.persistent_id;
          
          const selectEl = document.getElementById('tele-leader-port') as HTMLSelectElement;
          if (selectEl) {
            let opt = selectEl.querySelector(`option[value="${res.device}"]`) as HTMLOptionElement;
            if (!opt) {
              opt = document.createElement('option');
              opt.value = res.device;
              opt.textContent = `${res.device} (${res.persistent_id})`;
              selectEl.appendChild(opt);
            }
            selectEl.value = res.device;
            this.onTelePortChange('leader');
          }
        } else {
          const followerIdInput = document.getElementById('tele-follower-id') as HTMLInputElement;
          if (followerIdInput) followerIdInput.value = res.persistent_id;

          const selectEl = document.getElementById('tele-follower-port') as HTMLSelectElement;
          if (selectEl) {
            let opt = selectEl.querySelector(`option[value="${res.device}"]`) as HTMLOptionElement;
            if (!opt) {
              opt = document.createElement('option');
              opt.value = res.device;
              opt.textContent = `${res.device} (${res.persistent_id})`;
              selectEl.appendChild(opt);
            }
            selectEl.value = res.device;
            this.onTelePortChange('follower');
          }
        }
      } else {
        alert(res.error || this.t('alert.detectFailed'));
      }
    } catch (err) {
      alert(`Chyba při detekci odpojení: ${err}`);
    }
  },

  hwResetDetectArm(role: 'leader' | 'follower'): void {
    const step1El = document.getElementById(`hw-${role}-step-1`);
    const step2El = document.getElementById(`hw-${role}-step-2`);
    const step3El = document.getElementById(`hw-${role}-step-3`);
    if (step1El) step1El.style.display = 'block';
    if (step2El) step2El.style.display = 'none';
    if (step3El) step3El.style.display = 'none';
  },

  hwOnCameraPortChange(): void {
    const portSelect = document.getElementById('hw-camera-port-select') as HTMLSelectElement;
    const previewImg = document.getElementById('hw-camera-preview-img') as HTMLImageElement;
    const placeholder = document.getElementById('hw-camera-preview-placeholder');
    
    if (!portSelect || !previewImg || !placeholder) return;

    if (portSelect.value === '__custom__') {
      const val = prompt(this.t('prompt.cameraIndex'), portSelect.getAttribute('data-last-val') || '0');
      if (val && val.trim()) {
        let opt = portSelect.querySelector(`option[value="${val.trim()}"]`) as HTMLOptionElement | null;
        if (!opt) {
          opt = document.createElement('option') as HTMLOptionElement;
          opt.value = val.trim();
          opt.textContent = val.trim();
          portSelect.insertBefore(opt, portSelect.lastElementChild);
        }
        portSelect.value = val.trim();
        portSelect.setAttribute('data-last-val', val.trim());
      } else {
        portSelect.value = portSelect.getAttribute('data-last-val') || '';
      }
    } else {
      portSelect.setAttribute('data-last-val', portSelect.value);
    }
    
    const sourceVal = portSelect.value;
    if (!sourceVal) {
      this.hwStopCameraPreview();
      return;
    }
    
    previewImg.src = `/api/setup/camera-preview/feed?source=${sourceVal}`;
    previewImg.style.display = 'block';
    placeholder.style.display = 'none';
    this.setCamPreviewState('cam.previewLive');
  },

  /** One writer for the preview's state badge, so the label cannot disagree
   * with whether an image is actually being streamed. */
  setCamPreviewState(key: string): void {
    const el = document.getElementById('hw-camera-preview-state');
    if (!el) return;
    el.textContent = this.t(key);
    el.setAttribute('data-i18n', key);
  },

  hwStopCameraPreview(): void {
    const previewImg = document.getElementById('hw-camera-preview-img') as HTMLImageElement;
    const placeholder = document.getElementById('hw-camera-preview-placeholder');
    if (previewImg) {
      previewImg.src = '';
      previewImg.style.display = 'none';
    }
    if (placeholder) {
      placeholder.style.display = 'block';
    }
    this.setCamPreviewState('cam.previewIdle');
  },

  async hwAddCamera(): Promise<void> {
    const portSelect = document.getElementById('hw-camera-port-select') as HTMLSelectElement | null;
    const roleSelect = document.getElementById('hw-camera-role-select') as HTMLSelectElement | null;
    if (!portSelect || !roleSelect) return;
    
    let source: string = portSelect.value;
    if (!source) {
      alert(this.t('alert.selectCamPort'));
      return;
    }
    
    let deviceId = '';
    const selectedOption = portSelect.options[portSelect.selectedIndex];
    if (selectedOption) {
      deviceId = selectedOption.getAttribute('data-persistent-id') || `camera-index-${source}`;
    }
    
    const role = roleSelect.value;
    
    const cams = this.project?.cameras || [];
    let count = 1;
    let camId = `cam_${role}`;
    while (cams.some(c => c.id === camId)) {
      count++;
      camId = `cam_${role}_${count}`;
    }

    const parsedSource = isNaN(Number(source)) ? source : parseInt(source, 10);
    this.log('INFO', `Přidávám kameru: ${camId} na portu ${source}`);
    await this.api('POST', '/cameras', { id: camId, source: parsedSource, device_id: deviceId, role });
    
    portSelect.value = '';
    this.hwStopCameraPreview();

    this.refreshProject();
  },

  async hwClearCameras(): Promise<void> {
    const cams = this.project?.cameras || [];
    if (!cams.length) return;
    this.log('INFO', this.t('log.removingAllCams'));
    for (const c of cams) {
      await this.api('DELETE', `/cameras/${c.id}`);
    }
    this.refreshProject();
  },

  // ── Robot Hardware Management ───────────────────────────────────────
  renderRobots(): void {
    const el = document.getElementById('robot-list');
    if (!el) return;
    const robots = this.project?.robots || [];
    if (!robots.length) {
      el.innerHTML = `<div class="empty-state-text">${App.t('hint.noRobot')}</div>`;
      return;
    }
    el.innerHTML = robots.map(r => `
      <div class="item-row compact-row">
        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><rect x="4" y="4" width="4" height="16" rx="1"></rect><rect x="12" y="10" width="8" height="10" rx="1"></rect><path d="M8 8h4v4H8z"></path><circle cx="10" cy="10" r="2"></circle></svg> <strong>${this.esc(r.id)}</strong> (${r.type.toUpperCase()}) — Port: ${r.port}</span>
        <div style="display:flex; gap:4px;">
          <button class="btn btn-xs btn-secondary" onclick="App.calibrateRobot('${r.id}')">Kalibrovat</button>
          <button class="btn btn-xs btn-danger" onclick="App.removeRobot('${r.id}')">✕</button>
        </div>
      </div>
    `).join('');
  },

  showAddRobotModal(): void {
    this.scanHardware();
    this.openModal('modal-add-robot');
  },

  async addRobot(): Promise<void> {
    const id = (document.getElementById('robot-id') as HTMLInputElement).value.trim();
    const type = (document.getElementById('robot-type') as HTMLSelectElement).value;
    
    const select = document.getElementById('robot-port') as HTMLSelectElement | null;
    let port = select ? select.value : '';
    let deviceId = '';
    
    if (port === '__custom__') {
      port = (document.getElementById('robot-port-custom') as HTMLInputElement).value.trim();
    } else if (port && select) {
      const opt = select.options[select.selectedIndex];
      deviceId = opt.getAttribute('data-persistent-id') || '';
    }

    if (!id) return;
    await this.api('POST', '/robots', { id, type, port, device_id: deviceId });
    this.closeModal('modal-add-robot');
    this.refreshProject();
  },

  async removeRobot(id: string): Promise<void> {
    await this.api('DELETE', `/robots/${id}`);
    this.refreshProject();
  },

  async calibrateRobot(id: string): Promise<void> {
    this.log('INFO', `Starting calibration for robot ${id}...`);
    await this.api('POST', `/robots/${id}/calibrate`);
  },

  async calibrateArm(role: 'leader' | 'follower'): Promise<void> {
    const port = this.resolvedArmPort(role);
    const id = (document.getElementById(`tele-${role}-id`) as HTMLInputElement | null)?.value || `my_${role}_arm`;
    // The type comes from the same resolved field the preview prints, which
    // onRobotTypeChange() fills from the device catalogue. Re-deriving it here
    // by appending `_leader` is what used to send LeRobot names it does not
    // register (`lekiwi_leader`, `reachy2_leader`, `hope_jr_arm_leader`).
    const typeField = role === 'leader' ? 'tele-leader-type' : 'tele-follower-type';
    const type = (document.getElementById(typeField) as HTMLInputElement | null)?.value
      || (role === 'leader' ? 'so100_leader' : 'so100_follower');

    if (!port) {
      const msg = this.t('alert.armPortMissing', { role: role.toUpperCase() });
      this.log('ERROR', msg);
      alert(msg);
      return;
    }

    const btn = document.getElementById(`btn-calibrate-${role}`) as HTMLButtonElement | null;
    const oldText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = this.esc(this.t('btn.calibStarting', { role }));
    }

    try {
      this.log('INFO', `Spouštím kalibraci pro ${role} rameno (${id}) na portu ${port}...`);
      // lerobot_calibrate.py takes EITHER --teleop.* (leader) OR --robot.* (follower) —
      // a leader type like "so100_leader" is not a valid --robot.type choice at all.
      const payload = role === 'leader'
        ? { robot_id: id, teleop_type: type, teleop_port: port }
        : { robot_id: id, robot_type: type, port: port };
      await this.api('POST', '/hardware/calibrate', payload);
      this.showCalibrationLivePanel(id);
    } catch (err: any) {
      this.log('ERROR', `Chyba při spouštění kalibrace: ${err.message || err}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = oldText;
      }
    }
  },

  // ── Live calibration table (mirrors what LeRobot's own CLI prints while
  // recording each joint's range of motion: NAME | MIN | POS | MAX) ────────
  showCalibrationLivePanel(robotId: string): void {
    this.calibratingRobotId = robotId;
    const panel = document.getElementById('calibration-live-panel');
    const label = document.getElementById('calibration-live-robot');
    const tbody = document.getElementById('calibration-live-tbody');
    const ranges = document.getElementById('cal-ranges');
    const col = document.querySelector('.cal-col-run');
    if (label) label.textContent = robotId;
    if (tbody) tbody.innerHTML = '';
    if (panel) panel.style.display = 'block';
    // The procedure STAYS on screen during the run — with the current gate
    // highlighted it is the map of where the process is, and it is what keeps
    // the column filled once the live table (a handful of rows) is the only
    // other thing in it. The stored-range table does go: those are the values
    // this very run is about to overwrite.
    if (ranges) ranges.style.display = 'none';
    if (col) col.classList.add('is-running');
    this.setCalibrationPhase('start');
    this.renderArmSchematic('cal', null);
    this.renderCalibrationJointLegend(robotId);
  },

  /** Shows which of LeRobot's interactive gates is currently waiting, so the
   * buttons below read as answers to a specific question rather than guesses.
   * 'range' is inferred from the first min/pos/max row arriving; 'idle' means
   * no calibration process is running and the procedure list is on screen. */
  setCalibrationPhase(phase: 'idle' | 'start' | 'range'): void {
    const el = document.getElementById('cal-live-phase');
    const key = phase === 'range' ? 'cal.phaseRange'
      : phase === 'start' ? 'cal.phaseStart'
      : 'cal.phaseIdle';
    if (el) {
      el.textContent = this.t(key);
      el.setAttribute('data-i18n', key);
      el.classList.toggle('is-idle', phase === 'idle');
    }
    // Step 1 (reuse the stored file?) is never the active one: it is already
    // answered by the time any output reaches us, and it does not appear at
    // all when no calibration file exists for the id.
    const step = phase === 'range' ? 3 : phase === 'start' ? 2 : 0;
    this.setPhase('cal-rail', step, {
      title: phase === 'range' ? 'cal.now.range.title'
        : phase === 'start' ? 'cal.now.start.title' : 'cal.now.idle.title',
      text: phase === 'range' ? 'cal.now.range.text'
        : phase === 'start' ? 'cal.now.start.text' : 'cal.now.idle.text',
      titleEl: 'cal-now-title',
      textEl: 'cal-now-text',
      buttons: {
        'cal-btn-confirm': phase !== 'idle',
        'cal-btn-recal': phase === 'start',
        'cal-btn-cancel': phase !== 'idle',
      },
    });
  },

  /**
   * Drive a phase rail and the card under it.
   *
   * Every multi-step run in the app (calibration, recording, training, an
   * orchestration run) has the same shape, so they share one renderer: the
   * rail marks steps before `step` done and `step` itself active, and the
   * card says what to do about that step in ordinary type. `step` of 0 means
   * nothing is running.
   */
  setPhase(railId: string, step: number, o: {
    title: string; text: string; titleEl: string; textEl: string;
    buttons?: Record<string, boolean>;
  }): void {
    const rail = document.getElementById(railId);
    if (rail) {
      rail.querySelectorAll('li').forEach((li, i) => {
        li.classList.toggle('is-active', i + 1 === step);
        li.classList.toggle('is-done', step > 0 && i + 1 < step);
      });
    }
    for (const [id, key] of [[o.titleEl, o.title], [o.textEl, o.text]] as const) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.textContent = this.t(key);
      el.setAttribute('data-i18n', key);
    }
    for (const [id, show] of Object.entries(o.buttons || {})) {
      const b = document.getElementById(id);
      if (b) b.style.display = show ? '' : 'none';
    }
  },

  /** LeRobot's own prompts, verbatim — on demand rather than on screen. */
  openCalibrationHelp(): void {
    this.openModal('modal-calibration-howto');
  },

  /** Joint-name → motor-ID legend for whichever side (leader/follower) is
   * currently being calibrated — reuses the arm_visual_config already
   * fetched for the Teleoperation page's arm animation. */
  renderCalibrationJointLegend(robotId: string): void {
    const legend = document.getElementById('cal-live-legend');
    if (!legend) return;
    const activeRobot = (this.project?.robots || [])[0];
    const side = activeRobot?.leader_id === robotId ? 'leader'
      : activeRobot?.follower_id === robotId ? 'follower' : null;
    const joints = (side && this.armVisualConfig?.[side]?.joints) || {};
    const badges = this.ARM_JOINT_ORDER
      .map(name => joints[name] ? `<span class="arm-id-badge">${name}: <strong>#${joints[name].id}</strong></span>` : '')
      .filter(Boolean).join('');
    legend.innerHTML = badges;
  },

  hideCalibrationLivePanel(): void {
    this.calibratingRobotId = null;
    const panel = document.getElementById('calibration-live-panel');
    const ranges = document.getElementById('cal-ranges');
    const col = document.querySelector('.cal-col-run');
    const label = document.getElementById('calibration-live-robot');
    if (panel) panel.style.display = 'none';
    // Back to the idle state: the stored ranges that are actually bound right
    // now (not the aborted run's), and no step highlighted.
    if (ranges) ranges.style.display = '';
    if (col) col.classList.remove('is-running');
    if (label) label.textContent = '';
    this.setCalibrationPhase('idle');
    this.renderCalibrationIdleVisual();
  },

  /** The arm whose stored calibration the idle Kalibrace tab describes:
   * follower first (it is the arm that executes), then leader, then whatever
   * exists so the schematic is never drawn from nothing. */
  idleCalibrationArm(): any {
    const cfg = this.armVisualConfig;
    if (!cfg) return null;
    if (cfg.follower?.source === 'calibration') return cfg.follower;
    if (cfg.leader?.source === 'calibration') return cfg.leader;
    return cfg.follower || cfg.leader || null;
  },

  /** Idle schematic + motor-id legend, drawn from the ranges currently bound
   * instead of leaving an empty box in the column. */
  renderCalibrationIdleVisual(): void {
    if (this.calibratingRobotId) return;
    const arm = this.idleCalibrationArm();
    this.renderArmSchematic('cal', arm);
    const legend = document.getElementById('cal-live-legend');
    if (legend) {
      const joints = arm?.joints || {};
      legend.innerHTML = this.ARM_JOINT_ORDER
        .map(name => joints[name] ? `<span class="arm-id-badge">${name}: <strong>#${joints[name].id}</strong></span>` : '')
        .filter(Boolean).join('');
    }
    this.renderCalibrationStoredRanges(arm);
  },

  /** Idle run column: the range_min/range_max actually stored per joint.
   * These are the numbers the schematic is drawn from and the ones LeRobot
   * writes to the motors, so seeing them is how you tell a real calibration
   * from the fallback defaults — and why wrist_roll always reads 0–4095. */
  renderCalibrationStoredRanges(arm: any): void {
    const tbody = document.getElementById('cal-ranges-tbody');
    const note = document.getElementById('cal-ranges-note');
    const src = document.getElementById('cal-ranges-source');
    if (!tbody) return;
    const joints = arm?.joints || {};
    const rows = this.ARM_JOINT_ORDER.filter(name => joints[name]);

    if (src) {
      const key = !arm ? 'cal.stateUnknown'
        : arm.source === 'calibration' ? 'cal.rangesFromFile' : 'cal.rangesDefault';
      const filename = arm?.source === 'calibration' && arm.filename ? arm.filename : '';
      src.textContent = filename || this.t(key);
      // A filename is runtime data and must survive applyI18n(); a translated
      // label must be repainted by it. Carrying the key only in the second
      // case is the difference — this label stayed Czech in the English UI.
      if (filename) src.removeAttribute('data-i18n');
      else src.setAttribute('data-i18n', key);
      src.classList.toggle('is-default', !!arm && arm.source !== 'calibration');
    }

    tbody.innerHTML = rows.map(name => {
      const j = joints[name];
      const min = Number(j.range_min ?? 0);
      const max = Number(j.range_max ?? 0);
      const span = max - min;
      // Same threshold the live table uses: a span this small means the joint
      // was never moved during recording, not that it cannot move.
      const unmeasured = span < this._CAL_MIN_SPAN;
      return `
      <tr class="${unmeasured ? 'cal-row-unmeasured' : ''}">
        <td>${this.esc(name)}</td>
        <td>#${this.esc(String(j.id ?? '-'))}</td>
        <td>${min}</td>
        <td>${max}</td>
        <td class="cal-live-span">${unmeasured ? this.t('cal.notMoved') : span}</td>
      </tr>`;
    }).join('');

    if (note) {
      const key = !arm ? 'hint.calRangesEmpty'
        : arm.source === 'calibration' ? 'hint.calRangesFile' : 'hint.calRangesDefault';
      note.textContent = this.t(key);
      note.setAttribute('data-i18n', key);
    }
  },

  // lerobot_calibrate.py is interactive on stdin: it waits for Enter once
  // after "move to the middle", then again to stop recording the range of
  // motion. QProcess isn't attached to a real terminal, so without this the
  // process just hangs forever — it can never finish OR save.
  async confirmCalibrationStep(): Promise<void> {
    if (!this.calibratingRobotId) return;
    // Confirming the range-of-motion gate WRITES the calibration file. Any
    // joint still at zero span would be stored with range_min == range_max,
    // which makes that joint unusable and the whole calibration worthless —
    // so require an explicit decision instead of silently saving it.
    if (this._calUnmeasured.length) {
      const ok = confirm(this.t('cal.confirmUnmeasured', {list: this._calUnmeasured.join(', ')}));
      if (!ok) return;
    }
    await this.api('POST', `/robots/${this.calibratingRobotId}/calibrate/confirm`);
  },

  /** Answers LeRobot's "reuse stored calibration file?" prompt with 'c' to
   * force a fresh measurement instead of loading the saved one. */
  async forceNewCalibration(): Promise<void> {
    if (!this.calibratingRobotId) return;
    this.log('INFO', 'Vynucuji novou kalibraci (odesílám "c")…');
    await this.api('POST', `/robots/${this.calibratingRobotId}/calibrate/recalibrate`);
  },

  async cancelCalibration(): Promise<void> {
    if (!this.calibratingRobotId) return;
    await this.api('POST', `/robots/${this.calibratingRobotId}/calibrate/cancel`);
    this.hideCalibrationLivePanel();
  },

  renderCalibrationLiveTable(robotId: string, values: Record<string, {min: number; pos: number; max: number}>): void {
    const panel = document.getElementById('calibration-live-panel');
    const tbody = document.getElementById('calibration-live-tbody');
    if (!panel || !tbody || !values) return;
    // A calibration_progress event always implies the process is live —
    // show the panel even if the earlier robot_calibrating event was missed.
    if (panel.style.display === 'none') this.showCalibrationLivePanel(robotId);
    // Range-of-motion rows only stream during LeRobot's second gate.
    this.setCalibrationPhase('range');
    // Preserve kinematic-chain order (base → gripper) instead of raw object
    // insertion order, which follows whatever order the joints were moved in.
    const rows = this.ARM_JOINT_ORDER.filter(name => values[name]).map(name => [name, values[name]] as const);

    // LeRobot seeds mins/maxes with the CURRENT position
    // (record_ranges_of_motion: `mins = start_positions.copy()`), so before a
    // joint is moved its MIN, POS and MAX are all identical — that is "not
    // measured yet", NOT a reachable limit. Showing the span makes the
    // difference obvious instead of looking like a bogus limit.
    this._calUnmeasured = rows.filter(([, v]) => (v.max - v.min) < this._CAL_MIN_SPAN).map(([m]) => m);

    tbody.innerHTML = rows.map(([motor, v]) => {
      const span = v.max - v.min;
      const unmeasured = span < this._CAL_MIN_SPAN;
      return `
      <tr class="${unmeasured ? 'cal-row-unmeasured' : ''}">
        <td>${this.esc(motor)}</td>
        <td>${v.min}</td>
        <td class="cal-live-pos">${v.pos}</td>
        <td>${v.max}</td>
        <td class="cal-live-span">${unmeasured ? this.t('cal.notMoved') : span}</td>
      </tr>`;
    }).join('');

    // wrist_roll is deliberately absent: LeRobot treats it as a full-turn
    // motor and hardcodes 0..4095 instead of recording it, so its absence
    // here is correct and must not read as a missing joint.
    const note = document.getElementById('cal-live-note');
    if (note) {
      note.textContent = this._calUnmeasured.length
        ? this.t('cal.unmeasuredWarn', {list: this._calUnmeasured.join(', ')})
        : this.t('cal.allMeasured');
      note.classList.toggle('is-warn', this._calUnmeasured.length > 0);
    }

    this.updateArmVisualizationFromCalibration(robotId, values);
    // Cheap + idempotent — covers the case where arm_visual_config was still
    // loading when the panel first opened.
    this.renderCalibrationJointLegend(robotId);
  },

  // ── Calibration file manager ────────────────────────────────────────
  async openCalibrationFilesModal(): Promise<void> {
    this.openModal('modal-calibration-files');
    await this.loadCalibrationFiles();
  },

  async loadCalibrationFiles(): Promise<void> {
    const res = await this.api('GET', '/calibration/list');
    const files = res.files || [];
    this.renderCalibrationFilesList(files);
    this.renderCalibrationStoreSummary(files);
  },

  /** Kalibrace tab: how many calibrations exist and where they live, so the
   * file manager modal is a drill-down rather than the only way to find out
   * whether anything is saved at all. */
  renderCalibrationStoreSummary(files: any[]): void {
    const countEl = document.getElementById('cal-files-count');
    const noteEl = document.getElementById('cal-files-summary');
    if (countEl) countEl.textContent = String(files.length);
    if (!noteEl) return;
    if (!files.length) {
      noteEl.textContent = this.t('cal.noFiles');
      noteEl.setAttribute('data-i18n', 'cal.noFiles');
      return;
    }
    // scan_project_calibrations() marks project files; everything merged in
    // from the LeRobot cache carries source "cache".
    const cache = files.filter(f => f.source === 'cache').length;
    const active = files.filter(f => f.active_for && f.active_for.length).length;
    noteEl.textContent = this.t('hint.calStore', {
      project: String(files.length - cache), cache: String(cache), active: String(active),
    });
    noteEl.removeAttribute('data-i18n');
  },

  renderCalibrationFilesList(files: any[]): void {
    const el = document.getElementById('cal-files-list');
    if (!el) return;
    if (!files.length) {
      el.innerHTML = `<div class="modal-empty-note">${this.t('cal.noFiles')}</div>`;
      return;
    }
    const catLabel = (c: string) => c === 'robots' ? 'Follower' : 'Leader';
    // Pinned first, then newest — the two orders that matter when picking a
    // calibration to re-apply.
    const sorted = [...files].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)
      || (b.last_modified || '').localeCompare(a.last_modified || ''));

    const rows = sorted.map(f => {
      const isActive = !!(f.active_for && f.active_for.length);
      const date = f.last_modified ? new Date(f.last_modified).toLocaleString() : '—';
      return `
      <tr class="${isActive ? 'is-active' : ''}" data-filename="${this.esc(f.name)}">
        <td class="cal-col-pin">
          <label class="cal-file-pin" title="${this.t('cal.favorite')}">
            <input type="checkbox" ${f.favorite ? 'checked' : ''}
                   onchange="App.toggleCalibrationFavorite('${this.esc(f.name)}', this.checked)">PIN
          </label>
        </td>
        <td>
          <input type="text" class="cal-file-name-input" value="${this.esc(f.display_name)}"
                 onchange="App.renameCalibrationFile('${this.esc(f.name)}', this.value)">
          ${isActive ? `<span class="cal-file-active-badge">${this.t('cal.active')}</span>` : ''}
        </td>
        <td class="cal-col-target">${catLabel(f.category)} · ${this.esc(f.device_type)}</td>
        <td class="cal-col-date">${date}</td>
        <td class="cal-col-actions">
          <div class="cal-file-actions">
            <button class="btn btn-xs btn-primary" ${isActive ? 'disabled' : ''}
                    title="${this.t('cal.activate')}"
                    onclick="App.applyCalibrationFile('${this.esc(f.category)}', '${this.esc(f.name)}')">${this.t('cal.activate')}</button>
            <button class="btn btn-xs btn-danger btn-icon" title="${this.t('btn.delete')}"
                    onclick="App.deleteCalibrationFileEntry('${this.esc(f.category)}', '${this.esc(f.device_type)}', '${this.esc(f.name)}')">✕</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <table class="cal-file-table">
        <thead>
          <tr>
            <th class="cal-col-pin"></th>
            <th>${this.t('cal.colName')}</th>
            <th>${this.t('cal.colTarget')}</th>
            <th>${this.t('cal.colDate')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  },

  async renameCalibrationFile(filename: string, displayName: string): Promise<void> {
    await this.api('POST', '/calibration/meta', {filename, display_name: displayName});
  },

  async toggleCalibrationFavorite(filename: string, favorite: boolean): Promise<void> {
    await this.api('POST', '/calibration/meta', {filename, favorite});
    await this.loadCalibrationFiles();
  },

  async applyCalibrationFile(category: string, filename: string): Promise<void> {
    const activeRobot = (this.project?.robots || [])[0];
    if (!activeRobot) return;
    const res = await this.api('POST', '/calibration/apply', {robot_id: activeRobot.id, category, filename});
    if (res.ok) {
      this.log('SUCCESS', `Kalibrace '${filename}' aktivována.`);
      await this.refreshProject();
      await this.loadCalibrationFiles();
    }
  },

  async deleteCalibrationFileEntry(category: string, deviceType: string, filename: string): Promise<void> {
    if (!confirm(this.t('cal.confirmDelete'))) return;
    await this.api('DELETE', `/calibration/${category}/${deviceType}/${filename}`);
    await this.loadCalibrationFiles();
  },

  // ── Camera Management ───────────────────────────────────────────────
  renderCameras(): void {
    // Clear any customized aspect-ratios first so they can fall back to CSS default 4:3
    document.querySelectorAll('.cam-box').forEach(box => {
      (box as HTMLElement).style.aspectRatio = '';
    });
    
    const cams = this.project?.cameras || [];
    
    // Determine layout count to show
    let displayCount = 2; // Default fallback count
    if (this.cameraLayout === 'auto') {
      displayCount = cams.length || 2;
    } else {
      displayCount = parseInt(this.cameraLayout, 10) || 2;
    }
    
    // Dynamically render the docked cameras panel contents
    const dockBody = document.querySelector('.cameras-dock-body') as HTMLElement | null;
    if (dockBody) {
      dockBody.style.setProperty('display', 'grid', 'important');
      dockBody.style.setProperty('gap', '6px', 'important');
      dockBody.style.setProperty('padding', '6px', 'important');
      dockBody.style.setProperty('align-items', 'stretch', 'important');
      dockBody.style.setProperty('justify-content', 'stretch', 'important');
      
      if (displayCount === 1) {
        dockBody.style.setProperty('grid-template-columns', '1fr', 'important');
        dockBody.style.setProperty('grid-template-rows', '1fr', 'important');
      } else if (displayCount === 2) {
        dockBody.style.setProperty('grid-template-columns', '1fr 1fr', 'important');
        dockBody.style.setProperty('grid-template-rows', '1fr', 'important');
      } else {
        dockBody.style.setProperty('grid-template-columns', '1fr 1fr', 'important');
        dockBody.style.setProperty('grid-template-rows', '1fr 1fr', 'important');
      }
      
      let dockHtml = '';
      for (let i = 0; i < displayCount; i++) {
        const c = cams[i];
        if (c) {
          const isActive = (this.activeCameras || []).includes(c.id);
          dockHtml += `
            <div class="cam-box" style="position: relative; background: #000; overflow: hidden; display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; height: 100% !important; border: 1px solid var(--border); box-sizing: border-box;">
              <span class="cam-tag" style="position: absolute; top: 4px; left: 4px; z-index: 10; background: rgba(0,0,0,0.6); padding: 2px 6px; font-size: 9px; font-weight: bold; color: var(--text-light); text-transform: uppercase;">
                ${this.esc(c.id)} (${this.esc(c.role)})
              </span>
              <div id="tele-cam-feed-placeholder-${i + 1}" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
                ${isActive 
                  ? '<img src="/api/cameras/' + c.id + '/feed" onload="App.adjustCameraAspectRatio(this)" style="width:100%; height:100%; object-fit:cover;" />'
                  : '<span style="font-size: 9px; color: var(--text-muted);">Kamera ' + this.esc(c.id) + ' offline</span>'
                }
              </div>
            </div>
          `;
        } else {
          dockHtml += `
            <div class="cam-box" style="position: relative; background: #000; overflow: hidden; display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; height: 100% !important; border: 1px dashed var(--border-dark); box-sizing: border-box;">
              <span class="cam-tag" style="position: absolute; top: 4px; left: 4px; z-index: 10; background: rgba(0,0,0,0.4); padding: 2px 6px; font-size: 9px; font-weight: bold; color: var(--text-muted); text-transform: uppercase;">
                Nenastaveno
              </span>
              <div id="tele-cam-feed-placeholder-${i + 1}" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 9px; color: var(--text-muted);">${App.t('hint.noCamInProject')}</span>
              </div>
            </div>
          `;
        }
      }
      dockBody.innerHTML = dockHtml;
    }

    // The Connect tab shows how many of the scanned video devices the project
    // actually uses, so it repaints whenever that set changes.
    const camCount = document.getElementById('hw-camera-count');
    if (camCount) camCount.textContent = String(cams.length);
    this.renderDetectedHardware();

    const el = document.getElementById('hw-camera-list');
    if (!el) return;

    if (!cams.length) {
      el.innerHTML = '<div class="conn-empty">' + this.esc(this.t('hint.noCamsConfigured')) + '</div>';

      const placeholder1 = document.getElementById('cam-feed-placeholder-1');
      if (placeholder1) placeholder1.innerHTML = '<span>' + this.t('hint.noCamInProject') + '</span>';
      const placeholder2 = document.getElementById('cam-feed-placeholder-2');
      if (placeholder2) placeholder2.innerHTML = '<span>' + this.t('hint.noCamInProject') + '</span>';
      return;
    }
    const host = location.host || 'localhost:8000';
    
    // Render list in setup page
    el.innerHTML = cams.map(c => {
      const isActive = (this.activeCameras || []).includes(c.id);
      return `
        <div class="camera-card">
          <div class="camera-card-head">
            <span class="camera-card-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> <strong>${this.esc(c.id)}</strong> <span class="camera-card-role">(${c.role})</span> — Source: ${c.source}</span>
            <div class="camera-card-actions">
              ${isActive
                ? '<button class="btn btn-xs btn-secondary" onclick="App.stopCamera(\'' + c.id + '\')">Stop</button>'
                : '<button class="btn btn-xs btn-success" onclick="App.startCamera(\'' + c.id + '\')">Start</button>'
              }
              <button class="btn btn-xs btn-danger btn-icon" onclick="App.removeCamera(\'' + c.id + '\')" title="${App.t('btn.delete')}">✕</button>
            </div>
          </div>
          ${isActive
            ? '<div class="camera-feed-container"><img src="/api/cameras/' + c.id + '/feed" class="camera-feed-img" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';" /><div style="display:none; align-items:center; justify-content:center; width:100%; height:100%; font-size:9px; color:var(--text-muted);">' + App.t('hint.streamFailed') + '</div></div>'
            : '<div class="camera-offline">' + App.t('hint.camOffline') + '</div>'
          }
        </div>
      `;
    }).join('');

    // Update dynamic live stream streams inside Learning workflow panel and Teleoperation panel
    cams.forEach((c, idx) => {
      const isActive = (this.activeCameras || []).includes(c.id);
      
      const placeholder = document.getElementById('cam-feed-placeholder-' + (idx + 1));
      if (placeholder) {
        if (isActive) {
          placeholder.innerHTML = '<img src="/api/cameras/' + c.id + '/feed" onload="App.adjustCameraAspectRatio(this)" style="width:100%; height:100%; object-fit:cover;" />';
        } else {
          placeholder.innerHTML = '<span>Kamera ' + c.id + ' (' + c.role + ') offline</span>';
        }
      }

      const telePlaceholder = document.getElementById('tele-cam-feed-placeholder-' + (idx + 1));
      if (telePlaceholder) {
        if (isActive) {
          telePlaceholder.innerHTML = '<img src="/api/cameras/' + c.id + '/feed" onload="App.adjustCameraAspectRatio(this)" style="width:100%; height:100%; object-fit:cover;" />';
        } else {
          telePlaceholder.innerHTML = '<span>Kamera ' + c.id + ' (' + c.role + ') offline</span>';
        }
      }
    });
  },

  onCameraLayoutChange(): void {
    const select = document.getElementById('camera-layout-select') as HTMLSelectElement | null;
    if (select) {
      this.cameraLayout = select.value;
      localStorage.setItem('orchiday_camera_layout', this.cameraLayout);
      this.renderCameras();
    }
  },

  adjustCameraAspectRatio(img: HTMLImageElement): void {
    if (img && img.naturalWidth && img.naturalHeight) {
      const camBox = img.closest('.cam-box') as HTMLDivElement | null;
      if (camBox) {
        camBox.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      }
    }
  },

  async restartAllCameras(): Promise<void> {
    await this.api('POST', '/cameras/restart_all');
    this.log('INFO', 'Obnovuji náhledy kamer...');
  },

  showAddCameraModal(): void {
    this.scanHardware();
    this.openModal('modal-add-camera');
  },

  async addCamera(): Promise<void> {
    const id = (document.getElementById('camera-id') as HTMLInputElement).value.trim();
    
    const select = document.getElementById('camera-source') as HTMLSelectElement | null;
    let source: string = select ? select.value : '';
    let deviceId = '';

    if (source === '__custom__') {
      source = (document.getElementById('camera-source-custom') as HTMLInputElement).value.trim();
    } else if (source !== '' && select) {
      const opt = select.options[select.selectedIndex];
      deviceId = opt.getAttribute('data-persistent-id') || '';
    }

    const role = (document.getElementById('camera-role') as HTMLSelectElement).value;
    if (!id) return;
    
    const parsedSource = (source === '' || isNaN(Number(source))) ? source : parseInt(source, 10);
    await this.api('POST', '/cameras', { id, source: parsedSource, device_id: deviceId, role });
    this.closeModal('modal-add-camera');
    this.refreshProject();
  },

  async removeCamera(id: string): Promise<void> {
    await this.api('DELETE', `/cameras/${id}`);
    this.refreshProject();
  },

  async startCamera(id: string): Promise<void> { await this.api('POST', `/cameras/${id}/start`); },
  async stopCamera(id: string): Promise<void> { await this.api('POST', `/cameras/${id}/stop`); },
  async startAllProjectCameras(): Promise<void> {
    const cams = this.project?.cameras || [];
    for (const c of cams) {
      if (!(this.activeCameras || []).includes(c.id)) {
        this.log('INFO', `Starting camera ${c.id}...`);
        await this.startCamera(c.id);
      }
    }
  },

  // ── Workflow Stepper ────────────────────────────────────────────────
  setDropdownOrCustomValue(selectId: string, value: string): void {
    const select = document.getElementById(selectId) as HTMLSelectElement | null;
    if (!select) return;
    if (!value) {
      select.value = '';
      return;
    }

    let found = false;
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].value === value) {
        select.value = value;
        found = true;
        break;
      }
    }

    if (!found) {
      // Dynamically add the loaded option inside the dropdown itself
      const newOpt = document.createElement('option');
      newOpt.value = value;
      newOpt.textContent = value;
      select.insertBefore(newOpt, select.lastElementChild);
      select.value = value;
    }

    select.setAttribute('data-last-val', value);
  },

  prefillWorkflowData(): void {
    const robots = this.project?.robots || [];
    const skills = this.project?.skills || [];
    
    // With no robot record yet, the project-level robot_type is the setting the
    // Setup tab writes — falling back to a hardcoded 'so100' here silently
    // undid the user's choice a moment after they made it.
    const activeRobot = robots[0] || {
      id: 'my_follower_arm',
      type: this.project?.robot_type || 'so100',
      port: '/dev/ttyUSB0',
    };
    const activeSkill = this.activeSkill || skills[0] || 'pick_cube';

    // Prefill Step 1: Teleop
    const leaderIdEl = document.getElementById('tele-leader-id') as HTMLInputElement | null;
    if (leaderIdEl) {
      leaderIdEl.value = activeRobot.leader_id || `${activeRobot.id.replace('_follower', '')}_leader`;
    }
    
    // Prefill leader port ONLY if it is physically scanned and available.
    // The Quick Setup wizard only saves leader/follower ports onto the robot
    // record (robot.leader_port), never onto the project itself, so that
    // must be checked first or a wizard-configured leader port never prefills.
    const savedLeaderPort = this.project?.leader_port || activeRobot.leader_port || "";
    const isLeaderAvailable = this.availablePorts.some(p => p.device === savedLeaderPort);
    this.setDropdownOrCustomValue('tele-leader-port', isLeaderAvailable ? savedLeaderPort : "");
    
    const followerIdEl = document.getElementById('tele-follower-id') as HTMLInputElement | null;
    if (followerIdEl) {
      followerIdEl.value = activeRobot.follower_id || activeRobot.id;
    }
    
    // Prefill follower port ONLY if it is physically scanned and available
    const savedFollowerPort = this.project?.follower_port || activeRobot.follower_port || activeRobot.port || "";
    const isFollowerAvailable = this.availablePorts.some(p => p.device === savedFollowerPort);
    this.setDropdownOrCustomValue('tele-follower-port', isFollowerAvailable ? savedFollowerPort : "");
    
    // The robot record decides the device type, but the NAMES that reach
    // LeRobot come from the catalogue — appending `_leader` / `_follower` here
    // was a fourth copy of the derivation and it silently overwrote the
    // resolved pair a moment after the Connect tab had painted it.
    this.setRobotTypeValue(activeRobot.type);
    this.onRobotTypeChange();

    // Prefill inputs based on active selected skill
    this.selectSkill(activeSkill);
  },

  // ── Step 1: Teleoperation ───────────────────────────────────────────
  async startTeleop(): Promise<void> {
    const rType = (document.getElementById('tele-follower-type') as HTMLInputElement).value;
    
    const followerSelect = document.getElementById('tele-follower-port') as HTMLSelectElement | null;
    let rPort = followerSelect ? followerSelect.value : '';
    if (rPort === '__custom__') {
      rPort = (document.getElementById('tele-follower-port-custom') as HTMLInputElement).value.trim();
    } else {
      rPort = (rPort || '').trim();
    }

    const rId = (document.getElementById('tele-follower-id') as HTMLInputElement).value;
    const tType = (document.getElementById('tele-leader-type') as HTMLInputElement).value;
    
    const leaderSelect = document.getElementById('tele-leader-port') as HTMLSelectElement | null;
    let tPort = leaderSelect ? leaderSelect.value : '';
    if (tPort === '__custom__') {
      tPort = (document.getElementById('tele-leader-port-custom') as HTMLInputElement).value.trim();
    } else {
      tPort = (tPort || '').trim();
    }

    const tId = (document.getElementById('tele-leader-id') as HTMLInputElement).value;
    const displayData = (document.getElementById('tele-display-data') as HTMLInputElement).checked;
    const fpsVal = (document.getElementById('tele-fps') as HTMLInputElement | null)?.value;
    const fps = fpsVal ? parseInt(fpsVal, 10) : 30;
    const timeSVal = (document.getElementById('tele-time-s') as HTMLInputElement | null)?.value;
    const timeS = timeSVal ? parseFloat(timeSVal) : null;

    if (!rPort || !tPort) {
      const msg = "Both Follower and Leader serial ports must be specified!";
      this.log('ERROR', `Validation Failed: ${msg}`);
      alert(msg);
      return;
    }

    if (rPort === tPort) {
      const msg = `Serial Port Conflict! Leader and Follower cannot share the same port: '${rPort}'`;
      this.log('ERROR', `Validation Failed: ${msg}`);
      alert(msg);
      return;
    }

    const activeRobot = (this.project?.robots || [])[0];
    if (!activeRobot?.leader_calibration || !activeRobot?.follower_calibration) {
      const missing = [
        !activeRobot?.leader_calibration ? 'leader' : null,
        !activeRobot?.follower_calibration ? 'follower' : null,
      ].filter(Boolean).join(' + ');
      const msg = `Rameno (${missing}) není zkalibrované. Nejprve dokonči kalibraci na kartě Setup → Kalibrace — bez ní by teleoperace pohybovala rameny mimo bezpečný rozsah.`;
      this.log('ERROR', `Validation Failed: ${msg}`);
      alert(msg);
      return;
    }

    this.log('INFO', `Starting teleop workflow between leader (${tId}) and follower (${rId}) with FPS: ${fps}, duration: ${timeS || 'infinite'}...`);
    await this.api('POST', '/teleop/start', {
      robot_type: rType,
      robot_port: rPort,
      robot_id: rId,
      teleop_type: tType,
      teleop_port: tPort,
      teleop_id: tId,
      display_data: displayData,
      fps: fps,
      teleop_time_s: isNaN(timeS) || timeS === null ? null : timeS,
      cameras: ""
    });
  },

  async stopTeleop(): Promise<void> {
    this.log('WARN', 'Stopping teleoperation session...');
    await this.api('POST', '/teleop/stop');
  },

  // ── Step 2: Teleoperated Record ─────────────────────────────────────
  async startWorkflowRecord(): Promise<void> {
    const robots = this.project?.robots || [];
    const rType = robots[0]?.type || 'so100_follower';
    const rPort = robots[0]?.port || '';
    const repo = (document.getElementById('rec-repo-id') as HTMLInputElement | null)?.value.trim();
    const eps = parseInt((document.getElementById('rec-episodes') as HTMLInputElement | null)?.value || '50', 10);
    const fps = 30; // Native LeRobot FPS target
    const taskDesc = (document.getElementById('rec-task-desc') as HTMLInputElement | null)?.value.trim() || '';
    const episodeTime = parseFloat((document.getElementById('rec-duration') as HTMLInputElement | null)?.value || '60') || 60;
    const pushHub = (document.getElementById('rec-push-hub') as HTMLInputElement | null)?.checked || false;
    const resume = (document.getElementById('rec-resume') as HTMLInputElement | null)?.checked || false;

    if (!repo) {
      const msg = "Dataset Repo ID cannot be empty!";
      this.log('ERROR', `Validation Failed: ${msg}`);
      alert(msg);
      return;
    }

    if (!rPort) {
      const msg = "No Follower robot serial port configured in Hardware Config! Please add/configure a robot port first.";
      this.log('ERROR', `Validation Failed: ${msg}`);
      alert(msg);
      return;
    }

    // The request can take a while (the backend spawns the LeRobot process and
    // opens the serial port), so the button says so instead of looking dead.
    const startBtn = document.getElementById('btn-start-record') as HTMLButtonElement | null;
    const startLabel = startBtn?.querySelector('span');
    const startLabelText = startLabel?.textContent || '';
    if (startBtn) startBtn.disabled = true;
    if (startLabel) startLabel.textContent = this.t('btn.startingRecording');

    this.setRecordingUiActive(true);

    this.log('INFO', `Requesting Record for ${repo} (${eps} eps @ ${fps}fps, task="${taskDesc || this.activeSkill}")`);
    const extraArgs = (document.getElementById('rec-extra-args') as HTMLInputElement | null)?.value.trim() || '';
    const res = await this.api('POST', '/recording/start', {
      robot_type: rType,
      dataset_name: repo,
      skill_slug: this.activeSkill,
      num_episodes: eps,
      fps: fps,
      port: rPort,
      single_task: taskDesc,
      episode_time_s: episodeTime,
      push_to_hub: pushHub,
      resume: resume,
      extra_args_str: extraArgs
    });
    
    if (startBtn) startBtn.disabled = false;
    if (startLabel) startLabel.textContent = startLabelText || this.t('btn.startRecording');

    if (res && res.ok === false) {
      this.log('ERROR', `Backend Validation Failed: ${res.error}`);
      alert(`${this.t('alert.errorPrefix')}: ${res.error}`);
      this.setRecordingUiActive(false);
    } else if (res && res.ok !== false) {
      this.initTaggingWizard();
    }
  },

  /**
   * Single switch for "a take is running": the live controls, the recording
   * keys and the two Start/Stop buttons all read from it, so they can never
   * disagree about whether a recording is in progress.
   */
  setRecordingUiActive(on: boolean): void {
    this.recordingActive = on;
    const liveControls = document.getElementById('rec-live-controls');
    if (liveControls) liveControls.style.display = on ? 'flex' : 'none';
    const stopBtn = document.getElementById('btn-stop-record') as HTMLButtonElement | null;
    if (stopBtn) {
      stopBtn.disabled = !on;
      stopBtn.title = this.t(on ? 'tip.stopRecording' : 'tip.notRecording');
    }
  },

  async stopWorkflowRecord(): Promise<void> {
    const skillSlug = this.activeSkill || 'pick_cube';
    await this.api('POST', '/recording/stop', { skill_slug: skillSlug });
    this.setRecordingUiActive(false);
    await this.finishTaggingPostProcess();
  },

  async sendRecordingAction(action: string): Promise<void> {
    const labelKeys: Record<string, string> = {
      next: 'log.recNext',
      reset: 'log.recRetry',
      stop: 'log.recStop',
    };
    this.log('INFO', labelKeys[action] ? this.t(labelKeys[action]) : action);
    // Pass the skill explicitly so the backend targets the right process even
    // if several recordings were ever queued.
    const res = await this.api('POST', '/recording/action', { action, skill: this.activeSkill || '' });
    if (res && res.ok === false) {
      this.log('WARN', `Akce se nezdařila: ${res.error}`);
    }
  },

  // ── Replay a recorded episode on the real follower arm ──────────────
  async startReplay(): Promise<void> {
    const repo = this.dsSelectedRepo();
    const idx = parseInt((document.getElementById('ds-viz-episode') as HTMLInputElement | null)?.value || '0', 10) || 0;
    const robots = this.project?.robots || [];
    const rType = robots[0]?.type || 'so100';
    const rPort = robots[0]?.follower_port || robots[0]?.port || '';

    if (!repo) {
      const msg = "Nejprve vyberte dataset.";
      this.log('ERROR', `Validation Failed: ${msg}`);
      alert(msg);
      return;
    }

    if (!rPort) {
      const msg = "No Follower robot serial port configured! Cannot replay episode without hardware port.";
      this.log('ERROR', `Validation Failed: ${msg}`);
      alert(msg);
      return;
    }

    this.log('INFO', `Triggering LeRobot Replay for dataset '${repo}', episode ${idx}...`);
    await this.api('POST', '/replay/start', {
      robot_type: rType,
      dataset_name: repo,
      episode_index: idx,
      port: rPort
    });
  },

  // ── Step 4: Policy Training ─────────────────────────────────────────
  async startWorkflowTraining(): Promise<void> {
    // Read from state, not the DOM: a row scrolled out of view or repainted by
    // a readiness refresh is still selected, and it must still be trained.
    const checkedSkills = this.selectedTrainTargets().map(t => t.slug);

    if (checkedSkills.length === 0) {
      const msg = this.t('alert.selectStepToTrain');
      this.log('ERROR', `Validation Failed: ${msg}`);
      alert(msg);
      return;
    }

    const policy = (document.getElementById('train-policy-type') as HTMLSelectElement).value;
    const steps = parseInt((document.getElementById('train-steps') as HTMLInputElement).value, 10) || 10000;
    const batchSize = parseInt((document.getElementById('train-batch-size') as HTMLInputElement | null)?.value || '8', 10) || 8;

    this.trainingQueue = [...checkedSkills];
    this.lossData = [];
    this._trainTotalSteps = steps;
    this.setProgressPercent(0);
    this.drawLossChart();

    const device = (document.getElementById('train-device') as HTMLSelectElement | null)?.value || 'cuda';
    const wandb = (document.getElementById('train-wandb') as HTMLInputElement | null)?.checked || false;
    const extraArgs = (document.getElementById('train-extra-args') as HTMLInputElement | null)?.value.trim() || '';

    this.log('INFO', this.t('log.trainQueueStart',
      { s: checkedSkills.join(', '), steps, batch: batchSize }));
    this.renderTrainingSkillsTree();

    const btn = document.getElementById('btn-start-training') as HTMLButtonElement | null;
    const label = btn?.textContent || '';
    // The server spawns lerobot-train (imports torch, opens the dataset), so
    // the round trip is not instant — the button has to say it is working.
    if (btn) { btn.disabled = true; btn.textContent = this.t('btn.startingShort'); }
    try {
      await this.api('POST', '/training/start', {
        skills: checkedSkills,
        policy_type: policy,
        steps: steps,
        batch_size: batchSize,
        device: device,
        use_wandb: wandb,
        extra_args_str: extraArgs
      });
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label || this.t('btn.startTraining'); }
    }
  },

  async stopWorkflowTraining(): Promise<void> {
    const active = this.activeTrainingSkill || this.activeSkill || 'pick_cube';
    await this.api('POST', '/training/stop', { skill_slug: active });
    this.trainingQueue = [];
    this.activeTrainingSkill = null;
    this.renderTrainingSkillsTree();
  },

  async startWorkflowInference(): Promise<void> {
    const path = (document.getElementById('eval-policy-path') as HTMLInputElement).value.trim();
    const taskName = (document.getElementById('eval-task-name') as HTMLInputElement).value.trim();
    const robots = this.project?.robots || [];
    const rType = robots[0]?.type || 'so100';
    const rPort = robots[0]?.port || '';

    if (!path) {
      const msg = this.t('alert.noPolicyPath');
      this.log('ERROR', msg);
      alert(msg);
      return;
    }

    if (!rPort) {
      const msg = this.t('alert.noFollowerPort');
      this.log('ERROR', msg);
      alert(msg);
      return;
    }

    this.log('INFO', this.t('log.deployingPolicy', { path }));
    const btn = document.getElementById('btn-deploy-policy') as HTMLButtonElement | null;
    const label = btn?.textContent || '';
    // Spawning the daemon opens the serial port and the cameras — seconds on
    // real hardware, so the button has to say it is working.
    if (btn) { btn.disabled = true; btn.textContent = this.t('btn.deployBusy'); }
    let res: any;
    try {
      res = await this.api('POST', '/inference/start', {
        robot_type: rType,
        policy_path: path,
        skill_slug: taskName.replace('eval_', ''),
        port: rPort,
        fps: 30
      });
    } finally {
      // Restored from the process state, not by flipping it back: a successful
      // start arrives as process_started and must leave the button disabled.
      if (btn) { btn.textContent = label || this.t('btn.deployPolicy'); }
      this.updateActionButtonStates();
    }
    if (res && res.ok !== false) {
      this.initPersistentInferenceUI();
    }
  },

  async stopWorkflowInference(): Promise<void> {
    const taskName = (document.getElementById('eval-task-name') as HTMLInputElement).value.trim();
    await this.api('POST', '/inference/stop', { skill_slug: taskName.replace('eval_', '') });
    this.setInferencePanelVisible(false);
    this.updateInferenceDaemonStatus('OFF');
    this.setInferenceSubtaskRunning('');
  },

  selectRobot(type: string): void {
    // A device Orchiday cannot drive with the single serial port this tab
    // hands out must not become the project's robot — the row is rendered
    // disabled and says why, this is the guard behind it.
    const entry = this.deviceTypeFor(type);
    if (entry && !entry.supported) {
      this.log('WARN', this.t('log.deviceUnsupported', { type: entry.robot_type }));
      return;
    }

    this.setRobotTypeValue(type);

    this.onRobotTypeChange();

    // Dynamically auto-save configuration in active project config in real time
    this.saveSettingsState();
  },

  syncDatasetStorageDir(sourceId: string): void {
    const src = document.getElementById(sourceId) as HTMLInputElement | null;
    const targetId = sourceId === 'settings-dataset-storage-dir' ? 'rec-dataset-storage-dir' : 'settings-dataset-storage-dir';
    const target = document.getElementById(targetId) as HTMLInputElement | null;
    if (src && target) {
      target.value = src.value;
    }
    this.saveSettingsState();
  },

  saveSettingsState(): void {
    if (this.isProjectLoading) return;
    if (!this.project) return;
    const robotType = (document.getElementById('robot-type-select') as HTMLSelectElement | null)?.value || 'so100';
    const followerPort = (document.getElementById('tele-follower-port') as HTMLSelectElement | null)?.value || '';
    const leaderPort = (document.getElementById('tele-leader-port') as HTMLSelectElement | null)?.value || '';
    const storageDir = (document.getElementById('settings-dataset-storage-dir') as HTMLInputElement | null)?.value.trim() || '';

    const loopIntervalInput = document.getElementById('settings-loop-interval') as HTMLInputElement | null;
    const loopInterval = loopIntervalInput ? parseFloat(loopIntervalInput.value) : null;

    const lerobotDirEl = document.getElementById('settings-lerobot-dir-global') as HTMLInputElement | null;
    const lerobotDir = lerobotDirEl ? lerobotDirEl.value.trim() : '';

    const pyPathEl = document.getElementById('settings-python-path') as HTMLInputElement | null;
    const pyPath = pyPathEl ? pyPathEl.value.trim() : '';

    this.api('POST', '/settings', {
      lerobot_dir: lerobotDir,
      python_path: pyPath,
      robot_type: robotType,
      follower_port: followerPort,
      leader_port: leaderPort,
      dataset_storage_dir: storageDir,
      sequential_loop_interval: isNaN(loopInterval as number) ? null : loopInterval
    }).catch(err => {
      console.error("Failed to auto-save settings state:", err);
    });
  },



  async manualRefreshCalibration(): Promise<void> {
    const btn = document.getElementById('btn-refresh-calibration') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = this.t('btn.loading');
    }
    try {
      this.log('INFO', 'Obnovuji stav kalibrace a hardwaru...');
      await this.scanHardware();
      await this.refreshProject();
      await this.loadArmVisualConfig();
      await this.loadCalibrationFiles();
      await this.loadSysInfo();
      this.log('SUCCESS', 'Stav kalibrace a hardwaru byl úspěšně obnoven.');
    } catch (err: any) {
      this.log('ERROR', 'Chyba při obnovení stavu: ' + (err.message || err));
    } finally {
      if (btn) {
        // Restoring hardcoded Czech here used to un-translate the button on
        // every refresh in English mode.
        btn.textContent = this.t('btn.loadState');
        btn.disabled = false;
      }
    }
  },

  async restartServer(): Promise<void> {
    this.log('INFO', 'Odesílám požadavek na restart serveru...');
    try {
      await this.api('POST', '/system/restart');
      this.log('SUCCESS', 'Server se restartuje...');
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err: any) {
      this.log('ERROR', 'Chyba při restartu serveru: ' + (err.message || err));
    }
  },

  onRobotTypeChange(): void {
    const robotTypeSelect = document.getElementById('robot-type-select') as HTMLSelectElement | null;
    if (!robotTypeSelect) return;
    const robotType = robotTypeSelect.value;
    const entry = this.deviceTypeFor(robotType);

    // Whether there is a leader arm to calibrate is a property of the device
    // in LeRobot's registry, not a hardcoded list of names: a robot with no
    // registered teleoperator has no leader card and no leader port.
    const hasLeader = entry ? entry.has_leader : true;

    const leaderGroup = document.getElementById('leader-config-group');
    const btnCalibrateLeader = document.getElementById('btn-calibrate-leader');
    // The whole leader card on the Kalibrace tab goes with the button —
    // leaving the card behind showed a device that cannot be calibrated.
    const calCardLeader = document.getElementById('cal-arm-leader');

    if (!hasLeader) {
      if (leaderGroup) leaderGroup.style.display = 'none';
      if (btnCalibrateLeader) btnCalibrateLeader.style.display = 'none';
      if (calCardLeader) calCardLeader.style.display = 'none';
    } else {
      if (leaderGroup) leaderGroup.style.display = 'flex';
      if (btnCalibrateLeader) btnCalibrateLeader.style.display = 'inline-flex';
      if (calCardLeader) calCardLeader.style.display = '';
    }

    // The resolved types the rest of the app reads. They come from the
    // catalogue, never from string surgery on the follower name — appending
    // `_leader` invents a type for every robot whose teleoperator is not
    // named after it (lekiwi, reachy2, unitree_g1, hope_jr_*), and draccus
    // kills the process on an unregistered name.
    const leaderTypeInput = document.getElementById('tele-leader-type') as HTMLInputElement | null;
    const followerTypeInput = document.getElementById('tele-follower-type') as HTMLInputElement | null;
    if (leaderTypeInput) leaderTypeInput.value = (entry?.leader_type) || 'so100_leader';
    if (followerTypeInput) followerTypeInput.value = (entry?.robot_type) || robotType;

    this.renderRobotTypeList();
    this.updateConnectCmdPreview();
    this.updateHardwareButtonStates();
  },

  // ── Connect tab: the device catalogue LeRobot really registers ──────────
  // Loaded once from GET /api/hardware/device_types. Nothing in the browser
  // derives `--robot.type` / `--teleop.type` on its own: a second copy of
  // that mapping is exactly what drifted away from LeRobot before.

  /** Resolves any stored name (bare family, mangled, leader half) to an entry. */
  deviceTypeFor(name: string | null | undefined): any | null {
    if (!name) return null;
    const list = this.deviceTypes || [];
    if (!list.length) return null;
    const hit = list.find((d: any) => d.robot_type === name);
    if (hit) return hit;
    const asLeader = list.find((d: any) => d.leader_type === name);
    if (asLeader) return asLeader;
    // Names older versions wrote: "so100", "lekiwi_follower", "reachy2_leader"
    const base = name.replace(/_(follower|leader)$/, '');
    return list.find((d: any) => d.robot_type === base)
        || list.find((d: any) => d.robot_type === `${base}_follower`)
        || null;
  },

  async loadDeviceTypes(): Promise<void> {
    try {
      const res = await this.api('GET', '/hardware/device_types');
      this.deviceTypes = res.device_types || [];
    } catch (_) {
      this.deviceTypes = [];
    }
    this.renderRobotTypeList();
    this.onRobotTypeChange();
  },

  /** Rebuilds the hidden robot-type <select> from the catalogue and restores
   * the wanted value. A project can be opened before the catalogue arrives,
   * and assigning a value a <select> has no option for is a silent no-op —
   * that is why the wanted type is remembered on the element itself. */
  syncRobotTypeOptions(): void {
    const select = document.getElementById('robot-type-select') as HTMLSelectElement | null;
    if (!select) return;
    const list = this.deviceTypes || [];
    if (!list.length) return;

    const wanted = select.getAttribute('data-desired') || select.value || '';
    const signature = list.map((d: any) => d.robot_type).join(',');
    if (select.getAttribute('data-signature') !== signature) {
      select.innerHTML = list.map((d: any) =>
        `<option value="${this.esc(d.robot_type)}">${this.esc(d.robot_type)}</option>`).join('');
      select.setAttribute('data-signature', signature);
    }
    const resolved = this.deviceTypeFor(wanted)?.robot_type || list[0].robot_type;
    if (select.value !== resolved) select.value = resolved;
  },

  /** The one way the robot type is set. Remembers the wanted value even when
   * the catalogue has not arrived yet, so a project opened first is not lost. */
  setRobotTypeValue(type: string): void {
    const select = document.getElementById('robot-type-select') as HTMLSelectElement | null;
    if (!select) return;
    select.setAttribute('data-desired', type);
    this.syncRobotTypeOptions();
  },

  /** One row per device LeRobot registers: what it is called on the command
   * line, which teleoperator leads it, and how it is addressed. Rows Orchiday
   * cannot drive with the one serial port this tab hands out are disabled and
   * carry the reason, instead of being selectable and dying at spawn time. */
  renderRobotTypeList(): void {
    const host = document.getElementById('connect-robot-list');
    if (!host) return;
    const list = this.deviceTypes || [];
    const count = document.getElementById('conn-type-count');

    if (!list.length) {
      host.innerHTML = `<div class="conn-empty">${this.esc(this.t('hint.deviceTypesUnavailable'))}</div>`;
      if (count) count.textContent = '-';
      return;
    }

    // The hidden <select> is what the rest of the app reads the robot type
    // from, and a <select> silently refuses a value it has no option for —
    // so its options come from the catalogue too, before anything sets it.
    this.syncRobotTypeOptions();

    const active = (document.getElementById('robot-type-select') as HTMLSelectElement | null)?.value || '';
    const usable = list.filter((d: any) => d.supported).length;
    if (count) count.textContent = this.t('lbl.nOfMDrivable', { n: usable, m: list.length });

    host.innerHTML = list.map((d: any) => {
      const isActive = d.robot_type === active;
      const cls = ['conn-type-row'];
      if (isActive) cls.push('is-active');
      if (!d.supported) cls.push('is-blocked');
      // The reason a row is out of reach is composed here, from the structured
      // facts the catalogue carries — the backend has no business shipping
      // translated prose.
      const title = d.supported
        ? this.t('tip.deviceSupported', { robot: d.robot_type, leader: d.leader_type || '–' })
        : this.t('tip.deviceBlocked', {
            robot: d.robot_type,
            conn: this.t('conn.' + d.connection),
            flag: d.port_flag,
          });
      const leader = d.leader_type
        ? `--teleop.type=${d.leader_type}`
        : this.t('lbl.noLeader');
      return `<div class="${cls.join(' ')}" data-value="${this.esc(d.robot_type)}"
                   role="button" tabindex="0" title="${this.esc(title)}"
                   onclick="App.selectRobot('${this.esc(d.robot_type)}')"
                   onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();App.selectRobot('${this.esc(d.robot_type)}');}">
                <div class="conn-type-main">
                  <span class="conn-type-label">${this.esc(d.label)}</span>
                  <span class="conn-type-conn">${this.esc(this.t('conn.' + d.connection))}</span>
                </div>
                <div class="conn-type-flags">
                  <code>--robot.type=${this.esc(d.robot_type)}</code>
                  <code>${this.esc(leader)}</code>
                </div>
              </div>`;
    }).join('');
  },

  /** Restates the current choice as the flags that will really be spawned.
   * Kept next to the ports it is built from, and it is the only place this
   * tab names a LeRobot command. */
  updateConnectCmdPreview(): void {
    const el = document.getElementById('conn-cmd-preview-text');
    const state = document.getElementById('conn-port-state');
    if (!el) return;

    const robotType = (document.getElementById('robot-type-select') as HTMLSelectElement | null)?.value || '';
    const entry = this.deviceTypeFor(robotType);
    const leaderType = (document.getElementById('tele-leader-type') as HTMLInputElement | null)?.value || '';
    const followerType = (document.getElementById('tele-follower-type') as HTMLInputElement | null)?.value || '';
    const leaderPort = this.resolvedArmPort('leader');
    const followerPort = this.resolvedArmPort('follower');
    const leaderId = (document.getElementById('tele-leader-id') as HTMLInputElement | null)?.value || 'my_leader_arm';
    const followerId = (document.getElementById('tele-follower-id') as HTMLInputElement | null)?.value || 'my_follower_arm';
    const hasLeader = entry ? entry.has_leader : true;

    if (state) {
      const have = (hasLeader ? (leaderPort ? 1 : 0) : 0) + (followerPort ? 1 : 0);
      const need = hasLeader ? 2 : 1;
      state.textContent = `${have}/${need}`;
      state.classList.toggle('is-warn', have < need);
    }

    const missing = this.t('lbl.portMissing');
    const lines: string[] = [];
    if (hasLeader) {
      lines.push(`lerobot-calibrate --teleop.type=${leaderType} --teleop.port=${leaderPort || missing} --teleop.id=${leaderId}`);
    }
    lines.push(`lerobot-calibrate --robot.type=${followerType} --robot.port=${followerPort || missing} --robot.id=${followerId}`);
    if (hasLeader) {
      lines.push(`lerobot-teleoperate --robot.type=${followerType} --robot.port=${followerPort || missing} --teleop.type=${leaderType} --teleop.port=${leaderPort || missing}`);
    }
    el.textContent = lines.join('\n');
  },

  /** The port string an arm would really be started with — the dropdown value,
   * or the manually typed path when the dropdown is on "custom". */
  resolvedArmPort(role: 'leader' | 'follower'): string {
    const select = document.getElementById(`tele-${role}-port`) as HTMLSelectElement | null;
    const val = select ? select.value : '';
    if (val === '__custom__') {
      return (document.getElementById(`tele-${role}-port-custom`) as HTMLInputElement | null)?.value.trim() || '';
    }
    return val || '';
  },

  /** The scan result itself, not just the two dropdowns distilled out of it:
   * which physical device each port is, and which arm currently claims it. */
  renderDetectedHardware(): void {
    const portsHost = document.getElementById('conn-ports-table');
    const camsHost = document.getElementById('conn-cams-table');
    const ports = this.availablePorts || [];
    const cams = this.availableCameras || [];

    const leaderPort = this.resolvedArmPort('leader');
    const followerPort = this.resolvedArmPort('follower');
    const projectCams: any[] = this.project?.cameras || [];
    const camSources = new Set(projectCams.map(c => String(c.source)));

    const numPorts = document.getElementById('conn-num-ports');
    const numCams = document.getElementById('conn-num-cams');
    const numAssigned = document.getElementById('conn-num-assigned');
    const numCamsUsed = document.getElementById('conn-num-cams-used');
    const entry = this.deviceTypeFor(
      (document.getElementById('robot-type-select') as HTMLSelectElement | null)?.value);
    const need = (entry ? entry.has_leader : true) ? 2 : 1;
    const have = (need === 2 && leaderPort ? 1 : 0) + (followerPort ? 1 : 0);
    if (numPorts) numPorts.textContent = String(ports.length);
    if (numCams) numCams.textContent = String(cams.length);
    if (numAssigned) numAssigned.textContent = `${have}/${need}`;
    if (numCamsUsed) numCamsUsed.textContent = String(projectCams.length);
    document.getElementById('conn-stat-ports')?.classList.toggle('warn', ports.length === 0);
    document.getElementById('conn-stat-assigned')?.classList.toggle('warn', have < need);
    document.getElementById('conn-stat-cams-used')?.classList.toggle('warn', projectCams.length === 0);

    if (portsHost) {
      if (!ports.length) {
        portsHost.innerHTML = `<div class="conn-empty">${this.esc(this.t('hint.noSerialFound'))}</div>`;
      } else {
        portsHost.innerHTML = `<table class="pd-table conn-table"><thead><tr>
            <th>${this.esc(this.t('th.device'))}</th>
            <th>${this.esc(this.t('th.description'))}</th>
            <th>${this.esc(this.t('th.vidPid'))}</th>
            <th>${this.esc(this.t('th.role'))}</th>
          </tr></thead><tbody>` +
          ports.map((p: any) => {
            let role = '–';
            let roleCls = 'conn-role-free';
            if (p.device === leaderPort) { role = this.t('lbl.leaderShort'); roleCls = 'conn-role-used'; }
            else if (p.device === followerPort) { role = this.t('lbl.followerShort'); roleCls = 'conn-role-used'; }
            const vidpid = (p.vid || p.pid)
              ? `${Number(p.vid).toString(16).padStart(4, '0')}:${Number(p.pid).toString(16).padStart(4, '0')}`
              : '–';
            return `<tr title="${this.esc(this.t('tip.persistentId', { id: p.persistent_id || '–' }))}">
                <td><code>${this.esc(p.device)}</code></td>
                <td class="conn-td-desc">${this.esc(p.description || '–')}</td>
                <td><code>${this.esc(vidpid)}</code></td>
                <td><span class="${roleCls}">${this.esc(role)}</span></td>
              </tr>`;
          }).join('') + '</tbody></table>';
      }
    }

    if (camsHost) {
      if (!cams.length) {
        camsHost.innerHTML = `<div class="conn-empty">${this.esc(this.t('hint.noVideoFound'))}</div>`;
      } else {
        camsHost.innerHTML = `<table class="pd-table conn-table"><thead><tr>
            <th>${this.esc(this.t('th.index'))}</th>
            <th>${this.esc(this.t('th.model'))}</th>
            <th>${this.esc(this.t('th.role'))}</th>
          </tr></thead><tbody>` +
          cams.map((c: any) => {
            const used = camSources.has(String(c.index)) || camSources.has(String(c.device));
            return `<tr title="${this.esc(this.t('tip.persistentId', { id: c.persistent_id || '–' }))}">
                <td><code>${this.esc(String(c.index))}</code></td>
                <td class="conn-td-desc">${this.esc(c.model_name || '–')}</td>
                <td><span class="${used ? 'conn-role-used' : 'conn-role-free'}">${
                  this.esc(used ? this.t('lbl.inProject') : '–')}</span></td>
              </tr>`;
          }).join('') + '</tbody></table>';
      }
    }
  },

  /** Rescan on demand — a replugged cable changes the port numbering, and the
   * scan is slow enough (OpenCV probes indexes) to need a visible indicator. */
  async manualRescanHardware(): Promise<void> {
    const btn = document.getElementById('btn-rescan-hardware') as HTMLButtonElement | null;
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = this.t('btn.rescanning'); }
    try {
      await this.scanHardware();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old || this.t('btn.rescanHw'); }
    }
  },

  loadModelConfig(): void {
    if (!this.project?.models) return;
    const llm = this.project.models.llm_ceo || {};
    const vlm = this.project.models.vlm_inspector || {};
    
    // A project written by an older version can carry a bare family name
    // ("so100") or one the old string surgery mangled ("lekiwi_follower").
    // The catalogue resolves both to the name LeRobot registers.
    this.setRobotTypeValue(this.project.robot_type || 'so100');

    this.onRobotTypeChange();

    const settingsDs = document.getElementById('settings-dataset-storage-dir') as HTMLInputElement | null;
    const recDs = document.getElementById('rec-dataset-storage-dir') as HTMLInputElement | null;
    const val = this.project.dataset_storage_dir || '';
    if (settingsDs) settingsDs.value = val;
    if (recDs) recDs.value = val;

    const llmEp = document.getElementById('llm-endpoint') as HTMLInputElement | null;
    const vlmEp = document.getElementById('vlm-endpoint') as HTMLInputElement | null;
    const llmMod = document.getElementById('llm-model') as HTMLInputElement | null;
    const vlmMod = document.getElementById('vlm-model') as HTMLInputElement | null;
    const llmPrompt = document.getElementById('llm-prompt') as HTMLTextAreaElement | null;

    if (llmEp) llmEp.value = llm.endpoint || 'http://localhost:1234/v1';
    if (vlmEp) vlmEp.value = vlm.endpoint || 'http://localhost:1234/v1';
    if (llmMod) llmMod.value = llm.model_name || 'qwen2.5-7b-instruct';
    if (vlmMod) vlmMod.value = vlm.model_name || 'qwen2-vl-7b-instruct';
    if (llmPrompt) llmPrompt.value = llm.system_prompt || 'You are a robotic arm task planner. Decompose the user\'s instruction into an ordered array of sub-tasks. Respond with a pure JSON array of strings, no extra commentary.';

    const loopIntervalInput = document.getElementById('settings-loop-interval') as HTMLInputElement | null;
    if (loopIntervalInput) {
      const orch = this.project.orchestration || {};
      loopIntervalInput.value = orch.sequential_loop_interval ?? '5';
    }

    this.updateHardwareButtonStates();
  },

  async saveModelConfig(): Promise<void> {
    // The save button lives in the .block-actions footer of both the Connect
    // and the Models tab (one action, two entry points) — hence querySelectorAll.
    // Its label is an i18n node, so swap textContent via a saved original
    // instead of hard-coding a language.
    const saveBtns = document.querySelectorAll<HTMLButtonElement>('.btn-save-hw-config');
    saveBtns.forEach(btn => {
      btn.dataset.labelBackup = btn.textContent || '';
      btn.disabled = true;
      btn.textContent = this.t('btn.saving');
    });

    try {
      const llmEndpoint = (document.getElementById('llm-endpoint') as HTMLInputElement).value.trim();
      const vlmEndpoint = (document.getElementById('vlm-endpoint') as HTMLInputElement).value.trim();
      const llmModel = (document.getElementById('llm-model') as HTMLInputElement).value.trim();
      const vlmModel = (document.getElementById('vlm-model') as HTMLInputElement).value.trim();
      const prompt = (document.getElementById('llm-prompt') as HTMLTextAreaElement).value.trim();
      const robotType = (document.getElementById('robot-type-select') as HTMLSelectElement).value;

      this.log('INFO', 'Saving configurations...');
      await this.api('POST', '/models/llm_ceo', { endpoint: llmEndpoint, model_name: llmModel, system_prompt: prompt });
      await this.api('POST', '/models/vlm_inspector', { endpoint: vlmEndpoint, model_name: vlmModel });
      
      // Save LeRobot dir dynamically in the active project config along with robot type and ports!
      const followerPort = (document.getElementById('tele-follower-port') as HTMLSelectElement | null)?.value || '';
      const leaderPort = (document.getElementById('tele-leader-port') as HTMLSelectElement | null)?.value || '';
      const storageDir = (document.getElementById('settings-dataset-storage-dir') as HTMLInputElement | null)?.value.trim() || '';

      const loopIntervalInput = document.getElementById('settings-loop-interval') as HTMLInputElement | null;
      const loopInterval = loopIntervalInput ? parseFloat(loopIntervalInput.value) : null;

      const lerobotDirEl = document.getElementById('settings-lerobot-dir-global') as HTMLInputElement | null;
      const lerobotDir = lerobotDirEl ? lerobotDirEl.value.trim() : '';

      const pyPathEl = document.getElementById('settings-python-path') as HTMLInputElement | null;
      const pyPath = pyPathEl ? pyPathEl.value.trim() : '';

      await this.api('POST', '/settings', { 
        lerobot_dir: lerobotDir,
        python_path: pyPath,
        robot_type: robotType,
        follower_port: followerPort,
        leader_port: leaderPort,
        dataset_storage_dir: storageDir,
        sequential_loop_interval: isNaN(loopInterval as number) ? null : loopInterval
      });

      this.log('SUCCESS', 'Všechna nastavení byla úspěšně uložena do projektu!');
      await this.refreshProject();
      this.updateHardwareButtonStates();
    } catch (err: any) {
      this.log('ERROR', 'Chyba při ukládání nastavení: ' + (err.message || err));
    } finally {
      saveBtns.forEach(btn => {
        btn.disabled = false;
        btn.textContent = btn.dataset.labelBackup || this.t('btn.saveHw');
        delete btn.dataset.labelBackup;
      });
    }
  },

  /**
   * Open a native OS picker and write the chosen absolute path into `inputId`.
   *
   * The dialog is modal on the *desktop*, not in the browser tab, so the
   * request stays pending for as long as the user browses — the button is
   * disabled meanwhile, otherwise a second click stacks another dialog.
   * An empty path means "cancelled": the field keeps its previous value.
   */
  async browsePath(kind: 'file' | 'directory', inputId: string, titleKey?: string): Promise<void> {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (!input) return;
    const btn = input.parentElement
      ? (input.parentElement.querySelector('button') as HTMLButtonElement | null)
      : null;
    const prevLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = this.t('btn.browsing'); }
    try {
      this.log('INFO', this.t('log.openingFileBrowser'));
      const endpoint = kind === 'file' ? '/utils/browse_file' : '/utils/browse_directory';
      const res = await this.api('POST', endpoint, { title: titleKey ? this.t(titleKey) : '' });
      if (res && res.ok && res.path) {
        input.value = res.path;
        input.dispatchEvent(new Event('change'));   // path fields mirror elsewhere
        this.log('SUCCESS', `${this.t(kind === 'file' ? 'log.fileSelected' : 'log.folderSelected')}: ${res.path}`);
        this.saveSettingsState();
      } else if (res && res.ok) {
        this.log('INFO', this.t('log.folderCancelled'));
      } else {
        this.log('ERROR', this.t('log.folderFailed'));
      }
    } catch (err) {
      this.log('ERROR', `${this.t('log.folderFailed')}: ${err}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prevLabel || this.t('btn.browse'); }
    }
  },

  async browseDirectory(inputId: string, titleKey?: string): Promise<void> {
    await this.browsePath('directory', inputId, titleKey);
  },

  async browseFile(inputId: string, titleKey?: string): Promise<void> {
    await this.browsePath('file', inputId, titleKey);
  },

  // ── CEO Planner & NLP Orchestration ─────────────────────────────────
  async executeOrchestration(): Promise<void> {
    const inputEl = document.getElementById('orch-input') as HTMLInputElement | null;
    const input = inputEl?.value.trim() || '';
    if (!input) return;
    this.updateOrchStatus(this.t('orch.planning'), 'var(--yellow)', 'orch.planning');

    const btn = document.getElementById('btn-run-plan') as HTMLButtonElement | null;
    const label = btn?.textContent || '';
    // The CEO round trip goes through an LLM, so the answer is not immediate —
    // without this the button looks like it did nothing.
    if (btn) { btn.disabled = true; btn.textContent = this.t('btn.runPlanBusy'); }
    try {
      await this.api('POST', '/orchestrate', { instruction: input });
      if (inputEl) inputEl.value = '';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label || this.t('btn.runPlan'); }
    }
  },

  /** Loads what an orchestration run would actually execute: per task, the
   * ordered steps the plan resolver produces and the checkpoint each one gets.
   * The backend answers with the same code the run uses, so this column states
   * the run instead of guessing at it. */
  async loadOrchPreview(): Promise<void> {
    const btn = document.getElementById('btn-orch-preview-refresh') as HTMLButtonElement | null;
    const label = btn?.textContent || '';
    // Every step is a filesystem check on the server, so this is not instant
    // on a project with many steps.
    if (btn) { btn.disabled = true; btn.textContent = this.t('val.loadingShort'); }
    try {
      const data = await this.api('GET', '/orchestration/plan_preview');
      this.orchPreview = data;
      this.renderOrchPreview(data);
    } catch (err) {
      console.error('Failed to load the orchestration plan preview', err);
      this.orchPreview = null;
      this.renderOrchPreview(null);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label || this.t('btn.reload'); }
    }
  },

  renderOrchPreview(data: any): void {
    const list = document.getElementById('orch-preview-tasks');
    if (!list) return;

    const tasks: any[] = data?.tasks || [];
    const steps = tasks.flatMap(t => t.steps || []);
    const ready = steps.filter((s: any) => s.policy_ready).length;
    const orchestrated = tasks.filter(t => t.orchestrated).length;

    const setStat = (id: string, text: string, warn = false) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.classList.toggle('is-warn', warn);
    };
    setStat('orch-stat-tasks', String(tasks.length));
    setStat('orch-stat-orchestrated', `${orchestrated}/${tasks.length}`, tasks.length > 0 && orchestrated === 0);
    setStat('orch-stat-checkpoints', `${ready}/${steps.length}`, ready < steps.length);
    setStat('orch-stat-arch', (data?.policy_architecture || '–').toUpperCase());

    if (!this.project) {
      list.innerHTML = `<div class="orch-empty">${this.esc(this.t('hint.noProjectForPlan'))}</div>`;
      return;
    }
    if (!tasks.length) {
      list.innerHTML = `<div class="orch-empty">${this.esc(this.t('hint.noTasksForPlan'))}</div>`;
      return;
    }

    list.innerHTML = tasks.map(task => {
      const stepRows = (task.steps || []).map((step: any, i: number) => `
        <div class="orch-step">
          <span class="orch-step-idx">${i + 1}</span>
          <span class="orch-step-body">
            <span class="orch-step-name" title="${this.esc(step.slug)}">${this.esc(step.name)}</span>
            <span class="orch-step-path" title="${this.esc(step.policy_path)}">${
              this.esc(String(step.policy_path).split(/[\\/]/).filter(Boolean).pop() || step.policy_path)}</span>
          </span>
          <span class="orch-step-flag ${step.policy_ready ? 'ready' : 'missing'}">${
            this.esc(this.t(step.policy_ready ? 'val.ckptReady' : 'val.ckptMissing'))}</span>
        </div>`).join('');
      return `
        <div class="orch-task ${task.orchestrated ? 'is-orchestrated' : ''}">
          <div class="orch-task-head">
            <span class="orch-task-name" title="${this.esc(task.slug)}">${this.esc(task.name)}</span>
            <span class="pd-task-mode ${task.orchestrated ? 'ok' : 'baseline'}">${
              this.esc(this.t(task.orchestrated ? 'val.modeBoth' : 'val.modeBaseline'))}</span>
          </div>
          <div class="orch-steps">${stepRows}</div>
        </div>`;
    }).join('');
  },

  /** Updates the orchestration status line (#orch-status-indicator).
   * `key` must be given whenever the message is a plain translation, so a
   * language switch repaints it; a message carrying runtime values (a step
   * name, an error) drops the attribute instead of being overwritten back to
   * a stale translation on the next applyI18n(). */
  updateOrchStatus(message: string, color?: string, key?: string, params?: Record<string, string | number>): void {
    const el = document.getElementById('orch-status-indicator');
    if (!el) return;
    el.textContent = message;
    // A keyed message without params can be repainted by applyI18n() alone; one
    // carrying runtime values must not (applyI18n would drop the values), so it
    // is re-rendered from the remembered key+params instead.
    if (key && !params) el.setAttribute('data-i18n', key);
    else el.removeAttribute('data-i18n');
    this.orchStatusKey = key ? { key, params } : null;
    if (color) el.style.color = color;
  },

  /** The single writer of the task-latch banner. It reports the orchestrator's
   * TaskLatch (locked while a motor step runs, unlocked while the VLM checks
   * the scene) and nothing else — the inference daemon has its own badge, and
   * having both write this element is why the same state used to show two
   * different texts depending on which path got there last. */
  setTaskLatch(locked: boolean): void {
    const banner = document.getElementById('task-latch-card-banner');
    if (!banner) return;
    banner.className = `task-latch-banner ${locked ? 'locked' : 'unlocked'}`;
    const icon = document.getElementById('task-latch-visual-icon');
    if (icon) {
      icon.innerHTML = locked
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';
    }
    const setKeyed = (id: string, key: string) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.setAttribute('data-i18n', key);
      el.textContent = this.t(key);
    };
    setKeyed('task-latch-title-text', locked ? 'latch.lockedTitle' : 'latch.unlockedTitle');
    setKeyed('task-latch-desc-text', locked ? 'latch.lockedDesc' : 'latch.unlockedDesc');
  },

  /** Builds the step list inside #pipeline-steps from the CEO's resolved
   * plan (a flat list of task names — orchestration_plan_ready payload).
   * Called again if the orchestrator re-plans, which just re-renders from
   * the new list; execution status set separately via setPipelineStep(). */
  renderPipeline(plan: string[]): void {
    const container = document.getElementById('pipeline-steps');
    if (!container) return;
    if (!plan || !plan.length) {
      container.innerHTML = `<div class="empty-state-text" data-i18n="hint.noPlan">${this.t('hint.noPlan')}</div>`;
      return;
    }
    container.innerHTML = plan.map((task, i) => `
      <div class="pipeline-step" data-task="${this.esc(task)}">
        <span class="step-marker">${i + 1}</span>
        <span class="pipeline-step-label">${this.esc(task)}</span>
      </div>
    `).join('');
  },

  /** Marks a plan step active/done/failed as the orchestrator executes it
   * sequentially. Steps advance strictly in order, so a duplicate task name
   * in the plan resolves to whichever occurrence hasn't been touched yet —
   * 'active' claims the next untouched match, 'done'/'failed' resolves
   * against whichever step is currently active (there's only ever one). */
  setPipelineStep(taskName: string, status: 'active' | 'done' | 'failed'): void {
    const container = document.getElementById('pipeline-steps');
    if (!container) return;
    if (status === 'active') {
      const steps = Array.from(container.querySelectorAll<HTMLElement>('.pipeline-step'));
      const next = steps.find(s => s.dataset.task === taskName
        && !s.classList.contains('active') && !s.classList.contains('done') && !s.classList.contains('failed'));
      if (next) next.classList.add('active');
      return;
    }
    const active = container.querySelector<HTMLElement>('.pipeline-step.active');
    if (active) {
      active.classList.remove('active');
      active.classList.add(status);
    }
  },

  renderSkillsFull(): void {
    const skills = this.project?.skills || [];
    const details = this.project?.skills_details || {};
    
    const sideSkills = document.getElementById('skill-list-full');
    if (sideSkills) {
      if (!skills.length) {
        sideSkills.innerHTML = `
          <div class="empty-state" style="padding: 12px;">
            <div class="empty-state-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg></div>
            <div class="empty-state-text">${App.t('hint.createFirstSkill')}</div>
          </div>`;
        return;
      }

      if (!this.activeSkill || !skills.includes(this.activeSkill)) {
        this.activeSkill = skills[0];
      }

      const parentSkills = skills.filter(s => !details[s]?.parent_slug);
      let html = '';
      
      parentSkills.forEach(m => {
        const subSkills = skills.filter(s => details[s]?.parent_slug === m);
        const isCollapsed = this.collapsedFolders.has(m);
        
        // Render a premium milestone container instead of file folders!
        html += `
          <div class="skill-group-card" style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.05); padding: 6px; margin-bottom: 12px; transition: all 0.2s;">
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; border-bottom: 1px solid rgba(255,255,255,0.02); padding-bottom: 6px; margin-bottom: 4px;">
              <button class="skills-tree-folder ${isCollapsed ? 'collapsed' : ''}" data-folder="${m}" onclick="App.toggleSkillsFolder('${m}')" style="flex: 1; display: flex; align-items: center; border: none; background: none; color: var(--text-light); text-align: left; padding: 4px; gap: 8px; font-weight: 700; font-size: 13px; cursor: pointer; transition: all 0.2s;">
                <span class="chevron-icon" style="display: inline-flex; align-items: center; justify-content: center; transform: rotate(${isCollapsed ? '0deg' : '90deg'}); transition: transform 0.2s; color: var(--text-muted);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 10px; height: 10px;"><path d="M9 5l7 7-7 7"></path></svg></span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; color: var(--cyan); flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle></svg>
                <span>${details[m]?.name || m}</span>
                <span class="count-badge" style="background: rgba(0, 188, 212, 0.1); color: var(--cyan); font-size: 9px; padding: 1px 6px; font-weight: 600; margin-left: auto;">${subSkills.length}</span>
              </button>
              <div style="display: flex; align-items: center; gap: 4px;">
                <button class="btn btn-xs btn-secondary btn-icon" onclick="event.stopPropagation(); App.showEditSkillModal('${m}')" title="${App.t('tip.editSkill')}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 10px; height: 10px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="btn btn-xs btn-danger btn-icon" onclick="event.stopPropagation(); App.deleteSkill('${m}')" title="${App.t('btn.delete')}">✕</button>
                <button class="btn btn-xs btn-primary btn-icon" onclick="event.stopPropagation(); App.showNewSubSkillModal('${m}')" title="${App.t('tip.addStep')}">+</button>
              </div>
            </div>
            <ul class="skills-tree-subs ${isCollapsed ? 'collapsed' : ''}" id="folder-subs-${m}" style="list-style: none; padding-left: 14px; margin: 4px 0 4px 10px; border-left: 1.5px solid rgba(0, 188, 212, 0.15);">
        `;
 
        if (!subSkills.length) {
          html += `
            <li style="padding: 6px 12px 6px 10px; font-size:11px; color:var(--text-muted); font-style:italic;">
              ${App.t('hint.noSteps')}
            </li>
          `;
        } else {
          subSkills.forEach(s => {
            const isActive = s === this.activeSkill;
            const parentSlug = details[s]?.parent_slug || '';
            const datasetSlug = parentSlug ? `${parentSlug}/${s}` : s;
            html += `
              <li style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                <button class="skills-tree-item ${isActive ? 'active' : ''}" onclick="App.selectSkill('${s}')" style="margin: 3px 0; flex: 1; display: flex; align-items: center; gap: 8px; border: none; background: transparent; padding: 6px 10px; cursor: pointer; text-align: left; transition: all 0.2s;">
                  ${isActive ? 
                    `<span class="step-check-indicator active">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"></polyline></svg>
                     </span>` :
                    `<span class="step-check-indicator">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"></polyline></svg>
                     </span>`
                  }
                  <span>${details[s]?.name || s}</span>
                  <span class="ep-badge" id="ep-badge-${s}">...</span>
                </button>
                <div style="display: flex; align-items: center; gap: 2px;">
                  <button class="btn btn-xs btn-secondary btn-icon" onclick="event.stopPropagation(); App.showEditSkillModal('${s}')" title="${App.t('tip.editStep')}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 11px; height: 11px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                  </button>
                  <button class="btn btn-xs btn-secondary btn-icon" onclick="event.stopPropagation(); App.openManageEpisodesModal('${s}')" title="${App.t('tip.manageEpisodes')}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 12px; height: 12px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                  </button>
                  <button class="btn btn-xs btn-danger btn-icon" onclick="event.stopPropagation(); App.deleteSkill('${s}')" title="${App.t('btn.delete')}">✕</button>
                </div>
              </li>
            `;
            
            this.api('GET', `/skills/${datasetSlug}/dataset_info`)
              .then(info => {
                const badge = document.getElementById(`ep-badge-${s}`);
                if (badge) {
                  if (info.exists && info.num_episodes > 0) {
                    badge.textContent = `${info.num_episodes} ep`;
                    badge.style.background = 'var(--green-light)';
                    badge.style.color = 'var(--green)';
                  } else {
                    badge.textContent = '0 ep';
                    badge.style.background = 'rgba(255,255,255,0.03)';
                    badge.style.color = 'var(--text-muted)';
                  }
                }
              })
              .catch(err => console.error("Error loading stats for", s, err));
          });
        }
        
        html += `</ul></div>`;
      });
      sideSkills.innerHTML = html;
    }
  },

  toggleSkillsFolder(folderId: string): void {
    const subs = document.getElementById(`folder-subs-${folderId}`);
    const folderBtn = document.querySelector(`.skills-tree-folder[data-folder="${folderId}"]`);
    if (this.collapsedFolders.has(folderId)) {
      this.collapsedFolders.delete(folderId);
      if (subs) subs.classList.remove('collapsed');
      if (folderBtn) folderBtn.classList.remove('collapsed');
    } else {
      this.collapsedFolders.add(folderId);
      if (subs) subs.classList.add('collapsed');
      if (folderBtn) folderBtn.classList.add('collapsed');
    }
  },

  /** Fetches what `lerobot-train` would actually be started for.
   *
   * The page cannot answer "can this be trained?" from `project.json` alone:
   * the answer depends on what is on disk (was the dataset recorded, does a
   * checkpoint already exist), and the trainer refuses to start when the
   * dataset is missing. The endpoint resolves through the trainer's own
   * helpers, so a row this marks untrainable really would be refused. */
  async loadTrainingTargets(): Promise<void> {
    const btn = document.getElementById('btn-train-reload') as HTMLButtonElement | null;
    const label = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = this.t('btn.loading'); }
    try {
      const data = await this.api('GET', '/training/targets');
      this.trainTargets = data;
    } catch (err) {
      console.error('Failed to load the training targets', err);
      this.trainTargets = null;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label || this.t('btn.reload'); }
      this.renderTrainingSkillsTree();
    }
  },

  /** Paints both trainable branches of every task.
   *
   * `baseline` is the whole recorded dataset — plain ACT, the control arm of
   * the project's comparison — and `steps` are the sub-datasets the splitter
   * cuts out of that same recording, one policy each. Both are ordinary
   * training targets, so both are selectable; before this the page offered the
   * sub-steps only and the baseline could not be started from the UI at all. */
  renderTrainingSkillsTree(): void {
    const container = document.getElementById('train-skills-checklist-container');
    if (!container) return;

    const data = this.trainTargets;
    const tasks: any[] = data?.tasks || [];
    const all: any[] = tasks.flatMap(t => [t.baseline, ...(t.steps || [])]).filter(Boolean);

    const setStat = (id: string, text: string, warn = false) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.classList.toggle('is-warn', warn);
    };
    const recorded = all.filter(x => x.dataset_ready).length;
    const trained = all.filter(x => x.policy_ready).length;
    setStat('train-stat-tasks', String(tasks.length));
    setStat('train-stat-datasets', `${recorded}/${all.length}`, all.length > 0 && recorded < all.length);
    setStat('train-stat-ckpts', `${trained}/${all.length}`, trained < all.length);
    setStat('train-stat-arch', String(data?.policy_architecture || '–').toUpperCase());

    if (!this.project) {
      container.innerHTML = `<div class="train-empty">${this.esc(this.t('hint.noProjectForTrain'))}</div>`;
      this.updateTrainCmdPreview();
      return;
    }
    if (!tasks.length) {
      container.innerHTML = `<div class="train-empty">${this.esc(this.t('hint.noSkillsAvail'))}</div>`;
      this.updateTrainCmdPreview();
      return;
    }

    const row = (target: any, opts: { idx?: number; baseline?: boolean }): string => {
      const slug = target.slug;
      const blocked = !target.dataset_ready;
      const active = this.activeTrainingSkill === slug;
      const queued = !active && (this.trainingQueue || []).includes(slug);
      const cls = [
        'train-row',
        opts.baseline ? 'is-baseline' : '',
        target.policy_ready ? 'is-trained' : '',
        blocked ? 'is-blocked' : '',
      ].filter(Boolean).join(' ');
      // Missing dataset = lerobot-train would abort on the validation error, so
      // the row must not be selectable. The title says which repo_id is absent.
      const blockedTitle = blocked
        ? this.t('tip.trainNoDataset', { repo: target.repo_id })
        : this.t('tip.trainTarget', { repo: target.repo_id });
      const progress = (active || queued) ? `
          <div class="train-row-progress">
            <div class="progress-bar-container">
              <div class="progress-bar-fill" id="train-progress-fill-${this.esc(slug)}" style="width:0%;"></div>
            </div>
            <div class="train-row-progress-meta">
              <span id="train-progress-text-${this.esc(slug)}">${
                this.esc(this.t(active ? 'val.training' : 'val.queued'))}</span>
              <span id="train-progress-loss-${this.esc(slug)}"></span>
            </div>
          </div>` : '';
      return `
        <div class="${cls}" title="${this.esc(blockedTitle)}">
          <input type="checkbox" class="train-target-checkbox" data-skill="${this.esc(slug)}"
                 id="train-check-${this.esc(slug)}" onchange="App.setTrainTargetChecked('${this.esc(slug)}', this.checked)"
                 ${blocked ? 'disabled' : ''} ${!blocked && this.trainSelected.has(slug) ? 'checked' : ''}>
          <span class="train-row-idx">${opts.baseline ? '#' : String(opts.idx)}</span>
          <span class="train-row-body">
            <span class="train-row-name">${this.esc(target.name)}</span>
            <span class="train-row-repo" title="${this.esc(target.policy_path)}">${this.esc(target.repo_id)}</span>
          </span>
          <span class="train-row-flags">
            <span class="train-flag ${target.dataset_ready ? 'ready' : 'missing'}">${
              this.esc(this.t(target.dataset_ready ? 'val.dataOk' : 'val.dataMissing'))}</span>
            <span class="train-flag ${target.policy_ready ? 'ready' : 'missing'}">${
              this.esc(this.t(target.policy_ready ? 'val.ckptReady' : 'val.ckptMissing'))}</span>
          </span>
          ${progress}
        </div>`;
    };

    container.innerHTML = tasks.map(task => {
      const steps: any[] = task.steps || [];
      const stepRows = steps.length
        ? steps.map((s, i) => row(s, { idx: i + 1 })).join('')
        : `<div class="train-empty">${this.esc(this.t('hint.noStepsToLearn'))}</div>`;
      return `
        <div class="train-task ${task.orchestrated ? 'is-orchestrated' : ''}">
          <div class="train-task-head">
            <input type="checkbox" id="train-check-parent-${this.esc(task.slug)}"
                   onchange="App.toggleTrainParentCheckbox('${this.esc(task.slug)}', this.checked)"
                   title="${this.esc(this.t('tip.trainSelectAll'))}">
            <span class="train-task-name" title="${this.esc(task.slug)}">${this.esc(task.name)}</span>
            <span class="pd-task-mode ${task.orchestrated ? 'ok' : 'baseline'}">${
              this.esc(this.t(task.orchestrated ? 'val.modeBoth' : 'val.modeBaseline'))}</span>
          </div>
          <div class="train-group">
            <div class="train-group-title">${this.esc(this.t('grp.trainBaseline'))}</div>
            ${row(task.baseline, { baseline: true })}
          </div>
          <div class="train-group">
            <div class="train-group-title">${this.esc(this.t('grp.trainOrchestration'))}</div>
            ${stepRows}
          </div>
        </div>`;
    }).join('');

    this.updateTrainCmdPreview();
  },

  /** The ticked targets that are actually runnable right now.
   * Filtered against the current readiness, so a selection made before a
   * dataset was deleted cannot queue a run the trainer would refuse. */
  selectedTrainTargets(): any[] {
    return (this.trainTargets?.tasks || [])
      .flatMap((t: any) => [t.baseline, ...(t.steps || [])])
      .filter((x: any) => x && x.dataset_ready && this.trainSelected.has(x.slug));
  },

  /** Records a row's tick in state so a re-render keeps it. */
  setTrainTargetChecked(slug: string, checked: boolean): void {
    if (checked) this.trainSelected.add(slug);
    else this.trainSelected.delete(slug);
    this.updateTrainCmdPreview();
  },

  /** Restates the checked rows as the command that will really be spawned.
   * Kept in the config column so the run is described next to the settings
   * that shape it, and it is the only place the page names `lerobot-train`. */
  updateTrainCmdPreview(): void {
    const el = document.getElementById('train-cmd-preview-text');
    const hint = document.getElementById('train-scope-hint');
    const targets = this.selectedTrainTargets();

    if (hint) {
      hint.textContent = targets.length
        ? this.t('hint.trainScopeN', { n: targets.length })
        : this.t('hint.trainScope');
      // Carries a count, so it must not be overwritten by a bare translation
      // on the next applyI18n(); updateTrainCmdPreview() repaints it instead.
      hint.removeAttribute('data-i18n');
    }
    if (!el) return;
    if (!targets.length) { el.textContent = '–'; return; }

    const arch = String(this.trainTargets?.policy_architecture || 'act');
    const steps = (document.getElementById('train-steps') as HTMLInputElement | null)?.value || '10000';
    const batch = (document.getElementById('train-batch-size') as HTMLInputElement | null)?.value || '8';
    el.textContent = targets.map(x =>
      `lerobot-train --policy.type=${arch} --dataset.repo_id=${x.repo_id} --steps=${steps} --batch_size=${batch}`
    ).join('\n');
  },

  /** Selects/clears every trainable row of one task — the ACT baseline and all
   * of its orchestration steps. Rows whose dataset was never recorded stay
   * untouched: they are disabled because `start_training()` would refuse them,
   * and a select-all that ticks them would only queue runs that die. */
  toggleTrainParentCheckbox(parent: string, checked: boolean): void {
    const task = (this.trainTargets?.tasks || []).find((t: any) => t.slug === parent);
    if (!task) return;
    [task.baseline, ...(task.steps || [])].filter(Boolean).forEach((target: any) => {
      if (!target.dataset_ready) return;  // disabled: the trainer would refuse it
      const cb = document.getElementById(`train-check-${target.slug}`) as HTMLInputElement | null;
      if (cb) cb.checked = checked;
      this.setTrainTargetChecked(target.slug, checked);
    });
  },

  selectSkill(s: string): void {
    this.activeSkill = s;
    const details = this.project?.skills_details || {};
    const skillDetail = details[s] || {};
    const isStep = !!skillDetail.parent_slug;

    const emptyState = document.getElementById('rec-empty-state');
    const activePanel = document.getElementById('rec-active-panel');

    // Update active breadcrumbs file trail to show active selected sub-skill
    const bcFile = document.getElementById('breadcrumb-file');
    if (bcFile) {
      bcFile.textContent = s;
    }

    const skills = this.project?.skills || [];
    const hasSubSkills = skills.some(sub => details[sub]?.parent_slug === s);

    // The marking column is not gated on the recording panel — it describes the
    // selected skill, which is exactly what the empty state cannot.
    this.renderStepPlan();

    if (!isStep && !hasSubSkills) {
      // It's a top-level Dovednost with NO sub-skills! Hide active recording panel, show empty state
      if (emptyState) emptyState.style.display = 'flex';
      if (activePanel) activePanel.style.display = 'none';
      // Nothing is recordable here, so the episode list must not keep showing
      // the episodes of whichever skill was selected before.
      const listContainer = document.getElementById('rec-episodes-list-container');
      if (listContainer) {
        listContainer.innerHTML = `<div class="rec-episodes-empty">${this.esc(this.t('hint.noRecordableSkill'))}</div>`;
      }
    } else {
      // It has sub-skills or it is a sub-skill! Show active recording panel, hide empty state
      if (emptyState) emptyState.style.display = 'none';
      if (activePanel) activePanel.style.display = 'flex';

      const robots = this.project?.robots || [];
      const activeRobot = robots[0] || { id: 'my_follower_arm', type: 'so100', port: '' };
      const parentSlug = skillDetail.parent_slug || '';
      const datasetSlug = parentSlug ? `${parentSlug}/${s}` : s;
      
      // Update active sub-skill title in recording panel
      const titleEl = document.getElementById('active-sub-skill-title');
      if (titleEl) titleEl.textContent = skillDetail.name || s;
      
      // Update inputs
      const recRepoInput = document.getElementById('rec-repo-id') as HTMLInputElement | null;
      if (recRepoInput) recRepoInput.value = `local/${datasetSlug}`;
      
      const trainRepoInput = document.getElementById('train-repo-id') as HTMLInputElement | null;
      if (trainRepoInput) trainRepoInput.value = `local/${datasetSlug}`;
      
      const evalPolicyInput = document.getElementById('eval-policy-path') as HTMLInputElement | null;
      const policyType = this.project?.policy_architecture || 'diffusion';
      if (evalPolicyInput) {
        const policySlug = parentSlug ? `${parentSlug}_${s}` : s;
        evalPolicyInput.value = `outputs/training/${policySlug}_${policyType}`;
      }
      
      const evalTaskInput = document.getElementById('eval-task-name') as HTMLInputElement | null;
      if (evalTaskInput) evalTaskInput.value = `eval_${s}`;

      // Update hardware checks
      this.updateRecordingHardwareChecks();

      // Fetch LeRobot dataset info dynamically and render episodes manager list!
      this.api('GET', `/skills/${datasetSlug}/dataset_info`)
        .then(info => {
          // Update live stats row in recording panel!
          const epCountEl = document.getElementById('active-skill-episodes');
          const sizeEl = document.getElementById('active-skill-size');
          if (epCountEl) {
            epCountEl.textContent = this.t('val.nEpisodes', {n: info.num_episodes || 0});
          }
          if (sizeEl) {
            sizeEl.textContent = `${info.size_mb || '0.00'} MB`;
          }

          const listContainer = document.getElementById('rec-episodes-list-container');
          if (listContainer) {
            if (!info.exists || info.num_episodes === 0) {
              listContainer.innerHTML = `<div class="rec-episodes-empty">${
                this.esc(this.t('hint.noEpisodesIn', {repo: `local/${datasetSlug}`}))}</div>`;
            } else {
              let listHtml = '';
              for (let idx = 0; idx < info.num_episodes; idx++) {
                listHtml += `
                  <div class="rec-episode-row">
                    <span class="rec-episode-name">${this.esc(this.t('rec.episodeLbl'))} ${idx}</span>
                    <div class="rec-episode-actions">
                      <button class="btn btn-xs btn-success" onclick="App.playSpecificEpisode(${idx})" title="${this.esc(this.t('tip.replayEp'))}">${this.esc(this.t('btn.replayEp'))}</button>
                      <button class="btn btn-xs btn-danger" onclick="App.deleteSpecificEpisode(${idx})" title="${this.esc(this.t('tip.deleteEp'))}">${this.esc(this.t('btn.delete'))}</button>
                    </div>
                  </div>
                `;
              }
              listContainer.innerHTML = listHtml;
            }
          }
        })
        .catch(err => {
          console.error("Failed to load dataset info:", err);
        });

      // Fetch policy status to see if it is trained!
      this.api('GET', `/skills/${s}/policy_status`)
        .then(res => {
          const trainStatusEl = document.getElementById('active-skill-training');
          if (trainStatusEl) {
            if (res.exists) {
              trainStatusEl.textContent = this.t('val.trained');
              trainStatusEl.style.color = 'var(--green)';
            } else {
              trainStatusEl.textContent = this.t('val.notTrained');
              trainStatusEl.style.color = 'var(--yellow)';
            }
          }
        })
        .catch(() => {
          const trainStatusEl = document.getElementById('active-skill-training');
          if (trainStatusEl) {
            trainStatusEl.textContent = this.t('val.unknownState');
            trainStatusEl.style.color = 'var(--text-muted)';
          }
        });
    }
  },

  updateRecordingHardwareChecks(): void {
    const robots = this.project?.robots || [];
    const activeRobot = robots[0];
    const followerPort = activeRobot?.port || '';
    const cameras = activeRobot?.cameras || [];

    const hasPort = !!followerPort;
    const hasCameras = cameras.length > 0;

    const warnEl = document.getElementById('rec-hw-warning');
    const warnText = document.getElementById('rec-hw-warning-text');
    const btnStart = document.getElementById('btn-start-record') as HTMLButtonElement | null;

    if (!hasPort || !hasCameras) {
      if (warnEl) warnEl.style.display = 'block';
      let errorMsg = '';
      if (!hasPort && !hasCameras) {
        errorMsg = this.t('rec.errNoPortNoCams');
      } else if (!hasPort) {
        errorMsg = this.t('rec.errNoPort');
      } else {
        errorMsg = this.t('rec.errNoCams');
      }
      if (warnText) warnText.textContent = errorMsg;
      if (btnStart) btnStart.disabled = true;
    } else {
      if (warnEl) warnEl.style.display = 'none';
      if (btnStart) btnStart.disabled = false;
    }
  },

  getCurrentParentSlug(): string {
    if (!this.activeSkill) return '';
    const details = this.project?.skills_details || {};
    const skill = details[this.activeSkill];
    if (!skill) return '';
    return skill.parent_slug || this.activeSkill;
  },

  showNewSubSkillModal(parentSlug?: string): void {
    if (!this.project) {
      alert(this.t('alert.noProjectOpen'));
      return;
    }
    const parent = parentSlug || this.getCurrentParentSlug();
    if (!parent) {
      alert(this.t('alert.selectSkillFirst'));
      return;
    }
    this.showNewSkillModal(parent);
  },

  showNewSkillModal(parentSlug: string = ''): void { 
    if (!this.project) {
      alert(this.t('alert.noProjectOpen'));
      return;
    }
    this.openModal('modal-new-skill');
    
    // Reset wizard state
    this.skillWizardIsEdit = false;
    this.skillWizardEditSlug = '';
    this.skillWizardPrefilledParent = parentSlug;
    
    // Reset fields
    const nameInput = document.getElementById('new-skill-name') as HTMLInputElement | null;
    const slugInput = document.getElementById('new-skill-slug') as HTMLInputElement | null;
    const descInput = document.getElementById('new-skill-desc') as HTMLInputElement | null;
    if (nameInput) nameInput.value = '';
    if (slugInput) slugInput.value = '';
    if (descInput) descInput.value = '';

    // Populate parent dropdown
    const select = document.getElementById('new-skill-parent') as HTMLSelectElement | null;
    if (select) {
      const skills = this.project?.skills || [];
      const details = this.project?.skills_details || {};
      const parentSkills = skills.filter(s => !details[s]?.parent_slug);
      select.innerHTML = parentSkills.map(m => `<option value="${m}">${details[m]?.name || m}</option>`).join('');
    }

    const warningBox = document.getElementById('new-skill-warning-box');
    if (warningBox) warningBox.style.display = 'none';

    if (parentSlug) {
      // It's a sub-skill (step) and parent is already selected! Skip step 1 selection
      this.skillWizardType = 'step';
      if (select) select.value = parentSlug;
      this.showSkillWizardStep2();
    } else {
      // It's a clean slate creation, start at step 1
      this.skillWizardType = 'main';
      this.showSkillWizardStep1();
    }
  },

  selectSkillWizardType(type: 'main' | 'step'): void {
    this.skillWizardType = type;
    const mainCard = document.getElementById('skill-type-card-main');
    const stepCard = document.getElementById('skill-type-card-step');
    if (type === 'main') {
      mainCard?.classList.add('active');
      stepCard?.classList.remove('active');
    } else {
      mainCard?.classList.remove('active');
      stepCard?.classList.add('active');
    }
  },

  showSkillWizardStep1(): void {
    const step1El = document.getElementById('skill-wizard-step1');
    const step2El = document.getElementById('skill-wizard-step2');
    if (step1El) step1El.style.display = 'block';
    if (step2El) step2El.style.display = 'none';
    
    const titleEl = document.getElementById('modal-new-skill-title');
    if (titleEl) {
      titleEl.textContent = this.skillWizardIsEdit ? this.t('modal.editSkill') : this.t('modal.newSkill');
    }
    this.selectSkillWizardType(this.skillWizardType);
  },

  showSkillWizardStep2(): void {
    const step1El = document.getElementById('skill-wizard-step1');
    const step2El = document.getElementById('skill-wizard-step2');
    if (step1El) step1El.style.display = 'none';
    if (step2El) step2El.style.display = 'block';

    const titleEl = document.getElementById('modal-new-skill-title');
    if (titleEl) {
      if (this.skillWizardIsEdit) {
        titleEl.textContent = this.skillWizardType === 'main' ? this.t('modal.editMainSkill') : this.t('modal.editMotorStep');
      } else {
        titleEl.textContent = this.skillWizardType === 'main' ? this.t('modal.createMainSkill') : this.t('modal.createMotorStep');
      }
    }

    // Toggle parent dropdown visibility
    const parentGroup = document.getElementById('new-skill-parent-group');
    if (parentGroup) {
      parentGroup.style.display = this.skillWizardType === 'step' ? 'block' : 'none';
    }

    // Update labels and hints based on type
    const nameLabel = document.getElementById('new-skill-name-label');
    const nameInput = document.getElementById('new-skill-name') as HTMLInputElement | null;
    const descLabel = document.getElementById('new-skill-desc-label');
    const descHint = document.getElementById('new-skill-desc-hint');
    const descTextarea = document.getElementById('new-skill-desc') as HTMLTextAreaElement | null;
    const backBtn = document.getElementById('new-skill-back-btn');
    const submitBtn = document.getElementById('new-skill-submit-btn');

    // Toggle Back button visibility in edit mode or when pre-filled parent exists
    if (backBtn) {
      backBtn.style.display = (this.skillWizardIsEdit || this.skillWizardPrefilledParent) ? 'none' : 'inline-block';
    }

    if (submitBtn) {
      submitBtn.textContent = this.skillWizardIsEdit ? this.t('btn.saveChanges') : 'Vytvořit';
    }

    if (this.skillWizardType === 'main') {
      if (nameLabel) nameLabel.textContent = this.t('wiz.skillNameLabel');
      if (nameInput) nameInput.placeholder = this.t('wiz.skillNamePh');
      if (descLabel) descLabel.textContent = this.t('wiz.skillDescLabel');
      if (descHint) {
        descHint.textContent = this.t('wiz.skillDescHint');
      }
      if (descTextarea) descTextarea.placeholder = this.t('wiz.skillDescPh');
    } else {
      if (nameLabel) nameLabel.textContent = this.t('wiz.stepNameLabel');
      if (nameInput) nameInput.placeholder = this.t('wiz.stepNamePh');
      if (descLabel) descLabel.textContent = this.t('wiz.stepDescLabel');
      if (descHint) {
        descHint.textContent = this.t('wiz.stepDescHint');
      }
      if (descTextarea) descTextarea.placeholder = this.t('wiz.stepDescPh');
    }

    // Auto-slug generation binding
    if (nameInput && !this.skillWizardIsEdit) {
      nameInput.oninput = () => {
        const slugInput = document.getElementById('new-skill-slug') as HTMLInputElement | null;
        if (slugInput) {
          slugInput.value = nameInput.value
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '');
        }
      };
    } else if (nameInput) {
      nameInput.oninput = null; // Disable auto-slug when editing
    }
  },

  nextSkillWizardStep(): void {
    this.showSkillWizardStep2();
  },

  prevSkillWizardStep(): void {
    this.showSkillWizardStep1();
  },

  showEditSkillModal(slug: string): void {
    if (!this.project) {
      alert(this.t('alert.noProjectOpen'));
      return;
    }
    const details = this.project?.skills_details || {};
    const skill = details[slug];
    if (!skill) {
      alert(`Dovednost ${slug} nebyla nalezena!`);
      return;
    }

    this.openModal('modal-new-skill');

    this.skillWizardIsEdit = true;
    this.skillWizardEditSlug = slug;
    this.skillWizardPrefilledParent = '';
    this.skillWizardType = skill.parent_slug ? 'step' : 'main';

    // Prefill fields
    const nameInput = document.getElementById('new-skill-name') as HTMLInputElement | null;
    const slugInput = document.getElementById('new-skill-slug') as HTMLInputElement | null;
    const descInput = document.getElementById('new-skill-desc') as HTMLInputElement | null;
    if (nameInput) nameInput.value = skill.name || '';
    if (slugInput) slugInput.value = slug;
    if (descInput) descInput.value = skill.description || '';

    // Populate and set parent select dropdown
    const select = document.getElementById('new-skill-parent') as HTMLSelectElement | null;
    if (select) {
      const skills = this.project?.skills || [];
      const parentSkills = skills.filter(s => !details[s]?.parent_slug && s !== slug);
      select.innerHTML = parentSkills.map(m => `<option value="${m}">${details[m]?.name || m}</option>`).join('');
      select.value = skill.parent_slug || '';
    }

    // Show warning box if it is a step and already has some recorded episodes
    const warningBox = document.getElementById('new-skill-warning-box');
    if (warningBox) {
      if (skill.parent_slug) {
        warningBox.style.display = 'block';
      } else {
        warningBox.style.display = 'none';
      }
    }

    // Go directly to Step 2 details form
    this.showSkillWizardStep2();
  },

  async submitSkillWizard(): Promise<void> {
    if (!this.project) {
      alert("Žádný projekt není otevřen!");
      return;
    }
    const name = (document.getElementById('new-skill-name') as HTMLInputElement).value.trim();
    let slug = (document.getElementById('new-skill-slug') as HTMLInputElement).value.trim();
    const desc = (document.getElementById('new-skill-desc') as HTMLInputElement).value.trim();
    
    let parent_slug: string | null = null;
    if (this.skillWizardType === 'step') {
      parent_slug = (document.getElementById('new-skill-parent') as HTMLSelectElement | null)?.value || null;
      if (!parent_slug) {
        alert("Pro motorický krok musíte vybrat nadřazenou dovednost!");
        return;
      }
    }

    if (!name) {
      alert("Název nesmí být prázdný!");
      return;
    }
    if (!desc) {
      alert(this.t('alert.skillDescRequired'));
      return;
    }

    if (this.skillWizardIsEdit) {
      // EDIT MODE
      this.log('INFO', `Ukládám změny dovednosti/kroku: '${name}' (slug: ${this.skillWizardEditSlug})...`);
      try {
        const res = await this.api('PUT', `/skills/${this.skillWizardEditSlug}`, {
          name,
          slug: this.skillWizardEditSlug,
          description: desc,
          parent_slug
        });
        if (res && res.error) {
          alert(`Chyba při ukládání: ${res.error}`);
          this.log('ERROR', `Uložení selhalo: ${res.error}`);
          return;
        }
        this.closeModal('modal-new-skill');
        await this.refreshProject();
        this.log('SUCCESS', `✓ Dovednost '${name}' byla úspěšně upravena.`);
      } catch (err: any) {
        alert(`Chyba při komunikaci se serverem: ${err.message}`);
        this.log('ERROR', `Komunikační chyba: ${err.message}`);
      }
    } else {
      // CREATE MODE
      if (!slug && name) {
        slug = name.toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '');
      }
      if (!slug) {
        alert("Identifikátor se nepodařilo vygenerovat. Zadejte název platnými znaky.");
        return;
      }
      
      this.log('INFO', `Vytvářím ${this.skillWizardType === 'main' ? 'dovednost' : 'krok'}: '${name}' (slug: ${slug})...`);
      try {
        const res = await this.api('POST', '/skills', { name, slug, description: desc, parent_slug });
        if (res && res.error) {
          alert(`Chyba při vytváření: ${res.error}`);
          this.log('ERROR', `Vytvoření selhalo: ${res.error}`);
          return;
        }
        this.closeModal('modal-new-skill');
        await this.refreshProject();
        this.log('SUCCESS', `✓ ${this.skillWizardType === 'main' ? 'Dovednost' : 'Krok'} '${name}' byla úspěšně vytvořena.`);
      } catch (err: any) {
        alert(`Chyba při komunikaci se serverem: ${err.message}`);
        this.log('ERROR', `Komunikační chyba: ${err.message}`);
      }
    }
  },

  exportAllDatasets(): void {
    this.log('INFO', this.t('log.zipExport'));
    this._triggerDownload('/api/project/export_datasets');
    this.log('SUCCESS', this.t('log.zipExportStarted'));
  },

  // ── Portable bundles (project / datasets / models between machines) ──
  _triggerDownload(url: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  showExportModal(): void {
    if (!this.project) { alert(this.t('alert.openProjectFirst')); return; }
    this.openModal('modal-export-bundle');
  },

  doExportBundle(): void {
    const datasets = (document.getElementById('export-datasets') as HTMLInputElement | null)?.checked ? 1 : 0;
    const models = (document.getElementById('export-models') as HTMLInputElement | null)?.checked ? 1 : 0;
    this.closeModal('modal-export-bundle');
    this.log('INFO', this.t('log.bundleExport'));
    this._triggerDownload(`/api/project/export?datasets=${datasets}&models=${models}`);
    this.log('SUCCESS', this.t('log.bundleExportStarted'));
  },

  importProjectBundle(): void {
    (document.getElementById('import-bundle-input') as HTMLInputElement | null)?.click();
  },

  async onImportBundleFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    this.log('INFO', this.t('log.importing') + ' ' + file.name);
    try {
      const res = await fetch('/api/project/import', { method: 'POST', body: file });
      const data = await res.json();
      if (data && data.ok) {
        this.log('SUCCESS', this.t('log.importOk'));
        await this.loadProjects();
        await this.refreshProject();
      } else {
        this.log('ERROR', `${this.t('log.importFail')}: ${data?.error || res.status}`);
        alert(`${this.t('log.importFail')}: ${data?.error || res.status}`);
      }
    } catch (e) {
      this.log('ERROR', `${this.t('log.importFail')}: ${e}`);
    }
  },

  exportSkillModel(slug: string): void {
    this.log('INFO', this.t('log.modelExport') + ' ' + slug);
    this._triggerDownload(`/api/skills/${slug}/export_model`);
  },

  importSkillModel(): void {
    (document.getElementById('import-model-input') as HTMLInputElement | null)?.click();
  },

  async onImportModelFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    this.log('INFO', this.t('log.modelImporting') + ' ' + file.name);
    try {
      const res = await fetch('/api/models/import', { method: 'POST', body: file });
      const data = await res.json();
      if (data && data.ok) {
        this.log('SUCCESS', `${this.t('log.modelImportOk')}: ${(data.restored || []).join(', ')}`);
      } else {
        this.log('ERROR', `${this.t('log.modelImportFail')}: ${data?.error || res.status}`);
        alert(`${this.t('log.modelImportFail')}: ${data?.error || res.status}`);
      }
    } catch (e) {
      this.log('ERROR', `${this.t('log.modelImportFail')}: ${e}`);
    }
  },

  async deleteSkill(slug: string): Promise<void> {
    if (confirm(`Opravdu chcete smazat '${slug}' a všechna jeho nahraná data?`)) {
      try {
        const res = await this.api('DELETE', `/skills/${slug}`);
        if (res && res.error) {
          alert(`Chyba při odebírání: ${res.error}`);
          return;
        }
        if (this.activeSkill === slug) {
          this.activeSkill = null;
        }
        await this.refreshProject();
      } catch (err: any) {
        console.error("Delete failed:", err);
        alert(`Chyba při odebírání: ${err.message}`);
      }
    }
  },

  async playSpecificEpisode(idx: number, customDatasetSlug?: string): Promise<void> {
    const s = customDatasetSlug || this.activeSkill;
    if (!s) return;
    const robots = this.project?.robots || [];
    const activeRobot = robots[0] || { id: 'my_follower_arm', type: 'so100', port: '' };
    
    let datasetSlug = s;
    if (!customDatasetSlug) {
      const details = this.project?.skills_details || {};
      const skillDetail = details[s] || {};
      const parentSlug = skillDetail.parent_slug || '';
      datasetSlug = parentSlug ? `${parentSlug}/${s}` : s;
    }
    
    try {
      this.log('INFO', `Spouštím přehrávání epizody ${idx} pro dovednost local/${datasetSlug}...`);
      await this.api('POST', '/replay/start', {
        robot_type: activeRobot.type,
        dataset_name: `local/${datasetSlug}`,
        episode_index: idx,
        port: activeRobot.port
      });
    } catch (err: any) {
      this.log('ERROR', 'Chyba při spuštění přehrávání: ' + err.message);
      alert('Chyba přehrávání: ' + err.message);
    }
  },

  async deleteSpecificEpisode(idx: number, customDatasetSlug?: string, originSkill?: string): Promise<void> {
    const s = customDatasetSlug || this.activeSkill;
    if (!s) return;
    const robots = this.project?.robots || [];
    const activeRobot = robots[0] || { id: 'my_follower_arm', type: 'so100', port: '' };
    
    let datasetSlug = s;
    if (!customDatasetSlug) {
      const details = this.project?.skills_details || {};
      const skillDetail = details[s] || {};
      const parentSlug = skillDetail.parent_slug || '';
      datasetSlug = parentSlug ? `${parentSlug}/${s}` : s;
    }
    
    if (confirm(`Opravdu chcete smazat epizodu ${idx} z datasetu local/${datasetSlug}? Tato akce změní uložená Parquet data a nelze ji vzít zpět!`)) {
      try {
        this.log('INFO', `Mažu epizodu ${idx} z datasetu local/${datasetSlug}...`);
        const res = await this.api('POST', `/skills/${datasetSlug}/delete_episode`, {
          episode_index: idx
        });
        if (res && res.error) {
          alert(`Chyba: ${res.error}`);
          return;
        }
        this.log('SUCCESS', `Epizoda ${idx} byla úspěšně smazána z datasetu.`);
        
        // Refresh whichever UI view is active
        if (customDatasetSlug && originSkill) {
          // If deleted from modal, refresh the modal list!
          this.openManageEpisodesModal(originSkill);
          // And refresh the tree stats!
          this.renderSkillsFull();
        } else {
          // Normal flow
          this.selectSkill(s);
        }
      } catch (err: any) {
        this.log('ERROR', 'Smazání epizody selhalo: ' + err.message);
        alert('Chyba odebírání: ' + err.message);
      }
    }
  },

  async openManageEpisodesModal(skillSlug: string): Promise<void> {
    const details = this.project?.skills_details || {};
    const detail = details[skillSlug];
    const parentSlug = detail?.parent_slug || '';
    const datasetSlug = parentSlug ? `${parentSlug}/${skillSlug}` : skillSlug;
    
    // Set modal title & display slug
    const titleEl = document.getElementById('manage-episodes-title');
    if (titleEl) titleEl.textContent = `Správa epizod: ${detail?.name || skillSlug}`;
    
    const pathEl = document.getElementById('manage-episodes-path');
    if (pathEl) pathEl.textContent = `local/${datasetSlug}`;

    const sizeEl = document.getElementById('manage-episodes-size');
    if (sizeEl) sizeEl.textContent = 'Načítám...';

    const listContainer = document.getElementById('manage-episodes-list');
    if (listContainer) listContainer.innerHTML = '<div style="text-align:center; padding:20px; font-size:12px; color:var(--text-muted);">Načítám epizody z disku...</div>';

    this.openModal('modal-manage-episodes');

    try {
      const info = await this.api('GET', `/skills/${datasetSlug}/dataset_info`);
      if (sizeEl) sizeEl.textContent = `${info.size_mb || '0.00'} MB`;

      if (listContainer) {
        if (!info.exists || info.num_episodes === 0) {
          listContainer.innerHTML = `<div style="font-size:12px; color:var(--text-muted); font-style:italic; text-align:center; padding: 24px 0;">Žádné epizody nenahrány v local/${datasetSlug}.</div>`;
        } else {
          let listHtml = '';
          for (let idx = 0; idx < info.num_episodes; idx++) {
            listHtml += `
              <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); padding: 8px 12px; font-size: 12px; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.04)';" onmouseout="this.style.background='rgba(255,255,255,0.02)';">
                <span style="font-weight:700; color:var(--text-light);">Epizoda #${idx}</span>
                <div style="display:flex; gap:6px;">
                  <button class="btn btn-xs btn-success" onclick="App.playSpecificEpisode(${idx}, '${datasetSlug}')" style="padding: 4px 10px; font-size:11px;">Přehrát</button>
                  <button class="btn btn-xs btn-danger" onclick="App.deleteSpecificEpisode(${idx}, '${datasetSlug}', '${skillSlug}')" style="padding: 4px 10px; font-size:11px;">Smazat</button>
                </div>
              </div>
            `;
          }
          listContainer.innerHTML = listHtml;
        }
      }
    } catch (err: any) {
      if (listContainer) listContainer.innerHTML = `<div style="color:var(--red); text-align:center; padding:20px; font-size:12px;">Chyba při načítání: ${err.message}</div>`;
      console.error(err);
    }
  },

  /** Writes the training status line.
   *
   * `key` must be given whenever the message is a translation, so a language
   * switch can repaint it — the element carries runtime values (a step number,
   * a loss, an error), so it cannot be left to applyI18n() via a static
   * data-i18n attribute: that would overwrite the values with a bare
   * translation. Same remedy the orchestration status line uses. */
  updateTrainingStatus(text: string, color?: string,
                       key?: string, params?: Record<string, string | number>): void {
    const el = document.getElementById('training-status-indicator');
    if (!el) return;
    el.textContent = text;
    el.style.color = color || 'var(--text-muted)';
    this.trainStatusKey = key ? { key, params, color } : null;
  },

  updateTrainingProgress(step: number, loss: number, skill_slug?: string): void {
    const activeSkill = skill_slug || this.activeTrainingSkill || this.activeSkill;
    this.updateTrainingStatus(
      this.t('status.trainStepLoss', { step, loss: loss.toFixed(5) }), 'var(--yellow)',
      'status.trainStepLoss', { step, loss: loss.toFixed(5) });

    const totalSteps = this._trainTotalSteps
      || parseInt((document.getElementById('train-steps') as HTMLInputElement | null)?.value || '10000', 10)
      || 10000;
    const percent = Math.min(100, Math.round((step / totalSteps) * 100));
    this.setProgressPercent(percent);

    // The progress row exists exactly while the target is running or queued —
    // it is rendered from that state, not toggled by a display style, so a
    // re-render (language switch, refreshed readiness) cannot lose it.
    if (activeSkill) {
      const fill = document.getElementById(`train-progress-fill-${activeSkill}`);
      if (fill) fill.style.width = `${percent}%`;
      const txt = document.getElementById(`train-progress-text-${activeSkill}`);
      if (txt) txt.textContent = this.t('val.stepOfTotal', { step, total: totalSteps });
      const lossEl = document.getElementById(`train-progress-loss-${activeSkill}`);
      if (lossEl) lossEl.textContent = `Loss: ${loss.toFixed(4)}`;
    }
  },

  setProgressPercent(percent: number): void {
    const bar = document.getElementById('training-progress-bar');
    if (bar) {
      bar.style.width = `${Math.min(percent, 100)}%`;
    }
  },

  // ── Canvas-Based Loss Chart ─────────────────────────────────────────
  addLossPoint(epoch: number, loss: number): void {
    this.lossData.push({ epoch, loss });
    if (this.lossData.length > 300) this.lossData.shift();
    this.drawLossChart();
  },

  drawLossChart(): void {
    const canvas = document.getElementById('loss-chart') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.parentElement!.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const data = this.lossData;
    if (data.length < 2) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'var(--text-muted)';
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Live metrics chart will plot loss automatically...', canvas.width / 2, canvas.height / 2);
      return;
    }

    const pad = { l: 40, r: 10, t: 10, b: 15 };
    const w = canvas.width - pad.l - pad.r;
    const h = canvas.height - pad.t - pad.b;

    const maxLoss = Math.max(...data.map(d => d.loss)) * 1.1;
    const minLoss = Math.min(0, Math.min(...data.map(d => d.loss)));

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#252526';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + (h / 3) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      
      ctx.fillStyle = 'var(--text-muted)';
      ctx.font = '9px "JetBrains Mono"';
      ctx.textAlign = 'right';
      ctx.fillText((maxLoss - (maxLoss - minLoss) * i / 3).toFixed(4), pad.l - 6, y + 3);
    }

    const grad = ctx.createLinearGradient(pad.l, 0, pad.l + w, 0);
    grad.addColorStop(0, 'var(--green)');
    grad.addColorStop(1, 'var(--accent)');
    
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = pad.l + (i / (data.length - 1)) * w;
      const y = pad.t + h - ((d.loss - minLoss) / (maxLoss - minLoss)) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    const areaGrad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    areaGrad.addColorStop(0, 'rgba(88, 101, 242, 0.12)');
    areaGrad.addColorStop(1, 'rgba(88, 101, 242, 0)');
    ctx.lineTo(pad.l + w, pad.t + h);
    ctx.lineTo(pad.l, pad.t + h);
    ctx.closePath();
    ctx.fillStyle = areaGrad;
    ctx.fill();
  },

  // ── Terminal Console Manager ────────────────────────────────────────
  bindConsoleInput(): void {
    const input = document.getElementById('console-input') as HTMLInputElement | null;
    if (input) {
      input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          const cmd = input.value.trim();
          if (!cmd) return;
          this.logRaw(`❯ ${cmd}`, 'cmd');
          this.api('POST', '/terminal', { command: cmd });
          input.value = '';
        }
      });
    }
  },

  log(level: string, message: string): void {
    const cls = { INFO: 'info', SUCCESS: 'success', WARN: 'warn', ERROR: 'error' }[level] || 'stdout';
    const prefix = { INFO: 'ℹ', SUCCESS: '✓', WARN: '⚠', ERROR: '✕' }[level] || '';
    this.appendConsole(`${prefix} ${message}`, cls);
  },

  logRaw(text: string, cls?: string): void {
    this.appendConsole(text, cls || 'stdout');
  },

  appendConsole(text: string, cls?: string): void {
    const output = document.getElementById('console-output');
    if (!output) return;
    const line = document.createElement('div');
    line.className = `t-line ${cls || ''}`;
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
    
    this._consoleLines++;
    const countEl = document.getElementById('console-count');
    if (countEl) countEl.textContent = `(${this._consoleLines} lines)`;
  },

  // ── Terminal UI Controls & Resizing ─────────────────────────────────
  bindResizers(): void {
    const termHandle = document.getElementById('terminal-drag-handle');
    const termArea = document.getElementById('bottom-dock-container') || document.getElementById('terminal-area');
    
    if (termHandle && termArea) {
      let isResizing = false;
      let startY = 0;
      let startHeight = 0;
 
      termHandle.addEventListener('mousedown', (e: MouseEvent) => {
        isResizing = true;
        termArea.style.transition = 'none'; // Disable transition completely during active dragging
        document.body.classList.add('resizing');
        startY = e.clientY;
        startHeight = termArea.getBoundingClientRect().height;
        document.body.style.cursor = 'ns-resize';
      });
 
      document.addEventListener('mousemove', (e: MouseEvent) => {
        if (!isResizing) return;
        const delta = startY - e.clientY;
        let newHeight = startHeight + delta;
        if (newHeight < 40) newHeight = 40;
        if (newHeight > window.innerHeight * 0.8) newHeight = window.innerHeight * 0.8;
        termArea.style.height = newHeight + 'px';
      });
 
      document.addEventListener('mouseup', () => {
        if (isResizing) {
          isResizing = false;
          document.body.classList.remove('resizing');
          document.body.style.cursor = 'default';
          setTimeout(() => this.drawLossChart(), 100);
        }
      });
    }

    // Load cameras dock width and open/close state from localStorage
    this.lastCamerasWidth = localStorage.getItem('orchiday_last_cameras_width') || '520px';
    const isOpen = localStorage.getItem('orchiday_cameras_dock_open') !== 'false';
    const dock = document.getElementById('docked-cameras-area');
    const camerasHandle = document.getElementById('cameras-drag-handle');
    
    if (dock) {
      if (isOpen) {
        dock.style.width = this.lastCamerasWidth;
        dock.style.opacity = '1';
        dock.style.borderLeft = '1px solid var(--border)';
        if (camerasHandle) camerasHandle.style.display = 'block';
      } else {
        dock.style.width = '0px';
        dock.style.opacity = '0';
        dock.style.borderLeft = 'none';
        if (camerasHandle) camerasHandle.style.display = 'none';
      }
    }

    if (camerasHandle && dock) {
      let isResizing = false;
      let startX = 0;
      let startWidth = 0;

      camerasHandle.addEventListener('mousedown', (e: MouseEvent) => {
        isResizing = true;
        dock.style.transition = 'none'; // Disable transition completely during active dragging
        document.body.classList.add('resizing');
        startX = e.clientX;
        startWidth = dock.getBoundingClientRect().width;
        document.body.style.cursor = 'ew-resize';
        e.preventDefault(); // Prevent text selection
      });

      document.addEventListener('mousemove', (e: MouseEvent) => {
        if (!isResizing) return;
        const deltaX = startX - e.clientX; // Moving left increases right panel width
        let newWidth = startWidth + deltaX;
        
        // Limits: min 150px, max window.innerWidth - 100px
        if (newWidth < 150) newWidth = 150;
        const maxWidth = window.innerWidth - 100;
        if (newWidth > maxWidth) newWidth = maxWidth;

        dock.style.width = newWidth + 'px';
        this.lastCamerasWidth = newWidth + 'px';
        localStorage.setItem('orchiday_last_cameras_width', this.lastCamerasWidth);
      });

      document.addEventListener('mouseup', () => {
        if (isResizing) {
          isResizing = false;
          dock.style.transition = ''; // Restore transition
          document.body.classList.remove('resizing');
          document.body.style.cursor = 'default';
        }
      });
    }
  },
 
  toggleTerminal(): void {
    const term = document.getElementById('bottom-dock-container') || document.getElementById('terminal-area');
    if (!term) return;
    term.style.transition = 'height 0.15s ease-out'; // Smooth anim only when toggling via button
    // An empty inline height means the dock is still at its CSS height (26vh),
    // i.e. OPEN. Treating that as collapsed made the very first click grow the
    // dock to 38vh instead of giving the workspace its space back.
    if (term.style.height === '40px') {
      term.style.height = '38vh';
    } else {
      term.style.height = '40px';
    }
    setTimeout(() => this.drawLossChart(), 300);
  },

  toggleCamerasDock(): void {
    const dock = document.getElementById('docked-cameras-area');
    const handle = document.getElementById('cameras-drag-handle');
    if (!dock) return;
    
    dock.style.transition = 'width 0.2s ease, opacity 0.2s ease';
    
    if (dock.style.width === '0px' || dock.style.width === '') {
      const targetWidth = this.lastCamerasWidth || '520px';
      dock.style.width = targetWidth;
      dock.style.opacity = '1';
      dock.style.borderLeft = '1px solid var(--border)';
      if (handle) handle.style.display = 'block';
      localStorage.setItem('orchiday_cameras_dock_open', 'true');
      this.startAllProjectCameras();
    } else {
      if (dock.style.width && dock.style.width !== '0px') {
        this.lastCamerasWidth = dock.style.width;
        localStorage.setItem('orchiday_last_cameras_width', this.lastCamerasWidth);
      }
      dock.style.width = '0px';
      dock.style.opacity = '0';
      dock.style.borderLeft = 'none';
      if (handle) handle.style.display = 'none';
      localStorage.setItem('orchiday_cameras_dock_open', 'false');
    }
  },

  clearTerminal(): void {
    const output = document.getElementById('console-output');
    if (output) output.innerHTML = '';
    this._consoleLines = 0;
    const countEl = document.getElementById('console-count');
    if (countEl) countEl.textContent = `(0 lines)`;
  },

  // ── Emergency Stop ──────────────────────────────────────────────────
  async emergencyStop(): Promise<void> {
    this.log('WARN', 'EMERGENCY STOP requested! Killing all LeRobot actions.');
    await this.api('POST', '/emergency-stop');
  },

  // ── Modal Helper API ────────────────────────────────────────────────
  // Stack of open modal ids (supports nested modals) + the element to refocus
  // when each was opened, so closing restores focus to the right trigger.
  _modalStack: [] as string[],
  _modalReturnFocus: {} as Record<string, HTMLElement | null>,
  _modalsBound: false,

  _focusableSelector:
    'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',

  /** Bind the shared modal listeners once (backdrop click, focus trap). */
  bindModals(): void {
    if (this._modalsBound) return;
    this._modalsBound = true;

    // Backdrop click: close when the click lands on the overlay itself (not its
    // content) and the dialog is not marked [data-static] (multi-step flows).
    document.addEventListener('mousedown', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('modal-overlay')) return;
      if (!target.classList.contains('open')) return;
      if (target.hasAttribute('data-static')) return;
      this.closeModal(target.id);
    });

    // Focus trap: keep Tab focus inside the topmost open modal.
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || this._modalStack.length === 0) return;
      const top = document.getElementById(this._modalStack[this._modalStack.length - 1]);
      if (!top) return;
      const items = [...top.querySelectorAll<HTMLElement>(this._focusableSelector)]
        .filter(el => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement;
      if (e.shiftKey && (active === first || !top.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    });
  },

  openModal(id: string): void {
    const el = document.getElementById(id);
    if (!el) return;
    this.bindModals();
    this._modalReturnFocus[id] = document.activeElement as HTMLElement | null;
    el.classList.add('open');
    if (!this._modalStack.includes(id)) this._modalStack.push(id);
    // Lock background scroll while any modal is open
    document.body.classList.add('modal-open');
    // Move keyboard focus into the dialog for screen readers / keyboard users
    const focusable = el.querySelector<HTMLElement>(
      'input:not([type=hidden]):not([readonly]):not([disabled]), select, textarea, button:not(.modal-close-btn)'
    );
    setTimeout(() => (focusable || el).focus(), 30);
  },

  closeModal(id: string): void {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
    this._modalStack = this._modalStack.filter(m => m !== id);
    if (this._modalStack.length === 0) document.body.classList.remove('modal-open');
    const ret = this._modalReturnFocus[id];
    if (ret && typeof ret.focus === 'function') ret.focus();
    delete this._modalReturnFocus[id];
  },

  closeTopModal(): boolean {
    if (this._modalStack.length) {
      this.closeModal(this._modalStack[this._modalStack.length - 1]);
      return true;
    }
    // Fallback: any open overlay not tracked in the stack
    const open = document.querySelectorAll('.modal-overlay.open');
    if (open.length === 0) return false;
    this.closeModal((open[open.length - 1] as HTMLElement).id);
    return true;
  },
  openSettings(): void { this.openModal('modal-settings'); },

  bindAutoSlug(): void {
    const pairs = [
      ['new-project-name', 'new-project-slug'],
      ['new-skill-name', 'new-skill-slug'],
    ];
    pairs.forEach(([nameId, slugId]) => {
      const nameEl = document.getElementById(nameId) as HTMLInputElement | null;
      const slugEl = document.getElementById(slugId) as HTMLInputElement | null;
      if (nameEl && slugEl) {
        nameEl.addEventListener('input', () => {
          slugEl.value = nameEl.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        });
      }
    });
  },

  taggingSubSkills(): string[] {
    const s = this.activeSkill;
    if (!s) return [];
    const skills = this.project?.skills || [];
    const details = this.project?.skills_details || {};
    return skills.filter(sub => details[sub]?.parent_slug === s);
  },

  /**
   * The marking column, rendered from the selected skill alone. It answers the
   * question the whole project exists for — can this recording feed the
   * orchestration branch, or only the ACT baseline — and it has to answer it
   * BEFORE the take, which is why it does not wait for a recording to start.
   */
  renderStepPlan(): void {
    const verdictEl = document.getElementById('rec-step-verdict');
    const stepsContainer = document.getElementById('rec-tagging-steps');
    if (!verdictEl || !stepsContainer) return;

    const s = this.activeSkill;
    if (!s) {
      verdictEl.innerHTML = '';
      stepsContainer.innerHTML =
        `<div class="tagging-empty">${this.esc(this.t('hint.pickSkillForPlan'))}</div>`;
      return;
    }

    const subSkills = this.taggingSubSkills();
    // Two or more ordered sub-steps means at least one boundary, so the
    // recording can be cut into sub-datasets — same rule the splitter uses.
    const splittable = subSkills.length >= 2;
    // A sub-step selected on its own is a perfectly good ACT baseline take; a
    // top-level task with no sub-steps cannot be recorded at all. Both have
    // zero boundaries, so the count alone must not decide the wording.
    const isStep = !!this.project?.skills_details?.[s]?.parent_slug;
    const textKey = splittable ? 'hint.verdictBoth'
      : subSkills.length === 1 ? 'hint.verdictOneStep'
      : isStep ? 'hint.verdictLeafStep' : 'hint.verdictNoSteps';
    verdictEl.innerHTML = `
      <span class="pd-task-mode ${splittable ? 'ok' : 'baseline'}">${
        this.esc(this.t(splittable ? 'val.modeBoth' : 'val.modeBaseline'))}</span>
      <span class="rec-verdict-text">${this.esc(this.t(
        textKey, {n: subSkills.length, marks: Math.max(0, subSkills.length - 1)}))}</span>`;

    this.renderTaggingSteps(subSkills);
    // Selecting another skill changes why the mark control is unavailable, so
    // its label has to be recomputed here and not only on a phase change.
    this.setTaggingNextEnabled(
      this.taggingPhase === 'record' && splittable
      && this.taggingActiveIndex < subSkills.length - 1);
  },

  initTaggingWizard(): void {
    const s = this.activeSkill;
    if (!s) return;
    const subSkills = this.taggingSubSkills();

    const stepsContainer = document.getElementById('rec-tagging-steps');

    if (subSkills.length > 0 && stepsContainer) {
      // Marks are timestamped INSIDE the recording process, from the frames
      // already written to the episode — this local timer is display-only.
      this.taggingStartTime = Date.now();
      this.taggingActiveIndex = 0;
      this.taggingPoints = [];
      this.taggingEpisode = -1;
      this.taggingPhase = 'idle';
      this.onRecordingPhase('idle');

      this.renderTaggingSteps(subSkills);

      const timerEl = document.getElementById('rec-tagging-timer');
      const epEl = document.getElementById('rec-tagging-episode');
      const pointsEl = document.getElementById('rec-tagging-points');
      if (timerEl) timerEl.textContent = '0.0s';
      if (epEl) epEl.textContent = '–';
      if (pointsEl) pointsEl.textContent = '0';

      if (this.taggingInterval) {
        clearInterval(this.taggingInterval);
      }

      this.taggingInterval = setInterval(() => {
        const elapsedSecs = ((Date.now() - this.taggingStartTime) / 1000).toFixed(1);
        const tEl = document.getElementById('rec-tagging-timer');
        if (tEl) tEl.textContent = `${elapsedSecs}s`;
      }, 100);

      this.log('SUCCESS', this.t('log.taggingStarted', {s, n: subSkills.length}));
    }
  },

  setTaggingNextEnabled(enabled: boolean): void {
    const btnNext = document.getElementById('btn-tagging-next') as HTMLButtonElement | null;
    const btnUndo = document.getElementById('btn-tagging-undo') as HTMLButtonElement | null;
    if (btnUndo) btnUndo.disabled = this.taggingPoints.length === 0;
    if (!btnNext) return;
    btnNext.disabled = !enabled;
    const label = btnNext.querySelector('span');
    if (!label) return;
    // The disabled state has three different causes — say which one it is.
    const nSteps = this.taggingSubSkills().length;
    const allMarked = nSteps >= 2 && this.taggingActiveIndex >= nSteps - 1;
    label.textContent = enabled ? this.t('rec.markPhaseEnd')
      : nSteps < 2 ? this.t('rec.markNoBoundary')
      : allMarked ? this.t('rec.allPhasesMarked') : this.t('rec.markUnavailable');
  },

  onRecordingEpisodeStarted(episode: number): void {
    // A new episode began — step marking restarts from phase 0. lerobot reuses
    // the index of a re-recorded episode, so this also covers a retried take.
    if (this.taggingSubSkills().length === 0) return;
    this.taggingEpisode = episode;
    this.taggingActiveIndex = 0;
    this.taggingPoints = [];
    this.taggingStartTime = Date.now();
    const epEl = document.getElementById('rec-tagging-episode');
    if (epEl) epEl.textContent = String(episode);
    const pointsEl = document.getElementById('rec-tagging-points');
    if (pointsEl) pointsEl.textContent = '0';
    this.renderTaggingSteps(this.taggingSubSkills());
    this.onRecordingPhase('record');
  },

  renderTaggingSteps(subSkills: string[]): void {
    const stepsContainer = document.getElementById('rec-tagging-steps');
    if (!stepsContainer) return;

    const details = this.project?.skills_details || {};

    if (!subSkills.length) {
      stepsContainer.innerHTML =
        `<div class="tagging-empty">${this.esc(this.t('hint.noStepsToMark'))}</div>`;
      return;
    }

    // Outside a take there is no "current" phase yet, so no row may claim to be
    // active — the list is then a plan, not a progress indicator.
    const live = this.taggingPhase === 'record' || this.taggingPoints.length > 0;

    stepsContainer.innerHTML = subSkills.map((sub, idx) => {
      const isCompleted = live && idx < this.taggingActiveIndex;
      const isActive = live && idx === this.taggingActiveIndex;
      const rowCls = isCompleted ? 'is-done' : isActive ? 'is-active' : 'is-waiting';
      const stateLabel = isCompleted ? this.t('tag.done')
        : isActive ? this.t('tag.active') : this.t('tag.waiting');
      // Boundary marks sit BETWEEN steps, so the last step never gets one.
      const boundary = isCompleted && idx < this.taggingPoints.length
        ? `<span class="tagging-step-t">${this.taggingPoints[idx].toFixed(2)}s</span>` : '';

      return `
        <div class="tagging-step ${rowCls}">
          <span class="tagging-step-idx">${idx + 1}</span>
          <span class="tagging-step-name">${this.esc(details[sub]?.name || sub)}</span>
          ${boundary}
          <span class="tag tag-${rowCls.replace('is-', '')}">${stateLabel}</span>
        </div>
      `;
    }).join('');
  },

  /**
   * Request a boundary mark. The request only queues it: the recording process
   * timestamps the mark against the frames already written to the episode
   * (LeRobot stores frame timestamps as frame_index / fps), and the finished
   * mark comes back over the WebSocket as `step_marked` — which is also how a
   * mark made by any other client shows up here. onStepMarked() owns the state.
   */
  async taggingNextStep(): Promise<void> {
    const s = this.activeSkill;
    if (!s) return;
    const subSkills = this.taggingSubSkills();

    if (this.taggingActiveIndex >= subSkills.length - 1) {
      this.log('WARN', this.t('log.allPhasesMarked'));
      return;
    }
    if (this.taggingPhase !== 'record') {
      this.log('WARN', this.t('log.markNotRecording'));
      return;
    }

    const res = await this.api('POST', '/recording/mark_step', {
      skill_slug: s,
      label: subSkills[this.taggingActiveIndex],
    });
    if (!res || res.ok === false) {
      this.log('WARN', this.t('log.markFail', {e: res?.error || '?'}));
    }
  },

  async taggingUndoStep(): Promise<void> {
    const s = this.activeSkill;
    if (!s || this.taggingActiveIndex === 0) return;
    const res = await this.api('POST', '/recording/undo_mark', { skill_slug: s });
    if (!res || res.ok === false) {
      this.log('WARN', this.t('log.undoFail', {e: res?.error || '?'}));
    }
  },

  /** Confirmed mark (or undo) reported by the recording process. */
  onStepMarked(data: any): void {
    if (!data) return;
    if (data.skill && this.activeSkill && data.skill !== this.activeSkill) return;
    const subSkills = this.taggingSubSkills();
    if (subSkills.length === 0) return;

    if (data.undone) {
      this.taggingPoints.pop();
      this.taggingActiveIndex = Math.max(0, this.taggingActiveIndex - 1);
      this.log('INFO', this.t('log.markUndone'));
    } else {
      this.taggingPoints.push(Number(data.t) || 0);
      // `step` is the boundary number counted by the backend — it is the single
      // source of truth, so keyboard, button and remote marks cannot diverge.
      const step = Number(data.step) || this.taggingPoints.length;
      this.taggingActiveIndex = Math.min(Math.max(step, 0), subSkills.length - 1);
      this.log('SUCCESS', this.t('log.markSaved', {
        s: subSkills[Math.max(0, this.taggingActiveIndex - 1)],
        t: (Number(data.t) || 0).toFixed(2),
        next: subSkills[this.taggingActiveIndex] || '—',
      }));
    }

    const pointsEl = document.getElementById('rec-tagging-points');
    if (pointsEl) pointsEl.textContent = String(this.taggingPoints.length);
    const epEl = document.getElementById('rec-tagging-episode');
    if (epEl && typeof data.episode === 'number') epEl.textContent = String(data.episode);
    this.renderTaggingSteps(subSkills);
    this.setTaggingNextEnabled(
      this.taggingPhase === 'record' && this.taggingActiveIndex < subSkills.length - 1);
  },

  /**
   * lerobot's record loop alternates between capturing an episode and an
   * unrecorded "reset the environment" pause. Marks only mean something during
   * the capture phase, so the control reflects that instead of failing silently.
   */
  onRecordingPhase(phase: string): void {
    this.taggingPhase = phase;
    const subSkills = this.taggingSubSkills();
    const status = document.getElementById('rec-tagging-phase');
    if (status) {
      const key = phase === 'record' ? 'rec.phaseRecording'
        : phase === 'reset' ? 'rec.phaseReset' : 'rec.phaseIdle';
      // Keep data-i18n in sync so switching language re-renders the CURRENT
      // phase rather than resetting the badge to its initial one.
      status.setAttribute('data-i18n', key);
      status.textContent = this.t(key);
      status.className = 'tag ' + (phase === 'record' ? 'tag-live' : 'tag-idle');
    }
    // Same rail the calibration run uses: capture is step 2, the unrecorded
    // reset pause step 3, and neither is running when the process is idle.
    this.setPhase('rec-rail', phase === 'record' ? 2 : phase === 'reset' ? 3 : 0, {
      title: phase === 'record' ? 'rec.now.record.title'
        : phase === 'reset' ? 'rec.now.reset.title' : 'rec.now.idle.title',
      text: phase === 'record' ? 'rec.now.record.text'
        : phase === 'reset' ? 'rec.now.reset.text' : 'rec.now.idle.text',
      titleEl: 'rec-now-title',
      textEl: 'rec-now-text',
    });
    // The phase decides whether the step list is a plan or a progress
    // indicator, so it has to be repainted with it.
    this.renderTaggingSteps(subSkills);
    this.setTaggingNextEnabled(
      phase === 'record' && subSkills.length > 0
      && this.taggingActiveIndex < subSkills.length - 1);
  },

  /** lerobot re-recorded the episode (rerecord_episode) — its marks are gone. */
  onRecordingEpisodeDiscarded(episode: number): void {
    if (this.taggingSubSkills().length === 0) return;
    this.log('WARN', this.t('log.episodeDiscarded', {n: episode}));
    this.taggingActiveIndex = 0;
    this.taggingPoints = [];
    const pointsEl = document.getElementById('rec-tagging-points');
    if (pointsEl) pointsEl.textContent = '0';
    this.renderTaggingSteps(this.taggingSubSkills());
  },

  async finishTaggingPostProcess(): Promise<void> {
    // Marks are persisted next to the dataset as they are made — nothing to
    // post-process here, just close the wizard UI.
    if (this.taggingInterval) {
      clearInterval(this.taggingInterval);
      this.taggingInterval = null;
    }
    this.taggingPhase = 'idle';
    this.taggingPoints = [];
    this.taggingActiveIndex = 0;
    const pointsEl = document.getElementById('rec-tagging-points');
    if (pointsEl) pointsEl.textContent = '0';
    const epEl = document.getElementById('rec-tagging-episode');
    if (epEl) epEl.textContent = '–';
    this.onRecordingPhase('idle');

    const s = this.activeSkill;
    if (s && this.taggingSubSkills().length > 0) {
      this.log('INFO', this.t('log.marksPersisted'));
    }
    // Re-reads the episode count and repaints the plan back to its idle state.
    if (s) this.selectSkill(s);
  },

  /** Shows or hides everything that only makes sense while a daemon holds the
   * robot. One switch for the panel and the idle hint, because they are two
   * halves of the same state and drifting apart means the column claims both
   * "no daemon" and "here is its telemetry". */
  setInferencePanelVisible(visible: boolean): void {
    const panel = document.getElementById('infer-persistent-panel');
    if (panel) panel.classList.toggle('is-visible', visible);
    const hint = document.getElementById('infer-idle-hint');
    if (hint) hint.style.display = visible ? 'none' : '';
  },

  initPersistentInferenceUI(): void {
    const s = this.activeSkill;
    if (!s) return;
    const skills = this.project?.skills || [];
    const details = this.project?.skills_details || {};
    const subSkills = skills.filter(sub => details[sub]?.parent_slug === s);

    this.setInferencePanelVisible(true);
    this.updateInferenceDaemonStatus('WAITING');

    const settleEl = document.getElementById('infer-settle-frames');
    const loadEl = document.getElementById('infer-gripper-load');
    const deltaEl = document.getElementById('infer-max-delta');
    if (settleEl) settleEl.textContent = '0/5';
    if (loadEl) loadEl.textContent = '0.0 mA';
    if (deltaEl) deltaEl.textContent = '0.0000 rad';

    this.inferenceActiveSubSkill = '';
    this.inferenceDoneSubSkills = [];
    this.renderInferenceSubtasks(subSkills);
  },

  /** The queue of sub-steps the deployed daemon can be told to run. Rebuilt
   * from state (not from the DOM) so a language switch keeps the running row
   * marked instead of resetting every button to "Run". */
  renderInferenceSubtasks(subSkills: string[]): void {
    this.inferenceSubSkills = subSkills;
    const container = document.getElementById('infer-subtasks-container');
    if (!container) return;

    if (!subSkills.length) {
      container.innerHTML = `<div class="orch-empty">${this.esc(this.t('hint.noSubSkills'))}</div>`;
      return;
    }

    const details = this.project?.skills_details || {};
    container.innerHTML = subSkills.map((sub, idx) => {
      const running = sub === this.inferenceActiveSubSkill;
      const done = !running && this.inferenceDoneSubSkills.includes(sub);
      const state = running ? 'is-running' : done ? 'is-done' : '';
      const btnKey = running ? 'val.subtaskRunning' : done ? 'val.subtaskDone' : 'btn.runSubtask';
      const name = details[sub]?.name || sub;
      return `
        <div class="mr-subtask ${state}" id="infer-row-${this.esc(sub)}">
          <span class="mr-subtask-label" title="${this.esc(sub)}">${idx + 1}. ${this.esc(name)}</span>
          <button class="btn btn-xs ${running || done ? 'btn-success' : 'btn-primary'}"
                  onclick="App.triggerInferenceSubtask('${this.esc(sub)}')"
                  title="${this.esc(this.t('tip.dispatchSubtask'))}" ${running ? 'disabled' : ''}>${
            this.esc(this.t(btnKey))}</button>
        </div>`;
    }).join('');
  },

  /** Marks one sub-step as the one the daemon is executing. Used both by the
   * manual dispatch below and by `orchestration_task_started`, so a step the
   * orchestrator started shows up here exactly like a hand-dispatched one. */
  setInferenceSubtaskRunning(subSkill: string): void {
    this.inferenceActiveSubSkill = this.inferenceSubSkills.includes(subSkill) ? subSkill : '';
    // Re-running a finished step clears its DONE mark, otherwise the queue
    // would claim it is both running and already done.
    this.inferenceDoneSubSkills = this.inferenceDoneSubSkills.filter(s => s !== subSkill);
    this.renderInferenceSubtasks(this.inferenceSubSkills);
  },

  async triggerInferenceSubtask(subSkill: string): Promise<void> {
    const s = this.activeSkill;
    if (!s) return;

    this.setInferenceSubtaskRunning(subSkill);
    this.updateInferenceDaemonStatus('RUNNING');
    this.log('INFO', this.t('log.dispatchSubtask', { sub: subSkill }));

    await this.api('POST', '/inference/command', {
      skill_slug: s,
      command: `SET_TASK:${s}__${subSkill}`
    });
  },

  async sendInferenceStopSignal(): Promise<void> {
    const s = this.activeSkill;
    if (!s) return;

    this.updateInferenceDaemonStatus('WAITING');
    this.log('WARN', this.t('log.inferStopSignal'));

    await this.api('POST', '/inference/command', {
      skill_slug: s,
      command: 'STOP'
    });

    // STOP ends the current sub-task but leaves the daemon up, so the rows go
    // back to being dispatchable rather than disappearing.
    this.setInferenceSubtaskRunning('');
  },

  /** The daemon's own state badge. It deliberately does NOT touch the task
   * latch banner: the latch belongs to the orchestrator and writing it from
   * here made the same state read differently depending on which path got
   * there last. */
  updateInferenceDaemonStatus(status: 'OFF' | 'WAITING' | 'RUNNING'): void {
    const el = document.getElementById('infer-daemon-status');
    if (!el) return;
    const key = status === 'RUNNING' ? 'val.daemonRunning'
      : status === 'WAITING' ? 'val.daemonWaiting' : 'val.daemonOff';
    el.className = `mr-tag ${status === 'RUNNING' ? 'is-running' : status === 'WAITING' ? 'is-waiting' : 'is-off'}`;
    el.setAttribute('data-i18n', key);
    el.textContent = this.t(key);
  },

  /** VLM inspector verdict on the step that just finished. */
  setVlmVerdict(state: 'idle' | 'verifying' | 'ok' | 'failed'): void {
    const badge = document.getElementById('vlm-inspect-badge');
    if (!badge) return;
    const key = state === 'verifying' ? 'val.vlmVerifying'
      : state === 'ok' ? 'val.vlmOk'
      : state === 'failed' ? 'val.vlmFailed' : 'val.vlmIdle';
    badge.className = `brain-badge is-${state}`;
    badge.setAttribute('data-i18n', key);
    badge.textContent = this.t(key);
  },

  handleInferenceTelemetry(line: string): void {
    if (line.includes('[TELEMETRY]')) {
      const jointsMatch = line.match(/joints:([0-9\.\-,\s]+)/);
      const targetMatch = line.match(/target:([0-9\.\-,\s]+)/);
      const loadMatch = line.match(/load:([\d\.\-]+)/);
      const settleMatch = line.match(/settle:(\d+\/\d+)/);
      const deltaMatch = line.match(/max_delta:([\d\.\-]+)/);

      const updateEl = (id: string, text: string, color?: string) => {
        const el = document.getElementById(id);
        if (el) {
          el.textContent = text;
          if (color) {
            el.style.color = color;
          } else {
            el.style.color = '';
          }
        }
      };

      if (settleMatch) {
        updateEl('infer-settle-frames', settleMatch[1]);
        updateEl('tele-infer-settle-frames', settleMatch[1]);
      }
      if (loadMatch) {
        const val = parseFloat(loadMatch[1]);
        const text = `${val.toFixed(1)} mA`;
        let color = 'var(--green)';
        if (val > 220) {
          color = 'var(--red)';
        } else if (val > 100) {
          color = 'var(--yellow)';
        }
        updateEl('infer-gripper-load', text, color);
        updateEl('tele-infer-gripper-load', text, color);
      }
      if (deltaMatch) {
        const text = `${parseFloat(deltaMatch[1]).toFixed(4)} rad`;
        updateEl('infer-max-delta', text);
        updateEl('tele-infer-max-delta', text);
      }

      // Update joints J1 to J6
      if (jointsMatch) {
        const joints = jointsMatch[1].split(',').map(x => parseFloat(x.trim()));
        joints.forEach((val, idx) => {
          updateEl(`joint-val-${idx}`, val.toFixed(4));
          updateEl(`tele-joint-val-${idx}`, val.toFixed(4));
        });
        this.updateArmVisualization(joints);
      }

      if (targetMatch) {
        const targets = targetMatch[1].split(',').map(x => parseFloat(x.trim()));
        targets.forEach((val, idx) => {
          updateEl(`joint-tgt-${idx}`, val.toFixed(4));
          updateEl(`tele-joint-tgt-${idx}`, val.toFixed(4));
          
          const checkDiff = (valId: string) => {
            const valEl = document.getElementById(valId);
            if (valEl) {
              const actualVal = parseFloat(valEl.textContent || '0');
              const diff = Math.abs(val - actualVal);
              const parentBox = valEl.parentElement;
              if (parentBox) {
                if (diff > 0.05) {
                  parentBox.style.borderColor = 'rgba(239,83,80,0.3)';
                  parentBox.style.background = 'rgba(239,83,80,0.03)';
                } else if (diff > 0.005) {
                  parentBox.style.borderColor = 'rgba(255,167,38,0.3)';
                  parentBox.style.background = 'rgba(255,167,38,0.03)';
                } else {
                  parentBox.style.borderColor = 'rgba(76,175,80,0.3)';
                  parentBox.style.background = 'rgba(76,175,80,0.03)';
                }
              }
            }
          };
          checkDiff(`joint-val-${idx}`);
          checkDiff(`tele-joint-val-${idx}`);
        });
      }
    } else if (line.includes('Settled Frames:') && line.includes('Gripper Load:')) {
      const settleMatch = line.match(/Settled Frames:\s*(\d+\/\d+)/);
      const loadMatch = line.match(/Gripper Load:\s*([\d\.]+)\s*mA/);
      const deltaMatch = line.match(/Max Delta:\s*([\d\.\-]+)/);

      const updateEl = (id: string, text: string) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };

      if (settleMatch) {
        updateEl('infer-settle-frames', settleMatch[1]);
        updateEl('tele-infer-settle-frames', settleMatch[1]);
      }
      if (loadMatch) {
        const text = `${loadMatch[1]} mA`;
        updateEl('infer-gripper-load', text);
        updateEl('tele-infer-gripper-load', text);
      }
      if (deltaMatch) {
        const text = deltaMatch[1];
        updateEl('infer-max-delta', text);
        updateEl('tele-infer-max-delta', text);
      }
    }

    if (line.includes('[STATUS] TASK_DONE')) {
      const doneMatch = line.match(/\[STATUS\] TASK_DONE:\s*([^\s\|]+)/);
      if (doneMatch) {
        const fullTask = doneMatch[1];
        const parts = fullTask.split('__');
        const subSkill = parts.length > 1 ? parts[1] : parts[0];
        
        // Recorded in state, not painted onto the row: the queue is rebuilt on
        // a language switch and on every dispatch, and a DOM-only mark would
        // vanish there.
        if (!this.inferenceDoneSubSkills.includes(subSkill)) {
          this.inferenceDoneSubSkills.push(subSkill);
        }
        if (this.inferenceActiveSubSkill === subSkill) this.inferenceActiveSubSkill = '';
        this.renderInferenceSubtasks(this.inferenceSubSkills);

        this.updateInferenceDaemonStatus('WAITING');
        this.log('SUCCESS', this.t('log.subtaskDone', { sub: subSkill }));
      }
    }
  },

  // ── Calibration-driven live arm visualization ───────────────────────
  // Base->gripper kinematic chain order — matches the backend's
  // CANONICAL_JOINT_ORDER and the position of each value in the
  // [TELEMETRY] joints:v0,v1,... array.
  ARM_JOINT_ORDER: ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'] as string[],
  // Visual rotation sweep (degrees) mapped from each joint's normalized
  // 0..1 fraction. These are display ranges, not physical limits — the
  // fraction itself is auto-ranged from live data (see updateArmVisualization),
  // which sidesteps not knowing whether LeRobot reports degrees, radians or
  // a normalized percentage for a given version/robot.
  ARM_JOINT_SWEEP: {
    shoulder_pan: [-70, 70], shoulder_lift: [-55, 35], elbow_flex: [-15, 110],
    wrist_flex: [-80, 80], wrist_roll: [0, 340], gripper: [0, 26],
  } as Record<string, [number, number]>,
  ARM_GEOM: { baseX: 100, baseY: 175, upperLen: 55, foreLen: 50, wristLen: 26 },

  /** Collapse/expand the arm-visualization side column — collapsing shrinks
   * it to a thin strip so the panel's width is actually given back to the
   * control/telemetry columns next to it, not just hidden-but-still-wide. */
  toggleArmVisualPanel(): void {
    const block = document.getElementById('arm-visual-block');
    const btn = document.getElementById('arm-visual-toggle-btn');
    if (!block) return;
    const collapsed = block.classList.toggle('collapsed');
    localStorage.setItem('orchiday_armvisual_collapsed', collapsed ? '1' : '0');
    if (btn) {
      btn.title = this.t(collapsed ? 'tip.showArmVisual' : 'tip.toggleArmVisual');
      const arrow = btn.querySelector('polyline');
      if (arrow) arrow.setAttribute('points', collapsed ? '9 18 15 12 9 6' : '15 18 9 12 15 6');
    }
  },

  restoreArmVisualCollapsedState(): void {
    const block = document.getElementById('arm-visual-block');
    const btn = document.getElementById('arm-visual-toggle-btn');
    if (!block) return;
    const collapsed = localStorage.getItem('orchiday_armvisual_collapsed') === '1';
    block.classList.toggle('collapsed', collapsed);
    if (btn) {
      btn.title = this.t(collapsed ? 'tip.showArmVisual' : 'tip.toggleArmVisual');
      const arrow = btn.querySelector('polyline');
      if (arrow) arrow.setAttribute('points', collapsed ? '9 18 15 12 9 6' : '15 18 9 12 15 6');
    }
  },

  async loadArmVisualConfig(): Promise<void> {
    this.restoreArmVisualCollapsedState();
    const emptyEl = document.getElementById('arm-visual-empty');
    const gridEl = document.getElementById('arm-visual-grid');
    // No project: fall through to the same empty state the server-side
    // failure path uses. Returning early here used to leave the placeholder
    // grid on screen — two blank arm cards and no explanation why.
    const res = this.project ? await this.api('GET', '/calibration/arm_visual_config') : null;
    if (!res || res.ok === false) {
      if (emptyEl) emptyEl.style.display = 'flex';
      if (gridEl) gridEl.style.display = 'none';
      this.armVisualConfig = null;
      this.renderTeleopCalibrationStatus(null);
      this.renderCalibrationArmCards(null);
      this.renderCalibrationIdleVisual();
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (gridEl) gridEl.style.display = 'flex';
    this.armVisualConfig = res;
    this.armJointRanges = { leader: {}, follower: {} };
    this.renderArmVisualLegend(res.follower?.source === 'calibration' ? res.follower : res.leader);
    this.renderArmSchematic('leader', res.leader);
    this.renderArmSchematic('follower', res.follower);
    this.renderTeleopCalibrationStatus(res);
    this.renderCalibrationArmCards(res);
    this.renderCalibrationIdleVisual();
  },

  /** Teleoperation page: which calibration file each arm will actually run
   * with. The same /calibration/arm_visual_config response drives this —
   * `source: "default"` means nothing is bound for that arm and LeRobot will
   * use generic ranges, which is worth seeing BEFORE the arms start moving,
   * not after. */
  renderTeleopCalibrationStatus(cfg: any): void {
    for (const side of ['leader', 'follower']) {
      const row = document.getElementById(`tele-cal-row-${side}`);
      const deviceEl = document.getElementById(`tele-cal-device-${side}`);
      const fileEl = document.getElementById(`tele-cal-file-${side}`);
      if (!row) continue;
      const arm = cfg?.[side];
      row.classList.remove('is-calibrated', 'is-default');
      if (!arm) {
        if (deviceEl) deviceEl.textContent = '-';
        if (fileEl) fileEl.textContent = '-';
        continue;
      }
      const calibrated = arm.source === 'calibration' && !!arm.filename;
      row.classList.add(calibrated ? 'is-calibrated' : 'is-default');
      if (deviceEl) deviceEl.textContent = arm.device_type || '-';
      if (fileEl) fileEl.textContent = calibrated ? arm.filename : this.t('hint.teleCalDefault');
    }
  },

  /** Motor-ID legend shown ONCE for the whole stacked block — both arms
   * follow the same base->gripper joint order, so per-arm id badges would
   * just repeat this list twice. */
  renderArmVisualLegend(armCfg: any): void {
    const legend = document.getElementById('arm-visual-legend');
    if (!legend) return;
    const joints = armCfg?.joints || {};
    const badges = this.ARM_JOINT_ORDER
      .map(name => (joints[name] ? `<span class="arm-id-badge">${name}: <strong>#${joints[name].id}</strong></span>` : ''))
      .filter(Boolean).join('');
    const label = `<span class="arm-visual-legend-label">${this.esc(this.t('lbl.jointLegend'))}</span>`;
    legend.innerHTML = badges ? label + badges : '';
  },

  renderArmSchematic(side: string, armCfg: any): void {
    const wrap = document.getElementById(`arm-visual-${side}-wrap`);
    const meta = document.getElementById(`arm-visual-${side}-meta`);
    if (!wrap) return;

    if (meta) {
      const sourceLabel = armCfg?.source === 'calibration' ? this.t('hint.armVisualCalibrated') : this.t('hint.armVisualDefault');
      meta.innerHTML =
        `<div class="arm-visual-source">${this.esc(sourceLabel)}${armCfg?.filename ? ' · ' + this.esc(armCfg.filename) : ''}</div>` +
        `<div class="arm-visual-idle-hint" id="arm-visual-${side}-idle-hint">${this.esc(this.t('hint.armVisualIdle'))}</div>`;
    }

    const g = this.ARM_GEOM;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('class', 'arm-visual-svg');

    // Every id'd <g> below only ever receives a pure rotate() transform —
    // pivot positioning is baked into static wrapper <g translate(...)>
    // elements so per-frame updates are a single attribute write each.
    svg.innerHTML = `
      <line x1="15" y1="${g.baseY}" x2="185" y2="${g.baseY}" class="arm-floor" />
      <g transform="translate(${g.baseX},${g.baseY})">
        <circle r="9" class="arm-base" />
        <g id="arm-${side}-shoulder_pan" transform="rotate(0)">
          <line x1="0" y1="0" x2="0" y2="-13" class="arm-pan-indicator" />
          <g id="arm-${side}-shoulder_lift" transform="rotate(0)">
            <line x1="0" y1="0" x2="0" y2="-${g.upperLen}" class="arm-link arm-link-upper" />
            <g transform="translate(0,-${g.upperLen})">
              <g id="arm-${side}-elbow_flex" transform="rotate(0)">
                <line x1="0" y1="0" x2="0" y2="-${g.foreLen}" class="arm-link arm-link-fore" />
                <g transform="translate(0,-${g.foreLen})">
                  <g id="arm-${side}-wrist_flex" transform="rotate(0)">
                    <line x1="0" y1="0" x2="0" y2="-${g.wristLen}" class="arm-link arm-link-wrist" />
                    <g transform="translate(0,-${g.wristLen})">
                      <circle r="3.5" class="arm-roll-hub" />
                      <line id="arm-${side}-wrist_roll" x1="0" y1="0" x2="6" y2="0" class="arm-roll-indicator" transform="rotate(0)" />
                      <g id="arm-${side}-gripper-l" transform="rotate(-13)">
                        <line x1="0" y1="0" x2="0" y2="-9" class="arm-gripper-jaw" />
                      </g>
                      <g id="arm-${side}-gripper-r" transform="rotate(13)">
                        <line x1="0" y1="0" x2="0" y2="-9" class="arm-gripper-jaw" />
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </g>
    `;

    wrap.innerHTML = '';
    wrap.appendChild(svg);

    // Idle pose: mid-range on every joint until live telemetry arrives.
    this.applyArmPose(side, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  },

  updateArmVisualization(rawValues: number[]): void {
    if (!this.armVisualConfig) return;
    const order = this.ARM_JOINT_ORDER;
    (['leader', 'follower'] as const).forEach(side => {
      // Teleoperation mirrors the leader's pose onto the follower 1:1, so both
      // panels are driven from the same telemetry stream. Ranges are tracked
      // per side (rather than globally) so a future per-arm telemetry source
      // (e.g. distinct leader/follower feeds) would need no rework here.
      const ranges = this.armJointRanges[side];
      const fractions: number[] = [];
      order.forEach((name, idx) => {
        const val = rawValues[idx];
        if (val === undefined || Number.isNaN(val)) { fractions[idx] = 0.5; return; }
        let r = ranges[name];
        if (!r) { r = { min: val - 0.001, max: val + 0.001 }; ranges[name] = r; }
        if (val < r.min) r.min = val;
        if (val > r.max) r.max = val;
        const span = r.max - r.min;
        fractions[idx] = span > 1e-6 ? (val - r.min) / span : 0.5;
      });
      this.applyArmPose(side, fractions);
      const idleHint = document.getElementById(`arm-visual-${side}-idle-hint`);
      if (idleHint) idleHint.style.display = 'none';
    });
  },

  /** Drives the mini calibration-panel arm SVG straight from the calibration
   * table's own running min/pos/max (server-tracked, see calibration_progress)
   * instead of the client-side auto-ranging updateArmVisualization() uses for
   * teleop telemetry — the calibration payload already has exact extremes. */
  updateArmVisualizationFromCalibration(robotId: string, values: Record<string, {min: number; pos: number; max: number}>): void {
    const activeRobot = (this.project?.robots || [])[0];
    let side: 'leader' | 'follower' | null = null;
    if (activeRobot?.leader_id === robotId) side = 'leader';
    else if (activeRobot?.follower_id === robotId) side = 'follower';
    if (!side) return;

    const fractions = this.ARM_JOINT_ORDER.map(name => {
      const v = values[name];
      if (!v) return 0.5;
      const span = v.max - v.min;
      return span > 1e-6 ? (v.pos - v.min) / span : 0.5;
    });
    this.applyArmPose('cal', fractions);
  },

  applyArmPose(side: string, fractions: number[]): void {
    const order = this.ARM_JOINT_ORDER;
    const sweep = this.ARM_JOINT_SWEEP;
    const angleFor = (idx: number, name: string): number => {
      const [lo, hi] = sweep[name];
      const f = fractions[idx] ?? 0.5;
      return lo + f * (hi - lo);
    };

    order.forEach((name, idx) => {
      if (name === 'gripper') return;
      const el = document.getElementById(`arm-${side}-${name}`);
      if (el) el.setAttribute('transform', `rotate(${angleFor(idx, name).toFixed(1)})`);
    });

    const gIdx = order.indexOf('gripper');
    const [glo, ghi] = sweep.gripper;
    const openDeg = glo + (fractions[gIdx] ?? 0.5) * (ghi - glo);
    const lJaw = document.getElementById(`arm-${side}-gripper-l`);
    const rJaw = document.getElementById(`arm-${side}-gripper-r`);
    if (lJaw) lJaw.setAttribute('transform', `rotate(${(-13 - openDeg).toFixed(1)})`);
    if (rJaw) rJaw.setAttribute('transform', `rotate(${(13 + openDeg).toFixed(1)})`);
  },

  // ── Setup Wizard ───────────────────────────────────────────────────
  showSetupWizard(mode: 'initial' | 'quick' = 'initial'): void {
    this.wizardMode = mode;
    const overlay = document.getElementById('setup-wizard-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
    }
    this.wizardActivePage = 1;
    this.wizardLeaderPort = '';
    this.wizardLeaderDeviceId = '';
    this.wizardFollowerPort = '';
    this.wizardFollowerDeviceId = '';
    this.wizardLeaderSubStep = 1;
    this.wizardFollowerSubStep = 1;
    this.wizardLeRobotParentDir = '';
    this.wizardCameras = [];
    this.wizardFoundLeRobotPath = '';
    this.wizardStopCameraPreview();

    // Toggle close button and bottom skip button depending on mode
    const closeBtn = document.getElementById('wizard-close-button');
    const skipContainer = document.querySelector('.skip-setup-container') as HTMLElement;
    const welcomeTextEl = document.querySelector('#wizard-page-1 .welcome-text');

    if (mode === 'quick') {
      if (closeBtn) closeBtn.style.display = 'block';
      if (skipContainer) skipContainer.style.display = 'none';
      if (welcomeTextEl) welcomeTextEl.textContent = 'QUICK SETUP';
    } else {
      if (closeBtn) closeBtn.style.display = 'none';
      if (skipContainer) skipContainer.style.display = 'flex';
      if (welcomeTextEl) welcomeTextEl.textContent = 'WELCOME TO';
    }

    // Toggle dots 2 & 3 in quick setup mode
    const dot2 = document.getElementById('wizard-dot-2');
    const dot3 = document.getElementById('wizard-dot-3');
    if (dot2 && dot3) {
      if (mode === 'quick') {
        dot2.style.display = 'none';
        dot3.style.display = 'none';
      } else {
        dot2.style.display = 'inline-block';
        dot3.style.display = 'inline-block';
      }
    }

    this.wizardUpdatePageVisibility();
  },

  startSetupWizard(): void {
    this.showSetupWizard('initial');
  },

  wizardUpdatePageVisibility(): void {
    // Hide all pages
    document.querySelectorAll('.wizard-page').forEach(page => {
      page.classList.remove('active');
    });
    
    // Show active page
    const activePageEl = document.getElementById(`wizard-page-${this.wizardActivePage}`);
    if (activePageEl) {
      activePageEl.classList.add('active');
    }

    // Stop camera preview if we are not on page 6
    if (this.wizardActivePage !== 6) {
      this.wizardStopCameraPreview();
    }

    // Update dots (now 7 pages)
    for (let i = 1; i <= 7; i++) {
      const dot = document.getElementById(`wizard-dot-${i}`);
      if (dot) {
        if (i === this.wizardActivePage) {
          dot.classList.add('active');
        } else {
          dot.classList.remove('active');
        }
      }
    }

    // Update sub-steps for Page 4 (Leader)
    if (this.wizardActivePage === 4) {
      for (let s = 1; s <= 3; s++) {
        const stepEl = document.getElementById(`wizard-leader-step-${s}`);
        if (stepEl) {
          stepEl.style.display = (s === this.wizardLeaderSubStep) ? 'block' : 'none';
        }
      }
      const nextBtn = document.getElementById('wizard-leader-next-btn') as HTMLButtonElement;
      if (nextBtn) {
        if (this.wizardLeaderSubStep === 3) {
          nextBtn.textContent = 'Next';
          nextBtn.disabled = false;
          nextBtn.style.opacity = '1';
        } else {
          nextBtn.textContent = 'Skip';
          nextBtn.disabled = false;
          nextBtn.style.opacity = '1';
        }
      }
    }

    // Update sub-steps for Page 5 (Follower)
    if (this.wizardActivePage === 5) {
      for (let s = 1; s <= 3; s++) {
        const stepEl = document.getElementById(`wizard-follower-step-${s}`);
        if (stepEl) {
          stepEl.style.display = (s === this.wizardFollowerSubStep) ? 'block' : 'none';
        }
      }
      const finishBtn = document.getElementById('wizard-follower-finish-btn') as HTMLButtonElement;
      if (finishBtn) {
        if (this.wizardFollowerSubStep === 3) {
          finishBtn.textContent = 'Next';
          finishBtn.disabled = false;
          finishBtn.style.opacity = '1';
        } else {
          finishBtn.textContent = 'Skip';
          finishBtn.disabled = false;
          finishBtn.style.opacity = '1';
        }
      }
    }

    // Scan cameras when entering Page 6
    if (this.wizardActivePage === 6) {
      this.wizardScanCamerasForSelect();
    }
  },

  async wizardCheckLeRobotOnDisk(): Promise<void> {
    const titleEl = document.getElementById('wizard-page-2-title');
    const descEl = document.getElementById('wizard-page-2-desc');
    const optionsContainer = document.getElementById('wizard-page-2-options-container');
    const nextBtn = document.getElementById('wizard-page-2-next-btn') as HTMLButtonElement;
    const checklistEl = document.getElementById('wizard-requirements-checklist');
    
    if (!titleEl || !descEl || !optionsContainer || !nextBtn) return;
    
    titleEl.innerHTML = 'Ověřování <span class="highlight-yellow">systémových požadavků</span>...';
    descEl.textContent = this.t('wiz.checking');
    optionsContainer.innerHTML = '';
    nextBtn.disabled = true;
    nextBtn.style.opacity = '0.5';
    if (checklistEl) {
      checklistEl.style.display = 'none';
      checklistEl.innerHTML = '';
    }
    
    try {
      const res = await this.api('GET', '/setup/system-status');
      nextBtn.disabled = false;
      nextBtn.style.opacity = '1';
      
      const gitOk = res.git_installed;
      const condaOk = res.conda_installed;
      const envOk = res.env_exists;
      const repoOk = res.lerobot_found;
      
      if (checklistEl) {
        checklistEl.style.display = 'flex';
        checklistEl.innerHTML = `
          <div style="font-weight: 700; margin-bottom: 4px; color: var(--text-light); font-size: 11px; border-bottom: 1px solid var(--border); padding-bottom: 4px;">
            Stav systémových požadavků:
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="color: ${gitOk ? 'var(--green)' : 'var(--red)'}; font-weight: bold; font-size: 14px;">${gitOk ? '✓' : '✗'}</span>
            <span>Git: ${gitOk ? 'Nainstalován' : 'Chybí (doporučeno nainstalovat)'}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="color: ${condaOk ? 'var(--green)' : 'var(--red)'}; font-weight: bold; font-size: 14px;">${condaOk ? '✓' : '✗'}</span>
            <span>Conda: ${condaOk ? 'Nainstalována' : 'Chybí (bude automaticky stažena a nainstalována)'}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="color: ${envOk ? 'var(--green)' : 'var(--red)'}; font-weight: bold; font-size: 14px;">${envOk ? '✓' : '✗'}</span>
            <span>Conda prostředí 'lerobot': ${envOk ? 'Nainstalováno' : 'Chybí (bude vytvořeno s Python 3.10)'}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="color: ${repoOk ? 'var(--green)' : 'var(--red)'}; font-weight: bold; font-size: 14px;">${repoOk ? '✓' : '✗'}</span>
            <span>Repozitář LeRobot: ${repoOk ? `Nalezen v <code>${res.lerobot_path}</code>` : 'Chybí (bude stažen z GitHubu)'}</span>
          </div>
        `;
      }
      
      if (res.ok && res.lerobot_found && res.lerobot_path) {
        this.wizardFoundLeRobotPath = res.lerobot_path;
        this.wizardSelectedOption = 'found-confirm';
        
        const pathInput = document.getElementById('wizard-lerobot-path') as HTMLInputElement;
        if (pathInput) pathInput.value = res.lerobot_path;
        
        titleEl.innerHTML = 'Nalezli jsme repozitář <span class="highlight-yellow">LeRobot</span>!';
        descEl.innerHTML = `V systému byl detekován existující repozitář v:<br><code class="highlight-path" style="display:inline-block; margin-top:6px; padding:2px 6px; background:var(--bg-sidebar); border:1px solid var(--border); font-size:11px; word-break:break-all;">${res.lerobot_path}</code>.<br><br>Chcete použít tuto složku, vybrat jinou, nebo provést novou instalaci?`;
        
        optionsContainer.innerHTML = `
          <button id="wizard-opt-found-confirm" class="btn-white-pill active" onclick="App.wizardSelectOption('found-confirm')">Použít detekovanou složku</button>
          <button id="wizard-opt-found-browse" class="btn-white-pill" onclick="App.wizardSelectOption('found-browse')">Vybrat jinou složku</button>
          <button id="wizard-opt-found-install" class="btn-white-pill" onclick="App.wizardSelectOption('found-install')">Nová instalace (stažení všeho)</button>
        `;
      } else {
        this.wizardFoundLeRobotPath = '';
        this.wizardSelectedOption = 'install';
        
        titleEl.innerHTML = `Nenašli jsme repozitář <span class="highlight-yellow">LeRobot</span>.`;
        descEl.textContent = 'Chcete provést plně automatickou instalaci (Miniconda, Conda env, LeRobot repozitář a závislosti), nebo se připojit k existujícímu ručně?';
        
        optionsContainer.innerHTML = `
          <button id="wizard-opt-new-installation" class="btn-white-pill active" onclick="App.wizardSelectOption('install')">Nová automatická instalace</button>
          <button id="wizard-opt-connect" class="btn-white-pill" onclick="App.wizardSelectOption('connect')">Připojit ručně</button>
        `;
      }
    } catch (err) {
      this.log('ERROR', 'Chyba při kontrole LeRobot na disku: ' + err);
      this.wizardFoundLeRobotPath = '';
      this.wizardSelectedOption = 'install';
      titleEl.innerHTML = `Nenašli jsme repozitář <span class="highlight-yellow">LeRobot</span>.`;
      descEl.textContent = 'Chcete provést plně automatickou instalaci (Miniconda, Conda env, LeRobot repozitář a závislosti), nebo se připojit k existujícímu ručně?';
      optionsContainer.innerHTML = `
        <button id="wizard-opt-new-installation" class="btn-white-pill active" onclick="App.wizardSelectOption('install')">Nová automatická instalace</button>
        <button id="wizard-opt-connect" class="btn-white-pill" onclick="App.wizardSelectOption('connect')">Připojit ručně</button>
      `;
      nextBtn.disabled = false;
      nextBtn.style.opacity = '1';
    }
  },

  async wizardBrowseDifferentLeRobot(): Promise<void> {
    try {
      const res = await this.api('POST', '/utils/browse_directory');
      if (res.ok && res.path) {
        const verifyRes = await this.api('POST', '/setup/verify-lerobot-path', { path: res.path });
        if (verifyRes.ok) {
          const pathInput = document.getElementById('wizard-lerobot-path') as HTMLInputElement;
          if (pathInput) pathInput.value = res.path;
          this.wizardFoundLeRobotPath = res.path;
          this.wizardSelectedOption = 'found-confirm';
          
          this.wizardActivePage = 4;
          this.wizardLeaderSubStep = 1;
          this.wizardUpdatePageVisibility();
          this.log('SUCCESS', `Ověřena vybraná složka LeRobot: ${res.path}`);
        } else {
          alert(verifyRes.error || this.t('wiz.invalidLerobot'));
        }
      }
    } catch (err) {
      alert(`Chyba při otevírání průzkumníku: ${err}`);
    }
  },

  async wizardBrowseLeRobotPath(): Promise<void> {
    try {
      const res = await this.api('POST', '/utils/browse_directory');
      if (res.ok && res.path) {
        const verifyRes = await this.api('POST', '/setup/verify-lerobot-path', { path: res.path });
        if (verifyRes.ok) {
          const pathInput = document.getElementById('wizard-lerobot-path') as HTMLInputElement;
          if (pathInput) pathInput.value = res.path;
          this.log('SUCCESS', `Složka LeRobot vybrána a ověřena: ${res.path}`);
        } else {
          alert(verifyRes.error || this.t('wiz.invalidLerobot'));
        }
      }
    } catch (err) {
      alert(`Chyba při výběru složky: ${err}`);
    }
  },

  async wizardNextPage(): Promise<void> {
    if (this.wizardActivePage === 1) {
      const nameInput = document.getElementById('wizard-project-name') as HTMLInputElement;
      if (!nameInput || !nameInput.value.trim()) {
        alert(this.t('wiz.enterProjectName'));
        return;
      }
      const sceneDescInput = document.getElementById('wizard-scene-desc') as HTMLTextAreaElement | null;
      if (!sceneDescInput || !sceneDescInput.value.trim()) {
        alert(this.t('alert.sceneDescRequired'));
        sceneDescInput?.focus();
        return;
      }
      if (this.wizardMode === 'quick') {
        this.wizardActivePage = 4;
        this.wizardLeaderSubStep = 1;
        this.wizardUpdatePageVisibility();
      } else {
        this.wizardActivePage = 2;
        this.wizardUpdatePageVisibility();
        this.wizardCheckLeRobotOnDisk();
      }
    } else if (this.wizardActivePage === 2) {
      if (this.wizardSelectedOption === 'found-confirm') {
        const pathInput = document.getElementById('wizard-lerobot-path') as HTMLInputElement;
        if (pathInput) pathInput.value = this.wizardFoundLeRobotPath;
        this.wizardActivePage = 4;
        this.wizardLeaderSubStep = 1;
        this.wizardUpdatePageVisibility();
      } else if (this.wizardSelectedOption === 'found-browse') {
        this.wizardBrowseDifferentLeRobot();
      } else if (this.wizardSelectedOption === 'install' || this.wizardSelectedOption === 'found-install') {
        // Prompt for installation target directory
        try {
          const res = await this.api('POST', '/utils/browse_directory');
          if (res.ok && res.path) {
            this.wizardLeRobotParentDir = res.path;
            
            // Go to Page 3 (install progress)
            this.wizardActivePage = 3;
            this.wizardUpdatePageVisibility();
            
            const titleEl = document.getElementById('wizard-page-3-title');
            const connectSec = document.getElementById('wizard-connect-section');
            const installSec = document.getElementById('wizard-install-section');
            const finishBtn = document.getElementById('wizard-btn-finish') as HTMLButtonElement;

            if (titleEl) titleEl.innerHTML = 'Installing <span class="highlight-yellow">LeRobot</span> repository...';
            if (connectSec) connectSec.style.display = 'none';
            if (installSec) installSec.style.display = 'block';
            if (finishBtn) {
              finishBtn.disabled = true;
              finishBtn.style.opacity = '0.5';
            }
            this.runSimulatedInstall();
          }
        } catch (err) {
          alert(`Chyba při otevírání průzkumníku: ${err}`);
        }
      } else {
        // Connect option
        this.wizardActivePage = 3;
        this.wizardUpdatePageVisibility();
        
        const titleEl = document.getElementById('wizard-page-3-title');
        const connectSec = document.getElementById('wizard-connect-section');
        const installSec = document.getElementById('wizard-install-section');
        const finishBtn = document.getElementById('wizard-btn-finish') as HTMLButtonElement;

        if (titleEl) titleEl.innerHTML = 'Connect your <span class="highlight-yellow">LeRobot</span> repository.';
        if (connectSec) connectSec.style.display = 'block';
        if (installSec) installSec.style.display = 'none';
        if (finishBtn) {
          finishBtn.disabled = false;
          finishBtn.style.opacity = '1';
        }
      }
    } else if (this.wizardActivePage === 3) {
      if (this.wizardSelectedOption === 'connect') {
        const pathInput = document.getElementById('wizard-lerobot-path') as HTMLInputElement;
        const path = pathInput ? pathInput.value.trim() : '';
        if (!path) {
          alert(this.t('wiz.enterLerobotPath'));
          return;
        }
        try {
          const verifyRes = await this.api('POST', '/setup/verify-lerobot-path', { path });
          if (!verifyRes.ok) {
            alert(verifyRes.error || this.t('wiz.invalidLerobot'));
            return;
          }
        } catch (err) {
          alert(`Chyba při ověřování cesty: ${err}`);
          return;
        }
      }
      this.wizardActivePage = 4;
      this.wizardLeaderSubStep = 1;
      this.wizardUpdatePageVisibility();
    } else if (this.wizardActivePage === 4) {
      this.wizardActivePage = 5;
      this.wizardFollowerSubStep = 1;
      this.wizardUpdatePageVisibility();
    } else if (this.wizardActivePage === 5) {
      this.wizardActivePage = 6;
      this.wizardUpdatePageVisibility();
    } else if (this.wizardActivePage === 6) {
      this.wizardActivePage = 7;
      this.wizardUpdatePageVisibility();
    }
  },

  wizardPrevPage(): void {
    if (this.wizardActivePage > 1) {
      if (this.wizardActivePage === 4 && this.wizardMode === 'quick') {
        this.wizardActivePage = 1;
      } else {
        this.wizardActivePage--;
      }
      this.wizardUpdatePageVisibility();
    }
  },

  wizardSelectOption(opt: string): void {
    this.wizardSelectedOption = opt;
    const btnInstall = document.getElementById('wizard-opt-new-installation');
    const btnConnect = document.getElementById('wizard-opt-connect');
    const btnFoundConfirm = document.getElementById('wizard-opt-found-confirm');
    const btnFoundBrowse = document.getElementById('wizard-opt-found-browse');
    const btnFoundInstall = document.getElementById('wizard-opt-found-install');

    if (btnInstall) btnInstall.classList.remove('active');
    if (btnConnect) btnConnect.classList.remove('active');
    if (btnFoundConfirm) btnFoundConfirm.classList.remove('active');
    if (btnFoundBrowse) btnFoundBrowse.classList.remove('active');
    if (btnFoundInstall) btnFoundInstall.classList.remove('active');

    if (opt === 'install' && btnInstall) btnInstall.classList.add('active');
    if (opt === 'connect' && btnConnect) btnConnect.classList.add('active');
    if (opt === 'found-confirm' && btnFoundConfirm) btnFoundConfirm.classList.add('active');
    if (opt === 'found-browse' && btnFoundBrowse) btnFoundBrowse.classList.add('active');
    if (opt === 'found-install' && btnFoundInstall) btnFoundInstall.classList.add('active');
  },

  async runSimulatedInstall(): Promise<void> {
    const terminal = document.getElementById('wizard-log-terminal');
    const progress = document.getElementById('wizard-progress-bar');
    const finishBtn = document.getElementById('wizard-btn-finish') as HTMLButtonElement;
    const backBtn = document.getElementById('wizard-page-3-back') as HTMLButtonElement;

    if (!terminal || !progress) return;

    terminal.textContent = '';
    progress.style.width = '0%';
    if (backBtn) backBtn.disabled = true;

    try {
      const res = await this.api('POST', '/setup/install-lerobot', {
        parent_dir: this.wizardLeRobotParentDir || ''
      });
      const logs = res.logs || [];
      const finalPath = res.path || '/home/verlyba/robotics/lerobot';
      
      const pathInput = document.getElementById('wizard-lerobot-path') as HTMLInputElement;
      if (pathInput) pathInput.value = finalPath;

      // Print logs step by step to simulate installation animation
      let currentLogIdx = 0;
      const printNextLog = () => {
        if (currentLogIdx < logs.length) {
          terminal.textContent += logs[currentLogIdx] + '\n';
          terminal.scrollTop = terminal.scrollHeight;
          
          currentLogIdx++;
          const pct = Math.round((currentLogIdx / logs.length) * 100);
          progress.style.width = `${pct}%`;
          
          setTimeout(printNextLog, 600);
        } else {
          // Finished
          if (finishBtn) {
            finishBtn.disabled = false;
            finishBtn.style.opacity = '1';
          }
          if (backBtn) backBtn.disabled = false;
        }
      };
      
      setTimeout(printNextLog, 200);

    } catch (err) {
      terminal.textContent += 'Chyba při instalaci LeRobot: ' + err + '\n';
      if (finishBtn) {
        finishBtn.disabled = false;
        finishBtn.style.opacity = '1';
      }
      if (backBtn) backBtn.disabled = false;
    }
  },

  openAutoDetectPortsModal(): void {
    this.log('INFO', this.t('log.openingPortWizard'));
    this.autoDetectActiveArm = 'leader';
    this.autoDetectLeaderStep = 1;
    this.autoDetectFollowerStep = 1;
    this.autoDetectUpdateUI();
    this.openModal('modal-detect-ports');
  },

  async autoDetectStart(role: 'leader' | 'follower'): Promise<void> {
    const btn = document.getElementById(`btn-detect-${role}-scan`) as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = this.t('wiz.scanning');
    }
    try {
      this.log('INFO', `Spouštím skenování portů pro ${role} rameno...`);
      const res = await this.api('POST', '/setup/detect-arms/start');
      if (res.ok) {
        if (role === 'leader') {
          this.autoDetectLeaderStep = 2;
        } else {
          this.autoDetectFollowerStep = 2;
        }
        this.autoDetectUpdateUI();
      } else {
        alert(`Chyba při zahájení detekce: ${res.error || 'neznámá chyba'}`);
      }
    } catch (err) {
      alert(`Chyba při zahájení detekce: ${err}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = this.t('wiz.scanDevices');
      }
    }
  },

  async autoDetectConfirmUnplug(role: 'leader' | 'follower'): Promise<void> {
    const btn = document.getElementById(`btn-detect-${role}-confirm`) as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = this.t('wiz.verifying');
    }
    try {
      this.log('INFO', `Ověřuji odpojení USB pro ${role} rameno...`);
      const res = await this.api('POST', '/setup/detect-arms/unplugged');
      if (res.ok && res.device) {
        this.log('SUCCESS', `Detekováno ${role} rameno na portu ${res.device} (ID: ${res.persistent_id})`);
        
        // Update main page dropdown
        const select = document.getElementById(`tele-${role}-port`) as HTMLSelectElement | null;
        if (select) {
          let opt = select.querySelector(`option[value="${res.device}"]`) as HTMLOptionElement | null;
          if (!opt) {
            opt = document.createElement('option');
            opt.value = res.device;
            opt.textContent = `${res.device} (${res.friendly_name || res.persistent_id})`;
            select.insertBefore(opt, select.lastElementChild);
          }
          select.value = res.device;
          select.setAttribute('data-last-val', res.device);
        }

        // Update main page ID input
        const idInput = document.getElementById(`tele-${role}-id`) as HTMLInputElement | null;
        if (idInput) {
          idInput.value = res.persistent_id;
        }

        // Trigger onTelePortChange to update state
        this.onTelePortChange(role);

        // Auto-save by calling saveModelConfig (as it writes leader_port and follower_port to settings API)
        await this.saveModelConfig();

        // Update step representation text
        const textEl = document.getElementById(`detect-${role}-detected-text`);
        if (textEl) {
          textEl.innerHTML = `Port: <strong>${res.device}</strong> (ID: <code style="font-family: var(--font-mono); color: var(--cyan);">${res.persistent_id}</code>)`;
        }

        if (role === 'leader') {
          this.autoDetectLeaderStep = 3;
        } else {
          this.autoDetectFollowerStep = 3;
        }
        this.autoDetectUpdateUI();
      } else {
        alert(res.error || 'Zařízení nebylo detekováno. Ujistěte se, že jste odpojili správný USB kabel.');
      }
    } catch (err) {
      alert(`Chyba při potvrzení odpojení: ${err}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = this.t('wiz.confirmUnplug');
      }
    }
  },

  autoDetectGoToNextStep(): void {
    if (this.autoDetectActiveArm === 'leader') {
      this.autoDetectActiveArm = 'follower';
      this.autoDetectUpdateUI();
    }
  },

  autoDetectPrevStep(): void {
    if (this.autoDetectActiveArm === 'follower') {
      this.autoDetectActiveArm = 'leader';
      this.autoDetectUpdateUI();
    }
  },

  autoDetectUpdateUI(): void {
    // Show/hide main sections
    const leaderSec = document.getElementById('detect-leader-section');
    const followerSec = document.getElementById('detect-follower-section');
    if (leaderSec) leaderSec.style.display = this.autoDetectActiveArm === 'leader' ? 'block' : 'none';
    if (followerSec) followerSec.style.display = this.autoDetectActiveArm === 'follower' ? 'block' : 'none';

    // Show/hide sub-steps of Leader
    for (let i = 1; i <= 3; i++) {
      const el = document.getElementById(`detect-leader-step-${i}`);
      if (el) el.style.display = (this.autoDetectLeaderStep === i) ? 'block' : 'none';
    }

    // Show/hide sub-steps of Follower
    for (let i = 1; i <= 3; i++) {
      const el = document.getElementById(`detect-follower-step-${i}`);
      if (el) el.style.display = (this.autoDetectFollowerStep === i) ? 'block' : 'none';
    }

    // Update Step Indicators at the top
    const indLeader = document.getElementById('detect-step-indicator-leader');
    const indFollower = document.getElementById('detect-step-indicator-follower');
    const badgeLeader = document.getElementById('detect-step-badge-leader');
    const badgeFollower = document.getElementById('detect-step-badge-follower');

    if (indLeader && indFollower && badgeLeader && badgeFollower) {
      if (this.autoDetectActiveArm === 'leader') {
        indLeader.style.color = 'var(--cyan)';
        badgeLeader.style.background = 'rgba(0, 188, 212, 0.15)';
        badgeLeader.style.borderColor = 'var(--cyan)';

        indFollower.style.color = 'var(--text-muted)';
        badgeFollower.style.background = 'rgba(255, 255, 255, 0.05)';
        badgeFollower.style.borderColor = 'var(--border)';
      } else {
        indLeader.style.color = 'var(--text-muted)';
        badgeLeader.style.background = 'rgba(255, 255, 255, 0.05)';
        badgeLeader.style.borderColor = 'var(--border)';

        indFollower.style.color = 'var(--cyan)';
        badgeFollower.style.background = 'rgba(0, 188, 212, 0.15)';
        badgeFollower.style.borderColor = 'var(--cyan)';
      }
    }

    // Toggle Back button
    const backBtn = document.getElementById('detect-ports-back-btn');
    if (backBtn) {
      backBtn.style.visibility = this.autoDetectActiveArm === 'follower' ? 'visible' : 'hidden';
    }
  },

  async wizardStartDetectArm(role: 'leader' | 'follower'): Promise<void> {
    try {
      this.log('INFO', `Spouštím skenování portů pro detekci ${role} ramene...`);
      const res = await this.api('POST', '/setup/detect-arms/start');
      if (res.ok) {
        if (role === 'leader') {
          this.wizardLeaderSubStep = 2;
        } else {
          this.wizardFollowerSubStep = 2;
        }
        this.wizardUpdatePageVisibility();
      }
    } catch (err) {
      alert(`Chyba při zahájení detekce: ${err}`);
    }
  },

  async wizardConfirmUnplugArm(role: 'leader' | 'follower'): Promise<void> {
    try {
      this.log('INFO', `Ověřuji odpojené zařízení pro ${role} rameno...`);
      const res = await this.api('POST', '/setup/detect-arms/unplugged');
      if (res.ok && res.device) {
        if (role === 'leader') {
          this.wizardLeaderPort = res.device;
          this.wizardLeaderDeviceId = res.persistent_id;
          this.wizardLeaderSubStep = 3;
          
          const textEl = document.getElementById('wizard-leader-detected-text');
          if (textEl) textEl.textContent = `Great! Leader arm detected at ${res.device} (${res.persistent_id}).`;
        } else {
          this.wizardFollowerPort = res.device;
          this.wizardFollowerDeviceId = res.persistent_id;
          this.wizardFollowerSubStep = 3;
          
          const textEl = document.getElementById('wizard-follower-detected-text');
          if (textEl) textEl.textContent = `Great! Follower arm detected at ${res.device} (${res.persistent_id}).`;
        }
        this.wizardUpdatePageVisibility();
        this.log('SUCCESS', `Úspěšně detekováno ${role} rameno na portu ${res.device} s ID ${res.persistent_id}`);
      } else {
        alert(res.error || 'Zařízení nebylo detekováno.');
      }
    } catch (err) {
      alert(`Chyba při dokončení detekce: ${err}`);
    }
  },

  // ── Cameras Configuration (Page 6) ──────────────────────────────────
  async wizardScanCamerasForSelect(): Promise<void> {
    const portSelect = document.getElementById('wizard-camera-port-select') as HTMLSelectElement;
    if (!portSelect) return;

    portSelect.innerHTML = '<option value="">Scanning cameras...</option>';

    try {
      const res = await this.api('GET', '/hardware/scan');
      portSelect.innerHTML = '';

      const cameras = res.cameras || [];
      if (cameras.length === 0) {
        portSelect.innerHTML = '<option value="">-- No cameras detected --</option>';
        this.wizardStopCameraPreview();
        return;
      }

      cameras.forEach((cam: any) => {
        const opt = document.createElement('option');
        opt.value = cam.index.toString();
        opt.setAttribute('data-persistent-id', cam.persistent_id);
        opt.textContent = cam.friendly_name;
        portSelect.appendChild(opt);
      });

      // Automatically trigger change event for the first camera
      this.wizardOnCameraPortChange();
    } catch (err) {
      this.log('ERROR', this.t('log.camScanErr') + err);
      portSelect.innerHTML = '<option value="">-- Error scanning cameras --</option>';
      this.wizardStopCameraPreview();
    }
  },

  wizardOnCameraPortChange(): void {
    const portSelect = document.getElementById('wizard-camera-port-select') as HTMLSelectElement;
    const previewImg = document.getElementById('wizard-camera-preview-img') as HTMLImageElement;
    const placeholder = document.getElementById('wizard-camera-preview-placeholder');
    
    if (!portSelect || !previewImg || !placeholder) return;
    
    const sourceVal = portSelect.value;
    if (!sourceVal) {
      this.wizardStopCameraPreview();
      return;
    }
    
    // Set preview source to live feed
    previewImg.src = `/api/setup/camera-preview/feed?source=${sourceVal}`;
    previewImg.style.display = 'block';
    placeholder.style.display = 'none';
  },

  wizardStopCameraPreview(): void {
    const previewImg = document.getElementById('wizard-camera-preview-img') as HTMLImageElement;
    const placeholder = document.getElementById('wizard-camera-preview-placeholder');
    if (previewImg) {
      previewImg.src = '';
      previewImg.style.display = 'none';
    }
    if (placeholder) {
      placeholder.style.display = 'block';
    }
  },

  wizardAddCamera(): void {
    const portSelect = document.getElementById('wizard-camera-port-select') as HTMLSelectElement;
    const roleSelect = document.getElementById('wizard-camera-role-select') as HTMLSelectElement;
    if (!portSelect || !roleSelect) return;
    
    const sourceVal = portSelect.value;
    if (!sourceVal) {
      alert(this.t('alert.selectCamPort'));
      return;
    }
    
    const selectedOption = portSelect.options[portSelect.selectedIndex];
    const persistentId = selectedOption.getAttribute('data-persistent-id') || `camera-index-${sourceVal}`;
    const role = roleSelect.value;
    
    let count = 1;
    let camId = `cam_${role}`;
    while (this.wizardCameras.some(c => c.id === camId)) {
      count++;
      camId = `cam_${role}_${count}`;
    }
    
    if (this.wizardCameras.some(c => String(c.source) === String(sourceVal))) {
      alert(this.t('wiz.camAlreadyAdded'));
      return;
    }
    
    const newCam = {
      id: camId,
      source: isNaN(Number(sourceVal)) ? sourceVal : parseInt(sourceVal),
      device_id: persistentId,
      role: role
    };
    
    this.wizardCameras.push(newCam);
    this.wizardRenderCamerasList();
    this.log('INFO', `Přidána kamera: ${camId} na portu ${sourceVal}`);

    // Reset input fields
    portSelect.value = '';
    this.wizardOnCameraPortChange();
  },

  wizardRemoveCamera(id: string): void {
    this.wizardCameras = this.wizardCameras.filter(c => c.id !== id);
    this.wizardRenderCamerasList();
    this.log('INFO', `Odebrána kamera: ${id}`);
  },

  wizardClearCameras(): void {
    this.wizardCameras = [];
    this.wizardRenderCamerasList();
    this.log('INFO', this.t('log.allCamsRemoved'));
  },

  wizardRenderCamerasList(): void {
    const listEl = document.getElementById('wizard-camera-list');
    if (!listEl) return;
    if (this.wizardCameras.length === 0) {
      listEl.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 4px;">Žádné přidané kamery.</div>';
      return;
    }
    listEl.innerHTML = '';
    this.wizardCameras.forEach(cam => {
      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      item.style.background = 'rgba(255, 255, 255, 0.02)';
      item.style.padding = '6px 10px';
      item.style.border = '1px solid var(--border)';
      item.style.fontSize = '11px';
      item.style.marginBottom = '4px';
      
      const roleText = cam.role === 'overhead' ? 'Overhead (Scéna)' : 'Wrist (Kleště)';
      
      item.innerHTML = `
        <span style="color: var(--text-light); font-weight: 500;">
          [${roleText}] Port: ${cam.source} (${cam.id})
        </span>
        <button class="btn btn-xs btn-danger btn-icon" onclick="App.wizardRemoveCamera('${cam.id}')" title="${App.t('btn.delete')}">✕</button>
      `;
      listEl.appendChild(item);
    });
  },

  async wizardFinish(): Promise<void> {
    const nameInput = document.getElementById('wizard-project-name') as HTMLInputElement;
    const robotSelect = document.getElementById('wizard-robot-select') as HTMLSelectElement;
    const pathInput = document.getElementById('wizard-lerobot-path') as HTMLInputElement;
    const sceneDescInput = document.getElementById('wizard-scene-desc') as HTMLTextAreaElement | null;

    const name = nameInput ? nameInput.value.trim() : 'Pepe';
    const robot = robotSelect ? robotSelect.value : 'SO-ARM 101';
    const path = pathInput ? pathInput.value.trim() : '/home/verlyba/robotics/lerobot';
    const sceneDescription = sceneDescInput ? sceneDescInput.value.trim() : '';

    if (!sceneDescription) {
      alert(this.t('alert.sceneDescRequired'));
      sceneDescInput?.focus();
      return;
    }

    // Map wizardSelectedOption to 'connect' or 'install' expected by backend
    let lerobotOpt = 'connect';
    if (this.wizardSelectedOption === 'install' || this.wizardSelectedOption === 'found-install') {
      lerobotOpt = 'install';
    }

    try {
      this.wizardStopCameraPreview();
      const res = await this.api('POST', '/setup/finish', {
        project_name: name,
        robot_type: robot,
        lerobot_option: lerobotOpt,
        lerobot_path: path,
        leader_port: this.wizardLeaderPort || '',
        leader_device_id: this.wizardLeaderDeviceId || '',
        follower_port: this.wizardFollowerPort || '',
        follower_device_id: this.wizardFollowerDeviceId || '',
        cameras: this.wizardCameras,
        scene_description: sceneDescription
      });

      if (res.ok) {
        localStorage.setItem('orchiday_setup_completed', 'true');
        
        const overlay = document.getElementById('setup-wizard-overlay');
        if (overlay) overlay.style.display = 'none';

        if (res.project) {
          this.onProjectOpened(res.project);
          this.loadProjects();
        }
        
        this.log('SUCCESS', 'Setup wizard dokončen! Projekt ' + name + ' byl vytvořen.');
      } else {
        alert('Chyba při dokončení setupu: ' + (res.error || 'neznámá chyba'));
      }
    } catch (err) {
      alert('Chyba při odesílání setupu: ' + err);
    }
  },

  wizardSkip(): void {
    const msg = this.wizardMode === 'quick' 
      ? 'Opravdu chcete zrušit rychlé nastavení nového projektu?' 
      : 'Opravdu chcete přeskočit průvodce nastavením? Můžete jej dokončit později nebo nastavit projekt ručně.';
    if (confirm(msg)) {
      this.wizardStopCameraPreview();
      if (this.wizardMode !== 'quick') {
        localStorage.setItem('orchiday_setup_completed', 'true');
      }
      const overlay = document.getElementById('setup-wizard-overlay');
      if (overlay) overlay.style.display = 'none';
      this.log('INFO', this.wizardMode === 'quick' ? 'Vytváření projektu zrušeno.' : 'Průvodce nastavením přeskočen.');
      this.loadProjects();
    }
  },

  esc(s: string): string {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  },
};

// Bind to window to allow HTML inline event handlers to execute successfully!
(window as any).App = App;

// ── Boot ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
