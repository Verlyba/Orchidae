# Orchiday — deník cloudových běhů

Zapisuje se sem na konci každého běhu: co se změnilo, proč, co bylo ověřeno
a co zůstává na fyzickém robotu. Na začátku běhu si tenhle soubor přečti —
sekce „Otevřené věci" je fronta práce pro další běhy.

Formát: nejnovější běh nahoře.

---

## 2026-08-02 (10) — Orchestrace: stránka konečně říká, co běh **opravdu**
udělá (rozložený plán + checkpoint každého kroku z backendu)

**Výchozí stav.** `bash scripts/verify.sh` na čerstvém klonu spadl na dvou
testech (`websockets` chyběl v kontejneru — už poněkolikáté, viz doporučení
níž), `setup-dev.sh` to doinstaloval a gate prošel celý (151 pytestů).
Priorita A tedy prázdná. Fronta ukazovala na `modelrun` jako nejsilnějšího
kandidáta: tři roztažená pole naráz (`#orch-input` 1204 px, `#eval-policy-path`
a `#eval-task-name` po 646 px) a obsazenost 20 / 23 / 25 %.

**Ale hlavní problém téhle stránky nebyl layout — bylo to, že lhala**

Než jsem sáhl na CSS, přečetl jsem, co backend při běhu opravdu dělá
(`Orchestrator.run()` → `Controller._execute_motor_task()` →
`LeRobotBridge.start_inference()`), a UI tomu neodpovídalo:

1. **Patička slibovala gate, který neexistuje.** `hint.deployScope` říkal
   „Nasadí checkpoint zadaný v řádku „LeRobot Worker" …; **teprve pak lze
   spustit plán**." `executeOrchestration()` nic takového netestuje a
   `_execute_motor_task()` si daemona nastartuje sám, když neběží.
2. **Orchestrace to pole vůbec nepoužívá.** Checkpoint každého kroku si
   backend dopočítá sám (`_policy_path_for()` = `dataset_storage_dir` /
   `outputs/training/{parent}_{slug}_{arch}`) a mezi kroky ho v běžícím
   daemonu **hot-swapuje**. Ručně zadaná cesta je jiná věc — ACT baseline,
   jeden model nasazený natvrdo. Stránka ty dvě větve nijak nerozlišovala,
   přitom právě jejich srovnání je smyslem projektu.
3. **Vůbec nebylo vidět, co se spustí.** Ani rozložení úkolu na pod-kroky
   (to dělá `_resolve_orchestration_plan()`), ani jestli je na ně vůbec
   natrénovaný model. Chybějící checkpoint přitom `start_inference()`
   odmítne — běh se na tom kroku zastaví.

**Backend — nový read-only endpoint, který nemůže odejít od skutečnosti**

`GET /api/orchestration/plan_preview` →
`OrchidayController.orchestration_plan_preview()`. Pro každý úkol nejvyšší
úrovně vrátí seřazené **spustitelné** kroky a u každého cestu ke checkpointu
+ jestli existuje. Klíčové je, čím to počítá — vším, co používá sám běh:

| údaj | zdroj | proč právě ten |
|---|---|---|
| seznam kroků | `_resolve_orchestration_plan()` | resolver, který orchestrátoru expanduje plán |
| cesta ke checkpointu | `_policy_path_for()` | to, co dostane daemon |
| připravenost | `LeRobotBridge.policy_exists()` | kontrola, na které `start_inference()` odmítne start |

`policy_exists()` je nový **veřejný** tvar `_verify_policy_exists()` — UI se
musí ptát před během a musí dostat tutéž odpověď, jakou by dal most.
Bez otevřeného projektu vrací prázdný seznam, ne 404 (stejný důvod jako
u `/api/project` v běhu (9) — 404 dělá šum v konzoli).

**Hlavní změna — `page-modelrun` má tři sloupce místo jednoho sloupce karet**

Předtím: jedna karta, v ní všechno pod sebou, ~90 inline `style=""` atributů
a písma 8–9,5 px. Teď tři panely, každý odpovídá na jednu otázku:

- **Sloupec 1 „Plán a modely" (nový).** Čtyři počítadla (úkolů /
  orchestrovaných / checkpointů připraveno / architektura) a pod nimi strom
  úkolů: u každého štítek `ACT + ORCHESTRACE` (≥ 2 spustitelné kroky, tzn.
  daemon mezi nimi přepíná modely) vs `JEN ACT BASELINE`, a u každého kroku
  jméno, **jméno adresáře checkpointu** (celá cesta v `title`, aby
  nerozšiřovala sloupec) a `Připraven` / `Chybí`. Otázku „projde tenhle běh?"
  tedy stránka zodpoví **před** spuštěním. Volnou výšku pohlcuje ten seznam.
- **Sloupec 2 „Orchestrace (CEO → VLM)".** Instrukce pro plánovač, rozložený
  plán (roste s plánem), stavová řádka, Task Latch a VLM inspektor. **Snímek
  z VLM je druhý prvek, kterému velikost prospívá** — byl to náhled 84 px,
  ve kterém se verdikt zkontrolovat nedá; nově se škáluje výškou a drží 4:3,
  takže se z volného místa stane čitelný rámeček, ne roztažený ovládací prvek.
- **Sloupec 3 „Worker — inferenční daemon".** Ruční nasazení jednoho
  checkpointu (**popsané jako ACT baseline**, protože to tak je), stav
  daemona, fronta pod-úkolů k odeslání přes `SET_TASK` a telemetrie.
- Konfigurační pole jsou v `repeat(auto-fit, minmax(120px, 1fr))`, jen cesta
  ke checkpointu bere dva sloupce — recept z běhu (9). **Roztažená pole
  3 → 0**: `#orch-input` 1204 → 352 px, `#eval-policy-path` 646 → 306 px,
  `#eval-task-name` 646 → 149 px.

**Opravené chyby (nalezené při práci, ne plánované)**

1. **`task-latch-desc-text` byl mrtvý odkaz** (byl ve frontě). Čtyři místa do
   něj psala text, element v HTML **neexistoval** — banner tedy stav jen
   pojmenoval a nikdy nevysvětlil. Element doplněn.
2. **Task Latch měl dva pisatele, kteří si odporovali.**
   `orchestration_locked/unlocked` psaly anglicky, `updateInferenceDaemonStatus()`
   česky a jinými slovy — stejný stav vypadal různě podle toho, kdo tam byl
   naposled. Nově je jediný pisatel `setTaskLatch()` a řídí ho **jen**
   orchestrátor; daemon má vlastní štítek. Odpovídá to i zdrojáku: `TaskLatch`
   je objekt orchestrátoru, ne daemona.
3. **Natvrdo česky psané řetězce** (položka ve frontě): `renderInferenceSubtasks`
   („Spustit", „Tento úkol nemá žádné definované sub-skilly"),
   `triggerInferenceSubtask` („Běží…"), `sendInferenceStopSignal`, hláška
   TASK_DONE a dvě anglické `alert()` hlášky ve `startWorkflowInference`.
   Všechno přes `t()`. Přibylo 60 klíčů (cs i en).
4. **`alert.selectStepToTrain` v i18n vůbec nebyl** — uživateli se v dialogu
   ukázal holý klíč. Doplněno (mimo rozsah, ale je to jeden řádek).
5. **`alert.noFollowerPort` jsem omylem přidal podruhé** a `verify.sh` to
   chytil (kontrola duplicit z běhu (8) funguje). Smazána **pozdější**
   definice, aby se hodnota, která je dnes v provozu, nezměnila.
6. **Řádky pod-úkolů se malovaly inline styly z pěti míst** a re-render je
   zahodil. Nově je stav v `App` (`inferenceActiveSubSkill`,
   `inferenceDoneSubSkills`) a řádky se z něj překreslí — takže přepnutí
   jazyka nechá běžící i dokončený krok označený.
7. **Krok spuštěný orchestrátorem se ve frontě daemona neoznačil vůbec.**
   `orchestration_task_started` teď volá `setInferenceSubtaskRunning()` —
   sloupce 2 a 3 se nemůžou rozejít v tom, který pod-úkol běží.
8. **Dvě dlouhé akce neměly indikátor průběhu**: „Spustit plán" (round trip
   přes LLM) a „Nasadit Policy" (server otevírá sériový port a kamery).
   Obě po dobu requestu disabled s popiskem „Odesílám…" / „Nasazuji…".
   „Nasadit Policy" se **neobnovuje ručně**, ale přes `updateActionButtonStates()`
   — úspěšný start přijde jako `process_started` a tlačítko musí zůstat vypnuté.
9. **Vzor „statický `data-i18n` + dynamický text"** (past zapsaná ve frontě):
   všechny čtyři elementy, které se na téhle stránce přepisují za běhu (stav
   orchestrace, titulek a popis latche, štítek daemona, verdikt VLM), si při
   zápisu **přenastaví i klíč**. Stavová řádka nesoucí jméno kroku klíč naopak
   **odebere** a překreslí se z `orchStatusKey` — jinak by ji `applyI18n()`
   přepsalo na překlad bez toho jména.
10. **Mrtvé CSS**: `.modelrun-unified-grid` (2 pravidla) už nikde nebylo
    použité — smazáno.

**Ověřeno v cloudu**

- `bash scripts/verify.sh` prochází celé: tsc, **161 pytestů** (bylo 151),
  compileall, i18n parita cs=en=927 bez duplicit, žádná duplicitní id,
  9 panelů pod `#workspace-main`, flat design tokens, 105 `App.*` odkazů.
- **Nové testy — `tests/test_orchestration_preview.py` (10 testů)**: pod-kroky
  se nevypisují jako samostatné úkoly; rodič se expanduje na seřazené kroky;
  pořadí se bere z `project.json`, ne abecedně; verdikt `orchestrated` = ≥ 2
  kroky; **cesta se rovná `_policy_path_for()`** (tj. testem svázaná s tím, co
  dostane daemon); připravenost pochází z mostu; fallback architektury;
  prázdný projekt; žádný otevřený projekt; úkol bez jména.
- **Endpoint proti běžícímu backendu**: úkol se dvěma pod-kroky →
  `orchestrated: true` a dvě cesty `…/probe_task_probe_step_{approach,grasp}_diffusion`;
  úkol bez pod-kroků → `orchestrated: false` a jediný krok = on sám.
