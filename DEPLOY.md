# Déploiement — Tanden Boxing (Dokploy)

Application auto-hébergée : **Nuxt 4 + SQLite + cron interne**. Un seul conteneur, un volume
persistant pour la base, une variable d'environnement pour la clé API OpenRouter.

## Variables d'environnement

| Variable                       | Obligatoire | Défaut                      | Rôle                                   |
| ------------------------------ | ----------- | --------------------------- | -------------------------------------- |
| `NUXT_OPENROUTER_API_KEY`      | ✅          | —                           | Clé serveur OpenRouter                 |
| `NUXT_OPENROUTER_HTTP_REFERER` | —           | _(vide)_                    | URL publique déclarée à OpenRouter     |
| `NUXT_OPENROUTER_APP_TITLE`    | —           | `Tanden Boxing`             | Nom déclaré à OpenRouter               |
| `NUXT_OPENROUTER_REQUIRE_ZDR`  | —           | `1`                         | Restreint aux endpoints sans rétention |
| `NUXT_AI_MODEL`                | —           | `anthropic/claude-opus-4.8` | Slug OpenRouter initial                |
| `NUXT_TIMEZONE`                | —           | `Europe/Paris`              | Fuseau du cron 7h et des dates         |
| `NUXT_DATABASE_PATH`           | —           | `/app/data/tanden.db`       | Chemin SQLite (dans le volume)         |
| `NUXT_DISABLE_CRON`            | —           | _(vide)_                    | `1` pour désactiver le cron            |

> La clé API reste strictement côté serveur : elle n'est jamais exposée au navigateur. Le catalogue
> OpenRouter est filtré côté Nitro puis mis en cache 15 minutes. Les requêtes utilisent
> `provider.require_parameters`, `data_collection: deny` et, par défaut, `zdr: true` parce que les
> prompts contiennent des données de profil et d'entraînement.

## Déploiement sur Dokploy

1. **Créer une application** de type _Docker_ (ou _Compose_) pointant sur ce dépôt.
2. **Build** : Dokploy détecte le `Dockerfile` à la racine (rien à configurer).
3. **Variables d'environnement** : ajouter au minimum `NUXT_OPENROUTER_API_KEY`.
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
NUXT_OPENROUTER_API_KEY=sk-or-v1-... docker compose up --build

# App : http://localhost:3000
```

## Sans Docker (serveur Node 24+)

```bash
npm ci
npm run build
NUXT_OPENROUTER_API_KEY=sk-or-v1-... node .output/server/index.mjs
# (les migrations s'appliquent au démarrage)
```
