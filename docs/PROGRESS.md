# Orchiday — deník cloudových běhů

Zapisuje se sem na konci každého běhu: co se změnilo, proč, co bylo ověřeno
a co zůstává na fyzickém robotu. Na začátku běhu si tenhle soubor přečti —
sekce „Otevřené věci" je fronta práce pro další běhy.

Formát: nejnovější běh nahoře.

---

## 2026-08-01 (3) — Oprava rozbité stránky Nastavení (verify.sh na mainu neprocházel)

**Výchozí stav byl rozbitý.** `bash scripts/verify.sh` na `main` (58277f7)
padal na dvou kontrolách — priorita A, takže tenhle běh řešil jen to.

**Co bylo rozbité a čím**

Commit 58277f7 přepsal stránku Nastavení do jednoho panelu, ale přitom:

1. `App.browseFile('settings-python-path')` — **taková metoda neexistuje**.
   Tlačítko „Procházet" u cesty k Pythonu tiše nedělalo nic.
2. Klíče `settings.title` a `settings.python.ph` se používaly v HTML, ale
   nebyly v `i18n.js` → nadpis panelu a placeholder zůstaly natvrdo česky
   i v anglickém režimu.
3. **Zmizel textarea `settings-scene-desc`.** `saveGlobalSettings()` ho ale
   dál četl přes `getElementById` → `null` → posílal `scene_description: ""`,
   a backend (`server.py:1475`) přepisuje každý klíč, který dostane. Kliknutí
   na „Uložit Globální Nastavení" tedy **smazalo popis scény projektu** —
   povinné pole, které dostává CEO plánovač i VLM inspektor jako kontext.
4. **Zmizel přepínač jazyka.** `.lang-toggle` nebyl v celém `index.html`
   nikde jinde → aplikace se nedala přepnout do angličtiny z UI.
5. `.editor-area .setup-block { flex: 1 }` je specifičtější než `.help-block
   { flex: 0 0 auto }`, takže se pravidlo propsalo i na bloky uvnitř
   `.help-scroll`. Změřeno v headless Chromiu: první blok Nápovědy měl
   **59–73 px** místo ~324 px, při 1024×760 bylo zmáčknutých všech 8 bloků
   a scrollport vůbec nescrolloval — stránka Nápověda byla nečitelná.

**Ještě jedna rozbitá věc — přišla během běhu (4ea4279 / 4c27b2b)**

Během práce přistály na `main` dva další commity se `styles.css`, které
přidaly `.editor-area { flex: 1; display: flex; … }` na řádek ~4825.
`.editor-area` má ale na řádku 548 `display: none` a zobrazuje se výhradně
přes `.editor-area.active-page`. Stejná specificita + pozdější pozice v
souboru = `display: flex` vyhrálo → **vykreslovalo se všech osm stránek
najednou pod sebou, každá ~60 px vysoká**. Naměřeno v headless Chromiu:
výška stránky 632 px → 70 px, `settings-pane` 456 px → 22 px, tlačítka
v patičce přestala být klikatelná. Celá aplikace byla nepoužitelná.

Pravidlo je přitom **beze zbytku duplicitní**: `flex: 1` a `min-height: 0`
už `.editor-area` má, a `display: flex` + `flex-direction: column` +
`gap: 14px` má `.editor-area.active-page`. Blok je proto smazaný a na jeho
místě je komentář, proč se sem `.editor-area { display: … }` psát nesmí.
Zbytek obou commitů (mřížky `projects/connect/manage/modelrun/train/adv`,
`.setup-wizard-panel`, `.setup-block-content`) zůstal beze změny.

**Co se změnilo**

- **`src/orchiday/core/file_dialogs.py`** (nový) — jeden nativní dialog pro
  všechny tři platformy, zvlášť varianta pro soubor a pro složku:
  macOS `osascript` → Linux `zenity` → `kdialog` → Windows tkinter →
  PowerShell WinForms, s tkinterem jako univerzální poslední záchranou.
  Zrušení i „žádný dialog na stroji není" vrací `""`, nikdy výjimku.
  Titulek se sanitizuje — v AppleScriptu a PowerShellu se vkládá do *kódu*,
  ne do argv.
- `server.py` — `/api/utils/browse_directory` přepsán na tenhle helper
  (byl to 90řádkový blok s natvrdo českým titulkem „Vyberte adresář LeRobot"
  i při výběru úložiště datasetů) a přibyl `/api/utils/browse_file`.
  Oba snesou POST bez těla (tak je volá wizard).
