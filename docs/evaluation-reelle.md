# Évaluation réelle du générateur

## Deux barrières distinctes

`npm run eval:generator` reste le garde-fou de pull request : 28 sorties figées, aucune clé,
aucun réseau, aucun coût et un résultat déterministe bloquant dans `.github/workflows/ci.yml`.

`npm run eval:generator:real` appelle explicitement un fournisseur sur le même corpus synthétique
versionné. Cette commande est uniquement manuelle ou planifiée hors CI de pull request. Elle ne
s'active jamais implicitement et ne fait aucun appel tant que tous ses budgets et sa baseline ne
sont pas valides.

## Protocole

1. Sélectionner une baseline archivée ou un modèle baseline à exécuter dans le même run.
2. Choisir les scénarios. Sans `--case`, les 28 scénarios sont évalués ; la commande ne tronque
   jamais silencieusement le corpus pour rentrer dans un budget. Un cas appartenant à une séquence
   exige que tous ses prédécesseurs soient sélectionnés, afin de ne pas fausser la progression.
3. Fixer répétitions, seed et température. L'adaptateur Anthropic applique la température, mais
   déclare honnêtement que l'API ne supporte pas la seed. Chaque échantillon archive la valeur
   demandée et si elle a réellement été appliquée.
4. Fixer les six plafonds obligatoires : cas, appels, total de tokens, coût, durée murale et tokens
   de sortie par appel. Des bornes dures empêchent aussi une faute de frappe de lancer une campagne
   démesurée.
5. Le préflight calcule le nombre exact d'appels et une majoration conservatrice des tokens et du
   coût. Il échoue avant le premier appel si le plan maximal ne tient pas. Les consommations réelles
   sont à nouveau contrôlées après chaque réponse ; aucun retry SDK n'est autorisé.
6. Le rapport JSON archive chaque sortie synthétique, les usages et toutes les métriques. Le rapport
   Markdown synthétise baseline, candidat, moyennes, variances et alertes par scénario.

Exemple avec une baseline déjà archivée :

```bash
npm run eval:generator:real -- \
  --candidate-model claude-opus-4-8 \
  --candidate-id prompt-v5-opus \
  --baseline-report ./evaluation/output/real/baseline/report.json \
  --repetitions 3 \
  --seed 20260924 \
  --temperature 0.2 \
  --max-cases 28 \
  --max-calls 84 \
  --max-total-tokens 3000000 \
  --max-output-tokens 12000 \
  --max-cost-usd 75 \
  --max-duration-ms 1800000 \
  --output-dir ./evaluation/output/real/prompt-v5-opus
```

Pour construire la première baseline, remplacer `--baseline-report` par `--baseline-model`; le
budget doit alors couvrir baseline et candidat. `--provider-adapter` accepte un double local pour
les tests. Le fournisseur par défaut lit seulement `NUXT_ANTHROPIC_API_KEY`; la clé n'entre jamais
dans les rapports.

## Provenance et archives

Chaque rapport identifie :

- l'identifiant demandé et celui résolu du modèle pour chaque réponse ;
- les versions du planner, du prompt, de la politique, de la prescription, du schéma de sortie,
  des préférences et de l'autorégulation ;
- la version du corpus, les identifiants de cas sélectionnés et son SHA-256 ;
- les SHA-256 du prompt système et de toutes les prescriptions synthétiques ;
- le commit Git, l'état propre ou modifié du code et la version des seuils.

`evaluation/output/` reste ignoré par Git parce que les réponses fournisseur sont des artefacts
d'exécution. Pour conserver une campagne, publier ensemble `report.json` et `report.md` dans le
stockage d'artefacts privé de l'équipe, sous le commit indiqué par le rapport. Ne jamais y ajouter
de corpus issu de production.

## Comparaison et statistiques

Les métriques sont comparées comme `candidat - baseline`, globalement et pour chaque scénario :
validité structurelle, conformité de politique, violations, erreur/dépassement de durée, fidélité
catégorie et focus, chevauchement des exercices, diversité des blocs, cohérence de progression,
latence, tokens et coût. Avec au moins deux répétitions, la variance d'échantillon est calculée avec
le dénominateur `n - 1`; avec une seule génération elle vaut `null`, pas zéro.

Les règles `real-evaluation-thresholds/v1` de `evaluation/real/thresholds.ts` sont des alertes de
non-régression séparées des seuils déterministes. Par défaut une alerte reste visible sans prétendre
être une preuve statistique. `--fail-on-alert` permet à une campagne planifiée dédiée de sortir avec
le code 1, mais ce mode n'est pas branché sur les pull requests.

## Télémétrie de résultats réels

