# Sécurité des dépendances

Le lockfile npm est la source canonique des versions installées par la CI et l'image Docker.
Après toute modification de dépendance, régénérer `package-lock.json` avec la version de Node
déclarée par le projet, puis exécuter :

```bash
npm ci
npm run audit:prod
```

`npm run audit:prod` contrôle le graphe livré avec
`npm audit --package-lock-only --omit=dev`. La CI bloque tout avis de sévérité haute ou critique
qui ne possède pas d'exception temporaire valide. Les avis faibles ou modérés restent visibles
dans le résumé et doivent être corrigés lors des mises à jour ordinaires.

## Exception temporaire

Une exception est un dernier recours lorsqu'aucune version corrigée compatible n'est disponible.
Elle doit être ajoutée dans `security/audit-exceptions.json` par une pull request dédiée et
contenir :

- `advisory` : identifiant GHSA indiqué par `npm audit` ;
- `package` : paquet exact concerné ;
- `justification` : risque accepté et mesures compensatoires ;
- `owner` : personne responsable du suivi, sous forme de handle GitHub ;
- `expires` : date d'expiration ISO `YYYY-MM-DD`, au maximum 30 jours après l'ajout.

Exemple :

```json
{
  "advisory": "GHSA-xxxx-yyyy-zzzz",
  "package": "example-package",
  "justification": "Aucun correctif compatible ; entrée non contrôlée désactivée en production.",
  "owner": "@maintainer",
  "expires": "2026-10-15"
}
```

La pull request doit référencer un ticket de remédiation et recevoir une revue du mainteneur.
Le contrôle refuse automatiquement une exception expirée, dupliquée ou devenue obsolète. Une
prolongation nécessite une nouvelle justification et une nouvelle revue ; elle ne doit jamais
abaisser le seuil global de l'audit.

## Cadence de mise à jour

Dependabot vérifie chaque semaine les dépendances npm de production et de développement. Chaque
pull request de mise à jour passe par la validation complète et l'audit de production avant
fusion.
