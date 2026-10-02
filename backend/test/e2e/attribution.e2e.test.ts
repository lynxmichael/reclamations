/**
 * Attribution et escalade automatiques (étape 16, phase 2, décision I10) : ouvertes banque par
 * banque par le Super Admin ; groupes d'agents par catégorie et par agence ; absences ; mode
 * suggestion (le superviseur valide) et mode automatique (au dépôt, à l'agent disponible le moins
 * chargé, jamais hors des heures ouvrées) ; escalade à l'Admin Entreprise au-delà d'un seuil.
 *
 * L'horloge de l'API est pilotée par le test. À la fin, groupes et absences sont retirés et la
 * fonction refermée, comme au départ, pour les fichiers suivants.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CycleDeVie } from '../../src/application/reclamations/cycle-de-vie.js';
import { chargerParametres } from '../../src/application/reclamations/parametres.js';
import { TachesSla } from '../../src/application/reclamations/taches-sla.js';
import { plusDisponible } from '../../src/domaine/attribution.js';
import { instantEscaladeAdmin } from '../../src/domaine/reclamation/escalade.js';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { ClientApi, connecter, demarrerApi, fermerOutils, jeu, nouvelleIp, type ApiDeTest } from './environnement.js';

const j = jeu();
const a = j.alpha;
// Lundi 7 septembre 2026, 09:00 à Abidjan (UTC) : la banque est ouverte (08:00–12:00, 14:00–17:30). Une date
// passée : les réclamations du fichier n'entrent pas dans les périodes « depuis le début du test » des suivants
let maintenant = new Date('2026-09-07T09:00:00Z');
let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
let taches: TachesSla;
const jt: Record<string, string> = {};
let compteur = 0;

const COMPTES = { sa: j.superAdmin.email, fatou: a.comptes.fatou!.email, serge: a.comptes.serge!.email, aya: a.comptes.aya!.email };
const id = { aya: a.comptes.aya!.id, mamadou: a.comptes.mamadou!.id, ibrahim: a.comptes.ibrahim!.id, serge: a.comptes.serge!.id, fatou: a.comptes.fatou!.id };
const groupes: Record<string, string> = {};
const absences: Record<string, string> = {};

async function horlogeA(t: Date) {
  maintenant = t;
  for (const [cle, email] of Object.entries(COMPTES)) jt[cle] = (await connecter(client, email, () => maintenant)).jeton;
}

interface Ticket { id: string; numero: string; agentId: string | null; priorite: string }

/** Dépôt d'un client : par le QR code de l'agence Plateau, ou par le lien web avec l'agence choisie. */
async function deposer(categorie: string, agence?: string): Promise<Ticket> {
  compteur++;
  const r = await client.appeler('deposerReclamation', {
    ip: nouvelleIp(), chemin: { code: agence ? a.points.lien : a.points.qr },
    corps: {
      categorieId: a.categories[categorie], description: `Scénario attribution ${compteur}`, nom: 'Client Attribution',
      telephone: `0799016${String(compteur).padStart(3, '0')}`, consentement: true, versionPolitique: '2026-09',
      ...(agence ? { agenceId: a.agences[agence] } : {}),
    },
  });
  expect(r.statut, JSON.stringify(r.corps)).toBe(201);
  return bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({
    where: { jetonSuivi: r.corps.jetonSuivi }, select: { id: true, numero: true, agentId: true, priorite: true },
  }));
}

const appeler = async (op: string, jeton: string, o: { chemin?: Record<string, string>; corps?: unknown; requete?: Record<string, string> } = {}) =>
  client.appeler(op, { jeton, ...o });
const ok = async (op: string, jeton: string, o: Parameters<typeof appeler>[2] = {}) => {
  const r = await appeler(op, jeton, o);
  expect(r.statut, `${op} : ${JSON.stringify(r.corps)}`).toBeLessThan(300);
  return r.corps;
};
const fiche = (t: Ticket, jeton = jt.serge!) => ok('lireReclamation', jeton, { chemin: { id: t.id } });
const ligne = async (t: Ticket) =>
  (await ok('listerReclamations', jt.serge!, { requete: { recherche: t.numero } })).donnees.find((x: { id: string }) => x.id === t.id);
