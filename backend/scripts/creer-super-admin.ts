/**
 * Premier compte Super Admin d'une installation (développement ou production) : le compte est créé
 * « invité » et son lien d'invitation est affiché (et envoyé par e-mail par le worker). Les Super
 * Admins suivants s'invitent depuis la console.
 *
 *   npm run super-admin -- prenom.nom@makortelecoms.ci Prénom Nom
 *   docker compose -f docker-compose.prod.yml run --rm api node dist/scripts/creer-super-admin.js <e-mail> <prénom> <nom>
 */
import { journaliser } from '../src/infrastructure/audit/journal.js';
import { lireConfiguration } from '../src/configuration/configuration.js';
import { BaseDonnees } from '../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { envoyerInvitation, lienInvitation, nouveauJeton } from '../src/modules/auth/liens.js';

async function principal() {
  const [emailBrut, prenom, ...nom] = process.argv.slice(2);
  const email = emailBrut?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !prenom || nom.length === 0) {
    throw new Error('Usage : creer-super-admin <e-mail> <prénom> <nom>');
  }
  const config = lireConfiguration();
  const bd = new BaseDonnees(config.baseDeDonneesUrl);
  try {
    const jeton = await bd.enSysteme(async (tx) => {
      if (await tx.utilisateur.findUnique({ where: { email }, select: { id: true } })) throw new Error(`${email} a déjà un compte`);
      const u = await tx.utilisateur.create({
        data: { tenantId: null, role: 'SUPER_ADMIN', statut: 'INVITE', email, prenom, nom: nom.join(' ') },
        select: { id: true, tenantId: true, email: true, prenom: true },
      });
      const j = await nouveauJeton(tx, u.id, 'INVITATION', new Date());
      await envoyerInvitation(tx, config, u, null, j);
      await journaliser(tx, { tenantId: null, acteur: 'SYSTEME', action: 'plateforme.super_admin_invite', entite: 'utilisateur', entiteId: u.id, donnees: { origine: 'script' } });
      return j;
    });
    console.log(`Super Admin ${email} invité. Lien d'invitation (valable 7 jours) :\n${lienInvitation(config, jeton)}`);
  } finally {
    await bd.fermer();
  }
}

principal().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
