# 🥊 Tanden Boxing

Coach de boxe à domicile. Chaque matin, l'IA (Claude Opus 4.8) prépare ta séance de sac de
frappe du jour en fonction de ton historique et de tes ressentis. Explications détaillées,
timer à intervalles avec audio, et suivi de progression.

## Fonctionnalités

- **Séance quotidienne générée par IA** à 7h (cron interne), adaptée à ta progression.
- **Structure complète** : échauffement → technique (combos numérotés) → cardio → retour au calme.
- **Timer à intervalles** plein écran : bips + cloche de round, anneau de progression, hors-ligne.
- **Feedback détaillé** par exercice → l'IA ajuste les séances suivantes.
- **Suivi** : historique, séries, temps cumulé, courbes de difficulté/énergie, poids.
- **PWA installable** sur mobile.

## Stack

|                 |                                              |
| --------------- | -------------------------------------------- |
| Framework       | Nuxt 4 (Vue 3, Nitro) + Nuxt UI              |
| Base de données | SQLite (better-sqlite3) + Drizzle ORM        |
| IA              | `@anthropic-ai/sdk` (sortie structurée, Zod) |
| Cron            | croner (plugin Nitro)                        |
| PWA             | `@vite-pwa/nuxt`                             |
| Graphiques      | Chart.js                                     |

## Démarrage (dev)

```bash
npm install
cp .env.example .env        # puis renseigne NUXT_ANTHROPIC_API_KEY
npm run db:migrate          # crée la base (sinon appliquée au 1er démarrage)
npm run dev                 # http://localhost:3000
```

> Sans clé API, l'appli fonctionne mais ne génère pas de séance (utilise `npm run db:studio`
> ou l'onboarding pour explorer l'UI).

## Scripts utiles

| Script                   | Rôle                                                      |
| ------------------------ | --------------------------------------------------------- |
| `npm run dev`            | Serveur de développement                                  |
| `npm run build`          | Build de production (`.output`)                           |
| `npm run db:generate`    | Génère une migration depuis le schéma Drizzle             |
| `npm run db:migrate`     | Applique les migrations                                   |
| `npm run db:studio`      | Explorateur de base Drizzle                               |
| `npm run icons`          | Régénère les icônes PWA depuis `public/icon.svg`          |
| `npm run eval:generator` | Évalue hors ligne le générateur sur le corpus synthétique |

## Structure

```
app/                 # Front (pages, composants, composables, utils)
server/
  api/               # Endpoints REST
  database/          # Schéma Drizzle + migrations
  plugins/           # Démarrage : migrations + cron
  utils/             # DB, IA, génération, dates, cron
shared/              # Schéma de séance (Zod) partagé client/serveur
drizzle/             # Migrations SQL générées
```

## Déploiement

Voir [DEPLOY.md](./DEPLOY.md) (Dokploy / Docker).

---

_Ceci est un outil de remise en forme, pas un substitut à un coach ou à un avis médical.
Échauffe-toi, respecte tes limites._
