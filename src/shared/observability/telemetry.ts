import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

function traceEndpoint(baseEndpoint: string): string {
  const normalized = baseEndpoint.replace(/\/$/, '');
  return normalized.endsWith('/v1/traces') ? normalized : `${normalized}/v1/traces`;
}

export function startTelemetry(): NodeSDK | undefined {
  if (process.env.OTEL_ENABLED !== 'true') {
    return undefined;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'unified-service-scheduler',
    traceExporter: new OTLPTraceExporter({ url: traceEndpoint(endpoint) }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  return sdk;
}

export function registerTelemetryShutdown(telemetry: NodeSDK | undefined): void {
  if (!telemetry) {
    return;
  }

  const shutdown = (): void => {
    void telemetry.shutdown().catch(() => {
      // Process shutdown must not be blocked by an unavailable collector.
    });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
