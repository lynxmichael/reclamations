/**
 * Types du contrat d'API (contrat/openapi.yaml), générés dans schema.d.ts par `npm run contrat:types`.
 * Les écrans ne reçoivent que ces types : à l'étape 8, les mêmes composants seront alimentés par l'API.
 */
import type { components } from './schema';

export type Schemas = components['schemas'];
export type S<K extends keyof Schemas> = Schemas[K];

export type StatutReclamation = S<'StatutReclamation'>;
export type Priorite = S<'Priorite'>;
export type ActionStatut = S<'ActionStatut'>;
export type OperationTicket = S<'OperationTicket'>;
export type EtatChrono = S<'EtatChrono'>;
export type RoleUtilisateur = S<'RoleUtilisateur'>;
export type Horodatage = S<'Horodatage'>;
