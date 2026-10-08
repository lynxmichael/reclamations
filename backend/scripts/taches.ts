import { BarometresMensuels } from "../src/application/barometre/barometres.js";
import { MoteurIa } from "../src/application/ia/moteur.js";
import { CycleDeVie } from "../src/application/reclamations/cycle-de-vie.js";
import { TachesSla } from "../src/application/reclamations/taches-sla.js";
import {
  lireConfiguration,
  urlPortail,
} from "../src/configuration/configuration.js";
import { BaseDonnees } from "../src/infrastructure/base-de-donnees/base-de-donnees.service.js";
import { creerFournisseur } from "../src/infrastructure/ia/fournisseurs.js";
import { urlsBase } from "./base-de-test.js";

async function principal() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--base");
  const application =
    i >= 0 && args[i + 1]
      ? urlsBase(args[i + 1]!).application
      : process.env.APP_DATABASE_URL;
  if (!application) throw new Error("APP_DATABASE_URL manquante");
  const config = lireConfiguration({
    ...process.env,
    APP_DATABASE_URL: application,
  });
  const bd = new BaseDonnees(application);
  try {
    const taches = new TachesSla(
      bd.base,
      new CycleDeVie(bd.base, {
        lienSuivi: (slug, jeton) =>
          `${urlPortail(config, slug)}/suivi/${jeton}`,
      }),
    );
    console.log(JSON.stringify(await taches.toutes(new Date())));
    if (args.includes("--barometre")) {
      // Le même travail que le worker : le mois écoulé de chaque banque qui a le baromètre, s'il manque
      const ia = config.ia;
      const moteur = new MoteurIa(
        bd,
        ia,
        ia.fournisseur === "regles" ? null : creerFournisseur(ia),
        () => new Date(),
      );
      console.log(
        JSON.stringify(await new BarometresMensuels(bd, moteur).publier()),
      );
    }
  } finally {
    await bd.fermer();
  }
}

principal().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
