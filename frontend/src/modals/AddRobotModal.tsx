/** #modal-add-robot — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function AddRobotModal() {
  return (
    <div
      className="modal-overlay"
      id="modal-add-robot"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-add-robot-title"
    >
      <div className="modal-container">
        <div className="modal-header">
          <h4 id="modal-add-robot-title" data-i18n="h4.modal.addRobot">Přidat Robota</h4>
          <button
            className="modal-close-btn"
            onClick={(event: any) => { App.closeModal('modal-add-robot') }}
          >✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <div className="label-with-tooltip">
              <label htmlFor="robot-id" data-i18n="lbl.id">Identifikátor (ID)</label>
              {' '}
              <span className="info-tooltip-trigger" data-i18n-tooltip="tip.robotId">ⓘ</span>
            </div>
            <input type="text" id="robot-id" placeholder="např. my_follower_arm" data-i18n-ph="ph.robotId" />
          </div>
          <div className="form-group">
            <div className="label-with-tooltip">
              <label htmlFor="robot-type" data-i18n="lbl.robotType">Typ robota (LeRobot --robot.type)</label>
              {' '}
              <span className="info-tooltip-trigger" data-i18n-tooltip="tip.robotType">ⓘ</span>
            </div>
            <select id="robot-type">
              <option value="so100_follower">SO-100 Follower</option>
              <option value="so101_follower">SO-101 Follower</option>
              <option value="bi_so_follower">Bimanual SO Follower</option>
              <option value="koch_follower">Koch v1.1 Follower</option>
              <option value="openarm_follower">OpenArm Follower (CAN)</option>
              <option value="lekiwi">LeKiwi Mobile</option>
              <option value="reachy2" data-i18n="opt.reachy2">Reachy 2 (síť)</option>
              <option value="unitree_g1" data-i18n="opt.unitreeG1">Unitree G1 (síť)</option>
            </select>
          </div>
          <div className="form-group">
            <div className="label-with-tooltip">
              <label htmlFor="robot-port" data-i18n="lbl.boardPort">Sériový port desky</label>
              {' '}
              <span className="info-tooltip-trigger" data-i18n-tooltip="tip.robotPort">ⓘ</span>
            </div>
            <select id="robot-port" onChange={(event: any) => { App.onRobotPortSelectChange() }}>{/* Populated dynamically */}</select>
          </div>
          <input type="hidden" id="robot-port-custom" defaultValue="" />
        </div>
        <div className="modal-footer">
          <button
            className="btn btn-xs btn-secondary"
            onClick={(event: any) => { App.closeModal('modal-add-robot') }}
            data-i18n="btn.cancel"
          >Storno</button>
          {' '}
          <button
            className="btn btn-xs btn-primary"
            onClick={(event: any) => { App.addRobot() }}
            data-i18n="btn.add"
          >Přidat</button>
        </div>
      </div>
    </div>
  );
}
