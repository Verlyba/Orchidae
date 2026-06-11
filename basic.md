# Komplexní architektonický návrh: Cross-Platform Open-Source platforma pro hierarchické řízení robotů (VLM + LeRobot)

Tento dokument slouží jako kompletní technická specifikace a produkční blueprint pro vývoj desktopové aplikace (Windows, macOS, Linux). Cílem je vytvořit uživatelsky přívětivé grafické prostředí (no-code/low-code platformu), které dokáže naučit jakéhokoliv stolního robota (primárně SOarm101) novým dovednostem pomocí imitovaného učení (LeRobot) a následně je inteligentně orchestrovat pomocí velkých lokálních modelů (LLM/VLM přes LM Studio).

---

## 1. Globální architektura systému (Třímodelový mozek)

Systém striktně odděluje kognitivní vrstvu, analytickou vrstvu a motorickou vrstvu. Tím je dosaženo vysoké flexibility, kdy low-level model nemusí chápat kontext celého úkolu, ale soustředí se pouze na perfektní provedení izolované mikrooperace.

```
                     ┌────────────────────────┐
                     │   UŽIVATELSKÉ CHAT UI  │
                     └───────────┬────────────┘
                                 │ Textový příkaz (např. "Uklidit stůl")
                                 ▼
         ┌────────────────────────────────────────────────┐
         │ MODEL 1: Vysoká úroveň (LLM v LM Studiu)       │
         │ Funkce: CEO - Rozklad úkolu na posloupnost akcí│
         └───────────────────────┬────────────────────────┘
                                 │
                                 ▼ List sub-tasků: ["pick_cube", "drop_in_bowl"]
┌────────────────────────────────────────────────────────────────────────┐
│                      HLAVNÍ STAVOVÝ AUTOMAT (GUI)                      │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │ Request na validaci stavu scény
                                 ▼
         ┌────────────────────────────────────────────────┐
         │ MODEL 2: Střední úroveň (VLM v LM Studiu)      │
         │ Funkce: Inspektor - Verifikace vizuálního stavu│
         └───────────────────────┬────────────────────────┘
                                 │
                                 ▼ Odpověď: "cube_on_table" -> Povolení exekuce
┌────────────────────────────────────────────────────────────────────────┐
│ CORE ORCHESTRÁTOR (Task Latching & Zámek řízení)                       │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │ Aktivace konkrétní dovednosti + Zámek
                                 ▼
         ┌────────────────────────────────────────────────┐
         │ MODEL 3: Nízká úroveň (LeRobot Inference)     │
         │ Funkce: Svaly - 30 FPS generování úhlů serv   │
         └───────────────────────┬────────────────────────┘
                                 │
                                 ▼ USB / Sériový port
                     ┌────────────────────────┐
                     │    ROBOT (SOarm101)    │
                     └────────────────────────┘

```

---

## 2. Technologický stack platformy

Aby byla zajištěna stoprocentní přenositelnost mezi operačními systémy a vysoký výkon při zpracování obrazu, je zvolen následující stack:

* **Grafické rozhraní (GUI):** `PySide6` (Nativní Qt6 vazba pro Python). Qt6 poskytuje špičkový výkon pro real-time renderování videa z kamer a umožňuje nativní manipulaci s okny (plovoucí, minimalizovatelné panely).
* **Správa prostředí a balíčků:** `Pixi` (moderní cross-platform package manažer). Pixi zajišťuje, že uživatel na Windows (s CUDA), Linuxu (s CUDA) i macOS (s Apple Silicon MPS) spustí aplikaci jedním příkazem a systém sám nainstaluje správné binárky PyTorchu a LeRobotu.
* **Inference a Trénink:** `Hugging Face LeRobot API` spouštěné asynchronně na pozadí prostřednictvím izolovaných procesů (`subprocess`).
* **Lokální AI Server:** `LM Studio API` (kompatibilní s OpenAI protokolem, běžící lokálně na portu `1234`).