- **Průchod stavy proti běžícímu backendu** (7 stavů): klid (daemon `Neběží`,
  panel skrytý, hint vidět) → nasazení (panel `flex`, hint pryč, dva
  dispatchovatelné kroky) → odeslání pod-úkolu (řádek `is-running`, tlačítko
  „Běží…" disabled) → `TASK_DONE` (řádek `is-done`, daemon zpět na `Čeká`) →
  plán běží + `orchestration_locked` (latch červený, text „Motor provádí
  krok…") → `unlocked` + `task_completed` (latch zelený, VLM badge `is-ok`) →
  přepnutí jazyka. **Nahrávací ani inferenční proces v tomhle ověření
  neběžel** — testován je stavový automat UI, ne LeRobot.
- **Anglický režim** (přes `setLang('en')`): v celém `page-modelrun`
  **nezůstal jediný řádek s českou diakritikou**, včetně stavové řádky
  nesoucí jméno kroku (ta byla jediný nález prvního kola a je opravená).
- **Obsazenost plochy proti běžícímu backendu**, stejný fixture:
  `modelrun` **20 / 23 / 25 % → 24 / 33 / 37 %** (1600×900 / 1280×800 /
  1024×760), **roztažená pole 3 → 0**, žádný vodorovný přetok, nic ořezaného.
  `datasety` beze změny (33 / 39 / 39 %) — žádná regrese.
- **Hit-test** tlačítek v patičkách na **860×700** (pod globálním zlomem
  920 px): všechna tři dosažitelná, sloupce se skládají pod sebe, `ovfX = 0`.
- **Konzole prohlížeče**: jediná chyba je import fontů z Googlu (kontejner bez
  internetu, viz fronta). V logu serveru žádná 404 ani traceback.

**Zbývá vyzkoušet na fyzickém robotu** (v cloudu nelze)

- Že checkpoint označený `Připraven` daemon opravdu přijme — ověřená je shoda
  s `policy_exists()`, ne že `lerobot` ten adresář načte.
- Že `Chybí` opravdu znamená zastavení běhu: `start_inference()` to odmítne
  a `_execute_motor_task()` na to reaguje, ale proti běžícímu procesu to
  ověřené není.
- Že hot-swap policy mezi kroky (`swap_policy` / `SET_POLICY`) proběhne a že
  se fronta pod-úkolů posouvá podle skutečných `TASK_DONE` z daemona.
  Simulované byly jen události.
- Že „Nasadit Policy" ukazuje „Nasazuji…" po celou dobu round tripu — v
  kontejneru není sériový port, takže odpověď přijde řádově dřív.
- Že „Spustit plán" s reálným LM Studiem opravdu vrátí plán (v kontejneru
  není LLM — v konzoli je vidět `LLM CEO server connection failed`).
- Vzhled mimo Chromium (třísloupcová mřížka, `aspect-ratio` na VLM rámečku,
  `overflow-wrap: anywhere` na popiscích) na macOS/WebKitu a ve Firefoxu.

## 2026-08-02 (9) — Sběr dat: značkování pod-úkolů je vidět **před** nahráváním
+ měřicí fixture konečně měřil to, co appka opravdu ukazuje

**Výchozí stav.** `bash scripts/verify.sh` na čerstvém klonu spadl na dvou
testech (`websockets` chyběl), `setup-dev.sh` to doinstaloval a gate prošel
celý (150 pytestů). Priorita A prázdná.

**Nejdřív oprava měření — jinak by tenhle běh řešil neexistující problém**

Fronta říkala, že `datasety` je druhá nejprázdnější stránka (7–11 %). Není to
pravda: `scripts/measure_layout.mjs` zakládal fixture projekt **bez jediné
dovednosti**, takže se na půlce stránek měřil prázdný stav. Se skutečným
fixture (jeden úkol se dvěma seřazenými pod-kroky, tedy **rozdělitelný**)
měla stránka i před touhle změnou 32 / 34 / 37 %. Fixture to teď zakládá sám
(`ensureSkills()`) — všechna čísla ve frontě níže z předchozích běhů jsou tím
pádem podezřelá a je nutné je přeměřit, ne jim věřit.

Skutečný defekt na téhle stránce byl jiný a fronta ho měla taky: **pole
roztažená přes celou šířku okna** (`#rec-dataset-storage-dir` a
`#rec-extra-args` po 990 px) a hlavně to, že **značkování pod-úkolů — věc,
kvůli které celý projekt existuje — bylo vidět až během nahrávání.**

**Hlavní změna — karta „Sběr dat" má tři sloupce**

- **Sloupec 3 je nový: „Značkování pod-úkolů"** a je vidět **pořád**, ne až za
  běhu. Nahoře **verdikt** (`ACT + orchestrace` vs `jen ACT baseline`, stejné
  pravidlo ≥ 2 pod-kroky jako používá splitter) s větou, co to pro tuhle
  dovednost znamená; pod ním **seřazený seznam pod-kroků**, ovládání značek,
  počítadlo značek a nakonec **seznam nahraných epizod** (přesunut ze
  sloupce 2, je to jediný prvek, který má smysl zvětšovat, takže volnou výšku
  pohlcuje on). Otázku „půjde tenhle dataset použít pro orchestraci?" tedy
  appka zodpoví **před** natočením epizody, ne až po něm.
  Verdikt rozlišuje tři případy, protože počet pod-kroků sám o sobě nestačí:
  pod-krok vybraný samostatně je legitimní ACT baseline, kdežto úkol nejvyšší
  úrovně bez pod-kroků **nejde nahrát vůbec** — a to musí říct, ne mlčet.
- **Sloupec 2 „Nahrávání (lerobot-record)"**: konfigurace je dvousloupcová
  mřížka (`.rec-config-grid`, `auto-fit minmax(215px, 1fr)`), jen dvě pole
  s dlouhou hodnotou (cesta, CLI argumenty) berou dva sloupce. Sloupce 2 a 3
  si dělí zbývající šířku rovným dílem — nechat sloupec 2 pohltit všechno
  dávalo formulář ~980 px široký, což je přesně příčina těch roztažených polí.
- **Řádek statistik dostal `Velikost` a `Policy`** — `selectSkill()` do
  `active-skill-size` a `active-skill-training` zapisoval celou dobu, ale
  **ani jeden element v HTML neexistoval** (byly ve frontě mrtvých odkazů).
- **Klávesová nápověda je tabulka, ne věta.** Pět řádků: klávesy → co udělá →
  příznak LeRobotu (`mark`, `unmark`, `exit_early`, `rerecord_episode`,
  `stop_recording`). Každý řádek odpovídá vazbě, kterou prohlížeč opravdu
  registruje v `keydown` handleru, a příznaku, který z ní vznikne
  v `_OrchidayFileListener.poll_once()`.

**Opravené chyby (nalezené při práci, ne plánované)**

1. **`startWorkflowRecord()` přepisoval nápovědu ke klávesám natvrdo česky**
   a jen třemi klávesami — **obě klávesy pro značkování** (mezerník / M,
   Backspace / U), tedy to hlavní, co appka umí navíc proti LeRobotu, tam
   chyběly. Navíc to byl přesně vzor zapsaný ve frontě: element se statickým
   `data-i18n`, do kterého se píše dynamický text → každé přepnutí jazyka ho
   přepsalo zpátky. Celý element je pryč, nahradila ho ta tabulka.
2. **Stav „nahrává se" se odvozoval z inline stylů.** Klávesy i `Escape`
   pro zavření modálu se rozhodovaly podle
   `liveControls.style.display === 'flex'` a značkovací klávesy podle
   `taggingWizard.style.display === 'flex'`. Jakmile je značkovací panel vidět
   pořád, druhá podmínka by platila **vždy**. Nově je stav explicitní
   (`App.recordingActive`) a jediný přepínač `setRecordingUiActive()` řídí
   živé ovládání, klávesy i tlačítko „Zastavit nahrávání" — nemůžou se
   rozejít. Ověřeno: mezerník mimo nahrávání značku nevytvoří.
3. **`onRecordingPhase()` nepřekresloval seznam kroků**, takže po startu
   epizody zůstaly všechny kroky ve stavu „Čeká" (fáze se mění *po*
   vykreslení). Fáze přitom rozhoduje, jestli je seznam plán, nebo ukazatel
   průběhu.
4. **Po dokončení nahrávání zůstalo počítadlo značek na poslední hodnotě.**
   `finishTaggingPostProcess()` vynulovalo pole, ne text v DOM.
5. **`GET /api/project` vracel 404, když není otevřený projekt.** To je
   normální stav hned po startu, ne chyba — a prohlížeč to logoval jako
   chybu konzole při **každém** načtení. Přesně ten šum, pod kterým se
   v běhu (6) a (7) schoval chybějící `</div>` a mrtvý `/ws`. Nově 200
   s `project: null`; všichni tři volající už `if (cur.project)` testovali.
   Nový test v `tests/test_runtime_dependencies.py`.
6. **Chybějící favicon** — druhá 404 v konzoli na každém načtení. Přidán
   `web/favicon.svg` (plochý, ostré rohy, bez gradientu) a `<link rel="icon">`.
   Po obou opravách je v konzoli **jediná** chyba: import fontů z Googlu
   (kontejner bez internetu, viz fronta).
