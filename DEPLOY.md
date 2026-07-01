# Déploiement — Tanden Boxing (Dokploy)

Application auto-hébergée : **Nuxt 4 + SQLite + cron interne**. Un seul conteneur, un volume
persistant pour la base, une variable d'environnement pour la clé API Anthropic.

## Variables d'environnement

| Variable                 | Obligatoire | Défaut                | Rôle                                       |
| ------------------------ | ----------- | --------------------- | ------------------------------------------ |
| `NUXT_ANTHROPIC_API_KEY` | ✅          | —                     | Clé API Anthropic (génération des séances) |
| `NUXT_AI_MODEL`          | —           | `claude-opus-4-8`     | Modèle utilisé                             |
| `NUXT_TIMEZONE`          | —           | `Europe/Paris`        | Fuseau du cron 7h et des dates             |
| `NUXT_DATABASE_PATH`     | —           | `/app/data/tanden.db` | Chemin SQLite (dans le volume)             |
| `NUXT_DISABLE_CRON`      | —           | _(vide)_              | `1` pour désactiver le cron                |

> La clé API reste strictement côté serveur : elle n'est jamais exposée au navigateur.

## Déploiement sur Dokploy

1. **Créer une application** de type _Docker_ (ou _Compose_) pointant sur ce dépôt.
2. **Build** : Dokploy détecte le `Dockerfile` à la racine (rien à configurer).
3. **Variables d'environnement** : ajouter au minimum `NUXT_ANTHROPIC_API_KEY`.
4. **Volume persistant** : monter un volume sur `/app/data` (contient `tanden.db`).
   ⚠️ Indispensable pour ne pas perdre l'historique à chaque redéploiement.
5. **Port** : le conteneur écoute sur `3000`. Laisser Dokploy (Traefik) gérer le domaine + HTTPS.
6. **Healthcheck** : intégré (`GET /api/health`).

### Migrations & données

- Les migrations SQL (`./drizzle`) sont appliquées **automatiquement au démarrage**
  (plugin Nitro `server/plugins/0.database.ts`) — rien à lancer manuellement.
- Le premier démarrage crée la base et les réglages par défaut.

### Cron de génération

- Le serveur tourne en continu : un cron interne (croner) génère la séance du jour à l'heure
  configurée (7h par défaut) les jours d'entraînement.
- Si le conteneur était arrêté à l'heure prévue, la séance est **rattrapée au démarrage** et à
  l'ouverture de l'appli.

## Test en local (Docker)

```bash
# Construire et lancer
NUXT_ANTHROPIC_API_KEY=sk-ant-... docker compose up --build

# App : http://localhost:3000
```

## Sans Docker (serveur Node 24+)

```bash
npm ci
npm run build
NUXT_ANTHROPIC_API_KEY=sk-ant-... node .output/server/index.mjs
# (les migrations s'appliquent au démarrage)
```