const agentDe = async (t: Ticket) => (await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { id: t.id } }))).agentId;
const escaladeeAdminLe = async (t: Ticket) => (await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { id: t.id } }))).escaladeeAdminLe;
const regles = (corps: unknown) => appeler('modifierReglesTraitement', jt.fatou!, { corps });

/** Le plus disponible d'après la base : charge « à traiter », puis attribution la plus ancienne. */
async function attendu(agents: string[]): Promise<string> {
  const lignes = await bd.enBanque(a.id, async (tx) => {
    const u = await tx.utilisateur.findMany({ where: { id: { in: agents } }, select: { id: true, prenom: true, nom: true, derniereAttributionLe: true } });
    const n = await tx.reclamation.groupBy({ by: ['agentId'], where: { agentId: { in: agents }, statut: { in: ['OUVERTE', 'EN_COURS'] } }, _count: { _all: true } });
    return u.map((x) => ({ id: x.id, nom: `${x.prenom} ${x.nom}`, derniereAttributionLe: x.derniereAttributionLe, aTraiter: n.find((c) => c.agentId === x.id)?._count._all ?? 0 }));
  });
  return plusDisponible(lignes)!.id;
}

beforeAll(async () => {
  api = await demarrerApi({ horloge: () => maintenant });
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  taches = new TachesSla(bd.base, new CycleDeVie(bd.base, { horloge: () => maintenant, lienSuivi: (s, t) => `https://${s}.reclamations.test/suivi/${t}` }));
  await horlogeA(maintenant);
});