7. **Natvrdo česky psané řetězce** ze seznamu ve frontě: seznam epizod
   („Epizoda", „Přehrát", „Smazat", prázdný stav), popisky v
   `sendRecordingAction()` a `alert('Chyba: …')`. Tlačítka epizod mají navíc
   `title` s tím, co opravdu udělají (`lerobot-replay` na reálném rameni;
   mazání přepisuje uložená Parquet data).
8. **Přepnutí jazyka nepřekreslovalo značkovací sloupec ani seznam epizod** —
   `rerenderDynamic()` o nich nevěděl. Stejná třída chyby jako u Projektů
   v běhu (8).
9. **Tlačítko „Označit konec fáze" lhalo popiskem u dovednosti bez hranic**:
   `0 >= max(0, -1)` vyšlo jako „Všechny fáze označeny". Nově tři různé
   důvody nedostupnosti a `renderStepPlan()` je přepočítá i při pouhé změně
   vybrané dovednosti.
10. **„Spustit nahrávání" nemělo indikátor průběhu** — server při startu
    spouští LeRobot proces a otevírá sériový port. Tlačítko je po dobu
    requestu disabled s popiskem „Spouštím…".

**Ověřeno v cloudu**

- `bash scripts/verify.sh` prochází celé: tsc, **151 pytestů** (bylo 150),
  compileall, i18n parita cs=en=870 bez duplicit, žádná duplicitní id,
  9 panelů pod `#workspace-main`, flat design tokens, 104 `App.*` odkazů.
- **Obsazenost plochy proti běžícímu backendu**, stejný fixture pro obě
  měření (výchozí stav přeměřen přes `git stash push -- web/`, aby srovnání
  nelhalo): `datasety` **32 / 34 / 37 % → 33 / 40 / 40 %**
  (1600×900 / 1280×800 / 1024×760). Hlavní výsledek ale není obsazenost —
  je to **2 roztažená pole (990 px) → 0** na všech třech velikostech.
  Ostatních sedm stránek má čísla na jednotku stejná jako před změnou.
- **Průchod stavy proti běžícímu backendu** (9 stavů): úkol se dvěma
  pod-kroky → verdikt `ACT + orchestrace`, dva řádky „Čeká", značkování
  disabled; úkol bez pod-kroků → `jen ACT baseline` + „nelze nahrávat";
  start nahrávání → fáze „Nahrává se", první krok AKTIVNÍ, živé ovládání
  `flex`, „Zastavit nahrávání" enabled; značka na 4,25 s → první krok
  „Hotovo" s časem, druhý AKTIVNÍ, počítadlo 1, „Zpět" enabled, „Označit"
  přepne na „Všechny fáze označeny"; fáze `reset` → značky zůstanou, štítek
  se změní; konec → vše zpět do klidu, počítadlo 0, epizoda „–".
  **Nahrávací proces sám v tomhle ověření neběžel** — testován je stavový
  automat UI, ne LeRobot.
- **Klávesové hradlování**: mezerník mimo nahrávání nevytvoří značku
  (0 → 0). Předtím by ho nový, trvale viditelný panel propustil.
- **Anglický režim** (přes `setLang('en')`, ne jen `applyI18n()`): v celém
  `page-datasety` **nezůstal jediný řádek s českou diakritikou**.
- **Hit-test** všech pěti tlačítek v patičkách karty „Sběr dat" na
  1600×900, 1024×760 i **860×700** (pod globálním zlomem 920 px): všechna
  dosažitelná, nic je nepřekrývá. Na 860×700 se sloupce skládají pod sebe,
  splittery mizí, žádný vodorovný přetok — a totéž na kartě Správa datasetů.
- **Konzole prohlížeče**: po opravě `/api/project` a favicony **žádná 404**
  v logu serveru (bylo 1 na každé načtení).

**Zbývá vyzkoušet na fyzickém robotu** (v cloudu nelze)

- Že klávesy z tabulky opravdu dorazí do běžícího `lerobot-record` a nastaví
  tam ty příznaky, které tabulka slibuje. Ověřená je vazba v prohlížeči
  a mapování ve wrapperu ve zdrojáku, ne celý řetěz proti procesu.
- Že „Spustit nahrávání" ukazuje „Spouštím…" po celou dobu round tripu —
  v kontejneru není sériový port, takže odpověď přijde řádově dřív než na
  hardwaru.
- Že se seznam kroků během reálné epizody posouvá podle událostí
  `step_marked` a že časy značek v něm odpovídají tomu, na čem pak řeže
  `POST /api/datasets/split_steps`. Simulované byly jen události.
- Že verdikt `ACT + orchestrace` znamená, že rozřezání opravdu projde —
  struktura se čte ze `skill.json`, shoda s nahranými značkami ověřená není.
- Vzhled mimo Chromium (tabulka kláves, `<kbd>`, třísloupcová mřížka) na
  macOS/WebKitu a ve Firefoxu.

## 2026-08-02 (8) — Projekty: z 8 % nejprázdnější stránky aplikace pracovní
plocha master/detail + **měřicí skript konečně v repu**

**Výchozí stav.** `bash scripts/verify.sh` na čerstvém klonu spadl na dvou
testech (`websockets` nešel naimportovat) — ale nebyla to chyba kódu, jen
nepřipravený kontejner: `bash scripts/setup-dev.sh` závislost doinstaloval
a gate prošel celý (141 pytestů). Priorita A tedy prázdná. Podle měření
z běhu (7) byla nejhorší stránka `projects` (5–8 % obsazenosti) a zároveň je
to úvodní obrazovka aplikace.

**Nejdřív měřicí skript — protože běh (5)–(7) ho psal počtvrté**

- **`scripts/measure_layout.mjs` + `scripts/measure-layout.sh`** (nové).
  Wrapper nastartuje uvicorn, počká na `/api/info`, spustí měření a server
  zase složí; skript sám si přes API **založí a otevře fixture projekt**,
  jinak je většina stránek prázdná a čísla lžou. Měří obsazenost plochy,
  vodorovný přetok, ořezané prvky, roztažené ovládací prvky a chyby v konzoli
  na 8 stránkách × 3 velikostech.
  Všechny pasti z deníku jsou v něm už ošetřené a okomentované: cesta
  k předinstalovanému Chromiu (hledá se `chromium-*`, ne natvrdo verze),
  `ignoreDefaultArgs: ['--hide-scrollbars']`, skrytí `#setup-wizard-overlay`,
  a **zabíjení serveru podle PID, ne `pkill -f`** (ten vzorec sedí i na vlastní
  shell a shodí ho).
  **Nová past, na kterou narazil tenhle běh:** `waitUntil: 'networkidle'`
  vyprší — aplikace drží živý WebSocket na `/ws` a dokola zkouší import fontů
  z Googlu, takže síť nikdy neztichne. Nutno `domcontentloaded`
  + `waitForFunction(() => !!window.App)`.

**Hlavní změna — stránka Projekty je master/detail**

Předtím: jeden panel, mřížka velkých karet a pod ní prázdno. Karta nesla
jméno, slug, typ ramene a štítky dovedností — nic z toho neodpovídalo na
otázku, kvůli které se projekt otevírá.

- **Levý panel = seznam.** Místo karet 320×200 px jsou to řádky (57 px)
  s názvem, slugem, typem ramene, počtem úkolů, počtem pod-kroků a datem
  vzniku. Kliknutí **vybírá**, neotevírá; otevírá se tlačítkem v pravém
  panelu, dvojklikem nebo Enterem na zaměřeném řádku. „Vybraný" (modrý rám)
  a „otevřený" (zelená levá hrana + štítek OTEVŘENÝ) jsou dva různé stavy,
  což u karet nešlo rozlišit.
- **Pravý panel = detail.** Vše, co jde o projektu zjistit, **aniž by se
  otevřel**: cesta na disku, čtyři počítadla (ramena / kamery / úkoly /
  rozdělitelné), identifikace, **popis scény** (povinné pole, které dostává
  CEO plánovač i VLM inspektor — do teď nebylo vidět nikde než v Nastavení),
  tabulka ramen (typ / id / port), tabulka kamer (id / role / rozlišení @ fps)
  a **strom úkolů a pod-kroků**.
- **Strom úkolů je jádro téhle změny.** U každého úkolu se ukazují jeho
  seřazené pod-kroky a štítek `ACT + ORCHESTRACE` (≥ 2 pod-kroky, dataset
  jde rozřezat na pod-datasety) vs `JEN ACT BASELINE`. Přesně ta otázka,
  kvůli které projekt existuje, je teď vidět na úvodní obrazovce u každého
  projektu — dřív se nedala zodpovědět jinak než otevřít projekt a proklikat
  Datasety.
- Tlačítka jsou v patičkách panelů, kterých se týkají (`.block-actions`):
  vlevo Importovat balíček / Průvodce / + Nový projekt, vpravo Smazat /
  Exportovat / Otevřít. **Otevřít je disabled, když je projekt už otevřený;
  Exportovat je disabled, když otevřený není** (export běží serverside nad
  otevřeným projektem) a hint v patičce to říká slovy místo aby tlačítko jen
  nešlo zmáčknout.
- Otevírání ukazuje průběh: řádek zešedne a pulzuje, tlačítko přepne na
  „Otevírám…" po celou dobu round tripu (server při otevření dělá
  autodetekci hardwaru a nasazuje kalibrace do cache LeRobotu).
- Umístění projektů na disku je v patičce seznamu — odvozeno z cest, které
  už v listingu jsou, žádný nový endpoint. Do teď to appka neřekla vůbec.

**Backend — `list_projects()` vrací strukturu, kterou už stejně četl**

`skill.json` každé dovednosti se otvíral jen kvůli `name`. Nově z něj vzniká
`skills_summary` (`slug`, `name`, `parent_slug`) — **žádné další I/O**.
Pořadí se bere z `project.json["skills"]`, protože **to** je pořadí, podle
kterého řeže splitter, ne abecední pořadí adresářů. Adresář dovednosti, který
v `project.json` chybí, se do výpisu přidá na konec místo aby zmizel —
jsou v něm nahrané epizody.

**Opravené chyby (nalezené při práci, ne plánované)**

1. **Přepnutí jazyka nepřekládalo stránku Projekty.** `renderProjectList()`
   zapéká `t()` do HTML, ale `rerenderDynamic()` ji nevolal — a její ostatní
   větve běží jen `if (this.project)`, takže úvodní stránka bez otevřeného
   projektu se nepřekreslila nikdy. Naměřeno: po přepnutí do angličtiny
   zůstalo 7 českých řádků („2 projektů", „OTEVŘENÝ", „4 pod-kroků",
   „NEKONFIGUROVÁN"…). Nově se překresluje z nacachovaného listingu.
2. **Čtyři i18n klíče existovaly v `i18n.js` dvakrát** — `lbl.id`, `lbl.slug`,
   `lbl.policyArch`, `lbl.device` (a `btn.calibrateLeader`/`Follower` už
   předtím). V objektovém literálu to **není chyba JS**, poslední definice
   tiše vyhraje — takže `Object.keys()` to nikdy neukáže a klíč přidaný na
   jednom místě mlčky změní popisek na druhém konci souboru. Zjištěno tím, že
   nový `lbl.id: "ID"` se v UI vykreslil jako „Identifikátor (ID)".
   → duplicity odstraněny (u těch starších se maže **dřívější** definice, aby
   se hodnota, která je dnes v provozu, nezměnila) a **`verify.sh` je nově
   hlídá** nad zdrojovým textem. Ověřeno, že to chytá: po vložení druhého
   `btn.newProject` krok spadne s `duplicate keys: [ 'cs:btn.newProject' ]`.
3. **Sekce úkolů se smrskla na 0 px.** `.pd-sect-grow { flex: 1 1 auto }`
   uvnitř scrollujícího flex sloupce — přesně past zapsaná v běhu (6):
   položka se zmenší pod svůj obsah, přebytek uteče přes `overflow: visible`
   a box hlásí výšku menší, než co kreslí. Naměřeno `pd-sect-grow: 0` se
   dvěma vykreslenými úkoly uvnitř. Opraveno `.project-detail > * { flex: 0 0 auto }`.
4. **Vlastní `@media (max-width: 900px)` byl mrtvý kód.** Aplikace už má
   globální pravidlo na 920 px, které každou `.setup-section` skládá do
   jednoho sloupce přes `grid-template-columns: 1fr !important`. Naměřeno:
   `grid-template-rows: none`, blokům se aplikovaly flex vlastnosti — moje
   pravidlo nedělalo nic. Smazáno, na jeho místě komentář proč.

**Ověřeno v cloudu**

- `bash scripts/verify.sh` prochází celé: tsc, **150 pytestů** (bylo 141),
  compileall, i18n parita cs=en=835 **+ nová kontrola duplicitních klíčů**,
  žádná duplicitní id, 9 panelů pod `#workspace-main`, flat design tokens,
  104 `App.*` odkazů.
- **Nové testy — `tests/test_project_listing.py` (9 testů)**: pořadí kroků
  z `project.json` (ne abecední), dovednost chybějící v `project.json`,
  rozlišení úkol/pod-krok přes `parent_slug`, `parent_slug: ""` → `None`,
  rozbitý `skill.json` degraduje na slug místo aby shodil projekt, rozbitý
  `project.json` vyhodí jen ten jeden projekt, zpětná kompatibilita
  `skills_names`.
- **Obsazenost plochy proti běžícímu backendu** (uvicorn + projekt se dvěma
  rameny, dvěma kamerami, jedním rozdělitelným a jedním nerozdělitelným
  úkolem), stejný fixture pro obě měření — **výchozí stav změřen znovu přes
  `git stash`**, aby srovnání nelhalo:
  `projects` **8 / 10 / 15 % → 31 / 38 / 45 %** (1600×900 / 1280×800 /
  1024×760). **Všech sedm ostatních stránek má čísla na jednotku stejná jako
  před změnou** — žádná regrese. Žádný vodorovný přetok, žádný ořezaný prvek,
  nejširší ovládací prvek 165 px.
- **Průchod stavy proti běžícímu backendu**: kliknutí vybírá a *neotevírá*;
  „Otevřít projekt" otevře (řádek dostane štítek, titulková lišta se změní,
  Otevřít se disabluje, Exportovat enabluje); výběr jiného řádku nechá
  „otevřený" na tom původním; dvojklik i Enter otevírají; stav přežije odchod
  na jinou stránku a návrat. V konzoli nezůstala jediná chyba kromě
  `ERR_CONNECTION_RESET` z importu fontů (kontejner bez internetu, viz fronta).
