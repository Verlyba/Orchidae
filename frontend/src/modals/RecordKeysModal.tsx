/** #modal-record-keys — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function RecordKeysModal() {
  return (
    <div
      className="modal-overlay"
      id="modal-record-keys"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-rec-keys-title"
    >
      <div className="modal-container" style={{ maxWidth: "640px", width: "100%" }}>
        <div className="modal-header">
          <h4 id="modal-rec-keys-title">
            <span data-i18n="rec.keymapTitle">Klávesy během nahrávání</span>
          </h4>
          <button
            className="modal-close-btn"
            onClick={(event: any) => { App.closeModal('modal-record-keys') }}
          >✕</button>
        </div>
        <div className="modal-body">
          <p className="phase-now-text" data-i18n="rec.keymapNote">
            Fungují jen když je toto okno aplikace aktivní — Orchiday je převádí na řídicí příznaky procesu.
          </p>
          <table className="rec-keymap-table" style={{ marginTop: "12px" }}>
            <thead>
              <tr>
                <th data-i18n="rec.keymapColKeys">Klávesy</th>
                <th data-i18n="rec.keymapColAction">Co udělá</th>
                <th data-i18n="rec.keymapColFlag">LeRobot</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <kbd>␣</kbd>
                  <kbd>M</kbd>
                </td>
                <td data-i18n="rec.keyMark">Označí hranici pod-úkolu</td>
                <td>mark</td>
              </tr>
              <tr>
                <td>
                  <kbd>⌫</kbd>
                  <kbd>U</kbd>
                </td>
                <td data-i18n="rec.keyUnmark">Vrátí poslední značku</td>
                <td>unmark</td>
              </tr>
              <tr>
                <td>
                  <kbd>→</kbd>
                  <kbd>N</kbd>
                </td>
                <td data-i18n="rec.keyNext">Uloží epizodu a pokračuje</td>
                <td>exit_early</td>
              </tr>
              <tr>
                <td>
                  <kbd>←</kbd>
                  <kbd>R</kbd>
                </td>
                <td data-i18n="rec.keyRetry">Zahodí epizodu a opakuje ji</td>
                <td>rerecord_episode</td>
              </tr>
              <tr>
                <td>
                  <kbd>Esc</kbd>
                  <kbd>Q</kbd>
                </td>
                <td data-i18n="rec.keyStop">Ukončí sběr a uloží dataset</td>
                <td>stop_recording</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="modal-footer">
          <button
            className="btn btn-sm btn-secondary"
            onClick={(event: any) => { App.closeModal('modal-record-keys') }}
            data-i18n="btn.close"
          >Zavřít</button>
        </div>
      </div>
    </div>
  );
}
