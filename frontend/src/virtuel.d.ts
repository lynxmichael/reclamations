declare module 'virtual:contrat-operations' {
  const operations: Record<
    string,
    {
      methode: string;
      chemin: string;
      resume: string;
      roles: string[];
      corps: 'json' | 'multipart' | null;
      reponse: 'json' | 'fichier' | 'vide';
      securite: 'aucune' | 'personnel' | 'client' | 'cookie';
    }
  >;
  export default operations;
}
