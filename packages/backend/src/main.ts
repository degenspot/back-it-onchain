import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ValidationError } from 'class-validator';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];
  app.enableCors({ origin: allowedOrigins });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          title: 'Bad Request',
          detail: 'One or more validation errors occurred.',
          violations: flattenValidationErrors(errors),
        }),
    }),
  );
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap().catch((err) => console.error(err));

function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): Array<{ field: string; message: string }> {
  return errors.flatMap((error) => {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const constraintMessages = Object.values(error.constraints ?? {}).map((message) => ({
      field,
      message,
    }));
    const childMessages = flattenValidationErrors(error.children ?? [], field);

    return [...constraintMessages, ...childMessages];
  });
}
