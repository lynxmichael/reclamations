/**
 * Point d'entrée de l'application, dans sa racine Vite (portail/). index.html ne peut pas désigner
 * directement ../src/app/portail/main.tsx : en développement, le navigateur demanderait
 * /src/app/portail/main.tsx, adresse hors de la racine, et recevrait la page HTML à la place du
 * script (« type MIME interdit »). Vite sert ce fichier, puis ses imports hors racine (/@fs/…).
 */
import '../src/app/portail/main';
