Návrat k Orchiday je skvělý krok. Všechny ty facky, které nám dneska Draccus, hardware a video enkodér uštědřili, jsou perfektním materiálem pro to, aby byl tvůj orchestrátor naprosto neprůstřelný. Když tyto zkušenosti přetavíme do logiky aplikace, uživatel (nebo ty při ostrém nasazení) uvidí místo ošklivých crashů v terminálu čisté a konstruktivní hlášky.

Tady je kompletní **Orchiday Robustness Cheatsheet** rozdělený podle kritických fází, které musí tvůj `QProcess` manažer a backend ošetřit.

---

## 🛠️ Orchiday Robustness Cheatsheet

### 1. Fáze: Pre-flight Hardware Check (Před spuštěním QProcess)

Nikdy nespouštěj nahrávání ani inferenci naslepo. Orchiday by měl nejprve provést rychlý test sběrnice.

* **Problém:** Chybějící motor na sběrnici (např. odpojené ID 6 kleští) shodí celý proces po několika sekundách.
* **Implementace v aplikaci:** Než Orchiday odpálí hlavní `lerobot-record` proces, spustí na pozadí bleskový (1-sekundový) Python podproces, který zkontroluje dostupnost všech ID.
* **Kód pro interní check:**

```python
# Orchiday spustí tento bleskový skript před nahráváním/evaluací
from lerobot.motors.feetech import FeetechMotorsBus
from lerobot.motors.motors_bus import Motor, MotorNormMode

def check_bus(port, expected_ids=[1, 2, 3, 4, 5, 6]):
    DEFAULT_NORM = list(MotorNormMode)[0]
    motors = {f"m{i}": Motor(i, "sts3215", DEFAULT_NORM) for i in expected_ids}
    try:
        bus = FeetechMotorsBus(port=port, motors=motors)
        bus.connect()
        bus.disconnect()
        return True, "Sběrnice je OK"
    except RuntimeError as e:
        return False, f"Chyba hardwaru: Vypadlý motor? {str(e)}"
    except Exception as e:
        return False, f"Chyba portu: Je ruka zapnutá? {str(e)}"

```

---

### 2. Fáze: Validace souborového systému (Anti-Overwrite)

LeRobot striktně odmítá přepisovat existující lokální datasety.

* **Problém:** `FileExistsError` při pokusu vytvořit složku, která už v cache existuje.
* **Implementace v aplikaci:** Orchiday musí před generováním CLI příkazu zkontrolovat cestu `~/.cache/huggingface/lerobot/local/{dataset_name}`.
* **Strategie orchestrátoru:**
* Pokud složka existuje, aplikace v UI nabídne buď **Automatický inkrement** (přidá koncovku `_v2`, `_novy`), nebo **Bezpečné smazání** (zavolá `shutil.rmtree` po schválení uživatelem).



---

### 3. Fáze: Výkonová optimalizace (Anti-Lag / 30 Hz stabilita)

Úzké hrdlo na zápisu videa spolehlivě zničí frekvenci řízení robota (pád ze 30 Hz na 4.7 Hz).

* **Problém:** Trhaný pohyb, lagování inference, vypadávání vzorků (CPU/GPU starvation).
* **Implementace v aplikaci:** Orchiday musí do generovaných CLI příkazů pro `lerobot-record` a `lerobot-train` **vždy natvrdo injektovat** optimalizační flagy a lokální přepínače.
* **Povinné argumenty pro generátor příkazů:**

```bash
# Pro nahrávání i spuštění modelu VŽDY přidávat:
--dataset.streaming_encoding=true \
--dataset.encoder_threads=2 \
--policy.push_to_hub=false \
--dataset.single_task="Uživatelský popis úkolu z UI"

```

---

### 4. Fáze: Runtime Stream a Parsování chyb (QProcess Monitor)

Tvůj `QProcess` musí aktivně číst `readAllStandardError()` a `readAllStandardOutput()` a hledat v nich klíčové robotické "red flagy".

