import { parseAddress } from '../../../shared/events/parse.js';

/** Structural inspection only. Neither recognized shape approves a deployed
 * ABI, historical hydration, initial defaults or successful processing.
 */
export function inspectCreationPayload(payload: unknown) {
  let id: unknown;
  let sender: unknown;
  let shape: 'legacy_tuple' | 'reference_struct';
  if (Array.isArray(payload) && payload.length === 2) {
    [id, sender] = payload;
    shape = 'legacy_tuple';
  } else if (
    payload !== null &&
    typeof payload === 'object' &&
    'delivery_id' in payload &&
    'sender' in payload &&
    Object.keys(payload).length === 2
  ) {
    id = payload.delivery_id;
    sender = payload.sender;
    shape = 'reference_struct';
  } else return null;
  // Both reference ABI fields are u64/address; do not accept rounded JS numbers.
  if (typeof id !== 'string' || !/^[0-9]+$/.test(id)) return null;
  const chainDeliveryId = BigInt(id);
  if (chainDeliveryId > (1n << 64n) - 1n) return null;
  const senderAddress = parseAddress(sender);
  if (senderAddress === null) return null;
  return { chainDeliveryId, senderAddress, shape };
}
