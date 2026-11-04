# Idées — GenHacks 2026 (solo)

Notes /5 : **I**mpact · **T**echnique faisable en solo · **C**réativité · **P**résentation (vidéo)

| # | Idée | Track | I | T | C | P |
|---|---|---|---|---|---|---|
| 1 | BlindSpot — agent qui teste l'accessibilité comme un utilisateur aveugle | AI / Dev Tools | 4 | 4 | 4 | 5 |
| 2 | CoolRoute — itinéraires à pied les plus frais en canicule | Healthcare & Env | 5 | 3 | 4 | 5 |
| 3 | FixFirst — réparer plutôt que jeter | Healthcare & Env | 4 | 4 | 4 | 4 |
| 4 | AgentCanary — piège pour agents de code piratés | Cybersecurity | 4 | 3 | 4 | 3 |
| 5 | PillCheck — vérif. des médicaments d'un proche âgé | Healthcare & Env | 5 | 3 | 2 | 4 |
| 6 | AirCoach — capteur CO₂ de salle de classe | Robotics & IoT | 3 | 4 | 2 | 4 |

---

## 1. BlindSpot — AI, Agentic Systems & Dev Tools
**Problème** : les outils comme Lighthouse/axe vérifient des règles statiques (alt manquant, contraste) mais ne disent pas si un utilisateur de lecteur d'écran peut *réellement* finir une tâche (s'inscrire, payer, réserver).
**Solution** : on donne une URL + une tâche (« réserver un créneau »). Un agent IA navigue le site **uniquement via l'arbre d'accessibilité** (ce qu'entend un lecteur d'écran), sans voir la page. Il produit un rapport : où il a bloqué, pourquoi, correctif suggéré, + replay vidéo du parcours.
**Stack** : Python ou TS, Playwright (arbre d'accessibilité), API Claude pour l'agent, petite UI web pour les rapports.
**Existant** : axe, WAVE, Lighthouse = statique. Agents de test UI existent mais pas centrés lecteur d'écran.
**Risque** : fiabilité de l'agent sur des sites complexes → démo sur 2-3 sites choisis + un site de démo volontairement mal fait.

## 2. CoolRoute — Healthcare & Environmental
**Problème** : en canicule, les personnes âgées et les enfants qui marchent subissent des « îlots de chaleur » ; les GPS optimisent la distance, pas la chaleur.
**Solution** : carte de température de surface (satellite Landsat via NASA Earthdata) + rues OpenStreetMap → calcul de l'itinéraire piéton le plus frais/ombragé. Bonus : carte des rues où planter des arbres en priorité.
**Stack** : Python (OSMnx, rasterio), données Landsat, Leaflet/MapLibre.
**Existant** : projets NASA DEVELOP et un projet « UrbanCool » font la carte de chaleur pour urbanistes ; l'angle **itinéraire pour piétons** est plus rare.
**Risque** : résolution thermique (~30-100 m), traitement de données géo → limiter à une ville.

## 3. FixFirst — Healthcare & Environmental (déchets électroniques)
**Problème** : on jette des appareils réparables faute de savoir quoi faire.
**Solution** : photo + description de la panne → diagnostic IA probable, difficulté, coût estimé, guides iFixit correspondants, repair cafés proches, et CO₂/déchets évités si on répare.
**Stack** : web app mobile, API vision (Claude), API iFixit, OpenStreetMap.
**Risque** : diagnostic approximatif → présenter comme « pistes », s'appuyer sur iFixit.

## 4. AgentCanary — Cybersecurity
**Problème** : un repo piégé (instructions cachées dans README, CLAUDE.md, config MCP) peut pousser un agent de code à voler des secrets.
**Solution** : au lieu de scanner le texte, on **lance l'agent dans un bac à sable avec de faux secrets (canary tokens)** sur le repo suspect et on détecte s'il tente de les lire ou de les envoyer. Rapport : quelle ligne a déclenché quoi.
**Existant** : scanners statiques déjà nombreux (Hardpoint, Ferret, Cisco AI Defense) → l'angle dynamique est la différence, à bien défendre.
**Risque** : technique plus lourde (sandbox, réseau) ; démo moins « grand public ».

## 5. PillCheck — Healthcare & Environmental
Photo des boîtes de médicaments d'un parent âgé → lecture, vérification des interactions (RxNorm/openFDA), planning hebdo imprimable en langage simple.
**Existant** : Medisafe, Drugs.com → peu original. **Risque** : exactitude médicale, responsabilité.

## 6. AirCoach — Robotics & IoT
ESP32 + capteur CO₂ (SCD40, ~30 $) dans une classe → LED « ouvrez la fenêtre », tableau de bord, résumé hebdo IA pour le prof. Simulable sur Wokwi mais moins convaincant.
**Existant** : idée fréquente. Nécessite du matériel.

---

## Écartée
- Scanner de menu pour allergies : déjà fait par Allergy Translate, DishCheck, SafePlate, ScanYum.
