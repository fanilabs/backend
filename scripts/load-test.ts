// #590: Fix p97.5 labeled as p95, add expected-status
const latencies = [result.latency.p50, result.latency.p97_5, result.latency.p99];
const targets = [{url, expected: 200}, {url: '/404', expected: 404}];
