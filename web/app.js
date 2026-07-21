"use strict";
/**
 * Orchiday Web Frontend — Upgraded Application Logic (TypeScript)
 *
 * Strict alignment with the PySide6 unified architecture:
 * - 2 Main stacked pages: Setup / Konfigurace (⚙️) and Learning / Sběr dat (🏋️).
 * - Coordinates Environment, Camera feeds, Model Config + CEO Planner split, and Motor Skills + Telemetry split.
 * - Exposes real-time WebSocket bindings for log console, orchestration pipeline, and loss chart telemetry.
 */
const App = {
    ws: null,
    project: null,
    // UI language ('cs' default; falls back to Czech for any untranslated key)
    lang: ((typeof localStorage !== 'undefined' && localStorage.getItem('orchiday_lang')) || 'cs'),
    lossData: [],
    pipelineTasks: [],
    _consoleLines: 0,
    activeStep: 1,
    activeSkill: null,
    activeTrainingSkill: null,
    trainingQueue: [],
    _trainTotalSteps: 0,
    // Running LeRobot subprocesses: key -> kind (teleop/record/train/infer/calibrate/replay/eval/dataset_edit)
    runningProcs: {},
    activeCameras: [],
    availablePorts: [],
    availableCameras: [],
    isProjectLoading: false,
    collapsedFolders: new Set(),
    taggingStartTime: 0,
    taggingActiveIndex: 0,
    taggingPoints: [],
    taggingInterval: null,
    taggingEpisode: -1,
    wizardActivePage: 1,
    wizardSelectedOption: 'install', // 'install' or 'connect'
    wizardLeaderPort: '',
    wizardLeaderDeviceId: '',
    wizardFollowerPort: '',
    wizardFollowerDeviceId: '',
    wizardLeaderSubStep: 1,
    wizardFollowerSubStep: 1,
    wizardLeRobotParentDir: '',
    wizardCameras: [],
    wizardFoundLeRobotPath: '',
    wizardMode: 'initial',
    newProjectSetupMode: 'quick',
    autoDetectActiveArm: 'leader',
    autoDetectLeaderStep: 1,
    autoDetectFollowerStep: 1,
    lastCamerasWidth: '520px',
    cameraLayout: 'auto',
    // Skill/step wizard state
    skillWizardType: 'main',
    skillWizardIsEdit: false,
    skillWizardEditSlug: '',
    skillWizardPrefilledParent: '',
    // ── Internationalization (i18n) ─────────────────────────────────────
    /**
     * Translate a key for the current language, falling back to Czech then the key.
     * Optional `params` substitutes `{name}` placeholders in the translated string.
     */
    t(key, params) {
        const dict = (typeof I18N !== 'undefined' && I18N) || {};
        let s = (dict[this.lang] && dict[this.lang][key]) || (dict.cs && dict.cs[key]) || key;
        if (params) {
            for (const p in params)
                s = s.replace(new RegExp('\\{' + p + '\\}', 'g'), String(params[p]));
        }
        return s;
    },
    /** Apply translations to every tagged element under `root`. */
    applyI18n(root = document) {
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const k = el.getAttribute('data-i18n');
            if (k)
                el.textContent = this.t(k);
        });
        root.querySelectorAll('[data-i18n-html]').forEach(el => {
            const k = el.getAttribute('data-i18n-html');
            if (k)
                el.innerHTML = this.t(k);
        });
        root.querySelectorAll('[data-i18n-ph]').forEach(el => {
            const k = el.getAttribute('data-i18n-ph');
            if (k)
                el.placeholder = this.t(k);
        });
        root.querySelectorAll('[data-i18n-title]').forEach(el => {
            const k = el.getAttribute('data-i18n-title');
            if (k)
                el.title = this.t(k);
        });
        root.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
            const k = el.getAttribute('data-i18n-tooltip');
            if (k)
                el.setAttribute('data-tooltip', this.t(k));
        });
        document.documentElement.lang = this.lang;
        // Keep the language toggle in sync with the active language
        document.querySelectorAll('.lang-toggle [data-lang]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-lang') === this.lang);
        });
    },
    /** Switch language, persist it, and re-render translatable surfaces. */
    setLang(lang) {
        if (lang !== 'cs' && lang !== 'en')
            return;
        this.lang = lang;
        try {
            localStorage.setItem('orchiday_lang', lang);
        }
        catch (_) { }
        this.applyI18n();
        // Reflect the choice in the language toggle buttons
        document.querySelectorAll('.lang-toggle [data-lang]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
        });
        // Re-render dynamically-built surfaces — they bake t() at render time, so
        // they must be rebuilt for the new language (skill trees, robots, cameras…).
        this.rerenderDynamic();
        // Persist server-side (best effort; ignored if no project is open)
        this.api('POST', '/settings', { language: lang }).catch(() => { });
    },
    /** Rebuild all JS-rendered content so it reflects the current language. */
    rerenderDynamic() {
        try {
            if (this.project) {
                this.renderSkillsFull();
                this.renderTrainingSkillsTree();
                this.renderRobots();
                this.renderCameras();
            }
            const dsPage = document.getElementById('page-datasets');
            if (dsPage && dsPage.classList.contains('active-page'))
                this.dsRefreshList();
            const advPage = document.getElementById('page-advancedtraining');
            if (advPage && advPage.classList.contains('active-page'))
                this.advPopulateResumeSkills();
        }
        catch (_) { /* renders are best-effort */ }
    },
    // ── Init ────────────────────────────────────────────────────────────
    init() {
        this.applyI18n();
        this.connectWS();
        this.bindConsoleInput();
        this.bindAutoSlug();
        this.loadProjects();
        this.bindResizers();
        this.bindColumnResizers();
        this.bindModals();
        // Default tab
        this.changeTab('projects');
        // Camera layout setup
        this.cameraLayout = localStorage.getItem('orchiday_camera_layout') || 'auto';
        const layoutSelect = document.getElementById('camera-layout-select');
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
                    }
                    else if (this.wizardActivePage === 5 && this.wizardFollowerSubStep === 2) {
                        e.preventDefault();
                        this.wizardConfirmUnplugArm('follower');
                    }
                }
            }
        });
        window.addEventListener('resize', () => {
            this.drawLossChart();
        });
        // Global keyboard listener for live recording step controls
        window.addEventListener('keydown', (e) => {
            const liveControls = document.getElementById('rec-live-controls');
            const taggingWizard = document.getElementById('rec-tagging-wizard');
            const recordingActive = liveControls && liveControls.style.display === 'flex';
            if (recordingActive) {
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    this.sendRecordingAction('next');
                }
                else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    this.sendRecordingAction('reset');
                }
                else if (e.key === 'Escape') {
                    e.preventDefault();
                    this.sendRecordingAction('stop');
                }
            }
            if (taggingWizard && taggingWizard.style.display === 'flex') {
                if (e.key === ' ' || e.key === '2') {
                    e.preventDefault();
                    this.taggingNextStep();
                }
            }
            // Escape closes the topmost modal dialog (unless a recording session owns the key)
            if (e.key === 'Escape' && !recordingActive) {
                if (this.closeTopModal())
                    e.preventDefault();
            }
        });
    },
    // ── WebSocket Connection ────────────────────────────────────────────
    connectWS() {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const host = location.host || 'localhost:8000';
        this.ws = new WebSocket(`${proto}://${host}/ws`);
        this.ws.onopen = () => {
            const el = document.getElementById('status-ws');
            if (el)
                el.className = 'status-dot connected';
            this.log('SUCCESS', 'Connected to Orchiday server');
            // Re-sync subprocess state after every (re)connect so button gating is accurate
            this.syncRunningProcesses();
        };
        this.ws.onclose = () => {
            const el = document.getElementById('status-ws');
            if (el)
                el.className = 'status-dot error';
            setTimeout(() => this.connectWS(), 3000);
        };
        this.ws.onerror = () => {
            const el = document.getElementById('status-ws');
            if (el)
                el.className = 'status-dot error';
        };
        this.ws.onmessage = (e) => {
            try {
                this.handleEvent(JSON.parse(e.data));
            }
            catch (_) { }
        };
    },
    // ── Real-Time Event Dispatcher ──────────────────────────────────────
    handleEvent(msg) {
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
                break;
            case 'console_output':
                if (data.startsWith('[TELEMETRY]')) {
                    this.handleInferenceTelemetry(data);
                }
                else {
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
                if (rEl)
                    rEl.className = 'status-dot connected';
                this.log('INFO', 'Robot hardware connected successfully');
                break;
            case 'robot_disconnected':
                const rdEl = document.getElementById('status-robot');
                if (rdEl)
                    rdEl.className = 'status-dot';
                this.log('WARN', 'Robot hardware disconnected');
                break;
            case 'model_connection_ok':
                const lmEl = document.getElementById('status-lm');
                if (lmEl)
                    lmEl.className = 'status-dot connected';
                this.log('SUCCESS', `Connection to LM Studio established: ${data}`);
                break;
            case 'model_connection_fail':
                const lmfEl = document.getElementById('status-lm');
                if (lmfEl)
                    lmfEl.className = 'status-dot error';
                this.log('ERROR', `LM Studio model connection failed: ${data.error || data}`);
                break;
            case 'camera_started':
                if (!this.activeCameras)
                    this.activeCameras = [];
                if (!this.activeCameras.includes(data))
                    this.activeCameras.push(data);
                this.renderCameras();
                this.log('SUCCESS', `Camera ${data} started streaming feed`);
                break;
            case 'camera_stopped':
                if (this.activeCameras)
                    this.activeCameras = this.activeCameras.filter(cid => cid !== data);
                this.renderCameras();
                this.log('INFO', `Camera ${data} feed offline`);
                break;
            case 'camera_suspended':
                // A robot process took exclusive access — preview resumes automatically
                if (this.activeCameras)
                    this.activeCameras = this.activeCameras.filter(cid => cid !== data);
                this.renderCameras();
                this.log('INFO', this.t('log.camSuspended', { c: data }));
                break;
            case 'recording_started':
                this.log('INFO', `Demonstration recording started for skill: ${data}`);
                this.updateTrainingStatus(`Recording demonstration for '${data}'...`, 'var(--yellow)');
                const keysG = document.getElementById('rec-keys-guide');
                if (keysG)
                    keysG.style.display = 'block';
                break;
            case 'recording_progress':
                this.log('INFO', `Recording episode progress: ${Math.round(data.progress * 100)}%`);
                this.updateTrainingStatus(`Recording... ${Math.round(data.progress * 100)}%`, 'var(--yellow)');
                break;
            case 'recording_episode':
                this.log('INFO', this.t('log.episodeStarted', { n: data.episode }));
                this.onRecordingEpisodeStarted(data.episode);
                break;
            case 'step_marked':
                // Server-side confirmation of a step mark (also covers other clients)
                if (data && data.undone)
                    this.log('INFO', this.t('log.markUndone'));
                break;
            case 'recording_stopped':
                this.log('SUCCESS', `Demonstration episode recorded successfully for: ${data.skill}`);
                this.updateTrainingStatus(`Recording complete! Saved ${data.episode_count || 0} episodes.`, 'var(--green)');
                const keysGh = document.getElementById('rec-keys-guide');
                if (keysGh)
                    keysGh.style.display = 'none';
                this.finishTaggingPostProcess();
                this.refreshProject();
                break;
            case 'training_started':
                this.log('INFO', this.t('log.trainStarted', { s: data }));
                this.activeTrainingSkill = data;
                if (this.trainingQueue) {
                    this.trainingQueue = this.trainingQueue.filter(s => s !== data);
                }
                this.renderTrainingSkillsTree();
                this.updateTrainingStatus(this.t('status.trainingStep', { s: data }), 'var(--cyan)');
                break;
            case 'training_progress':
                this.addLossPoint(data.epoch, data.loss);
                this.updateTrainingProgress(data.epoch, data.loss, data.skill);
                break;
            case 'training_finished':
                this.log('SUCCESS', this.t('log.trainDone', { s: data.skill }));
                this.updateTrainingStatus(this.t('status.trainDoneCkpt'), 'var(--green)');
                if (data.skill) {
                    const fill = document.getElementById(`train-progress-fill-${data.skill}`);
                    if (fill)
                        fill.style.width = `100%`;
                    const txt = document.getElementById(`train-progress-text-${data.skill}`);
                    if (txt)
                        txt.textContent = this.t('status.done');
                }
                if (this.activeTrainingSkill === data.skill) {
                    this.activeTrainingSkill = null;
                }
                this.refreshProject();
                break;
            case 'training_error':
                this.log('ERROR', this.t('log.trainErr', { s: data.skill, e: data.error }));
                this.updateTrainingStatus(`Chyba: ${data.error}`, 'var(--red)');
                if (data.skill) {
                    const txt = document.getElementById(`train-progress-text-${data.skill}`);
                    if (txt)
                        txt.textContent = `Chyba`;
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
                this.updateOrchStatus(`Active step: ${data}`, 'var(--yellow)');
                const evalTaskEl = document.getElementById('eval-task-name');
                if (evalTaskEl) {
                    evalTaskEl.value = data;
                }
                break;
            case 'orchestration_task_completed':
                this.setPipelineStep(data.task, data.success ? 'done' : 'failed');
                const snapBadgeComp = document.getElementById('vlm-inspect-badge');
                if (snapBadgeComp) {
                    snapBadgeComp.textContent = data.success ? 'Success' : 'Failed';
                    if (data.success) {
                        snapBadgeComp.style.background = 'var(--green-light)';
                        snapBadgeComp.style.color = 'var(--green)';
                    }
                    else {
                        snapBadgeComp.style.background = 'var(--red-light)';
                        snapBadgeComp.style.color = 'var(--red)';
                    }
                }
                break;
            case 'orchestration_locked':
                const latchBanner = document.getElementById('task-latch-card-banner');
                if (latchBanner) {
                    latchBanner.className = 'task-latch-banner locked';
                    const latchIcon = document.getElementById('task-latch-visual-icon');
                    const latchTitle = document.getElementById('task-latch-title-text');
                    const latchDesc = document.getElementById('task-latch-desc-text');
                    if (latchIcon)
                        latchIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
                    if (latchTitle)
                        latchTitle.textContent = 'Task Latch: LOCKED';
                    if (latchDesc)
                        latchDesc.textContent = 'Motor executing at 30 FPS. Async CEO/VLM processing paused for safety.';
                }
                break;
            case 'orchestration_unlocked':
                const latchBannerUn = document.getElementById('task-latch-card-banner');
                if (latchBannerUn) {
                    latchBannerUn.className = 'task-latch-banner unlocked';
                    const latchIcon = document.getElementById('task-latch-visual-icon');
                    const latchTitle = document.getElementById('task-latch-title-text');
                    const latchDesc = document.getElementById('task-latch-desc-text');
                    if (latchIcon)
                        latchIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';
                    if (latchTitle)
                        latchTitle.textContent = 'Task Latch: UNLOCKED';
                    if (latchDesc)
                        latchDesc.textContent = 'Motor finished block. VLM Inspector active on boundaries.';
                }
                break;
            case 'orchestration_vlm_snap':
                const snapImg = document.getElementById('vlm-inspect-image');
                const snapNone = document.getElementById('vlm-inspect-none');
                const snapBadge = document.getElementById('vlm-inspect-badge');
                if (snapImg && snapNone) {
                    snapImg.src = `data:image/jpeg;base64,${data}`;
                    snapImg.style.display = 'block';
                    snapNone.style.display = 'none';
                }
                if (snapBadge) {
                    snapBadge.textContent = 'Verifying...';
                    snapBadge.style.background = 'var(--accent-light)';
                    snapBadge.style.color = 'var(--yellow)';
                }
                break;
            case 'orchestration_finished':
                this.updateOrchStatus(data ? 'CEO task completed successfully!' : 'Completed with errors.', data ? 'var(--green)' : 'var(--yellow)');
                break;
            case 'orchestration_error':
                this.updateOrchStatus(`Error: ${data}`, 'var(--red)');
                break;
            case 'pong':
                break;
        }
    },
    // ── Tab Router (Upgraded for dynamically changing Sidebar content) ────
    // Maps a tab id to its parent navigation category (two-level nav)
    _navCategoryOf(tabId) {
        const map = {
            hardware: 'hardware', hwtools: 'hardware',
            datacollection: 'datasets', datasets: 'datasets',
            learning: 'learning', advancedtraining: 'learning',
            modelrun: 'orchestration', orchestration: 'orchestration',
        };
        return map[tabId] || null;
    },
    // ── Process-aware button gating ─────────────────────────────────────
    hasRunning(kind) {
        return Object.values(this.runningProcs).includes(kind);
    },
    async syncRunningProcesses() {
        try {
            const res = await this.api('GET', '/processes');
            this.runningProcs = res?.processes || {};
        }
        catch (_) {
            this.runningProcs = {};
        }
        this.updateActionButtonStates();
    },
    /**
     * Enable/disable workflow action buttons based on what is actually running.
     * Stop buttons are only active while their process runs; start buttons are
     * blocked while the serial bus is occupied by another robot process.
     */
    updateActionButtonStates() {
        const teleopRunning = this.hasRunning('teleop');
        const recordRunning = this.hasRunning('record');
        const trainRunning = this.hasRunning('train');
        const inferRunning = this.hasRunning('infer');
        const calibrating = this.hasRunning('calibrate');
        const replayRunning = this.hasRunning('replay');
        // Any process holding the robot's serial bus blocks other hardware actions
        const busBusy = teleopRunning || recordRunning || inferRunning || calibrating || replayRunning;
        const setDisabled = (id, disabled, title) => {
            const el = document.getElementById(id);
            if (!el)
                return;
            el.disabled = disabled;
            el.classList.toggle('btn-busy-locked', disabled && busBusy);
            if (title !== undefined)
                el.title = title;
        };
        // Teleoperation
        setDisabled('btn-stop-teleop', !teleopRunning, teleopRunning ? this.t('tip.stopTeleop') : this.t('tip.teleopNotRunning'));
        if (busBusy) {
            setDisabled('btn-start-teleop', true, teleopRunning ? this.t('tip.teleopAlready') : this.t('tip.busBusy'));
        }
        // Recording (any bus-holding process blocks a new recording)
        setDisabled('btn-start-record', busBusy, recordRunning ? this.t('tip.recordAlready') : (busBusy ? this.t('tip.busBusy') : this.t('tip.startsRecord')));
        setDisabled('btn-stop-record', !recordRunning, recordRunning ? this.t('tip.stopsRecord') : this.t('tip.recordNotRunning'));
        // Training (GPU-bound, not bus-bound)
        setDisabled('btn-start-training', trainRunning, trainRunning ? this.t('tip.trainAlready') : this.t('tip.startsTrain'));
        setDisabled('btn-stop-training', !trainRunning, trainRunning ? this.t('tip.stopsTrain') : this.t('tip.trainNotRunning'));
        // Inference / deployment (any bus-holding process blocks a new deployment)
        setDisabled('btn-deploy-policy', busBusy, inferRunning ? this.t('tip.inferAlready') : (busBusy ? this.t('tip.busBusy') : this.t('tip.deploysPolicy')));
        setDisabled('btn-stop-inference', !inferRunning, inferRunning ? this.t('tip.stopsInfer') : this.t('tip.inferNotRunning'));
        // Calibration buttons: block while the bus is in use, otherwise port logic applies
        if (busBusy) {
            setDisabled('btn-calibrate-leader', true, this.t('tip.busBusyShort'));
            setDisabled('btn-calibrate-follower', true, this.t('tip.busBusyShort'));
        }
        // Live status pulse on the teleop indicator (if present)
        const teleBadge = document.getElementById('tele-running-badge');
        if (teleBadge)
            teleBadge.style.display = teleopRunning ? 'inline-flex' : 'none';
    },
    changeTab(tabId) {
        // Guard: Must have active project to select tabs other than 'projects'.
        // The Help page is pure documentation — always accessible.
        if (tabId !== 'projects' && tabId !== 'help' && !this.project) {
            alert(this.t('alert.openProjectFirst'));
            this.changeTab('projects');
            return;
        }
        // Stop camera preview if leaving hardware page
        if (tabId !== 'hardware') {
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
        // 2. Toggles workspace page visibility
        document.querySelectorAll('.workspace .editor-area').forEach(page => {
            page.classList.remove('active-page');
        });
        const activePage = document.getElementById(`page-${tabId}`);
        if (activePage) {
            activePage.classList.add('active-page');
            // Blocks now have real widths — wire up column splitters for this page
            this.initColumnResizers(activePage);
        }
        // 3. Update breadcrumbs trail dynamically
        const bcSection = document.getElementById('breadcrumb-section');
        const bcFile = document.getElementById('breadcrumb-file');
        if (bcSection) {
            if (tabId === 'projects')
                bcSection.textContent = 'projects';
            else if (tabId === 'hardware')
                bcSection.textContent = 'hardware';
            else if (tabId === 'hwtools')
                bcSection.textContent = 'hardware_tools';
            else if (tabId === 'teleoperation')
                bcSection.textContent = 'teleoperation';
            else if (tabId === 'orchestration')
                bcSection.textContent = 'orchestration';
            else if (tabId === 'datacollection')
                bcSection.textContent = 'data_collection';
            else if (tabId === 'datasets')
                bcSection.textContent = 'dataset_tools';
            else if (tabId === 'learning')
                bcSection.textContent = 'learning';
            else if (tabId === 'advancedtraining')
                bcSection.textContent = 'advanced_training';
            else if (tabId === 'modelrun')
                bcSection.textContent = 'model_run';
            else if (tabId === 'settings')
                bcSection.textContent = 'settings';
            else if (tabId === 'help')
                bcSection.textContent = 'help';
        }
        if (bcFile) {
            if (tabId === 'projects')
                bcFile.textContent = 'projects.json';
            else if (tabId === 'hardware')
                bcFile.textContent = 'hardware_config.json';
            else if (tabId === 'hwtools')
                bcFile.textContent = 'lerobot_cli_tools';
            else if (tabId === 'teleoperation')
                bcFile.textContent = 'teleoperation.json';
            else if (tabId === 'orchestration')
                bcFile.textContent = 'orchestration.json';
            else if (tabId === 'datacollection')
                bcFile.textContent = this.activeSkill || 'pick_cube';
            else if (tabId === 'datasets')
                bcFile.textContent = 'edit_dataset';
            else if (tabId === 'learning')
                bcFile.textContent = 'policy_training.json';
            else if (tabId === 'advancedtraining')
                bcFile.textContent = 'eval_and_resume';
            else if (tabId === 'modelrun')
                bcFile.textContent = 'ceo_execution.json';
            else if (tabId === 'settings')
                bcFile.textContent = 'config.json';
            else if (tabId === 'help')
                bcFile.textContent = 'orchestration_schema';
        }
        if (tabId === 'learning') {
            // Sync the policy picker cards with the project's stored architecture
            this.syncPolicyCards();
            // Force chart redraw to fill container
            setTimeout(() => this.drawLossChart(), 100);
            this.api('GET', '/training/status')
                .then(status => {
                this.activeTrainingSkill = status.active_skill;
                this.trainingQueue = status.queue || [];
                this.renderTrainingSkillsTree();
            })
                .catch(err => {
                console.error("Failed to fetch training status", err);
                this.renderTrainingSkillsTree();
            });
        }
        else if (tabId === 'settings') {
            this.loadSysInfo();
        }
        else if (tabId === 'datasets') {
            this.dsRefreshList();
        }
        else if (tabId === 'advancedtraining') {
            this.advPopulateResumeSkills();
        }
    },
    // ── Policy architecture picker (learning page) ──────────────────────
    selectPolicyCard(value) {
        const select = document.getElementById('train-policy-type');
        if (select)
            select.value = value;
        document.querySelectorAll('.policy-pick-card').forEach(card => {
            const active = card.getAttribute('data-value') === value;
            card.classList.toggle('active', active);
            card.setAttribute('aria-checked', active ? 'true' : 'false');
        });
    },
    syncPolicyCards() {
        const stored = this.project?.policy_architecture
            || document.getElementById('train-policy-type')?.value
            || 'act';
        // Only adopt architectures that have a card; otherwise keep the select value as-is
        if (document.querySelector(`.policy-pick-card[data-value="${stored}"]`)) {
            this.selectPolicyCard(stored);
        }
    },
    // ── Hardware Tools page (LeRobot CLI utilities) ─────────────────────
    async runHwTool(tool) {
        const robot = this.project?.robots?.[0];
        const args = [];
        if (tool === 'find_cameras') {
            const backend = document.getElementById('tool-cam-backend')?.value;
            if (backend)
                args.push(backend);
        }
        else if (tool === 'setup_motors') {
            const arm = document.getElementById('tool-motors-arm')?.value || 'follower';
            if (arm === 'leader') {
                const lType = robot?.leader_type || 'so100_leader';
                const lPort = robot?.leader_port || this.project?.leader_port || '';
                if (!lPort) {
                    alert(this.t('alert.noLeaderPort'));
                    return;
                }
                args.push(`--teleop.type=${lType}`, `--teleop.port=${lPort}`);
            }
            else {
                const rType = robot?.follower_type || robot?.type || 'so100_follower';
                const rPort = robot?.follower_port || robot?.port || '';
                if (!rPort) {
                    alert(this.t('alert.noFollowerPort'));
                    return;
                }
                args.push(`--robot.type=${rType}`, `--robot.port=${rPort}`);
            }
        }
        else if (tool === 'find_joint_limits') {
            const rType = robot?.follower_type || robot?.type || 'so100_follower';
            const rPort = robot?.follower_port || robot?.port || '';
            const lType = robot?.leader_type || 'so100_leader';
            const lPort = robot?.leader_port || this.project?.leader_port || '';
            if (!rPort || !lPort) {
                alert(this.t('alert.needBothPorts'));
                return;
            }
            args.push(`--robot.type=${rType}`, `--robot.port=${rPort}`, `--teleop.type=${lType}`, `--teleop.port=${lPort}`);
        }
        this.log('INFO', `Spouštím LeRobot nástroj '${tool}' — výstup v terminálu dole.`);
        this.toggleTerminalOpen();
        const res = await this.api('POST', '/tools/run', { tool, args });
        if (res && res.ok === false) {
            this.log('ERROR', `Nástroj selhal: ${res.error}`);
        }
    },
    async hfLogin() {
        const tokenEl = document.getElementById('tool-hf-token');
        const token = tokenEl?.value.trim() || '';
        if (!token) {
            alert(this.t('alert.enterHfToken'));
            return;
        }
        const res = await this.api('POST', '/tools/hf-login', { token });
        if (res && res.ok) {
            this.log('SUCCESS', 'Přihlášení k Hugging Face Hub proběhlo úspěšně.');
            if (tokenEl)
                tokenEl.value = '';
        }
        else {
            this.log('ERROR', `HF přihlášení selhalo: ${res?.error || 'neznámá chyba'}`);
            alert(`Přihlášení selhalo: ${res?.error || 'neznámá chyba'}`);
        }
    },
    // Ensure the bottom terminal is visible when a tool writes into it
    toggleTerminalOpen() {
        const dock = document.getElementById('bottom-dock-container') || document.getElementById('terminal-area');
        if (dock && dock.style.height === '40px') {
            this.toggleTerminal();
        }
    },
    // ── Dataset Management page ─────────────────────────────────────────
    _dsList: [],
    async dsRefreshList() {
        const res = await this.api('GET', '/datasets/list');
        this._dsList = res?.datasets || [];
        const sel = document.getElementById('ds-select');
        const mergeSel = document.getElementById('ds-merge-source');
        if (!sel)
            return;
        const prev = sel.value;
        const opts = this._dsList.map((d) => `<option value="${this.esc(d.repo_id)}" data-skill="${this.esc(d.skill)}">${this.esc(d.name)} — ${this.esc(d.repo_id)}${d.exists ? '' : ' (zatím nenahráno)'}</option>`).join('');
        sel.innerHTML = opts || '<option value="">-- Žádné datasety v projektu --</option>';
        if (mergeSel)
            mergeSel.innerHTML = '<option value="">-- Vyberte druhý dataset --</option>' + opts;
        if (prev && this._dsList.some((d) => d.repo_id === prev))
            sel.value = prev;
        this.dsOnSelect();
    },
    dsSelectedRepo() {
        return document.getElementById('ds-select')?.value || '';
    },
    dsSelectedSkill() {
        const sel = document.getElementById('ds-select');
        return sel?.selectedOptions[0]?.getAttribute('data-skill') || '';
    },
    async dsOnSelect() {
        const skill = this.dsSelectedSkill();
        const setVal = (id, v) => {
            const el = document.getElementById(id);
            if (el)
                el.textContent = v;
        };
        // Dataset operations only make sense for a dataset that exists on disk
        const setOpsEnabled = (enabled) => {
            ['ds-btn-viz', 'ds-btn-info', 'ds-btn-stats', 'ds-btn-push',
                'ds-btn-del', 'ds-btn-task', 'ds-btn-split', 'ds-btn-merge'].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) {
                    btn.disabled = !enabled;
                    btn.title = enabled ? '' : 'Dataset zatím není nahraný na disku — nejprve nahrajte demonstrace (Sběr dat).';
                }
            });
        };
        const exportBtn = document.getElementById('ds-btn-export-model');
        const splitBtn = document.getElementById('ds-btn-split-steps');
        if (!skill) {
            ['ds-info-exists', 'ds-info-episodes', 'ds-info-fps', 'ds-info-size'].forEach(id => setVal(id, '—'));
            setOpsEnabled(false);
            if (exportBtn)
                exportBtn.disabled = true;
            if (splitBtn)
                splitBtn.disabled = true;
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
                if (nSteps < 2)
                    tip = this.t('tip.splitNeedsSubskills');
                else if (nMarked === 0)
                    tip = this.t('tip.splitNeedsMarks');
                else {
                    enabled = true;
                    tip = this.t('tip.splitSteps');
                }
            }
            else {
                tip = this.t('tip.splitNeedsDataset');
            }
            splitBtn.disabled = !enabled;
            splitBtn.title = tip;
        }
    },
    async splitDatasetSteps() {
        const skill = this.dsSelectedSkill();
        if (!skill) {
            alert(this.t('msg.selectDatasetFirst'));
            return;
        }
        this.log('INFO', this.t('log.splitStart', { s: skill }));
        const res = await this.api('POST', '/datasets/split_steps', { skill_slug: skill });
        if (res && res.ok === false) {
            this.log('ERROR', this.t('log.splitFail', { e: res.error || '?' }));
            alert(res.error || 'Split failed');
        }
    },
    async dsRunOp(operation, params = {}, newRepoId = '') {
        const repo = this.dsSelectedRepo();
        if (!repo && operation !== 'merge') {
            alert('Nejprve vyberte dataset.');
            return;
        }
        this.toggleTerminalOpen();
        const res = await this.api('POST', '/datasets/edit', {
            operation, repo_id: operation === 'merge' ? '' : repo, new_repo_id: newRepoId, params
        });
        if (res && res.ok === false) {
            this.log('ERROR', `Operace '${operation}' selhala: ${res.error}`);
        }
        else {
            this.log('INFO', `Operace '${operation}' spuštěna — průběh v terminálu.`);
        }
    },
    dsDeleteEpisodes() {
        const raw = document.getElementById('ds-del-indices')?.value.trim() || '';
        const indices = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 0);
        if (indices.length === 0) {
            alert(this.t('alert.enterEpIndices'));
            return;
        }
        if (!confirm(`Opravdu smazat epizody [${indices.join(', ')}] z datasetu '${this.dsSelectedRepo()}'? LeRobot vytvoří zálohu.`))
            return;
        this.dsRunOp('delete_episodes', { episode_indices: indices });
    },
    dsModifyTask() {
        const task = document.getElementById('ds-newtask')?.value.trim() || '';
        if (!task) {
            alert(this.t('alert.enterTask'));
            return;
        }
        this.dsRunOp('modify_tasks', { new_task: task });
    },
    dsSplit() {
        const train = parseFloat(document.getElementById('ds-split-train')?.value || '0.8');
        if (isNaN(train) || train <= 0 || train >= 1) {
            alert(this.t('alert.trainSplitRange'));
            return;
        }
        const val = Math.round((1 - train) * 100) / 100;
        this.dsRunOp('split', { splits: { train: train, val: val } });
    },
    dsMerge() {
        const source = this.dsSelectedRepo();
        const other = document.getElementById('ds-merge-source')?.value || '';
        const target = document.getElementById('ds-merge-target')?.value.trim() || '';
        if (!source || !other) {
            alert(this.t('alert.selectBothDs'));
            return;
        }
        if (source === other) {
            alert(this.t('alert.selectTwoDiff'));
            return;
        }
        if (!target) {
            alert(this.t('alert.enterMergeRepo'));
            return;
        }
        this.dsRunOp('merge', { repo_ids: [source, other] }, target);
    },
    async dsPush() {
        const repo = this.dsSelectedRepo();
        const hubId = document.getElementById('ds-hub-id')?.value.trim() || '';
        const priv = document.getElementById('ds-hub-private')?.checked ?? true;
        if (!repo) {
            alert('Nejprve vyberte dataset.');
            return;
        }
        if (!hubId.includes('/')) {
            alert(this.t('alert.hubIdFormat'));
            return;
        }
        this.toggleTerminalOpen();
        const res = await this.api('POST', '/datasets/push', { repo_id: repo, hub_id: hubId, private: priv });
        if (res && res.ok === false)
            this.log('ERROR', `Push selhal: ${res.error}`);
        else
            this.log('INFO', `Nahrávání datasetu na Hub spuštěno — průběh v terminálu.`);
    },
    dsVisualize() {
        const repo = this.dsSelectedRepo();
        if (!repo) {
            alert('Nejprve vyberte dataset.');
            return;
        }
        const ep = parseInt(document.getElementById('ds-viz-episode')?.value || '0', 10) || 0;
        this.toggleTerminalOpen();
        this.api('POST', '/tools/run', { tool: 'dataset_viz', args: [`--repo-id`, repo, `--episode-index`, String(ep)] });
        this.log('INFO', `Spouštím Rerun vizualizaci datasetu ${repo}, epizoda ${ep}...`);
    },
    // ── Advanced Training & Evaluation page ─────────────────────────────
    advPopulateResumeSkills() {
        const sel = document.getElementById('adv-resume-skill');
        if (!sel)
            return;
        const skills = this.project?.skills || [];
        const details = this.project?.skills_details || {};
        const prev = sel.value;
        sel.innerHTML = skills.length
            ? skills.map(s => `<option value="${this.esc(s)}">${this.esc(details[s]?.name || s)} (${this.esc(s)})</option>`).join('')
            : '<option value="">-- Žádné dovednosti v projektu --</option>';
        if (prev && skills.includes(prev))
            sel.value = prev;
    },
    async advResumeTraining() {
        const skill = document.getElementById('adv-resume-skill')?.value || '';
        if (!skill) {
            alert('Vyberte dovednost.');
            return;
        }
        const policy = this.project?.policy_architecture || 'act';
        this.toggleTerminalOpen();
        this.log('INFO', `Pokračuji v tréninku dovednosti '${skill}' (poslední checkpoint, policy=${policy})...`);
        const res = await this.api('POST', '/training/start', { skills: [skill], policy_type: policy });
        if (res && res.ok === false)
            this.log('ERROR', `Resume selhal: ${res.error}`);
    },
    async advStartEval() {
        const policyPath = document.getElementById('adv-eval-policy')?.value.trim() || '';
        const envType = document.getElementById('adv-eval-env')?.value || 'pusht';
        const episodes = parseInt(document.getElementById('adv-eval-episodes')?.value || '10', 10) || 10;
        const device = document.getElementById('adv-eval-device')?.value || 'cuda';
        if (!policyPath) {
            alert('Zadejte cestu k policy checkpointu nebo Hub id.');
            return;
        }
        this.toggleTerminalOpen();
        const res = await this.api('POST', '/eval/start', {
            policy_path: policyPath, env_type: envType, n_episodes: episodes, batch_size: Math.min(episodes, 10), device
        });
        if (res && res.ok === false)
            this.log('ERROR', `Evaluace selhala: ${res.error}`);
        else
            this.log('INFO', `Simulační evaluace v '${envType}' spuštěna — metriky v terminálu.`);
    },
    advInsertTemplate(kind) {
        const templates = {
            peft: '--peft.type=lora --peft.r=16 --peft.lora_alpha=32',
            multigpu: 'accelerate launch --num_processes=2 -m lerobot.scripts.lerobot_train --dataset.repo_id=local/SKILL --policy.type=act --policy.push_to_hub=false',
            rl: 'python -m lerobot.scripts.lerobot_train --policy.type=sac --env.type=gym_hil --policy.push_to_hub=false',
            tokenizer: 'python -m lerobot.scripts.lerobot_train_tokenizer --dataset.repo_id=local/SKILL',
        };
        const tpl = templates[kind];
        if (!tpl)
            return;
        if (kind === 'peft') {
            // PEFT flags belong in the training extra-args field
            const extra = document.getElementById('train-extra-args');
            if (extra) {
                extra.value = (extra.value ? extra.value + ' ' : '') + tpl;
                this.log('INFO', 'PEFT/LoRA argumenty vloženy do pole „Vlastní CLI argumenty“ na stránce Imitační učení.');
                this.changeTab('learning');
                return;
            }
        }
        this.toggleTerminalOpen();
        const input = document.getElementById('console-input');
        if (input) {
            input.value = tpl;
            input.focus();
            this.log('INFO', 'Šablona příkazu vložena do terminálu — upravte SKILL/parametry a potvrďte Enterem.');
        }
    },
    async loadSysInfo() {
        try {
            this.log('INFO', 'Loading system diagnostic information...');
            const sysinfo = await this.api('GET', '/settings/sysinfo');
            if (sysinfo) {
                // Pre-fill paths
                const pyPathInput = document.getElementById('settings-python-path');
                if (pyPathInput)
                    pyPathInput.value = sysinfo.python_path || '';
                const lerobotDirInput = document.getElementById('settings-lerobot-dir-global');
                if (lerobotDirInput)
                    lerobotDirInput.value = sysinfo.lerobot_dir || '';
                const storageDirInput = document.getElementById('settings-dataset-storage-dir');
                const recStorageDirInput = document.getElementById('rec-dataset-storage-dir');
                const val = this.project?.dataset_storage_dir || '';
                if (storageDirInput)
                    storageDirInput.value = val;
                if (recStorageDirInput)
                    recStorageDirInput.value = val;
                const sceneDescInput = document.getElementById('settings-scene-desc');
                if (sceneDescInput)
                    sceneDescInput.value = this.project?.scene_description || '';
                // Populate diagnostic labels
                const lblPyVersion = document.getElementById('diag-python-version');
                if (lblPyVersion)
                    lblPyVersion.textContent = sysinfo.python_version || this.t('val.unknownF');
                const lblLeRobotVersion = document.getElementById('diag-lerobot-version');
                if (lblLeRobotVersion)
                    lblLeRobotVersion.textContent = sysinfo.lerobot_version || 'Nenalezeno';
                const lblCondaEnv = document.getElementById('diag-conda-env');
                if (lblCondaEnv)
                    lblCondaEnv.textContent = sysinfo.conda_env || this.t('val.unknownN');
                const lblMinicondaPath = document.getElementById('diag-miniconda-path');
                if (lblMinicondaPath)
                    lblMinicondaPath.textContent = sysinfo.miniconda_path || 'Nenalezeno';
                this.log('SUCCESS', 'System diagnostic information loaded');
            }
        }
        catch (err) {
            this.log('ERROR', 'Failed to load system diagnostics info.');
        }
    },
    async saveGlobalSettings() {
        const pyPathEl = document.getElementById('settings-python-path');
        const pyPath = pyPathEl ? pyPathEl.value.trim() : '';
        const lerobotDirEl = document.getElementById('settings-lerobot-dir-global');
        const lerobotDir = lerobotDirEl ? lerobotDirEl.value.trim() : '';
        const storageDirEl = document.getElementById('settings-dataset-storage-dir');
        const storageDir = storageDirEl ? storageDirEl.value.trim() : '';
        const sceneDescEl = document.getElementById('settings-scene-desc');
        const sceneDescription = sceneDescEl ? sceneDescEl.value.trim() : '';
        if (this.project && sceneDescEl && !sceneDescription) {
            this.log('WARN', this.t('log.sceneDescEmptyWarn'));
        }
        this.log('INFO', 'Saving global and project settings...');
        const r = await this.api('POST', '/settings', {
            python_path: pyPath,
            lerobot_dir: lerobotDir,
            dataset_storage_dir: storageDir,
            scene_description: sceneDescription
        });
        if (r && r.ok) {
            this.log('SUCCESS', 'Settings saved successfully');
            this.loadSysInfo();
        }
        else {
            this.log('ERROR', 'Failed to save settings');
        }
    },
    // ── API Communicator ────────────────────────────────────────────────
    async api(method, path, body) {
        const host = location.host || 'localhost:8000';
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        if (body)
            opts.body = JSON.stringify(body);
        const r = await fetch(`http://${host}/api${path}`, opts);
        return r.json();
    },
    // ── Projects Controller ─────────────────────────────────────────────
    async loadProjects() {
        try {
            const data = await this.api('GET', '/projects');
            this.renderProjectList(data.projects || [], data.recent || []);
            const cur = await this.api('GET', '/project');
            if (cur.project)
                this.onProjectOpened(cur.project);
        }
        catch (_) { }
    },
    renderProjectList(projects, recent) {
        const all = projects.length ? projects : recent.map(r => ({ name: r.name, _path: r.path, slug: r.slug, skills: [], robots: r.robots || [] }));
        // Main project manager grid
        const el = document.getElementById('project-list');
        if (el) {
            let cardsHtml = all.map(p => {
                const isActive = this.project && this.project.path === p._path;
                // Determine robot type from config
                const robot = (p.robots && p.robots.length > 0) ? p.robots[0] : null;
                let robotLabel = this.t('val.notConfigured');
                let robotClass = 'none';
                if (robot) {
                    const typeLower = (robot.type || robot.follower_type || '').toLowerCase();
                    if (typeLower.includes('soarm') || typeLower.includes('so-arm')) {
                        robotLabel = 'SO-ARM 101';
                        robotClass = 'soarm101';
                    }
                    else if (typeLower.includes('so100') || typeLower.includes('so-100')) {
                        robotLabel = 'SO-100';
                        robotClass = 'so100';
                    }
                    else if (typeLower.includes('koch')) {
                        robotLabel = 'Koch v1.1';
                        robotClass = 'koch';
                    }
                    else if (typeLower.includes('aloha')) {
                        robotLabel = 'Aloha';
                        robotClass = 'aloha';
                    }
                    else if (typeLower.includes('moss')) {
                        robotLabel = 'Moss v1';
                        robotClass = 'moss';
                    }
                    else if (typeLower.includes('stretch')) {
                        robotLabel = 'Stretch';
                        robotClass = 'stretch';
                    }
                    else if (typeLower.includes('lekiwi')) {
                        robotLabel = 'LeKiwi';
                        robotClass = 'lekiwi';
                    }
                    else {
                        robotLabel = robot.type || robot.follower_type || 'Custom';
                        robotClass = 'custom';
                    }
                }
                return `
          <div class="project-card fade-in ${isActive ? 'active' : ''}" onclick="App.openProject(this.dataset.path)" data-path="${this.esc(p._path || '')}">
            <button class="project-delete-btn" onclick="App.deleteProject(this.closest('.project-card').dataset.path, event)" title="Smazat projekt">✕</button>
            ${isActive ? `
              <div class="project-active-check">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
            ` : ''}
            <div class="project-name">${this.esc(p.name)}</div>
            <div class="project-meta">${p.slug || ''} ${p.created_at ? '· ' + new Date(p.created_at).toLocaleDateString() : ''}</div>
            
            <div class="robot-badge ${robotClass}">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:2px;"><rect x="4" y="4" width="4" height="16" rx="1"></rect><rect x="12" y="10" width="8" height="10" rx="1"></rect><path d="M8 8h4v4H8z"></path></svg>
              ${robotLabel}
            </div>

            <div class="project-skills">${(p.skills_names || p.skills || []).map((s) => `<span class="skill-tag">${s}</span>`).join('')}</div>
          </div>
        `;
            }).join('');
            // Append the empty placeholder card at the end
            cardsHtml += `
        <div class="project-card empty-project-card fade-in" onclick="App.showNewProjectModal()">
          <div class="plus-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </div>
          <div class="empty-card-title">Nový Projekt</div>
          <div class="empty-card-desc">Konfigurace s průvodcem nebo prostý projekt</div>
        </div>
      `;
            el.innerHTML = cardsHtml;
        }
        // Sidebar small project shortcuts
        const sideEl = document.getElementById('sidebar-projects-list-container');
        if (sideEl) {
            if (!all.length) {
                sideEl.innerHTML = `<div style="font-size: 10px; color: var(--text-muted);">${App.t('hint.noProjects')}</div>`;
            }
            else {
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
    showNewProjectModal() {
        this.showNewProjectModeSelection();
        this.openModal('modal-new-project');
    },
    showNewProjectModeSelection() {
        const title = document.getElementById('new-project-modal-title');
        const selection = document.getElementById('new-project-mode-selection');
        const detailsForm = document.getElementById('new-project-details-form');
        const footer = document.getElementById('new-project-modal-footer');
        if (title)
            title.textContent = this.t('modal.newProjectTitle');
        if (selection)
            selection.style.display = 'block';
        if (detailsForm)
            detailsForm.style.display = 'none';
        if (footer)
            footer.style.display = 'none';
    },
    selectNewProjectModeDirect(mode) {
        this.newProjectSetupMode = mode;
        if (mode === 'quick') {
            this.closeModal('modal-new-project');
            this.showSetupWizard('quick');
        }
        else {
            const title = document.getElementById('new-project-modal-title');
            const selection = document.getElementById('new-project-mode-selection');
            const detailsForm = document.getElementById('new-project-details-form');
            const footer = document.getElementById('new-project-modal-footer');
            if (title)
                title.textContent = this.t('modal.plainProjectTitle');
            if (selection)
                selection.style.display = 'none';
            if (detailsForm)
                detailsForm.style.display = 'flex';
            if (footer)
                footer.style.display = 'flex';
            const nameInput = document.getElementById('new-project-name');
            if (nameInput) {
                nameInput.value = '';
                nameInput.focus();
            }
            const slugInput = document.getElementById('new-project-slug');
            if (slugInput)
                slugInput.value = '';
            const sceneDescInput = document.getElementById('new-project-scene-desc');
            if (sceneDescInput)
                sceneDescInput.value = '';
        }
    },
    async createProject() {
        const name = document.getElementById('new-project-name').value.trim();
        const slug = document.getElementById('new-project-slug').value.trim();
        const parentDir = document.getElementById('new-project-parent-dir')?.value.trim() || '';
        const sceneDescription = document.getElementById('new-project-scene-desc')?.value.trim() || '';
        if (!name || !slug)
            return;
        if (!sceneDescription) {
            alert(this.t('alert.sceneDescRequired'));
            return;
        }
        const r = await this.api('POST', '/projects', { name, slug, parent_dir: parentDir, scene_description: sceneDescription });
        if (r.ok) {
            this.closeModal('modal-new-project');
            this.loadProjects();
        }
        else {
            this.log('ERROR', r.error || 'Failed to create project');
            alert('Chyba při vytváření projektu: ' + (r.error || 'neznámá chyba'));
        }
    },
    async openProject(path) {
        if (!path)
            return;
        await this.api('POST', '/projects/open', { path });
    },
    async deleteProject(path, event) {
        event.stopPropagation();
        if (!confirm(this.t('confirm.deleteProject'))) {
            return;
        }
        const r = await this.api('POST', '/projects/delete', { path });
        if (r.ok) {
            if (this.project && this.project.path === path) {
                this.onProjectClosed();
            }
            this.loadProjects();
        }
        else {
            alert('Chyba při mazání projektu: ' + (r.error || 'neznámá chyba'));
        }
    },
    onProjectOpened(data) {
        this.isProjectLoading = true;
        this.project = data.project || data;
        this.activeCameras = data.active_cameras || [];
        // Update global workspace badge in Title bar
        const titleBarActive = document.getElementById('title-active-project');
        if (titleBarActive && this.project) {
            titleBarActive.textContent = this.project.name;
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
        this.renderTrainingSkillsTree();
        this.loadModelConfig();
        this.scanHardware().then(() => {
            this.prefillWorkflowData();
            this.isProjectLoading = false;
            this.startAllProjectCameras();
        }).catch(() => {
            this.isProjectLoading = false;
        });
    },
    onProjectClosed() {
        this.project = null;
        this.activeCameras = [];
        // Reset global workspace badge in Title bar
        const titleBarActive = document.getElementById('title-active-project');
        if (titleBarActive) {
            titleBarActive.textContent = this.t('title.noProject');
        }
        // Reset unified global project badges across all tabs!
        document.querySelectorAll('.project-badge-global').forEach(badge => {
            badge.textContent = 'No project loaded';
        });
        this.changeTab('projects');
        this.loadProjects();
    },
    /** Update active/checked state on existing project cards without refetching from server. */
    updateProjectCardsActiveState() {
        const activePath = this.project?.path || '';
        // Update main project grid cards
        document.querySelectorAll('#project-list .project-card:not(.empty-project-card)').forEach(card => {
            const cardPath = card.dataset.path || '';
            const isActive = !!(activePath && cardPath === activePath);
            card.classList.toggle('active', isActive);
            // Add or remove checkmark badge
            let check = card.querySelector('.project-active-check');
            if (isActive && !check) {
                const div = document.createElement('div');
                div.className = 'project-active-check';
                div.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                card.insertBefore(div, card.children[1]); // after delete button
            }
            else if (!isActive && check) {
                check.remove();
            }
        });
        // Update sidebar project shortcuts
        document.querySelectorAll('#sidebar-projects-list-container .sidebar-project-item').forEach(item => {
            const itemPath = item.dataset.path || '';
            item.classList.toggle('active', !!(activePath && itemPath === activePath));
        });
    },
    async refreshProject() {
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
                }
                else if (skills.length > 0) {
                    this.selectSkill(skills[0]);
                }
                else {
                    const emptyState = document.getElementById('rec-empty-state');
                    const activePanel = document.getElementById('rec-active-panel');
                    if (emptyState)
                        emptyState.style.display = 'flex';
                    if (activePanel)
                        activePanel.style.display = 'none';
                }
                await this.scanHardware();
                this.prefillWorkflowData();
                const dock = document.getElementById('docked-cameras-area');
                if (dock && dock.style.width !== '0px') {
                    this.startAllProjectCameras();
                }
            }
        }
        catch (_) { }
    },
    // ── Hardware Scan & Dynamic Pair ────────────────────────────────────
    async scanHardware() {
        try {
            const res = await this.api('GET', '/hardware/scan');
            this.availablePorts = res.ports || [];
            this.availableCameras = res.cameras || [];
            this.populatePortDropdowns();
            this.populateCameraDropdowns();
        }
        catch (err) {
            this.log('WARN', 'Failed to scan USB/serial or video hardware devices.');
        }
    },
    populatePortDropdowns() {
        const dropdownIds = ['robot-port', 'tele-leader-port', 'tele-follower-port'];
        dropdownIds.forEach(id => {
            const select = document.getElementById(id);
            if (!select)
                return;
            const currentVal = select.value || select.getAttribute('data-last-val');
            let html = `<option value="">-- Vyberte port --</option>`;
            this.availablePorts.forEach(p => {
                html += `<option value="${p.device}" data-persistent-id="${p.persistent_id}">${this.esc(p.friendly_name)}</option>`;
            });
            html += `<option value="__custom__">Ruční zadání cesty...</option>`;
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
    populateCameraDropdowns() {
        const select = document.getElementById('camera-source');
        if (select) {
            const currentVal = select.value || select.getAttribute('data-last-val');
            let html = `<option value="">-- Vyberte kameru --</option>`;
            this.availableCameras.forEach(c => {
                html += `<option value="${c.index}" data-persistent-id="${c.persistent_id}">${this.esc(c.friendly_name)}</option>`;
            });
            html += `<option value="__custom__">Ruční index nebo URL...</option>`;
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
        const hwSelect = document.getElementById('hw-camera-port-select');
        if (hwSelect) {
            const currentVal = hwSelect.value || hwSelect.getAttribute('data-last-val');
            let html = `<option value="">-- Vyberte port kamery --</option>`;
            this.availableCameras.forEach(c => {
                html += `<option value="${c.index}" data-persistent-id="${c.persistent_id}">${this.esc(c.friendly_name)}</option>`;
            });
            html += `<option value="__custom__">Ruční index nebo URL...</option>`;
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
    onRobotPortSelectChange() {
        const select = document.getElementById('robot-port');
        if (select && select.value === '__custom__') {
            const val = prompt(this.t('prompt.robotPort'), select.getAttribute('data-last-val') || '/dev/ttyUSB0');
            if (val && val.trim()) {
                let opt = select.querySelector(`option[value="${val.trim()}"]`);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = val.trim();
                    opt.textContent = val.trim();
                    select.insertBefore(opt, select.lastElementChild);
                }
                select.value = val.trim();
                select.setAttribute('data-last-val', val.trim());
            }
            else {
                select.value = select.getAttribute('data-last-val') || '';
            }
        }
        else if (select) {
            select.setAttribute('data-last-val', select.value);
        }
    },
    onCameraSourceSelectChange() {
        const select = document.getElementById('camera-source');
        if (select && select.value === '__custom__') {
            const val = prompt(this.t('prompt.cameraIndex'), select.getAttribute('data-last-val') || '0');
            if (val && val.trim()) {
                let opt = select.querySelector(`option[value="${val.trim()}"]`);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = val.trim();
                    opt.textContent = val.trim();
                    select.insertBefore(opt, select.lastElementChild);
                }
                select.value = val.trim();
                select.setAttribute('data-last-val', val.trim());
            }
            else {
                select.value = select.getAttribute('data-last-val') || '';
            }
        }
        else if (select) {
            select.setAttribute('data-last-val', select.value);
        }
    },
    onTelePortChange(role) {
        const select = document.getElementById(`tele-${role}-port`);
        if (select && select.value === '__custom__') {
            const val = prompt(`Zadejte ručně cestu k portu pro ${role.toUpperCase()} arm:`, select.getAttribute('data-last-val') || (role === 'leader' ? '/dev/ttyUSB1' : '/dev/ttyUSB0'));
            if (val && val.trim()) {
                let opt = select.querySelector(`option[value="${val.trim()}"]`);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = val.trim();
                    opt.textContent = val.trim();
                    select.insertBefore(opt, select.lastElementChild);
                }
                select.value = val.trim();
                select.setAttribute('data-last-val', val.trim());
            }
            else {
                select.value = select.getAttribute('data-last-val') || '';
            }
        }
        else if (select) {
            select.setAttribute('data-last-val', select.value);
        }
        // Auto-save port changes immediately
        this.saveSettingsState();
        this.updateHardwareButtonStates();
    },
    updateHardwareButtonStates() {
        const leaderPort = document.getElementById('tele-leader-port')?.value || '';
        const followerPort = document.getElementById('tele-follower-port')?.value || '';
        const leaderType = document.getElementById('tele-leader-type')?.value || '';
        const followerType = document.getElementById('tele-follower-type')?.value || '';
        // Sync active hardware info labels to teleoperation page
        const infoRobotEl = document.getElementById('tele-info-robot-type');
        const infoLeaderPortEl = document.getElementById('tele-info-leader-port');
        const infoLeaderTypeEl = document.getElementById('tele-info-leader-type');
        const infoFollowerPortEl = document.getElementById('tele-info-follower-port');
        if (infoRobotEl)
            infoRobotEl.textContent = followerType ? followerType.replace('_follower', '').toUpperCase() : '-';
        if (infoLeaderPortEl)
            infoLeaderPortEl.textContent = leaderPort || '-';
        if (infoLeaderTypeEl)
            infoLeaderTypeEl.textContent = leaderType ? leaderType.replace('_leader', '').toUpperCase() : '-';
        if (infoFollowerPortEl)
            infoFollowerPortEl.textContent = followerPort || '-';
        const btnCalLeader = document.getElementById('btn-calibrate-leader');
        const btnCalFollower = document.getElementById('btn-calibrate-follower');
        const btnStartTele = document.getElementById('btn-start-teleop');
        if (btnCalLeader) {
            if (leaderPort) {
                btnCalLeader.className = 'btn btn-xs btn-success';
                btnCalLeader.disabled = false;
            }
            else {
                btnCalLeader.className = 'btn btn-xs btn-secondary';
                btnCalLeader.disabled = true;
            }
        }
        if (btnCalFollower) {
            if (followerPort) {
                btnCalFollower.className = 'btn btn-xs btn-success';
                btnCalFollower.disabled = false;
            }
            else {
                btnCalFollower.className = 'btn btn-xs btn-secondary';
                btnCalFollower.disabled = true;
            }
        }
        if (btnStartTele) {
            const canStart = !!leaderPort && !!followerPort;
            if (canStart) {
                btnStartTele.className = 'btn btn-xs btn-primary';
                btnStartTele.disabled = false;
                btnStartTele.title = this.t('tip.startsTeleop');
            }
            else {
                btnStartTele.className = 'btn btn-xs btn-secondary';
                btnStartTele.disabled = true;
                btnStartTele.title = 'Nejprve vyberte leader i follower port (Hardware → Konfigurace)';
            }
        }
        // Re-apply running-process gating on top of the port-based logic
        this.updateActionButtonStates();
    },
    // ── Hardware Page Auto-detection & Cameras ───────────────────────
    async hwStartDetectArm(role) {
        try {
            this.log('INFO', `Spouštím skenování portů pro detekci ${role} ramene...`);
            const res = await this.api('POST', '/setup/detect-arms/start');
            if (res.ok) {
                const step1El = document.getElementById(`hw-${role}-step-1`);
                const step2El = document.getElementById(`hw-${role}-step-2`);
                const step3El = document.getElementById(`hw-${role}-step-3`);
                if (step1El)
                    step1El.style.display = 'none';
                if (step2El)
                    step2El.style.display = 'block';
                if (step3El)
                    step3El.style.display = 'none';
            }
        }
        catch (err) {
            alert(`Chyba při zahájení detekce: ${err}`);
        }
    },
    async hwConfirmUnplugArm(role) {
        try {
            this.log('INFO', `Ověřuji odpojené zařízení pro ${role} rameno...`);
            const res = await this.api('POST', '/setup/detect-arms/unplugged');
            if (res.ok && res.device) {
                const step1El = document.getElementById(`hw-${role}-step-1`);
                const step2El = document.getElementById(`hw-${role}-step-2`);
                const step3El = document.getElementById(`hw-${role}-step-3`);
                if (step1El)
                    step1El.style.display = 'none';
                if (step2El)
                    step2El.style.display = 'none';
                if (step3El)
                    step3El.style.display = 'block';
                const textEl = document.getElementById(`hw-${role}-detected-text`);
                if (textEl) {
                    textEl.textContent = `Detekováno: ${res.device} (${res.persistent_id})`;
                }
                // Save persistent ID and update select values
                if (role === 'leader') {
                    const leaderIdInput = document.getElementById('tele-leader-id');
                    if (leaderIdInput)
                        leaderIdInput.value = res.persistent_id;
                    const selectEl = document.getElementById('tele-leader-port');
                    if (selectEl) {
                        let opt = selectEl.querySelector(`option[value="${res.device}"]`);
                        if (!opt) {
                            opt = document.createElement('option');
                            opt.value = res.device;
                            opt.textContent = `${res.device} (${res.persistent_id})`;
                            selectEl.appendChild(opt);
                        }
                        selectEl.value = res.device;
                        this.onTelePortChange('leader');
                    }
                }
                else {
                    const followerIdInput = document.getElementById('tele-follower-id');
                    if (followerIdInput)
                        followerIdInput.value = res.persistent_id;
                    const selectEl = document.getElementById('tele-follower-port');
                    if (selectEl) {
                        let opt = selectEl.querySelector(`option[value="${res.device}"]`);
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
            }
            else {
                alert(res.error || this.t('alert.detectFailed'));
            }
        }
        catch (err) {
            alert(`Chyba při detekci odpojení: ${err}`);
        }
    },
    hwResetDetectArm(role) {
        const step1El = document.getElementById(`hw-${role}-step-1`);
        const step2El = document.getElementById(`hw-${role}-step-2`);
        const step3El = document.getElementById(`hw-${role}-step-3`);
        if (step1El)
            step1El.style.display = 'block';
        if (step2El)
            step2El.style.display = 'none';
        if (step3El)
            step3El.style.display = 'none';
    },
    hwOnCameraPortChange() {
        const portSelect = document.getElementById('hw-camera-port-select');
        const previewImg = document.getElementById('hw-camera-preview-img');
        const placeholder = document.getElementById('hw-camera-preview-placeholder');
        if (!portSelect || !previewImg || !placeholder)
            return;
        if (portSelect.value === '__custom__') {
            const val = prompt(this.t('prompt.cameraIndex'), portSelect.getAttribute('data-last-val') || '0');
            if (val && val.trim()) {
                let opt = portSelect.querySelector(`option[value="${val.trim()}"]`);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = val.trim();
                    opt.textContent = val.trim();
                    portSelect.insertBefore(opt, portSelect.lastElementChild);
                }
                portSelect.value = val.trim();
                portSelect.setAttribute('data-last-val', val.trim());
            }
            else {
                portSelect.value = portSelect.getAttribute('data-last-val') || '';
            }
        }
        else {
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
    },
    hwStopCameraPreview() {
        const previewImg = document.getElementById('hw-camera-preview-img');
        const placeholder = document.getElementById('hw-camera-preview-placeholder');
        if (previewImg) {
            previewImg.src = '';
            previewImg.style.display = 'none';
        }
        if (placeholder) {
            placeholder.style.display = 'block';
        }
    },
    async hwAddCamera() {
        const portSelect = document.getElementById('hw-camera-port-select');
        const roleSelect = document.getElementById('hw-camera-role-select');
        if (!portSelect || !roleSelect)
            return;
        let source = portSelect.value;
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
    async hwClearCameras() {
        const cams = this.project?.cameras || [];
        if (!cams.length)
            return;
        this.log('INFO', this.t('log.removingAllCams'));
        for (const c of cams) {
            await this.api('DELETE', `/cameras/${c.id}`);
        }
        this.refreshProject();
    },
    // ── Robot Hardware Management ───────────────────────────────────────
    renderRobots() {
        const el = document.getElementById('robot-list');
        if (!el)
            return;
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
    showAddRobotModal() {
        this.scanHardware();
        this.openModal('modal-add-robot');
    },
    async addRobot() {
        const id = document.getElementById('robot-id').value.trim();
        const type = document.getElementById('robot-type').value;
        const select = document.getElementById('robot-port');
        let port = select ? select.value : '';
        let deviceId = '';
        if (port === '__custom__') {
            port = document.getElementById('robot-port-custom').value.trim();
        }
        else if (port && select) {
            const opt = select.options[select.selectedIndex];
            deviceId = opt.getAttribute('data-persistent-id') || '';
        }
        if (!id)
            return;
        await this.api('POST', '/robots', { id, type, port, device_id: deviceId });
        this.closeModal('modal-add-robot');
        this.refreshProject();
    },
    async removeRobot(id) {
        await this.api('DELETE', `/robots/${id}`);
        this.refreshProject();
    },
    async calibrateRobot(id) {
        this.log('INFO', `Starting calibration for robot ${id}...`);
        await this.api('POST', `/robots/${id}/calibrate`);
    },
    async calibrateArm(role) {
        const robotType = document.getElementById('robot-type-select')?.value || 'so100';
        const select = document.getElementById(`tele-${role}-port`);
        let port = select ? select.value : '';
        if (port === '__custom__') {
            port = document.getElementById(`tele-${role}-port-custom`)?.value.trim() || '';
        }
        const id = document.getElementById(`tele-${role}-id`)?.value || `my_${role}_arm`;
        const type = role === 'leader' ? `${robotType}_leader` : robotType;
        if (!port) {
            const msg = `Port sériového připojení pro rameno ${role.toUpperCase()} není vybrán!`;
            this.log('ERROR', msg);
            alert(msg);
            return;
        }
        this.log('INFO', `Spouštím kalibraci pro ${role} rameno (${id}) na portu ${port}...`);
        await this.api('POST', '/hardware/calibrate', {
            robot_type: type,
            robot_id: id,
            port: port
        });
    },
    // ── Camera Management ───────────────────────────────────────────────
    renderCameras() {
        // Clear any customized aspect-ratios first so they can fall back to CSS default 4:3
        document.querySelectorAll('.cam-box').forEach(box => {
            box.style.aspectRatio = '';
        });
        const cams = this.project?.cameras || [];
        // Determine layout count to show
        let displayCount = 2; // Default fallback count
        if (this.cameraLayout === 'auto') {
            displayCount = cams.length || 2;
        }
        else {
            displayCount = parseInt(this.cameraLayout, 10) || 2;
        }
        // Dynamically render the docked cameras panel contents
        const dockBody = document.querySelector('.cameras-dock-body');
        if (dockBody) {
            dockBody.style.setProperty('display', 'grid', 'important');
            dockBody.style.setProperty('gap', '6px', 'important');
            dockBody.style.setProperty('padding', '6px', 'important');
            dockBody.style.setProperty('align-items', 'stretch', 'important');
            dockBody.style.setProperty('justify-content', 'stretch', 'important');
            if (displayCount === 1) {
                dockBody.style.setProperty('grid-template-columns', '1fr', 'important');
                dockBody.style.setProperty('grid-template-rows', '1fr', 'important');
            }
            else if (displayCount === 2) {
                dockBody.style.setProperty('grid-template-columns', '1fr 1fr', 'important');
                dockBody.style.setProperty('grid-template-rows', '1fr', 'important');
            }
            else {
                dockBody.style.setProperty('grid-template-columns', '1fr 1fr', 'important');
                dockBody.style.setProperty('grid-template-rows', '1fr 1fr', 'important');
            }
            let dockHtml = '';
            for (let i = 0; i < displayCount; i++) {
                const c = cams[i];
                if (c) {
                    const isActive = (this.activeCameras || []).includes(c.id);
                    dockHtml += `
            <div class="cam-box" style="position: relative; background: #000; border-radius: var(--radius); overflow: hidden; display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; height: 100% !important; border: 1px solid var(--border); box-sizing: border-box;">
              <span class="cam-tag" style="position: absolute; top: 4px; left: 4px; z-index: 10; background: rgba(0,0,0,0.6); padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; color: var(--text-light); text-transform: uppercase;">
                ${this.esc(c.id)} (${this.esc(c.role)})
              </span>
              <div id="tele-cam-feed-placeholder-${i + 1}" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
                ${isActive
                        ? '<img src="/api/cameras/' + c.id + '/feed" onload="App.adjustCameraAspectRatio(this)" style="width:100%; height:100%; object-fit:cover;" />'
                        : '<span style="font-size: 9px; color: var(--text-muted);">Kamera ' + this.esc(c.id) + ' offline</span>'}
              </div>
            </div>
          `;
                }
                else {
                    dockHtml += `
            <div class="cam-box" style="position: relative; background: #000; border-radius: var(--radius); overflow: hidden; display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; height: 100% !important; border: 1px dashed var(--border-dark); box-sizing: border-box;">
              <span class="cam-tag" style="position: absolute; top: 4px; left: 4px; z-index: 10; background: rgba(0,0,0,0.4); padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; color: var(--text-muted); text-transform: uppercase;">
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
        const el = document.getElementById('hw-camera-list');
        if (!el)
            return;
        if (!cams.length) {
            el.innerHTML = '<div class="empty-state-text">' + this.t('hint.noCamsConfigured') + '</div>';
            const placeholder1 = document.getElementById('cam-feed-placeholder-1');
            if (placeholder1)
                placeholder1.innerHTML = '<span>' + this.t('hint.noCamInProject') + '</span>';
            const placeholder2 = document.getElementById('cam-feed-placeholder-2');
            if (placeholder2)
                placeholder2.innerHTML = '<span>' + this.t('hint.noCamInProject') + '</span>';
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
                : '<button class="btn btn-xs btn-success" onclick="App.startCamera(\'' + c.id + '\')">Start</button>'}
              <button class="btn btn-xs btn-danger btn-icon" onclick="App.removeCamera(\'' + c.id + '\')" title="${App.t('btn.delete')}">✕</button>
            </div>
          </div>
          ${isActive
                ? '<div class="camera-feed-container"><img src="/api/cameras/' + c.id + '/feed" class="camera-feed-img" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';" /><div style="display:none; align-items:center; justify-content:center; width:100%; height:100%; font-size:9px; color:var(--text-muted);">' + App.t('hint.streamFailed') + '</div></div>'
                : '<div class="camera-offline">' + App.t('hint.camOffline') + '</div>'}
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
                }
                else {
                    placeholder.innerHTML = '<span>Kamera ' + c.id + ' (' + c.role + ') offline</span>';
                }
            }
            const telePlaceholder = document.getElementById('tele-cam-feed-placeholder-' + (idx + 1));
            if (telePlaceholder) {
                if (isActive) {
                    telePlaceholder.innerHTML = '<img src="/api/cameras/' + c.id + '/feed" onload="App.adjustCameraAspectRatio(this)" style="width:100%; height:100%; object-fit:cover;" />';
                }
                else {
                    telePlaceholder.innerHTML = '<span>Kamera ' + c.id + ' (' + c.role + ') offline</span>';
                }
            }
        });
    },
    onCameraLayoutChange() {
        const select = document.getElementById('camera-layout-select');
        if (select) {
            this.cameraLayout = select.value;
            localStorage.setItem('orchiday_camera_layout', this.cameraLayout);
            this.renderCameras();
        }
    },
    adjustCameraAspectRatio(img) {
        if (img && img.naturalWidth && img.naturalHeight) {
            const camBox = img.closest('.cam-box');
            if (camBox) {
                camBox.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
            }
        }
    },
    showAddCameraModal() {
        this.scanHardware();
        this.openModal('modal-add-camera');
    },
    async addCamera() {
        const id = document.getElementById('camera-id').value.trim();
        const select = document.getElementById('camera-source');
        let source = select ? select.value : '';
        let deviceId = '';
        if (source === '__custom__') {
            source = document.getElementById('camera-source-custom').value.trim();
        }
        else if (source !== '' && select) {
            const opt = select.options[select.selectedIndex];
            deviceId = opt.getAttribute('data-persistent-id') || '';
        }
        const role = document.getElementById('camera-role').value;
        if (!id)
            return;
        const parsedSource = (source === '' || isNaN(Number(source))) ? source : parseInt(source, 10);
        await this.api('POST', '/cameras', { id, source: parsedSource, device_id: deviceId, role });
        this.closeModal('modal-add-camera');
        this.refreshProject();
    },
    async removeCamera(id) {
        await this.api('DELETE', `/cameras/${id}`);
        this.refreshProject();
    },
    async startCamera(id) { await this.api('POST', `/cameras/${id}/start`); },
    async stopCamera(id) { await this.api('POST', `/cameras/${id}/stop`); },
    async startAllProjectCameras() {
        const cams = this.project?.cameras || [];
        for (const c of cams) {
            if (!(this.activeCameras || []).includes(c.id)) {
                this.log('INFO', `Starting camera ${c.id}...`);
                await this.startCamera(c.id);
            }
        }
    },
    // ── Workflow Stepper ────────────────────────────────────────────────
    setDropdownOrCustomValue(selectId, value) {
        const select = document.getElementById(selectId);
        if (!select)
            return;
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
    prefillWorkflowData() {
        const robots = this.project?.robots || [];
        const skills = this.project?.skills || [];
        const activeRobot = robots[0] || { id: 'my_follower_arm', type: 'so100', port: '/dev/ttyUSB0' };
        const activeSkill = this.activeSkill || skills[0] || 'pick_cube';
        // Prefill Step 1: Teleop
        const leaderIdEl = document.getElementById('tele-leader-id');
        if (leaderIdEl) {
            leaderIdEl.value = `${activeRobot.id.replace('_follower', '')}_leader`;
        }
        // Prefill leader port ONLY if it is physically scanned and available
        const savedLeaderPort = this.project?.leader_port || "";
        const isLeaderAvailable = this.availablePorts.some(p => p.device === savedLeaderPort);
        this.setDropdownOrCustomValue('tele-leader-port', isLeaderAvailable ? savedLeaderPort : "");
        const leaderTypeEl = document.getElementById('tele-leader-type');
        if (leaderTypeEl) {
            leaderTypeEl.value = `${activeRobot.type}_leader`;
        }
        const followerIdEl = document.getElementById('tele-follower-id');
        if (followerIdEl) {
            followerIdEl.value = activeRobot.id;
        }
        // Prefill follower port ONLY if it is physically scanned and available
        const savedFollowerPort = this.project?.follower_port || activeRobot.port || "";
        const isFollowerAvailable = this.availablePorts.some(p => p.device === savedFollowerPort);
        this.setDropdownOrCustomValue('tele-follower-port', isFollowerAvailable ? savedFollowerPort : "");
        const followerTypeEl = document.getElementById('tele-follower-type');
        if (followerTypeEl) {
            followerTypeEl.value = activeRobot.type.includes('follower') ? activeRobot.type : `${activeRobot.type}_follower`;
        }
        // Prefill inputs based on active selected skill
        this.selectSkill(activeSkill);
    },
    // ── Step 1: Teleoperation ───────────────────────────────────────────
    async startTeleop() {
        const rType = document.getElementById('tele-follower-type').value;
        const followerSelect = document.getElementById('tele-follower-port');
        let rPort = followerSelect ? followerSelect.value : '';
        if (rPort === '__custom__') {
            rPort = document.getElementById('tele-follower-port-custom').value.trim();
        }
        else {
            rPort = (rPort || '').trim();
        }
        const rId = document.getElementById('tele-follower-id').value;
        const tType = document.getElementById('tele-leader-type').value;
        const leaderSelect = document.getElementById('tele-leader-port');
        let tPort = leaderSelect ? leaderSelect.value : '';
        if (tPort === '__custom__') {
            tPort = document.getElementById('tele-leader-port-custom').value.trim();
        }
        else {
            tPort = (tPort || '').trim();
        }
        const tId = document.getElementById('tele-leader-id').value;
        const displayData = document.getElementById('tele-display-data').checked;
        const fpsVal = document.getElementById('tele-fps')?.value;
        const fps = fpsVal ? parseInt(fpsVal, 10) : 60;
        const timeSVal = document.getElementById('tele-time-s')?.value;
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
    async stopTeleop() {
        this.log('WARN', 'Stopping teleoperation session...');
        await this.api('POST', '/teleop/stop');
    },
    // ── Step 2: Teleoperated Record ─────────────────────────────────────
    async startWorkflowRecord() {
        const robots = this.project?.robots || [];
        const rType = robots[0]?.type || 'so100_follower';
        const rPort = robots[0]?.port || '';
        const repo = document.getElementById('rec-repo-id')?.value.trim();
        const eps = parseInt(document.getElementById('rec-episodes')?.value || '50', 10);
        const fps = 30; // Native LeRobot FPS target
        const taskDesc = document.getElementById('rec-task-desc')?.value.trim() || '';
        const episodeTime = parseFloat(document.getElementById('rec-duration')?.value || '60') || 60;
        const pushHub = document.getElementById('rec-push-hub')?.checked || false;
        const resume = document.getElementById('rec-resume')?.checked || false;
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
        // Show interactive UI guide for LeRobot keys (matches lerobot-record >= 0.4)
        const guide = document.getElementById('rec-keys-guide');
        if (guide) {
            guide.style.display = 'block';
            guide.innerHTML = `
        <strong>Nahrávání aktivní!</strong><br>
        1. <strong>ŠIPKA VPRAVO (→)</strong> = Uložit epizodu a pokračovat<br>
        2. <strong>ŠIPKA VLEVO (←)</strong> = Zahodit a natočit znovu<br>
        3. <strong>ESC</strong> = Dokončit a uložit dataset
      `;
        }
        const liveControls = document.getElementById('rec-live-controls');
        if (liveControls) {
            liveControls.style.display = 'flex';
        }
        this.log('INFO', `Requesting Record for ${repo} (${eps} eps @ ${fps}fps, task="${taskDesc || this.activeSkill}")`);
        const extraArgs = document.getElementById('rec-extra-args')?.value.trim() || '';
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
        if (res && res.ok === false) {
            this.log('ERROR', `Backend Validation Failed: ${res.error}`);
            alert(`Chyba: ${res.error}`);
            if (guide)
                guide.style.display = 'none';
            if (liveControls)
                liveControls.style.display = 'none';
        }
        else if (res && res.ok !== false) {
            this.initTaggingWizard();
        }
    },
    async stopWorkflowRecord() {
        const skillSlug = this.activeSkill || 'pick_cube';
        await this.api('POST', '/recording/stop', { skill_slug: skillSlug });
        const guide = document.getElementById('rec-keys-guide');
        if (guide)
            guide.style.display = 'none';
        const liveControls = document.getElementById('rec-live-controls');
        if (liveControls)
            liveControls.style.display = 'none';
        await this.finishTaggingPostProcess();
    },
    async sendRecordingAction(action) {
        this.log('INFO', `Recording action triggered: ${action.toUpperCase()}`);
        const res = await this.api('POST', '/recording/action', { action });
        if (res && res.ok === false) {
            this.log('WARN', `Action warning: ${res.error}`);
        }
    },
    // ── Step 3: Replay Episode ──────────────────────────────────────────
    async startReplay() {
        const repo = document.getElementById('rep-repo-id').value.trim();
        const idx = parseInt(document.getElementById('rep-episode-idx').value, 10);
        const robots = this.project?.robots || [];
        const rType = robots[0]?.type || 'so100';
        const rPort = robots[0]?.port || '';
        if (!repo) {
            const msg = "Dataset Repo ID cannot be empty!";
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
    async startWorkflowTraining() {
        const checkedCheckboxes = document.querySelectorAll('.train-step-checkbox:checked');
        const checkedSkills = [];
        checkedCheckboxes.forEach(cb => {
            const slug = cb.getAttribute('data-skill');
            if (slug)
                checkedSkills.push(slug);
        });
        if (checkedSkills.length === 0) {
            const msg = this.t('alert.selectStepToTrain');
            this.log('ERROR', `Validation Failed: ${msg}`);
            alert(msg);
            return;
        }
        const policy = document.getElementById('train-policy-type').value;
        const steps = parseInt(document.getElementById('train-steps').value, 10) || 10000;
        const batchSize = parseInt(document.getElementById('train-batch-size')?.value || '8', 10) || 8;
        this.trainingQueue = [...checkedSkills];
        this.lossData = [];
        this._trainTotalSteps = steps;
        this.setProgressPercent(0);
        this.drawLossChart();
        const device = document.getElementById('train-device')?.value || 'cuda';
        const wandb = document.getElementById('train-wandb')?.checked || false;
        const extraArgs = document.getElementById('train-extra-args')?.value.trim() || '';
        this.log('INFO', `Spouštění sekvenčního trénování pro: ${checkedSkills.join(', ')} (${steps} kroků, batch ${batchSize})...`);
        this.renderTrainingSkillsTree();
        await this.api('POST', '/training/start', {
            skills: checkedSkills,
            policy_type: policy,
            steps: steps,
            batch_size: batchSize,
            device: device,
            use_wandb: wandb,
            extra_args_str: extraArgs
        });
    },
    async stopWorkflowTraining() {
        const active = this.activeTrainingSkill || this.activeSkill || 'pick_cube';
        await this.api('POST', '/training/stop', { skill_slug: active });
        this.trainingQueue = [];
        this.activeTrainingSkill = null;
        this.renderTrainingSkillsTree();
    },
    async startWorkflowInference() {
        const path = document.getElementById('eval-policy-path').value.trim();
        const taskName = document.getElementById('eval-task-name').value.trim();
        const robots = this.project?.robots || [];
        const rType = robots[0]?.type || 'so100';
        const rPort = robots[0]?.port || '';
        if (!path) {
            const msg = "Policy checkpoint path must be specified for deployment!";
            this.log('ERROR', `Validation Failed: ${msg}`);
            alert(msg);
            return;
        }
        if (!rPort) {
            const msg = "No Follower robot serial port configured! Cannot deploy policy without hardware port.";
            this.log('ERROR', `Validation Failed: ${msg}`);
            alert(msg);
            return;
        }
        this.log('INFO', `Deploying trained policy checkpoint: ${path}...`);
        const res = await this.api('POST', '/inference/start', {
            robot_type: rType,
            policy_path: path,
            skill_slug: taskName.replace('eval_', ''),
            port: rPort,
            fps: 30
        });
        if (res && res.ok !== false) {
            this.initPersistentInferenceUI();
        }
    },
    async stopWorkflowInference() {
        const taskName = document.getElementById('eval-task-name').value.trim();
        await this.api('POST', '/inference/stop', { skill_slug: taskName.replace('eval_', '') });
        const panel = document.getElementById('infer-persistent-panel');
        if (panel)
            panel.style.display = 'none';
    },
    selectRobot(type) {
        const hiddenSelect = document.getElementById('robot-type-select');
        if (hiddenSelect) {
            hiddenSelect.value = type;
        }
        // Update active state in horizontal segmented control
        document.querySelectorAll('.robot-type-pill').forEach(pill => {
            if (pill.getAttribute('data-value') === type) {
                pill.classList.add('active');
            }
            else {
                pill.classList.remove('active');
            }
        });
        this.onRobotTypeChange();
        // Dynamically auto-save configuration in active project config in real time
        this.saveSettingsState();
    },
    syncDatasetStorageDir(sourceId) {
        const src = document.getElementById(sourceId);
        const targetId = sourceId === 'settings-dataset-storage-dir' ? 'rec-dataset-storage-dir' : 'settings-dataset-storage-dir';
        const target = document.getElementById(targetId);
        if (src && target) {
            target.value = src.value;
        }
        this.saveSettingsState();
    },
    saveSettingsState() {
        if (this.isProjectLoading)
            return;
        if (!this.project)
            return;
        const robotType = document.getElementById('robot-type-select')?.value || 'so100';
        const followerPort = document.getElementById('tele-follower-port')?.value || '';
        const leaderPort = document.getElementById('tele-leader-port')?.value || '';
        const storageDir = document.getElementById('settings-dataset-storage-dir')?.value.trim() || '';
        const loopIntervalInput = document.getElementById('settings-loop-interval');
        const loopInterval = loopIntervalInput ? parseFloat(loopIntervalInput.value) : null;
        const lerobotDirEl = document.getElementById('settings-lerobot-dir-global');
        const lerobotDir = lerobotDirEl ? lerobotDirEl.value.trim() : '';
        const pyPathEl = document.getElementById('settings-python-path');
        const pyPath = pyPathEl ? pyPathEl.value.trim() : '';
        this.api('POST', '/settings', {
            lerobot_dir: lerobotDir,
            python_path: pyPath,
            robot_type: robotType,
            follower_port: followerPort,
            leader_port: leaderPort,
            dataset_storage_dir: storageDir,
            sequential_loop_interval: isNaN(loopInterval) ? null : loopInterval
        }).catch(err => {
            console.error("Failed to auto-save settings state:", err);
        });
    },
    onRobotTypeChange() {
        const robotTypeSelect = document.getElementById('robot-type-select');
        if (!robotTypeSelect)
            return;
        const robotType = robotTypeSelect.value;
        const isSingleArm = ['so100_follower', 'so100_leader', 'koch_follower', 'koch_leader', 'moss', 'stretch', 'lekiwi'].includes(robotType);
        const leaderGroup = document.getElementById('leader-config-group');
        const btnCalibrateLeader = document.getElementById('btn-calibrate-leader');
        if (isSingleArm) {
            if (leaderGroup)
                leaderGroup.style.display = 'none';
            if (btnCalibrateLeader)
                btnCalibrateLeader.style.display = 'none';
        }
        else {
            if (leaderGroup)
                leaderGroup.style.display = 'flex';
            if (btnCalibrateLeader)
                btnCalibrateLeader.style.display = 'inline-flex';
        }
        // Set hidden inputs dynamically for app.js/app.ts internal routing
        const leaderTypeInput = document.getElementById('tele-leader-type');
        const followerTypeInput = document.getElementById('tele-follower-type');
        if (leaderTypeInput)
            leaderTypeInput.value = robotType + '_leader';
        if (followerTypeInput)
            followerTypeInput.value = robotType;
        this.updateHardwareButtonStates();
    },
    loadModelConfig() {
        if (!this.project?.models)
            return;
        const llm = this.project.models.llm_ceo || {};
        const vlm = this.project.models.vlm_inspector || {};
        const robotType = this.project.robot_type || 'so100';
        const robotTypeSelect = document.getElementById('robot-type-select');
        if (robotTypeSelect) {
            robotTypeSelect.value = robotType;
        }
        // Synchronize horizontal segmented slider selector state on load
        document.querySelectorAll('.robot-type-pill').forEach(pill => {
            if (pill.getAttribute('data-value') === robotType) {
                pill.classList.add('active');
                pill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
            else {
                pill.classList.remove('active');
            }
        });
        this.onRobotTypeChange();
        const settingsDs = document.getElementById('settings-dataset-storage-dir');
        const recDs = document.getElementById('rec-dataset-storage-dir');
        const val = this.project.dataset_storage_dir || '';
        if (settingsDs)
            settingsDs.value = val;
        if (recDs)
            recDs.value = val;
        const llmEp = document.getElementById('llm-endpoint');
        const vlmEp = document.getElementById('vlm-endpoint');
        const llmMod = document.getElementById('llm-model');
        const vlmMod = document.getElementById('vlm-model');
        const llmPrompt = document.getElementById('llm-prompt');
        if (llmEp)
            llmEp.value = llm.endpoint || 'http://localhost:1234/v1';
        if (vlmEp)
            vlmEp.value = vlm.endpoint || 'http://localhost:1234/v1';
        if (llmMod)
            llmMod.value = llm.model_name || 'qwen2.5-7b-instruct';
        if (vlmMod)
            vlmMod.value = vlm.model_name || 'qwen2-vl-7b-instruct';
        if (llmPrompt)
            llmPrompt.value = llm.system_prompt || 'You are a robotic arm task planner. Decompose the user\'s instruction into an ordered array of sub-tasks. Respond with a pure JSON array of strings, no extra commentary.';
        const loopIntervalInput = document.getElementById('settings-loop-interval');
        if (loopIntervalInput) {
            const orch = this.project.orchestration || {};
            loopIntervalInput.value = orch.sequential_loop_interval ?? '5';
        }
        this.updateHardwareButtonStates();
    },
    async saveModelConfig() {
        const llmEndpoint = document.getElementById('llm-endpoint').value.trim();
        const vlmEndpoint = document.getElementById('vlm-endpoint').value.trim();
        const llmModel = document.getElementById('llm-model').value.trim();
        const vlmModel = document.getElementById('vlm-model').value.trim();
        const prompt = document.getElementById('llm-prompt').value.trim();
        const robotType = document.getElementById('robot-type-select').value;
        this.log('INFO', 'Saving configurations...');
        await this.api('POST', '/models/llm_ceo', { endpoint: llmEndpoint, model_name: llmModel, system_prompt: prompt });
        await this.api('POST', '/models/vlm_inspector', { endpoint: vlmEndpoint, model_name: vlmModel });
        // Save LeRobot dir dynamically in the active project config along with robot type and ports!
        const followerPort = document.getElementById('tele-follower-port')?.value || '';
        const leaderPort = document.getElementById('tele-leader-port')?.value || '';
        const storageDir = document.getElementById('settings-dataset-storage-dir')?.value.trim() || '';
        const loopIntervalInput = document.getElementById('settings-loop-interval');
        const loopInterval = loopIntervalInput ? parseFloat(loopIntervalInput.value) : null;
        const lerobotDirEl = document.getElementById('settings-lerobot-dir-global');
        const lerobotDir = lerobotDirEl ? lerobotDirEl.value.trim() : '';
        const pyPathEl = document.getElementById('settings-python-path');
        const pyPath = pyPathEl ? pyPathEl.value.trim() : '';
        await this.api('POST', '/settings', {
            lerobot_dir: lerobotDir,
            python_path: pyPath,
            robot_type: robotType,
            follower_port: followerPort,
            leader_port: leaderPort,
            dataset_storage_dir: storageDir,
            sequential_loop_interval: isNaN(loopInterval) ? null : loopInterval
        });
        this.log('SUCCESS', 'All configurations saved dynamically in project.json!');
        this.updateHardwareButtonStates();
    },
    async browseDirectory(inputId) {
        const input = document.getElementById(inputId);
        if (!input)
            return;
        try {
            this.log('INFO', this.t('log.openingFileBrowser'));
            const res = await this.api('POST', '/utils/browse_directory');
            if (res && res.ok && res.path) {
                input.value = res.path;
                this.log('SUCCESS', `Složka vybrána: ${res.path}`);
                this.saveSettingsState();
            }
            else if (res && !res.path) {
                this.log('INFO', this.t('log.folderCancelled'));
            }
            else {
                this.log('ERROR', this.t('log.folderFailed'));
            }
        }
        catch (err) {
            this.log('ERROR', 'Chyba při otevírání průzkumníku: ' + err);
        }
    },
    // ── CEO Planner & NLP Orchestration ─────────────────────────────────
    async executeOrchestration() {
        const input = document.getElementById('orch-input').value.trim();
        if (!input)
            return;
        this.updateOrchStatus('Planning task steps...', 'var(--yellow)');
        await this.api('POST', '/orchestrate', { instruction: input });
        document.getElementById('orch-input').value = '';
    },
    renderSkillsFull() {
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
          <div class="skill-group-card" style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.05); border-radius: var(--radius-lg); padding: 6px; margin-bottom: 12px; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; border-bottom: 1px solid rgba(255,255,255,0.02); padding-bottom: 6px; margin-bottom: 4px;">
              <button class="skills-tree-folder ${isCollapsed ? 'collapsed' : ''}" data-folder="${m}" onclick="App.toggleSkillsFolder('${m}')" style="flex: 1; display: flex; align-items: center; border: none; background: none; color: var(--text-light); text-align: left; padding: 4px; gap: 8px; font-weight: 700; font-size: 13px; cursor: pointer; transition: all 0.2s;">
                <span class="chevron-icon" style="display: inline-flex; align-items: center; justify-content: center; transform: rotate(${isCollapsed ? '0deg' : '90deg'}); transition: transform 0.2s; color: var(--text-muted);"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 10px; height: 10px;"><path d="M9 5l7 7-7 7"></path></svg></span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; color: var(--cyan); flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle></svg>
                <span>${details[m]?.name || m}</span>
                <span class="count-badge" style="background: rgba(0, 188, 212, 0.1); color: var(--cyan); border-radius: 10px; font-size: 9px; padding: 1px 6px; font-weight: 600; margin-left: auto;">${subSkills.length}</span>
              </button>
              <div style="display: flex; align-items: center; gap: 4px;">
                <button class="action-btn-edit" onclick="event.stopPropagation(); App.showEditSkillModal('${m}')" title="${App.t('tip.editSkill')}" 
                  style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: var(--text-light); width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 4px; cursor: pointer; font-size: 11px; transition: all 0.2s; padding: 0;"
                  onmouseover="this.style.background='rgba(255, 255, 255, 0.15)'" 
                  onmouseout="this.style.background='rgba(255, 255, 255, 0.05)'"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 10px; height: 10px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="action-btn-plus" onclick="event.stopPropagation(); App.showNewSubSkillModal('${m}')" title="${App.t('tip.addStep')}" 
                  style="background: rgba(0, 188, 212, 0.08); border: 1px solid rgba(0, 188, 212, 0.2); color: var(--cyan); width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: bold; transition: all 0.2s; padding: 0;"
                  onmouseover="this.style.background='rgba(0, 188, 212, 0.2)'; this.style.borderColor='var(--cyan)';" 
                  onmouseout="this.style.background='rgba(0, 188, 212, 0.08)'; this.style.borderColor='rgba(0, 188, 212, 0.2)';"
                >+</button>
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
                }
                else {
                    subSkills.forEach(s => {
                        const isActive = s === this.activeSkill;
                        const parentSlug = details[s]?.parent_slug || '';
                        const datasetSlug = parentSlug ? `${parentSlug}/${s}` : s;
                        html += `
              <li style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                <button class="skills-tree-item ${isActive ? 'active' : ''}" onclick="App.selectSkill('${s}')" style="margin: 3px 0; flex: 1; display: flex; align-items: center; gap: 8px; border: none; background: transparent; padding: 6px 10px; border-radius: var(--radius); cursor: pointer; text-align: left; transition: all 0.2s;">
                  ${isActive ?
                            `<span class="step-check-indicator active">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"></polyline></svg>
                     </span>` :
                            `<span class="step-check-indicator">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"></polyline></svg>
                     </span>`}
                  <span>${details[s]?.name || s}</span>
                  <span class="ep-badge" id="ep-badge-${s}">...</span>
                </button>
                <div style="display: flex; align-items: center;">
                  <button class="action-btn-edit-sub" onclick="event.stopPropagation(); App.showEditSkillModal('${s}')" title="${App.t('tip.editStep')}" 
                    style="background: transparent; border: none; color: var(--text-muted); padding: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.2s;"
                    onmouseover="this.style.color='var(--cyan)';"
                    onmouseout="this.style.color='var(--text-muted)';"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 11px; height: 11px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                  </button>
                  <button class="action-btn-edit-episodes" onclick="event.stopPropagation(); App.openManageEpisodesModal('${s}')" title="${App.t('tip.manageEpisodes')}" 
                    style="background: transparent; border: none; color: var(--text-muted); padding: 4px 6px; cursor: pointer; font-size: 11px; display: flex; align-items: center; justify-content: center; transition: color 0.2s; margin-left: 4px;"
                    onmouseover="this.style.color='var(--cyan)';"
                    onmouseout="this.style.color='var(--text-muted)';"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 12px; height: 12px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                  </button>
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
                                }
                                else {
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
    toggleSkillsFolder(folderId) {
        const subs = document.getElementById(`folder-subs-${folderId}`);
        const folderBtn = document.querySelector(`.skills-tree-folder[data-folder="${folderId}"]`);
        if (this.collapsedFolders.has(folderId)) {
            this.collapsedFolders.delete(folderId);
            if (subs)
                subs.classList.remove('collapsed');
            if (folderBtn)
                folderBtn.classList.remove('collapsed');
        }
        else {
            this.collapsedFolders.add(folderId);
            if (subs)
                subs.classList.add('collapsed');
            if (folderBtn)
                folderBtn.classList.add('collapsed');
        }
    },
    renderTrainingSkillsTree() {
        const container = document.getElementById('train-skills-checklist-container');
        if (!container)
            return;
        const skills = this.project?.skills || [];
        const details = this.project?.skills_details || {};
        if (!skills.length) {
            container.innerHTML = `
        <div class="empty-state" style="padding: 12px; text-align: center;">
          <div class="empty-state-text" style="color: var(--text-muted); font-size: 12px;">${App.t('hint.noSkillsAvail')}</div>
        </div>`;
            return;
        }
        const parentSkills = skills.filter(s => !details[s]?.parent_slug);
        let html = '';
        parentSkills.forEach(parent => {
            const subSkills = skills.filter(s => details[s]?.parent_slug === parent);
            const isCollapsed = this.collapsedFolders.has('train_' + parent);
            html += `
        <div class="skill-group-card" style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.05); border-radius: var(--radius-lg); padding: 8px; margin-bottom: 10px; transition: all 0.2s;">
          <div style="display: flex; align-items: center; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.02); margin-bottom: 6px;">
            <button onclick="App.toggleTrainSkillsFolder('${parent}')" style="background: none; border: none; padding: 0; color: var(--text-muted); display: flex; align-items: center; cursor: pointer; transition: transform 0.2s; transform: rotate(${isCollapsed ? '0deg' : '90deg'});">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 10px; height: 10px;"><path d="M9 5l7 7-7 7"></path></svg>
            </button>
            <input type="checkbox" id="train-check-parent-${parent}" onchange="App.toggleTrainParentCheckbox('${parent}', this.checked)" style="width: 14px; height: 14px; cursor: pointer;">
            <span style="font-weight: 700; font-size: 13px; color: var(--text-light);">${details[parent]?.name || parent}</span>
          </div>
          
          <ul id="train-subs-${parent}" style="list-style: none; padding-left: 18px; margin: 0; border-left: 1.5px solid rgba(0, 188, 212, 0.15); display: ${isCollapsed ? 'none' : 'block'};">
      `;
            if (!subSkills.length) {
                html += `
          <li style="padding: 4px 0; font-size: 11px; color: var(--text-muted); font-style: italic;">
            ${App.t('hint.noStepsToLearn')}
          </li>
        `;
            }
            else {
                subSkills.forEach(sub => {
                    const meta = details[sub]?.model_metadata;
                    let metaHtml = '<span style="color: var(--text-muted); font-style: italic; font-size: 9px;">' + App.t('val.notLearned') + '</span>';
                    if (meta) {
                        const formattedParams = meta.param_count ? (meta.param_count >= 1000000 ? (meta.param_count / 1000000).toFixed(1) + 'M' : (meta.param_count / 1000).toFixed(0) + 'k') : 'N/A';
                        metaHtml = `
              <span class="meta-badge" style="background: rgba(0, 188, 212, 0.08); border: 1px solid rgba(0, 188, 212, 0.15); color: var(--cyan); border-radius: 4px; padding: 1px 4px; font-size: 9px; font-weight: 600;">
                ${meta.policy_type || 'diffusion'} | ${meta.epochs || 0} ep | ${formattedParams} param
              </span>
            `;
                    }
                    const isActive = this.activeTrainingSkill === sub;
                    const isQueued = this.trainingQueue && this.trainingQueue.includes(sub);
                    let progressStyle = 'display: none;';
                    let progressVal = 0;
                    let progressText = this.t('val.waiting');
                    if (isActive) {
                        progressStyle = 'display: block;';
                        progressText = this.t('val.training');
                    }
                    else if (isQueued) {
                        progressStyle = 'display: block;';
                        progressText = this.t('val.queued');
                    }
                    html += `
            <li style="margin-bottom: 8px; display: flex; flex-direction: column; width: 100%;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                  <input type="checkbox" class="train-step-checkbox" data-parent="${parent}" data-skill="${sub}" id="train-check-sub-${sub}" style="width: 14px; height: 14px; cursor: pointer;">
                  <span style="font-size: 12px; color: var(--text-light); font-weight: 500;">${details[sub]?.name || sub}</span>
                </div>
                <div style="flex-shrink: 0;">
                  ${metaHtml}
                </div>
              </div>
              
              <div class="train-step-progress-wrapper" id="train-progress-wrapper-${sub}" style="${progressStyle} margin-top: 6px; padding-left: 22px;">
                <div class="progress-bar-container" style="height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; position: relative;">
                  <div class="progress-bar-fill" id="train-progress-fill-${sub}" style="width: ${progressVal}%; height: 100%; background: linear-gradient(90deg, var(--accent-gradient-start), var(--accent-gradient-end)); transition: width 0.3s ease;"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--text-muted); margin-top: 2px;">
                  <span id="train-progress-text-${sub}">${progressText}</span>
                  <span id="train-progress-loss-${sub}"></span>
                </div>
              </div>
            </li>
          `;
                });
            }
            html += `</ul></div>`;
        });
        container.innerHTML = html;
    },
    toggleTrainSkillsFolder(parent) {
        const key = 'train_' + parent;
        if (this.collapsedFolders.has(key)) {
            this.collapsedFolders.delete(key);
        }
        else {
            this.collapsedFolders.add(key);
        }
        this.renderTrainingSkillsTree();
    },
    toggleTrainParentCheckbox(parent, checked) {
        const checkboxes = document.querySelectorAll(`.train-step-checkbox[data-parent="${parent}"]`);
        checkboxes.forEach(cb => {
            cb.checked = checked;
        });
    },
    selectSkill(s) {
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
        if (!isStep && !hasSubSkills) {
            // It's a top-level Dovednost with NO sub-skills! Hide active recording panel, show empty state
            if (emptyState)
                emptyState.style.display = 'flex';
            if (activePanel)
                activePanel.style.display = 'none';
        }
        else {
            // It has sub-skills or it is a sub-skill! Show active recording panel, hide empty state
            if (emptyState)
                emptyState.style.display = 'none';
            if (activePanel)
                activePanel.style.display = 'flex';
            const robots = this.project?.robots || [];
            const activeRobot = robots[0] || { id: 'my_follower_arm', type: 'so100', port: '' };
            const parentSlug = skillDetail.parent_slug || '';
            const datasetSlug = parentSlug ? `${parentSlug}/${s}` : s;
            // Update active sub-skill title in recording panel
            const titleEl = document.getElementById('active-sub-skill-title');
            if (titleEl)
                titleEl.textContent = skillDetail.name || s;
            // Update inputs
            const recRepoInput = document.getElementById('rec-repo-id');
            if (recRepoInput)
                recRepoInput.value = `local/${datasetSlug}`;
            const trainRepoInput = document.getElementById('train-repo-id');
            if (trainRepoInput)
                trainRepoInput.value = `local/${datasetSlug}`;
            const evalPolicyInput = document.getElementById('eval-policy-path');
            const policyType = this.project?.policy_architecture || 'diffusion';
            if (evalPolicyInput) {
                const policySlug = parentSlug ? `${parentSlug}_${s}` : s;
                evalPolicyInput.value = `outputs/training/${policySlug}_${policyType}`;
            }
            const evalTaskInput = document.getElementById('eval-task-name');
            if (evalTaskInput)
                evalTaskInput.value = `eval_${s}`;
            // Update hardware checks
            this.updateRecordingHardwareChecks();
            // Fetch LeRobot dataset info dynamically and render episodes manager list!
            this.api('GET', `/skills/${datasetSlug}/dataset_info`)
                .then(info => {
                // Update live stats row in recording panel!
                const epCountEl = document.getElementById('active-skill-episodes');
                const sizeEl = document.getElementById('active-skill-size');
                if (epCountEl) {
                    epCountEl.textContent = `${info.num_episodes || 0} epizod`;
                }
                if (sizeEl) {
                    sizeEl.textContent = `${info.size_mb || '0.00'} MB`;
                }
                const listContainer = document.getElementById('rec-episodes-list-container');
                if (listContainer) {
                    if (!info.exists || info.num_episodes === 0) {
                        listContainer.innerHTML = `<div style="font-size:11px; color:var(--text-muted); font-style:italic; text-align:center; padding: 12px 0;">Žádné epizody nenahrány v local/${datasetSlug}.</div>`;
                    }
                    else {
                        let listHtml = '';
                        for (let idx = 0; idx < info.num_episodes; idx++) {
                            listHtml += `
                  <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); padding: 5px 8px; border-radius: 4px; font-size: 11px;">
                    <span style="font-weight:700; color:var(--text-muted);">Epizoda ${idx}</span>
                    <div style="display:flex; gap:4px;">
                      <button class="btn btn-xs btn-success" onclick="App.playSpecificEpisode(${idx})" style="padding: 2px 6px; font-size:10px;">▶ Přehrát</button>
                      <button class="btn btn-xs btn-danger" onclick="App.deleteSpecificEpisode(${idx})" style="padding: 2px 6px; font-size:10px;">🗑 Smazat</button>
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
                    }
                    else {
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
    updateRecordingHardwareChecks() {
        const robots = this.project?.robots || [];
        const activeRobot = robots[0];
        const followerPort = activeRobot?.port || '';
        const cameras = activeRobot?.cameras || [];
        const hasPort = !!followerPort;
        const hasCameras = cameras.length > 0;
        const warnEl = document.getElementById('rec-hw-warning');
        const warnText = document.getElementById('rec-hw-warning-text');
        const btnStart = document.getElementById('btn-start-record');
        if (!hasPort || !hasCameras) {
            if (warnEl)
                warnEl.style.display = 'block';
            let errorMsg = '';
            if (!hasPort && !hasCameras) {
                errorMsg = this.t('rec.errNoPortNoCams');
            }
            else if (!hasPort) {
                errorMsg = this.t('rec.errNoPort');
            }
            else {
                errorMsg = this.t('rec.errNoCams');
            }
            if (warnText)
                warnText.textContent = errorMsg;
            if (btnStart)
                btnStart.disabled = true;
        }
        else {
            if (warnEl)
                warnEl.style.display = 'none';
            if (btnStart)
                btnStart.disabled = false;
        }
    },
    getCurrentParentSlug() {
        if (!this.activeSkill)
            return '';
        const details = this.project?.skills_details || {};
        const skill = details[this.activeSkill];
        if (!skill)
            return '';
        return skill.parent_slug || this.activeSkill;
    },
    showNewSubSkillModal(parentSlug) {
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
    showNewSkillModal(parentSlug = '') {
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
        const nameInput = document.getElementById('new-skill-name');
        const slugInput = document.getElementById('new-skill-slug');
        const descInput = document.getElementById('new-skill-desc');
        if (nameInput)
            nameInput.value = '';
        if (slugInput)
            slugInput.value = '';
        if (descInput)
            descInput.value = '';
        // Populate parent dropdown
        const select = document.getElementById('new-skill-parent');
        if (select) {
            const skills = this.project?.skills || [];
            const details = this.project?.skills_details || {};
            const parentSkills = skills.filter(s => !details[s]?.parent_slug);
            select.innerHTML = parentSkills.map(m => `<option value="${m}">${details[m]?.name || m}</option>`).join('');
        }
        const warningBox = document.getElementById('new-skill-warning-box');
        if (warningBox)
            warningBox.style.display = 'none';
        if (parentSlug) {
            // It's a sub-skill (step) and parent is already selected! Skip step 1 selection
            this.skillWizardType = 'step';
            if (select)
                select.value = parentSlug;
            this.showSkillWizardStep2();
        }
        else {
            // It's a clean slate creation, start at step 1
            this.skillWizardType = 'main';
            this.showSkillWizardStep1();
        }
    },
    selectSkillWizardType(type) {
        this.skillWizardType = type;
        const mainCard = document.getElementById('skill-type-card-main');
        const stepCard = document.getElementById('skill-type-card-step');
        if (type === 'main') {
            mainCard?.classList.add('active');
            stepCard?.classList.remove('active');
        }
        else {
            mainCard?.classList.remove('active');
            stepCard?.classList.add('active');
        }
    },
    showSkillWizardStep1() {
        const step1El = document.getElementById('skill-wizard-step1');
        const step2El = document.getElementById('skill-wizard-step2');
        if (step1El)
            step1El.style.display = 'block';
        if (step2El)
            step2El.style.display = 'none';
        const titleEl = document.getElementById('modal-new-skill-title');
        if (titleEl) {
            titleEl.textContent = this.skillWizardIsEdit ? this.t('modal.editSkill') : this.t('modal.newSkill');
        }
        this.selectSkillWizardType(this.skillWizardType);
    },
    showSkillWizardStep2() {
        const step1El = document.getElementById('skill-wizard-step1');
        const step2El = document.getElementById('skill-wizard-step2');
        if (step1El)
            step1El.style.display = 'none';
        if (step2El)
            step2El.style.display = 'block';
        const titleEl = document.getElementById('modal-new-skill-title');
        if (titleEl) {
            if (this.skillWizardIsEdit) {
                titleEl.textContent = this.skillWizardType === 'main' ? this.t('modal.editMainSkill') : this.t('modal.editMotorStep');
            }
            else {
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
        const nameInput = document.getElementById('new-skill-name');
        const descLabel = document.getElementById('new-skill-desc-label');
        const descHint = document.getElementById('new-skill-desc-hint');
        const descTextarea = document.getElementById('new-skill-desc');
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
            if (nameLabel)
                nameLabel.textContent = this.t('wiz.skillNameLabel');
            if (nameInput)
                nameInput.placeholder = this.t('wiz.skillNamePh');
            if (descLabel)
                descLabel.textContent = this.t('wiz.skillDescLabel');
            if (descHint) {
                descHint.textContent = this.t('wiz.skillDescHint');
            }
            if (descTextarea)
                descTextarea.placeholder = this.t('wiz.skillDescPh');
        }
        else {
            if (nameLabel)
                nameLabel.textContent = this.t('wiz.stepNameLabel');
            if (nameInput)
                nameInput.placeholder = this.t('wiz.stepNamePh');
            if (descLabel)
                descLabel.textContent = this.t('wiz.stepDescLabel');
            if (descHint) {
                descHint.textContent = this.t('wiz.stepDescHint');
            }
            if (descTextarea)
                descTextarea.placeholder = this.t('wiz.stepDescPh');
        }
        // Auto-slug generation binding
        if (nameInput && !this.skillWizardIsEdit) {
            nameInput.oninput = () => {
                const slugInput = document.getElementById('new-skill-slug');
                if (slugInput) {
                    slugInput.value = nameInput.value
                        .toLowerCase()
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
                        .replace(/[^a-z0-9]+/g, '_')
                        .replace(/^_|_$/g, '');
                }
            };
        }
        else if (nameInput) {
            nameInput.oninput = null; // Disable auto-slug when editing
        }
    },
    nextSkillWizardStep() {
        this.showSkillWizardStep2();
    },
    prevSkillWizardStep() {
        this.showSkillWizardStep1();
    },
    showEditSkillModal(slug) {
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
        const nameInput = document.getElementById('new-skill-name');
        const slugInput = document.getElementById('new-skill-slug');
        const descInput = document.getElementById('new-skill-desc');
        if (nameInput)
            nameInput.value = skill.name || '';
        if (slugInput)
            slugInput.value = slug;
        if (descInput)
            descInput.value = skill.description || '';
        // Populate and set parent select dropdown
        const select = document.getElementById('new-skill-parent');
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
            }
            else {
                warningBox.style.display = 'none';
            }
        }
        // Go directly to Step 2 details form
        this.showSkillWizardStep2();
    },
    async submitSkillWizard() {
        if (!this.project) {
            alert("Žádný projekt není otevřen!");
            return;
        }
        const name = document.getElementById('new-skill-name').value.trim();
        let slug = document.getElementById('new-skill-slug').value.trim();
        const desc = document.getElementById('new-skill-desc').value.trim();
        let parent_slug = null;
        if (this.skillWizardType === 'step') {
            parent_slug = document.getElementById('new-skill-parent')?.value || null;
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
            }
            catch (err) {
                alert(`Chyba při komunikaci se serverem: ${err.message}`);
                this.log('ERROR', `Komunikační chyba: ${err.message}`);
            }
        }
        else {
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
            }
            catch (err) {
                alert(`Chyba při komunikaci se serverem: ${err.message}`);
                this.log('ERROR', `Komunikační chyba: ${err.message}`);
            }
        }
    },
    exportAllDatasets() {
        this.log('INFO', this.t('log.zipExport'));
        this._triggerDownload('/api/project/export_datasets');
        this.log('SUCCESS', this.t('log.zipExportStarted'));
    },
    // ── Portable bundles (project / datasets / models between machines) ──
    _triggerDownload(url) {
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },
    showExportModal() {
        if (!this.project) {
            alert(this.t('alert.openProjectFirst'));
            return;
        }
        this.openModal('modal-export-bundle');
    },
    doExportBundle() {
        const datasets = document.getElementById('export-datasets')?.checked ? 1 : 0;
        const models = document.getElementById('export-models')?.checked ? 1 : 0;
        this.closeModal('modal-export-bundle');
        this.log('INFO', this.t('log.bundleExport'));
        this._triggerDownload(`/api/project/export?datasets=${datasets}&models=${models}`);
        this.log('SUCCESS', this.t('log.bundleExportStarted'));
    },
    importProjectBundle() {
        document.getElementById('import-bundle-input')?.click();
    },
    async onImportBundleFile(event) {
        const input = event.target;
        const file = input.files && input.files[0];
        input.value = '';
        if (!file)
            return;
        this.log('INFO', this.t('log.importing') + ' ' + file.name);
        try {
            const res = await fetch('/api/project/import', { method: 'POST', body: file });
            const data = await res.json();
            if (data && data.ok) {
                this.log('SUCCESS', this.t('log.importOk'));
                await this.loadProjects();
                await this.refreshProject();
            }
            else {
                this.log('ERROR', `${this.t('log.importFail')}: ${data?.error || res.status}`);
                alert(`${this.t('log.importFail')}: ${data?.error || res.status}`);
            }
        }
        catch (e) {
            this.log('ERROR', `${this.t('log.importFail')}: ${e}`);
        }
    },
    exportSkillModel(slug) {
        this.log('INFO', this.t('log.modelExport') + ' ' + slug);
        this._triggerDownload(`/api/skills/${slug}/export_model`);
    },
    importSkillModel() {
        document.getElementById('import-model-input')?.click();
    },
    async onImportModelFile(event) {
        const input = event.target;
        const file = input.files && input.files[0];
        input.value = '';
        if (!file)
            return;
        this.log('INFO', this.t('log.modelImporting') + ' ' + file.name);
        try {
            const res = await fetch('/api/models/import', { method: 'POST', body: file });
            const data = await res.json();
            if (data && data.ok) {
                this.log('SUCCESS', `${this.t('log.modelImportOk')}: ${(data.restored || []).join(', ')}`);
            }
            else {
                this.log('ERROR', `${this.t('log.modelImportFail')}: ${data?.error || res.status}`);
                alert(`${this.t('log.modelImportFail')}: ${data?.error || res.status}`);
            }
        }
        catch (e) {
            this.log('ERROR', `${this.t('log.modelImportFail')}: ${e}`);
        }
    },
    async deleteSkill(slug) {
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
            }
            catch (err) {
                console.error("Delete failed:", err);
                alert(`Chyba při odebírání: ${err.message}`);
            }
        }
    },
    async playSpecificEpisode(idx, customDatasetSlug) {
        const s = customDatasetSlug || this.activeSkill;
        if (!s)
            return;
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
        }
        catch (err) {
            this.log('ERROR', 'Chyba při spuštění přehrávání: ' + err.message);
            alert('Chyba přehrávání: ' + err.message);
        }
    },
    async deleteSpecificEpisode(idx, customDatasetSlug, originSkill) {
        const s = customDatasetSlug || this.activeSkill;
        if (!s)
            return;
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
                }
                else {
                    // Normal flow
                    this.selectSkill(s);
                }
            }
            catch (err) {
                this.log('ERROR', 'Smazání epizody selhalo: ' + err.message);
                alert('Chyba odebírání: ' + err.message);
            }
        }
    },
    async openManageEpisodesModal(skillSlug) {
        const details = this.project?.skills_details || {};
        const detail = details[skillSlug];
        const parentSlug = detail?.parent_slug || '';
        const datasetSlug = parentSlug ? `${parentSlug}/${skillSlug}` : skillSlug;
        // Set modal title & display slug
        const titleEl = document.getElementById('manage-episodes-title');
        if (titleEl)
            titleEl.textContent = `Správa epizod: ${detail?.name || skillSlug}`;
        const pathEl = document.getElementById('manage-episodes-path');
        if (pathEl)
            pathEl.textContent = `local/${datasetSlug}`;
        const sizeEl = document.getElementById('manage-episodes-size');
        if (sizeEl)
            sizeEl.textContent = 'Načítám...';
        const listContainer = document.getElementById('manage-episodes-list');
        if (listContainer)
            listContainer.innerHTML = '<div style="text-align:center; padding:20px; font-size:12px; color:var(--text-muted);">Načítám epizody z disku...</div>';
        this.openModal('modal-manage-episodes');
        try {
            const info = await this.api('GET', `/skills/${datasetSlug}/dataset_info`);
            if (sizeEl)
                sizeEl.textContent = `${info.size_mb || '0.00'} MB`;
            if (listContainer) {
                if (!info.exists || info.num_episodes === 0) {
                    listContainer.innerHTML = `<div style="font-size:12px; color:var(--text-muted); font-style:italic; text-align:center; padding: 24px 0;">Žádné epizody nenahrány v local/${datasetSlug}.</div>`;
                }
                else {
                    let listHtml = '';
                    for (let idx = 0; idx < info.num_episodes; idx++) {
                        listHtml += `
              <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); padding: 8px 12px; border-radius: var(--radius); font-size: 12px; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.04)';" onmouseout="this.style.background='rgba(255,255,255,0.02)';">
                <span style="font-weight:700; color:var(--text-light);">Epizoda #${idx}</span>
                <div style="display:flex; gap:6px;">
                  <button class="btn btn-xs btn-success" onclick="App.playSpecificEpisode(${idx}, '${datasetSlug}')" style="padding: 4px 10px; font-size:11px;">▶ Přehrát</button>
                  <button class="btn btn-xs btn-danger" onclick="App.deleteSpecificEpisode(${idx}, '${datasetSlug}', '${skillSlug}')" style="padding: 4px 10px; font-size:11px;">🗑 Smazat</button>
                </div>
              </div>
            `;
                    }
                    listContainer.innerHTML = listHtml;
                }
            }
        }
        catch (err) {
            if (listContainer)
                listContainer.innerHTML = `<div style="color:var(--red); text-align:center; padding:20px; font-size:12px;">Chyba při načítání: ${err.message}</div>`;
            console.error(err);
        }
    },
    updateTrainingStatus(text, color) {
        const el = document.getElementById('training-status-indicator');
        if (el) {
            el.textContent = text;
            el.style.color = color || 'var(--text-muted)';
        }
    },
    updateTrainingProgress(step, loss, skill_slug) {
        const activeSkill = skill_slug || this.activeTrainingSkill || this.activeSkill;
        this.updateTrainingStatus(`Trénink: Krok ${step} — Loss: ${loss.toFixed(5)}`, 'var(--yellow)');
        const totalSteps = this._trainTotalSteps
            || parseInt(document.getElementById('train-steps')?.value || '10000', 10)
            || 10000;
        const percent = Math.min(100, Math.round((step / totalSteps) * 100));
        this.setProgressPercent(percent);
        if (activeSkill) {
            const wrapper = document.getElementById(`train-progress-wrapper-${activeSkill}`);
            if (wrapper)
                wrapper.style.display = 'block';
            const fill = document.getElementById(`train-progress-fill-${activeSkill}`);
            if (fill)
                fill.style.width = `${percent}%`;
            const txt = document.getElementById(`train-progress-text-${activeSkill}`);
            if (txt)
                txt.textContent = `Krok ${step}/${totalSteps}`;
            const lossEl = document.getElementById(`train-progress-loss-${activeSkill}`);
            if (lossEl)
                lossEl.textContent = `Loss: ${loss.toFixed(4)}`;
        }
    },
    setProgressPercent(percent) {
        const bar = document.getElementById('training-progress-bar');
        if (bar) {
            bar.style.width = `${Math.min(percent, 100)}%`;
        }
    },
    // ── Canvas-Based Loss Chart ─────────────────────────────────────────
    addLossPoint(epoch, loss) {
        this.lossData.push({ epoch, loss });
        if (this.lossData.length > 300)
            this.lossData.shift();
        this.drawLossChart();
    },
    drawLossChart() {
        const canvas = document.getElementById('loss-chart');
        if (!canvas)
            return;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        const rect = canvas.parentElement.getBoundingClientRect();
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
    bindConsoleInput() {
        const input = document.getElementById('console-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const cmd = input.value.trim();
                    if (!cmd)
                        return;
                    this.logRaw(`❯ ${cmd}`, 'cmd');
                    this.api('POST', '/terminal', { command: cmd });
                    input.value = '';
                }
            });
        }
    },
    log(level, message) {
        const cls = { INFO: 'info', SUCCESS: 'success', WARN: 'warn', ERROR: 'error' }[level] || 'stdout';
        const prefix = { INFO: 'ℹ', SUCCESS: '✓', WARN: '⚠', ERROR: '✕' }[level] || '';
        this.appendConsole(`${prefix} ${message}`, cls);
    },
    logRaw(text, cls) {
        this.appendConsole(text, cls || 'stdout');
    },
    appendConsole(text, cls) {
        const output = document.getElementById('console-output');
        if (!output)
            return;
        const line = document.createElement('div');
        line.className = `t-line ${cls || ''}`;
        line.textContent = text;
        output.appendChild(line);
        output.scrollTop = output.scrollHeight;
        this._consoleLines++;
        const countEl = document.getElementById('console-count');
        if (countEl)
            countEl.textContent = `(${this._consoleLines} lines)`;
    },
    // ── Terminal UI Controls & Resizing ─────────────────────────────────
    // ── Draggable column splitters between page blocks ──────────────────
    _colResize: null,
    /** Bind the single document-level drag listeners (called once from init). */
    bindColumnResizers() {
        document.addEventListener('mousemove', (e) => {
            const c = this._colResize;
            if (!c)
                return;
            const total = c.lw + c.rw;
            const MIN = 180;
            let nl = c.lw + (e.clientX - c.startX);
            if (nl < MIN)
                nl = MIN;
            if (nl > total - MIN)
                nl = total - MIN;
            c.left.style.flexGrow = String(nl);
            c.right.style.flexGrow = String(total - nl);
        });
        document.addEventListener('mouseup', () => {
            if (this._colResize) {
                this._colResize = null;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                setTimeout(() => this.drawLossChart(), 50);
            }
        });
    },
    /**
     * Insert drag handles between the side-by-side blocks of a page so panels
     * can be resized horizontally — same interaction as the terminal/cameras
     * docks. Idempotent: a section is only wired once.
     */
    initColumnResizers(pageEl) {
        const sections = pageEl.querySelectorAll('.setup-section, .datacollection-grid');
        sections.forEach(sec => {
            if (sec.dataset.resizableInit)
                return;
            const blocks = [...sec.children].filter(c => c.classList.contains('setup-block') || c.classList.contains('datacollection-block'));
            if (blocks.length < 2)
                return;
            // Capture current widths, then switch to a flex split layout using those
            // widths as flex-grow ratios so the layout looks unchanged until dragged.
            const widths = blocks.map(b => b.getBoundingClientRect().width || 1);
            sec.classList.add('has-col-resizers');
            blocks.forEach((b, i) => {
                b.style.flex = `${widths[i]} 1 0`;
                b.style.minWidth = '0';
            });
            for (let i = 0; i < blocks.length - 1; i++) {
                const rz = document.createElement('div');
                rz.className = 'col-resizer';
                rz.setAttribute('role', 'separator');
                rz.setAttribute('aria-orientation', 'vertical');
                rz.title = this.t('resizer.title');
                blocks[i].after(rz);
                rz.addEventListener('mousedown', (e) => {
                    const left = rz.previousElementSibling;
                    const right = rz.nextElementSibling;
                    if (!left || !right)
                        return;
                    this._colResize = {
                        left, right,
                        startX: e.clientX,
                        lw: left.getBoundingClientRect().width,
                        rw: right.getBoundingClientRect().width,
                    };
                    document.body.style.cursor = 'ew-resize';
                    document.body.style.userSelect = 'none';
                    e.preventDefault();
                });
            }
            sec.dataset.resizableInit = '1';
        });
    },
    bindResizers() {
        const termHandle = document.getElementById('terminal-drag-handle');
        const termArea = document.getElementById('bottom-dock-container') || document.getElementById('terminal-area');
        if (termHandle && termArea) {
            let isResizing = false;
            let startY = 0;
            let startHeight = 0;
            termHandle.addEventListener('mousedown', (e) => {
                isResizing = true;
                termArea.style.transition = 'none'; // Disable transition completely during active dragging
                document.body.classList.add('resizing');
                startY = e.clientY;
                startHeight = termArea.getBoundingClientRect().height;
                document.body.style.cursor = 'ns-resize';
            });
            document.addEventListener('mousemove', (e) => {
                if (!isResizing)
                    return;
                const delta = startY - e.clientY;
                let newHeight = startHeight + delta;
                if (newHeight < 40)
                    newHeight = 40;
                if (newHeight > window.innerHeight * 0.8)
                    newHeight = window.innerHeight * 0.8;
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
                if (camerasHandle)
                    camerasHandle.style.display = 'block';
            }
            else {
                dock.style.width = '0px';
                dock.style.opacity = '0';
                dock.style.borderLeft = 'none';
                if (camerasHandle)
                    camerasHandle.style.display = 'none';
            }
        }
        if (camerasHandle && dock) {
            let isResizing = false;
            let startX = 0;
            let startWidth = 0;
            camerasHandle.addEventListener('mousedown', (e) => {
                isResizing = true;
                dock.style.transition = 'none'; // Disable transition completely during active dragging
                document.body.classList.add('resizing');
                startX = e.clientX;
                startWidth = dock.getBoundingClientRect().width;
                document.body.style.cursor = 'ew-resize';
                e.preventDefault(); // Prevent text selection
            });
            document.addEventListener('mousemove', (e) => {
                if (!isResizing)
                    return;
                const deltaX = startX - e.clientX; // Moving left increases right panel width
                let newWidth = startWidth + deltaX;
                // Limits: min 150px, max window.innerWidth - 100px
                if (newWidth < 150)
                    newWidth = 150;
                const maxWidth = window.innerWidth - 100;
                if (newWidth > maxWidth)
                    newWidth = maxWidth;
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
    toggleTerminal() {
        const term = document.getElementById('bottom-dock-container') || document.getElementById('terminal-area');
        if (!term)
            return;
        term.style.transition = 'height 0.15s ease-out'; // Smooth anim only when toggling via button
        if (term.style.height === '40px' || term.style.height === '') {
            term.style.height = '38vh';
        }
        else {
            term.style.height = '40px';
        }
        setTimeout(() => this.drawLossChart(), 300);
    },
    toggleCamerasDock() {
        const dock = document.getElementById('docked-cameras-area');
        const handle = document.getElementById('cameras-drag-handle');
        if (!dock)
            return;
        dock.style.transition = 'width 0.2s ease, opacity 0.2s ease';
        if (dock.style.width === '0px' || dock.style.width === '') {
            const targetWidth = this.lastCamerasWidth || '520px';
            dock.style.width = targetWidth;
            dock.style.opacity = '1';
            dock.style.borderLeft = '1px solid var(--border)';
            if (handle)
                handle.style.display = 'block';
            localStorage.setItem('orchiday_cameras_dock_open', 'true');
            this.startAllProjectCameras();
        }
        else {
            if (dock.style.width && dock.style.width !== '0px') {
                this.lastCamerasWidth = dock.style.width;
                localStorage.setItem('orchiday_last_cameras_width', this.lastCamerasWidth);
            }
            dock.style.width = '0px';
            dock.style.opacity = '0';
            dock.style.borderLeft = 'none';
            if (handle)
                handle.style.display = 'none';
            localStorage.setItem('orchiday_cameras_dock_open', 'false');
        }
    },
    clearTerminal() {
        const output = document.getElementById('console-output');
        if (output)
            output.innerHTML = '';
        this._consoleLines = 0;
        const countEl = document.getElementById('console-count');
        if (countEl)
            countEl.textContent = `(0 lines)`;
    },
    // ── Emergency Stop ──────────────────────────────────────────────────
    async emergencyStop() {
        this.log('WARN', 'EMERGENCY STOP requested! Killing all LeRobot actions.');
        await this.api('POST', '/emergency-stop');
    },
    // ── Modal Helper API ────────────────────────────────────────────────
    // Stack of open modal ids (supports nested modals) + the element to refocus
    // when each was opened, so closing restores focus to the right trigger.
    _modalStack: [],
    _modalReturnFocus: {},
    _modalsBound: false,
    _focusableSelector: 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    /** Bind the shared modal listeners once (backdrop click, focus trap). */
    bindModals() {
        if (this._modalsBound)
            return;
        this._modalsBound = true;
        // Backdrop click: close when the click lands on the overlay itself (not its
        // content) and the dialog is not marked [data-static] (multi-step flows).
        document.addEventListener('mousedown', (e) => {
            const target = e.target;
            if (!target.classList.contains('modal-overlay'))
                return;
            if (!target.classList.contains('open'))
                return;
            if (target.hasAttribute('data-static'))
                return;
            this.closeModal(target.id);
        });
        // Focus trap: keep Tab focus inside the topmost open modal.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab' || this._modalStack.length === 0)
                return;
            const top = document.getElementById(this._modalStack[this._modalStack.length - 1]);
            if (!top)
                return;
            const items = [...top.querySelectorAll(this._focusableSelector)]
                .filter(el => el.offsetParent !== null);
            if (items.length === 0)
                return;
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            if (e.shiftKey && (active === first || !top.contains(active))) {
                e.preventDefault();
                last.focus();
            }
            else if (!e.shiftKey && active === last) {
                e.preventDefault();
                first.focus();
            }
        });
    },
    openModal(id) {
        const el = document.getElementById(id);
        if (!el)
            return;
        this.bindModals();
        this._modalReturnFocus[id] = document.activeElement;
        el.classList.add('open');
        if (!this._modalStack.includes(id))
            this._modalStack.push(id);
        // Lock background scroll while any modal is open
        document.body.classList.add('modal-open');
        // Move keyboard focus into the dialog for screen readers / keyboard users
        const focusable = el.querySelector('input:not([type=hidden]):not([readonly]):not([disabled]), select, textarea, button:not(.modal-close-btn)');
        setTimeout(() => (focusable || el).focus(), 30);
    },
    closeModal(id) {
        const el = document.getElementById(id);
        if (el)
            el.classList.remove('open');
        this._modalStack = this._modalStack.filter(m => m !== id);
        if (this._modalStack.length === 0)
            document.body.classList.remove('modal-open');
        const ret = this._modalReturnFocus[id];
        if (ret && typeof ret.focus === 'function')
            ret.focus();
        delete this._modalReturnFocus[id];
    },
    closeTopModal() {
        if (this._modalStack.length) {
            this.closeModal(this._modalStack[this._modalStack.length - 1]);
            return true;
        }
        // Fallback: any open overlay not tracked in the stack
        const open = document.querySelectorAll('.modal-overlay.open');
        if (open.length === 0)
            return false;
        this.closeModal(open[open.length - 1].id);
        return true;
    },
    openSettings() { this.openModal('modal-settings'); },
    bindAutoSlug() {
        const pairs = [
            ['new-project-name', 'new-project-slug'],
            ['new-skill-name', 'new-skill-slug'],
        ];
        pairs.forEach(([nameId, slugId]) => {
            const nameEl = document.getElementById(nameId);
            const slugEl = document.getElementById(slugId);
            if (nameEl && slugEl) {
                nameEl.addEventListener('input', () => {
                    slugEl.value = nameEl.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
                });
            }
        });
    },
    taggingSubSkills() {
        const s = this.activeSkill;
        if (!s)
            return [];
        const skills = this.project?.skills || [];
        const details = this.project?.skills_details || {};
        return skills.filter(sub => details[sub]?.parent_slug === s);
    },
    initTaggingWizard() {
        const s = this.activeSkill;
        if (!s)
            return;
        const subSkills = this.taggingSubSkills();
        const wizard = document.getElementById('rec-tagging-wizard');
        const stepsContainer = document.getElementById('rec-tagging-steps');
        if (subSkills.length > 0 && wizard && stepsContainer) {
            wizard.style.display = 'flex';
            // Marks are timestamped SERVER-SIDE against the real episode start parsed
            // from lerobot-record output — this local timer is display-only.
            this.taggingStartTime = Date.now();
            this.taggingActiveIndex = 0;
            this.taggingPoints = [];
            this.taggingEpisode = -1;
            this.renderTaggingSteps(subSkills);
            const timerEl = document.getElementById('rec-tagging-timer');
            const epEl = document.getElementById('rec-tagging-episode');
            const pointsEl = document.getElementById('rec-tagging-points');
            if (timerEl)
                timerEl.textContent = '0.0s';
            if (epEl)
                epEl.textContent = '–';
            if (pointsEl)
                pointsEl.textContent = '0';
            if (this.taggingInterval) {
                clearInterval(this.taggingInterval);
            }
            this.setTaggingNextEnabled(true);
            this.taggingInterval = setInterval(() => {
                const elapsedSecs = ((Date.now() - this.taggingStartTime) / 1000).toFixed(1);
                const tEl = document.getElementById('rec-tagging-timer');
                if (tEl)
                    tEl.textContent = `${elapsedSecs}s`;
            }, 100);
            this.log('SUCCESS', this.t('log.taggingStarted', { s, n: subSkills.length }));
        }
        else if (wizard) {
            wizard.style.display = 'none';
        }
    },
    setTaggingNextEnabled(enabled) {
        const btnNext = document.getElementById('btn-tagging-next');
        if (!btnNext)
            return;
        btnNext.disabled = !enabled;
        const label = btnNext.querySelector('span');
        if (label)
            label.textContent = enabled ? this.t('rec.markPhaseEnd') : this.t('rec.allPhasesMarked');
    },
    onRecordingEpisodeStarted(episode) {
        // A new episode began — step marking restarts from phase 0
        if (this.taggingSubSkills().length === 0)
            return;
        this.taggingEpisode = episode;
        this.taggingActiveIndex = 0;
        this.taggingPoints = [];
        this.taggingStartTime = Date.now();
        const epEl = document.getElementById('rec-tagging-episode');
        if (epEl)
            epEl.textContent = String(episode);
        const pointsEl = document.getElementById('rec-tagging-points');
        if (pointsEl)
            pointsEl.textContent = '0';
        this.renderTaggingSteps(this.taggingSubSkills());
        this.setTaggingNextEnabled(true);
    },
    renderTaggingSteps(subSkills) {
        const stepsContainer = document.getElementById('rec-tagging-steps');
        if (!stepsContainer)
            return;
        const details = this.project?.skills_details || {};
        stepsContainer.innerHTML = subSkills.map((sub, idx) => {
            const isCompleted = idx < this.taggingActiveIndex;
            const isActive = idx === this.taggingActiveIndex;
            let badgeCls = 'bg-syntax-type/20 text-syntax-type';
            let stateLabel = this.t('tag.waiting');
            if (isCompleted) {
                badgeCls = 'bg-green-500/20 text-green';
                stateLabel = this.t('tag.done');
            }
            else if (isActive) {
                badgeCls = 'bg-cyan-500/20 text-cyan font-bold';
                stateLabel = this.t('tag.active');
            }
            return `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); padding:6px 10px; border-radius:4px; border:1px solid ${isActive ? 'var(--cyan)' : 'rgba(255,255,255,0.04)'};" class="${isActive ? 'pulse-light-cyan' : ''}">
          <span style="font-size:11px; ${isActive ? 'color:var(--text-white); font-weight:700;' : 'color:var(--text-light);'}">
            ${idx + 1}. ${this.esc(details[sub]?.name || sub)}
          </span>
          <span class="tag ${badgeCls}" style="font-size:9.5px; text-transform:uppercase; font-weight:700;">${stateLabel}</span>
        </div>
      `;
        }).join('');
    },
    async taggingNextStep() {
        const s = this.activeSkill;
        if (!s)
            return;
        const subSkills = this.taggingSubSkills();
        if (this.taggingActiveIndex >= subSkills.length - 1) {
            this.log('WARN', this.t('log.allPhasesMarked'));
            return;
        }
        // The mark timestamp is taken server-side against the real episode start
        // parsed from lerobot-record output (immune to UI/network latency drift).
        const nextIdx = this.taggingActiveIndex + 1;
        const res = await this.api('POST', '/recording/mark_step', {
            skill_slug: s,
            step: nextIdx,
            label: subSkills[this.taggingActiveIndex],
        });
        if (!res || res.ok === false) {
            this.log('WARN', this.t('log.markFail', { e: res?.error || '?' }));
            return;
        }
        this.taggingPoints.push(res.t);
        this.taggingActiveIndex = nextIdx;
        const pointsEl = document.getElementById('rec-tagging-points');
        if (pointsEl)
            pointsEl.textContent = String(this.taggingPoints.length);
        const epEl = document.getElementById('rec-tagging-episode');
        if (epEl && typeof res.episode === 'number')
            epEl.textContent = String(res.episode);
        this.renderTaggingSteps(subSkills);
        this.log('SUCCESS', this.t('log.markSaved', {
            s: subSkills[nextIdx - 1], t: Number(res.t).toFixed(2), next: subSkills[nextIdx]
        }));
        if (this.taggingActiveIndex === subSkills.length - 1) {
            this.setTaggingNextEnabled(false);
        }
    },
    async taggingUndoStep() {
        const s = this.activeSkill;
        if (!s || this.taggingActiveIndex === 0)
            return;
        const res = await this.api('POST', '/recording/undo_mark', { skill_slug: s });
        if (!res || res.ok === false) {
            this.log('WARN', this.t('log.undoFail', { e: res?.error || '?' }));
            return;
        }
        this.taggingPoints.pop();
        this.taggingActiveIndex = Math.max(0, this.taggingActiveIndex - 1);
        const pointsEl = document.getElementById('rec-tagging-points');
        if (pointsEl)
            pointsEl.textContent = String(this.taggingPoints.length);
        this.renderTaggingSteps(this.taggingSubSkills());
        this.setTaggingNextEnabled(true);
        this.log('INFO', this.t('log.markUndone'));
    },
    async finishTaggingPostProcess() {
        // Marks are persisted server-side next to the dataset as they are clicked —
        // nothing to post-process here, just close the wizard UI.
        if (this.taggingInterval) {
            clearInterval(this.taggingInterval);
            this.taggingInterval = null;
        }
        const wizard = document.getElementById('rec-tagging-wizard');
        if (wizard)
            wizard.style.display = 'none';
        const s = this.activeSkill;
        if (s && this.taggingSubSkills().length > 0) {
            this.log('INFO', this.t('log.marksPersisted'));
            this.selectSkill(s);
        }
    },
    initPersistentInferenceUI() {
        const s = this.activeSkill;
        if (!s)
            return;
        const skills = this.project?.skills || [];
        const details = this.project?.skills_details || {};
        const subSkills = skills.filter(sub => details[sub]?.parent_slug === s);
        const panel = document.getElementById('infer-persistent-panel');
        if (panel) {
            panel.style.display = 'flex';
        }
        this.updateInferenceDaemonStatus('WAITING');
        const settleEl = document.getElementById('infer-settle-frames');
        const loadEl = document.getElementById('infer-gripper-load');
        const deltaEl = document.getElementById('infer-max-delta');
        if (settleEl)
            settleEl.textContent = '0/5';
        if (loadEl)
            loadEl.textContent = '0.0 mA';
        if (deltaEl)
            deltaEl.textContent = '0.0000';
        this.renderInferenceSubtasks(subSkills);
    },
    renderInferenceSubtasks(subSkills) {
        const container = document.getElementById('infer-subtasks-container');
        if (!container)
            return;
        if (subSkills.length === 0) {
            container.innerHTML = `
        <div style="font-size:10px; color:var(--text-muted); text-align:center; padding:6px; border:1px dashed var(--border); border-radius:4px;">
          Tento úkol nemá žádné definované sub-skilly (fáze).
        </div>
      `;
            return;
        }
        const details = this.project?.skills_details || {};
        container.innerHTML = subSkills.map((sub, idx) => {
            const name = details[sub]?.name || sub;
            return `
        <div style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.03); padding:4px 8px; border-radius:4px;" id="infer-row-${sub}">
          <span style="font-size:10px; color:var(--text-light); flex:1;">
            ${idx + 1}. ${this.esc(name)}
          </span>
          <button class="btn btn-xs btn-primary" onclick="App.triggerInferenceSubtask('${sub}')" style="padding:2px 8px; font-size:9.5px; font-weight:700; border-radius:3px;">
            Spustit
          </button>
        </div>
      `;
        }).join('');
    },
    async triggerInferenceSubtask(subSkill) {
        const s = this.activeSkill;
        if (!s)
            return;
        const skills = this.project?.skills || [];
        const details = this.project?.skills_details || {};
        const subSkills = skills.filter(sub => details[sub]?.parent_slug === s);
        subSkills.forEach(sub => {
            const row = document.getElementById(`infer-row-${sub}`);
            if (row) {
                row.style.borderColor = 'rgba(255,255,255,0.03)';
                row.style.background = 'rgba(255,255,255,0.01)';
                row.classList.remove('pulse-light-cyan');
                const btn = row.querySelector('button');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Spustit';
                    btn.className = 'btn btn-xs btn-primary';
                }
            }
        });
        const activeRow = document.getElementById(`infer-row-${subSkill}`);
        if (activeRow) {
            activeRow.style.borderColor = 'var(--cyan)';
            activeRow.style.background = 'rgba(0,255,242,0.02)';
            activeRow.classList.add('pulse-light-cyan');
            const btn = activeRow.querySelector('button');
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Běží...';
                btn.className = 'btn btn-xs btn-success';
            }
        }
        this.updateInferenceDaemonStatus('RUNNING');
        this.log('INFO', `Posílám příkaz ke spuštění fáze: '${subSkill}' přes stdin...`);
        await this.api('POST', '/inference/command', {
            skill_slug: s,
            command: `SET_TASK:${s}__${subSkill}`
        });
    },
    async sendInferenceStopSignal() {
        const s = this.activeSkill;
        if (!s)
            return;
        this.updateInferenceDaemonStatus('WAITING');
        this.log('WARN', 'Nouzové zastavení: Posílám příkaz STOP přes stdin.');
        await this.api('POST', '/inference/command', {
            skill_slug: s,
            command: 'STOP'
        });
        const skills = this.project?.skills || [];
        const details = this.project?.skills_details || {};
        const subSkills = skills.filter(sub => details[sub]?.parent_slug === s);
        subSkills.forEach(sub => {
            const row = document.getElementById(`infer-row-${sub}`);
            if (row) {
                row.style.borderColor = 'rgba(255,255,255,0.03)';
                row.style.background = 'rgba(255,255,255,0.01)';
                row.classList.remove('pulse-light-cyan');
                const btn = row.querySelector('button');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Spustit';
                    btn.className = 'btn btn-xs btn-primary';
                }
            }
        });
    },
    updateInferenceDaemonStatus(status) {
        const el = document.getElementById('infer-daemon-status');
        if (!el)
            return;
        el.textContent = status;
        if (status === 'RUNNING') {
            el.className = 'tag bg-green-500/20 text-green';
            const banner = document.getElementById('task-latch-card-banner');
            if (banner) {
                banner.className = 'task-latch-banner locked';
                const title = document.getElementById('task-latch-title-text');
                const desc = document.getElementById('task-latch-desc-text');
                if (title)
                    title.textContent = 'Task Latch: UZAMČENO';
                if (desc)
                    desc.textContent = 'Model autonomně provádí pohyby. Telemetrie aktivní.';
            }
        }
        else {
            el.className = 'tag bg-yellow-500/20 text-yellow';
            const banner = document.getElementById('task-latch-card-banner');
            if (banner) {
                banner.className = 'task-latch-banner unlocked';
                const title = document.getElementById('task-latch-title-text');
                const desc = document.getElementById('task-latch-desc-text');
                if (title)
                    title.textContent = 'Task Latch: ODEMČENO';
                if (desc)
                    desc.textContent = 'Motor dojel. VLM inspektor je aktivní na hranicích sub-tasků.';
            }
        }
    },
    handleInferenceTelemetry(line) {
        if (line.includes('[TELEMETRY]')) {
            const jointsMatch = line.match(/joints:([0-9\.\-,\s]+)/);
            const targetMatch = line.match(/target:([0-9\.\-,\s]+)/);
            const loadMatch = line.match(/load:([\d\.\-]+)/);
            const settleMatch = line.match(/settle:(\d+\/\d+)/);
            const deltaMatch = line.match(/max_delta:([\d\.\-]+)/);
            const updateEl = (id, text, color) => {
                const el = document.getElementById(id);
                if (el) {
                    el.textContent = text;
                    if (color) {
                        el.style.color = color;
                    }
                    else {
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
                }
                else if (val > 100) {
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
            }
            if (targetMatch) {
                const targets = targetMatch[1].split(',').map(x => parseFloat(x.trim()));
                targets.forEach((val, idx) => {
                    updateEl(`joint-tgt-${idx}`, val.toFixed(4));
                    updateEl(`tele-joint-tgt-${idx}`, val.toFixed(4));
                    const checkDiff = (valId) => {
                        const valEl = document.getElementById(valId);
                        if (valEl) {
                            const actualVal = parseFloat(valEl.textContent || '0');
                            const diff = Math.abs(val - actualVal);
                            const parentBox = valEl.parentElement;
                            if (parentBox) {
                                if (diff > 0.05) {
                                    parentBox.style.borderColor = 'rgba(239,83,80,0.3)';
                                    parentBox.style.background = 'rgba(239,83,80,0.03)';
                                }
                                else if (diff > 0.005) {
                                    parentBox.style.borderColor = 'rgba(255,167,38,0.3)';
                                    parentBox.style.background = 'rgba(255,167,38,0.03)';
                                }
                                else {
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
        }
        else if (line.includes('Settled Frames:') && line.includes('Gripper Load:')) {
            const settleMatch = line.match(/Settled Frames:\s*(\d+\/\d+)/);
            const loadMatch = line.match(/Gripper Load:\s*([\d\.]+)\s*mA/);
            const deltaMatch = line.match(/Max Delta:\s*([\d\.\-]+)/);
            const updateEl = (id, text) => {
                const el = document.getElementById(id);
                if (el)
                    el.textContent = text;
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
                const row = document.getElementById(`infer-row-${subSkill}`);
                if (row) {
                    row.style.borderColor = 'var(--green)';
                    row.style.background = 'rgba(46,125,50,0.05)';
                    row.classList.remove('pulse-light-cyan');
                    const btn = row.querySelector('button');
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = 'HOTOVO';
                        btn.className = 'btn btn-xs btn-success';
                        btn.style.background = 'rgba(46,125,50,0.2)';
                        btn.style.borderColor = 'var(--green)';
                        btn.style.color = 'var(--green)';
                    }
                }
                this.updateInferenceDaemonStatus('WAITING');
                this.log('SUCCESS', `✓ Sub-task '${subSkill}' byl úspěšně dokončen (detekováno dynamické ukončení!).`);
            }
        }
    },
    // ── Setup Wizard ───────────────────────────────────────────────────
    showSetupWizard(mode = 'initial') {
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
        const skipContainer = document.querySelector('.skip-setup-container');
        const welcomeTextEl = document.querySelector('#wizard-page-1 .welcome-text');
        if (mode === 'quick') {
            if (closeBtn)
                closeBtn.style.display = 'block';
            if (skipContainer)
                skipContainer.style.display = 'none';
            if (welcomeTextEl)
                welcomeTextEl.textContent = 'QUICK SETUP';
        }
        else {
            if (closeBtn)
                closeBtn.style.display = 'none';
            if (skipContainer)
                skipContainer.style.display = 'flex';
            if (welcomeTextEl)
                welcomeTextEl.textContent = 'WELCOME TO';
        }
        // Toggle dots 2 & 3 in quick setup mode
        const dot2 = document.getElementById('wizard-dot-2');
        const dot3 = document.getElementById('wizard-dot-3');
        if (dot2 && dot3) {
            if (mode === 'quick') {
                dot2.style.display = 'none';
                dot3.style.display = 'none';
            }
            else {
                dot2.style.display = 'inline-block';
                dot3.style.display = 'inline-block';
            }
        }
        this.wizardUpdatePageVisibility();
    },
    startSetupWizard() {
        this.showSetupWizard('initial');
    },
    wizardUpdatePageVisibility() {
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
                }
                else {
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
            const nextBtn = document.getElementById('wizard-leader-next-btn');
            if (nextBtn) {
                if (this.wizardLeaderSubStep === 3) {
                    nextBtn.textContent = 'Next ➔';
                    nextBtn.disabled = false;
                    nextBtn.style.opacity = '1';
                }
                else {
                    nextBtn.textContent = 'Skip ➔';
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
            const finishBtn = document.getElementById('wizard-follower-finish-btn');
            if (finishBtn) {
                if (this.wizardFollowerSubStep === 3) {
                    finishBtn.textContent = 'Next ➔';
                    finishBtn.disabled = false;
                    finishBtn.style.opacity = '1';
                }
                else {
                    finishBtn.textContent = 'Skip ➔';
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
    async wizardCheckLeRobotOnDisk() {
        const titleEl = document.getElementById('wizard-page-2-title');
        const descEl = document.getElementById('wizard-page-2-desc');
        const optionsContainer = document.getElementById('wizard-page-2-options-container');
        const nextBtn = document.getElementById('wizard-page-2-next-btn');
        const checklistEl = document.getElementById('wizard-requirements-checklist');
        if (!titleEl || !descEl || !optionsContainer || !nextBtn)
            return;
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
                const pathInput = document.getElementById('wizard-lerobot-path');
                if (pathInput)
                    pathInput.value = res.lerobot_path;
                titleEl.innerHTML = 'Nalezli jsme repozitář <span class="highlight-yellow">LeRobot</span>!';
                descEl.innerHTML = `V systému byl detekován existující repozitář v:<br><code class="highlight-path" style="display:inline-block; margin-top:6px; padding:2px 6px; background:var(--bg-sidebar); border:1px solid var(--border); border-radius:4px; font-size:11px; word-break:break-all;">${res.lerobot_path}</code>.<br><br>Chcete použít tuto složku, vybrat jinou, nebo provést novou instalaci?`;
                optionsContainer.innerHTML = `
          <button id="wizard-opt-found-confirm" class="btn-white-pill active" onclick="App.wizardSelectOption('found-confirm')">Použít detekovanou složku</button>
          <button id="wizard-opt-found-browse" class="btn-white-pill" onclick="App.wizardSelectOption('found-browse')">Vybrat jinou složku</button>
          <button id="wizard-opt-found-install" class="btn-white-pill" onclick="App.wizardSelectOption('found-install')">Nová instalace (stažení všeho)</button>
        `;
            }
            else {
                this.wizardFoundLeRobotPath = '';
                this.wizardSelectedOption = 'install';
                titleEl.innerHTML = `Nenašli jsme repozitář <span class="highlight-yellow">LeRobot</span>.`;
                descEl.textContent = 'Chcete provést plně automatickou instalaci (Miniconda, Conda env, LeRobot repozitář a závislosti), nebo se připojit k existujícímu ručně?';
                optionsContainer.innerHTML = `
          <button id="wizard-opt-new-installation" class="btn-white-pill active" onclick="App.wizardSelectOption('install')">Nová automatická instalace</button>
          <button id="wizard-opt-connect" class="btn-white-pill" onclick="App.wizardSelectOption('connect')">Připojit ručně</button>
        `;
            }
        }
        catch (err) {
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
    async wizardBrowseDifferentLeRobot() {
        try {
            const res = await this.api('POST', '/utils/browse_directory');
            if (res.ok && res.path) {
                const verifyRes = await this.api('POST', '/setup/verify-lerobot-path', { path: res.path });
                if (verifyRes.ok) {
                    const pathInput = document.getElementById('wizard-lerobot-path');
                    if (pathInput)
                        pathInput.value = res.path;
                    this.wizardFoundLeRobotPath = res.path;
                    this.wizardSelectedOption = 'found-confirm';
                    this.wizardActivePage = 4;
                    this.wizardLeaderSubStep = 1;
                    this.wizardUpdatePageVisibility();
                    this.log('SUCCESS', `Ověřena vybraná složka LeRobot: ${res.path}`);
                }
                else {
                    alert(verifyRes.error || this.t('wiz.invalidLerobot'));
                }
            }
        }
        catch (err) {
            alert(`Chyba při otevírání průzkumníku: ${err}`);
        }
    },
    async wizardBrowseLeRobotPath() {
        try {
            const res = await this.api('POST', '/utils/browse_directory');
            if (res.ok && res.path) {
                const verifyRes = await this.api('POST', '/setup/verify-lerobot-path', { path: res.path });
                if (verifyRes.ok) {
                    const pathInput = document.getElementById('wizard-lerobot-path');
                    if (pathInput)
                        pathInput.value = res.path;
                    this.log('SUCCESS', `Složka LeRobot vybrána a ověřena: ${res.path}`);
                }
                else {
                    alert(verifyRes.error || this.t('wiz.invalidLerobot'));
                }
            }
        }
        catch (err) {
            alert(`Chyba při výběru složky: ${err}`);
        }
    },
    async wizardNextPage() {
        if (this.wizardActivePage === 1) {
            const nameInput = document.getElementById('wizard-project-name');
            if (!nameInput || !nameInput.value.trim()) {
                alert(this.t('wiz.enterProjectName'));
                return;
            }
            const sceneDescInput = document.getElementById('wizard-scene-desc');
            if (!sceneDescInput || !sceneDescInput.value.trim()) {
                alert(this.t('alert.sceneDescRequired'));
                sceneDescInput?.focus();
                return;
            }
            if (this.wizardMode === 'quick') {
                this.wizardActivePage = 4;
                this.wizardLeaderSubStep = 1;
                this.wizardUpdatePageVisibility();
            }
            else {
                this.wizardActivePage = 2;
                this.wizardUpdatePageVisibility();
                this.wizardCheckLeRobotOnDisk();
            }
        }
        else if (this.wizardActivePage === 2) {
            if (this.wizardSelectedOption === 'found-confirm') {
                const pathInput = document.getElementById('wizard-lerobot-path');
                if (pathInput)
                    pathInput.value = this.wizardFoundLeRobotPath;
                this.wizardActivePage = 4;
                this.wizardLeaderSubStep = 1;
                this.wizardUpdatePageVisibility();
            }
            else if (this.wizardSelectedOption === 'found-browse') {
                this.wizardBrowseDifferentLeRobot();
            }
            else if (this.wizardSelectedOption === 'install' || this.wizardSelectedOption === 'found-install') {
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
                        const finishBtn = document.getElementById('wizard-btn-finish');
                        if (titleEl)
                            titleEl.innerHTML = 'Installing <span class="highlight-yellow">LeRobot</span> repository...';
                        if (connectSec)
                            connectSec.style.display = 'none';
                        if (installSec)
                            installSec.style.display = 'block';
                        if (finishBtn) {
                            finishBtn.disabled = true;
                            finishBtn.style.opacity = '0.5';
                        }
                        this.runSimulatedInstall();
                    }
                }
                catch (err) {
                    alert(`Chyba při otevírání průzkumníku: ${err}`);
                }
            }
            else {
                // Connect option
                this.wizardActivePage = 3;
                this.wizardUpdatePageVisibility();
                const titleEl = document.getElementById('wizard-page-3-title');
                const connectSec = document.getElementById('wizard-connect-section');
                const installSec = document.getElementById('wizard-install-section');
                const finishBtn = document.getElementById('wizard-btn-finish');
                if (titleEl)
                    titleEl.innerHTML = 'Connect your <span class="highlight-yellow">LeRobot</span> repository.';
                if (connectSec)
                    connectSec.style.display = 'block';
                if (installSec)
                    installSec.style.display = 'none';
                if (finishBtn) {
                    finishBtn.disabled = false;
                    finishBtn.style.opacity = '1';
                }
            }
        }
        else if (this.wizardActivePage === 3) {
            if (this.wizardSelectedOption === 'connect') {
                const pathInput = document.getElementById('wizard-lerobot-path');
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
                }
                catch (err) {
                    alert(`Chyba při ověřování cesty: ${err}`);
                    return;
                }
            }
            this.wizardActivePage = 4;
            this.wizardLeaderSubStep = 1;
            this.wizardUpdatePageVisibility();
        }
        else if (this.wizardActivePage === 4) {
            this.wizardActivePage = 5;
            this.wizardFollowerSubStep = 1;
            this.wizardUpdatePageVisibility();
        }
        else if (this.wizardActivePage === 5) {
            this.wizardActivePage = 6;
            this.wizardUpdatePageVisibility();
        }
        else if (this.wizardActivePage === 6) {
            this.wizardActivePage = 7;
            this.wizardUpdatePageVisibility();
        }
    },
    wizardPrevPage() {
        if (this.wizardActivePage > 1) {
            if (this.wizardActivePage === 4 && this.wizardMode === 'quick') {
                this.wizardActivePage = 1;
            }
            else {
                this.wizardActivePage--;
            }
            this.wizardUpdatePageVisibility();
        }
    },
    wizardSelectOption(opt) {
        this.wizardSelectedOption = opt;
        const btnInstall = document.getElementById('wizard-opt-new-installation');
        const btnConnect = document.getElementById('wizard-opt-connect');
        const btnFoundConfirm = document.getElementById('wizard-opt-found-confirm');
        const btnFoundBrowse = document.getElementById('wizard-opt-found-browse');
        const btnFoundInstall = document.getElementById('wizard-opt-found-install');
        if (btnInstall)
            btnInstall.classList.remove('active');
        if (btnConnect)
            btnConnect.classList.remove('active');
        if (btnFoundConfirm)
            btnFoundConfirm.classList.remove('active');
        if (btnFoundBrowse)
            btnFoundBrowse.classList.remove('active');
        if (btnFoundInstall)
            btnFoundInstall.classList.remove('active');
        if (opt === 'install' && btnInstall)
            btnInstall.classList.add('active');
        if (opt === 'connect' && btnConnect)
            btnConnect.classList.add('active');
        if (opt === 'found-confirm' && btnFoundConfirm)
            btnFoundConfirm.classList.add('active');
        if (opt === 'found-browse' && btnFoundBrowse)
            btnFoundBrowse.classList.add('active');
        if (opt === 'found-install' && btnFoundInstall)
            btnFoundInstall.classList.add('active');
    },
    async runSimulatedInstall() {
        const terminal = document.getElementById('wizard-log-terminal');
        const progress = document.getElementById('wizard-progress-bar');
        const finishBtn = document.getElementById('wizard-btn-finish');
        const backBtn = document.getElementById('wizard-page-3-back');
        if (!terminal || !progress)
            return;
        terminal.textContent = '';
        progress.style.width = '0%';
        if (backBtn)
            backBtn.disabled = true;
        try {
            const res = await this.api('POST', '/setup/install-lerobot', {
                parent_dir: this.wizardLeRobotParentDir || '/home/verlyba/robotics'
            });
            const logs = res.logs || [];
            const finalPath = res.path || '/home/verlyba/robotics/lerobot';
            const pathInput = document.getElementById('wizard-lerobot-path');
            if (pathInput)
                pathInput.value = finalPath;
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
                }
                else {
                    // Finished
                    if (finishBtn) {
                        finishBtn.disabled = false;
                        finishBtn.style.opacity = '1';
                    }
                    if (backBtn)
                        backBtn.disabled = false;
                }
            };
            setTimeout(printNextLog, 200);
        }
        catch (err) {
            terminal.textContent += 'Chyba při instalaci LeRobot: ' + err + '\n';
            if (finishBtn) {
                finishBtn.disabled = false;
                finishBtn.style.opacity = '1';
            }
            if (backBtn)
                backBtn.disabled = false;
        }
    },
    openAutoDetectPortsModal() {
        this.log('INFO', this.t('log.openingPortWizard'));
        this.autoDetectActiveArm = 'leader';
        this.autoDetectLeaderStep = 1;
        this.autoDetectFollowerStep = 1;
        this.autoDetectUpdateUI();
        this.openModal('modal-detect-ports');
    },
    async autoDetectStart(role) {
        const btn = document.getElementById(`btn-detect-${role}-scan`);
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
                }
                else {
                    this.autoDetectFollowerStep = 2;
                }
                this.autoDetectUpdateUI();
            }
            else {
                alert(`Chyba při zahájení detekce: ${res.error || 'neznámá chyba'}`);
            }
        }
        catch (err) {
            alert(`Chyba při zahájení detekce: ${err}`);
        }
        finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = this.t('wiz.scanDevices');
            }
        }
    },
    async autoDetectConfirmUnplug(role) {
        const btn = document.getElementById(`btn-detect-${role}-confirm`);
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
                const select = document.getElementById(`tele-${role}-port`);
                if (select) {
                    let opt = select.querySelector(`option[value="${res.device}"]`);
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
                const idInput = document.getElementById(`tele-${role}-id`);
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
                }
                else {
                    this.autoDetectFollowerStep = 3;
                }
                this.autoDetectUpdateUI();
            }
            else {
                alert(res.error || 'Zařízení nebylo detekováno. Ujistěte se, že jste odpojili správný USB kabel.');
            }
        }
        catch (err) {
            alert(`Chyba při potvrzení odpojení: ${err}`);
        }
        finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = this.t('wiz.confirmUnplug');
            }
        }
    },
    autoDetectGoToNextStep() {
        if (this.autoDetectActiveArm === 'leader') {
            this.autoDetectActiveArm = 'follower';
            this.autoDetectUpdateUI();
        }
    },
    autoDetectPrevStep() {
        if (this.autoDetectActiveArm === 'follower') {
            this.autoDetectActiveArm = 'leader';
            this.autoDetectUpdateUI();
        }
    },
    autoDetectUpdateUI() {
        // Show/hide main sections
        const leaderSec = document.getElementById('detect-leader-section');
        const followerSec = document.getElementById('detect-follower-section');
        if (leaderSec)
            leaderSec.style.display = this.autoDetectActiveArm === 'leader' ? 'block' : 'none';
        if (followerSec)
            followerSec.style.display = this.autoDetectActiveArm === 'follower' ? 'block' : 'none';
        // Show/hide sub-steps of Leader
        for (let i = 1; i <= 3; i++) {
            const el = document.getElementById(`detect-leader-step-${i}`);
            if (el)
                el.style.display = (this.autoDetectLeaderStep === i) ? 'block' : 'none';
        }
        // Show/hide sub-steps of Follower
        for (let i = 1; i <= 3; i++) {
            const el = document.getElementById(`detect-follower-step-${i}`);
            if (el)
                el.style.display = (this.autoDetectFollowerStep === i) ? 'block' : 'none';
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
            }
            else {
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
    async wizardStartDetectArm(role) {
        try {
            this.log('INFO', `Spouštím skenování portů pro detekci ${role} ramene...`);
            const res = await this.api('POST', '/setup/detect-arms/start');
            if (res.ok) {
                if (role === 'leader') {
                    this.wizardLeaderSubStep = 2;
                }
                else {
                    this.wizardFollowerSubStep = 2;
                }
                this.wizardUpdatePageVisibility();
            }
        }
        catch (err) {
            alert(`Chyba při zahájení detekce: ${err}`);
        }
    },
    async wizardConfirmUnplugArm(role) {
        try {
            this.log('INFO', `Ověřuji odpojené zařízení pro ${role} rameno...`);
            const res = await this.api('POST', '/setup/detect-arms/unplugged');
            if (res.ok && res.device) {
                if (role === 'leader') {
                    this.wizardLeaderPort = res.device;
                    this.wizardLeaderDeviceId = res.persistent_id;
                    this.wizardLeaderSubStep = 3;
                    const textEl = document.getElementById('wizard-leader-detected-text');
                    if (textEl)
                        textEl.textContent = `Great! Leader arm detected at ${res.device} (${res.persistent_id}).`;
                }
                else {
                    this.wizardFollowerPort = res.device;
                    this.wizardFollowerDeviceId = res.persistent_id;
                    this.wizardFollowerSubStep = 3;
                    const textEl = document.getElementById('wizard-follower-detected-text');
                    if (textEl)
                        textEl.textContent = `Great! Follower arm detected at ${res.device} (${res.persistent_id}).`;
                }
                this.wizardUpdatePageVisibility();
                this.log('SUCCESS', `Úspěšně detekováno ${role} rameno na portu ${res.device} s ID ${res.persistent_id}`);
            }
            else {
                alert(res.error || 'Zařízení nebylo detekováno.');
            }
        }
        catch (err) {
            alert(`Chyba při dokončení detekce: ${err}`);
        }
    },
    // ── Cameras Configuration (Page 6) ──────────────────────────────────
    async wizardScanCamerasForSelect() {
        const portSelect = document.getElementById('wizard-camera-port-select');
        if (!portSelect)
            return;
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
            cameras.forEach((cam) => {
                const opt = document.createElement('option');
                opt.value = cam.index.toString();
                opt.setAttribute('data-persistent-id', cam.persistent_id);
                opt.textContent = cam.friendly_name;
                portSelect.appendChild(opt);
            });
            // Automatically trigger change event for the first camera
            this.wizardOnCameraPortChange();
        }
        catch (err) {
            this.log('ERROR', this.t('log.camScanErr') + err);
            portSelect.innerHTML = '<option value="">-- Error scanning cameras --</option>';
            this.wizardStopCameraPreview();
        }
    },
    wizardOnCameraPortChange() {
        const portSelect = document.getElementById('wizard-camera-port-select');
        const previewImg = document.getElementById('wizard-camera-preview-img');
        const placeholder = document.getElementById('wizard-camera-preview-placeholder');
        if (!portSelect || !previewImg || !placeholder)
            return;
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
    wizardStopCameraPreview() {
        const previewImg = document.getElementById('wizard-camera-preview-img');
        const placeholder = document.getElementById('wizard-camera-preview-placeholder');
        if (previewImg) {
            previewImg.src = '';
            previewImg.style.display = 'none';
        }
        if (placeholder) {
            placeholder.style.display = 'block';
        }
    },
    wizardAddCamera() {
        const portSelect = document.getElementById('wizard-camera-port-select');
        const roleSelect = document.getElementById('wizard-camera-role-select');
        if (!portSelect || !roleSelect)
            return;
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
    wizardRemoveCamera(id) {
        this.wizardCameras = this.wizardCameras.filter(c => c.id !== id);
        this.wizardRenderCamerasList();
        this.log('INFO', `Odebrána kamera: ${id}`);
    },
    wizardClearCameras() {
        this.wizardCameras = [];
        this.wizardRenderCamerasList();
        this.log('INFO', this.t('log.allCamsRemoved'));
    },
    wizardRenderCamerasList() {
        const listEl = document.getElementById('wizard-camera-list');
        if (!listEl)
            return;
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
            item.style.borderRadius = 'var(--radius)';
            item.style.border = '1px solid var(--border)';
            item.style.fontSize = '11px';
            item.style.marginBottom = '4px';
            const roleText = cam.role === 'overhead' ? 'Overhead (Scéna)' : 'Wrist (Kleště)';
            item.innerHTML = `
        <span style="color: var(--text-light); font-weight: 500;">
          [${roleText}] Port: ${cam.source} (${cam.id})
        </span>
        <button onclick="App.wizardRemoveCamera('${cam.id}')" style="background: transparent; border: none; color: #f44336; cursor: pointer; padding: 0 4px; font-weight: bold; font-size: 12px; line-height: 1;">✕</button>
      `;
            listEl.appendChild(item);
        });
    },
    async wizardFinish() {
        const nameInput = document.getElementById('wizard-project-name');
        const robotSelect = document.getElementById('wizard-robot-select');
        const pathInput = document.getElementById('wizard-lerobot-path');
        const sceneDescInput = document.getElementById('wizard-scene-desc');
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
                if (overlay)
                    overlay.style.display = 'none';
                if (res.project) {
                    this.onProjectOpened(res.project);
                    this.loadProjects();
                }
                this.log('SUCCESS', 'Setup wizard dokončen! Projekt ' + name + ' byl vytvořen.');
            }
            else {
                alert('Chyba při dokončení setupu: ' + (res.error || 'neznámá chyba'));
            }
        }
        catch (err) {
            alert('Chyba při odesílání setupu: ' + err);
        }
    },
    wizardSkip() {
        const msg = this.wizardMode === 'quick'
            ? 'Opravdu chcete zrušit rychlé nastavení nového projektu?'
            : 'Opravdu chcete přeskočit průvodce nastavením? Můžete jej dokončit později nebo nastavit projekt ručně.';
        if (confirm(msg)) {
            this.wizardStopCameraPreview();
            if (this.wizardMode !== 'quick') {
                localStorage.setItem('orchiday_setup_completed', 'true');
            }
            const overlay = document.getElementById('setup-wizard-overlay');
            if (overlay)
                overlay.style.display = 'none';
            this.log('INFO', this.wizardMode === 'quick' ? 'Vytváření projektu zrušeno.' : 'Průvodce nastavením přeskočen.');
            this.loadProjects();
        }
    },
    esc(s) {
        const d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    },
};
// Bind to window to allow HTML inline event handlers to execute successfully!
window.App = App;
// ── Boot ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