- `app.ts` — `browsePath()` + tenké `browseDirectory()` / `browseFile()`.
  Tlačítko je po dobu otevřeného dialogu disabled (dialog je modální na
  ploše, ne v prohlížeči — druhý klik jinak naskládá další okno) a titulek
  dialogu se posílá lokalizovaný.
- `saveGlobalSettings()` posílá **jen klíče, jejichž element na stránce
  opravdu je**. Chybějící pole už nikdy nepřepíše uloženou hodnotu.
  Tlačítko během ukládání ukazuje `btn.saving`.
- Vrácen přepínač jazyka i popis scény. `.lang-row` dostal
  `flex-direction: row` — `.cfg-card-body` je `column` a `.lang-row` směr
  nepřepisoval, takže přepínač padal pod popisek doprostřed karty.
- `.editor-area > .setup-block` / `> .setup-section` (přímý potomek) —
  panely stránky vyplní výšku, vnořené bloky v scrollportu si nechají
  přirozenou výšku.
- **Diagnostika rozšířena ze 4 na 9 řádků** — operační systém, Python,
  LeRobot, PyTorch, výpočetní zařízení (cuda/mps/cpu + název GPU), ffmpeg,
  conda, Miniconda, volné místo + cesta k úložišti. Není to výplň: bez
  ffmpegu LeRobot nedokóduje epizody a zjistí se to až po ztraceném sběru,
  a `disk_free` je nad reálnou cestou z `hf_home_for(project)`.
  Tři subprocessy nahradil jeden probe (`_ENV_PROBE`) běžící v *cílovém*
  interpretu; `loadSysInfo()` po dobu detekce ukazuje `btn.detecting`.
- Detekce Minicondy zná i `miniforge3`, `/opt/anaconda3`, `%LOCALAPPDATA%`
  a `C:/ProgramData` — dřív to byly tři POSIXové cesty.
- Backend už nevrací české řetězce „Neznámá"/„Nenalezeno" jako *data*;
  vrací `""` a frontend (`setDiagValue()`) je lokalizuje sám.
- `tests/test_file_dialogs.py` — 24 testů (výběr příkazu podle platformy,
  soubor vs. složka, pořadí fallbacků, sanitizace titulku, chování při
  zrušení a chybějícím binárce).
- Bump assetů na `?v=3.50.0` (v souboru bylo pořád 3.48.0).

**Ověřeno v cloudu**

- `bash scripts/verify.sh` prochází celé: tsc, **131 pytestů** (bylo 107),
  compileall, i18n parita cs=en=728, žádná duplicitní id, 101 `App.*` odkazů.
- `/api/settings/sysinfo` proti běžícímu backendu (TestClient): 200 za 0,3 s,
  vrací všech 12 polí, `disk_free` „28.7 GB / 252 GB". `/api/utils/browse_file`
  i `browse_directory` vrací 200 a `path: ""` (v kontejneru není tkinter ani
  zenity) — včetně POSTu bez těla.
- Headless Chromium přes lokální HTTP server (aby se `/static/*` opravdu
  načetlo) na 1600×900, 1280×800 i 1024×760: obě tlačítka v patičce i
  „Obnovit" jsou hit-testem klikatelná, žádný vodorovný přetok, žádný
  roztažený prvek, přepínač jazyka i popis scény na stránce, 9 diag řádků.
- Nápověda **před** změnou: 2–8 zmáčknutých bloků, první 59–73 px, scrollport
  nescrolloval. **Po** změně: 0 zmáčknutých, první blok 324 px, scrolluje.

**Zbývá vyzkoušet na fyzickém robotu / reálném desktopu** (v cloudu nelze)

- Že se nativní dialog opravdu otevře: zenity i kdialog na Linuxu, Finder na
  macOS, Explorer na Windows. V kontejneru není ani tkinter, takže se ověřilo
  jen sestavení příkazů a to, že chybějící dialog nespadne.
- Že `settings-python-path` vybraný přes dialog opravdu spustí LeRobot
  (uloží se do `AppConfig`, čte ho `lerobot_bridge`).
- Diagnostika proti prostředí s LeRobotem a GPU: verze PyTorch, `cuda — <GPU>`,
  verze ffmpegu. V cloudu jsou všechna tato pole prázdná.