* **Problém:** Servo se přetíží (`Overload error`), vypne se ochranou a robot přestane reagovat, přičemž proces může dál běžet naprázdno.
* **Regexy pro Orchiday parser lۆgů:**
* `"Overload error!"` ──► **Akce v UI:** Okamžitě červená stopka! Hláška: *"Kritické přetížení serva! Vypni na 2 minuty napájení robota, aby serva vychladla."*
* `"Incorrect status packet!"` ──► **Akce v UI:** Oranžové varování. Sběrnice ztrácí packety (přerušený drát/rušení).
* `"running slower ({x} Hz) than the target FPS"` ──► **Akce v UI:** Žluté varování. Počítač nestíhá (přetížené GPU/CPU).



---

### 5. Fáze: Struktura Draccus Parseru (CLI Hierarchie)

Při generování příkazů pro trénování pamatuj na striktní dělení parametrů, které Draccus vyžaduje.

| Typ parametru | Kam patří v CLI | Příklad |
| --- | --- | --- |
| **Globální (Pipeline)** | Top-level (přímo za příkaz) | `--steps=2000`, `--save_freq=1000`, `--output_dir=...` |
| **Model (Konfigurace sítě)** | Pod jmenný prostor `--policy.*` | `--policy.type=act`, `--policy.device=cuda` |
| **Data (Dataset)** | Pod jmenný prostor `--dataset.*` | `--dataset.repo_id=...`, `--dataset.video_backend=pyav` |

---

Když tyhle kontrolní body zapracuješ do stavového automatu Orchiday, získáš aplikaci, která si sama ohlídá hardware, nezkolabuje na hloupém přepsání složky a včas tě upozorní, že serva melou z posledního.

Chceš teď začít psát ten pre-flight hardware checker v Pythonu pro integraci do tvého backendu, nebo se podíváme na úpravu QProcess wrapperu, aby uměl tyhle kritické chyby odchytávat za běhu?
Tohle je perfektní strategické rozhodnutí. Rozbít ten monolit na hierarchický systém samostatných „Skills“ (dovedností) je přesně to, co ti zachrání nervy a přinese reálné výsledky. VLM bude generál na velitelském můstku (plánování) a LeRobot modely budou specialisté v zákopech (čistá motorika).

Tady máš ucelený návrh architektury, ukládání a správy souborů, který navazuje na tvůj robustnostní cheat sheet. Můžeš ho rovnou zkopírovat a hodit na konec svého souboru.

---

## 🧠 6. Fáze: Hierarchická Architektura Dovedností (Skills-Based Setup)

Aby Orchiday mohl flexibilně přepínat mezi specializovanými modely, musíme zavést přísný řád do souborového systému. Zapomeň na generické složky `outputs/train`. Každá motorická dovednost (Skill) musí mít svůj vlastní izolovaný balíček.

### A. Adresářová struktura knihovny dovedností (Skills Library)

Aplikace Orchiday bude spravovat centralizované úložiště dovedností na disku:

```text
~/.config/orchiday/skills/
├── move_elbow/
│   ├── config.json
│   ├── dataset_stats.json      # Klíčové: normalizační statistiky pro daný pod-úkol
│   └── model.safetensors       # Vytrénované váhy (ACT checkpoint)
├── rotate_wrist/
│   ├── config.json
│   ├── dataset_stats.json
│   └── model.safetensors
└── close_gripper/
    ├── config.json
    ├── dataset_stats.json
    └── model.safetensors

```

---

### B. Životní cyklus Skillů (Správa, Přepisování a Mazání)

Orchiday backend (přes Python API / QProcess) musí řídit bezpečný export z trénovací cache LeRobotu do naší knihovny dovedností.

#### 1. Uložení / Export nového Skillu

Když dokončíš trénink v LeRobotu (např. v `outputs/train/checkpoints/003000/pretrained_model`), Orchiday v UI nabídne tlačítko **„Uložit jako Skill“**.

* **Akce na pozadí:** Aplikace vezme obsah složky `pretrained_model`, zkopíruje ho do `~/.config/orchiday/skills/{nazev_skillu}/` a navíc z trénovaného datasetu vytáhne konkrétní `meta/stats.json` a uloží ho k modelu jako `dataset_stats.json`.

