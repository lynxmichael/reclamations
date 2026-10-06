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
    expect(csv.at(-1)![0]).toBe('Sans agence (lien web, WhatsApp ou SMS)');
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
