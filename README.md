# 🥊 Tanden Boxing

Coach de boxe à domicile. Chaque matin, l'IA (Claude Opus 4.8) prépare ta séance de sac de
frappe du jour en fonction de ton historique et de tes ressentis. Explications détaillées,
timer à intervalles avec audio, et suivi de progression.

## Fonctionnalités

- **Séance quotidienne générée par IA** à 7h (cron interne), adaptée à ta progression.
- **Génération durable** : jobs SQLite idempotents, reprise après redémarrage, retries bornés,
  réutilisation validée, préparation anticipée et fallback local déterministe.
- **Évaluation versionnée** : garde-fou déterministe en CI, campagnes fournisseur réelles budgétées
  et télémétrie agrégée sans texte libre sensible.
- **Structure complète** : échauffement → technique (combos numérotés) → cardio → retour au calme.
- **Timer à intervalles** plein écran : bips + cloche de round, anneau de progression, hors-ligne.
- **Feedback détaillé** par exercice → l'IA ajuste les séances suivantes.
- **Préférences apprises** : avis, remplacements et retraits pondèrent les choix futurs ; les
  motifs de douleur, d'impossibilité ou de matériel créent des exclusions strictes modifiables.
- **Autorégulation déterministe** : check-in facultatif avant le chrono, puis commandes
  `trop difficile`, `trop facile` et `douleur` qui n'adaptent que la partie restante.
- **Suivi** : historique, séries, temps cumulé, courbes de difficulté/énergie, poids.
- **Parcours technique** : compétences acquises, à consolider, éligibles ou bloquées, avec ciblage
  pédagogique de la prochaine séance sous contrôle du planner.
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

| Script                        | Rôle                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| `npm run dev`                 | Serveur de développement                                      |
| `npm run build`               | Build de production (`.output`)                               |
| `npm run db:generate`         | Génère une migration depuis le schéma Drizzle                 |
| `npm run db:migrate`          | Applique les migrations                                       |
| `npm run db:studio`           | Explorateur de base Drizzle                                   |
| `npm run icons`               | Régénère les icônes PWA depuis `public/icon.svg`              |
| `npm run eval:generator`      | Évalue hors ligne le générateur sur le corpus synthétique     |
| `npm run eval:generator:real` | Compare manuellement un fournisseur réel sous budgets stricts |

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

## Prescription des séances

Avant tout appel IA, un planner pur fixe la catégorie, le focus, l'intensité, la durée et le
budget de chaque type de bloc. Le modèle choisit ensuite uniquement les exercices compatibles.
Les profils déterministes sont les suivants :

| Catégorie     | Intensité | Échauffement | Technique | Cardio | Renforcement | Retour au calme |
| ------------- | --------- | ------------ | --------- | ------ | ------------ | --------------- |
| apprentissage | 2/5       | 15 %         | 55 %      | 10 %   | 5 %          | 15 %            |
| renforcement  | 3/5       | 15 %         | 35 %      | 15 %   | 20 %         | 15 %            |
| enchainement  | 4/5       | 12 %         | 50 %      | 23 %   | 5 %          | 10 %            |
| cardio        | 5/5       | 12 %         | 15 %      | 58 %   | 5 %          | 10 %            |
| recuperation  | 1/5       | 30 %         | 25 %      | 0 %    | 0 %          | 45 %            |

La somme des budgets en secondes est toujours égale à la durée cible. La fatigue, une reprise
après interruption ou une contrainte explicite réduisent l'intensité et interdisent les nouvelles
techniques, sans écraser les choix explicites de catégorie, focus ou durée.

Le fonctionnement de la file persistante, des clés de contexte, de la réutilisation, du fallback et
des métriques est détaillé dans [docs/generation-durable.md](./docs/generation-durable.md).
Le protocole de comparaison réelle et la boucle de télémétrie sont détaillés dans
[docs/evaluation-reelle.md](./docs/evaluation-reelle.md).

Avant le démarrage, le check-in structure le temps disponible, l'énergie, les courbatures, une
éventuelle douleur localisée et l'intention du jour. Les règles versionnées recalculent localement
durée, intensité, repos, volume, complexité et mouvements autorisés. Pendant l'effort, le curseur
du timer protège les exercices terminés ; une douleur arrête le mouvement courant, exclut sa
famille via le journal de préférences et affiche une consigne de prudence sans diagnostic.

## Déploiement

Voir [DEPLOY.md](./DEPLOY.md) (Dokploy / Docker).

## Progression technique

Le curriculum débutant, les règles de maîtrise et la stratégie de reprise de l'historique sont
documentés dans [docs/skill-mastery.md](./docs/skill-mastery.md).

---

_Ceci est un outil de remise en forme, pas un substitut à un coach ou à un avis médical.
Échauffe-toi, respecte tes limites._
