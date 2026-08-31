import 'reflect-metadata';

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { createOpenApiDocument } from '../src/shared/http/swagger';

async function generateOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();

  const document = createOpenApiDocument(app);
  const outputDirectory = resolve(process.cwd(), 'openapi');
  const outputPath = resolve(outputDirectory, 'openapi.json');

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await app.close();

  process.stdout.write(`OpenAPI document generated at ${outputPath}\n`);
}

void generateOpenApi();
