/** #modal-add-camera — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function AddCameraModal() {
  return (
    <div
      className="modal-overlay"
      id="modal-add-camera"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-add-camera-title"
    >
      <div className="modal-container">
        <div className="modal-header">
          <h4 id="modal-add-camera-title" data-i18n="h4.modal.addCamera">Přidat USB Kameru</h4>
          <button
            className="modal-close-btn"
            onClick={(event: any) => { App.closeModal('modal-add-camera') }}
          >✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <div className="label-with-tooltip">
              <label htmlFor="camera-id" data-i18n="lbl.id">Identifikátor (ID)</label>
              {' '}
              <span className="info-tooltip-trigger" data-i18n-tooltip="tip.cameraId">ⓘ</span>
            </div>
            <input type="text" id="camera-id" placeholder="např. global_scene_cam" data-i18n-ph="ph.cameraId" />
          </div>
          <div className="form-group">
            <div className="label-with-tooltip">
              <label htmlFor="camera-source" data-i18n="lbl.hwDeviceIndex">Hardwarové zařízení (Index)</label>
              {' '}
              <span className="info-tooltip-trigger" data-i18n-tooltip="tip.cameraSource">ⓘ</span>
            </div>
            <select id="camera-source" onChange={(event: any) => { App.onCameraSourceSelectChange() }}>{/* Populated dynamically */}</select>
          </div>
          <input type="hidden" id="camera-source-custom" defaultValue="" />
          <div className="form-group">
            <div className="label-with-tooltip">
              <label htmlFor="camera-role" data-i18n="lbl.camRole">Role kamery</label>
              {' '}
              <span className="info-tooltip-trigger" data-i18n-tooltip="tip.cameraRole">ⓘ</span>
            </div>
            <select id="camera-role">
              <option value="overhead" data-i18n="opt.overheadView">overhead (pohled na scénu)</option>
              <option value="wrist" data-i18n="opt.wristView">wrist (pohled z kleští / ruky)</option>
              <option value="side" data-i18n="opt.sideView">side (boční pohled)</option>
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="btn btn-xs btn-secondary"
            onClick={(event: any) => { App.closeModal('modal-add-camera') }}
            data-i18n="btn.cancel"
          >Storno</button>
          {' '}
          <button
            className="btn btn-xs btn-primary"
            onClick={(event: any) => { App.addCamera() }}
            data-i18n="btn.add"
          >Přidat</button>
        </div>
      </div>
    </div>
  );
}
