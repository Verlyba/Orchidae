# LeRobot OS Workbench — Kompletní Příručka & CLI Cheatsheet

Tato příručka slouží jako referenční cheatsheet pro integraci Hugging Face **LeRobot** knihovny s naší třímodelovou architekturou v **Orchiday OS**. Obsahuje přesné příkazy, parametry a workflows pro kalibraci, teleoperaci, nahrávání, trénování a nasazení modelů.

---

## 📌 Rychlý rozcestník moderních skriptů
V novějších verzích LeRobot jsou skripty buď dostupné jako centralizovaná utilita `control_robot.py` se sub-příkazy, nebo jako samostatné skripty v `lerobot/scripts/`:

*   **Kalibrace:** `python lerobot/scripts/calibrate.py` nebo `python lerobot/scripts/control_robot.py calibrate`
*   **Teleoperace:** `python lerobot/scripts/teleoperate.py` nebo `python lerobot/scripts/control_robot.py teleoperate`
*   **Sběr dat:** `python lerobot/scripts/record.py` nebo `python lerobot/scripts/control_robot.py record`
*   **Přehrávání:** `python lerobot/scripts/replay.py` nebo `python lerobot/scripts/control_robot.py replay`
*   **Trénování:** `python lerobot/scripts/train.py`

---

## 1. Příprava prostředí & Hugging Face přihlášení
Před spuštěním jakýchkoli skriptů se ujistěte, že je aktivní správné Conda/Virtual environment a že jste přihlášeni k Hugging Face Hubu pro nahrávání dat a modelů.

```bash
# 1. Aktivace Conda prostředí (pokud je instalováno přes Conda/Pixi)
conda activate lerobot

# 2. Přihlášení k Hugging Face přes CLI (vyžaduje token s oprávněním WRITE)
huggingface-cli login --token <TVŮJ_WRITE_TOKEN> --add-to-git-credential
```

---

## 2. Detekce USB zařízení a portů desek
Pro bilateral teleoperaci a kamery je nutné přesně identifikovat serial porty a video indexy.

```bash
# Vyhledání sériových portů na Linuxu (typicky Feetech/Dynamixel desky)
ls -l /dev/ttyACM*
# Nebo detailní výpis portů:
python -m serial.tools.list_ports

# Vyhledání připojených kamer (USB Video Class)
v4l2-ctl --list-devices
```

---

## 3. Kalibrace kloubů robotických ramen (`calibrate.py`)
Kalibrace je **kritický první krok**, bez kterého nebudou ramena synchronizovaná a hrozí poškození motorů. Zapisuje min/max rozsahy kloubů do lokálního kalibračního souboru (typicky v `~/.cache/lerobot/`).

```bash
# Základní kalibrace SO-100 Follower ramene
python lerobot/scripts/control_robot.py calibrate \
  --robot.type=so100 \
  --robot.port=/dev/ttyACM0 \
  --robot.id=so100_follower_arm

# Kalibrace SO-100 Leader (řídicího) ramene
python lerobot/scripts/control_robot.py calibrate \
  --robot.type=so100_leader \
  --robot.port=/dev/ttyACM1 \
  --robot.id=so100_leader_arm
```
*   **`--robot.id`**: Unikátní identifikátor. Kalibrační hodnoty se ukládají pod tímto ID a při teleoperaci nebo záznamu se načítají automaticky.
*   **Postup kalibrace:** Skript vás v terminálu provede manuálním nastavením ramen do nulové pozice a maximálních limitů.

---

## 4. Bilaterální Teleoperace (`teleoperate.py`)
Umožňuje ovládat fyzické rameno Follower (svaly) pomocí pasivního ramene Leader (ovladač).

```bash
# Teleoperace SO-100 bilateral (Leader řídí Follower)
python lerobot/scripts/control_robot.py teleoperate \
  --robot.type=so100 \
  --robot.port=/dev/ttyACM0 \
  --robot.id=so100_follower_arm \
  --teleop.type=so100_leader \
  --teleop.port=/dev/ttyACM1 \
  --teleop.id=so100_leader_arm
```
### Klíčové doplňující parametry:
*   **`--control.fps=30`**: Nastavení vzorkovací frekvence smyčky (typicky 30 Hz).
*   **`--robot.max_relative_target=null`**: Vypne relativní bezpečnostní limity pohybu (používejte pouze při zkalibrovaných ramenech).
*   **`--control.display_cameras=true`**: Zobrazí v reálném čase okno s vizualizací všech připojených USB kamer.

---

## 5. Nahrávání Demonstrací / Sběr Dat (`record.py`)
Zaznamenává teleoperované úkoly (pozice motorů, akce kleští a obrazy z kamer) a ukládá je jako dataset kompatibilní s formátem `LeRobotDataset`.

