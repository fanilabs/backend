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
  /** Optional environment-configured rules; omitted callers retain RULES. */
  ruleDefinitions?: RuleDefinition[];
  /**
   * Optional alert publisher invoked whenever an assessment flags an actor.
   * Receives the full {@link ActorAssessment} (address + per-rule signals) so
   * the consumer can dispatch an admin security notification or alert
   * webhook with the triggered signals. Omitted in tests/callers that don't
   * care about alerting; the verdict is unaffected either way.
   */
  alertPublisher?: ActorFlaggedAlertPublisher;
}

/**
 * Publishes an `actor_flagged` alert for a flagged {@link ActorAssessment}.
 * Implementations should be resilient (e.g. swallow/log transport errors) so
 * a failing alert channel never breaks fraud assessment itself.
 */
export type ActorFlaggedAlertPublisher = (assessment: ActorAssessment) => Promise<void>;

export interface AssessActorInput {
  address: string;
}

export interface RuleDefinition {
  ruleType: FraudRuleType;
  category: ActorActivityCategory;
  windowHours: number;
  threshold: number;
}

/**
 * v1 fixed thresholds, chosen as reasonable defaults rather than tuned
 * against real traffic (none exists yet — no FaniLab contracts are
 * deployed anywhere reachable from this repository, `EVENT_INDEXER.md`).
 * These remain the fallback when no `ruleDefinitions` override is supplied;
 * environment-specific tuning is wired in `../index.ts` via `env.ts`.
 */
export const RULES: RuleDefinition[] = [
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
 * every fraud rule in {@link RULES} (or `deps.ruleDefinitions` when supplied)
 * against that actor's recorded activity and returns a fresh
 * {@link ActorAssessment} verdict.
 *
 * Each rule counts the actor's `ActorActivity` entries of a given category
 * within a rolling time window (measured against `deps.clock`, defaulting to
 * `systemClock`) and marks the rule as triggered when that count exceeds the
 * rule's threshold. The actor is flagged when any rule triggers. Nothing is
 * persisted — every call re-evaluates from scratch, so a verdict can never go
 * stale (same rationale as `record-actor-activity-from-event.ts`).
 *
 * When the verdict flags the actor and `deps.alertPublisher` is configured,
 * an `actor_flagged` alert is published with the full assessment (address and
 * per-rule signals) so operators are notified in real time instead of having
 * to poll for flagged actors.
 *
 * Counts are capped at `threshold + 1` (passed as `countSince`'s `limit`):
 * once that many rows are observed the rule is guaranteed to trigger, so the
 * repository can short-circuit instead of counting every excess row for
 * high-volume/spam actors. The capped count still satisfies the `>` threshold
 * comparison, so the verdict is unchanged.
 *
 * @param deps - Dependencies for the use case:
 *   - `activityRepository`: source of the actor's recorded activity, queried
 *     per rule via `countSince(address, category, since, limit)`.
 *   - `clock` (optional): time base for the rule windows; defaults to
 *     `systemClock` when omitted.
 *   - `alertPublisher` (optional): invoked with the assessment when the actor
 *     is flagged, to dispatch an `actor_flagged` admin/security alert.
 * @returns An async `assessActor` function that takes an {@link AssessActorInput}
 *   (`{ address }`) and resolves to an {@link ActorAssessment} containing the
 *   assessed `address`, a `flagged` boolean, and the per-rule `signals`
 *   (each with its `ruleType`, `category`, `windowHours`, `threshold`, observed
 *   `count`, and `triggered` flag).
 */
export function createAssessActorUseCase(deps: AssessActorDeps) {
  const clock = deps.clock ?? systemClock;
  const rules = deps.ruleDefinitions ?? RULES;

  return async function assessActor(input: AssessActorInput): Promise<ActorAssessment> {
    const now = (await clock.now()).getTime();
    const signals = await Promise.all(
      rules.map(async (rule) => {
        const since = new Date(now - rule.windowHours * 60 * 60 * 1000);
        const count = await deps.activityRepository.countSince(
          input.address,
          rule.category,
          since,
          rule.threshold + 1,
        );
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

    const assessment: ActorAssessment = {
      address: input.address,
      flagged: signals.some((signal) => signal.triggered),
      signals,
    };

    if (assessment.flagged && deps.alertPublisher) {
      await deps.alertPublisher(assessment);
    }

    return assessment;
  };
}
