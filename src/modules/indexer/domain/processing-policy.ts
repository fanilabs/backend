/** Requirements are catalogued independently of process-local listeners.
 * Version 1 admits obligations only. No consumer is approved for replay yet.
 */
export const PROCESSING_POLICY_VERSION = 1;
export const CONSUMER_IDS = [
  'deliveries',
  'escrow',
  'disputes',
  'reputation',
  'fleet',
  'fraud-activity',
  'notification-intent',
] as const;
export type ConsumerId = (typeof CONSUMER_IDS)[number];

const requiredByEvent: Readonly<Record<string, readonly ConsumerId[]>> = {
  'delivery.DeliveryInTransit': ['deliveries', 'notification-intent'],
  'delivery.delivery_cancelled': ['deliveries', 'notification-intent'],
  'delivery.delivery_confirmed': ['deliveries', 'notification-intent'],
  'delivery.delivery_created': ['deliveries', 'fraud-activity'],
  'delivery.delivery_disputed': ['deliveries'],
  'delivery.driver_assigned': ['deliveries', 'notification-intent'],
  'dispute-resolution.dispute_raised': ['disputes', 'notification-intent'],
  'dispute-resolution.dispute_resolved_payout': ['disputes', 'notification-intent'],
  'dispute-resolution.dispute_resolved_refund': ['disputes', 'notification-intent'],
  'dispute-resolution.dispute_resolved_split': ['disputes', 'notification-intent'],
  'escrow.delivery_disputed': ['escrow', 'disputes', 'fraud-activity', 'notification-intent'],
  'escrow.dispute_resolved': ['escrow', 'disputes'],
  'escrow.escrow_funded': ['escrow'],
  'escrow.escrow_refunded': ['escrow', 'notification-intent'],
  'escrow.escrow_released': ['escrow', 'fraud-activity', 'notification-intent'],
  'fleet.driver_invited': ['fleet', 'notification-intent'],
  'fleet.driver_removed': ['fleet', 'notification-intent'],
  'fleet.fleet_registered': ['fleet', 'notification-intent'],
  'fleet.fleet_treasury_updated': ['fleet'],
  'fleet.invite_accepted': ['fleet', 'notification-intent'],
  'identity-reputation.driver_registered': ['reputation', 'notification-intent'],
  'identity-reputation.kyc_status_updated': ['reputation', 'notification-intent'],
  'identity-reputation.reputation_decreased': ['reputation', 'notification-intent'],
  'identity-reputation.reputation_increased': ['reputation', 'notification-intent'],
};

export function processingPolicy(contractName: string, topic: readonly string[]) {
  const eventType = `${contractName}.${topic[0] ?? ''}`;
  const required = requiredByEvent[eventType];
  if (required) return { required, reason: 'consumer_recovery_not_verified' };
  // Explicitly unresolved, as requested: no invented users projection.
  if (eventType === 'identity-reputation.user_registered') {
    return { required: [], reason: 'users_projection_unresolved' };
  }
  // Empty catalog entries do not imply success, including administrative events.
  return { required: [], reason: 'event_policy_unresolved' };
}

export function missingRequiredConsumers(
  required: readonly ConsumerId[],
  registered: readonly ConsumerId[],
): ConsumerId[] {
  return required.filter((id) => !registered.includes(id));
}