afterAll(async () => {
  await horlogeA(maintenant);
  for (const absence of Object.values(absences)) await appeler('supprimerAbsence', jt.fatou!, { chemin: { id: absence } });
  for (const groupe of Object.values(groupes)) await appeler('supprimerGroupe', jt.fatou!, { chemin: { id: groupe } });
  await appeler('modifierBanque', jt.sa!, { chemin: { id: a.id }, corps: { attributionAutomatique: false } });
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

describe('activation banque par banque (décision I2)', () => {
  it('fermée par défaut : attribution manuelle, règles inaccessibles', async () => {
    const p = await ok('lireParametresBanque', jt.fatou!);
    expect(p).toMatchObject({ attributionAutomatique: false, modeAttribution: 'MANUELLE' });
    const r = await appeler('lireReglesTraitement', jt.fatou!);
    expect(r.statut).toBe(403);
    expect(r.corps.code).toBe('FONCTION_NON_OUVERTE');
    expect((await appeler('listerGroupes', jt.serge!)).corps.code).toBe('FONCTION_NON_OUVERTE');
    const t = await deposer('Carte bancaire');
    expect(t.agentId).toBeNull();
    expect((await ligne(t)).agentSuggere).toBeNull();
    expect((await fiche(t)).attributionSuggeree).toBeNull();
  });

  it('le Super Admin l\'ouvre pour la Banque Alpha ; l\'agent n\'a pas accès aux règles', async () => {
    const b = await ok('modifierBanque', jt.sa!, { chemin: { id: a.id }, corps: { attributionAutomatique: true } });
    expect(b.attributionAutomatique).toBe(true);
    expect((await ok('lireParametresBanque', jt.fatou!)).attributionAutomatique).toBe(true);
    // Toujours en attribution manuelle tant que l'Admin Entreprise n'a pas choisi
    const r = await ok('lireReglesTraitement', jt.serge!);
    expect(r).toMatchObject({ mode: 'MANUELLE', seuilEscaladeAdminPourcent: null, seuilEscaladeAdminUrgentPourcent: null });
    expect(r.categories).toHaveLength(7);
    expect(r.agences.map((x: { agence: { nom: string } }) => x.agence.nom)).toEqual(['Plateau', 'Cocody Angré', 'Bouaké Commerce']);
    expect((await appeler('lireReglesTraitement', jt.aya!)).statut).toBe(403);
    expect((await appeler('listerAbsences', jt.aya!)).statut).toBe(403);
  });
});

describe('groupes d\'agents et règles (Admin Entreprise)', () => {
  it('crée les groupes : des agents seulement, un nom unique', async () => {
    const m = await ok('creerGroupe', jt.fatou!, { corps: { nom: '  Monétique e2e ', membres: [id.aya, id.mamadou] } });
    groupes.monetique = m.id;
    expect(m).toMatchObject({ nom: 'Monétique e2e', categories: [], agences: [] });
    expect(m.membres.map((x: { nom: string; statut: string; absent: boolean }) => [x.nom, x.statut, x.absent]))
      .toEqual([['Aya Konan', 'ACTIF', false], ['Mamadou Traoré', 'ACTIF', false]]);
    const b = await ok('creerGroupe', jt.fatou!, { corps: { nom: 'Bouaké e2e', membres: [id.ibrahim] } });
    groupes.bouake = b.id;

    expect((await appeler('creerGroupe', jt.fatou!, { corps: { nom: 'Monétique e2e', membres: [] } })).corps.code).toBe('NOM_DEJA_UTILISE');
    expect((await appeler('creerGroupe', jt.fatou!, { corps: { nom: 'Superviseurs', membres: [id.serge] } })).corps.code).toBe('AGENT_INVALIDE');
    expect((await appeler('creerGroupe', jt.fatou!, { corps: { nom: 'Étranger', membres: [j.horizon.comptes.salif!.id] } })).corps.code).toBe('AGENT_INVALIDE');
    expect((await appeler('creerGroupe', jt.serge!, { corps: { nom: 'Équipe Serge', membres: [] } })).statut).toBe(403);
    expect((await appeler('creerGroupe', jt.fatou!, { corps: { nom: 'Double', membres: [id.aya, id.aya] } })).statut).toBe(400);
  });

  it('modifie un groupe : nom et membres', async () => {
    const g = await ok('modifierGroupe', jt.fatou!, { chemin: { id: groupes.bouake! }, corps: { nom: 'Agence de Bouaké e2e', membres: [id.mamadou, id.ibrahim] } });
    expect(g.nom).toBe('Agence de Bouaké e2e');
    expect(g.membres.map((x: { id: string }) => x.id)).toEqual([id.ibrahim, id.mamadou]);
    expect((await appeler('modifierGroupe', jt.fatou!, { chemin: { id: groupes.bouake! }, corps: { nom: 'Monétique e2e' } })).corps.code).toBe('NOM_DEJA_UTILISE');
    expect((await appeler('modifierGroupe', jt.fatou!, { chemin: { id: '0199a000-0000-7000-8000-000000000000' }, corps: { nom: 'Fantôme' } })).statut).toBe(404);
    expect((await appeler('modifierGroupe', jt.fatou!, { chemin: { id: groupes.bouake! }, corps: {} })).statut).toBe(400);
  });

  it('confie catégories et agences aux groupes et règle les seuils d\'escalade', async () => {
    const r = await regles({
      seuilEscaladeAdminPourcent: 150,
      categories: [
        { id: a.categories['Carte bancaire'], groupeId: groupes.monetique, seuilEscaladeAdminPourcent: null, seuilEscaladeAdminUrgentPourcent: null },
        { id: a.categories['Fraude suspectée'], groupeId: groupes.monetique, seuilEscaladeAdminPourcent: null, seuilEscaladeAdminUrgentPourcent: 110 },
      ],
      agences: [{ id: a.agences['Bouaké Commerce'], groupeId: groupes.bouake }],
    });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(r.corps).toMatchObject({ mode: 'MANUELLE', seuilEscaladeAdminPourcent: 150, seuilEscaladeAdminUrgentPourcent: null });
    const carte = r.corps.categories.find((c: { categorie: { nom: string } }) => c.categorie.nom === 'Carte bancaire');
    expect(carte.groupe).toEqual({ id: groupes.monetique, nom: 'Monétique e2e' });
    const fraude = r.corps.categories.find((c: { categorie: { nom: string } }) => c.categorie.nom === 'Fraude suspectée');
    expect(fraude).toMatchObject({ seuilEscaladeAdminPourcent: null, seuilEscaladeAdminUrgentPourcent: 110 });
    expect(r.corps.agences.find((x: { agence: { nom: string } }) => x.agence.nom === 'Bouaké Commerce').groupe.id).toBe(groupes.bouake);
    // Les catégories et agences non citées ne changent pas
    expect(r.corps.categories.filter((c: { groupe: unknown }) => c.groupe).length).toBe(2);

    const g = await ok('listerGroupes', jt.serge!);
    expect(g.map((x: { nom: string }) => x.nom)).toEqual(['Agence de Bouaké e2e', 'Monétique e2e']);
    expect(g[1].categories.map((c: { nom: string }) => c.nom)).toEqual(['Carte bancaire', 'Fraude suspectée']);
    expect(g[0].agences.map((c: { nom: string }) => c.nom)).toEqual(['Bouaké Commerce']);

    expect((await regles({ categories: [{ id: a.categories['Crédit'], groupeId: '0199a000-0000-7000-8000-000000000000', seuilEscaladeAdminPourcent: null, seuilEscaladeAdminUrgentPourcent: null }] })).corps.code).toBe('GROUPE_INVALIDE');
    expect((await regles({ agences: [{ id: '0199a000-0000-7000-8000-000000000000', groupeId: null }] })).statut).toBe(404);
    expect((await regles({ seuilEscaladeAdminPourcent: 100 })).statut).toBe(400);
    expect((await regles({})).statut).toBe(400);
    expect((await appeler('modifierReglesTraitement', jt.serge!, { corps: { mode: 'AUTOMATIQUE' } })).statut).toBe(403);
  });
});

describe('mode suggestion : le superviseur valide chaque attribution', () => {
  it('l\'agent disponible le moins chargé est proposé dans la file et sur la fiche', async () => {
    expect((await regles({ mode: 'SUGGESTION' })).corps.mode).toBe('SUGGESTION');
    expect((await ok('lireParametresBanque', jt.serge!)).modeAttribution).toBe('SUGGESTION');
    const t = await deposer('Carte bancaire');
    expect(t.agentId).toBeNull();
    const choix = await attendu([id.aya, id.mamadou]);
    expect((await ligne(t)).agentSuggere.id).toBe(choix);
    expect((await fiche(t)).attributionSuggeree).toMatchObject({ agent: { id: choix }, groupe: { id: groupes.monetique, nom: 'Monétique e2e' } });
    // Pour qui ne peut pas assigner (Admin Entreprise), pas de suggestion
    expect((await fiche(t, jt.fatou!)).attributionSuggeree).toBeNull();

    // Le superviseur valide : la suggestion disparaît, l'agent servi passe derrière l'autre à égalité
    await ok('assignerReclamation', jt.serge!, { chemin: { id: t.id }, corps: { agentId: choix } });
    expect((await fiche(t)).attributionSuggeree).toBeNull();
    expect((await ligne(t)).agentSuggere).toBeNull();
    const servi = await bd.enBanque(a.id, (tx) => tx.utilisateur.findUniqueOrThrow({ where: { id: choix }, select: { derniereAttributionLe: true } }));
    expect(servi.derniereAttributionLe).toEqual(maintenant);
  });

  it('une catégorie et une agence sans groupe : pas de suggestion', async () => {
    const t = await deposer('Crédit');
    expect((await ligne(t)).agentSuggere).toBeNull();
    // L'agence seule suffit : groupe de l'agence de Bouaké
    const u = await deposer('Crédit', 'Bouaké Commerce');
    expect((await fiche(u)).attributionSuggeree.groupe.id).toBe(groupes.bouake);
  });
});

describe('absences', () => {
  it('un agent absent n\'est pas proposé ; le superviseur déclare et retire une absence', async () => {
    const r = await ok('ajouterAbsence', jt.serge!, { corps: { agentId: id.aya, du: '2026-09-07', au: '2026-09-09' } });
    absences.aya = r.id;
    expect(r).toMatchObject({ agent: { id: id.aya, nom: 'Aya Konan' }, du: '2026-09-07', au: '2026-09-09' });
    const futur = await ok('ajouterAbsence', jt.fatou!, { corps: { agentId: id.ibrahim, du: '2026-12-21', au: '2027-01-02' } });
    expect((await ok('listerAbsences', jt.serge!)).map((x: { id: string }) => x.id)).toEqual([r.id, futur.id]);
    expect((await ok('listerGroupes', jt.serge!)).find((g: { id: string }) => g.id === groupes.monetique).membres
      .map((m: { id: string; absent: boolean }) => [m.id, m.absent])).toEqual([[id.aya, true], [id.mamadou, false]]);

    const t = await deposer('Carte bancaire');
    expect((await ligne(t)).agentSuggere.id).toBe(id.mamadou);
    await ok('supprimerAbsence', jt.serge!, { chemin: { id: futur.id } });
    expect((await appeler('supprimerAbsence', jt.serge!, { chemin: { id: futur.id } })).statut).toBe(404);
  });

  it('dates et agent contrôlés', async () => {
    const essai = async (corps: Record<string, string>) => (await appeler('ajouterAbsence', jt.serge!, { corps: { agentId: id.mamadou, du: '2026-09-14', au: '2026-09-18', ...corps } })).corps.code;
    expect(await essai({ au: '2026-09-11' })).toBe('ABSENCE_INVALIDE');
    expect(await essai({ du: '2026-08-03', au: '2026-09-04' })).toBe('ABSENCE_INVALIDE');
    expect(await essai({ au: '2027-12-31' })).toBe('ABSENCE_INVALIDE');
    expect(await essai({ agentId: id.serge })).toBe('AGENT_INVALIDE');
    expect(await essai({ du: '14/09/2026' })).toBe('VALIDATION');
  });
});

describe('mode automatique : au dépôt, à l\'agent disponible le moins chargé', () => {
  it('la réclamation part au dépôt ; l\'agent est prévenu ; le système est tracé', async () => {
    expect((await regles({ mode: 'AUTOMATIQUE' })).corps.mode).toBe('AUTOMATIQUE');
    // Aya est absente : Mamadou est le seul disponible du groupe Monétique
    const t = await deposer('Carte bancaire');
    expect(t.agentId).toBe(id.mamadou);
    const f = await fiche(t);
    expect(f.agent).toEqual({ id: id.mamadou, nom: 'Mamadou Traoré' });
    expect(f.statut).toBe('OUVERTE');
    expect(f.chronologie.map((e: { type: string; acteur: { type: string } }) => [e.type, e.acteur.type])).toEqual([['CREATION', 'CLIENT'], ['ASSIGNATION', 'SYSTEME']]);
    const notifs = await bd.enSysteme((tx) => tx.notification.findMany({ where: { reclamationId: t.id, modele: 'agent.assignation' } }));
    expect(notifs.map((n) => [n.destinataireUtilisateurId, n.canal]).sort()).toEqual([[id.mamadou, 'EMAIL'], [id.mamadou, 'IN_APP']]);
    const audit = await bd.enBanque(a.id, (tx) => tx.journalAudit.findFirstOrThrow({ where: { action: 'reclamation.attribution_automatique', entiteId: t.id } }));
    expect(audit).toMatchObject({ acteurType: 'SYSTEME', donnees: { numero: t.numero, agentApres: id.mamadou, groupeId: groupes.monetique } });
    // Pas de suggestion en mode automatique
    expect((await ligne(t)).agentSuggere).toBeNull();
  });

  it('catégorie et agence ont chacune un groupe : un agent des deux d\'abord', async () => {
    await ok('supprimerAbsence', jt.serge!, { chemin: { id: absences.aya! } });
    delete absences.aya;
    // Monétique (Aya, Mamadou) ∩ Bouaké (Ibrahim, Mamadou) = Mamadou, même s'il est le plus chargé
    const t = await deposer('Carte bancaire', 'Bouaké Commerce');
    expect(t.agentId).toBe(id.mamadou);
    // Agence seule : le moins chargé de l'agence
    const attenduBouake = await attendu([id.ibrahim, id.mamadou]);
    expect((await deposer('Accueil en agence', 'Bouaké Commerce')).agentId).toBe(attenduBouake);
    // Catégorie seule : charge égale ou non, la règle désigne le même agent que la base
    const attenduMonetique = await attendu([id.aya, id.mamadou]);
    expect((await deposer('Carte bancaire')).agentId).toBe(attenduMonetique);
  });

  it('les réclamations se répartissent : le moins chargé reçoit la suivante', async () => {
    const recus: string[] = [];
    for (let i = 0; i < 4; i++) {
      const choix = await attendu([id.aya, id.mamadou]);
      const t = await deposer('Carte bancaire');
      expect(t.agentId).toBe(choix);
      recus.push(t.agentId!);
    }
    expect(new Set(recus)).toEqual(new Set([id.aya, id.mamadou]));
  });

  it('une réclamation urgente : l\'agent attribué reçoit l\'alerte, avec son superviseur et l\'Admin Entreprise', async () => {
    const choix = await attendu([id.aya, id.mamadou]);
    const t = await deposer('Fraude suspectée');
    expect(t).toMatchObject({ priorite: 'URGENTE', agentId: choix });
    const alertes = await bd.enSysteme((tx) => tx.notification.findMany({ where: { reclamationId: t.id, modele: 'reclamation.urgente', canal: 'IN_APP' } }));
    expect(new Set(alertes.map((n) => n.destinataireUtilisateurId))).toEqual(new Set([choix, id.serge, id.fatou]));
  });

  it('sans agent disponible, la réclamation attend dans la file du superviseur ; le worker la reprend', async () => {
    for (const agent of [id.aya, id.mamadou]) {
      absences[agent] = (await ok('ajouterAbsence', jt.fatou!, { corps: { agentId: agent, du: '2026-09-07', au: '2026-09-07' } })).id;
    }
    const t = await deposer('Carte bancaire');
    expect(t.agentId).toBeNull();
    const recues = await ok('listerReclamations', jt.serge!, { requete: { file: 'recues', recherche: t.numero } });
    expect(recues.donnees.map((x: { id: string }) => x.id)).toEqual([t.id]);
    await taches.attributionsEnAttente(maintenant);
    expect(await agentDe(t)).toBeNull();

    await ok('supprimerAbsence', jt.fatou!, { chemin: { id: absences[id.aya]! } });
    delete absences[id.aya];
    expect(await taches.attributionsEnAttente(maintenant)).toBeGreaterThanOrEqual(1);
    expect(await agentDe(t)).toBe(id.aya);
    const f = await fiche(t);
    expect(f.chronologie.at(-1)).toMatchObject({ type: 'ASSIGNATION', acteur: { type: 'SYSTEME' } });
    await ok('supprimerAbsence', jt.fatou!, { chemin: { id: absences[id.mamadou]! } });
    delete absences[id.mamadou];
  });

  it('hors des heures ouvrées, personne ne reçoit rien : le worker attribue à l\'ouverture', async () => {
    await horlogeA(new Date('2026-09-07T19:00:00Z'));
    const t = await deposer('Carte bancaire');
    expect(t.agentId).toBeNull();
    // En mode suggestion, le superviseur verrait l'agent prévu pour le prochain jour ouvré ; ici, rien
    expect(await taches.attributionsEnAttente(new Date('2026-09-07T23:00:00Z'))).toBe(0);
    expect(await agentDe(t)).toBeNull();
    const choix = await attendu([id.aya, id.mamadou]);
    await horlogeA(new Date('2026-09-08T08:01:00Z'));
    expect(await taches.attributionsEnAttente(maintenant)).toBeGreaterThanOrEqual(1);
    expect(await agentDe(t)).toBe(choix);
  });
});

describe('escalade à plusieurs niveaux', () => {
  it('superviseur à l\'échéance, puis Admin Entreprise au seuil de la banque (150 %), une seule fois', async () => {
    const t = await deposer('Carte bancaire'); // 960 minutes ouvrées
    const r = await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { id: t.id } }));
    const p = await bd.enBanque(a.id, (tx) => chargerParametres(tx, a.id));
    const instant = instantEscaladeAdmin(r.echeanceSlaLe!, 960, 150, p.sla.calendrier);
    expect(instant.getTime()).toBeGreaterThan(r.echeanceSlaLe!.getTime());

    // D'autres réclamations du fichier sont aussi en retard : on suit celle-ci
    await taches.toutes(new Date(r.echeanceSlaLe!.getTime() + 60_000));
    await taches.escaladesAdmin(new Date(instant.getTime() - 60_000));
    expect(await escaladeeAdminLe(t)).toBeNull();
    expect(await taches.escaladesAdmin(instant)).toBeGreaterThanOrEqual(1);
    expect(await escaladeeAdminLe(t)).toEqual(instant);
    await taches.escaladesAdmin(new Date(instant.getTime() + 3_600_000));

    await horlogeA(new Date(instant.getTime() + 60_000));
    const f = await fiche(t);
    expect(f.jalons.escaladeeAdminLe).toBe(instant.toISOString());
    expect(f.escaladeeVers.nom).toBe('Serge Kouadio');
    expect(f.chronologie.filter((e: { type: string }) => e.type.startsWith('ESCALADE') || e.type === 'DEPASSEMENT_SLA').map((e: { type: string }) => e.type))
      .toEqual(['DEPASSEMENT_SLA', 'ESCALADE', 'ESCALADE_ADMIN']);
    const notifs = await bd.enSysteme((tx) => tx.notification.findMany({ where: { reclamationId: t.id, modele: 'admin.escalade' } }));
    expect(notifs.map((n) => [n.destinataireUtilisateurId, n.canal]).sort()).toEqual([[id.fatou, 'EMAIL'], [id.fatou, 'IN_APP']]);
    expect(notifs[0]!.contenu).toContain('150 %');
    const audit = await bd.enBanque(a.id, (tx) => tx.journalAudit.count({ where: { action: 'sla.escalade_admin', entiteId: t.id } }));
    expect(audit).toBe(1);
  });

  it('une réclamation urgente suit le seuil urgent de sa catégorie (110 %)', async () => {
    const t = await deposer('Fraude suspectée'); // 240 minutes ouvrées
    const r = await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { id: t.id } }));
    const p = await bd.enBanque(a.id, (tx) => chargerParametres(tx, a.id));
    const instant = instantEscaladeAdmin(r.echeanceSlaLe!, 240, 110, p.sla.calendrier);
    await taches.toutes(new Date(r.echeanceSlaLe!.getTime() + 60_000));
    await taches.escaladesAdmin(new Date(instant.getTime() - 60_000));
    expect(await escaladeeAdminLe(t)).toBeNull();
    await taches.escaladesAdmin(instant);
    expect(await escaladeeAdminLe(t)).toEqual(instant);
  });

  it('sans seuil, pas de second niveau', async () => {
    await regles({ seuilEscaladeAdminPourcent: null });
    const t = await deposer('Carte bancaire');
    const r = await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { id: t.id } }));
    await taches.toutes(new Date(r.echeanceSlaLe!.getTime() + 60_000));
    await taches.escaladesAdmin(new Date(r.echeanceSlaLe!.getTime() + 30 * 86_400_000));
    expect(await escaladeeAdminLe(t)).toBeNull();
  });
});

