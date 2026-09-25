import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DATABASE_URL n'est exigée que par les commandes qui touchent la base (migrate, studio).
// `prisma generate` doit fonctionner sans elle, notamment au postinstall d'un npm install.
const url = process.env.DATABASE_URL;

if (!url) {
  console.warn(
    '\n⚠  DATABASE_URL absente : « prisma generate » fonctionne, mais pas les commandes qui touchent la base.\n' +
      '   Copie backend/.env.example vers backend/.env (PowerShell : Copy-Item .env.example .env).\n',
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: url ? { url } : undefined,
});
