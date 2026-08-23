# Source des données

## Source prévue

Dofusdude API (`https://api.dofusdu.de`) pour Dofus 3, langue française.

Endpoints utilisés par le script de synchronisation :

- `/dofus3/v1/fr/items/equipment/all`
- `/dofus3/v1/fr/sets/all`
- `/dofus3/v1/fr/mounts/all`
- `/dofus3/v1/meta/elements`
- `/dofus3/v1/meta/version`

La donnée distante n'est pas chargée au démarrage de l'application. Elle est synchronisée en amont et normalisée en un snapshot compact.

## Contrat de normalisation

Chaque équipement normalisé doit fournir au minimum :

- `id`, `name`, `level`, `slot` ;
- `stats` numériques connues ;
- `setId` éventuel ;
- `conditions` éventuelles ;
- `turnBonuses` éventuels pour les effets T1/T2/T3 ;
- `sourceEffects` afin de conserver une trace du texte/effet d'origine ;
- `unmappedEffects` pour tout effet non compris.

Un build n'est marqué « calcul certifié » que si tous ses effets influençant l'objectif sont couverts.