describe('fermeture et suppression', () => {
  it('supprimer un groupe libère ses catégories et agences', async () => {
    await horlogeA(new Date('2026-09-09T09:00:00Z'));
    expect((await appeler('supprimerGroupe', jt.serge!, { chemin: { id: groupes.bouake! } })).statut).toBe(403);
    expect((await appeler('supprimerGroupe', jt.fatou!, { chemin: { id: groupes.bouake! } })).statut).toBe(204);
    delete groupes.bouake;
    const r = await ok('lireReglesTraitement', jt.fatou!);
    expect(r.agences.every((x: { groupe: unknown }) => x.groupe === null)).toBe(true);
    const actions = await bd.enBanque(a.id, (tx) => tx.journalAudit.findMany({
      where: { action: { in: ['parametrage.groupe_cree', 'parametrage.groupe_modifie', 'parametrage.groupe_supprime', 'parametrage.regles_traitement', 'personnel.absence_ajoutee', 'personnel.absence_retiree'] } },
      select: { action: true },
    }));
    expect(new Set(actions.map((x) => x.action)).size).toBe(6);
  });

  it('le Super Admin referme la fonction : retour à l\'attribution manuelle, groupes conservés mais inactifs', async () => {
    const b = await ok('modifierBanque', jt.sa!, { chemin: { id: a.id }, corps: { attributionAutomatique: false } });
    expect(b.attributionAutomatique).toBe(false);
    expect((await ok('lireParametresBanque', jt.serge!)).modeAttribution).toBe('MANUELLE');
    expect((await appeler('listerGroupes', jt.fatou!)).corps.code).toBe('FONCTION_NON_OUVERTE');
    expect((await deposer('Carte bancaire')).agentId).toBeNull();
    // Rouverte : l'Admin Entreprise repart du mode manuel, ses groupes sont toujours là
    await ok('modifierBanque', jt.sa!, { chemin: { id: a.id }, corps: { attributionAutomatique: true } });
    const r = await ok('lireReglesTraitement', jt.fatou!);
    expect(r.mode).toBe('MANUELLE');
    expect(r.categories.find((c: { categorie: { nom: string } }) => c.categorie.nom === 'Carte bancaire').groupe.id).toBe(groupes.monetique);
  });
});
