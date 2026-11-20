# Event Indexer

## Notifications

Notifications are dispatched through a per-channel sender registry
(`NotificationSenderRegistry`). Each `NotificationChannel` (`EMAIL`, `SMS`,
`PUSH`) resolves to a registered sender at delivery time.

Channel support status:

| Channel | Status | Behavior when unconfigured |
| ------- | ------ | -------------------------- |
| `EMAIL` | Supported | — |
| `SMS`   | Pending provider | Delivery deferred; notification is not marked failed |
| `PUSH`  | Pending provider | Delivery deferred; notification is not marked failed |

When no sender is registered for a channel, the notification is left in its
current non-terminal state and a configuration warning is logged. It is **not**
marked `FAILED`, so `notification_failures_total` only reflects genuine sender
errors. Register a sender for a channel to enable delivery for it.