---

## 3. Detailní rozpad modulů aplikace

### Modul A: Flexibilní správa kamer (Multi-Streaming Windowing)

Aplikace obsahuje dedikovaný panel pro správu video streamů (např. kamera z ruky robota, globální kamera stolu).

* Každá kamera běží ve vlastním vyhrazeném vlákně `QThread`, aby se nesnižovalo FPS hlavního uživatelského rozhraní.
* V UI je u každého streamu k dispozici **Toggle Switch (Zapnout/Vypnout)**. Při vypnutí dochází k okamžitému uvolnění hardwaru přes OpenCV (`cap.release()`), což šetří USB sběrnici a CPU/GPU výkon.
* Okna s kamerami lze z hlavní aplikace "odepnout" do samostatných plovoucích oken na ploše (využití nativních Qt vlajek `Qt.Window`).

### Modul B: No-Code Skill Platform (Sběr dat a Trénink)

Tento modul plně nahrazuje psaní příkazů do terminálu LeRobotu vizuálními klikátky.

1. **Vytvoření dovednosti:** Uživatel klikne na `+ Nová akce`, zadá český název (aplikace jej interně namapuje na anglický identifikátor, např. "Zvedni kostku" ──► `pick_up_cube`).
2. **Sběr dat (Data Collection UI):** UI nabízí velká tlačítka `Spustit nahrávání` a `Zastavit`. Na pozadí aplikace vyvolá nativní skript LeRobotu přes `subprocess.Popen`. Aplikace zachytává textový výstup z terminálu a transformuje ho do vizuálního progress baru.
3. **Automatické štítkování:** Po dokončení nahrávání backend aplikace využije LeRobot dataset API. Otevře nově vytvořené Parquet soubory v lokální cache a do sloupce `task` nebo `language_instruction` automaticky zapíše identifikátor akce (`pick_up_cube`) pro všechny snímky dané epizody.
4. **Tréninkové centrum:** Dropdown menu nabídne detekované architektury z konfigurací LeRobotu (`diffusion`, `act`, `vqbet`). Uživatel nastaví epochy a batch size pomocí sliderů. Po kliknutí na `Trénovat` aplikace spustí tréninkový proces na pozadí. Hodnoty ztrátové funkce (Loss) jsou v reálném čase parsovány a vykreslovány do interaktivního Qt grafu.

### Modul C: Asynchronní orchestrátor se zámkem úkolu (The Gatekeeper)

Tento modul zabraňuje tomu, aby velký VLM model posílal chaotické instrukce za jízdy a pomátl robota. Řídí se principem **Task Latching**.

* Jakmile Model 1 (CEO) sestaví plán (např. 1. `pick_up_cube`, 2. `move_to_bowl`), spustí se exekuce prvního kroku.
* Orchestrátor předá příkaz motorickému vláknu a **uzamkne stavový automat** (`self.task_locked = True`). V tomto momentě se asynchronní komunikace s LM Studiem zcela zastaví.
* Motorické vlákno (Model 3 - LeRobot Inference) má stoprocentní prioritu. Generuje trajektorie na 30 FPS.
* **Odemčení nastává až při splnění podmínky:**
* *Varianta A:* Uplynul časový limit vyhrazený pro danou dovednost (Time Budget).
* *Varianta B:* LeRobot dojel na konec predikovaného bloku akcí (Action Chunk).
* *Varianta C:* Hardwarový trigger (Servo hlásí zvýšený proud / kleště jsou sevřené).


* Po odemčení se probudí Model 2 (VLM Inspektor), vyfotí scénu, potvrdí úspěch a orchestrátor posune ukazatel na další sub-task.

---

## 4. Průvodce implementací: Krok za krokem

### Krok 1: Inicializace prostředí přes Pixi

V kořeni projektu se vytvoří soubor `pixi.toml`, který definuje multiplatformní závislosti. Tím uživatelům odpadá nutnost manuálně instalovat CUDA, PyTorch nebo závislosti Qt6.

