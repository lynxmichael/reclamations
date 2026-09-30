/**
 * L'API sert le contrat : chaque opération a sa méthode de contrôleur (sauf le reporting, étape 9),
 * avec la méthode HTTP et le chemin lus dans le contrat. Validation des entrées et messages.
 */
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { AuditControleur } from '../../modules/audit/audit.controller.js';
import { AuthControleur } from '../../modules/auth/auth.controller.js';
import { ClientControleur } from '../../modules/client/client.controller.js';
import { NotificationsControleur } from '../../modules/notifications/notifications.controller.js';
import { ParametrageControleur } from '../../modules/parametrage/parametrage.controller.js';
import { PersonnelControleur } from '../../modules/personnel/personnel.controller.js';
import { PlateformeControleur } from '../../modules/plateforme/plateforme.controller.js';
import { ReportingControleur } from '../../modules/reporting/reporting.controller.js';
import { PublicControleur } from '../../modules/public/public.controller.js';
import { ReclamationsControleur } from '../../modules/reclamations/reclamations.controller.js';
import { SanteControleur } from '../../modules/sante/sante.controller.js';
import { contratApi, operation } from './contrat.js';
import { CLE_OPERATION, cheminNest } from './operation.decorator.js';
import { erreursChamps, validateurDe } from './validation.js';

const CONTROLEURS = [
  SanteControleur, PublicControleur, ClientControleur, AuthControleur, ReclamationsControleur, NotificationsControleur,
  ParametrageControleur, PersonnelControleur, AuditControleur, PlateformeControleur, ReportingControleur,
];

const METHODES_HTTP = ['get', 'post', 'put', 'delete', 'patch'];

function routes() {
  return CONTROLEURS.flatMap((c) => Object.getOwnPropertyNames(c.prototype)
    .map((nom) => (c.prototype as unknown as Record<string, unknown>)[nom])
    .filter((f): f is (...a: unknown[]) => unknown => typeof f === 'function' && !!Reflect.getMetadata(CLE_OPERATION, f))
    .map((f) => ({
      id: Reflect.getMetadata(CLE_OPERATION, f) as string,
      chemin: Reflect.getMetadata(PATH_METADATA, f) as string,
      methode: METHODES_HTTP[Reflect.getMetadata(METHOD_METADATA, f) as number] ?? '?',
    })));
}

describe('routes de l\'API ↔ opérations du contrat', () => {
  it('chaque opération du contrat est servie une fois (83, reporting de l\'étape 9 compris)', () => {
    const servies = routes().map((r) => r.id);
    expect(new Set(servies).size).toBe(servies.length);
    const attendues = [...contratApi().operations.keys()].sort();
    expect([...servies].sort()).toEqual(attendues);
    expect(attendues.length).toBe(83);
  });

  it('méthode et chemin HTTP de chaque route sont ceux du contrat', () => {
    for (const r of routes()) {
      const op = operation(r.id);
      expect(r.chemin, r.id).toBe(cheminNest(op.chemin));
      expect(r.methode, r.id).toBe(op.methode);
    }
  });

  it('cheminNest : /banque/reclamations/{id}/pieces-jointes/{pieceId}', () => {
    expect(cheminNest('/banque/reclamations/{id}/pieces-jointes/{pieceId}')).toBe('banque/reclamations/:id/pieces-jointes/:pieceId');
  });
});

describe('validation des entrées', () => {
  it('paramètres de requête convertis et complétés par les valeurs par défaut du contrat', () => {
    const v = validateurDe(operation('listerReclamations'));
    const q: Record<string, unknown> = { page: '2', statut: 'OUVERTE' };
    expect(v.requete(q)).toBe(true);
    expect(q).toEqual({ page: 2, statut: ['OUVERTE'], parPage: 25, file: 'toutes', tri: '-creeLe' });
    const faux: Record<string, unknown> = { parPage: '500', file: 'nimporte' };
    expect(v.requete(faux)).toBe(false);
    expect(erreursChamps(v.requete.errors).sort((a, b) => a.champ.localeCompare(b.champ))).toEqual([
      { champ: 'file', message: expect.stringContaining('Valeur attendue parmi') },
      { champ: 'parPage', message: 'Doit être inférieur ou égal à 100' },
    ]);
  });

  it('corps multipart : fichiers retirés du schéma, booléens convertis ; e-mail ou téléphone exigé', () => {
    const v = validateurDe(operation('deposerReclamation'));
    expect(v.champsFichiers).toEqual(['fichiers']);
    const corps: Record<string, unknown> = { categorieId: '0199aaaa-0000-7000-8000-000000000000', description: 'x', nom: 'Yao', consentement: 'true', versionPolitique: '2026-09' };
    expect(v.corps!(corps)).toBe(false);
    expect(erreursChamps(v.corps!.errors)).toEqual([{ champ: 'telephone', message: 'Un téléphone ou un e-mail au moins' }]);
    expect(v.corps!({ ...corps, telephone: '0708091011' })).toBe(true);
  });

  it('corps JSON : pas de conversion de type, messages en français', () => {
    const v = validateurDe(operation('creerCategorie'));
    expect(v.corps!({ nom: 'A', delaiCibleMinutes: '60' })).toBe(false);
    expect(erreursChamps(v.corps!.errors)).toEqual([
      { champ: 'nom', message: '2 caractères au moins' },
      { champ: 'delaiCibleMinutes', message: 'Type attendu : integer' },
    ]);
  });
});
