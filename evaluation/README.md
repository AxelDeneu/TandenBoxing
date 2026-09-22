# Banc d’évaluation du générateur

Ce dossier contient un banc reproductible et entièrement hors ligne par défaut. Son corpus
`synthetic-generator-corpus/v1` regroupe 28 contextes inventés : débutants sans historique,
fatigue, séances sautées, contraintes physiques génériques, focus négligés, demandes
explicites et deux séquences de progression.

Le corpus ne lit jamais `data/tanden.db`, ne consulte aucune variable secrète et ne charge
pas le client Anthropic. Les sorties de référence sont elles aussi synthétiques et figées.

## Exécution locale

```bash
npm run eval:generator
```

La commande affiche un résumé et écrit le rapport stable dans
`evaluation/output/report.json`. Elle utilise par défaut la politique active
`shared/session-policy.ts` et termine avec un code non nul si un seuil bloquant échoue.
Le dossier `evaluation/output/` est ignoré par Git.

Un candidat est un module TypeScript ou JavaScript qui exporte `candidateRun` (ou un export
par défaut) conforme à `CandidateRun`. Il contient une sortie `WorkoutSession` par cas et les
versions du planner, de la politique, du prompt et du contrat de sortie.

```bash
npm run eval:generator -- --candidate ./chemin/candidate.ts
```

Pour comparer un avant et un après avec exactement le même corpus :

```bash
npm run eval:generator -- \
  --compare ./chemin/avant.ts \
  --candidate ./chemin/apres.ts \
  --output ./evaluation/output/avant-apres.json
```

## Métriques et seuils

Le rapport expose chaque résultat par cas puis les agrégats suivants :

- violations structurées de la politique de #1 et taux de conformité obligatoire ;
- erreur signée/absolue de durée et dépassement ;
- fidélité à la catégorie et au focus attendus par le scénario ;
- Jaccard des noms d’exercices, séparé entre corps principal et
  échauffement/retour au calme, pour les cas consécutifs d’une séquence ;
- ratio de types de blocs distincts et nombre de patrons de blocs ;
- prérequis de combos, complexité maximale et allègement après fatigue.

Les seuils bloquants initiaux sont volontairement stricts : 100 % des cas doivent être
évalués sans violation obligatoire et aucun cas ne peut dépasser sa durée cible. Une
politique absente est un échec, pas un succès silencieux.

## Politique de validation

Le banc ne recopie aucune règle métier. `evaluation/adapters/session-policy.ts` appelle
directement `validateSessionPolicy` et convertit uniquement ses violations au format du rapport.
La version `session-policy/v2` est partagée avec les versions persistées dans
`generationContext`. Un autre adaptateur compatible peut être sélectionné explicitement :

```bash
npm run eval:generator -- --policy ./chemin/autre-policy.ts
```

Les versions du planner, de la politique, du prompt et du contrat de sortie sont définies dans
`shared/generator-version.ts`, persistées dans `generationContext` et reprises dans chaque rapport.

## Évaluation IA optionnelle

La CI et la commande par défaut n’exécutent aucune évaluation payante. Une telle évaluation
nécessite deux options simultanées : un module explicitement choisi et un budget positif.

```bash
npm run eval:generator -- \
  --ai-adapter ./chemin/ai-evaluator.ts \
  --ai-budget-usd 0.50
```

Le module exporte `aiEvaluationAdapter` conforme à `AiEvaluationAdapter`. Le runner refuse
une activation sans budget et rejette un coût déclaré supérieur au plafond.
