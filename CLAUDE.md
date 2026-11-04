# Instructions pour Claude — projet GenHacks

Langue de travail avec l'utilisateur : français. Code, commits et page Devpost : anglais.

## L'équipe d'agents

La session principale joue le rôle de **chef de projet** : elle découpe le travail, délègue aux agents
ci-dessous et intègre leurs résultats. Définitions dans `.claude/agents/`.

| Agent | Rôle | Quand l'appeler |
|---|---|---|
| `idea-scout` | Recherche et évalue des idées face aux critères de jugement | Phase idéation, ou pour vérifier l'originalité d'une feature |
| `builder` | Implémente une feature précise, avec tests | Phase construction ; plusieurs en parallèle sur des features indépendantes (worktrees) |
| `reviewer` | Relit le code : bugs, sécurité (OWASP Top 10), démo qui casse | Avant chaque merge / avant l'enregistrement de la démo |
| `pitch-writer` | Rédige la page Devpost et le script de la vidéo de 3 min | Dès que le MVP tourne, puis à la fin |

## Règles

- Commiter souvent avec des messages clairs : l'historique prouve que le projet a été fait pendant le hackathon.
- Chaque nouvelle lib, API, template ou outil d'IA est ajouté à `docs/TOOLS.md` immédiatement (obligatoire selon les règles).
- Priorité à une démo qui **marche de bout en bout** plutôt qu'à beaucoup de features à moitié finies.
- Pas de secrets (clés API) dans le repo : utiliser `.env` (ignoré par git) et un `.env.example`.
