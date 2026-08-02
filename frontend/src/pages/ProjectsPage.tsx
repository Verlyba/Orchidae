/** #page-projects — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function ProjectsPage() {
  return (
    <div id="page-projects" className="editor-area active-page">
      <div className="page-header-row">
        <h2 data-i18n="page.projects.title">Správa Projektů</h2>
      </div>
      {/* Master/detail: the list picks a project, the right panel says everything about it that can be known without opening it. Both panels own their own actions in .block-actions footers. */}
      <div className="setup-section projects-section">
        <div className="setup-block">
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
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              {' '}
              <span data-i18n="blk.projects">Projekty</span>
            </h3>
            <span className="block-head-sub" id="project-list-count"></span>
          </div>
          <div className="setup-block-content">
            <div className="project-list" id="project-list">
              <div className="empty-state">
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
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <div className="empty-state-text" data-i18n="hint.loadingProjects">Načítání seznamu projektů...</div>
              </div>
            </div>
          </div>
          <div className="block-actions">
            <button
              className="btn btn-xs btn-secondary"
              data-i18n="btn.importBundle"
              onClick={(event: any) => { App.importProjectBundle() }}
              data-i18n-title="tip.importBundle"
              title="Importovat .orchiday balíček (projekt + datasety + modely)"
            >Importovat balíček</button>
          </div>
        </div>
        {/* /left: project list */}
        <div className="setup-block">
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
                <rect x="3" y="3" width="18" height="18"></rect>
                <path d="M3 9h18M9 21V9"></path>
              </svg>
              {' '}
              <span data-i18n="blk.projectDetail">Detail projektu</span>
            </h3>
            <span className="block-head-sub" id="project-detail-state"></span>
          </div>
          <div className="setup-block-content">
            <div className="project-detail" id="project-detail"></div>
          </div>
          <div className="block-actions">
            <span className="block-actions-hint" id="project-detail-hint" data-i18n="hint.projectDetail">Vyberte projekt v seznamu vlevo.</span>
            {' '}
            <button
              className="btn btn-xs btn-danger"
              id="btn-project-delete"
              data-i18n="btn.deleteProject"
              onClick={(event: any) => { App.deleteSelectedProject() }}
              data-i18n-title="tip.deleteProject"
              title="Nevratně smaže adresář vybraného projektu včetně dovedností a kalibrací"
              disabled={true}
            >Smazat projekt</button>
            {' '}
            <button
              className="btn btn-xs btn-secondary"
              id="btn-project-export"
              data-i18n="btn.exportBundle"
              onClick={(event: any) => { App.showExportModal() }}
              data-i18n-title="tip.exportBundle"
              title="Exportovat aktuální projekt jako přenositelný .orchiday balíček"
              disabled={true}
            >Exportovat balíček</button>
            {' '}
            <button
              className="btn btn-xs btn-primary"
              id="btn-project-open"
              data-i18n="btn.openProject"
              onClick={(event: any) => { App.openSelectedProject() }}
              data-i18n-title="tip.openProject"
              title="Načte projekt: nasadí jeho kalibrační soubory do cache LeRobotu a odemkne ostatní stránky"
              disabled={true}
            >Otevřít projekt</button>
          </div>
        </div>
        {/* /right: project detail */}
      </div>
    </div>
  );
}
