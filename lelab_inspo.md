# 💡 leLab: Detailní analýza & Inspirace pro Orchiday

Tento dokument obsahuje podrobnou strukturální a funkční analýzu projektu **leLab** (webové rozhraní pro LeRobot vyvíjené Hugging Face). Cílem je identifikovat osvědčené postupy, architekturu řízení procesů, správu stavu a uživatelské interakce, které můžeme přímo či nepřímo využít v projektu **Orchiday** pro zajištění maximální stability, spolehlivosti a uživatelského komfortu.

---

## 📂 Strukturální přehled leLab

Projekt je rozdělen na standardní FastAPI backend a React (Vite, TypeScript, Tailwind, shadcn/ui) frontend.

```
leLab/
├── lelab/                      # Backend (Python balíček)
│   ├── utils/                  # Pomocné moduly (konfigurace, systém, HF auth)
│   ├── calibrate.py            # Kalibrace kloubů a motorů Feetech
│   ├── teleoperate.py          # Teleoperace (Leader-Follower ramena)
│   ├── record.py               # Nahrávání datasetů (epizody, fáze resetu)
│   ├── train.py                # Příprava trénovacích parametrů a CLI příkazů
│   ├── rollout.py              # Autonomní inference (vyhodnocení politiky)
│   ├── jobs.py                 # Správa dlouho běžících procesů (trénování)
│   └── server.py               # FastAPI server, WebSockets, routování
├── frontend/                   # Frontend (React + TypeScript)
│   ├── src/
│   │   ├── components/         # Komponenty uživatelského rozhraní
│   │   ├── contexts/           # Globální stavy (API, Urdf, HF auth, atd.)
│   │   ├── hooks/              # Vlastní React hooky (useRealTimeJoints, atd.)
│   │   └── pages/              # Hlavní stránky (Calibration, Recording, Training...)
```

---

## 🔍 Detailní analýza backendových souborů

### 1. `lelab/server.py`
Hlavní FastAPI server, který zajišťuje REST API a WebSocket spojení.
* **WebSocket vysílání (`ConnectionManager`)**: Používá dedikované na pozadí běžící vlákno (`broadcast_thread`) a bezpečnou frontu (`queue.Queue()`) pro odesílání informací o poloze kloubů klientům. Pokud se nedaří data odeslat, spojení se bezpečně uzavře. Tím se zamezuje zahlcení hlavního vlákna FastAPI.
* **Statická distribuce**: Pokud existuje složka `frontend/dist` (vygenerovaná přes `npm run build`), server ji automaticky připojí na `/` jako `StaticFiles`.
* **Shutdown hook**: Při ukončení serveru korektně vypne vysílací vlákno a odpojí připojené roboty.

### 2. `lelab/utils/config.py`
Správa systémových cest a nízkoúrovňových souborových operací.
* **Atomický zápis (`_atomic_write_text`)**: Veškeré konfigurační soubory (porty, kalibrace, robotické záznamy) se zapisují nejprve do dočasného souboru (`.tmp`) a poté se atomicky nahradí pomocí `os.replace`. Tím se předchází poškození konfiguračních souborů při náhlém výpadku proudu nebo pádu aplikace.
* **Detekce odpojení USB (Port disconnect detector)**:
  1. Zavolá se `find_available_ports()`, který vrátí seznam dostupných sériových portů na systému (`/dev/tty*` na Linuxu).
  2. Uloží se výchozí stav.
  3. Uživatel je vyzván k odpojení zařízení. Metoda `detect_port_after_disconnect` periodicky (s intervalem 0.3s a timeoutem 15s) zkoumá rozdíl množin portů.
  4. Jakmile zmizí právě jeden port, je identifikován jako port daného zařízení. Velmi blbuvzdorné řešení, které nevyžaduje zadávání USB PID/VID.

### 3. `lelab/calibrate.py`
Řeší kalibraci motorů Feetech (STS3215) krok za krokem prostřednictvím vizuálního rozhraní.
* **Předcházení skokům enkodéru (`CalibrationDiscontinuityError`)**: Feetech enkodér je 12-bitový (0-4095). Pokud uživatel zahájí kalibraci blízko hranice přetečení a otočí motorem přes limit, dojde ke skoku o ~4096. Aplikace toto hlídá a vyvolá chybu, čímž donutí uživatele umístit robotické rameno před kalibrací do středové polohy.
* **Automatický homing**: Využívá metodu `_get_half_turn_homings(actual_positions)` ze sběrnice LeRobot, čímž automaticky dopočítá homing offsety na základě aktuální polohy, čímž eliminuje potřebu složitého manuálního nastavování nuly.
* **Vláknové řízení**: Kalibrace běží ve vlastním vlákně (`_calibration_worker`), které komunikuje s hlavním vláknem pomocí synchronizačních událostí (`threading.Event`).