- **Anglický režim**: v celém `page-projects` **nezůstal jediný řádek s českou
  diakritikou** (před opravou 7).
- **Prázdný projekt** (žádný hardware, žádný úkol): počítadlo „Ramena 0" se
  označí žlutě, obě tabulky hlásí „Žádné rameno/kamera není nakonfigurován…",
  strom úkolů „Projekt zatím nemá žádný úkol." — žádná prázdná tabulka.
- **Chování při 860×700** (pod globálním zlomem 920 px): stránka scrolluje
  (`overflow-y: auto`) a **poslední patička je dosažitelná** —
  změřeno i na ostatních stránkách, kde je to úplně stejné (datasety má
  2 patičky mimo první pohled, učení a setup po jedné). Není to tedy nic,
  co by zaváděla tahle změna.

**Zbývá vyzkoušet na fyzickém robotu / reálném desktopu** (v cloudu nelze)

- Že „Otevřít projekt" na reálném stroji opravdu proběhne včetně autodetekce
  portů a nasazení kalibrací do cache LeRobotu, a že indikace „Otevírám…"
  trvá po celou tu dobu. V kontejneru nejsou sériové porty, takže round trip
  je řádově rychlejší než na hardwaru.
- Že počty pod-kroků v seznamu sedí s tím, co se opravdu naznačkuje během
  `lerobot-record`, a že úkol označený `ACT + ORCHESTRACE` skutečně projde
  `POST /api/datasets/split_steps`. Struktura se čte ze `skill.json`, shoda
  s nahranými značkami ověřená není.
- Vzhled mimo Chromium (dvousloupcové `.pd-cols` nad 1200 px, tabulky detailu)
  na macOS/WebKitu a ve Firefoxu.

## 2026-08-02 (7) — Plochý technický vzhled napříč celou aplikací + **`/ws` na
čerstvém klonu vůbec nefungoval**

**Priorita A, nalezená během měření.** `scripts/verify.sh` na výchozím stavu
prošel celý (136 pytestů), ale při auditu v headless Chromiu byla v konzoli
prohlížeče tahle chyba na **každé** stránce:

```
WebSocket connection to 'ws://127.0.0.1:8100/ws' failed:
  Error during WebSocket handshake: Unexpected response code: 404
```

a v logu serveru:

```
WARNING:  No supported WebSocket library detected. Please use
          "pip install 'uvicorn[standard]'", or install 'websockets' or 'wsproto' manually.
```

**Byly to dvě nezávislé příčiny, obě fatální pro živý provoz:**

1. **Chybějící závislost.** `pyproject.toml` deklaroval holý `uvicorn>=0.27`.
   Uvicorn *nemá* vlastní implementaci WebSocketu (`Requires: click, h11`),
   takže po `pip install .` na čistém stroji server odpovídá na upgrade `/ws`
   čtyřistačtyřkou. Stránka se přitom normálně načte a všechna REST volání
   fungují — takže to nevypadá rozbitě. Nefunguje ale **všechno živé**:
   konzolový dok zůstane prázdný, `process_started`/`process_finished` nikdy
   nepřijde (tlačítka se nepřepnou do běžícího stavu), a nedorazí ani jediná
   událost nahrávání, kalibrace nebo značky pod-úkolů. Frontend se navíc
   znovu připojuje každé 3 s, takže log serveru zaplaví to varování donekonečna.
   → přidáno `websockets>=12.0` (jeden čistě pythonový balíček dostupný na
   Linuxu, Windows i macOS — na rozdíl od extra `uvicorn[standard]`, které
   táhne uvloop/httptools/watchfiles).
2. **Most událostí se nedrátoval mimo `main()`.** `web_bridge.connect_event_bus()`
   se volalo **jen** v `server.main()`. Jakýkoli jiný vstupní bod, který
   startuje ASGI app přímo (`uvicorn orchiday.server:app`, balíčkovaný runner),
   nabootoval se socketem, který **klienty přijme a odpoví na ping, ale nikdy
   nic nepošle**. Ověřeno: `{"action":"ping"}` → `{"event":"pong"}` prošlo,
   ale `POST /api/emergency-stop` (emituje `log_message`) nedoručil nic.
   → volání přesunuto do `_lifespan`, hned vedle `web_bridge.set_loop(loop)`.
   Lifespan běží právě jednou za proces, takže se signály nepřipojí dvakrát
   (dvakrát = každý řádek logu a každá událost průběhu duplicitně).

**Hlavní změna běhu — jednotný plochý technický vzhled**