## 2026-08-01 (2) — Akční tlačítka dovnitř oken (`.block-actions`) + 3 layoutové chyby

**Co se změnilo**

- **Nový vzor `.block-actions`** (styles.css) — patička akcí přišpendlená ke
  spodní hraně panelu, protějšek existujícího `.block-head-row`. Hint vlevo
  (`flex:1 1 180px`), tlačítka vpravo s `flex:0 0 auto`, takže se panel nikdy
  nevyplňuje roztaženým tlačítkem. Pod 1100 px se řádek zalomí.
- **Všechna akční tlačítka přesunuta z `page-header-row` do panelu**, kterého
  se týkají — projects, setup/connect, setup/models, teleoperace,
  datasety/sběr, datasety/správa, učení/trénink, modelrun, settings (uložení
  i instalace LeRobotu), strom dovedností. V hlavičkách stránek zůstaly jen
  nadpisy. Zmizely tři „prázdné" `page-header-row` (spacer `<div style="flex:1">`
  + tlačítka), které existovaly jen jako lišta.
- Každá patička dostala **technicky přesný hint**, co tlačítka udělají
  (`hint.*Scope`) a tooltipy `tip.*` u tlačítek, která je neměla.
- **Odstraněn duplicitní prvek**: tlačítko „Nápověda ke schématu" v hlavičce
  nastavení dělalo `changeTab('help')` — přesně to samé, co položka Nápověda
  v levém navigačním pruhu. Klíč `btn.openHelp` smazán z cs i en.
- Bump assetů na `?v=3.49.0`.

**Opravené chyby (nalezené při práci, ne plánované)**

1. **Karta „Správa datasetů" se vůbec nezobrazila.** Panel
   `data-tab-panel="manage"` byl v HTML vnořený *uvnitř* panelu `collect`
   (chybějící `</div>` u collect, přebývající `</div>` na konci stránky).
   `switchDatasetyTab('manage')` schová collect → schová i manage.
   Ověřeno v headless Chromiu: `#ds-select` mělo před opravou rozměr 0×0,
   po opravě 634×32. Uzávěrky divů jsou teď okomentované.
2. **Karty výběru policy přetékaly přes formulář.** `.policy-pick` je v
   `form-group{flex:1; min-height:0}`, ale sám neměl `min-height:0` ani
   `overflow`, takže se SmolVLA / VQ-BeT / π0 vykreslovaly *přes* pole
   „Tréninkové kroky", „Batch size" a „Trénovací zařízení". Nově scrolluje.
3. **Krátké karty nešly zmenšit.** `#page-datasety[manage]`,
   `#page-uceni[advanced]`, `#page-setup[calibrate|models]` měly
   `.setup-section { flex: 0 0 auto }` — obsah se tedy nemohl smrsknout a při
   nízkém okně vytlačil spodek panelu (u nás nově s primární akcí) mimo
   scrollport. Změněno na `flex: 0 1 auto; min-height: 0;
   grid-template-rows: minmax(0, auto)`.
4. `.btn-cyan-dashed` měl v sobě `width: 100%` — barevná varianta diktovala
   layout a roztahovala tlačítko přes celý kontejner. Odstraněno.
   Stejně tak „Přidat kameru" / „Vymazat všechny" už nejsou přes celou šířku.
5. `saveModelConfig()` hledal `.btn-save-hw-config`, ale **žádný element
   tuhle třídu neměl** — indikace průběhu ukládání byla mrtvý kód. Třídu mají
   teď obě tlačítka a popisek se přepíná přes i18n (`btn.saving`) s obnovením
   původního textu, ne natvrdo česky.

**Ověřeno v cloudu**

- `bash scripts/verify.sh` celé prošlo (tsc, 105 pytestů, compileall,
  i18n parita cs=en=701, žádná duplicitní id, 100 `App.*` odkazů z HTML).
- Kontrola párování tagů v `index.html` vlastním parserem: 0 chyb, 0
  neuzavřených elementů; všech 8 stránek i všech 7 wizard-panelů je teď na
  správné úrovni zanoření.
- Headless Chromium (1600×900, 1280×800, 1024×760): každá primární akce
  v patičce je viditelná a **hit-testem klikatelná** (nic ji nepřekrývá),
  žádná stránka nemá vodorovný přetok, žádné tlačítko není roztažené
  (nejširší 225 px = dlouhý popisek instalace LeRobotu).

