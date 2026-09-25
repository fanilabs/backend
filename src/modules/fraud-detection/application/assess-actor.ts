import type {
  ActorActivityRepository,
  ActorAssessment,
  Clock,
  FraudRuleType,
} from '../domain/index.js';
import type { ActorActivityCategory } from '../domain/index.js';
import { systemClock } from '../domain/index.js';

export interface AssessActorDeps {
  activityRepository: ActorActivityRepository;
  /**
   * Time base for rule windows — see `../domain/clock.ts`'s header comment
   * for why this must not just be `Date.now()` inline. Defaults to
   * `systemClock` (real wall-clock time) so existing callers/tests are
   * unaffected; production wiring (`../index.ts`) passes a ledger-time-
   * derived clock instead so window boundaries share the same time base as
   * the `occurredAt` values they're compared against, immune to indexer lag.
   */
  clock?: Clock;
}

export interface AssessActorInput {
  address: string;
}

interface RuleDefinition {
  ruleType: FraudRuleType;
  category: ActorActivityCategory;
  windowHours: number;
  threshold: number;
}

/**
 * v1 fixed thresholds, chosen as reasonable defaults rather than tuned
 * against real traffic (none exists yet — no FaniLab contracts are
 * deployed anywhere reachable from this repository, `EVENT_INDEXER.md`).
 * Config-driven/tunable thresholds and ML-based scoring are both
 * documented future work (`ROADMAP.md` §9), not built speculatively here.
 */
const RULES: RuleDefinition[] = [
  {
    ruleType: 'DELIVERY_CREATION_VELOCITY',
    category: 'DELIVERY_CREATED',
    windowHours: 1,
    threshold: 10,
  },
  {
    ruleType: 'ESCROW_RELEASE_VELOCITY',
    category: 'ESCROW_RELEASED',
    windowHours: 1,
    threshold: 10,
  },
  {
    ruleType: 'DISPUTE_RAISE_VELOCITY',
    category: 'DISPUTE_RAISED',
    windowHours: 24,
    threshold: 3,
  },
];

/**
 * Builds the "assess actor" use case: given an actor's address, it evaluates
 * every fraud rule in {@link RULES} against that actor's recorded activity and
 * returns a fresh {@link ActorAssessment} verdict.
 *
 * Each rule counts the actor's `ActorActivity` entries of a given category
 * within a rolling time window (measured against `deps.clock`, defaulting to
 * `systemClock`) and marks the rule as triggered when that count exceeds the
 * rule's threshold. The actor is flagged when any rule triggers. Nothing is
 * persisted — every call re-evaluates from scratch, so a verdict can never go
 * stale (same rationale as `record-actor-activity-from-event.ts`).
 *
 * @param deps - Dependencies for the use case:
 *   - `activityRepository`: source of the actor's recorded activity, queried
 *     per rule via `countSince(address, category, since)`.
 *   - `clock` (optional): time base for the rule windows; defaults to
 *     `systemClock` when omitted.
 * @returns An async `assessActor` function that takes an {@link AssessActorInput}
 *   (`{ address }`) and resolves to an {@link ActorAssessment} containing the
 *   assessed `address`, a `flagged` boolean, and the per-rule `signals`
 *   (each with its `ruleType`, `category`, `windowHours`, `threshold`, observed
 *   `count`, and `triggered` flag).
 */
export function createAssessActorUseCase(deps: AssessActorDeps) {
  const clock = deps.clock ?? systemClock;

  return async function assessActor(input: AssessActorInput): Promise<ActorAssessment> {
    const now = (await clock.now()).getTime();
    const signals = await Promise.all(
      RULES.map(async (rule) => {
        const since = new Date(now - rule.windowHours * 60 * 60 * 1000);
        const count = await deps.activityRepository.countSince(input.address, rule.category, since);
        return {
          ruleType: rule.ruleType,
          category: rule.category,
          windowHours: rule.windowHours,
          threshold: rule.threshold,
          count,
          triggered: count > rule.threshold,
        };
      }),
    );

    return {
      address: input.address,
      flagged: signals.some((signal) => signal.triggered),
      signals,
    };
  };
}
