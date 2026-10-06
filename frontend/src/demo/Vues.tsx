/**
 * Ce qu'affichent le téléphone du client et le navigateur de la banque, à partir de l'état de la
 * démo. Les écrans sont ceux des maquettes de l'étape 6, alimentés par le moteur.
 */
import { useState } from 'react';
import { MessageSquareText, X } from 'lucide-react';
import type { S } from '../api/types';
import { Accuse } from '../ecrans/portail/Accuse';
import { Assistant } from '../ecrans/portail/Assistant';
import { Avis } from '../ecrans/portail/Avis';
import { CodeOtp } from '../ecrans/portail/CodeOtp';
import { Depot } from '../ecrans/portail/Depot';
import { MaReclamation } from '../ecrans/portail/MaReclamation';
import { MesReclamations } from '../ecrans/portail/MesReclamations';
import { Suivi } from '../ecrans/portail/Suivi';
import { Absences } from '../ecrans/back-office/Absences';
import { Agences } from '../ecrans/back-office/Agences';
import { Attribution } from '../ecrans/back-office/Attribution';
import { Audit } from '../ecrans/back-office/Audit';
import { Banque } from '../ecrans/back-office/Banque';
import { CadreBackOffice } from '../ecrans/back-office/CadreBackOffice';
import { Categories } from '../ecrans/back-office/Categories';
import { Compte } from '../ecrans/back-office/Compte';
import { Conversations } from '../ecrans/back-office/Conversations';
import { Files } from '../ecrans/back-office/Files';
import { Horaires } from '../ecrans/back-office/Horaires';
import { Personnel } from '../ecrans/back-office/Personnel';
import { PointsDepot } from '../ecrans/back-office/PointsDepot';
import { ReponsesAssistant } from '../ecrans/back-office/ReponsesAssistant';
import { TableauDeBord } from '../ecrans/back-office/TableauDeBord';
import { Ticket } from '../ecrans/back-office/Ticket';
import { DOMAINE } from '../maquettes/donnees/commun';
import { AGENCES, AGENTS_DES_GROUPES, CATEGORIES, HORAIRES, JOURS_FERIES, PAGE_PERSONNEL, PARAMETRES, POINTS_DEPOT, moi } from '../maquettes/donnees/parametrage';
import { heure } from '../ui/format';
import { SUGGESTIONS, UTILISATEUR, type Demo } from './useDemo';

/* ------------------------------------------------------------------ Téléphone */

export function EcranClient({ d }: { d: Demo }) {
  const { moteur, client: c, actionsClient: a, session } = d;
  const banque = moteur.banquePublique();
  switch (c.e) {
    case 'depot': {
      const f = moteur.formulaire('7K3QX9P2MA');
      return (
        <Depot
          key={c.version}
          formulaire={f}
          saisie={c.saisie}
          erreur={c.erreur}
          surEnvoyer={a.deposer}
          assistant={f.assistant ? { prepare: !!c.via, surRetour: a.assistant } : undefined}
        />
      );
    }
    case 'assistant': {
      const f = moteur.formulaire('7K3QX9P2MA');
      return (
        <Assistant
          banque={banque}
          agence={f.agence?.nom}
          fil={c.fil}
          suggestions={c.tour.suggestions}
          proposition={c.tour.proposition}
          categorie={f.categories.find((x) => x.id === c.tour.proposition?.categorieId)?.nom}
          surEnvoyer={a.ecrireAssistant}
          surProposition={a.accepterProposition}
          surFormulaire={a.nouveauDepot}
        />
      );
    }
    case 'accuse':
      return <Accuse banque={banque} accuse={c.accuse} envoiPar="par SMS et par e-mail" surSuivre={() => a.suivre()} surAutre={a.nouveauDepot} />;
    case 'suivi':
      return <Suivi suivi={moteur.suivi(c.jeton)} surDemanderCode={(canal) => a.demanderCode(c.jeton, canal)} surAvis={() => a.avis(c.jeton)} />;
    case 'avis': {
      const avis = moteur.lireAvis(c.jeton);
      return <Avis key={`${c.jeton}-${avis.etat}`} avis={avis} erreur={c.erreur} surEnvoyer={(r) => a.donnerAvis(c.jeton, r)} surSuivi={() => a.suivre(c.jeton)} />;
    }
    case 'code':
      return (
        <CodeOtp
          banque={banque}
          numero={moteur.suivi(c.jeton).numero}
          otp={c.otp}
          saisi={c.saisi}
          erreur={c.erreur}
          surValider={(code) => a.validerCode(c.jeton, code)}
          surRenvoyer={() => a.demanderCode(c.jeton)}
          surRetour={() => a.suivre(c.jeton)}
        />
      );
    case 'espace':
      return session ? (
        <MesReclamations banque={banque} reclamations={moteur.mesReclamations(session)} surOuvrir={a.ouvrir} surQuitter={a.quitter} />
      ) : null;
    case 'detail':
      return session ? (
        <MaReclamation
          key={c.id}
          banque={banque}
          reclamation={moteur.maReclamation(session, c.id)}
          surRetour={a.espace}
          surQuitter={a.quitter}
          surConfirmer={() => a.confirmer(c.id)}
          surContester={(motif) => a.contester(c.id, motif)}
          surEnvoyer={(texte) => a.envoyer(c.id, texte)}
          surAvis={() => a.avis(moteur.ticket(c.id).jetonSuivi)}
        />
      ) : null;
  }
}

