/**
 * Chaque écran, dans chacune de ses variantes et pour chaque banque, s'affiche sans erreur et
 * sans valeur manquante ; chaque opération citée existe dans le contrat.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ECRANS, GROUPES } from '../src/maquettes/catalogue';
import { ALPHA, HORIZON, MAINTENANT } from '../src/maquettes/donnees/commun';
import type React from 'react';
import { Agences, lignesCsvAgences } from '../src/ecrans/back-office/Agences';
import { Compte } from '../src/ecrans/back-office/Compte';
import { Personnel } from '../src/ecrans/back-office/Personnel';
import { ENROLEMENT_COMPTE, INDICATEURS_AGENCES } from '../src/maquettes/donnees/agences';
import { AGENCES, IBRAHIM, PAGE_PERSONNEL, PARAMETRES, moi } from '../src/maquettes/donnees/parametrage';
import { INDICATEURS } from '../src/maquettes/donnees/reclamations';
import { OPERATIONS_DU_CONTRAT } from './contrat';
import { Conversations } from '../src/ecrans/back-office/Conversations';
import { PointsDepot } from '../src/ecrans/back-office/PointsDepot';
import { Banques } from '../src/ecrans/plateforme/Banques';
import { Depot } from '../src/ecrans/portail/Depot';
import { envoiDeLaReponse } from '../src/ui/Canaux';
import { POINTS_DEPOT } from '../src/maquettes/donnees/parametrage';
import { CONVERSATION_WHATSAPP, CONVERSATIONS_SUPERVISEUR_TOUTES } from '../src/maquettes/donnees/reclamations';
import { PAGE_BANQUES, PLANS } from '../src/maquettes/donnees/plateforme';
import { formulaire } from '../src/maquettes/donnees/portail';
import { CATEGORIES } from '../src/maquettes/donnees/parametrage';
import { NouvelleReclamation } from '../src/ecrans/back-office/NouvelleReclamation';
import { slugDuPortail } from '../src/app/portail/Portail';
import { REGLES_PIECES, TYPE_DOCX, refusFichier, typeDe } from '../src/ui/ChoixFichiers';
import { PieceJointe } from '../src/ecrans/portail/MaReclamation';
import { FICHE_54, PAGE_SUPERVISEUR } from '../src/maquettes/donnees/reclamations';
import { AYA, SERGE } from '../src/maquettes/donnees/parametrage';
import { ACCUSE_SAISIE_54, FICHE_42, FICHE_53 } from '../src/maquettes/donnees/reclamations';

/** Toutes les combinaisons de variantes d'un écran. */
function combinaisons(e: (typeof ECRANS)[number]): Record<string, string>[] {
  return (e.variantes ?? []).reduce<Record<string, string>[]>(
    (acc, v) => acc.flatMap((c) => v.options.map((o) => ({ ...c, [v.cle]: o.valeur }))),
    [{}],
  );
}

const cas = ECRANS.flatMap((e) =>
  combinaisons(e).flatMap((v) =>
    (e.marque ? [ALPHA, HORIZON] : [ALPHA]).map((banque) => [`${e.groupe}/${e.id} ${JSON.stringify(v)} ${banque.slug}`, e, v, banque] as const),
  ),
);

describe('écrans', () => {
  it('le catalogue couvre les quatre espaces, sans doublon', () => {
    expect(new Set(ECRANS.map((e) => e.groupe))).toEqual(new Set(GROUPES.map((g) => g.cle)));
    expect(new Set(ECRANS.map((e) => e.id)).size).toBe(ECRANS.length);
  });

  it.each(ECRANS.map((e) => [e.id, e] as const))('%s : opérations du contrat', (_id, e) => {
    expect(e.operations.length).toBeGreaterThan(0);
    expect(e.operations.filter((o) => !OPERATIONS_DU_CONTRAT.has(o))).toEqual([]);
  });

  it.each(cas)('%s', (_nom, e, v, banque) => {
    const html = renderToString(<>{e.rendu({ v, banque })}</>);
    const texte = html.replace(/<[^>]+>/g, ' ');
    for (const interdit of ['undefined', 'NaN', 'Invalid Date', '[object Object]']) expect(texte).not.toContain(interdit);
    expect(texte).not.toMatch(/\bnull\b/);
    if (banque.slug === 'horizon') expect(texte).not.toContain('Banque Alpha');
  });
});

