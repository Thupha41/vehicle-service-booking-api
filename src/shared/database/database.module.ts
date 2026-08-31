import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
        retryAttempts: 5,
        retryDelay: 2_000,
        logging:
          config.get<string>('NODE_ENV') === 'development'
            ? (['error', 'warn'] as const)
            : (['error'] as const),
      }),
    }),
  ],
})
export class DatabaseModule {}
