/**
 * Point d'entrée de l'application, dans sa racine Vite (console/). index.html ne peut pas désigner
 * directement ../src/app/console/main.tsx : en développement, le navigateur demanderait
 * /src/app/console/main.tsx, adresse hors de la racine, et recevrait la page HTML à la place du
 * script (« type MIME interdit »). Vite sert ce fichier, puis ses imports hors racine (/@fs/…).
 */
import '../src/app/console/main';
