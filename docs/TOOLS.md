# Outils utilisés

_Obligatoire : tout lister dans la description Devpost (« Built with »)._

## IA
- **Claude Code** (Anthropic) — agents de code IA utilisés pour écrire une partie du projet (chef de projet + agents builder/reviewer)
- **Claude API** (Anthropic, modèle `claude-opus-5-5` par défaut) — le cerveau de l'agent BlindSpot, via tool use

## Langages et runtime
- TypeScript, Node.js 22, HTML/CSS/JavaScript

## Bibliothèques
- `@anthropic-ai/sdk` — SDK officiel de l'API Claude
- `playwright` + Chromium — pilotage du navigateur ; Chrome DevTools Protocol (`Accessibility.getFullAXTree`) pour l'arbre d'accessibilité
- `zod` — validation des entrées des outils de l'agent
- `@modelcontextprotocol/sdk` — serveur MCP (Claude Code ou tout client MCP peut piloter l'agent)
- Web Speech API (navigateur) — bouton « Listen » qui lit le transcript à voix haute
- `tsx`, `typescript`, `vitest` — exécution, typage, tests
- `zod` sert aussi à valider `blindspot.config.json` (mode CI)

## CI et déploiement
- **GitHub Actions** — `.github/workflows/blindspot.yml` : tests + parcours d'accessibilité à chaque push/PR ; actions officielles `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`
- **Docker** — `Dockerfile` pour déployer le serveur dans un conteneur
- **Image Docker officielle Playwright** (`mcr.microsoft.com/playwright:v1.63.0-noble`, Microsoft) — Node + Chromium et ses dépendances système

## Références
- WCAG 2.2 (W3C) — critères cités dans les rapports