```bash
# Záznam 50 epizod úkolu "pick_cube" lokálně a automatický upload na HF Hub
python lerobot/scripts/control_robot.py record \
  --robot.type=so100 \
  --robot.port=/dev/ttyACM0 \
  --robot.id=so100_follower_arm \
  --teleop.type=so100_leader \
  --teleop.port=/dev/ttyACM1 \
  --teleop.id=so100_leader_arm \
  --control.repo_id=local/so100_pick_cube \
  --control.num_episodes=50 \
  --control.episode_time_s=15 \
  --control.push_to_hub=false \
  --control.fps=30
```
### Důležité parametry pro sběr:
*   **`--control.repo_id`**: Identifikátor datasetu. Pokud chcete nahrát na HF Hub, zadejte `uzivatel/nazev_datasetu`. Pro lokální testování uložte jako `local/nazev`.
*   **`--control.episode_time_s`**: Maximální délka jedné epizody (např. 15 sekund). Po tomto čase se epizoda automaticky uloží.
*   **`--control.push_to_hub=true`**: Po úspěšném nahrání všech epizod odešle dataset na Hugging Face.

### Klávesové zkratky při záznamu (vyžadují focus na terminál):
*   **Šipka Vpravo (`→`)**: Předčasně ukončí aktuální epizodu a uloží ji (např. pokud robot splnil úkol dříve než za 15s). Přesune vás do stavu "Reset", kde připravíte scénu. Dalším stiskem šipky vpravo spustíte nahrávání další epizody.
*   **Šipka Vlevo (`←`)**: Zahodí právě nahrávanou nebo dokončenou epizodu a umožní ji natočit znovu (skvělé pro vymazání nepovedených pokusů).
*   **Escape (`ESC`)**: Ukončí nahrávání celého procesu, provede kompilaci a uloží dosavadní úspěšné epizody.

---

## 6. Trénování Modelů Politik (`train.py`)
Spouští robustní trénování politik napodobování (imitation learning) na základě nahraných demonstrací.

```bash
# Trénování Diffusion Policy na lokálním GPU (CUDA)
python lerobot/scripts/train.py \
  --dataset.repo_id=local/so100_pick_cube \
  --policy.type=diffusion \
  --device=cuda \
  --output_dir=outputs/training/so100_pick_cube_diffusion \
  --train.epochs=100 \
  --wandb.enable=false
```

### 🧠 Podporované architektury politik v LeRobot:

| Politika | Popis a výhody | Kdy ji použít |
| :--- | :--- | :--- |
| **ACT** *(Action Chunking with Transformers)* | Používá VAE a Transformer k předvídání sekvencí akcí v blocích. Velmi rychlá odezva, přesná na složité motorické trajektorie. | Jemná manipulace, skládání objektů, rychlé reakce na scénu. |
| **Diffusion Policy** | Modeluje generování akcí jako proces odšumování (podobně jako Stable Diffusion). Velmi robustní vůči šumu v datech a chybám operátora. | Úkoly s multimodálním chováním (více způsobů jak splnit cíl), robustní úkoly v proměnlivém prostředí. |
| **VQ-BeT** *(Vector Quantized Behavior Transformer)* | Využívá diskretizované shluky akcí. Dobrá pro dlouhodobé plánování a kombinaci různých typů chování. | Dlouhé úkoly (long-horizon) rozdělené na více diskrétních kroků. |

### Klíčové parametry trénování:
*   **`--device`**: `cuda` (NVIDIA GPU), `mps` (Apple Silicon M1/M2/M3) nebo `cpu`.
*   **`--wandb.enable=true`**: Povolí vizualizaci trénovacích grafů (Loss, Learning Rate, atd.) v reálném čase ve vašem Weights & Biases dashboardu.
*   **`--output_dir`**: Umístění, kam se budou průběžně ukládat checkpointy politiky.

---

## 7. Evaluace a Nasazení Politik (`control_robot.py evaluate`)
Spustí natrénovaný model (Worker) na fyzickém robotu a nechá ho autonomně plnit úkoly za pomoci kamer.

```bash
# Autonomní nasazení natrénované Diffusion Policy na fyzické rameno SO-100
python lerobot/scripts/control_robot.py evaluate \
  --robot.type=so100 \
  --robot.port=/dev/ttyACM0 \
  --robot.id=so100_follower_arm \
  --control.fps=30 \
  --control.policy_path=outputs/training/so100_pick_cube_diffusion/checkpoints/last/policy.pth
```
*   **`--control.policy_path`**: Cesta k souboru natrénovaného checkpointu politiky.
*   **Fungování v naší architektuře:** Orchiday OS spouští tento příkaz autonomně na pozadí, jakmile **VLM Inspektor (Manager)** a **LLM Planner (CEO)** uvolní signál k vykonání motorické dovednosti.