describe('étape 19 : activité des agences, Mon compte, règle de la banque', () => {
  const texte = (n: React.ReactNode) => renderToString(<>{n}</>).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/\s+/g, ' ');

  it('les agences des maquettes font le tableau de bord ; l\'export a une ligne par agence, « sans agence » en dernier', () => {
    const lignes = INDICATEURS_AGENCES.agences;
    expect(lignes.reduce((t, l) => t + l.total, 0)).toBe(INDICATEURS.total);
    for (const cle of ['aTraiter', 'enAttenteClient', 'enAlerte', 'enRetard'] as const) {
      expect(lignes.reduce((t, l) => t + l.charge[cle], 0)).toBe(INDICATEURS.charge[cle]);
    }
    for (const l of lignes) expect(l.pointsDepot.reduce((t, p) => t + p.total, 0)).toBe(l.total);
    const csv = lignesCsvAgences(INDICATEURS_AGENCES);
    expect(csv).toHaveLength(lignes.length + 1);
    expect(csv[0]!.slice(0, 4)).toEqual(['Agence', 'Code', 'Ville', 'Active']);
    expect(csv.at(-1)![0]).toBe('Sans agence (lien web, téléphone, WhatsApp ou SMS)');
    expect(texte(<Agences indicateurs={INDICATEURS_AGENCES} ouverte={AGENCES[0]!.id} />)).toContain('Points de dépôt');
  });

  it('Mon compte : activer si elle ne l\'est pas ; désactiver seulement si la banque ne l\'exige pas', () => {
    const base = moi(IBRAHIM, 'AGENT', false);
    const inactive = texte(<Compte moi={base} banque="Banque Alpha" />);
    expect(inactive).toContain('Non activée');
    expect(inactive).toContain('Activer la double authentification');
    const facultative = texte(<Compte moi={{ ...base, totpActif: true }} banque="Banque Alpha" />);
    expect(facultative).toContain('Désactiver');
    const exigee = texte(<Compte moi={{ ...base, totpActif: true, totpObligatoire: true }} banque="Banque Alpha" />);
    expect(exigee).toContain('Votre banque exige la double authentification');
    expect(exigee).not.toContain('Désactiver');
    expect(texte(<Compte moi={base} banque="Banque Alpha" enrolement={ENROLEMENT_COMPTE} />)).toContain('Code affiché par l\'application');
  });

  it('Personnel : la règle de la banque et l\'état de chacun', () => {
    const rendu = (totpObligatoire: boolean) => texte(
      <Personnel page={PAGE_PERSONNEL} plan={PARAMETRES.plan} consommation={PARAMETRES.consommation} modifiable maintenant={MAINTENANT} totpObligatoire={totpObligatoire} />,
    );
    expect(rendu(false)).toContain('Double authentification : facultative');
    expect(rendu(false)).toContain('Sans double authentification');
    expect(rendu(true)).toContain('Double authentification : obligatoire');
    expect(rendu(true)).toContain('Double authentification à activer');
  });
});

