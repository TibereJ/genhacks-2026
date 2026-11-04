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
- `tsx`, `typescript`, `vitest` — exécution, typage, tests

## Références
- WCAG 2.2 (W3C) — critères cités dans les rapports