Pravidla zadání („ostré rohy, ohraničení, tlumené výplně; žádný blur, glow,
stíny") se v CSS dlouhodobě nedodržovala; dekorace se vracela s každým ručně
stylovaným panelem. Naměřený stav před změnou: **98 deklarací `border-radius`**
v `styles.css` + 30 v inline stylech `index.html` + 17 v HTML generovaném
z `app.ts`, k tomu `--overlay-blur: blur(8px)` a `backdrop-filter: blur(4px)`,
tři glow/drop stíny (E-STOP, modál, wizard), `text-shadow` glow na aktivní
položce nav lišty a 6 gradientů.

- **Všech 145 `border-radius` odstraněno** (i proměnné `--radius` /
  `--radius-lg`), včetně `50%` — kolečka jsou teď čtverce, což je pro
  technický nástroj konzistentnější než míchání obojího. Místo nich je
  **jediné pravidlo `*, *::before, *::after { border-radius: 0 }`** v základní
  sekci. Není to jen úklid: prohlížeče zaoblují formulářové prvky samy
  (WebKit na macOS ano, Chromium a Firefox ne) a doteď to přebíjelo právě to
  explicitní `border-radius: var(--radius)` na inputech. Bez náhrady by
  aplikace vypadala na každé platformě jinak.
- **Veškerý blur pryč** — `backdrop-filter` i proměnná. Zatemněné pozadí
  modálu zůstává (`--overlay-bg`), rozmazání ne.
- **Všechny stíny a glow pryč**, včetně 30 mrtvých `box-shadow: none`
  a keyframe `checkPulse`, který animoval `none` → `none`.
- **Modál a wizard mají místo stínu 2px `--border-light`.** Bez stínu byl
  okraj jediné, co je odděluje od ztmavené stránky pod nimi — 1px na to
  nestačilo.
- 6 gradientů nahrazeno plochými výplněmi; `translateY(-1px)` a `scale(1.05)`
  na E-STOPu (efekty, které patřily ke stínům) odstraněny.
- `.estop-btn-circle` → `.estop-btn` — element už kolečko není.
- Bump assetů na `?v=3.60.0`.

**Nový krok ve `verify.sh`: „flat design tokens"**

Kontroluje `styles.css`, `index.html` **i `app.ts`** (odtud většina dekorace
pocházela — inline `style=""`) na `border-radius` != 0, `backdrop-filter`,
`filter: blur()`, `box-shadow` a `text-shadow` != `none`. Vypisuje soubor,
řádek a nalezenou deklaraci. Ověřeno, že to chytá: po dočasném vložení
`.test-regression { border-radius: 8px; backdrop-filter: blur(3px); filter: blur(2px); }`
krok spadne se všemi třemi nálezy a `verify.sh` skončí chybou.

**Nové testy — `tests/test_runtime_dependencies.py` (5 testů)**

Žádná stávající kontrola server nespouštěla, takže obě chyby výše byly pro
`verify.sh` neviditelné. Testy hlídají invarianty, ne symptomy:
implementace WebSocketu je **deklarovaná** v `pyproject.toml` (to je ta, na
které záleží čerstvému klonu) i **importovatelná**; každá deklarovaná závislost
jde naimportovat; `_lifespan` zavolá `connect_event_bus()` **právě jednou**
(měřeno přes `TestClient`); a `/ws` v `server.py` odpovídá cestě, na kterou se
`app.ts` připojuje.

**Ověřeno v cloudu**

- `bash scripts/verify.sh` prochází celé: tsc, **141 pytestů** (bylo 136),
  compileall, i18n parita cs=en=795, žádná duplicitní id, 9 panelů pod
  `#workspace-main`, **flat design tokens**, 102 `App.*` odkazů.
- `bash scripts/setup-dev.sh` doběhne a nová řádka hlásí `websockets OK`.
- **WebSocket proti běžícímu backendu**: handshake projde, `ping` → `pong`,
  a `POST /api/emergency-stop` doručí do socketu
  `log_message {"level":"WARN","message":"EMERGENCY STOP — All processes killed"}`.
  Před opravou: 404 na handshake; po opravě jen závislosti (bez opravy
  lifespanu) handshake prošel, ale server nikdy nic nepushnul.
  V prohlížeči je na screenshotech vidět „✓ Connected to Orchiday server"
  v konzolovém doku — před opravou tam nebylo nic.
- **Audit vypočtených stylů** (ne zdrojáku) v headless Chromiu proti běžícímu
  backendu s otevřeným projektem, **8 stránek × 3 velikosti (1600×900,
  1280×800, 1024×760) + modál + celoobrazovkový wizard**: prošel každý
  viditelný element a četl `borderRadius`, `boxShadow`, `textShadow`,
  `backdropFilter`, `filter` a `backgroundImage`. **0 nálezů.** Modál i wizard:
  `radius: 0px`, `shadow: none`, `backdrop: none`, `border: 2px`.
- Žádný vodorovný přetok na žádné stránce v žádné velikosti; žádné roztažené
  tlačítko (nejširší 225 px); v konzoli prohlížeče nezůstala **jediná
  WebSocket chyba** (zbývají jen `ERR_CONNECTION_RESET` z importu fontů
  z `fonts.googleapis.com` — kontejner je bez internetu, viz fronta).

**Zbývá vyzkoušet na fyzickém robotu / reálném desktopu** (v cloudu nelze)

- Že se přes opravený socket opravdu propisuje **výstup LeRobotu** do
  konzolového doku a že dorazí události nahrávání (`recording_episode`,
  `step_marked`) a kalibrace (`calibration_progress`). Ověřený je jen
  transport a jedna serverem pushnutá událost, ne reálný proces.
- Že tlačítka přepínaná přes `process_started` / `process_finished` se
  s běžícím podprocesem chovají správně — do teď ta událost nikdy nedorazila,
  takže tenhle kód reálně **nikdy neběžel**.
- Vzhled mimo Chromium: globální `* { border-radius: 0 }` má systémové
  zaoblení formulářových prvků přebít, ale ověřené je to jen v Chromiu na
  Linuxu. Na macOS (WebKit) a ve Firefoxu se to musí prohlédnout očima.

## 2026-08-01 (6) — Chybějící `</div>`: Nápověda byla nedostupná a konzole
neviditelná na všech stránkách kromě Nastavení

**Priorita A.** `scripts/verify.sh` na výchozím stavu prošel celý (136 pytestů),
takže podle deníku byla fronta na frontendu. Při měření stránky Nastavení ale
vyšlo něco jiného: `#page-settings` má v DOM **šest** dětí, mezi nimi
`div.editor-area` a `section.bottom-dock-container`. Ty tam nepatří.

**Co bylo rozbité**

`web/index.html` postrádal jeden `</div>` — uzávěr `#page-settings`. HTML parser
neuzavřenou značku nehlásí, jen do ní **zanoří všechno, co následuje**. Konkrétně:

| element | kde měl být | kde skutečně byl |
|---|---|---|
| `#page-help` | dítě `#workspace-main` | uvnitř `#page-settings` |
| `#bottom-dock-container` | dítě `#workspace-main` | uvnitř `#page-settings` |

Důsledky, obojí ověřené v headless Chromiu:

1. **Stránka Nápověda se nedala otevřít.** `.editor-area` má `display: none`
   a zobrazuje se přes `.active-page`. `#page-help` tuhle třídu od kliknutí na
   „Nápověda" v levém pruhu dostal, ale zdědil `display: none` po
   `#page-settings` → naměřeno **0 × 0 px**. Osm bloků nápovědy o orchestračním
   schématu bylo od té doby nedostupných.
2. **Konzolový dok byl 0 × 0 na všech stránkách kromě Nastavení.** Naměřeno:
   `page-projects / teleoperation / datasety` → `dockH: 0`, `page-settings` →
   `dockH: 234`. Terminál je přitom jediné místo, kde je vidět výstup LeRobotu —
   a `lerobot-find-port` po uživateli chce **odpovídat v tom terminálu**
   („Odpovídejte v terminálu dole" je doslova v popisku toho nástroje).
   Během teleop, kalibrace, sběru dat i tréninku nebylo vidět nic.
3. Na Nastavení dok naopak ujídal 234 px z pracovní plochy panelu, což je
   skutečná příčina toho, proč diagnostika ořezávala řádky (položka ve frontě
   z běhu (5) — příčinou nebyl jen flex-shrink).

**Kdy to přistálo.** Kontrolou párování značek napříč posledními 15 commity
v `web/index.html`: první rozbitý je **f494000** („frontend: fold the CLI-tools
page into Settings as a wizard tab"). Rozbité tedy bylo posledních **7 commitů**.
Běh (2) tuhle kontrolu dělal ručně a tehdy vyšla čistá — proto teď není ruční.

**Co se změnilo**

- `web/index.html` — doplněn chybějící `</div>` a **všechny uzávěry v okolí jsou
  okomentované**, ke kterému elementu patří. (Pozor: komentář nesmí obsahovat
  doslovný `</div>` — kontrola níže komentáře odstraňuje, ale je to matoucí.)
- **`scripts/verify.sh` — nový krok „index.html structure"**, dvě kontroly:
  1. **Párování značek** nad celým `index.html` (komentáře se předtím strippnou,
     protože legitimně obsahují `</div>`). Hlásí řádek a který element zůstal
     otevřený.
  2. **Každé `#page-*` a `#bottom-dock-container` musí být přímé dítě
     `#workspace-main`.** Tohle je ta kontrola, která by rozbití chytila i kdyby
     značky náhodou vyšly.
  Ověřeno, že to opravdu chytá: po dočasném smazání toho `</div>` verify.sh
  spadne a vypíše přesně `#page-help is nested inside #page-settings` a
  `#bottom-dock-container is nested inside #page-settings`.
- **Viditelné scrollbary** (`styles.css`) — byly 6 px široké s palcem
  `rgba(255,255,255,0.08)` na tmavém pozadí, tedy prakticky neviditelné. Proto
  ořezaný panel vypadal jako rozbité vykreslení a ne jako něco, kam se dá
  scrollovat. Nově 10 px, palec 22 % bílé, track s ohraničením, ostré rohy
  (`border-radius` odstraněn), na hover azurový.
  **Past, na kterou jsem narazil:** doplnil jsem k tomu `* { scrollbar-color }`
  kvůli Firefoxu — a tím Chromium **přestalo respektovat celý blok
  `::-webkit-scrollbar`** (nastavení `scrollbar-color` má v Chromiu přednost
  a webkit pseudoelementy vypne). Naměřeno: `offsetWidth - clientWidth` zůstalo
  2 px místo 12. Vyřešeno obalením do
  `@supports not selector(::-webkit-scrollbar) { … }` — projde jen Firefox.
- **Nastavení, pravý panel:** `.diag-list` je nově `grid` s
  `repeat(auto-fill, minmax(175px, 1fr))` místo sloupce. Devět řádků klíč/hodnota
  bylo 578 px vysokých v panelu širokém 490 px; ve dvou sloupcích je to 393 px
  a zároveň se využije šířka, kterou panel stejně má.
- **Nastavení, levý panel:** tři výběry cest (Python / repozitář LeRobot /
  úložiště) jsou v `.settings-path-grid` (`minmax(260px, 1fr)`). Jako jedna
  karta na řádek byla každá z nich ~800 px široká kvůli jednomu inputu.
- `.settings-pane > * { flex: 0 0 auto }` — flex položka se defaultně smrskne
  pod svůj obsah. Ve scrollujícím flex sloupci to znamená, že box je nižší než
  to, co kreslí, přebytek uteče ven přes `overflow: visible` a panel se o něm
  ve svém `scrollHeight` **nikdy nedozví**. Přesně tak vznikly řádky uříznuté
  v půlce.
- `app.ts` `toggleTerminal()` — prázdná inline výška znamená, že dok je na své
  CSS výšce (26vh), tedy **otevřený**. Kód ji považoval za zavřený, takže první
  kliknutí na „Toggle" dok **zvětšilo** na 38vh místo aby uvolnilo plochu.
  Teď se sbaluje. (Do teď to skoro nešlo poznat — dok byl vidět jen na jedné
  stránce.)
- Bump assetů na `?v=3.59.0`.

**Ověřeno v cloudu**

- `bash scripts/verify.sh` prochází celé: tsc, **136 pytestů**, compileall,
  i18n parita cs=en=795, žádná duplicitní id, **9 panelů pod `#workspace-main`**,
  102 `App.*` odkazů.
- **Zanoření v DOM proti běžícímu backendu**: všech 8 stránek i dok mají teď
  rodiče `main#workspace-main`. Před opravou dva z nich `#page-settings`.
- **Dok**: `dockH: 234` na *všech* stránkách (před opravou 0 všude kromě
  Nastavení).
- **Nápověda**: kliknutí na položku v levém pruhu (`App.changeTab('help')`)
  otevře stránku **1390 × 632** bez `alert()`; osm bloků má přirozené výšky
  `[324, 751, 592, 298, 298, 427, 303, 243]` a scrollport 3022 / 568 scrolluje
  (tj. žádná regrese zmáčknutých bloků z běhu (3)). Před opravou 0 × 0.
- **Nastavení, 1600×900**: všech **9 diagnostických řádků viditelných** (před
  opravou byly 4 uříznuté). Levý panel má 456 px obsahu v 393 px → scrolluje,
  a **scrollbar se opravdu vykreslí**: `offsetWidth - clientWidth` = 12 px na
  levém panelu a 2 px (jen rámečky) na pravém, kde se scrollovat nemá.
  Kolečkem myši dojede `scrollTop` na maximum 63 a poslední karta je celá vidět.
- **Regresní přeměření všech osmi stránek** na 1600×900, 1280×800 a 1024×760
  **se zapnutými scrollbary**: žádný vodorovný přetok, žádný nedosažitelný
  prvek, nejširší tlačítko 225 px, žádná chyba v konzoli. Hit-testem ověřeno,
  že **každé tlačítko v `.block-actions` na viditelném tabu jde kliknout** —
  nic ho nepřekrývá, ani nově zobrazený dok.
- **Anglický režim** na Nastavení: jediný řetězec s českou diakritikou je
  „Čeština" na přepínači jazyka (záměr — jazyky se píšou svým jazykem).

**Zbývá vyzkoušet na fyzickém robotu / reálném desktopu** (v cloudu nelze)

- Že se do konzole opravdu propisuje výstup LeRobotu **na jiných stránkách než
  Nastavení** — dok tam teď je, ale s reálným procesem to ověřené není. Týká se
  to hlavně `lerobot-find-port`, který čeká odpověď od uživatele v terminálu.
- Že „Toggle" u doku sbalí a rozbalí konzoli bez toho, aby se rozbil layout
  stránky pod ním (měřeno jen v otevřeném stavu 26vh).
- Vzhled scrollbarů mimo Chromium: ve Firefoxu jede větev `@supports`, na macOS
  jsou navíc systémové overlay scrollbary. Ověřeno jen v Chromiu, a i to
  s vypnutým `--hide-scrollbars` (headless ho jinak přidává sám a scrollbar
  pak není v layoutu vůbec — pozor při měření).

## 2026-08-01 (5) — Setup/Kalibrace: z 14 % prázdné stránky pracovní plocha

**Proč právě tohle.** `scripts/verify.sh` na výchozím stavu prošel celý (136
pytestů), priorita A byla prázdná. Fronta níže měla Setup/Kalibraci jako
největší zbývající mrtvou plochu a měření to potvrdilo: při 1600×900 zabíral
veškerý obsah **levý horní roh** — vpravo ~700 px a dole ~600 px prázdna.

**Naměřený výchozí stav (headless Chromium, obsazenost plochy stránky)**

- 1600×900: **14 %**, 1280×800: 20 %, 1024×760: 21 %.
- Příčina byla jedna řádka CSS: `#page-setup .setup-wizard-panel[data-tab-panel=
  "calibrate"] .setup-section { max-width: 640px }` (sdílené pravidlo s tabem
  „Modely"). Panel se tedy nikdy neroztáhl přes polovinu okna.
- Celý obsah tabu byl **jedna lišta tlačítek + jeden odstavec**. Všechno
  ostatní bylo skryté: živý panel (`display:none`, dokud kalibrace neběží)
  a správce kalibračních souborů (jen v modálu).

**Co se změnilo — tab je teď dvousloupcová pracovní plocha**

- `max-width` zrušen jen pro kalibraci (Modely si ho nechávají), sekce má
  `flex: 1` + `grid-template-rows: minmax(0, 1fr)`.
- **Levý sloupec — stav ramen.** Karta pro leader a pro follower, každá
  s typem zařízení, `id` (to, pod kterým LeRobot pojmenuje soubor), portem,
  **navázaným kalibračním souborem** a počtem kloubů. Barevný pruh a štítek
  vlevo: zeleně `source: "calibration"`, žlutě `source: "default"` (= nic
  navázáno, obecné rozsahy). Data z existujícího
  `/api/calibration/arm_visual_config`, žádný nový endpoint.
- **Tlačítko „Kalibrovat leader/follower" je uvnitř karty toho ramene**, ne
  v horní liště, a vedle sebe má technicky přesný popisek, který přepínač
  LeRobotu spustí (`--teleop.*` vs `--robot.*`).
- Sekce „Uložené kalibrace" ukazuje **počet a rozpad** (v projektu / v cache
  LeRobotu / aktivně navázáno) z `/api/calibration/list` — dřív se to nedalo
  zjistit jinak než otevřením modálu. Modál zůstává jako drill-down.
- Poslední sekce levého sloupce je **schéma ramene s legendou motor-ID**
  a jako jediná má `flex: 1 1 auto` — pohlcuje volnou výšku sloupce, protože
  je to jediný prvek, kterému velikost prospívá.
- **Pravý sloupec — vlastní běh.** V klidu: postup, kterým `device.calibrate()`
  opravdu projde, s **doslovnými hláškami LeRobotu** (viz ověření níže), plus
  tabulka **uložených rozsahů** (`range_min`/`range_max`/rozpětí + ID motoru)
  z navázaného souboru. Za běhu: živá tabulka MIN/POS/MAX se přesune nad
  postup (`order`), tabulka uložených rozsahů se skryje (jsou to hodnoty,
  které ten běh právě přepisuje) a **krok, na kterém proces stojí, se
  zvýrazní žlutě** podle fáze.
- Fáze běhu (`setCalibrationPhase`) šly do i18n — byly natvrdo česky
  v `app.ts`. Nově má i stav `idle` („nespuštěno").
- U jednoramenných robotů (LeKiwi/Moss/Stretch) se s tlačítkem skrývá i celá
  leader karta — dřív zůstala viset karta zařízení, které kalibrovat nejde.
- 45 nových i18n klíčů (cs i en). `hint.calFlow` smazán — nahradil ho přesný
  čtyřkrokový postup.
- Bump assetů na `?v=3.58.0`.

**Opravené chyby (nalezené při práci)**

1. **Přepnutí jazyka přepsalo název otevřeného projektu.**
   `#title-active-project` má natvrdo `data-i18n="title.noProject"` pro
   prázdný stav, takže každé `applyI18n()` (tj. každý přepnutý jazyk) nahradilo
   „Bench Cell" za „Žádný vybraný projekt". `onProjectOpened()` teď atribut
   odebere a `onProjectClosed()` ho vrátí. Ověřeno oběma směry.
2. `manualRefreshCalibration()` po dokončení nastavovala popisek tlačítka
   natvrdo česky („Načíst stav"), takže v anglickém režimu se tlačítko
   po každém obnovení odpřeložilo. Nově přes `t()`.
3. Popisky u tlačítek kalibrace byly natvrdo česky i v anglickém režimu
   („Kalibrovat leader", „Uložené kalibrace", „Načíst stav", „Restart
   serveru") — všechny mají klíč.

**Ověřeno v cloudu**

- `bash scripts/verify.sh` prochází celé: tsc, **136 pytestů**, compileall,
  i18n parita cs=en=795, žádná duplicitní id, 102 `App.*` odkazů.
- **Proti běžícímu backendu** (uvicorn + projekt se dvěma reálnými
  kalibračními soubory, 6 kloubů s nestejnými rozsahy): karty ukazují
  `so100_leader`/`leader_bench_01.json`/6 kloubů zeleně, souhrn „V projektu 2,
  v cache LeRobotu 2, aktivně navázáno 2", tabulka 6 řádků s rozpětími
  a `wrist_roll` 0–4095, legenda 6 badgů, schéma vykreslené.
- **Přechody stavů** (simulované `showCalibrationLivePanel` +
  `renderCalibrationLiveTable` + `hideCalibrationLivePanel`): klid → běh →
  klid. V běhu 5 řádků, `wrist_flex` správně označen „nezměřeno" (rozpětí 2 <
  `_CAL_MIN_SPAN`), zvýrazněný krok 3, všechna tři tlačítka hit-testem
  klikatelná. Po ukončení se vrátí 6 uložených řádků, fáze „nespuštěno",
  jmenovka robota se vyprázdní.
- Headless Chromium na **1600×900, 1280×800 i 1024×760**: obsazenost 31 / 39 /
  36 % (měřeno jen na prvcích, které opravdu kreslí — kontejnery se nepočítají),
  žádný vodorovný přetok, žádné roztažené tlačítko/pole. Při nízkém okně oba
  sloupce **scrollují, neořezávají** (`overflow-y: auto`).
- **Anglický režim**: v celém `page-setup` nezůstal jediný řádek s českou
  diakritikou.
- **Regresní přeměření všech osmi stránek** ve třech velikostech: kromě už
  známého `diag-list` v Nastavení (položka ve frontě níže, nesahal jsem na ni)
  nic neořezává, nic nepřetéká, žádné chyby v konzoli. Teleoperace je beze
  změny — sdílené `.arm-visual-*` CSS se měnilo jen pod `.cal-live-visual`.

**Zbývá vyzkoušet na fyzickém robotu** (v cloudu nelze)

- Že `lerobot-calibrate` opravdu projde těmi čtyřmi kroky v tomhle pořadí
  a že zvýraznění kroku odpovídá tomu, kde proces stojí. Fáze `start` vs
  `range` se odvozuje z prvního řádku min/pos/max — proti běžícímu procesu
  ověřená není.
- Že „Potvrdit (Enter)" posune kalibraci dál a „Kalibrovat znovu (c)" vynutí
  nové měření na rameni, které už kalibrační soubor má (krok 1 se bez
  existujícího souboru vůbec neobjeví, takže se testuje jen na druhém běhu).
- Sloupce `Port` zůstávají „-", dokud nejsou vidět sériové porty — v kontejneru
  žádné nejsou, takže vyplnění portu z Connect tabu ověřené není.
- Že se schéma ramene za běhu hýbe podle `calibration_progress`.

## 2026-08-01 (4) — Teleoperace: konec prázdné plochy a roztažených dlaždic

**Proč právě tohle.** `scripts/verify.sh` na výchozím stavu prošel celý
(136 pytestů), takže priorita A byla prázdná. Změřením všech osmi stránek
v headless Chromiu vyšla Teleoperace jako jediná stránka, kde jsou **obě**
věci, které zadání zakazuje, naráz: mrtvá plocha i pole roztažená do
nesmyslných rozměrů.

**Naměřený výchozí stav (1600×900)**

- Sloupec 1 („Ovládání relace") měl pod zaškrtávátkem **~470 px prázdna** —
  přes polovinu sloupce.
- Sloupec 2: šest dlaždic telemetrie kloubů bylo `flex: 1; align-items:
  stretch` uvnitř `justify-content: space-evenly`, takže se readout „J1 /
  0.0000 / 0.0000" roztáhl na **~260 px vysoký blok**. Přesně to, co zadání
  označuje za hlavní problém.
- Sloupec 3: dvě prázdné karty vizualizace ramen.
- Při 1024×760 `.setup-block` ořezával obsah (813 px obsahu v 660 px bloku,
  `overflow: hidden`) — položka z fronty, teď vyřešená.

**Co se změnilo**

- **`.teleop-unified-grid` má dva sloupce místo tří** (`minmax(340px, 0.85fr)`
  / `minmax(0, 1.15fr)`). Vizualizace ramen je jediný prvek na téhle stránce,
  který se **smysluplně** zvětšuje s dostupným místem, takže volnou výšku
  pohlcuje ona — ne šest roztažených dlaždic.
- **Levý sloupec `.teleop-col`** drží vše o relaci: hardware → kalibrace →
  nastavení relace → telemetrie. Sekce mají `flex: 0 0 auto`, takže si sloupec
  nikdy nerozpouští volné místo do jejich obsahu, a sloupec sám má
  `overflow-y: auto` — při nízkém okně **scrolluje místo aby ořezával**.
- **Dlaždice kloubů mají pevnou výšku** (`grid-auto-rows: 58px;
  align-content: start`). Tři řádky textu zůstanou tři řádky textu.
- **Nový blok „Kalibrace použitá pro tuto relaci"** vyplňuje uvolněné místo
  skutečným obsahem, ne výplní. Pro každé rameno ukazuje typ zařízení
  a **kterým kalibračním souborem `lerobot-teleoperate` opravdu pojede**;
  `source: "default"` (tj. žádná vazba a obecné rozsahy) je vidět žlutě
  *před* spuštěním, ne až se rameno rozjede špatně. Data jdou ze stávajícího
  `/api/calibration/arm_visual_config`, žádný nový endpoint.
- **Vizualizace ramen**: leader a follower vedle sebe (`.arm-visual-cols`),
  schéma roste s panelem (`.arm-visual-svg-wrap` je `flex: 1`, SVG drží
  poměr 1:1). Miniatura na stránce Kalibrace zůstává 100×100 px — ověřeno.
- **Opravená chyba**: `loadArmVisualConfig()` se při zavřeném projektu vracel
  hned na začátku (`if (!this.project) return;`) a nechal na obrazovce
  **prázdnou mřížku dvou karet**, zatímco `#arm-visual-empty` s hláškou
  „Otevřete projekt…" zůstal skrytý. Teď obě větve končí ve stejném prázdném
  stavu, a ten se svisle centruje místo aby visel u horní hrany.
- **Opravená chyba**: po úspěšném načtení se `#arm-visual-grid` nastavoval
  natvrdo na `display: grid`, i když `.arm-visual-grid` je v CSS
  `display: flex; flex-direction: column`. Inline styl vyhrával nad
  stylopisem. Opraveno na `flex`.
- `.arm-visual-legend:empty { display: none }` — `renderArmVisualLegend()`
  zapisuje `""`, když nezná id kloubů, a prázdný box se do té doby kreslil
  jako ohraničený pruh nad schématy.
- Inline styly v přepsané části nahrazeny třídami (`.teleop-sub`,
  `.teleop-stat`, `.joint-telemetry-box`…). Šestkrát zopakovaný inline styl
  dlaždice kloubu je teď jedno pravidlo.
- Nové i18n klíče (cs i en): krátké popisky hardwaru, celý kalibrační blok,
  tooltip u „∞". Popisky `Leader Typ` / `Follower Port` byly do teď natvrdo
  česky i v anglickém režimu.
- Bump assetů na `?v=3.57.0`.

**Ověřeno v cloudu**

- `bash scripts/verify.sh` prochází celé: tsc, **136 pytestů**, compileall,
  i18n parita cs=en=750, žádná duplicitní id, 102 `App.*` odkazů.
- **Proti běžícímu backendu** (uvicorn + projekt se dvěma reálnými
  kalibračními soubory): kalibrační blok ukazuje `leader_bench_01.json` /
  `follower_bench_01.json`, oba zeleně, se správnými typy zařízení
  a souhrnnou větou; obě schémata ramen se vykreslila podle rozsahů ze
  souborů.
- Headless Chromium na **1600×900, 1280×800, 1024×760 a 900×700**: všech 11
  ovládacích prvků teleoperace (včetně poslední dlaždice kloubu, obou
  kalibračních řádků a obou tlačítek v patičce) je dosažitelných —
  `scrollIntoViewIfNeeded` je dostane do viditelné oblasti a nic je
  neořezává. Žádný vodorovný přetok, žádná dlaždice vyšší než 90 px.
- Kontrola všech `getElementById` odkazů proti `index.html`: z přepsané části
  nezmizelo **žádné** id (17 mrtvých odkazů je těch dřív zapsaných níže).
- Přeměření všech osmi stránek: obě položky teleoperace ze vstupního měření
  zmizely, ostatní stránky mají přesně stejné hodnoty jako před změnou —
  žádná regrese.

**Zbývá vyzkoušet na fyzickém robotu** (v cloudu nelze)

- Že `lerobot-teleoperate` opravdu jede s tím kalibračním souborem, který
  blok hlásí. Vazba se čte z projektu a nasazuje se do cache LeRobotu při
  otevření projektu (`deploy_active_bindings()`), ale shodu s tím, co proces
  reálně načte, ověřenou nemám.
- Živá telemetrie: že se dlaždice kloubů plní a barví (`checkDiff()` píše
  `borderColor`/`background` inline na `.joint-telemetry-box` — třída se
  nezměnila, ale s reálnými daty to ověřené není).
- Že se schémata ramen hýbou podle živých dat, teď když jsou výrazně větší.
- Sloupce `Leader port` / `Follower port` zůstávají „-", dokud nejsou
  vidět sériové porty — v kontejneru žádné nejsou.

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
- ~~Teleoperace: `.setup-block` se ořezává při nízkém okně~~ — hotovo
  2026-08-01 (4), sloupec `.teleop-col` má vlastní scrollport.
- ~~Nastavení: pravý panel diagnostiky ořezává řádky mid-row~~ — hotovo
  2026-08-01 (6). Příčiny byly tři, ne jedna: (a) dok zabíral 234 px uvnitř
  `#page-settings` kvůli chybějícímu `</div>`, (b) `.settings-pane` děti se
  smršťovaly pod svůj obsah, (c) scrollbar byl 6 px a neviditelný. Původní
  popis níže zůstává, protože past při měření platí dál.
  <details><summary>původní zápis</summary>
  **Nastavení: pravý panel diagnostiky ořezává řádky mid-row.** Změřeno na
  1600×900: `.diag-list` má obsah 532 px v boxu 323 px, `overflow: visible`.
  Řádky 7–9 (conda, Miniconda, volné místo) jsou proto uříznuté v půlce
  a **není vidět žádný scrollbar** — vypadá to jako rozbité vykreslení.
  Kolečkem myši se panel doscrollovat *dá* (ověřeno: `scrollTop` dojede na
  maximum), takže obsah není nedosažitelný — ale chybí jakákoli indikace,
  že je kam scrollovat. Totéž potká levý panel (5. karta „Úložiště datasetů"
  je pod hranou).
  Pozor na past při měření: `.settings-pane` je flex kontejner *a zároveň*
  scroll kontejner a jeho děti se smršťují pod svůj obsah. Chromium pak hlásí
  `scrollHeight - clientHeight = 199`, ale programové `scrollTop = 99999`
  doskočí jen na ~2 px. Skutečný stav se pozná až **reálným kolečkem myši**
  (`page.mouse.wheel`), ne přiřazením `scrollTop`.
  Lék je stejný jako u teleoperace: dát přímým dětem scrollujícího flex
  panelu `flex: 0 0 auto`, aby se nesmršťovaly, plus viditelný scrollbar.
  </details>
- ~~Setup / Kalibrace má obrovskou mrtvou plochu~~ — hotovo 2026-08-01 (5),
  dvousloupcová plocha, obsazenost 14 % → 31 %. Zbývá **Setup/Connect**
  (~360 px dole) a **Orchestrace/Běh modelu** (~270 px uprostřed). Stejný
  recept: přeskládat sloupce a volnou výšku dát prvku, který se smysluplně
  zvětšuje. Pozor na past, na kterou tenhle běh narazil: rozpustit volnou
  výšku do `justify-content: space-between` na seznamu kroků vypadá rozbitě
  (120px mezery mezi položkami) — místo toho tam patří prvek, který má co
  ukázat (tabulka, schéma).
- **Hledat `max-width` na `.setup-section`.** Kalibrace měla mrtvou plochu
  kvůli jedné sdílené řádce `max-width: 640px`. Tab „Modely" ji pořád má —
  až na něj přijde řada, začít tam.
- **Před commitem na `main` pouštět `scripts/verify.sh`.** 58277f7 přistál
  s dvěma padajícími kontrolami (chybějící `App.browseFile`, dva nedefinované
  i18n klíče) a se ztrátou popisu scény i přepínače jazyka. Od (6) verify.sh
  navíc kontroluje párování značek a zanoření stránek — f494000 kvůli tomu
  sedmkrát po sobě prošel s nedostupnou Nápovědou a neviditelnou konzolí.
- **Prázdná plocha v panelech.** Teleoperace hotová (4), Kalibrace (5),
  Projekty (8), `datasety` (9), `modelrun` (10). Zbývají **`setup/connect`**
  a **`uceni`**. Vyplnit rozvržením nebo grafickým prvkem, NE roztažením polí.
  Tohle je věc, kterou zadání označuje za hlavní problém.
  **POZOR na čísla ve frontě z běhů (7)–(8):** fixture tehdy zakládal projekt
  **bez dovedností**, takže se u `datasety`, `uceni` a `modelrun` měřil prázdný
  stav a čísla byla řádově nižší než realita (`datasety` 7–11 % vs skutečných
  32–37 %). Od (9) fixture zakládá úkol se dvěma pod-kroky. **Než si vybereš
  stránku podle tabulky, přeměř ji** — `bash scripts/measure-layout.sh`.
- ~~**Měřicí skripty se vyplatí mít v repu.**~~ — hotovo 2026-08-02 (8):
  `bash scripts/measure-layout.sh [--pages a,b] [--json]`. Pasti níže platí dál,
  jsou v něm ošetřené a okomentované. Původní zápis:
  **Měřicí skripty se vyplatí mít v repu.** Běh 2026-08-01 (5) je psal potřetí.
  Recept, který funguje a stojí za zapsání do `scripts/`: nastartovat
  `python3 -m uvicorn orchiday.server:app --port 8100` (s `PYTHONPATH=src`
  a `QT_QPA_PLATFORM=offscreen`), přes API si založit a otevřít projekt
  s robotem a dvěma kalibračními soubory, a teprve pak měřit — proti
  statickému serveru nad `web/` je většina stránek prázdná a měření lže.
  Obsazenost plochy počítat **jen na prvcích, které kreslí** (listy s textem,
  `input`/`select`/`svg`); když se počítají i kontejnery, prázdný panel vyjde
  na 82 %. Původní poznámka z běhu (4): Tenhle běh je psal znovu od nuly
  (statický HTTP server nad `web/` + headless Chromium, `playwright` se v
  cloudu doinstaluje přes `npm i -D playwright`, prohlížeč je předinstalovaný
  v `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). Dvě pasti, na které
  se dá naletět: první spuštění zakrývá celou plochu `#setup-wizard-overlay`
  (nutno skrýt), a `App.changeTab()` bez otevřeného projektu vyhodí `alert()`
  a přepne zpět na „Projekty" — pro screenshot je potřeba volat rovnou
  loadery stránky (`loadArmVisualConfig`, `loadSysInfo`, `dsRefreshList`).
  Zvážit přidání kontroly „žádný panel neořezává obsah" do `scripts/verify.sh`
  jako volitelný krok (skip, když `playwright` chybí) — layoutové regrese se
  podle tohohle deníku vracejí každý běh.
  **Doplněno během (6), dvě nové pasti při měření:** `playwright` se v cloudu
  doinstaluje (`npm i playwright`), ale stažený build se neshoduje
  s předinstalovaným prohlížečem — je nutné
  `chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })`.
  A **headless Chromium si sám přidává `--hide-scrollbars`**, takže se scrollbar
  nepočítá do layoutu a na screenshotu není; kdo měří scroll affordance, musí
  spustit s `ignoreDefaultArgs: ['--hide-scrollbars']`, jinak měří nesmysl.
  Třetí past: `scrollIntoView()` je kvůli `scroll-behavior: smooth`
  (styles.css:2788) **asynchronní** — v hit-testu je potřeba
  `{ behavior: 'instant' }`, jinak vyjde jako nedosažitelné tlačítko, které
  ve skutečnosti jde kliknout.
- ~~Konzolový dok dole překrývá spodek pracovní plochy~~ — od opravy zanoření
  2026-08-01 (6) je dok sourozencem stránek v `#workspace-main`, takže si místo
  rezervuje a nic nepřekrývá (ověřeno hit-testem tlačítek v `.block-actions`
  na 1600×900 / 1280×800 / 1024×760). **Novou cenou je, že každá stránka
  přišla o 234 px výšky** — na 1024×760 zbývá na pracovní plochu ~270 px.
  Všechno je dosažitelné scrollem, ale stránky Nastavení a Učení jsou tam
  těsné. Dok jde sbalit na 40 px tlačítkem „Toggle" (od (6) funguje napoprvé).
  Zvážit, jestli si stav sbaleného doku nemá appka pamatovat.
- ~~`.datacollection-grid` má pravidla pro `nth-child(3)`, ale v HTML jsou jen
  2 bloky~~ — vyřešeno 2026-08-02 (9): třetí sloupec je „Značkování pod-úkolů".
  Kamerový náhled se sem **nevrátil** — mrtvá id `cam-feed-placeholder-1/2`
  zůstávají ve frontě níž a je pořád nerozhodnuto, jestli má sběr dat ukazovat
  živý obraz kamer, nebo to nechat na doku dole.
- ~~`:root` má `--radius`, `--radius-lg`, `--overlay-blur` a `backdrop-filter`~~
  — hotovo 2026-08-02 (7). Všechno pryč, nahrazeno jedním
  `* { border-radius: 0 }`, a `verify.sh` krok „flat design tokens" hlídá
  `styles.css`, `index.html` i `app.ts`, aby se to nevrátilo.
- `styles.css` importuje fonty z `fonts.googleapis.com` — bez internetu appka
  spadne na fallback. Zvážit zabalení fontů lokálně.
- Mrtvé odkazy na id v `app.ts` (jsou null-guardované, takže nic nepadá, ale je to
  neudržovaný kód): `status-ws`, `status-robot`, `status-lm`, `robot-list`,
  `sidebar-proj-name`, `sidebar-projects-list-container`, `breadcrumb-file`,
  `breadcrumb-section`, `train-repo-id`, `cam-feed-placeholder-1/2`.
  (`active-skill-size` a `active-skill-training` jsou od (9) skutečné elementy
  v řádku statistik na kartě Sběr dat; `task-latch-desc-text` od (10) existuje
  v HTML a banner Task Latche ho opravdu používá.)
  Buď doplnit chybějící UI (indikátor stavu WS/robota by se hodil), nebo smazat.
- Natvrdo česky psané řetězce v dynamicky generovaném HTML (mimo i18n):
  `dsRefreshList`, `advPopulateResumeSkills`, wizard `wizard-opt-found-*`.
  (Seznam epizod v `selectSkill` hotový od (9), `renderInferenceSubtasks`
  a celý sloupec workeru od (10).)
  Také `calibrateArm()` („Spouštím (leader)…") a hlášky `log()` napříč
  `app.ts` — ty se do konzole píšou vždy česky.
- **Vzor, na který si dát pozor:** element se statickým `data-i18n`, do kterého
  se pak píše dynamický text. Každé `applyI18n()` (= přepnutí jazyka) ho
  přepíše zpátky na překlad klíče. Takhle mizel název otevřeného projektu
  z titulkové lišty (opraveno 2026-08-01 (5)). Buď atribut při zápisu
  dynamické hodnoty odebrat, nebo ho spolu s textem přenastavit na klíč, který
  právě platí — obojí je v kódu použité, hledat `setAttribute('data-i18n'`.

**Naměřená obsazenost plochy (2026-08-02 běh (9), headless Chromium, fixture
s jedním úkolem a dvěma pod-kroky)**

Fronta na vyplnění prázdné plochy. Počítáno jen na prvcích, které opravdu
kreslí; 1600×900 / 1280×800 / 1024×760:

| stránka | obsazenost | poznámka |
|---|---|---|
| `setup` | **17 / 20 / 22 %** | nejhorší — tab Connect (Kalibrace hotová v (5)) |
| `teleoperation` | **17 / 20 / 22 %** | po (4) |
| `modelrun` | ~~20 / 23 / 25 %~~ → **24 / 33 / 37 %** | hotovo (10), tři sloupce, 0 roztažených polí |
| `projects` | 26 / 33 / 43 % | po (8) |
| `settings` | 28 / 34 / 34 % | po (6), + `#settings-scene-desc` 726 px |
| `help` | 27 / 35 / 41 % | scrolluje, v pořádku |
| `datasety` | 33 / 40 / 40 % | hotovo (9), tři sloupce |
| `uceni` | 37 / 20 / 20 % | + jeden ořezaný prvek, viz níže |

**Čísla z běhů (7)–(8) v tabulce nejsou** — měřila se proti fixture bez
dovedností, tedy proti prázdnému stavu, a byla u poloviny stránek řádově
mimo (`datasety` „7 / 8 / 11 %" bylo ve skutečnosti 32 / 34 / 37 %). Vždycky
přeměřit, nikdy nevěřit zapsané tabulce starší než jeden běh.

**Měřicí skript** je od 2026-08-02 (8) v repu: `scripts/measure-layout.sh`
(wrapper: server + fixture projekt) a `scripts/measure_layout.mjs` (měření).
Vyžaduje `npm i playwright`; `verify.sh` ho nevolá. **Od (9) si fixture zakládá
i dovednosti** (`ensureSkills()`: jeden úkol + dva pod-kroky, tedy rozdělitelný)
— bez nich se na `datasety`, `uceni` a `modelrun` měří prázdný stav a čísla
lžou o desítky procent. Nová past z běhu (8):
`waitUntil: 'networkidle'` vyprší — živý `/ws` a retry importu fontů síť nikdy
neutiší, nutno `domcontentloaded` + `waitForFunction(() => !!window.App)`.
Kromě pastí
zapsaných v (4)–(6) platí: `changeTab()` funguje jen s **otevřeným projektem**
(vytvořit přes `POST /api/projects` + `/api/projects/open`), první spuštění
zakrývá plochu `#setup-wizard-overlay` (skrýt a nastavit
`localStorage.orchiday_setup_completed`), a `pkill -f "uvicorn orchiday.server"`
**zabije i vlastní shell** — vzorec se shoduje s příkazovou řádkou toho pkillu.

- **Roztažená pole přes celou šířku okna** — `scripts/measure-layout.sh` je hlásí
  ve sloupci `wide` (práh 620 px). Zbývá: `uceni` `#train-extra-args` 884 px
  a `settings` `#settings-scene-desc` 726 px. `datasety` hotové od (9),
  `modelrun` od (10) (3 → 0). Přesně to, co zadání zakazuje.
  **Recept, který na `datasety` zabral:** pole do
  `grid-template-columns: repeat(auto-fit, minmax(215px, 1fr))` a jen dvě pole
  s opravdu dlouhou hodnotou (cesta, CLI argumenty) přes `span 2` — plus zkrátit
  sloupec, ve kterém formulář sedí. `max-width` na sekci **nepoužívat**, to je
  přesně to, co v (5) dělalo mrtvou plochu na Kalibraci.
- **`uceni` má na všech třech velikostech `clipped=1`**:
  `DIV.chart-container-docked` má `overflow: hidden` a `scrollHeight` o 4 px
  větší než `clientHeight` (512>508 / 262>258 / 454>450). Malé, ale stejná
  třída chyby jako ořezaná diagnostika z (6).
- **Pod globálním zlomem 920 px končí patičky panelů mimo první pohled** na
  `datasety` (2), `setup` (1), `uceni` (1) i `projects` (1). Stránka scrolluje
  a všechny jsou dosažitelné (ověřeno hit-testem), takže rozbité to není —
  ale pokud má appka cílit i na malá okna, stojí za rozmyšlenou, jestli
  primární akce nemá být přišpendlená ke spodní hraně stránky místo panelu.

**Backend / LeRobot**
- **`bash scripts/setup-dev.sh` je na čerstvém kontejneru povinný krok.**
  Běhy (7)–(10) shodně začaly dvěma padajícími testy jen proto, že v obrazu
  chybí `websockets`. Není to chyba kódu (`pyproject.toml` ji deklaruje od (7))
  — je to nepřipravené prostředí. **Nediagnostikovat to znovu, rovnou pustit
  setup a měřit až potom.**
- **Doporučení pro další běhy — stáhnout si zdrojáky LeRobotu.** Priorita B
  zadání chce ověřovat chování příkazů proti zdrojáku, a v cloudu je z PyPI
  dostupná jen 0.4.4 (viz níž). Vyplatí se `pip download lerobot` /
  `git clone https://github.com/huggingface/lerobot` do `/tmp` na začátku běhu
  a číst `record.py` / `calibrate.py` přímo, ne z `lerobot_cheatsheet.md`.
- **`orchestration_plan_preview()` je od (10) jediné místo, kde UI zjišťuje,
  co běh udělá.** Když se změní `_policy_path_for()`, `_resolve_orchestration_plan()`
  nebo `_verify_policy_exists()`, změní se s nimi automaticky i stránka —
  a `tests/test_orchestration_preview.py` to hlídá
  (`test_checkpoint_path_matches_what_the_executor_would_use`). Nezavádět
  vedle toho druhý, ručně psaný výpočet cest v `app.ts`.
- Nedá se ověřit chování na LeRobotu ≥ 0.5 — PyPI index v cloudu má maximum
  0.4.4. Nové wrappery aspoň spadnou nahlas místo tichého no-opu.
- **Konzole prohlížeče má být od (9) čistá** (kromě importu fontů z Googlu —
  kontejner je bez internetu). `GET /api/project` už nevrací 404, když není
  otevřený projekt, a favicona existuje. Když se v konzoli objeví nová chyba,
  je to opravdu nová chyba, ne trvalý šum — vyplatí se to udržet.
- **Kontroly, které nespouští server, neuvidí celou třídu chyb.** Běh (7)
  našel dvě (chybějící `websockets`, nezadrátovaný most událostí) až tím, že
  spustil backend a připojil se na `/ws`. `verify.sh` to nedělá a dělat nemusí,
  ale `tests/test_runtime_dependencies.py` teď aspoň hlídá invarianty
  (deklarovaná závislost, `_lifespan` volá `connect_event_bus()` právě jednou).
  Zvážit, jestli podobný smoke test nemá dostat i sběr dat a kalibrace.