describe('étape 20 : WhatsApp et SMS', () => {
  const texte = (n: React.ReactNode) => renderToString(<>{n}</>).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

  it('par où part la réponse : WhatsApp (fenêtre), SMS (SMS facturés), suivi après 24 h', () => {
    const wa = envoiDeLaReponse({ canal: 'WHATSAPP', reponseVers: { canal: 'WHATSAPP', finFenetreLe: '2026-09-26T09:46:00Z' } }, 'Salimata Touré', 'Bonjour');
    expect(wa?.aide).toContain('jusqu\'au 26/09/2026 à 09:46');
    const court = envoiDeLaReponse({ canal: 'SMS', reponseVers: { canal: 'SMS', finFenetreLe: null } }, 'Adama', 'Bonjour, c\'est réglé.');
    expect(court?.aide).toContain('1 SMS facturé');
    const long = envoiDeLaReponse({ canal: 'SMS', reponseVers: { canal: 'SMS', finFenetreLe: null } }, 'Adama', 'é'.repeat(700));
    expect(long).toMatchObject({ ton: 'alerte' });
    expect(long?.aide).toContain('5 SMS facturés — au-delà de 4');
    expect(envoiDeLaReponse({ canal: 'WHATSAPP', reponseVers: { canal: 'WEB', finFenetreLe: null } }, 'X', '')?.aide).toContain('plus de 24 h');
    expect(envoiDeLaReponse({ canal: 'WEB', reponseVers: { canal: 'WEB', finFenetreLe: null } }, 'X', '')).toBeNull();
  });

  it('boîte de réception : le canal de chaque conversation, et l\'aide sous la réponse', () => {
    const t = texte(<Conversations page={CONVERSATIONS_SUPERVISEUR_TOUTES} filtre="toutes" selection={CONVERSATION_WHATSAPP} maintenant={MAINTENANT} />);
    expect(t).toContain('WhatsApp');
    expect(t).toContain('SMS');
    expect(t).toContain('Elle part sur WhatsApp');
    expect(t).toContain('sur WhatsApp ou par SMS');
  });

  it('points de dépôt : les numéros de la banque, lisibles, avec l\'adresse qui ouvre la conversation', () => {
    const t = texte(<PointsDepot agences={AGENCES} points={POINTS_DEPOT} modifiable />);
    expect(t).toContain('+225 27 22 00 00 00');
    expect(t).toContain('+225 27 22 00 00 01');
    expect(t).toContain('Copier le numéro');
  });

  it('console de la plateforme : raccordement dans la fiche ; canaux à cocher seulement une fois raccordés', () => {
    const alpha = texte(<Banques page={PAGE_BANQUES} plans={PLANS} ouverteInitiale={PAGE_BANQUES.donnees[0]!.id} />);
    expect(alpha).toContain('Numéros WhatsApp et SMS');
    expect(alpha).toContain('Mettre à jour le raccordement');
    expect(alpha).toContain('Vide : le jeton actuel est gardé');
    const horizon = texte(<Banques page={PAGE_BANQUES} plans={PLANS} ouverteInitiale={PAGE_BANQUES.donnees[1]!.id} />);
    expect(horizon).toContain('Exige le chat web');
    expect(horizon).toContain('Raccorder le numéro WhatsApp');
  });

  it('portail : « Vous préférez WhatsApp ? » quand la banque l\'a ouvert, pas sinon', () => {
    const saisie = { categorieId: CATEGORIES[0]!.id, description: '', nom: '', telephone: '', email: '', consentement: false, fichiers: [] };
    const avec = texte(<Depot formulaire={formulaire(ALPHA)} saisie={saisie} />);
    expect(avec).toContain('Vous préférez WhatsApp ?');
    expect(avec).toContain('+225 27 22 00 00 00');
    expect(texte(<Depot formulaire={formulaire(HORIZON)} saisie={saisie} />)).not.toContain('WhatsApp');
  });
});