`GET /api/evaluation/telemetry?from=YYYY-MM-DD&to=YYYY-MM-DD` agrège les signaux par modèle et par
ensemble de versions. La fenêtre par défaut couvre les trente dates de séance se terminant
aujourd'hui dans le fuseau configuré. `minimumGroupSize` vaut 3 et ne peut pas être inférieur : les
petits groupes sont comptés comme supprimés, sans ligne individuelle.

Le service réutilise les métriques durables de #15 (latence, tokens/coût et job terminal), puis les
relie aux feedbacks, préférences et adaptations structurés. Il ne renvoie ni commentaire, ni note,
ni contrainte, ni nom d'exercice, ni identifiant de séance.

| Métrique                            | Définition                                                     | Unité         | Agrégation    | Propriétaire                     |
| ----------------------------------- | -------------------------------------------------------------- | ------------- | ------------- | -------------------------------- |
| `policyComplianceRate`              | sorties persistées sans violation bloquante                    | ratio         | taux          | `maintainer:generation-quality`  |
| `automaticCorrectionsPerGeneration` | appels modèle supplémentaires dus à la correction de politique | compte/séance | moyenne       | `maintainer:generation-quality`  |
| `plannedDurationSecondsMean`        | durée cible                                                    | secondes      | moyenne       | `maintainer:coaching-experience` |
| `actualDurationSecondsMean`         | durée exécutée mesurée                                         | secondes      | moyenne       | `maintainer:coaching-experience` |
| `durationAbsoluteErrorSecondsMean`  | écart absolu cible/réel                                        | secondes      | moyenne       | `maintainer:generation-quality`  |
| `completionRate`                    | séances terminées / séances de la fenêtre                      | ratio         | taux          | `maintainer:coaching-experience` |
| `skippedBlocksPerCompletedSession`  | blocs distincts avec effort ignoré                             | compte/séance | moyenne       | `maintainer:coaching-experience` |
| `plannedDifficultyMean`             | intensité prescrite                                            | score 1–5     | moyenne       | `maintainer:generation-quality`  |
| `feltDifficultyMean`                | difficulté ressentie                                           | score 1–5     | moyenne       | `maintainer:coaching-experience` |
| `enjoymentMean`                     | plaisir/motivation                                             | score 1–5     | moyenne       | `maintainer:coaching-experience` |
| `replacementsPerSession`            | remplacements structurés                                       | compte/séance | moyenne       | `maintainer:coaching-experience` |
| `adaptationsPerSession`             | adaptations avant/pendant effort                               | compte/séance | moyenne       | `maintainer:coaching-experience` |
| `providerLatencyMillisecondsMean`   | latence fournisseur cumulée du job                             | millisecondes | moyenne       | `maintainer:ai-operations`       |
| `estimatedCostUsdMean` / `Total`    | estimation selon le barème versionné dans le code              | USD           | moyenne/somme | `maintainer:ai-operations`       |

La fenêtre de toutes ces métriques est `[from, to]` incluse et repose sur `session_date`. Les
définitions exécutables, unités, agrégations et propriétaires vivent dans
`shared/evaluation-telemetry.ts` afin que l'API et la documentation restent vérifiables.

## Limites statistiques

- Le corpus est synthétique : il teste des comportements attendus, pas la représentativité des
  pratiquants ni l'efficacité sportive.
- Quelques répétitions donnent une variance descriptive très incertaine. Elles ne constituent ni
  intervalle de confiance fiable, ni test d'hypothèse, ni preuve de non-infériorité.
- Les sorties d'un fournisseur peuvent dériver sans changement d'identifiant de modèle. Le commit,
  la date, les paramètres et l'identifiant résolu sont donc indispensables à l'interprétation.
- Les cas d'une séquence et les répétitions peuvent être corrélés ; les moyennes ne sont pas des
  observations indépendantes.
- Les résultats de production sont observationnels. Feedback manquant, abandon et auto-sélection
  créent des biais ; aucune corrélation hors ligne/terrain ne prouve une causalité.
- Les coûts sont des estimations fondées sur `shared/ai-pricing.ts`, pas une facture. Un modèle sans
  tarif connu est refusé au préflight plutôt que chiffré arbitrairement.

## Mise à jour du corpus

Le propriétaire `maintainer:generation-quality` valide toute modification. Ajouter uniquement un
profil inventé, documenter le comportement visé, maintenir des identifiants stables, mettre à jour
la sortie synthétique déterministe et les tests, puis incrémenter `synthetic-generator-corpus/vN`.
Une nouvelle version de corpus invalide les comparaisons directes : produire une nouvelle baseline
sur exactement les mêmes cas avant d'évaluer un candidat. Aucune donnée personnelle ou texte libre
de production ne doit être copié, même anonymisé, dans les fixtures.
