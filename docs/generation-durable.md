# Génération durable

La génération des séances repose sur SQLite, sans file distribuée supplémentaire. Une demande crée
un enregistrement `generation_jobs` et chaque prise en charge crée un
`generation_job_attempts`. La base reste la source de vérité : les timers du processus ne font que
réveiller le worker, jamais mémoriser seuls une transition.

## Idempotence et états

La clé unique est dérivée de la date et d'une empreinte canonique du contexte fonctionnel :
versions du générateur et de la politique, profil, réglages, planification, progression, historique,
contraintes d'autorégulation et préférences d'exercice. Deux demandes concurrentes avec le même
contexte convergent donc vers un seul job. Les états publics restent `queued`, `running`,
`retry_scheduled`, `succeeded`, `failed` et `invalidated` ; les données créées avant l'ajout du
fencing restent compatibles.

Une erreur temporaire ouvre au maximum trois essais, avec des délais purs et testables de 1 puis
2 secondes (la progression est bornée à 30 secondes après une relance explicite). Une erreur
définitive ne consomme pas de retry inutile. Les erreurs, horodatages, durées et délais sont
conservés par essai. Le timeout global suit exactement cette politique : retry s'il reste un essai,
puis fallback local lorsqu'il est permis, sinon échec définitif.

## Deadline, annulation et lease

Un essai fournisseur dispose d'un budget wall-clock de **5 minutes**. Ce budget englobe le
chargement du catalogue, l'appel initial, la validation, l'éventuelle correction structurée et la
préparation de la persistance. Il est indépendant des timeouts OpenRouter de 120 secondes par
appel : un watchdog applicatif termine donc aussi une promesse SDK qui ne se résout jamais. Le
signal d'annulation est transmis au SDK, mais le `Promise.race` du watchdog reste la garantie de
sortie. La transition intervient à la deadline, sous réserve du délai normal de la boucle
d'événements ; aucun trafic utilisateur ni redémarrage n'est nécessaire.

Le fallback déterministe, local et sans réseau, a un budget séparé de **30 secondes**. Il ne peut
donc pas transformer la sortie du watchdog en nouveau blocage.

Chaque claim reçoit un `lease_token` aléatoire non réutilisable. Le lease dure **45 secondes** et
est renouvelé toutes les **15 secondes**, ainsi qu'au début de chaque étape publique. Un appel
initial suivi d'une correction peut donc utiliser le budget complet sans devenir réclamable par un
second worker. Si le processus disparaît, la reprise est possible au plus tard à l'expiration du
dernier renouvellement.

Toutes les transitions issues d'un worker (`retry_scheduled`, `succeeded`, `failed`, invalidation,
mise à jour d'étape et renouvellement) comparent atomiquement :

- le statut `running` ;
- le numéro d'essai ;
- le propriétaire du lease ;
- le jeton de fencing ;
- un lease encore valide.

La ligne d'essai porte le même jeton. Après récupération, l'ancien essai passe à `interrupted` et
le jeton du job est révoqué avant le nouveau claim. Une réponse tardive ne peut donc modifier ni le
job ni l'historique. La génération vérifie également le lease juste avant de persister la séance :
l'ancien worker ne peut pas contourner le fencing par une écriture métier antérieure à la
finalisation du job. Les callbacks qui préchargent ou replanifient ne sont exécutés qu'après une
transition clôturée réussie.

## Récupération et réveils

Le worker calcule toujours le plus proche de ces deux horodatages :

1. `next_attempt_at` d'un job `queued` ou `retry_scheduled` ;
2. `lease_expires_at` d'un job `running`.

Au démarrage, les leases déjà expirés sont récupérés immédiatement. Si le serveur redémarre avant
l'expiration, un timer est programmé pour cette expiration ; le job sera donc récupéré sans autre
requête. Sur plusieurs processus, la mise à jour clôturée garantit qu'un seul récupère puis réclame
le job. Si le propriétaire légitime a renouvelé entre-temps, le réveil recalcule simplement la
prochaine expiration.

La migration `0013_groovy_maginty.sql` ajoute les tokens, l'horodatage de début d'essai, l'étape
courante et son horodatage. Elle backfill les jobs `running` existants avec un token partagé par
leur essai courant, sans modifier leur expiration ni leur historique.

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

La fin de l'onboarding est la frontière atomique des générations automatiques : ni l'ouverture de
l'accueil, ni le rattrapage cron, ni le préchargement, ni la reprise d'un ancien job automatique ne
peuvent appeler le fournisseur avant le commit du profil complet. Après ce commit, le premier job
utilise déjà l'objectif et l'inventaire normalisés. Leur modification change l'empreinte, mais
l'invalidation ne sélectionne que les séances futures de source `prefetch` encore au statut
`generated` ; une séance démarrée, terminée ou générée explicitement est conservée.

## Logs opérationnels

Chaque événement de lifecycle est une ligne JSON préfixée par `[generation-job]`. Les événements
stables sont : `enqueued`, `deduplicated`, `claimed`, `attempt_started`, `stage_started`,
`stage_succeeded`, `stage_failed`, `retry_scheduled`, `lease_recovered`, `lease_lost`,
`fallback_started`, `invalidated`, `succeeded` et `failed`.

Le logger utilise une allowlist fermée : `jobId`, date, source, essai/max, modèle, étape, statut,
durée, code d'erreur, délai de retry, réutilisation/fallback et identifiant non sensible du worker.
Il n'accepte et ne sérialise jamais clé, header, prompt, réponse modèle, profil, contexte complet,
contraintes libres ou contenu de séance. Les erreurs fournisseur sont réduites à un code stable ;
les violations de politique ne journalisent que leurs codes et chemins, jamais les valeurs.

## État public et interface

L'API conserve les anciens champs d'erreur pour les clients existants et ajoute deux objets
explicites :

- `currentAttempt` : numéro, début de l'essai, étape bornée (`catalogue`, `generation`,
  `validation`, `correction`, `fallback`, `persistence`) et début de l'étape ;
- `lastAttempt` : dernier essai clôturé, statut, erreur éventuelle et fin.

Aucun propriétaire, token ni délai de lease n'est exposé. L'accueil et le tiroir du planning
affichent l'étape courante, le temps écoulé depuis le début de l'essai et le résultat de l'essai
précédent séparément. Leur polling de quatre secondes converge automatiquement après timeout,
retry, récupération, fallback ou succès, sans rafraîchissement manuel.

La page **Réglages → Consommation IA** continue d'exposer les taux de réussite, réutilisation et
fallback, la latence moyenne, les appels modèle, les tokens et le coût estimé. Un job définitivement
échoué peut toujours être relancé explicitement avec un nouveau budget borné.