describe('étape 21 : guichet, doublons, réaffectation', () => {
  const texteDe = (el: React.ReactElement) => renderToString(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
  const ecran = (idEcran: string, v: Record<string, string>) => {
    const e = ECRANS.find((x) => x.id === idEcran)!;
    return renderToString(<>{e.rendu({ v, banque: ALPHA })}</>);
  };
  const lisible = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');

  it('fiche d\'un doublon (superviseur) : bandeau, « Du même client », rattacher, renvoyer le lien', () => {
    const html = ecran('ticket-doublon', { fenetre: 'aucune' });
    const texte = lisible(html);
    expect(texte).toContain('Doublon possible.');
    expect(texte).toContain('Du même client');
    expect(texte).toContain('Rattacher à…');
    expect(texte).toContain('Renvoyer le lien de suivi');
    expect(html).toContain(`href="#${FICHE_42.AGENT.id}"`);
    const dialogue = lisible(ecran('ticket-doublon', { fenetre: 'rattacher' }));
    expect(dialogue).toContain('Rattacher ce doublon');
    expect(dialogue).toContain('Rattacher et clôturer');
    expect(dialogue).toContain('ALP-2026-002442');
  });

  it('l\'agente voit le doublon possible sans pouvoir ouvrir ni rattacher la réclamation d\'un autre', () => {
    const html = ecran('ticket', { role: 'AGENT', fenetre: 'aucune' });
    const texte = lisible(html);
    expect(texte).toContain('Doublon possible.');
    expect(texte).toContain('(assignée à un autre agent)');
    expect(texte).not.toContain('Rattacher');
    expect(html).not.toContain(`href="#${FICHE_53.id}"`);
  });

  it('saisie au guichet : dépôt « Au guichet », saisie par l\'agente, chronologie', () => {
    const texte = lisible(ecran('nouvelle-reclamation', { etat: 'fiche' }));
    expect(texte).toContain("Au guichet de l'agence");
    expect(texte).toContain('Saisie par Aya Konan');
    expect(texte).toContain('Saisie pour le client');
  });

  it('récépissé : numéro, QR code du suivi, numéro du client lisible', () => {
    const html = ecran('nouvelle-reclamation', { etat: 'recepisse' });
    const texte = lisible(html);
    expect(texte).toContain(ACCUSE_SAISIE_54.numero);
    expect(texte).toContain('Imprimer le récépissé');
    expect(texte).toContain('+225 01 01 02 03 04');
    expect(html).toContain('class="recepisse');
    expect(html).toContain('aria-label="QR code du suivi de la réclamation"');
  });

  it('formulaire de saisie : erreurs sous les champs ; « Me l\'assigner » pour l\'agent seulement', () => {
    const texte = lisible(ecran('nouvelle-reclamation', { etat: 'erreurs' }));
    expect(texte).toContain("Choisissez l'agence du guichet");
    expect(texte).toContain("Me l'assigner");
    const superviseur = texteDe(
      <NouvelleReclamation banque={ALPHA} moi={moi(SERGE, 'SUPERVISEUR')} categories={[]} agences={[]} regles={REGLES_PIECES} lienPolitique="/politique-donnees" />,
    );
    expect(superviseur).not.toContain("Me l'assigner");
  });

  it('files : « À réassigner » et la sélection pour le superviseur ; ni l\'un ni l\'autre pour l\'agent', () => {
    const sup = lisible(ecran('files', { role: 'SUPERVISEUR', file: 'a-reassigner', notifs: 'fermees' }));
    expect(sup).toContain('À réassigner');
    expect(sup).toContain('2 sélectionnées');
    expect(sup).toContain('Répartir entre les agents disponibles');
    expect(sup).toContain('Nouvelle réclamation');
    expect(sup).toContain('ALP-2026-002447');
    expect(sup).not.toContain('ALP-2026-002442');
    const agent = lisible(ecran('files', { role: 'AGENT', file: 'a-reassigner', notifs: 'fermees' }));
    expect(agent).not.toContain('À réassigner');
    expect(agent).not.toContain('sélectionnée');
    expect(lisible(ecran('files', { role: 'SUPERVISEUR', file: 'defaut', notifs: 'fermees' }))).toContain('Doublon possible');
  });

  it('portail : retrouver ses réclamations, sans dire si le numéro est connu ; suivi d\'un doublon rattaché', () => {
    expect(lisible(ecran('retrouver', { etape: 'contact' }))).toContain('nous ne disons pas si ce numéro');
    expect(lisible(ecran('retrouver', { etape: 'accueil' }))).toContain('Retrouver mes réclamations');
    const html = ecran('suivi', { etat: 'rattachee' });
    expect(lisible(html)).toContain('Jointe à votre autre réclamation');
    expect(html).toContain('href="/suivi/');
    expect(lisible(renderToString(<Depot formulaire={formulaire(ALPHA)} saisie={{ categorieId: '', description: '', nom: '', telephone: '', email: '', consentement: false, fichiers: [] }} />))).toContain('Retrouvez-la');
  });

  it('banque du portail lue dans l\'adresse', () => {
    expect(slugDuPortail('alpha.localhost')).toBe('alpha');
    expect(slugDuPortail('horizon.reclamations.ci')).toBe('horizon');
    expect(slugDuPortail('localhost')).toBeNull();
    expect(slugDuPortail('127.0.0.1')).toBeNull();
    expect(slugDuPortail('www.reclamations.ci')).toBeNull();
  });

  it('absences : réclamations en cours, à réassigner pendant l\'absence', () => {
    const texte = lisible(ecran('absences', {}));
    expect(texte).toContain('2 à réassigner');
    expect(texte).toContain('Réclamations en cours');
    expect(PAGE_PERSONNEL.donnees.find((u) => u.id === AYA.id)!.reclamationsEnCours).toBe(5);
  });
});

describe('étape 22 : envois non remis, pièces jointes', () => {
  const ecran = (idEcran: string, v: Record<string, string>) => {
    const e = ECRANS.find((x) => x.id === idEcran)!;
    return renderToString(<>{e.rendu({ v, banque: ALPHA })}</>);
  };
  const lisible = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

  it('fiche : bandeau du message non remis, « Messages au client » sans le numéro complet, renvoi', () => {
    const texte = lisible(ecran('ticket-envois', { role: 'AGENT', pieces: 'saines' }));
    expect(texte).toContain('Message non remis au client.');
    expect(texte).toContain('« Accusé de dépôt » n\'a pas pu être remis par SMS au +225 01 •• •• •• 04 (téléphone injoignable)');
    expect(texte).toContain('Messages au client');
    expect(texte).toContain('Non remis');
    expect(texte).toContain('Renvoyer');
    expect(texte).not.toContain('01 02 03 04'.replace(/ /g, ''));
    // L'Admin Entreprise consulte : ni bandeau ni bouton
    const admin = lisible(ecran('ticket-envois', { role: 'ADMIN_ENTREPRISE', pieces: 'saines' }));
    expect(admin).toContain('Messages au client');
    expect(admin).not.toContain('Renvoyer');
    expect(admin).not.toContain('Message non remis au client.');
    // Une fiche sans échec : états remis et envoyés, pas de bandeau
    const yao = lisible(ecran('ticket', { role: 'AGENT', fenetre: 'aucune' }));
    expect(yao).toContain('Question de la banque');
    expect(yao).toContain('accepté par le serveur d\'envoi');
    expect(yao).not.toContain('Message non remis au client.');
  });

  it('pièces jointes : téléchargeable une fois saine ; analyse en cours, ou effacée (virus), sans lien', () => {
    const [releve, courrier] = FICHE_54.piecesJointes;
    expect(renderToString(<PieceJointe piece={courrier!} />)).toContain(`href="#${courrier!.id}"`);
    const enCours = renderToString(<PieceJointe piece={{ ...courrier!, antivirus: 'EN_ATTENTE' }} />);
    expect(enCours).not.toContain('href=');
    expect(lisible(enCours)).toContain('Analyse antivirus en cours');
    const virus = lisible(renderToString(<PieceJointe piece={{ ...releve!, antivirus: 'INFECTE' }} />));
    expect(virus).toContain('Effacé : l\'antivirus y a trouvé un virus');
    expect(lisible(ecran('ticket-envois', { role: 'AGENT', pieces: 'virus' }))).toContain('facture-impayee.docx');
  });

  it('choix des fichiers : Word .docx accepté (même sans type connu), .doc et .docm refusés avec la raison, 10 Mo', () => {
    const docx = { name: 'courrier.docx', type: '', size: 40_000 };
    expect(typeDe(docx)).toBe(TYPE_DOCX);
    expect(refusFichier(docx, REGLES_PIECES)).toBeNull();
    expect(refusFichier({ ...docx, type: TYPE_DOCX }, REGLES_PIECES)).toBeNull();
    expect(refusFichier({ name: 'lettre.doc', type: 'application/msword', size: 40_000 }, REGLES_PIECES)).toContain('ancien format Word');
    expect(refusFichier({ name: 'releve.docm', type: 'application/vnd.ms-word.document.macroEnabled.12', size: 40_000 }, REGLES_PIECES)).toContain('macros');
    expect(refusFichier({ name: 'notes.txt', type: 'text/plain', size: 10 }, REGLES_PIECES)).toContain('type non accepté');
    expect(refusFichier({ name: 'scan.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 }, REGLES_PIECES)).toBeNull();
    expect(refusFichier({ name: 'scan.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 + 1 }, REGLES_PIECES)).toContain('plus de 10');
  });

  it('files : « Message non remis » sur la réclamation concernée ; facturation SMS : colonne « Remis »', () => {
    expect(PAGE_SUPERVISEUR.donnees.filter((r) => r.envoiNonRemis).map((r) => r.numero)).toEqual(['ALP-2026-002454']);
    expect(lisible(ecran('files', { role: 'SUPERVISEUR', file: 'defaut', notifs: 'fermees' }))).toContain('Message non remis');
    const activite = lisible(ecran('activite', {}));
    expect(activite).toContain('Remis');
    expect(activite).toContain('Non remis');
  });
});
