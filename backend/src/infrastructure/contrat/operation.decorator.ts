/**
 * @Operation('lireReclamation') : relie une méthode de contrôleur à une opération du contrat.
 * Méthode HTTP, chemin et statut de succès sont lus dans contrat/openapi.yaml ; l'intercepteur
 * du contrat applique ensuite l'authentification, les rôles (x-roles) et la validation.
 */
import { applyDecorators, HttpCode, RequestMapping, RequestMethod, SetMetadata } from '@nestjs/common';
import { operation } from './contrat.js';

export const CLE_OPERATION = 'contrat:operation';

const METHODES = {
  get: RequestMethod.GET,
  post: RequestMethod.POST,
  put: RequestMethod.PUT,
  patch: RequestMethod.PATCH,
  delete: RequestMethod.DELETE,
} as const;

/** /banque/reclamations/{id} → banque/reclamations/:id */
export function cheminNest(chemin: string): string {
  return chemin.replace(/^\//, '').replace(/\{([^}]+)\}/g, ':$1');
}

export function Operation(id: string): MethodDecorator {
  const op = operation(id);
  return applyDecorators(
    RequestMapping({ path: cheminNest(op.chemin), method: METHODES[op.methode] }),
    HttpCode(op.statutSucces),
    SetMetadata(CLE_OPERATION, id),
  );
}
