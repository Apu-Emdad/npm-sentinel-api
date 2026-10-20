import { networkInterfaces } from 'node:os';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { SWAGGER_CUSTOM_CSS, SWAGGER_CUSTOM_JS } from './swagger/swagger-ui.js';

const DOCS_PATH = 'docs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('npm-sentinel API')
    .setDescription('Scan npm packages and get an explained risk score.')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(DOCS_PATH, app, document, {
    jsonDocumentUrl: `${DOCS_PATH}-json`,
    customCss: SWAGGER_CUSTOM_CSS,
    customJsStr: SWAGGER_CUSTOM_JS,
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  printStartupInfo(port);
}

// First non-internal IPv4 address, so the API can be reached from other devices on the network.
function getNetworkAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal)
        return address.address;
    }
  }
  return undefined;
}

function printStartupInfo(port: number): void {
  const networkAddress = getNetworkAddress();
  const docsHost = networkAddress ?? 'localhost';

  const divider = '='.repeat(45);

  const lines = [
    '',
    divider,
    '  npm-sentinel API is running',
    '',
    `  Local:    http://localhost:${port}`,
  ];
  if (networkAddress)
    lines.push(`  Network:  http://${networkAddress}:${port}`);
  lines.push(
    `  Docs:     http://${docsHost}:${port}/${DOCS_PATH}`,
    divider,
    '',
  );

  console.log(lines.join('\n'));
}

await bootstrap();
