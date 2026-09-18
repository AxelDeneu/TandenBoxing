# Curriculum et maîtrise des compétences

## Source de vérité

Le curriculum débutant est défini dans `shared/curriculum.ts`. Sa version initiale est `1` et
ses identifiants (`posture_garde`, `appuis`, `jab`, etc.) sont stables et persistables. Une
modification du graphe, des prérequis ou du sens d'une compétence doit incrémenter la version ;
un simple changement de libellé n'en a pas besoin.

Chaque séance nouvellement générée conserve `curriculumVersion` et chaque exercice possède un
tableau `skillIds`. Un exercice de cardio, mobilité ou renforcement sans cible technique utilise
un tableau vide. Ces champs ont des valeurs par défaut dans le schéma afin que les JSON de séance
antérieurs restent lisibles.

## Règle de maîtrise v1

Le calcul de `shared/skill-mastery.ts` est pur et rejouable à une date donnée : aucun état dérivé
n'est stocké en base.

- Seules les séances dont le statut est `completed` et dont le feedback n'indique pas
  `completed=false` produisent une exposition.
- Une compétence n'obtient qu'une exposition par séance, même si plusieurs exercices la
  travaillent.
- Difficulté 1 à 3, sans énergie basse : signal positif. Difficulté 4 à 5 ou énergie 1 à 2 :
  signal difficile. Sans difficulté exploitable : exposition neutre.
- Zéro exposition donne `nouveau`. Toute exposition non suffisante donne `en_consolidation`.
- `acquis` exige trois expositions positives, des prérequis acquis, aucune série de deux signaux
  difficiles récents et une dernière exposition datant d'au plus 42 jours.
- Deux signaux difficiles consécutifs ou une interruption supérieure à 42 jours maintiennent ou
  ramènent la compétence à `en_consolidation`.
- Des occurrences sans feedback augmentent l'exposition, mais ne suffisent jamais à produire
  un acquis.

Les seuils sont regroupés dans `MASTERY_RULES` et couverts par des tests de transition.

## Compatibilité et calcul initial

Aucune migration destructive ni backfill SQL n'est nécessaire. À chaque calcul,
`shared/skill-history.ts` applique cette stratégie déterministe :

1. utiliser les `skillIds` persistés par les nouvelles générations ;
2. pour une ancienne séance, inférer les coups depuis le combo numéroté (`1-2-3`, par exemple) ;
3. à défaut, reconnaître un vocabulaire technique limité dans le nom et l'explication ;
4. uniquement si aucun exercice n'a pu être classé, utiliser la correspondance conservatrice du
   focus historique.

Le feedback par exercice est associé par indices de bloc et d'exercice. S'il manque, le feedback
global sert de repli. S'il n'existe aucun feedback, l'exposition reste neutre : l'historique
contribue donc à l'état initial sans être transformé artificiellement en maîtrise. Les anciennes
séances restent servies telles quelles par l'API et l'interface grâce au champ `skillIds` optionnel
à la lecture/defaulté lors de la validation.

## Contrat d'intégration avec le planner (#2)

`buildSkillProgression` expose :

- `reviewSkillIds` : compétences en consolidation ;
- `eligibleNewSkillIds` : nouveautés dont tous les prérequis sont acquis ;
- `blockedSkills` : compétences et prérequis manquants ;
- les compteurs et raisons calculés de chaque état, utilisables dans `coachNote`.

`buildSkillPrescriptionGuidance` est la frontière d'intégration. Il renvoie un unique
`newSkillId`, les `consolidatedSkillIds` explicites et les faits de justification. En mode
automatique, il ne choisit que parmi les nouveautés éligibles. Une demande utilisateur explicite
reste autorisée ; si la cible n'est pas acquise, le contrat impose une intensité plafonnée à 2 et
une pédagogie de décomposition des fondamentaux. Il ne calcule ni catégorie, ni durée, ni budgets
de blocs : ces décisions restent la responsabilité exclusive du planner de #2.
`buildSkillGuidanceForFocus` limite en plus nouveautés et consolidations au focus que ce planner
a déjà choisi.

`applySkillGuidanceToPrescription` effectue le raccord final sans dépendance vers le module de #2 :
il conserve toutes les décisions du planner, borne `maxNewTechniques` à zéro ou un, applique le
plafond d'intensité d'une demande adaptée et ajoute `skillSelection` (nouveauté, consolidations,
prérequis et faits de `coachNote`). Après intégration de #2, son service doit appeler cet adaptateur
sur la prescription déjà calculée ; aucun profil de blocs ni choix de catégorie n'est dupliqué ici.

Le service `getSkillProgression` adapte les repositories existants au moteur pur. Le snapshot est
exposé par `GET /api/skills/progression` et injecté dans le contexte de génération sous
`progressionCompetences`.
