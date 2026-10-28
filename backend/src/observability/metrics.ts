import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

type Unit = 'Count' | 'Milliseconds';

export function emitMetric(name: string, value: number, unit: Unit = 'Count'): void {
  logger.info(
    {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'Relay/Application',
            Dimensions: [['Service', 'Environment']],
            Metrics: [{ Name: name, Unit: unit }],
          },
        ],
      },
      Service: 'relay-api',
      Environment: env.NODE_ENV,
      [name]: value,
    },
    'Application metric',
  );
}