### 4. `lelab/teleoperate.py`
Zajišťuje zrcadlení pohybu z Leader (řídicího) ramene na Follower (vykonávací) rameno.
* **URDF korekce kloubů (`_SO101_URDF_CORRECTIONS`)**: Pro 3D vizualizaci v prohlížeči je nutné přepočítat mechanické polohy motorů na souřadný systém URDF modelu robota SO-101. Tento modul obsahuje přesné transformační konstanty (znaménko a ticks offset při nulové poloze) pro problematické klouby (`shoulder_lift` a `elbow_flex`).
* **Vysílací smyčka (20 Hz)**: Snímá polohy z Follower ramene a posílá je klientům přes WebSocket. Vlákno teleoperace běží na plný výkon, ale vysílání dat na frontend je omezeno na 20 snímků za sekundu (interval 50 ms), čímž šetří síťové prostředky a procesorový čas prohlížeče.

### 5. `lelab/record.py`
Modul pro interaktivní sběr dat (nahrávání epizod pro trénování).
* **Fázový stavový stroj**: Rozděluje proces na fáze:
  - `preparing` (inicializace a uvolnění kamer)
  - `recording` (sběr dat, kdy se data zapisují do datasetu přes LeRobot `record_loop`)
  - `resetting` (vynulování prostředí a návrat robota do startovní pozice - **zde se nezapisují žádné snímky**, volá se `record_loop` bez parametru `dataset`)
  - `completed` a `error`.
* **Řízení nahrávání pomocí webových událostí**: CLI verze `lerobot_record` reaguje na klávesy (šipky, ESC). Zde se předává slovník `web_events` (`exit_early`, `stop_recording`, `rerecord_episode`), kterému frontend nastavuje hodnoty přes API volání, a `record_loop` je uvnitř čte.
* **Zrušení a přenahrání epizody (`clear_episode_buffer`)**: Pokud uživatel během nahrávání udělá chybu, může stisknout tlačítko "Re-record". Aplikace zavolá `dataset.clear_episode_buffer()`, zahájí fázi resetu a nechá uživatele nahrát stejné číslo epizody znovu, bez nutnosti restartovat celý proces.
* **Uvolnění kamer**: Před spuštěním nahrávání počká proces 2 sekundy, aby dal prohlížeči (který mohl zobrazovat WebRTC náhled z kamery) čas uvolnit USB kamery, čímž se předejde chybám typu "Device busy".

### 6. `lelab/train.py`
Sestavuje exekuční příkaz pro trénování.
* **Použití `sys.executable`**: Místo prostého volání `python -m lerobot.scripts.lerobot_train` se lokalizuje aktuálně spuštěný interpret. Tím je zaručeno, že trénovací proces poběží ve stejném Conda/Virtualenv prostředí, ve kterém běží samotný webový server, což zabraňuje chybám "ModuleNotFoundError".

### 7. `lelab/rollout.py`
Spouští autonomní chování robota (inference) na základě natrénované politiky.
* **Stažení checkpointu z Hugging Face**: Podporuje jak lokální cesty k modelům, tak HF Hub repozitáře (např. `user/repo@checkpoints/000050`). Před startem se provede `snapshot_download` pouze pro vybraný krok checkpointu.
* **Obcházení interaktivních promptů**: LeRobot na začátku rolloutu standardně vypíše dotaz na kalibraci a čeká na stisk klávesy ENTER. Proces rolloutu v leLabu to obchází tak, že do `stdin` nově vytvořeného procesu zapíše znak nového řádku (`\n`) a ihned jej uzavře. Tím proces pokračuje autonomně bez zablokování.
* **Detekce dokončení setupu**: Asynchronní vlákno čte stdout procesu a hledá řetězec `"Rollout setup complete"`. Jakmile ho detekuje, zaznamená čas spuštění samotného pohybu. Uživatel na webu díky tomu vidí rozdíl mezi "načítáním modelu/připojováním hardware" a "samotným během".

### 8. `lelab/jobs.py`
Klíčový soubor pro stabilitu. Řeší spouštění tréninků jako nezávislých úloh na pozadí.
* **Odolnost proti restartu serveru (Detached Processes)**:
  - Trénovací proces je spuštěn s `start_new_session=True`. Tím se stane vůdcem vlastní procesní skupiny a není spojen s procesem webového serveru.
  - Informace o úloze (včetně systémového **PID**) se zapíší do `job.json` v cílové složce tréninku.
  - Pokud se webový server restartuje (např. uvicorn hot-reload po úpravě kódu), při startu načte všechny `job.json` a zkontroluje, zda proces s daným PID stále žije (pomocí `os.kill(pid, 0)`).
  - Pokud žije, vytvoří se `TailingJobRunner`, který se připojí k běžícímu procesu a pokračuje v tailování logu (`log.jsonl`).
  - Uživatel tak nikdy neztratí kontrolu nad tréninkem kvůli restartu backendu.
