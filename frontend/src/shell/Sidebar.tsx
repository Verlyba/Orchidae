/** Left navigation — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function Sidebar() {
  return (
    <nav className="activitybar" aria-label="Hlavní navigace">
      <div className="activitybar-top">
        {/* Sekce: Projekt */}
        <div className="nav-title">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          {' '}
          <span data-i18n="nav.project">Projekt</span>
        </div>
        <button
          id="btn-projects"
          className="activity-btn active"
          onClick={(event: any) => { App.changeTab('projects') }}
          title="Správa Projektů"
          aria-current="page"
        >
          <span data-i18n="nav.projects">Projekty</span>
        </button>
        {/* Sekce: Setup */}
        <div className="nav-title">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3"></circle>
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            ></path>
          </svg>
          {' '}
          <span data-i18n="nav.setup">Setup</span>
        </div>
        <button
          id="btn-setup"
          className="activity-btn"
          onClick={(event: any) => { App.changeTab('setup') }}
          title="Connect → Kalibrace → Modely"
        >
          <span data-i18n="nav.setup.wizard">Connect, Kalibrace & Modely</span>
        </button>
        {/* Sekce: Teleoperace */}
        <div className="nav-title">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 15V9a4 4 0 0 0-8 0v6M6 15V9a4 4 0 0 1 8 0v6"></path>
            <circle cx="12" cy="18" r="3"></circle>
          </svg>
          {' '}
          <span data-i18n="nav.teleoperation">Teleoperace</span>
        </div>
        <button
          id="btn-teleoperation"
          className="activity-btn"
          onClick={(event: any) => { App.changeTab('teleoperation') }}
          title="Bilateralní Teleoperace"
        >
          <span data-i18n="nav.teleoperation">Teleoperace</span>
        </button>
        {/* Sekce: Datasety */}
        <div className="nav-title">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
          </svg>
          {' '}
          <span data-i18n="nav.datasets">Datasety</span>
        </div>
        <button
          id="btn-datasety"
          className="activity-btn"
          onClick={(event: any) => { App.changeTab('datasety') }}
          title="Sběr dat, strom dovedností, nahrávání a správa datasetů"
        >
          <span data-i18n="nav.datasety">Sběr & Správa dat</span>
        </button>
        {/* Sekce: Učení */}
        <div className="nav-title">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-4.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2z"
            ></path>
          </svg>
          {' '}
          <span data-i18n="nav.learning">Učení</span>
        </div>
        <button
          id="btn-uceni"
          className="activity-btn"
          onClick={(event: any) => { App.changeTab('uceni') }}
          title="Trénink policy (ACT, Diffusion, SmolVLA...), resume, simulační evaluace, RL, PEFT/LoRA"
        >
          <span data-i18n="nav.uceni">Trénink & Evaluace</span>
        </button>
        {/* Sekce: Orchestrace */}
        <div className="nav-title">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <polygon points="10 8 16 12 10 16 10 8"></polygon>
          </svg>
          {' '}
          <span data-i18n="nav.orchestration">Orchestrace</span>
        </div>
        <button
          id="btn-modelrun"
          className="activity-btn"
          onClick={(event: any) => { App.changeTab('modelrun') }}
          title="Autonomní běh: CEO plánovač → VLM inspektor → LeRobot"
        >
          <span data-i18n="nav.orchestration.run">Běh modelu</span>
        </button>
        {/* Sekce: Nastavení */}
        <div className="nav-title">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="4" y1="21" x2="4" y2="14"></line>
            <line x1="4" y1="10" x2="4" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12" y2="3"></line>
            <line x1="20" y1="21" x2="20" y2="16"></line>
            <line x1="20" y1="12" x2="20" y2="3"></line>
            <line x1="1" y1="14" x2="7" y2="14"></line>
            <line x1="9" y1="8" x2="15" y2="8"></line>
            <line x1="17" y1="16" x2="23" y2="16"></line>
          </svg>
          {' '}
          <span data-i18n="nav.settings">Nastavení</span>
        </div>
        <button
          id="btn-settings"
          className="activity-btn"
          onClick={(event: any) => { App.changeTab('settings') }}
          title="Globální nastavení cest a diagnostika"
        >
          <span data-i18n="nav.settings">Nastavení</span>
        </button>
        {' '}
        <button
          id="btn-help"
          className="activity-btn"
          onClick={(event: any) => { App.changeTab('help') }}
          data-i18n-title="nav.help.tip"
          title="Nápověda — jak funguje orchestrační schéma"
        >
          <span data-i18n="nav.help">Nápověda</span>
        </button>
      </div>
      <div className="activitybar-bottom">
        <div className="estop-container">
          <button
            className="estop-btn"
            onClick={(event: any) => { App.emergencyStop() }}
            aria-label="EMERGENCY E-STOP"
            data-i18n-title="estop.title"
            title="EMERGENCY E-STOP — okamžitě ukončí všechny LeRobot procesy"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
            </svg>
          </button>
          {' '}
          <span className="estop-label" aria-hidden="true" data-i18n="estop">E-STOP</span>
        </div>
      </div>
    </nav>
  );
}
