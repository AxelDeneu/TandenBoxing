# Génération durable

La génération des séances repose sur SQLite, sans file distribuée supplémentaire. Une demande crée
un enregistrement `generation_jobs` et chaque prise en charge crée un
`generation_job_attempts`. Le worker Nitro réclame atomiquement un job avec un lease de cinq
minutes ; un lease expiré redevient récupérable au démarrage suivant.

## Idempotence et états

La clé unique est dérivée de la date et d'une empreinte canonique du contexte fonctionnel :
versions du générateur et de la politique, profil, réglages, planification, progression, historique,
contraintes d'autorégulation et préférences d'exercice. Deux demandes concurrentes avec le même
contexte convergent donc vers un seul job. Les états publics sont `queued`, `running`,
`retry_scheduled`, `succeeded`, `failed` et `invalidated`.

Une erreur temporaire ouvre au maximum trois essais, avec des délais purs et testables de 1 puis
2 secondes (la progression est bornée à 30 secondes après une relance explicite). Une erreur définitive ne
consomme pas de retry inutile. Les erreurs, horodatages, durées et délais sont conservés par essai.

## Réutilisation et fallback

Avant tout appel au modèle, le moteur cherche :

1. une séance entière compatible avec catégorie, focus, durée, variété, politique et exclusions
   actives ;
2. des blocs de bibliothèque compatibles avec leur budget et les préférences ;
3. le modèle uniquement pour les blocs restants, puis une validation de la séance recomposée.

Après épuisement des retries, une séance locale déterministe est construite à partir de la
prescription. Elle repasse la même politique bloquante et toutes les exclusions strictes. Si les
contraintes rendent même ce fallback impossible, le job reste en échec avec une action explicite à
effectuer dans l'interface.

## Préparation anticipée et invalidation

Après une génération interactive réussie et un onboarding terminé, les deux prochains jours
d'entraînement éligibles sont préparés. Une séance anticipée conserve son empreinte de contexte.
Toute modification du profil, des réglages, d'un plan, d'une préférence ou de l'historique invalide
les préparations dont l'empreinte a changé ; un changement de version de politique fait de même au
redémarrage.

## Observabilité

La page **Réglages → Consommation IA** expose les taux de réussite, réutilisation et fallback, la
latence moyenne, les appels modèle, les tokens et le coût estimé. L'accueil et le planning montrent
l'état courant, le numéro d'essai et l'erreur actionnable ; un job définitivement échoué peut être
relancé explicitement avec un nouveau budget borné.