* **Parsování metrik v reálném čase**: Výstup trénovacího procesu (stdout) je parsován regulárními výrazy. Vyhodnocují se `tqdm` indikátory (krok, celkový počet, ETA) a logovací řádky (loss, učící rychlost `lr`, grad_norm), které se ukládají jako JSONL body.
* **Seeding grafů**: Rozhraní nabízí endpoint `/metrics-history`, který zrekonstruuje kompletní historii metrik ze souboru `log.jsonl`. Díky tomu se grafy tréninku okamžitě vykreslí i po obnovení stránky (F5).

---

## 🎨 Významné frontendové prvky (React / TypeScript)

### 1. `Training.tsx`
* **Rozdělení na konfiguraci a monitorování**: Pokud v URL není parametr `jobId`, zobrazí se přehledný formulář se všemi parametry tréninku. Po spuštění se uživatel přesměruje na `/training/:jobId`, kde vidí živý graf ztráty (loss), gradientů a terminálový výstup.
* **Seeding logů**: Při načtení stránky se nejprve stáhne kompletní dosavadní log ze souboru na disku (`getJobLogFile`), a teprve poté se spouští periodické doptávání na nové řádky (`getJobLogs`). Tím se zabraňuje přenosu obrovských objemů dat při každém požadavku.

### 2. `UrdfContext.tsx` & `useRealTimeJoints.ts`
* **3D model robota**: Využívá knihovny pro zobrazení robota přímo v prohlížeči na základě URDF konfigurace. Hodnoty kloubů přicházející z WebSocketu se okamžitě aplikují na 3D model, takže uživatel vidí přesnou polohu robota i bez fyzické přítomnosti kamery.

---

## ✨ Inspirace pro Orchiday (Hlavní vychytávky)

Zde je seznam klíčových architektonických prvků, které doporučujeme integrovat do **Orchiday** pro zvýšení robustnosti:

| Funkce v leLab | Co řeší | Přínos pro Orchiday |
| :--- | :--- | :--- |
| **Persistentní PID & Tailing** | Pád/restart serveru přeruší monitorování běžící úlohy. | Orchiday může bezpečně spouštět nahrávání, kalibraci či trénování a při restartu aplikace plynule navázat bez přerušení procesu. |
| **`stdin.write(b"\n")`** | Podprocesy visí a čekají na stisk klávesy v terminálu. | Při spouštění LeRobot skriptů (např. rollout, record) Orchiday automaticky projde počáteční potvrzovací dialogy. |
| **Port Unplug Diffing** | Uživatel neví, na jakém COM/tty portu je které rameno připojené. | Vytvoření jednoduchého průvodce: "Odpojte rameno -> Stiskněte pokračovat -> Připojte rameno" pro automatické přiřazení portů bez chyb. |
| **`clear_episode_buffer()`** | Zkažená epizoda během teleoperace znehodnotí celý dataset. | Umožnit uživateli stisknout "Zrušit krok / Přenahrát krok" přímo v UI Orchiday, což vymaže buffer poslední epizody a spustí reset. |
| **20 Hz Throttle pro WebSocket** | Pomalá odezva UI nebo vysoké zatížení procesoru při odesílání poloh kloubů. | Omezit rychlost odesílání polohy kloubů pro vizualizaci na pevných 20 Hz, což je plně dostačující pro plynulé vykreslení. |
| **Atomický zápis souborů** | Korupce konfiguračních JSON souborů při chybě zápisu. | Používat zápis do `.tmp` a následný přesun přes `os.replace` pro všechny ukládané konfigurace Orchiday. |
| **Oddělená fáze resetu** | Zkažená epizoda během teleoperace znehodnotí celý dataset. | Během resetu mezi epizodami volat nahrávací smyčku LeRobot bez předání objektu datasetu, čímž se nahrává pouze čistá aktivita. |

---

## 🚀 Implementovaná vylepšení v Orchiday (Inspirováno leLabem)

1. **Automatické obcházení interaktivních promptů (Bypass Confirmation Hanging):**
   - V souboru `lerobot_bridge.py` jsme integrovali automatické zapsání znaku nového řádku (`b"\n"`) do vstupu (`stdin`) spouštěných procesů typu `teleop`, `calibrate`, `record`, `replay` a `infer`. Tím se předchází zamrznutí procesů při čekání na potvrzení načtení kalibračního souboru.
   
2. **Vysokofrekvenční telemetrický kanál (High-Frequency Telemetry Pipe):**
   - Daemon `orchiday_inference.py` nyní vysílá v reálném čase (interval ~100 ms) strukturovaná data s prefixem `[TELEMETRY]`, která obsahují aktuální úhly kloubů (J1-J6), predikované cílové hodnoty, proud na gripperu, stav uklidnění ramen (consecutive settled frames) a maximální odchylku kloubů.
   
3. **Filtrování konzolového výstupu (Console Output Clean Filter):**
   - Na straně frontendu v `app.ts` a `app.js` jsme zavedli inteligentní filtr, který zprávy začínající na `[TELEMETRY]` zpracuje do grafického rozhraní (barevně zvýrazněná tabulka kloubů a motorů), ale nepustí je do textového pole terminálu. Uživatel tak má čistý log bez zahlcení a zároveň plynulé vizuální hodnoty v reálném čase.
