import { Injectable } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export type BookingConflictReason = 'slot_conflict' | 'idempotency_key_reused';

export type BookingResourceUnavailableReason =
  | 'outside_business_hours'
  | 'no_qualified_technician'
  | 'no_compatible_service_bay';

export type BookingTransactionOutcome =
  | 'confirmed'
  | 'idempotent_replay'
  | 'conflict'
  | 'resource_unavailable'
  | 'error';

export type AvailabilityCheckOutcome = 'available' | 'unavailable' | 'error';

export type SchedulingSpanName =
  | 'availability.check'
  | 'appointment.book'
  | 'appointment.book.transaction';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly tracer = trace.getTracer('unified-service-scheduler', '1.0.0');

  private readonly httpRequests = new Counter({
    name: 'uss_http_requests_total',
    help: 'Total number of HTTP requests handled by the service.',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registry],
  });

  private readonly httpDuration = new Histogram({
    name: 'uss_http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly activeRequests = new Gauge({
    name: 'uss_http_active_requests',
    help: 'Number of HTTP requests currently being processed.',
    registers: [this.registry],
  });

  private readonly bookingAttempts = new Counter({
    name: 'uss_booking_attempt_total',
    help: 'Total number of appointment booking requests received.',
    registers: [this.registry],
  });

  private readonly bookingConfirmed = new Counter({
    name: 'uss_booking_confirmed_total',
    help: 'Total number of newly confirmed appointments.',
    registers: [this.registry],
  });

  private readonly bookingConflicts = new Counter({
    name: 'uss_booking_conflict_total',
    help: 'Total number of booking conflicts by stable reason.',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });

  private readonly bookingResourceUnavailable = new Counter({
    name: 'uss_booking_resource_unavailable_total',
    help: 'Total number of bookings rejected because a required resource was unavailable.',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });

  private readonly bookingTransactionDuration = new Histogram({
    name: 'uss_booking_transaction_duration_seconds',
    help: 'Booking transaction duration in seconds by low-cardinality outcome.',
    labelNames: ['outcome'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly availabilityCheckDuration = new Histogram({
    name: 'uss_availability_check_duration_seconds',
    help: 'Availability check duration in seconds by low-cardinality outcome.',
    labelNames: ['outcome'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({
      service: process.env.OTEL_SERVICE_NAME ?? 'unified-service-scheduler',
    });
    collectDefaultMetrics({ register: this.registry, prefix: 'uss_' });
  }

  requestStarted(): void {
    this.activeRequests.inc();
  }

  requestCompleted(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const labels = {
      method,
      route,
      status_code: String(statusCode),
    };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, durationSeconds);
    this.activeRequests.dec();
  }

  recordBookingAttempt(): void {
    this.bookingAttempts.inc();
  }

  recordBookingConfirmed(): void {
    this.bookingConfirmed.inc();
  }

  recordBookingConflict(reason: BookingConflictReason): void {
    this.bookingConflicts.inc({ reason });
  }

  recordBookingResourceUnavailable(reason: BookingResourceUnavailableReason): void {
    this.bookingResourceUnavailable.inc({ reason });
  }

  startBookingTransactionTimer(): (outcome: BookingTransactionOutcome) => number {
    const stopTimer = this.bookingTransactionDuration.startTimer();
    return (outcome) => stopTimer({ outcome });
  }

  startAvailabilityCheckTimer(): (outcome: AvailabilityCheckOutcome) => number {
    const stopTimer = this.availabilityCheckDuration.startTimer();
    return (outcome) => stopTimer({ outcome });
  }

  withSchedulingSpan<T>(name: SchedulingSpanName, operation: () => Promise<T>): Promise<T> {
    return this.tracer.startActiveSpan(name, async (span) => {
      try {
        const result = await operation();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'Scheduling operation failed',
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
