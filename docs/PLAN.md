# Plan — BlindSpot

**Pitch** : Lighthouse vérifie des règles. BlindSpot vérifie si une personne aveugle peut *vraiment* utiliser ton site.
Un agent IA reçoit une tâche (« prends rendez-vous chez le Dr Martin ») et navigue **uniquement avec ce qu'un lecteur
d'écran annonce** (l'arbre d'accessibilité du navigateur), sans jamais voir la page. Il dit où il bloque, pourquoi
(critère WCAG), et comment corriger.

**Track** : AI, Agentic Systems, Cybersecurity, and Dev Tools.

## Architecture

```
navigateur (Playwright/Chromium)
   │  CDP Accessibility.getFullAXTree
   ▼
src/core/ax-tree.ts    arbre d'accessibilité → transcript « lecteur d'écran » numéroté ([12] button "Payer")
src/core/browser.ts    session : ouvrir la page, snapshot, actions (click/type/select/press/back), screenshots pour humains
src/core/scan.ts       contrôles déterministes (bouton sans nom, image sans alt, champ sans label, div cliquable…)
src/core/agent.ts      boucle : snapshot → cerveau → action → résultat, écrit le Report au fil de l'eau
src/core/brains/       claude.ts (API Claude, tool use) · scripted.ts (scénario fixe : tests et démo sans clé API)
src/core/report.ts     écriture reports/<id>/report.json + score
src/server.ts          API HTTP + sert l'UI et le site de démo
src/cli.ts             `npm run blindspot -- <url> "<tâche>"`
report-ui/             UI web statique (lancer un test, suivre en direct, lire le rapport, écouter ce que l'agent entend)
demo-site/bad|fixed/   site de clinique fictif, version inaccessible et version corrigée (avant/après pour la vidéo)
```

### API HTTP (src/server.ts, port 3000 par défaut)

| Route | Rôle |
|---|---|
| `GET /` | `report-ui/index.html` (et fichiers statiques de `report-ui/`) |
| `GET /demo/bad/…`, `GET /demo/fixed/…` | site de démo |
| `GET /api/reports` | liste `{id, url, task, status, score, startedAt}[]`, plus récent d'abord |
| `GET /api/reports/:id` | le `Report` complet (voir `src/core/types.ts`) ; `status: "running"` pendant le test |
| `GET /api/reports/:id/markdown` | le rapport en Markdown (issue GitHub), téléchargé en `blindspot-<id>.md` |
| `GET /reports/:id/:file` | captures d'écran |
| `POST /api/runs` body `{url, task, brain?: "claude" \| "scripted"}` | lance un test, répond `{id}` |

## Étapes

| Semaine | Objectif |
|---|---|
| S1 (4–10 nov.) | Cœur qui marche de bout en bout sur le site de démo : transcript, actions, agent Claude, rapport JSON, UI basique |
| S2 (11–17 nov.) | Contrôles déterministes, score, rapport lisible, mode « écouter » (synthèse vocale), avant/après |
| S3 (18–24 nov.) | Tests sur 3–5 vrais sites, fiabilité de l'agent, export du rapport (Markdown/GitHub issue) |
| S4 (25 nov.–1er déc.) | Bonus : mode CI (GitHub Action qui échoue si la tâche n'est plus faisable), clavier seul |
| S5–S6 (2–15 déc.) | Polish, déploiement (Deployxa ?), relecture sécurité, README |
| S7 (16–25 déc.) | Vidéo de démo, page Devpost, soumission **avant le 25 déc.** (marge d'un jour) |

## Répartition agents

- `builder` A : `demo-site/` (indépendant)
- `builder` B : `report-ui/` (dépend seulement du format `Report` et de l'API ci-dessus)
- chef de projet : `src/core/*`, `src/server.ts`, `src/cli.ts`
- `reviewer` : avant chaque intégration
- `pitch-writer` : une fois le MVP filmable