**Zbývá vyzkoušet na fyzickém robotu** (v cloudu nelze)

- Že přesunutá tlačítka opravdu spouští procesy: teleop, `lerobot-record`,
  `lerobot-train`, nasazení policy. Přesouvaly se jen v DOM, id zůstala
  stejná (`updateActionButtonStates()` je hledá přes `getElementById`), ale
  klik na reálném hardwaru ověřený není.
- Ukládání hardwaru z obou karet (Connect i Modely) proti běžícímu backendu.
- „Rozdělit podle kroků" nad reálně nasbíraným datasetem se značkami.

## 2026-08-01 — Patchování LeRobotu ve wrapperech: úplné a ověřené

**Co se změnilo**

- `_CALIBRATION_WRAPPER_SRC` (src/orchiday/ai/lerobot_bridge.py) — `enter_pressed()`
  se nově patchuje v **definičním** modulu `lerobot.utils.utils` a navíc ve všech
  už načtených `lerobot.*` modulech, které si jeho kopii drží. Když není co
  patchnout, wrapper skončí s `SystemExit(3)` a hláškou `[ORCHIDAY_CAL] FATAL`.
  Při úspěchu vypíše, které moduly patchnul.
- `_RECORD_WRAPPER_SRC` — před patchem ověří, že `init_keyboard_listener`
  i `record_loop` na `lerobot.scripts.lerobot_record` **existují a jsou volatelné**.
  Když ne, pošle `[ORCHIDAY_REC] {"ev":"fatal"}` a skončí `SystemExit(3)`.
- `LeRobotBridge._handle_record_event()` — nová větev pro `ev == "fatal"`, aby se
  hláška objevila jako ERROR v logu, ne jen jako zmizelý proces.
- `web/app.ts` `rerenderDynamic()` — hledalo `page-datasets` a `page-advancedtraining`;
  žádný element takové id nemá. Opraveno na `page-datasety` a `page-uceni`.
- `tests/test_lerobot_wrappers.py` — nový soubor, 10 testů.
- Bump assetů v `index.html` na `?v=3.48.1`.

**Co to řeší**

`enter_pressed` je v LeRobotu definován jednou (`lerobot/utils/utils.py`), ale
každá sběrnice motorů si ho tahá přes `from ... import enter_pressed` a **každá
rodina má vlastní `record_ranges_of_motion()`**:

| soubor | rodina | robot v Orchiday |
|---|---|---|
| `lerobot/motors/motors_bus.py` | Feetech / Dynamixel | SO-100/101, Koch, OMX, LeKiwi |
| `lerobot/motors/damiao/damiao.py` | Damiao CAN | **OpenArm** (`openarm_follower/leader`) |
| `lerobot/motors/robstride/robstride.py` | RobStride | — |

Patchoval se jen `motors_bus`. Pro OpenArm (je v nabídce robotů) tedy tlačítko
„Potvrdit krok" nedělalo nic a kalibrace se nikdy nepohnula dál. Navíc: přiřazení
atributu do modulu, který ho nemá, ho tiše **vytvoří** — takže přejmenování
symbolu v novější verzi LeRobotu by z obou wrapperů udělalo no-op, který
u nahrávání znamená mrtvá tlačítka epizod a žádné značky pod-úkolů, tedy
nepoužitelná data bez jediné chybové hlášky. Teď to spadne nahlas.

**Ověřeno proti zdrojákům LeRobotu 0.4.4** (staženo z PyPI a rozbaleno)

- `lerobot/utils/utils.py:260` — `enter_pressed()` je tady, ne v `motors_bus`.
- `record_ranges_of_motion` opravdu existuje 3× (řádky 790 / 759 / 879 výše).
- `lerobot/datasets/lerobot_dataset.py:1189` — `timestamp = frame_index / self.fps`.
  Časová základna značek (`frames / fps`) tedy sedí na sloupec, podle kterého
  splitter řeže. Komentáře odkazovaly na neexistující `dataset_writer.py`, opraveno.
- `lerobot/scripts/lerobot_record.py:534,563` — `record_loop()` se volá **jen
  keyword argumenty**, takže `kwargs.get("dataset")` ve wrapperu je správně.
- `init_keyboard_listener` se do `lerobot_record` importuje na řádku 136 a volá
  jako holé jméno (523) → patch modulového atributu funguje.
