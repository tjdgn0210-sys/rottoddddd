export type CharacterRarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'LIMITED';

export interface CharacterUnlockRequirement {
  type: 'POINTS' | 'WEEKLY_STREAK' | 'EVENT';
  amount?: number;
  eventId?: string;
}

export interface CharacterSkin {
  id: string;
  name: string;
  assetKey?: string;
}

export interface Character {
  id: string;
  name: string;
  rarity: CharacterRarity;
  defaultSkinId: string;
  skins: CharacterSkin[];
  unlockRequirement?: CharacterUnlockRequirement;
  revealStageKey: string;
}

export interface UserCharacter {
  characterId: string;
  ownedSkinIds: string[];
  equippedSkinId: string;
  acquiredAt: string;
}

export interface PointBalance {
  available: number;
  lifetimeEarned: number;
}

export const POINT_POLICY = {
  scope: 'APP_INTERNAL',
  transferable: false,
  redeemableForCash: false,
  convertibleToExternalMonetaryValue: false,
} as const;

export const DEFAULT_CHARACTER: Character = {
  id: 'default',
  name: 'Mori',
  rarity: 'COMMON',
  defaultSkinId: 'default',
  skins: [{ id: 'default', name: '기본' }],
  revealStageKey: 'default',
};
