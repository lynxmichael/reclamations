/**
 * Client d'API (étape 8) : adresses construites depuis le contrat, paramètres, corps JSON et
 * multipart, jeton selon la sécurité de l'opération, erreurs RFC 9457, renouvellement sur 401.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErreurApi, creerClient, messageErreur } from '../src/api/client';

interface Appel {
  url: string;
  init: RequestInit;
}

function simuler(...reponses: Response[]) {
  const appels: Appel[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    appels.push({ url, init });
    const r = reponses.shift();
    if (!r) throw new Error('réponse non prévue');
    return r;
  });
  return appels;
}

const json = (corps: unknown, statut = 200, entetes: Record<string, string> = {}) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': statut >= 400 ? 'application/problem+json' : 'application/json', ...entetes } });

afterEach(() => vi.unstubAllGlobals());

describe('client d\'API', () => {
  it('construit l\'adresse depuis le contrat : chemin encodé, tableaux répétés, valeurs vides omises', async () => {
    const appels = simuler(json({ donnees: [], pagination: { page: 2, parPage: 25, total: 0 }, compteurs: {} }));
    const appeler = creerClient({ jeton: () => 'j' });
    await appeler('listerReclamations', { requete: { file: 'recues', statut: ['OUVERTE', 'EN_COURS'], recherche: '', page: 2 } });
    expect(appels[0]!.url).toBe('/api/v1/banque/reclamations?file=recues&statut=OUVERTE&statut=EN_COURS&page=2');
    expect(appels[0]!.init.method).toBe('GET');

    simuler(json({}));
    const a2 = simuler(json({ numero: 'X', statut: 'OUVERTE' }));
    await appeler('lireSuivi', { chemin: { jetonSuivi: 'a/b c' } });
    expect(a2[0]!.url).toBe('/api/v1/public/suivi/a%2Fb%20c');
  });

  it('présente le jeton seulement aux opérations protégées', async () => {
    const appels = simuler(json({ banque: {} }), json({ id: 'r' }));
    const appeler = creerClient({ jeton: () => 'secret' });
    await appeler('lireFormulaireDepot', { chemin: { code: 'ABC' } });
    await appeler('lireReclamation', { chemin: { id: 'r' } });
    expect(new Headers(appels[0]!.init.headers).get('authorization')).toBeNull();
    expect(new Headers(appels[1]!.init.headers).get('authorization')).toBe('Bearer secret');
  });

  it('envoie les fichiers en multipart, avec la clé d\'idempotence', async () => {
    const appels = simuler(json({ numero: 'ALP-2026-000001', lienSuivi: 'l', jetonSuivi: 'j' }, 201));
    const appeler = creerClient();
    const photo = new File([new Uint8Array([0x89, 0x50])], 'photo.png', { type: 'image/png' });
    await appeler('deposerReclamation', {
      chemin: { code: 'ABC' },
      entetes: { 'Idempotency-Key': 'cle-1' },
      corps: { categorieId: 'c', description: 'd', nom: 'n', consentement: true, versionPolitique: '2026-09', fichiers: [photo, photo] },
    });
    const corps = appels[0]!.init.body as FormData;
    expect(corps).toBeInstanceOf(FormData);
    expect(corps.getAll('fichiers')).toHaveLength(2);
    expect(corps.get('consentement')).toBe('true');
    expect(new Headers(appels[0]!.init.headers).get('idempotency-key')).toBe('cle-1');
    // Le navigateur fixe lui-même le Content-Type multipart (avec sa frontière)
    expect(new Headers(appels[0]!.init.headers).get('content-type')).toBeNull();
  });

  it('transforme une réponse d\'erreur en ErreurApi portant le problème RFC 9457', async () => {
    simuler(json({ type: '/erreurs/validation', title: 'Requête invalide', status: 400, code: 'VALIDATION', detail: '1 champ à corriger', erreurs: [{ champ: 'nom', message: 'Champ obligatoire' }] }, 400));
    const appeler = creerClient();
    const e = await appeler('connexion', { corps: { email: 'a@b.c', motDePasse: 'x' } }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErreurApi);
    expect((e as ErreurApi).code).toBe('VALIDATION');
    expect((e as ErreurApi).champ('nom')).toBe('Champ obligatoire');
    expect(messageErreur(e)).toBe('1 champ à corriger');
  });

  it('une panne réseau devient une erreur lisible ; Retry-After est conservé', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const e = await creerClient()('lireSante').catch((x: unknown) => x);
    expect((e as ErreurApi).code).toBe('RESEAU');
    simuler(json({ type: '/erreurs/limite', title: 'Trop de requêtes', status: 429, code: 'TROP_DE_REQUETES' }, 429, { 'retry-after': '120' }));
    const e2 = await creerClient()('lireSante').catch((x: unknown) => x);
    expect((e2 as ErreurApi).reessayerDans).toBe(120);
  });

  it('sur un 401, renouvelle le jeton une fois et rejoue la requête', async () => {
    let jeton = 'ancien';
    const appels = simuler(json({ type: '/erreurs/jeton', title: 'Jeton invalide', status: 401, code: 'JETON_INVALIDE' }, 401), json({ id: 'moi' }));
    const appeler = creerClient({
      jeton: () => jeton,
      renouveler: async () => {
        jeton = 'nouveau';
        return true;
      },
    });
    await appeler('lireMoi');
    expect(appels.map((a) => new Headers(a.init.headers).get('authorization'))).toEqual(['Bearer ancien', 'Bearer nouveau']);
  });

  it('sans renouvellement possible, signale la fin de session', async () => {
    simuler(json({ type: '/erreurs/jeton', title: 'Jeton invalide', status: 401, code: 'JETON_INVALIDE' }, 401));
    const fin = vi.fn();
    const e = await creerClient({ jeton: () => 'x', renouveler: async () => false, surDeconnexion: fin })('lireMoi').catch((x: unknown) => x);
    expect((e as ErreurApi).statut).toBe(401);
    expect(fin).toHaveBeenCalledOnce();
  });

  it('un fichier reçu garde son nom (Content-Disposition RFC 5987)', async () => {
    simuler(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename=\"re_u.pdf\"; filename*=UTF-8''re%C3%A7u.pdf" } }));
    const f = await creerClient({ jeton: () => 'j' })('telechargerPieceJointe', { chemin: { id: 'r', pieceId: 'p' } });
    expect(f.nom).toBe('reçu.pdf');
    expect(f.contenu.size).toBe(3);
  });
});
