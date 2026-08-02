/**
 * Orchiday shell.
 *
 * The DOM this renders is deliberately identical to the hand-written
 * index.html it replaces — same elements, same ids, same classes, same order.
 * styles.css is 7 000 lines of selectors written against that exact tree, and
 * the owner's design is not up for renegotiation inside a build-system
 * migration.
 *
 * Every page is mounted at once and hidden with `.editor-area` / `.active-page`
 * exactly as before; App.changeTab() switches them. Rendering only the active
 * page would be more React-ish and would break the parts of app.ts that write
 * into a page that is not currently shown (progress lines, log output,
 * recording state), so that conversion belongs to a later, per-page step.
 */
import { TitleBar } from './shell/TitleBar';
import { Sidebar } from './shell/Sidebar';
import { BottomDock } from './shell/BottomDock';
import { HiddenFileInputs } from './shell/HiddenFileInputs';

import { ProjectsPage } from './pages/ProjectsPage';
import { SetupPage } from './pages/SetupPage';
import { TeleoperationPage } from './pages/TeleoperationPage';
import { DatasetyPage } from './pages/DatasetyPage';
import { UceniPage } from './pages/UceniPage';
import { ModelRunPage } from './pages/ModelRunPage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';

import { NewProjectModal } from './modals/NewProjectModal';
import { AddRobotModal } from './modals/AddRobotModal';
import { AddCameraModal } from './modals/AddCameraModal';
import { NewSkillModal } from './modals/NewSkillModal';
import { ManageEpisodesModal } from './modals/ManageEpisodesModal';
import { RecordKeysModal } from './modals/RecordKeysModal';
import { CalibrationHowtoModal } from './modals/CalibrationHowtoModal';
import { CalibrationFilesModal } from './modals/CalibrationFilesModal';
import { DetectPortsModal } from './modals/DetectPortsModal';
import { ExportBundleModal } from './modals/ExportBundleModal';
import { CreateProjectChoiceModal } from './modals/CreateProjectChoiceModal';
import { ArmPortSetupModal } from './modals/ArmPortSetupModal';

import { SetupWizard } from './wizard/SetupWizard';

export function App() {
  return (
    <>
      <a href="#workspace-main" className="skip-link" data-i18n="a11y.skip">
        Přeskočit na hlavní obsah
      </a>

      <div id="main-container">
        <TitleBar />

        <div className="app-body">
          <Sidebar />

          {/* Every page and the console dock must stay a DIRECT child of
              #workspace-main: .editor-area is display:none by default, so a
              page nested inside another one can never be shown. scripts/verify.sh
              checks this. */}
          <main className="workspace" id="workspace-main">
            <ProjectsPage />
            <SetupPage />
            <TeleoperationPage />
            <DatasetyPage />
            <UceniPage />
            <ModelRunPage />
            <SettingsPage />
            <HelpPage />
            <BottomDock />
          </main>
        </div>
      </div>

      {/* Overlays live outside #main-container, which is overflow:hidden. */}
      <NewProjectModal />
      <AddRobotModal />
      <AddCameraModal />
      <NewSkillModal />
      <ManageEpisodesModal />
      <RecordKeysModal />
      <CalibrationHowtoModal />
      <CalibrationFilesModal />
      <DetectPortsModal />
      <ExportBundleModal />
      <HiddenFileInputs />
      <SetupWizard />
      <CreateProjectChoiceModal />
      <ArmPortSetupModal />
    </>
  );
}
