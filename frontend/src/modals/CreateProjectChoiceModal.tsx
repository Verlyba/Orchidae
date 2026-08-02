/** #modal-create-project-choice — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function CreateProjectChoiceModal() {
  return (
    <div id="modal-create-project-choice" className="modal-overlay">
      <div className="modal-dialog modal-md">
        <div className="modal-header">
          <h3 data-i18n="modal.newProjectChoice.title">Vytvořit nový projekt</h3>
          <button
            className="modal-close"
            onClick={(event: any) => { App.closeModal('modal-create-project-choice') }}
          >×</button>
        </div>
        <div className="modal-body">
          <div className="choice-cards-grid">
            <div
              className="choice-card"
              onClick={(event: any) => { App.closeModal('modal-create-project-choice'); App.startSetupWizard() }}
            >
              <div className="choice-card-icon">
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
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                </svg>
              </div>
              <h4 data-i18n="choice.quickSetup.title">Rychlý setup</h4>
              <p data-i18n="choice.quickSetup.desc">
                Průvodce krok za krokem: založení projektu, detekce a připojení ramen a kamer.
              </p>
            </div>
            <div
              className="choice-card"
              onClick={(event: any) => { App.closeModal('modal-create-project-choice'); App.showNewProjectModal() }}
            >
              <div className="choice-card-icon">
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
              <h4 data-i18n="choice.emptyProject.title">Prázdný projekt</h4>
              <p data-i18n="choice.emptyProject.desc">Vytvořit čistý projekt bez přednastaveného hardwaru a dovedností.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
