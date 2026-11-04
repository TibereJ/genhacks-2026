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
- Web Speech API (navigateur) — bouton « Listen » qui lit le transcript à voix haute, en surlignant la ligne en cours (événements `start` des énoncés)
- `tsx`, `typescript`, `vitest` — exécution, typage, tests
- `zod` sert aussi à valider `blindspot.config.json` (mode CI)

## Polices (auto-hébergées dans `report-ui/fonts/`, licence SIL Open Font License 1.1)
- **Atkinson Hyperlegible Next** (Braille Institute of America / Applied Design Works, The Atkinson Hyperlegible Next Project Authors) — texte de l'interface et titres ; police conçue pour les lecteurs malvoyants (lettres toujours distinctes : I/l/1, O/0…)
- **Atkinson Hyperlegible Mono** (Braille Institute, The Atkinson Hyperlegible Mono Project Authors) — transcripts, rôles annoncés (« heading level 1 »), scores, code des correctifs
- Fichiers `.woff2` (sous-ensemble latin ; Next 400, 400 italique, 600, 700 ; Mono 400, 700 ; ~72 Ko au total) copiés depuis les paquets npm Fontsource (`@fontsource/atkinson-hyperlegible-next`, `@fontsource/atkinson-hyperlegible-mono`, v5.3.0) récupérés avec `npm pack` ; textes de licence à côté (`OFL-*.txt`)
- (Remplacent Instrument Serif, IBM Plex Sans et IBM Plex Mono, utilisées par la version précédente de l'interface.)

## Images
- `report-ui/img/clinic-booking-form.png` — capture d'écran recadrée d'une vraie exécution (`examples/reports/20261104164439-947unj/step-4.png`), utilisée dans la démo « Screen on / Screen off » de l'accueil ; recadrée avec **Pillow** (Python)

## CI et déploiement
- **GitHub Actions** — `.github/workflows/blindspot.yml` : tests + parcours d'accessibilité à chaque push/PR ; actions officielles `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`
- **GitHub Pages** — démo en ligne en lecture seule (https://tiberej.github.io/genhacks-2026/), construite par `src/build-static.ts` et déployée par `.github/workflows/pages.yml` ; actions officielles `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`
- **Docker** — `Dockerfile` pour déployer le serveur dans un conteneur
- **Image Docker officielle Playwright** (`mcr.microsoft.com/playwright:v1.63.0-noble`, Microsoft) — Node + Chromium et ses dépendances système

## Références
- WCAG 2.2 (W3C) — critères cités dans les rapports
