# Prompt pro hodinovou cloudovou smyčku

Text níže (sekce „Prompt") se vkládá do pole **Instructions** ve scheduled tasku.

## Nastavení prostředí

| Položka | Hodnota |
|---|---|
| Repozitář | `Verlyba/Orchidae` |
| Setup skript | `bash scripts/setup-dev.sh` |
| Ověřovací brána | `bash scripts/verify.sh` |
| Trigger | Hourly |
| Model | Opus 5 |

**Co cloud ověřit umí:** TypeScript build, pytest, i18n paritu, duplicitní ID,
mrtvé `App.*` odkazy z HTML, syntaxi Pythonu.

**Co cloud ověřit NEUMÍ:** cokoliv s reálným hardwarem — kalibraci, teleoperaci,
nahrávání datasetu, kamery. Tyto věci se dají v cloudu pouze *staticky*
zkontrolovat (tvar příkazu, testy), nikdy ne odzkoušet. Prompt to agentovi
explicitně zakazuje tvrdit.

---

## Prompt

```
/loop Pracuj na projektu Orchiday. Jsi v cloudové relaci bez robotického hardwaru.

ZAČÁTEK KAŽDÉHO BĚHU:
1. `git pull --rebase origin main` — vždy začni z nejnovější verze.
2. `bash scripts/setup-dev.sh` (pokud prostředí ještě není připravené).
3. `bash scripts/verify.sh` — zjisti výchozí stav. Pokud už teď něco selhává,
   oprav to jako první, to má přednost před vším ostatním.

CÍL PROJEKTU (nezapomínej na něj, řídí priority):
Orchiday porovnává běžnou ACT policy proti mému orchestračnímu schématu.
Obě větve musí trénovat ze STEJNÝCH nasbíraných dat: během sběru se epizoda
značkuje klávesami na hranice pod-úkolů, a výsledný dataset se pak dá použít
buď celý (ACT baseline), nebo rozdělený na pod-datasety (orchestrace).
LeRobot tohle nativně neumí — je to naše nadstavba a musí fungovat i cizímu
uživateli po čerstvém naklonování.

V TOMTO BĚHU UDĚLEJ PRÁVĚ JEDNU ucelenou věc. Radši jedno pořádně dokončené
a ověřené vylepšení než pět rozdělaných. Vyber ji podle tohoto pořadí priorit:

  A) Cokoliv, co je rozbité / nefunkční (má přednost vždy).
  B) Správná funkce přes LeRobot — než něco změníš, ZJISTI si ze zdrojáků
     LeRobotu, jak se daný příkaz opravdu chová: jaké má argumenty, co vypisuje
     do terminálu, na jaké klávesy reaguje a čím se ovládá (např. record má
     exit_early / rerecord_episode / stop_recording; kalibrace se ptá na ENTER
     vs 'c'). UI musí odpovídat skutečnosti, ne domněnce.
  C) Synchronizace dat — načtení projektu, provázání stavů, kalibrační soubory
     použité pro teleop a sběr dat, cesty a repo_id podle struktury LeRobotu.
  D) Frontend a UX (viz pravidla níže).
  E) Robustnost backendu a optimalizace.

PRAVIDLA FRONTENDU — zkontroluj je NA ZAČÁTKU i NA KONCI každého běhu:
- Jednotný styl napříč všemi stránkami, okny, wizardy i pop-upy. Technický,
  plochý vzhled: ostré rohy, ohraničení, tlumené výplně. Žádný blur, glow,
  stíny, přehnané barvy ani dekorativní emoji.
- Každé okno musí smysluplně vyplnit svou plochu. Když je obsahu málo, vyplň
  ji rozvržením, odsazením, grafickým prvkem nebo animací — NIKDY roztažením
  polí, menu nebo tlačítek do nesmyslných rozměrů. To je hlavní věc, kterou
  na současném stavu nechci.
- Tlačítka patří dovnitř okna k obsahu, kterého se týkají, ne do horní lišty
  stránky. Popisky musí být technicky přesné (co to opravdu udělá).
- Zamysli se, jak se rozvržení řeší v reálné praxi: kam patří primární akce,
  jak se okna chovají při změně velikosti, responzivita, chování menu a
  pop-upů. Navrhuj jako profesionální technický nástroj.
- Žádné duplicitní prvky. `scripts/verify.sh` hlídá duplicitní ID a mrtvé
  odkazy — když projde, ještě se sám podívej na duplicitní obsah a logiku.
- Akce, které trvají déle (start procesu, načítání datasetu, instalace),
  musí mít viditelný indikátor průběhu.

DALŠÍ TRVALÉ POŽADAVKY:
- Aplikace musí fungovat na Linuxu, Windows i macOS. Nikdy nepiš cestu ani
  příkaz závislý na jedné platformě bez fallbacku.
- Uživatel musí mít možnost si vše doinstalovat z aplikace (LeRobot, conda…)
  a aplikace si to musí zapamatovat.

OVĚŘENÍ (povinné, bez výjimky):
- Po změnách spusť `bash scripts/verify.sh`. Musí projít celé.
- Když měníš web/, zvedni `?v=X.Y.Z` u assetů v index.html, jinak prohlížeč
  servíruje starý JS/CSS.
- NIKDY netvrď, že jsi ověřil hardwarové chování (kalibrace, teleop, sběr dat,
  kamery). V cloudu to nejde. Napiš explicitně, co zbývá vyzkoušet na fyzickém
  robotu.

KONEC KAŽDÉHO BĚHU:
1. `bash scripts/verify.sh` musí projít.
2. Commitni s popisným českým/anglickým shrnutím CO a PROČ.
3. `git push origin main`.
4. V odpovědi napiš: co jsi změnil, co to řeší, co jsi ověřil a co zbývá
   otestovat na reálném hardwaru.

Když narazíš na něco rozbitého mimo rozsah dnešní změny, oprav to jen pokud
to je malé; jinak to popiš v odpovědi, ať se to neztratí.
```