#### 2. Bezpečné přepisování (Anti-Corruption Lock)

Pokud uživatel trénuje vylepšenou verzi stávajícího skillu (např. `move_elbow`), nesmí dojít k okamžitému přepsání za běhu, protože starý model může být zrovna načtený v paměti.

* **Strategie:** Orchiday vytvoří dočasnou složku `move_elbow_tmp`. Jakmile je kopírování dokončeno, provede se blesková atomická operace:
1. Přejmenování původní složky na `move_elbow_old`
2. Přejmenování `move_elbow_tmp` na `move_elbow`
3. Smazání `move_elbow_old` (pokud záměna prošla)



#### 3. Čisté mazání (Cleanup)

Při smazání dovednosti z UI Orchiday zavolá standardní `shutil.rmtree()`, ale předtím v backendu zkontroluje, zda na tento model aktuálně neodkazuje běžící VLM skript, aby nedošlo k pádu inference uprostřed akce.

---

### C. Dynamické swapování modelů v GPU paměti (Runtime Hot-Swap)

Aby mohl vygenerovaný skript plynule vykonat sekvenci úkolů, musíme po dokončení každého kroku uvolnit CUDA paměť. Grafické karty nemají nekonečnou VRAM, aby držely 5 ACT modelů naráz.

**Vzorový kód pro Orchiday Runner, který bezpečně střídá checkpointy za běhu:**

```python
import torch
import gc
from lerobot.policies.factory import make_policy
from pathlib import Path

class OrchidaySkillExecutor:
    def __init__(self):
        self.current_policy = None
        self.skills_dir = Path("~/.config/orchiday/skills/").expanduser()

    def load_skill(self, skill_name, policy_cfg, dataset_meta):
        # 1. 🔥 UVOLNĚNÍ PŘEDCHOZÍHO MODELU Z VRAM
        if self.current_policy is not None:
            del self.current_policy
            self.current_policy = None
            torch.cuda.empty_cache()
            gc.collect()  # Natvrdo vyčistíme Python garbage collector

        # 2. NAČTENÍ NOVÉHO SKILLU
        skill_path = self.skills_dir / skill_name
        policy_cfg.pretrained_path = str(skill_path)
        
        print(f"🔄 Orchiday swapuje model -> Načítám skill: {skill_name}")
        self.current_policy = make_policy(policy_cfg, ds_meta=dataset_meta)
        self.current_policy.eval()
        return self.current_policy


```

---

### D. Rozhraní pro VLM (Skriptovací vrstva)

Jakmile top-level VLM (např. Qwen-VL nebo GPT-4o) analyzuje scénu z kamery, Orchiday od něj neočekává souřadnice, ale **čistou sekvenci příkazů (High-Level Plan)**, kterou náš orchestrátor přechroustá.

**Příklad JSON plánu vygenerovaného VLM pro Orchiday:**

```json
{
  "thought": "Uživatel chce podat hrnek. Musím nejprve pohnout loktem dopředu a pak sevřít kleště.",
  "sequence": [
    {
      "skill": "move_elbow",
      "termination_condition": "duration_seconds",
      "value": 4.5
    },
    {
      "skill": "close_gripper",
      "termination_condition": "duration_seconds",
      "value": 1.5
    }
  ]
}

```

**Jak to Orchiday vykoná:**

1. Backend přečte první prvek, zavolá `load_skill("move_elbow", ...)`
2. Pustí inferenční smyčku (kterou jsme dneska úspěšně rozchodili a ošetřili o normalizaci) přesně na 4.5 vteřiny.
3. Po uplynutí času utne smyčku, uvolní VRAM, zavolá `load_skill("close_gripper", ...)` a pošle signál do motorů kleští.

---

Tímto se z Orchiday stává modulární operační systém pro tvého robota. Každou schopnost vytrénuješ bleskově na pár epizodách, uložíš ji jako samostatnou kostičku Lego a VLM z nich pak už jen staví výsledné chování. Máš to plně pod kontrolou!