```toml
[project]
name = "robot-skill-platform"
version = "0.1.0"
channels = ["conda-forge", "pytorch"]
platforms = ["linux-64", "win-64", "osx-arm64"]

[dependencies]
python = ">=3.10,<3.11"
pyside6 = ">=6.6.0"
opencv = ">=4.8.0"
pytorch = ">=2.2.0"
torchvision = ">=0.17.0"
pandas = "*"
pyarrow = "*"
requests = "*"

[pypi-dependencies]
lerobot = { git = "https://github.com/huggingface/lerobot.git" }

```

### Krok 2: Implementace kamerového vlákna (PySide6)

Vytvoření stabilního, vypínatelného streamu z kamery, který neblokuje hlavní UI vlákno.

```python
import cv2
from PySide6.QtCore import QThread, Signal, Slot
from PySide6.QtGui import QImage

class AdvancedCameraWorker(QThread):
    image_signals = Signal(QImage)

    def __init__(self, camera_id=0):
        super().__init__()
        self.camera_id = camera_id
        self._running = False

    def run(self):
        self._running = True
        cap = cv2.VideoCapture(self.camera_id)
        # Optimalizace pro rychlý start a snímkování
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        
        while self._running:
            ret, frame = cap.read()
            if ret:
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                h, w, ch = rgb_frame.shape
                bytes_per_line = ch * w
                qt_image = QImage(rgb_frame.data, w, h, bytes_per_line, QImage.Format_RGB888)
                self.image_signals.emit(qt_image)
            else:
                self.msleep(10)
        cap.release()

    def stop(self):
        self._running = False
        self.wait()

```

### Krok 3: Kód asynchronního orchestrátoru (Core Engine)

Zajišťuje bezpečné přepínání mezi LM Studiem a LeRobotem bez trhání trajektorií.

```python
import asyncio
import httpx

class RobotCoreOrchestrator:
    def __init__(self, lm_studio_url="http://localhost:1234/v1"):
        self.api_url = lm_studio_url
        self.task_queue = []
        self.is_locked = False
        self.current_state = "IDLE"

    async def fetch_macro_plan(self, user_instruction: str):
        """Model 1: Rozklad uživatelského příkazu přes LLM v LM Studiu"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_url}/chat/completions",
                json={
                    "model": "local-model",
                    "messages": [
                        {"role": "system", "content": "Jsi plánovač robotického ramene. Rozlož příkaz na pole sub-tasků. Odpověz čistým JSON polem stringů bez keců."},
                        {"role": "user", "content": user_instruction}
                    ]
                },
                timeout=30.0
            )
            # Předpokládáme korektní parsování výstupu: ["pick_cube", "move_to_bowl"]
            self.task_queue = response.json()['choices'][0]['message']['content']
            self.current_state = "EXECUTING"

    async def verify_scene_with_vlm(self, base64_image: str) -> str:
        """Model 2: Ověření aktuálního stavu scény přes VLM inspektora"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{f'{self.api_url}/chat/completions'}",
                json={
                    "model": "visual-model",
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": "Odpověz jedním slovem. Je kostka na stole? [ano/ne]"},
                                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                            ]
                        }
                    ]
                }
            )
            return response.json()['choices'][0]['message']['content'].strip().lower()

    async def run_orchestration_loop(self, UI_callback_update_frame):
        """Hlavní asynchronní smyčka řízení"""
        while self.current_state == "EXECUTING" and self.task_queue:
            if self.is_locked:
                await asyncio.sleep(0.05)
                continue

            # Vezmi další úkol v pořadí
            active_task = self.task_queue.pop(0)
            
            # Uzamčení systému před předáním řízení motorickému modelu
            self.is_locked = True
            
            # Spuštění LeRobot inference v samostatném synchronním subsystému
            await self.execute_lerobot_policy(active_task, UI_callback_update_frame)

    async def execute_lerobot_policy(self, skill_name: str, UI_callback):
        """Simulace volání Modelu 3 (LeRobot Inference)"""
        # V reálném nasazení zde běží importovaná policy z LeRobotu:
        # policy = LeRobotPolicy.from_pretrained(f"local/{skill_name}")
        print(f"[MOTOR] Spouštím plynulou trajektorii pro: {skill_name}")
        
        # Simulace běhu 3 vteřiny na 30 FPS (90 kroků) bez účasti VLM
        for _ in range(90):
            # action = policy.predict(current_images, current_states)
            # robot.step(action)
            await asyncio.sleep(1/30) 
            
        print(f"[MOTOR] Dovednost {skill_name} dokončena.")
        # Odemčení zámku - stavový automat může přejít k dalšímu VLM dotazu
        self.is_locked = False

```

