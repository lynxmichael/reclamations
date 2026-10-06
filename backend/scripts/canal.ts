/**
 * Étape 20 — simule un client qui écrit au numéro WhatsApp ou SMS d'une banque, en développement :
 * le message part signé comme Meta ou la passerelle SMS le signeraient, vers l'API qui tourne
 * (webhooks), puis les réponses automatiques mises en boîte d'envoi sont affichées. Les réponses des
 * agents et l'accusé de dépôt partent ensuite par le worker (son journal, WHATSAPP_ENVOI=journal).
 *
 *   npm run canal -- whatsapp 0707070707 "Bonjour"          (Banque Alpha du jeu de démonstration)
 *   npm run canal -- sms 0707070707 "Mon virement n'est pas arrivé"
 *   npm run canal -- whatsapp 0707070707 "Bonjour" --nom "Awa Konan" --banque <phone_number_id>
 *   docker compose exec api npm run canal -- whatsapp 0707070707 "OUI"
 *
 * Variables : API_URL (http://localhost:3000/api/v1), WHATSAPP_SECRET_APP, SMS_ENTRANT_SECRET.
 */
import { randomUUID } from 'node:crypto';
import { CANAUX_DEMO } from './jeu-de-donnees.js';
import { lireConfiguration } from '../src/configuration/configuration.js';
import { normaliserTelephone } from '../src/domaine/contact.js';
import { BaseDonnees } from '../src/infrastructure/base-de-donnees/base-de-donnees.service.js';
import { signer } from '../src/infrastructure/canaux/whatsapp.js';

function option(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function principal() {
  const [canal, numero, ...reste] = process.argv.slice(2).filter((a, i, t) => !a.startsWith('--') && !t[i - 1]?.startsWith('--'));
  if ((canal !== 'whatsapp' && canal !== 'sms') || !numero || !reste.length) {
    console.error('Usage : npm run canal -- whatsapp|sms <numéro du client> "<message>" [--nom "Prénom Nom"] [--banque <identifiant>]');
    process.exit(2);
  }
  const config = lireConfiguration();
  if (config.production) throw new Error('Simulation réservée au développement');
  const texte = reste.join(' ');
  const de = normaliserTelephone(numero)!;
  const api = (process.env.API_URL ?? `http://localhost:${config.port}/api/v1`).replace(/\/+$/, '');
  const debut = new Date();

  let url: string;
  let corps: unknown;
  let entete: Record<string, string>;
  if (canal === 'whatsapp') {
    if (!config.whatsapp.secretApp) throw new Error('WHATSAPP_SECRET_APP manquant');
    corps = {
      object: 'whatsapp_business_account',
      entry: [{
        id: CANAUX_DEMO.whatsapp.compte,
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: CANAUX_DEMO.whatsapp.numero.slice(1), phone_number_id: option('banque') ?? CANAUX_DEMO.whatsapp.identifiant },
            contacts: [{ wa_id: de.slice(1), profile: { name: option('nom') ?? 'Client WhatsApp' } }],
            messages: [{ from: de.slice(1), id: `wamid.simulation.${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texte } }],
          },
        }],
      }],
    };
    url = `${api}/webhooks/whatsapp`;
    entete = { 'X-Hub-Signature-256': signer(JSON.stringify(corps), config.whatsapp.secretApp) };
  } else {
    if (!config.smsEntrantSecret) throw new Error('SMS_ENTRANT_SECRET manquant');
    corps = { id: `sms-simulation-${randomUUID()}`, de, vers: option('banque') ?? CANAUX_DEMO.sms.numero, texte };
    url = `${api}/webhooks/sms`;
    entete = { 'X-Signature': signer(JSON.stringify(corps), config.smsEntrantSecret) };
  }

  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...entete }, body: JSON.stringify(corps) });
  console.log(`${canal === 'whatsapp' ? 'WhatsApp' : 'SMS'} de ${de} : « ${texte} » → HTTP ${r.status}`);
  if (!r.ok) {
    console.log(await r.text());
    process.exit(1);
  }

  // Réponses écrites pendant le traitement, avant leur envoi par le worker (texte effacé ensuite)
  const bd = new BaseDonnees(config.baseDeDonneesUrl);
  try {
    const reponses = await bd.enSysteme((tx) => tx.notification.findMany({
      where: { destination: de, creeLe: { gte: debut }, canal: { in: ['WHATSAPP', 'SMS'] } }, orderBy: { creeLe: 'asc' },
      select: { canal: true, modele: true, contenu: true, expediteur: true },
    }));
    if (!reponses.length) console.log('(aucune réponse automatique)');
    for (const n of reponses) {
      console.log(`\n← ${n.canal}${n.expediteur ? ` de ${n.expediteur}` : ''} (${n.modele}) :\n${n.contenu}`);
    }
  } finally {
    await bd.fermer();
  }
}

principal().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
