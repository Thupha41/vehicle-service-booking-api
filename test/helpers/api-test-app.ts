import type { INestApplication } from '@nestjs/common';

export async function createApiTestApp(): Promise<INestApplication> {
  const [{ Test }, { AppModule }, { createValidationPipe }, { configureSwagger }] =
    await Promise.all([
      import('@nestjs/testing'),
      import('../../src/app.module'),
      import('../../src/shared/http/validation-pipe'),
      import('../../src/shared/http/swagger'),
    ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();

  app.useLogger(false);
  app.useGlobalPipes(createValidationPipe());
  configureSwagger(app);
  await app.init();

  return app;
}
