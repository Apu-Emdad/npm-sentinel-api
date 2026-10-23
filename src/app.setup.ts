import { INestApplication, ValidationPipe } from '@nestjs/common';

// Shared by main.ts and the e2e tests, so tests run the app with the same pipes.
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
