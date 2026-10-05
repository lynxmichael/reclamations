/**
 * Base de réponses d'exemple (étape 18) : fictive, écrite comme une banque l'écrirait. Elle sert au
 * jeu de données de démonstration, à la démo cliquable, aux tests et au banc d'essai. Chaque banque
 * écrit et valide la sienne (décision I4) : celle-ci n'est qu'un point de départ.
 */
import type { CategorieAssistant, QuestionFrequente } from './assistant.js';

export const FAQ_EXEMPLE: readonly Omit<QuestionFrequente, 'id'>[] = [
  {
    question: 'Quels sont les horaires d\'ouverture des agences ?',
    reponse: 'Nos agences sont ouvertes du lundi au vendredi, de 8 h à 12 h et de 14 h à 17 h 30, sauf les jours fériés. '
      + 'Ce service en ligne reçoit vos réclamations à toute heure.',
  },
  {
    question: 'Comment récupérer une carte avalée par un distributeur ?',
    reponse: 'Si un distributeur de la banque a retenu votre carte, présentez-vous à l\'agence du distributeur avec votre pièce d\'identité. '
      + 'Si c\'est le distributeur d\'une autre banque, déposez une réclamation dans la catégorie Carte bancaire : nous faisons la demande pour vous.',
  },
  {
    question: 'Comment faire opposition sur ma carte perdue ou volée ?',
    reponse: 'Faites opposition tout de suite : appelez le centre d\'opposition, dont le numéro figure dans l\'application et sur vos relevés, '
      + 'à toute heure, ou passez en agence. Ne communiquez jamais votre code secret, même à la banque.',
  },
  {
    question: 'Quels documents faut-il pour ouvrir un compte ?',
    reponse: 'Une pièce d\'identité en cours de validité, un justificatif de domicile récent et une photo d\'identité. '
      + 'Pour un compte professionnel, ajoutez le registre du commerce. Un conseiller en agence vous présentera les offres.',
  },
  {
    question: 'Comment activer l\'application mobile ?',
    reponse: 'Téléchargez l\'application de la banque, choisissez « Première connexion » et suivez les étapes avec votre numéro client et '
      + 'le téléphone enregistré en agence. Si l\'activation échoue, déposez une réclamation dans la catégorie Banque mobile.',
  },
  {
    question: 'Combien de temps prend un virement vers une autre banque ?',
    reponse: 'Un virement vers une autre banque de la zone UEMOA arrive en général en un à deux jours ouvrés ; un virement international peut prendre plus longtemps. '
      + 'Si ce délai est dépassé, déposez une réclamation en indiquant la date et le montant du virement.',
  },
  {
    question: 'Comment suivre ma réclamation ?',
    reponse: 'Après le dépôt, vous recevez par SMS le numéro de votre réclamation. Avec ce numéro et votre téléphone, ouvrez « Suivre ma réclamation » '
      + 'sur cette page : vous y voyez où elle en est et vous pouvez écrire au conseiller.',
  },
  {
    question: 'Quels sont les frais de tenue de compte ?',
    reponse: 'Les frais de tenue de compte dépendent de votre offre : ils figurent dans la brochure tarifaire, en agence et sur le site de la banque, '
      + 'et sur votre relevé. Si un frais vous semble anormal, déposez une réclamation dans la catégorie Frais et prélèvements.',
  },
  {
    question: 'Que faire après un appel ou un message suspect ?',
    reponse: 'La banque ne vous demandera jamais votre code secret, votre mot de passe ni un code reçu par SMS. Ne les donnez à personne. '
      + 'Si vous avez donné un code ou si vous voyez une opération inconnue, écrivez « conseiller » ou déposez une réclamation dans la catégorie Fraude suspectée.',
  },
];

/** Les catégories du jeu de données de démonstration, avec des identifiants lisibles pour les tests. */
export const CATEGORIES_EXEMPLE: readonly CategorieAssistant[] = [
  { id: 'cat-carte', nom: 'Carte bancaire', description: 'Carte bloquée, retrait non abouti, opération inconnue' },
  { id: 'cat-virement', nom: 'Virement et transfert', description: 'Virement non reçu, en retard ou vers un mauvais bénéficiaire' },
  { id: 'cat-mobile', nom: 'Banque mobile', description: 'Accès à l\'application, code secret, paiement mobile' },
  { id: 'cat-frais', nom: 'Frais et prélèvements', description: 'Frais contestés, prélèvement non autorisé' },
  { id: 'cat-fraude', nom: 'Fraude suspectée', description: 'Une opération que vous n\'avez pas faite' },
  { id: 'cat-accueil', nom: 'Accueil en agence', description: 'Temps d\'attente, qualité du service reçu' },
  { id: 'cat-credit', nom: 'Crédit', description: 'Échéance, remboursement anticipé, suivi de dossier' },
];

export const faqExemple = (): QuestionFrequente[] => FAQ_EXEMPLE.map((f, i) => ({ id: `faq-${i + 1}`, ...f }));