---

## 5. Metodika validace a neprůstřelný benchmark

Aby měl projekt vysokou vědeckou hodnotu, aplikace v sobě obsahuje dedikovaný **Benchmark Modul**, který proti sobě staví dva zcela odlišné přístupy řízení na identických hardwarových podmínkách.

### Konstrukce testu:

Uživatel si vytiskne papírovou šablonu s mřížkou 20 přesných souřadnicových bodů. Kostka a miska se postupně umístí na těchto 20 identických pozic pro oba modely.

1. **Test Modelu A (Monolitický Baseline):**
* Všechna nasbíraná tréninková data (50 epizod) jsou spojena do jednoho velkého balíku.
* Trénuje se standardní *Diffusion Policy* **bez** textových příkazů.
* Model musí z čistých pixelů pochopit celou sekvenci úkonu (najít -> uchopit -> přenést -> pustit).


2. **Test Modelu B (Hierarchická platforma - Tvůj systém):**
* Stejná data jsou označena textovými štítky v Parquet souborech.
* Trénuje se *Goal-Conditioned Diffusion Policy*.
* Při testování posílá LM Studio příkazy, které přepínají vnitřní směřování sítě.



### Vyhodnocované metriky (Sledované v UI a ukládané do CSV):

* **Success Rate (Úspěšnost):** Procento úspěšných doručení kostky do misky z 20 pokusů.
* **Odolnost proti anomáliím (Disturbance Recovery):** Experimentátor během fáze přenosu úmyslně vyrazí kostku z kleští. Zaznamenává se binární hodnota (1 = Hierarchický model si všiml chyby přes VLM, re-plánoval a pokusil se kostku zvednout znovu; 0 = Monolitický model pokračoval prázdnou rukou nad misku).
* **Systémová latence (System Latency):** Průměrný čas reakce systému. U monolitu bude v řádu milisekund (čistá rychlost), u hierarchického se projeví režie HTTP volání na LM Studio (trade-off inteligence vs. rychlost).

---

## 6. Ochrana hardwaru a bezpečnostní filtry

Protože se jedná o fyzický hardware (serva Feetech na SOarm101), aplikace v motorickém vlákně vynucuje hardwarovou ochranu:

* **Low-Pass Filter (Dolní propust):** Výstupní úhly z LeRobot policy jsou vyhlazovány pomocí exponenciálního klouzavého průměru s koeficientem $\alpha = 0.25$. To zabraňuje trhavým pohybům a rázům do převodovek v momentě, kdy VLM změní stav úkolu.
* **Slew Rate Limiter:** Maximální změna úhlu serva mezi dvěma po sobě jdoucími snímky (33 ms) je striktně omezena (např. max 0.05 radiánu). Pokud model predikuje anomální skok, aplikace příkaz ořízne a zaloguje varování do UI konzole.
* **Watchdog časovač:** Pokud low-level proces neodpoví hlavním stavovému automatu do 5 vteřin, motorické vlákno okamžitě odpojí napájení serv (přejde do stavu torzního uvolnění), čímž se zabrání spálení motorů při mechanickém záseku ramene.