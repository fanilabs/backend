import type { ActorActivityCategory } from '@prisma/client';

export type { ActorActivityCategory };

export interface ActorActivity {
  id: string;
  address: string;
  category: ActorActivityCategory;
  occurredAt: Date;
  createdAt: Date;
}

/** v1 is rule-based only — ML-based scoring is explicitly out of scope
 * (ARCHITECTURE.md §4, ROADMAP.md §9). */
export type FraudRuleType =
  'DELIVERY_CREATION_VELOCITY' | 'ESCROW_RELEASE_VELOCITY' | 'DISPUTE_RAISE_VELOCITY';

export interface FraudRuleSignal {
  ruleType: FraudRuleType;
  category: ActorActivityCategory;
  windowHours: number;
  threshold: number;
  count: number;
  triggered: boolean;
}

export interface ActorAssessment {
  address: string;
  flagged: boolean;
  signals: FraudRuleSignal[];
}
