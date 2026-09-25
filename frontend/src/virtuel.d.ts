declare module 'virtual:contrat-operations' {
  const operations: Record<string, { methode: string; chemin: string; resume: string; roles: string[] }>;
  export default operations;
}