/** Le SMS qui arrive sur le téléphone : on le touche pour ouvrir le lien ou utiliser le code. */
export function NotificationSms({ d }: { d: Demo }) {
  const e = d.sms;
  if (!e) return null;
  const code = e.texte.match(/code est (\d{6})/)?.[1];
  return (
    <div className="absolute inset-x-2.5 top-12 z-20 animate-[arrivee_320ms_ease-out]" data-visite="sms">
      <div className="flex gap-3 rounded-2xl bg-white/95 p-3 text-left shadow-[0_10px_30px_rgb(23_33_43/0.28)] ring-1 ring-black/5 backdrop-blur">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#2fb24c] text-white">
          <MessageSquareText aria-hidden size={19} />
        </span>
        <button type="button" onClick={() => d.actionsClient.ouvrirSms(e)} className="min-w-0 flex-1 text-left">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-bold text-encre">{e.canal === 'SMS' ? d.moteur.banque.nom : 'E-mail'}</span>
            <span className="chiffres shrink-0 text-xs text-encre-3">{heure(e.date.toISOString())}</span>
          </span>
          <span className="mt-0.5 block text-[13px] leading-snug [overflow-wrap:anywhere] text-encre-2">{e.texte}</span>
          <span className="mt-1.5 block text-xs font-bold text-focus">{code ? 'Toucher pour remplir le code' : e.lien ? 'Toucher pour ouvrir le lien' : ''}</span>
        </button>
        <button type="button" aria-label="Fermer la notification" onClick={() => d.actionsClient.fermerSms(e)} className="self-start rounded p-0.5 text-encre-3 hover:bg-fond">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Back-office */

export function adresseBanque(d: Demo) {
  const base = `${d.moteur.banque.slug}.${DOMAINE}/back-office`;
  const { page, ficheId } = d.banque;
  if (ficheId) return `${base}/reclamations/${d.moteur.ticket(ficheId).numero}`;
  if (page === 'conversations' && d.banque.conversationId) return `${base}/conversations/${d.banque.conversationId.slice(-6)}`;
  return `${base}/${{ reclamations: 'reclamations', conversations: 'conversations', tableau: 'tableau-de-bord', agences: 'agences', compte: 'mon-compte', categories: 'parametrage/categories', points: 'parametrage/points-de-depot', horaires: 'parametrage/horaires', banque: 'parametrage/banque', attribution: 'parametrage/attribution', assistant: 'parametrage/assistant', personnel: 'personnel', absences: 'absences', audit: 'journal-audit' }[page]}`;
}

/** Textes proposés dans la fiche de la réclamation de la démo, tant qu'ils servent. */
function suggestionsPour(d: Demo, id: string) {
  if (id !== d.demoId) return { reponse: '', resolution: '' };
  const f = d.moteur.fiche(d.utilisateur, id);
  return { reponse: f.jalons.premiereReponseLe ? '' : SUGGESTIONS.reponse, resolution: SUGGESTIONS.resolution };
}

export function EcranBanque({ d }: { d: Demo }) {
  const { moteur, banque: b, actionsBanque: a, utilisateur } = d;
  const personne = moteur.personne(utilisateur)!;
  const moiCourant = moi(personne, personne.role);
  const maintenant = moteur.maintenant.toISOString();
  const files = moteur.files(utilisateur);
  const parametres: S<'ParametresBanque'> = {
    ...PARAMETRES,
    nom: moteur.banque.nom,
    slug: moteur.banque.slug,
    prefixeTickets: moteur.banque.prefixe,
    couleurPrimaire: moteur.banque.couleur,
    couleurSecondaire: null,
    logoUrl: moteur.banque.logoUrl,
    consommation: { agents: PARAMETRES.consommation.agents, ticketsCeMois: moteur.indicateurs(30).total },
  };
  const points = POINTS_DEPOT.map((p) => (p.canal === 'WHATSAPP' || p.canal === 'SMS' ? p : { ...p, urlDepot: `https://${moteur.banque.slug}.${DOMAINE}/d/${p.code}` }));

  let contenu;
  if (b.ficheId) {
    contenu = (
      <Ticket
        key={`${b.ficheId}-${b.role}`}
        r={moteur.fiche(utilisateur, b.ficheId)}
        agents={moteur.agentsAssignables()}
        delaiClotureJours={PARAMETRES.delaiClotureAutoJours}
        seuil={PARAMETRES.seuilAlerteSlaPourcent}
        actions={d.actionsFiche(b.ficheId)}
        suggestions={suggestionsPour(d, b.ficheId)}
      />
    );
  } else {
    switch (b.page) {
      case 'reclamations':
        contenu = (
          <Files
            key={b.role}
            page={files}
            moi={moiCourant}
            maintenant={maintenant}
            seuil={PARAMETRES.seuilAlerteSlaPourcent}
            fileInitiale={b.role === 'AGENT' ? 'assignees' : files.compteurs.recues > 0 ? 'recues' : 'toutes'}
            surOuvrir={a.ouvrirFiche}
            surExporter={a.exporter}
            surValiderSuggestion={(r, agent) => d.actionsFiche(r.id).assigner?.(agent.id)}
            enAvant={d.demoId}
          />
        );
        break;
      case 'conversations': {
        const filtre = b.filtre ?? 'a-repondre';
        let selection = null;
        try {
          selection = b.conversationId ? moteur.conversation(utilisateur, b.conversationId) : null;
        } catch {
          selection = null;
        }
        contenu = <Conversations page={moteur.conversations(utilisateur, filtre)} filtre={filtre} selection={selection} maintenant={maintenant} actions={d.actionsConversations} />;
        break;
      }
      case 'tableau':
        contenu = (
          <TableauDeBord
            indicateurs={moteur.indicateurs(30, b.role === 'AGENT' ? moiCourant.id : undefined)}
            agent={b.role === 'AGENT'}
            periode="30 derniers jours"
            surExporter={a.exporter}
          />
        );
        break;
      case 'agences':
        // Étape 19 : l'activité de chaque agence, calculée sur les réclamations de la démo
        contenu = <Agences key={b.role} indicateurs={moteur.indicateursAgences(30)} periode="30 derniers jours" ouverte={AGENCES[0]!.id} surExporter={a.exporter} />;
        break;
      case 'compte':
        contenu = <CompteDemo key={moiCourant.id} moi={moiCourant} banque={moteur.banque.nom} />;
        break;
      case 'categories':
        contenu = <Categories categories={CATEGORIES} enEdition={null} minutesParJour={450} />;
        break;
      case 'points':
        contenu = <PointsDepot agences={AGENCES} points={points} modifiable={b.role === 'ADMIN_ENTREPRISE'} />;
        break;
      case 'horaires':
        contenu = <Horaires horaires={HORAIRES} feries={JOURS_FERIES} aujourdhui={maintenant} />;
        break;
      case 'banque':
        contenu = <Banque key={moteur.banque.couleur} parametres={parametres} banque={moteur.banquePublique()} surEnregistrer={a.couleur} />;
        break;
      case 'personnel':
        contenu = (
          <Personnel page={PAGE_PERSONNEL} plan={PARAMETRES.plan} consommation={PARAMETRES.consommation} modifiable={b.role === 'ADMIN_ENTREPRISE'} maintenant={maintenant} />
        );
        break;
      case 'attribution':
        contenu = (
          <Attribution
            regles={moteur.regles()}
            groupes={moteur.groupes()}
            agents={AGENTS_DES_GROUPES}
            modifiable={b.role === 'ADMIN_ENTREPRISE'}
            actions={b.role === 'ADMIN_ENTREPRISE' ? {
              changerMode: a.modeAttribution,
              enregistrerRegles: a.groupesFixes,
              creerGroupe: a.groupesFixes,
              modifierGroupe: a.groupesFixes,
              supprimerGroupe: a.groupesFixes,
            } : undefined}
          />
        );
        break;
      case 'absences':
        contenu = (
          <Absences
            absences={moteur.absencesAVenir()}
            agents={AGENTS_DES_GROUPES.map((x) => ({ id: x.id, nom: x.nom }))}
            aujourdhui={moteur.aujourdhui()}
            actions={{ ajouter: a.ajouterAbsence, supprimer: a.supprimerAbsence }}
          />
        );
        break;
      case 'audit':
        contenu = <Audit journal={moteur.journalAudit()} verification={moteur.verificationJournal()} />;
        break;
      case 'assistant':
        // Démo : la base de réponses du jeu de démonstration, en lecture (l'assistant du portail s'en sert)
        contenu = <ReponsesAssistant reponses={moteur.reponsesAssistant()} />;
        break;
    }
  }

  return (
    <CadreBackOffice
      banque={moteur.banquePublique()}
      moi={moiCourant}
      page={b.ficheId ? 'reclamations' : b.page}
      aTraiter={b.role === 'AGENT' ? files.compteurs.assignees : files.compteurs.recues}
      aRepondre={moteur.conversations(utilisateur).compteurs.aRepondre}
      notifications={moteur.notificationsDe(utilisateur)}
      notificationsOuvertes={b.notifs}
      maintenant={maintenant}
      surNaviguer={a.naviguer}
      surCloche={a.cloche}
      surOuvrirNotification={a.ouvrirFiche}
      surToutLire={a.toutLire}
    >
      {contenu}
    </CadreBackOffice>
  );
}

/**
 * « Mon compte » dans la démo (étape 19) : la double authentification s'active et se désactive pour
 * de faux, avec n'importe quel code à 6 chiffres. Le QR code est celui d'une clé fictive.
 */
function CompteDemo({ moi: m, banque }: { moi: S<'Moi'>; banque: string }) {
  const [actif, setActif] = useState(m.totpActif);
  const secret = 'KRUGS4ZANFZSAZDFNVXWI5DPOR2HAMBR';
  return (
    <Compte
      moi={{ ...m, totpActif: actif }}
      banque={banque}
      actions={{
        preparer: () => ({
          secret,
          otpauthUrl: `otpauth://totp/${encodeURIComponent(`Réclamations Makor (démo):${m.email}`)}?secret=${secret}&issuer=${encodeURIComponent('Réclamations Makor (démo)')}&digits=6&period=30`,
          qrCodeDataUrl: '',
        }),
        confirmer: () => setActif(true),
        desactiver: () => setActif(false),
      }}
    />
  );
}

export { UTILISATEUR };
