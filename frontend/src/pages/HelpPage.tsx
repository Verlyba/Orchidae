/** #page-help — migrated verbatim from the pre-React web/index.html. */

export function HelpPage() {
  return (
    <div id="page-help" className="editor-area">
      <div className="page-header-row">
        <h2 data-i18n="page.help.title">Nápověda — Orchestrační schéma</h2>
        <span className="page-header-sub" data-i18n="help.subtitle">Jak Orchiday skládá dlouhé úlohy z malých modelů</span>
      </div>
      <div className="help-scroll">
        {/* A) Co to je a k čemu */}
        <div className="setup-block help-block">
          <h3>
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
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            {' '}
            <span data-i18n="help.intro.title">Co to je a k čemu to slouží</span>
          </h3>
          <div className="setup-block-content">
            <p className="help-p" data-i18n-html="help.intro.p1">
              Jedna imitační policy (např. ACT) zvládne spolehlivě{' '}
              <strong>jednu krátkou motorickou dovednost</strong>
              {' '}— uchopit kostku, přejet nad krabici. U dlouhé úlohy složené z mnoha fází ale chyby narůstají a model nemá jak poznat, že se odchýlil.{' '}
              <strong>Orchestrační schéma</strong>
              {' '}proto úlohu rozdělí: velký jazykový model plánuje, malé specializované policy vykonávají jednotlivé kroky a vizuální model po každém kroku kontroluje výsledek.
            </p>
            <p className="help-p" data-i18n-html="help.intro.p2">
              Výsledkem je „třívrstvý mozek":{' '}
              <strong>CEO (LLM)</strong>
              {' '}rozumí zadání,{' '}
              <strong>Inspektor (VLM)</strong>
              {' '}vidí scénu a{' '}
              <strong>svaly (per-step policy)</strong>
              {' '}hýbou robotem. Každá vrstva dělá jen to, v čem je nejlepší — a protože se po každém kroku verifikuje stav, systém se umí z chyby zotavit přeplánováním.
            </p>
            <div className="help-roles">
              <div className="cfg-card">
                <div className="cfg-card-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path
                      d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"
                    ></path>
                    <line x1="9" y1="22" x2="15" y2="22"></line>
                  </svg>
                </div>
                <div className="cfg-card-body">
                  <div className="cfg-card-title" data-i18n="help.role.llm.title">1 · LLM Planner „CEO"</div>
                  <div className="cfg-card-desc" data-i18n="help.role.llm.desc">
                    Dostane instrukci + katalog dovedností projektu (ID, názvy, popisy, hierarchii) a vrátí čisté JSON pole kroků. Běží v LM Studio; endpoint a system prompt nastavíš na stránce Orchestrace → AI modely.
                  </div>
                </div>
              </div>
              <div className="cfg-card">
                <div className="cfg-card-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                </div>
                <div className="cfg-card-body">
                  <div className="cfg-card-title" data-i18n="help.role.vlm.title">2 · VLM Inspector „Inspektor"</div>
                  <div className="cfg-card-desc" data-i18n="help.role.vlm.desc">
                    Po každém kroku dostane snímek scény a otázku „splnil se krok X?". Vrací verdikt + značku chyby (např. NOT_GRASPED), která řídí přeplánování. Také běží v LM Studio jako samostatný endpoint.
                  </div>
                </div>
              </div>
              <div className="cfg-card">
                <div className="cfg-card-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 15V9a4 4 0 0 0-8 0v6M6 15V9a4 4 0 0 1 8 0v6"></path>
                    <circle cx="12" cy="18" r="3"></circle>
                  </svg>
                </div>
                <div className="cfg-card-body">
                  <div className="cfg-card-title" data-i18n="help.role.policy.title">3 · Per-step policy „Svaly"</div>
                  <div className="cfg-card-desc" data-i18n="help.role.policy.desc">
                    Malé ACT/Diffusion modely — jeden na každý pod-krok dovednosti. Natrénují se z dílčích datasetů vzniklých rozdělením jedné nahrávky podle značek. Za běhu je drží trvalý inferenční daemon a vahami se přepínají bez restartu.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* B) Diagram */}
        <div className="setup-block help-block">
          <h3>
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
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
            {' '}
            <span data-i18n="help.flow.title">Schéma běhu</span>
          </h3>
          <div className="setup-block-content">
            <div className="help-flow">
              <div className="hf-node hf-io">
                <div className="hf-node-title" data-i18n="help.flow.instr">Instrukce uživatele</div>
                <div className="hf-node-desc" data-i18n="help.flow.instrDesc">„Ukliď kostku do krabice" — stránka Běh modelu</div>
              </div>
              <div className="hf-arrow" aria-hidden="true"></div>
              <div className="hf-node">
                <div className="hf-node-title" data-i18n="help.flow.plan">1 · LLM Planner (CEO) — plán</div>
                <div className="hf-node-desc" data-i18n="help.flow.planDesc">LM Studio vrátí JSON pole ID dovedností, např. ["tidy_cube"]</div>
              </div>
              <div className="hf-arrow" aria-hidden="true"></div>
              <div className="hf-node">
                <div className="hf-node-title" data-i18n="help.flow.resolve">2 · Resolver plánu — validace & expanze</div>
                <div className="hf-node-desc" data-i18n="help.flow.resolveDesc">
                  Neznámá ID zahodí, názvy převede na slugy a cíl rozbalí na seřazené kroky: [grab_cube, move_to_box, release]
                </div>
              </div>
              <div className="hf-arrow" aria-hidden="true"></div>
              <div className="hf-loop">
                <div className="hf-loop-label" data-i18n="help.flow.loopLabel">Smyčka pro každý krok plánu</div>
                <div className="hf-node">
                  <div className="hf-node-title" data-i18n="help.flow.swap">3 · Hot-swap modelu (SET_POLICY)</div>
                  <div className="hf-node-desc" data-i18n="help.flow.swapDesc">
                    Daemon vymění váhy policy daného kroku — robot i kamera zůstávají připojené
                  </div>
                </div>
                <div className="hf-arrow" aria-hidden="true"></div>
                <div className="hf-node">
                  <div className="hf-node-title" data-i18n="help.flow.exec">4 · Exekuce (SET_TASK) + zámek úlohy</div>
                  <div className="hf-node-desc" data-i18n="help.flow.execDesc">
                    Policy řídí robota na 30 Hz; TaskLatch blokuje další příkazy, dokud krok neskončí
                  </div>
                </div>
                <div className="hf-arrow" aria-hidden="true"></div>
                <div className="hf-node">
                  <div className="hf-node-title" data-i18n="help.flow.term">5 · Ukončení kroku (Protokol A / B)</div>
                  <div className="hf-node-desc" data-i18n="help.flow.termDesc">
                    Dosednutí kloubů nebo proudová špička gripperu → TASK_DONE → zámek se odemkne
                  </div>
                </div>
                <div className="hf-arrow" aria-hidden="true"></div>
                <div className="hf-node">
                  <div className="hf-node-title" data-i18n="help.flow.snap">6 · Snímek scény (SNAP)</div>
                  <div className="hf-node-desc" data-i18n="help.flow.snapDesc">
                    Kameru vlastní daemon — snímek pro inspektora vydá on, ne náhledové kamery
                  </div>
                </div>
                <div className="hf-arrow" aria-hidden="true"></div>
                <div className="hf-node">
                  <div className="hf-node-title" data-i18n="help.flow.verify">7 · VLM verifikace</div>
                  <div className="hf-node-desc" data-i18n="help.flow.verifyDesc">
                    „Je kostka v gripperu?" → SUCCESS pokračuje, chybová značka spouští re-plán
                  </div>
                </div>
                <div className="hf-branch">
                  <div className="hf-branch-item hf-ok" data-i18n="help.flow.ok">✓ Úspěch → další krok plánu</div>
                  <div className="hf-branch-item hf-fail" data-i18n="help.flow.fail">✗ Neúspěch → nový plán od CEO (max 3×)</div>
                </div>
              </div>
              <div className="hf-arrow" aria-hidden="true"></div>
              <div className="hf-node hf-io">
                <div className="hf-node-title" data-i18n="help.flow.log">Záznam běhu — run.json + snímky</div>
                <div className="hf-node-desc" data-i18n="help.flow.logDesc">
                  Každý běh se ukládá do orchestration_runs/ — plán, časy, úspěšnost kroků, VLM snímky
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* C) Krok za krokem */}
        <div className="setup-block help-block">
          <h3>
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
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
            {' '}
            <span data-i18n="help.steps.title">Co se přesně kde děje</span>
          </h3>
          <div className="setup-block-content">
            <ol className="help-steps">
              <li data-i18n-html="help.steps.1">
                Instrukci odešle stránka{' '}
                <strong>Běh modelu</strong>
                {' '}na server (
                <code>POST /api/orchestrate</code>
                ); orchestrátor startuje ve vlastním vlákně, UI nikdy neblokuje.
              </li>
              <li data-i18n-html="help.steps.2">
                <strong>Planner</strong>
                {' '}sestaví system prompt z katalogu dovedností (ID, popisy, hierarchie „cíl → kroky") a zavolá LM Studio. Odpověď musí být čisté JSON pole — cokoliv jiného je chyba plánování.
              </li>
              <li data-i18n-html="help.steps.3">
                <strong>Resolver</strong>
                {' '}plán vyčistí: halucinovaná ID zahodí (loguje varování), názvy mapuje zpět na slugy a rodičovský cíl nahradí jeho seřazenými pod-kroky. Prázdný plán běh korektně ukončí.
              </li>
              <li data-i18n-html="help.steps.4">
                Pro první krok se spustí{' '}
                <strong>trvalý inferenční daemon</strong>
                {' '}(orchiday_inference.py) — jediný proces, který vlastní sériový port robota a kamery po celou dobu běhu. Náhledy kamer v UI se automaticky pozastaví a po skončení zase obnoví.
              </li>
              <li data-i18n-html="help.steps.5">
                Daemon nahlásí{' '}
                <code>DAEMON_READY</code>
                , dostane{' '}
                <code>SET_TASK</code>
                {' '}a přejde do RUNNING: čte pozorování (klouby + kamera), policy predikuje akce, robot je vykonává na 30 Hz.
              </li>
              <li data-i18n-html="help.steps.6">
                Souběžně orchestrátor drží{' '}
                <strong>zámek úlohy (TaskLatch)</strong>
                {' '}— dokud krok neskončí, žádný další příkaz se nepustí. Strategie: čekej na dokončení, timeout, nebo hybrid (co nastane dřív).
              </li>
              <li data-i18n-html="help.steps.7">
                Krok končí{' '}
                <strong>Protokolem A</strong>
                {' '}(klouby se ustálily u cíle — 5 snímků po sobě pod prahem) nebo{' '}
                <strong>Protokolem B</strong>
                {' '}(proud gripperu překročil limit = kontakt s objektem). Daemon vypíše{' '}
                <code>TASK_DONE</code>
                , motory zamrznou v pozici a zámek se odemkne.
              </li>
              <li data-i18n-html="help.steps.8">
                Orchestrátor si vyžádá{' '}
                <strong>snímek scény</strong>
                : příkaz{' '}
                <code>SNAP</code>
                {' '}do daemonu (vlastní kameru) → base64 JPEG. Když daemon kameru nemá, použije se náhledová kamera aplikace.
              </li>
              <li data-i18n-html="help.steps.9">
                <strong>Inspektor</strong>
                {' '}dostane snímek + popis kroku a vrátí verdikt. Úspěch → index kroku +1. Neúspěch → CEO dostane kontext selhání („krok X selhal kvůli Y") a sestaví nový plán; po 3 neúspěšných re-plánech běh končí chybou.
              </li>
              <li data-i18n-html="help.steps.10">
                Pro další krok s{' '}
                <em>jinou</em>
                {' '}policy pošle controller{' '}
                <code>SET_POLICY:{'<'}cesta{'>'}</code>
                {' '}— daemon váhy vymění za běhu (robot drží pozici), takže se neztrácí čas restartem procesu ani se nepřepojuje hardware.
              </li>
              <li data-i18n-html="help.steps.11">
                Každou událost běhu zapisuje{' '}
                <strong>run logger</strong>
                {' '}průběžně do{' '}
                <code>orchestration_runs/{'<'}run_id{'>'}/run.json</code>
                {' '}+ ukládá VLM snímky. Data přežijí i pád aplikace uprostřed běhu.
              </li>
              <li data-i18n-html="help.steps.12">
                Po posledním kroku se vyhodnotí celkový úspěch, výsledek se zapíše do logu a pošle do UI (
                <code>orchestration_finished</code>
                ). Daemon zůstává připravený pro další příkaz, E-STOP ho kdykoliv ukončí.
              </li>
            </ol>
          </div>
        </div>
        {/* D) Hardware + protokoly */}
        <div className="setup-section help-two-col">
          <div className="setup-block help-block">
            <h3>
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
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              {' '}
              <span data-i18n="help.hw.title">Výhradní přístup k hardwaru</span>
            </h3>
            <div className="setup-block-content">
              <ul className="help-list">
                <li data-i18n-html="help.hw.1">
                  <strong>Kameru smí v jednu chvíli držet jen jeden proces.</strong>
                  {' '}Když si ji vezme nahrávání/teleoperace/inference, náhled v UI se pozastaví a po skončení procesu sám obnoví.
                </li>
                <li data-i18n-html="help.hw.2">
                  Během orchestrace je vlastníkem kamer{' '}
                  <strong>inferenční daemon</strong>
                  {' '}— proto VLM snímky vydává on (SNAP) a ne náhledové kamery.
                </li>
                <li data-i18n-html="help.hw.3">
                  <strong>Sériové porty</strong>
                  {' '}mají registr vlastníků: pokus spustit druhý proces na obsazeném portu je odmítnut se srozumitelnou hláškou, žádné tiché kolize sběrnice.
                </li>
                <li data-i18n-html="help.hw.4">
                  Dvě kamery projektu nesmí mířit na stejné zařízení a hardware scan nikdy nesahá na zařízení, které právě streamuje — obojí dřív dokázalo shodit celou aplikaci.
                </li>
              </ul>
            </div>
          </div>
          <div className="setup-block help-block">
            <h3>
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
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              {' '}
              <span data-i18n="help.term.title">Ukončování kroků & zámek úlohy</span>
            </h3>
            <div className="setup-block-content">
              <ul className="help-list">
                <li data-i18n-html="help.term.a">
                  <strong>Protokol A — dosednutí:</strong>
                  {' '}|cíl − aktuální poloha| {'<'} 0,005 rad na všech kloubech po 5 snímků za sebou → pohybová fáze je hotová.
                </li>
                <li data-i18n-html="help.term.b">
                  <strong>Protokol B — kontakt:</strong>
                  {' '}proud serva gripperu přes 250 mA = objekt sevřen; ukončuje úchopové kroky dřív, než by policy „tlačila do prázdna".
                </li>
                <li data-i18n-html="help.term.latch">
                  <strong>TaskLatch</strong>
                  {' '}chrání běh před chaotickými příkazy:{' '}
                  <em>action_chunk</em>
                  {' '}čeká na TASK_DONE,{' '}
                  <em>timeout</em>
                  {' '}odemkne po čase,{' '}
                  <em>hybrid</em>
                  {' '}podle toho, co nastane dřív. Strategii nastavíš v konfiguraci orchestrace projektu.
                </li>
              </ul>
            </div>
          </div>
        </div>
        {/* E) Dataset metodika */}
        <div className="setup-block help-block">
          <h3>
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
              <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
            </svg>
            {' '}
            <span data-i18n="help.data.title">Jeden dataset, dva způsoby tréninku</span>
          </h3>
          <div className="setup-block-content">
            <p className="help-p" data-i18n-html="help.data.p1">
              Aby šlo orchestrační schéma{' '}
              <strong>férově porovnat s jedním monolitickým modelem</strong>
              , trénují se oba přístupy ze{' '}
              <strong>stejných demonstrací</strong>
              : úlohu nahraješ jednou a při nahrávání klikáš na hranice fází („Aktivní fázování" na stránce Sběr dat). Značky se ukládají mimo dataset, takže originál zůstává netknutý.
            </p>
            <div className="help-flow help-flow-mini">
              <div className="hf-node hf-io">
                <div className="hf-node-title" data-i18n="help.data.f1">Nahrávka se značkami fází</div>
              </div>
              <div className="hf-arrow" aria-hidden="true"></div>
              <div className="hf-node">
                <div className="hf-node-title" data-i18n="help.data.f2">Sidecar soubor značek (.step_marks.json)</div>
              </div>
              <div className="hf-arrow" aria-hidden="true"></div>
              <div className="hf-node">
                <div className="hf-node-title" data-i18n="help.data.f3">„Rozdělit podle kroků" (Správa datasetů)</div>
              </div>
              <div className="hf-arrow" aria-hidden="true"></div>
              <div className="hf-node">
                <div className="hf-node-title" data-i18n="help.data.f4">Dílčí datasety local/{'<'}cíl{'>'}/{'<'}krok{'>'}</div>
              </div>
              <div className="hf-arrow" aria-hidden="true"></div>
              <div className="hf-node hf-io">
                <div className="hf-node-title" data-i18n="help.data.f5">Trénink malých per-step modelů</div>
              </div>
            </div>
            <p className="help-p" data-i18n-html="help.data.p2">
              <strong>Baseline</strong>
              {' '}(jeden ACT model) se trénuje na plném nerozřezaném datasetu;{' '}
              <strong>per-step modely</strong>
              {' '}na dílčích datasetech z týchž epizod. Žádná strana nemá data navíc — rozdíl ve výsledcích je tedy rozdílem architektur, ne dat. Značky kotví server k reálnému začátku epizody (přesnost ≈ 0,2 s) a epizody s neúplnými značkami splitter přeskočí a zaloguje.
            </p>
          </div>
        </div>
        {/* F) Rizika */}
        <div className="setup-block help-block">
          <h3>
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
              <path
                d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
              ></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            {' '}
            <span data-i18n="help.risk.title">Rizika a jejich pojistky</span>
          </h3>
          <div className="setup-block-content">
            <div className="help-table-wrap">
              <table className="help-table">
                <thead>
                  <tr>
                    <th data-i18n="help.risk.hProblem">Riziko</th>
                    <th data-i18n="help.risk.hSolution">Pojistka ve schématu</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td data-i18n="help.risk.r1p">LLM vymyslí neexistující krok</td>
                    <td data-i18n="help.risk.r1s">
                      Resolver plán validuje proti katalogu dovedností; neznámá ID zahodí a zaloguje
                    </td>
                  </tr>
                  <tr>
                    <td data-i18n="help.risk.r2p">Krok fyzicky selže (kostka vypadne)</td>
                    <td data-i18n="help.risk.r2s">
                      VLM verifikace po každém kroku + re-plán s kontextem chyby, limit 3 pokusy
                    </td>
                  </tr>
                  <tr>
                    <td data-i18n="help.risk.r3p">Výměna modelu mezi kroky trvá dlouho</td>
                    <td data-i18n="help.risk.r3s">
                      Hot-swap vah v běžícím daemonu — hardware se nepřepojuje; při selhání swapu čistý restart daemonu
                    </td>
                  </tr>
                  <tr>
                    <td data-i18n="help.risk.r4p">Dva procesy sahají na kameru/port</td>
                    <td data-i18n="help.risk.r4s">
                      Registr vlastníků: konfliktní start je odmítnut, náhledy se pozastavují automaticky
                    </td>
                  </tr>
                  <tr>
                    <td data-i18n="help.risk.r5p">Krok se „zasekne" a nikdy neskončí</td>
                    <td data-i18n="help.risk.r5s">
                      Hybrid latch s timeoutem + ukončovací protokoly A/B; E-STOP vše okamžitě zabije
                    </td>
                  </tr>
                  <tr>
                    <td data-i18n="help.risk.r6p">LM Studio je offline</td>
                    <td data-i18n="help.risk.r6s">
                      Test spojení při otevření projektu, chybové stavy v UI; bez plánovače běh vůbec nezačne
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        {/* G) Cesty na disku */}
        <div className="setup-block help-block">
          <h3>
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
            <span data-i18n="help.paths.title">Kde co najdu na disku</span>
          </h3>
          <div className="setup-block-content">
            <div className="help-paths">
              <div className="help-path-row">
                <code>{'<'}projekt{'>'}/orchestration_runs/{'<'}run_id{'>'}/run.json</code>
                <span data-i18n="help.paths.1">
                  záznam běhu orchestrace: plán, kroky, časy, verdikty + JPEG snímky verifikací
                </span>
              </div>
              <div className="help-path-row">
                <code>{'<'}HF_HOME{'>'}/lerobot/local/{'<'}cíl{'>'}/</code>
                <span data-i18n="help.paths.2">plný nahraný dataset cílové dovednosti (baseline trénink)</span>
              </div>
              <div className="help-path-row">
                <code>{'<'}HF_HOME{'>'}/lerobot/local/{'<'}cíl{'>'}.step_marks.json</code>
                <span data-i18n="help.paths.3">značky fází z nahrávání (sidecar — dataset zůstává netknutý)</span>
              </div>
              <div className="help-path-row">
                <code>{'<'}HF_HOME{'>'}/lerobot/local/{'<'}cíl{'>'}/{'<'}krok{'>'}/</code>
                <span data-i18n="help.paths.4">dílčí datasety jednotlivých kroků vytvořené rozdělením podle značek</span>
              </div>
              <div className="help-path-row">
                <code>{'<'}úložiště{'>'}/outputs/training/{'<'}krok{'>'}_{'<'}typ{'>'}/</code>
                <span data-i18n="help.paths.5">natrénované checkpointy policy — odsud je bere inferenční daemon</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
