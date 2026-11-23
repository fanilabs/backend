import { writeFileSync } from 'fs';
import { join } from 'path';

export interface LoadTestMeasurement {
  name: string;
  throughput: number;
  latency: number;
  errors: number;
}

export interface LoadTestOutput {
  version: '1.0';
  timestamp: string;
  config: {
    connections: number;
    duration: number;
  };
  measurements: LoadTestMeasurement[];
}

export function writeLoadTestJSON(output: LoadTestOutput, path: string = 'load-test-results.json'): void {
  writeFileSync(path, JSON.stringify(output, null, 2));
  console.log(`📊 Load test results written to ${path}`);
}
