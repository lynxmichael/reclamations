/**
 * Réglages fournis par l'application autour des écrans (étape 8). Les maquettes et la démo s'en
 * passent : les valeurs par défaut gardent leur rendu de l'étape 6.
 */
import { createContext } from 'react';
import type { S } from '../api/types';

/** Adresse de la politique de données, en pied du portail. */
export const LienPolitique = createContext<string>('#politique');

/** Téléchargement d'une pièce jointe par l'API (la route exige un jeton : pas de simple lien). */
export const TelechargerPiece = createContext<((piece: S<'PieceJointe'>) => void) | null>(null);
