/** #modal-calibration-howto — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

export function CalibrationHowtoModal() {
  return (
    <div
      className="modal-overlay"
      id="modal-calibration-howto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-cal-howto-title"
    >
      <div className="modal-container" style={{ maxWidth: "720px", width: "100%" }}>
        <div className="modal-header">
          <h4 id="modal-cal-howto-title">
            <span data-i18n="h4.modal.calHowto">Jak kalibrace probíhá</span>
          </h4>
          <button
            className="modal-close-btn"
            onClick={(event: any) => { App.closeModal('modal-calibration-howto') }}
          >✕</button>
        </div>
        <div className="modal-body">
          <ol className="cal-howto">
            <li>
              <h5 className="cal-howto-head">
                <span className="phase-rail-n">1</span>
                {' '}
                <span data-i18n="cal.step1.short">Soubor</span>
              </h5>
              <p className="cal-howto-why" data-i18n-html="cal.step1.why">
                Když už pro dané{' '}
                <code>id</code>
                {' '}kalibrační soubor existuje, LeRobot se zeptá, jestli ho použít, nebo kalibrovat znovu. Orchiday odpovídá za vás — na „Kalibrovat znovu (c)“.
              </p>
              <code className="cal-howto-prompt">
                Press ENTER to use provided calibration file associated with the id {'<'}id{'>'}, or type 'c' and press ENTER to run calibration:
              </code>
            </li>
            <li>
              <h5 className="cal-howto-head">
                <span className="phase-rail-n">2</span>
                {' '}
                <span data-i18n="cal.step2.short">Střed rozsahu</span>
              </h5>
              <p className="cal-howto-why" data-i18n-html="cal.step2.why">
                Nastavte rameno rukou zhruba doprostřed jeho rozsahu pohybu a potvrďte. Z této polohy LeRobot počítá{' '}
                <code>Homing_Offset</code>
                {' '}každého motoru.
              </p>
              <code className="cal-howto-prompt">
                Move {'<'}device{'>'} to the middle of its range of motion and press ENTER....
              </code>
            </li>
            <li>
              <h5 className="cal-howto-head">
                <span className="phase-rail-n">3</span>
                {' '}
                <span data-i18n="cal.step3.short">Rozsahy kloubů</span>
              </h5>
              <p className="cal-howto-why" data-i18n-html="cal.step3.why">
                Projeďte každý kloub kromě{' '}
                <code>wrist_roll</code>
                {' '}celým rozsahem, tam a zpět. Tabulka vedle ukazuje živě MIN, aktuální pozici a MAX. Až budou rozpětí vypadat správně, potvrďte.
              </p>
              <code className="cal-howto-prompt">
                Move all joints except 'wrist_roll' sequentially through their entire ranges of motion. Recording positions. Press ENTER to stop...
              </code>
            </li>
            <li>
              <h5 className="cal-howto-head">
                <span className="phase-rail-n">4</span>
                {' '}
                <span data-i18n="cal.step4.short">Uložení</span>
              </h5>
              <p className="cal-howto-why" data-i18n-html="cal.step4.why">
                LeRobot zapíše soubor do své cache. Orchiday si ho zkopíruje do projektu, aby přežil vyčištění cache.
              </p>
              <code className="cal-howto-prompt">
                Calibration saved to {'<'}cache{'>'}/robots|teleoperators/{'<'}typ{'>'}/{'<'}id{'>'}.json
              </code>
            </li>
          </ol>
        </div>
        <div className="modal-footer">
          <button
            className="btn btn-sm btn-secondary"
            onClick={(event: any) => { App.closeModal('modal-calibration-howto') }}
            data-i18n="btn.close"
          >Zavřít</button>
        </div>
      </div>
    </div>
  );
}
