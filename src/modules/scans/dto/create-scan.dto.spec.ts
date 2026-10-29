import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateScanDto } from './create-scan.dto.js';

const errorsFor = (body: object) =>
  validateSync(plainToInstance(CreateScanDto, body)).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

describe('CreateScanDto', () => {
  it.each(['left-pad', '@nestjs/core', 'lodash.get', 'a'])(
    'accepts the package name %s',
    (packageName) => {
      expect(errorsFor({ packageName })).toEqual([]);
    },
  );

  it.each(['', 'Left Pad', '../etc/passwd', '@scope', '_hidden', 'a/b'])(
    'rejects the package name "%s"',
    (packageName) => {
      expect(errorsFor({ packageName })).not.toEqual([]);
    },
  );

  it.each(['1.2.3', '1.0.0-beta.1', '2.0.0+build.5'])(
    'accepts the version %s',
    (version) => {
      expect(errorsFor({ packageName: 'left-pad', version })).toEqual([]);
    },
  );

  it.each(['latest', '^1.2.3', '1.2', '>=1.0.0'])(
    'rejects the version %s',
    (version) => {
      expect(errorsFor({ packageName: 'left-pad', version })).toEqual([
        'Version must be an exact version like 1.2.3',
      ]);
    },
  );

  it('trims the package name', () => {
    const dto = plainToInstance(CreateScanDto, { packageName: '  left-pad ' });

    expect(dto.packageName).toBe('left-pad');
  });
});
