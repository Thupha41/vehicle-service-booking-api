import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: TypeOrmHealthIndicator,
  ) {}

  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Check whether the API process is alive' })
  @ApiOkResponse({ description: 'The API process is alive.' })
  live(): Promise<HealthCheckResult> {
    return this.health.check([() => Promise.resolve({ api: { status: 'up' as const } })]);
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Check whether the API can reach PostgreSQL' })
  @ApiOkResponse({ description: 'The API and PostgreSQL are ready.' })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([() => this.database.pingCheck('database', { timeout: 1_000 })]);
  }
}
