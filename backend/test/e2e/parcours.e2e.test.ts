/**
 * Recette §10, critères 1 et 2 : une réclamation déposée par QR code est traitée puis clôturée de
 * bout en bout, avec son numéro et l'accusé par e-mail et SMS ; le client voit à tout moment l'étape
 * exacte et horodatée de sa réclamation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BaseDonnees } from '../../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { ClientApi, connecter, demarrerApi, FICHIERS, fermerOutils, jeu, type ApiDeTest } from './environnement.js';

let api: ApiDeTest;
let client: ClientApi;
let bd: BaseDonnees;
const j = jeu();
let superviseur: string;
let agent: string;

beforeAll(async () => {
  api = await demarrerApi();
  client = new ClientApi(api.url);
  bd = new BaseDonnees(api.config.baseDeDonneesUrl);
  superviseur = (await connecter(client, j.alpha.comptes.serge.email)).jeton;
  agent = (await connecter(client, j.alpha.comptes.aya.email)).jeton;
});

afterAll(async () => {
  await bd.fermer();
  await api.fermer();
  await fermerOutils();
});

describe('parcours complet d\'une réclamation déposée par QR code', () => {
  let numero: string;
  let jetonSuivi: string;
  let id: string;
  let jetonClient: string;

  it('le QR code ouvre le formulaire aux couleurs de la banque, l\'agence déjà connue', async () => {
    const r = await client.appeler('lireFormulaireDepot', { chemin: { code: j.alpha.points.qr } });
    expect(r.statut).toBe(200);
    expect(r.corps.banque.nom).toBe('Banque Alpha');
    expect(r.corps.canal).toBe('QR_CODE');
    expect(r.corps.agence?.nom).toBe('Plateau');
    expect(r.corps.agences).toEqual([]);
    expect(r.corps.categories.length).toBe(7);
  });

  it('le dépôt crée le ticket PRÉFIXE-AAAA-NNNNNN avec ses pièces jointes, et l\'accusé part par e-mail et SMS', async () => {
    const r = await client.appeler('deposerReclamation', {
      chemin: { code: j.alpha.points.qr },
      corps: {
        categorieId: j.alpha.categories['Carte bancaire'],
        description: 'Le distributeur n\'a pas donné les billets mais mon compte a été débité de 50 000 FCFA.',
        nom: 'Yao Kouassi', telephone: '07 11 22 33 44', email: 'Yao.Kouassi@Exemple.ci', consentement: true, versionPolitique: '2026-09',
      },
      fichiers: [{ champ: 'fichiers', nom: 'ticket-distributeur.png', contenu: FICHIERS.png, type: 'image/png' }, { champ: 'fichiers', nom: 'relevé.pdf', contenu: FICHIERS.pdf }],
    });
    expect(r.statut).toBe(201);
    expect(r.corps.numero).toMatch(/^ALP-\d{4}-\d{6}$/);
    expect(r.corps.lienSuivi).toBe(`https://alpha.reclamations.example/suivi/${r.corps.jetonSuivi}`);
    ({ numero, jetonSuivi } = r.corps);
    const t = await bd.enSysteme((tx) => tx.reclamation.findUniqueOrThrow({ where: { jetonSuivi }, include: { piecesJointes: true, notifications: true } }));
    id = t.id;
    expect(t.statut).toBe('OUVERTE');
    expect(t.piecesJointes.map((p) => [p.nomFichier, p.typeMime])).toEqual([['ticket-distributeur.png', 'image/png'], ['relevé.pdf', 'application/pdf']]);
    const accuse = t.notifications.filter((n) => n.modele === 'client.depot');
    expect(accuse.map((n) => n.canal).sort()).toEqual(['EMAIL', 'SMS']);
    expect(accuse.find((n) => n.canal === 'SMS')?.destination).toBe('+2250711223344');
    expect(accuse.find((n) => n.canal === 'EMAIL')?.destination).toBe('yao.kouassi@exemple.ci');
    // Le SMS ne contient ni la description ni les coordonnées : le numéro et le lien seulement
    expect(accuse.every((n) => !n.contenu.includes('distributeur'))).toBe(true);
  });

  it('le lien de suivi montre la chronologie seule, sans description ni coordonnées', async () => {
    const r = await client.appeler('lireSuivi', { chemin: { jetonSuivi } });
    expect(r.statut).toBe(200);
    expect(r.corps.numero).toBe(numero);
    expect(r.corps.etapes).toEqual([{ type: 'CREATION', statut: 'OUVERTE', date: expect.any(String) }]);
    expect(JSON.stringify(r.corps)).not.toContain('distributeur');
  });

  it('le superviseur la trouve dans la file « reçues », l\'assigne ; l\'agent la voit dans « assignées à moi »', async () => {
    const recues = await client.appeler('listerReclamations', { jeton: superviseur, requete: { file: 'recues', recherche: numero } });
    expect(recues.corps.donnees.map((x: { numero: string }) => x.numero)).toEqual([numero]);
    expect(recues.corps.donnees[0].sla.etat).toBe('DANS_LES_DELAIS');
    const a = await client.appeler('assignerReclamation', { jeton: superviseur, chemin: { id }, corps: { agentId: j.alpha.comptes.aya.id } });
    expect(a.statut).toBe(200);
    expect(a.corps.agent.nom).toBe('Aya Konan');
    const miennes = await client.appeler('listerReclamations', { jeton: agent, requete: { file: 'assignees' } });
    expect(miennes.corps.donnees.map((x: { id: string }) => x.id)).toContain(id);
    expect(miennes.corps.compteurs.recues).toBe(0);
  });

  it('l\'agent répond en posant une question : « En attente client », chrono en pause', async () => {
    const r = await client.appeler('repondreAuClient', {
      jeton: agent, chemin: { id }, corps: { contenu: 'Pouvez-vous nous indiquer l\'heure exacte du retrait ?', attendreReponse: true },
    });
    expect(r.statut).toBe(201);
    expect(r.corps.statut).toBe('EN_ATTENTE_CLIENT');
    expect(r.corps.sla.etat).toBe('EN_PAUSE');
    expect(r.corps.sla.echeanceLe).toBeNull();
    expect(r.corps.operationsPossibles).toContain('NOTE_INTERNE');
  });

  it('le client reçoit un code OTP par SMS et ouvre sa session', async () => {
    const o = await client.appeler('demanderCodeOtp', { chemin: { jetonSuivi }, corps: {} });
    expect(o.statut).toBe(202);
    expect(o.corps).toEqual({ canal: 'SMS', destinationMasquee: '+225 07 •• •• •• 44', expireDans: 600 });
    const sms = await bd.enSysteme((tx) => tx.notification.findFirstOrThrow({ where: { reclamationId: id, modele: 'client.otp' }, orderBy: { creeLe: 'desc' } }));
    const code = /code est (\d{6})/.exec(sms.contenu)![1];
    const faux = await client.appeler('verifierCodeOtp', { chemin: { jetonSuivi }, corps: { code: code === '000000' ? '111111' : '000000' } });
    expect(faux.statut).toBe(422);
    expect(faux.corps.code).toBe('CODE_OTP_INVALIDE');
    const v = await client.appeler('verifierCodeOtp', { chemin: { jetonSuivi }, corps: { code } });
    expect(v.statut).toBe(200);
    jetonClient = v.corps.jetonClient;
  });

  it('le client lit sa réclamation (sans note interne) et répond : le ticket repart « En cours »', async () => {
    await client.appeler('ajouterNoteInterne', { jeton: agent, chemin: { id }, corps: { contenu: 'Vérifier le journal du DAB 12' } });
    const liste = await client.appeler('listerMesReclamations', { jeton: jetonClient });
    expect(liste.corps.donnees.map((x: { numero: string }) => x.numero)).toContain(numero);
    const vue = await client.appeler('lireMaReclamation', { jeton: jetonClient, chemin: { id } });
    expect(vue.corps.messages.map((m: { auteur: string }) => m.auteur)).toEqual(['BANQUE']);
    expect(JSON.stringify(vue.corps)).not.toContain('DAB 12');
    expect(vue.corps.operationsPossibles).toEqual(['CONSULTER', 'MESSAGE_DU_CLIENT']);
    const m = await client.appeler('envoyerMessageClient', {
      jeton: jetonClient, chemin: { id }, corps: { contenu: 'Vers 21 h 40, au DAB du Plateau.' },
      fichiers: [{ champ: 'fichiers', nom: 'photo.png', contenu: FICHIERS.png }],
    });
    expect(m.statut).toBe(201);
    expect(m.corps.statut).toBe('EN_COURS');
    const piece = m.corps.messages.at(-1).piecesJointes[0];
    const t = await client.appeler('telechargerPieceJointeClient', { jeton: jetonClient, chemin: { id, pieceId: piece.id } });
    expect(t.statut).toBe(200);
    expect(t.octets.equals(FICHIERS.png)).toBe(true);
    const tb = await client.appeler('telechargerPieceJointe', { jeton: agent, chemin: { id, pieceId: piece.id } });
    expect(tb.entetes.get('content-disposition')).toContain('photo.png');
  });

  it('l\'agent résout ; le client confirme ; la réclamation est clôturée et tout est tracé', async () => {
    const r = await client.appeler('resoudreReclamation', { jeton: agent, chemin: { id }, corps: { reponseFinale: 'Le montant a été recrédité sur votre compte ce jour.' } });
    expect(r.corps.statut).toBe('RESOLUE');
    expect(r.corps.sla.respecte).toBe(true);
    const c = await client.appeler('confirmerResolution', { jeton: jetonClient, chemin: { id } });
    expect(c.statut).toBe(200);
    expect(c.corps.statut).toBe('CLOTUREE');
    expect(c.corps.etapes.map((e: { statut: string }) => e.statut)).toEqual(['OUVERTE', 'EN_COURS', 'EN_ATTENTE_CLIENT', 'EN_COURS', 'RESOLUE', 'CLOTUREE']);
    const suivi = await client.appeler('lireSuivi', { chemin: { jetonSuivi } });
    expect(suivi.corps.statut).toBe('CLOTUREE');
    const fiche = await client.appeler('lireReclamation', { jeton: superviseur, chemin: { id } });
    expect(fiche.corps.cloture.mode).toBe('CONFIRMATION_CLIENT');
    expect(fiche.corps.actionsPossibles).toEqual([]);
    const actions = await bd.enSysteme((tx) => tx.journalAudit.findMany({ where: { entiteId: id }, orderBy: { rang: 'asc' }, select: { action: true } }));
    expect(actions.map((a) => a.action)).toEqual([
      'reclamation.depot', 'reclamation.assignation', 'reclamation.reponse_client', 'client.code_envoye', 'client.session_ouverte',
      'reclamation.note_interne', 'reclamation.message_client', 'reclamation.resolution', 'reclamation.confirmation',
    ]);
  });
});