---

## 8. Užitečné Utility
LeRobot obsahuje skvělé pomocné CLI nástroje pro správu a vizualizaci.

```bash
# 1. Lokální vizualizace nahraného datasetu v prohlížeči (Rerun vizualizér)
python lerobot/scripts/visualize_dataset.py \
  --repo_id=local/so100_pick_cube \
  --episode_index=0

# 2. Výpis informací o uloženém datasetu
python -c "from lerobot.common.datasets.lerobot_dataset import LeRobotDataset; dataset = LeRobotDataset('local/so100_pick_cube'); print(dataset)"
```

---

## 9. Prevence chyb & Odstraňování Problémů (Troubleshooting)

Při práci s reálným hardwarem a knihovnou LeRobot dochází k typickým chybám. Zde je přehled jejich řešení pro hladkou integraci:

### ⚠️ A. Chyby s oprávněním sériového portu (udev & dialout)
*   **Projev:** `PermissionError: [Errno 13] Permission denied: '/dev/ttyACM0'` při spuštění kalibrace nebo teleoperace.
*   **Důvod:** Váš uživatelský účet nemá práva pro přímé čtení/zápis na USB sériová zařízení.
*   **Řešení:** Přidejte svého uživatele do skupiny `dialout` a restartujte počítač/odhlaste se:
    ```bash
    sudo usermod -aG dialout $USER
    # Následně se odhlaste a přihlaste, nebo zadejte:
    newgrp dialout
    ```

### ⚠️ B. Přetížení šířky pásma USB kamer (Multi-Camera Bandwidth Error)
*   **Projev:** Zobrazení chyby V4L2 `No space left on device` při pokusu o spuštění nahrávání se 2 a více kamerami.
*   **Důvod:** Kamery používají nekomprimovaný formát YUYV s obrovským tokem dat, což zahltí USB 2.0 sběrnici (řadič).
*   **Prevence a Řešení:**
    1.  Přepněte kodek na MJPEG (komprimované snímky): Přidejte argument `--dataset.vcodec=mjpeg` nebo `--dataset.vcodec=mp4` (podle verze LeRobot).
    2.  Snížte rozlišení kamer na `640x480` a frekvenci na `30` FPS.
    3.  **Fyzické řešení:** Nezapojujte kamery do stejného USB hubu. Připojte každou kameru do jiného fyzického USB řadiče na počítači (např. jednu do modrého portu USB 3.0 vzadu a druhou do portu USB 2.0 vpředu).

### ⚠️ C. Problémy s načítáním Kalibrace (Position Drifts / Calibration Missing)
*   **Projev:** Skript vás neustále nutí provádět kalibraci znovu, i když jste ji již dokončili.
*   **Důvod:** Použili jste jiný parametr `--robot.id` nebo `--teleop.id` při záznamu než při kalibraci. LeRobot vyhledává kalibrační JSON soubory striktně podle těchto ID!
*   **Umístění kalibračních JSON souborů na disku:**
    *   **Roboti:** `~/.cache/huggingface/lerobot/calibration/robots/<robot_type>/<robot_id>.json`
    *   **Teleoperátory:** `~/.cache/huggingface/lerobot/calibration/teleoperators/<teleop_type>/<teleop_id>.json`
*   **Řešení:** 
    1.  Ujistěte se, že ID parametru je v příkazech naprosto shodné (např. `so100_follower_arm`).
    2.  Pokud potřebujete kalibrovat robota zcela od nuly, vymažte odpovídající JSON soubor v cache a spusťte kalibraci znovu.

### ⚠️ D. Chyba točivého momentu motorů (Torque Overload Shutdown)
*   **Projev:** Rameno náhle povolí, motory zhasnou a skript spadne s chybou komunikace.
*   **Důvod:** Motor detekoval příliš velký fyzický odpor (přetížení/překážka), aktivoval ochranný limit točivého momentu (Torque Limit) a odpojil se, aby se nespálil.
*   **Řešení:** 
    1.  Uvolněte rameno a odstraňte překážky.
    2.  Fyzicky odpojte a znovu připojte napájení robota (USB/Power Jack).
    3.  Restartujte ovládací skript LeRobot.

### ⚠️ E. Selhání WandB (Weights & Biases API Key Missing)
*   **Projev:** Spustíte trénování politiky s `--wandb.enable=true` a Python okamžitě spadne s chybou authentikace.
*   **Řešení:** Před spuštěním trénování se přihlaste k WandB v terminálu:
    ```bash
    wandb login
    # Vložte svůj API klíč z webu wandb.ai
    ```

