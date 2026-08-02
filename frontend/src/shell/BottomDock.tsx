/** Console dock — migrated verbatim from the pre-React web/index.html. */

import { App } from '../legacy/app';

import { important } from '../util/importantStyle';

export function BottomDock() {
  return (
    <section className="bottom-dock-container" id="bottom-dock-container">
      <div className="terminal-drag-handle" id="terminal-drag-handle"></div>
      {/* Left: Terminal Console */}
      <div className="terminal-dock" id="terminal-area">
        <div className="terminal-header">
          <div className="terminal-tabs">
            <button className="terminal-tab-btn active" data-i18n="dock.terminal">Terminal Console</button>
            {' '}
            <button
              className="terminal-tab-btn"
              onClick={(event: any) => { alert('Rerun visualizer logs is active on live telemetry!') }}
              data-i18n="dock.lerobotStream"
            >LeRobot Stream</button>
            {' '}
            <button
              className="terminal-tab-btn"
              onClick={(event: any) => { App.clearTerminal() }}
              data-i18n="dock.clearLogs"
            >Vymazat logy</button>
          </div>
          <div className="terminal-controls">
            <span style={{ color: "var(--text-muted)", fontSize: "11.5px" }} id="console-count">(0 lines)</span>
            {' '}
            <button
              className="btn btn-xs btn-secondary"
              onClick={(event: any) => { App.toggleTerminal() }}
              data-i18n="btn.toggle"
            >Toggle</button>
          </div>
        </div>
        <div
          className="terminal-body"
          id="console-output"
          role="log"
          aria-live="polite"
          aria-label="Konzole LeRobot procesů"
        >
          {/* Populated dynamically via JS websocket logger */}
          <div className="t-line info">
            <span className="tag bg-syntax-type/20 text-syntax-type">SYSTEM</span>
            {' '}Booting Orchiday local console...
          </div>
          <div className="t-line info">
            <span className="tag bg-syntax-variable/20 text-syntax-variable">HARDWARE</span>
            {' '}Scanning serial ports & video devices...
          </div>
        </div>
        {/* Terminal Interactive command prompt row */}
        <div
          className="terminal-body"
          style={{ flex: "0", borderTop: "1px solid var(--border-dark)", padding: "4px 10px", background: "rgba(0,0,0,0.1)" }}
        >
          <div className="terminal-prompt-row">
            <span className="terminal-prompt-user">orchiday@SOarm101</span>
            {' '}
            <span style={{ color: "var(--text-main)" }}>:</span>
            {' '}
            <span className="terminal-prompt-dir">~/workbench</span>
            {' '}
            <span style={{ color: "var(--text-white)", fontWeight: "700" }}>$</span>
            {' '}
            <input
              type="text"
              className="terminal-prompt-input"
              id="console-input"
              placeholder="Zadejte příkaz pro LeRobot..."
              aria-label="Příkazový řádek terminálu LeRobot"
            />
          </div>
        </div>
      </div>
      {/* Middle: Thin Vertical Sidebar for Camera Toggle */}
      <div
        className="cameras-toggle-bar"
        onClick={(event: any) => { App.toggleCamerasDock() }}
        title="Zobrazit/Skrýt kamery"
      >
        <button className="camera-bar-btn">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M23 7l-7 5 7 5V7z"></path>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
        </button>
      </div>
      {/* Vertical Drag Handle for Resizing Camera Dock Width */}
      <div className="cameras-drag-handle" id="cameras-drag-handle"></div>
      {/* Right: Docked Cameras Panel */}
      <div id="docked-cameras-area" className="cameras-dock">
        <div className="terminal-header" style={{ justifyContent: "space-between", flexShrink: "0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--cyan)"
              strokeWidth="2.5"
            >
              <path d="M23 7l-7 5 7 5V7z"></path>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg>
            {' '}
            <span
              style={{ fontSize: "12.5px", fontWeight: "bold", color: "var(--text-white)", textTransform: "uppercase" }}
              data-i18n="dock.cameras"
            >Živé kamery</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{ fontSize: "10.5px", color: "var(--text-muted)", fontWeight: "bold", letterSpacing: "0.5px" }}
              data-i18n="dock.layout"
            >ROZLOŽENÍ:</span>
            <select
              id="camera-layout-select"
              aria-label="Rozložení kamer"
              onChange={(event: any) => { App.onCameraLayoutChange() }}
              style={{ background: "rgba(30,30,32,0.8)", border: "1px solid var(--border)", color: "var(--text-white)", fontSize: "11.5px", padding: "2px 4px", fontWeight: "bold", cursor: "pointer", outline: "none" }}
              defaultValue="2"
            >
              <option value="auto">Auto</option>
              <option value="1">1 kamera</option>
              <option value="2">2 kamery</option>
              <option value="3">3 kamery</option>
              <option value="4">4 kamery</option>
            </select>
          </div>
        </div>
        <div className="cameras-dock-body">
          {/* Camera 1 */}
          <div
            className="cam-box"
            style={{ position: "relative", background: "#000", overflow: "hidden" }} ref={important({ aspectRatio: "4/3", width: "48%", flex: "1 1 48%", maxWidth: "calc(50% - 4px)", maxHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center" })}
          >
            <span
              className="cam-tag"
              style={{ position: "absolute", top: "4px", left: "4px", zIndex: "10", background: "rgba(0,0,0,0.6)", padding: "2px 6px", fontSize: "10.5px", fontWeight: "bold", color: "var(--text-light)" }}
              data-i18n="cam.globalScene"
            >Globální (Scéna)</span>
            <div
              id="tele-cam-feed-placeholder-1"
              style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <span style={{ fontSize: "10.5px", color: "var(--text-muted)" }}>Kamera 1 offline</span>
            </div>
          </div>
          {/* Camera 2 */}
          <div
            className="cam-box"
            style={{ position: "relative", background: "#000", overflow: "hidden" }} ref={important({ aspectRatio: "4/3", width: "48%", flex: "1 1 48%", maxWidth: "calc(50% - 4px)", maxHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center" })}
          >
            <span
              className="cam-tag"
              style={{ position: "absolute", top: "4px", left: "4px", zIndex: "10", background: "rgba(0,0,0,0.6)", padding: "2px 6px", fontSize: "10.5px", fontWeight: "bold", color: "var(--text-light)" }}
            >Wrist (Kleště)</span>
            <div
              id="tele-cam-feed-placeholder-2"
              style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <span style={{ fontSize: "10.5px", color: "var(--text-muted)" }}>Kamera 2 offline</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
