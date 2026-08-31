export { default as securityPlugin } from './plugins/security.js';
export { default as docsPlugin } from './plugins/docs.js';
export { default as metricsPlugin } from './plugins/metrics.js';
export { default as healthRoutes } from './routes/health.js';
export { createMetricsRoutes, type MetricsRoutesDeps } from './routes/metrics.js';
export { ok, type SuccessResponse } from './response-envelope.js';
export { authenticate, requireRole } from './plugins/auth-guard.js';