- Mapování kláves ve wrapperu odpovídá `lerobot/utils/control_utils.py:149-161`
  (→ exit_early, ← rerecord_episode + exit_early, ESC stop_recording + exit_early).

**Ověřeno v cloudu**: `bash scripts/verify.sh` celé prošlo (tsc, 105 pytestů,
compileall, i18n parita, duplicitní id, `App.*` odkazy z HTML).

**Zbývá vyzkoušet na fyzickém robotu** (v cloudu nelze):
- Kalibrace SO-100/101 — tlačítko „Potvrdit krok" musí posunout range-of-motion.
- Kalibrace OpenArm / jiného Damiao ramene — hlavní důvod téhle změny.
- Nahrávání: →/n uložit epizodu, ←/r zahodit a opakovat, ESC/q ukončit.
- Značkování pod-úkolů během epizody a následné rozdělení datasetu.

---

## Otevřené věci (fronta pro další běhy)

**Frontend**
- ~~Tlačítka akcí sedí v `page-header-row`~~ — hotovo 2026-08-01 (2), vzor
  `.block-actions`.
- **Teleoperace: `.setup-block` se ořezává při nízkém okně.** Změřeno na
  1280×800 (562 > 492 px) a 1024×760 (813 > 462 px) — blok nemá `overflow-y`,
  takže spodek obsahu prostě zmizí. Existuje i na 58277f7, tedy ne regrese
  z 2026-08-01 (3), ale je to skutečná chyba. Buď dát bloku scrollport,
  nebo zmenšit obsah pod 1080p.
- **Před commitem na `main` pouštět `scripts/verify.sh`.** 58277f7 přistál
  s dvěma padajícími kontrolami (chybějící `App.browseFile`, dva nedefinované
  i18n klíče) a se ztrátou popisu scény i přepínače jazyka.
- **Prázdná plocha v panelech.** Setup/Connect: mezi výběrem portů a patičkou
  zbývá ~150 px prázdna; teleop „Ovládání relace" podobně. Vyplnit rozvržením
  nebo grafickým prvkem (v CSS existuje nepoužitý `#arm-visual-block`), NE
  roztažením polí. Tohle je věc, kterou zadání označuje za hlavní problém.
- Konzolový dok dole překrývá spodek pracovní plochy při nízkém okně
  (< ~800 px). `.editor-area` sice scrolluje, ale dok si nerezervuje místo.
- `.datacollection-grid` má v CSS pravidla pro `nth-child(3)` (280px sloupec
  kamer), ale v HTML jsou jen 2 bloky — kamerový sloupec ze sběru dat zmizel
  (souvisí s mrtvými id `cam-feed-placeholder-1/2` níže). Rozhodnout: vrátit,
  nebo pravidla smazat.
- `:root` má `--radius: 6px`, `--radius-lg: 10px` a `--overlay-blur: blur(8px)`,
  plus `backdrop-filter: blur(4px)` na styles.css:1498 — zadání chce ostré rohy
  a žádný blur. Stíny/glow už jsou vynulované.
- `styles.css` importuje fonty z `fonts.googleapis.com` — bez internetu appka
  spadne na fallback. Zvážit zabalení fontů lokálně.
- Mrtvé odkazy na id v `app.ts` (jsou null-guardované, takže nic nepadá, ale je to
  neudržovaný kód): `status-ws`, `status-robot`, `status-lm`, `robot-list`,
  `sidebar-proj-name`, `sidebar-projects-list-container`, `breadcrumb-file`,
  `breadcrumb-section`, `active-skill-size`, `active-skill-training`,
  `task-latch-desc-text`, `train-repo-id`, `cam-feed-placeholder-1/2`.
  Buď doplnit chybějící UI (indikátor stavu WS/robota by se hodil), nebo smazat.
- Natvrdo česky psané řetězce v dynamicky generovaném HTML (mimo i18n):
  `dsRefreshList`, `advPopulateResumeSkills`, `selectSkill` (seznam epizod:
  „Epizoda", „Přehrát", „Smazat"), wizard `wizard-opt-found-*`.

**Backend / LeRobot**
- Nedá se ověřit chování na LeRobotu ≥ 0.5 — PyPI index v cloudu má maximum
  0.4.4. Nové wrappery aspoň spadnou nahlas místo tichého no-opu.
