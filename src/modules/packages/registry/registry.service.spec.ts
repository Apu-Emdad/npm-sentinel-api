import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { RegistryService } from './registry.service.js';

const jsonResponse = (data: unknown, status = 200) => ({ data, status });

const PACKUMENT = {
  name: 'left-pad',
  'dist-tags': { latest: '1.3.0' },
  time: {
    created: '2014-03-14T00:00:00.000Z',
    modified: '2018-04-01T00:00:00.000Z',
    '1.3.0': '2018-04-01T00:00:00.000Z',
  },
  maintainers: [{ name: 'azer', email: 'azer@example.com' }],
  versions: {
    '1.3.0': {
      version: '1.3.0',
      dependencies: { lodash: '^4.0.0' },
      scripts: { postinstall: 'node setup.js' },
      maintainers: [{ name: 'azer' }],
      _npmUser: { name: 'azer' },
      dist: {
        tarball: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz',
        shasum: 'abc123',
        integrity: 'sha512-xyz',
        unpackedSize: 2048,
      },
    },
  },
};

describe('RegistryService', () => {
  let getMock: ReturnType<typeof vi.spyOn>;
  let registryService: RegistryService;

  beforeEach(() => {
    getMock = vi.spyOn(axios, 'get');
    registryService = new RegistryService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getPackage', () => {
    it('maps the packument to typed metadata', async () => {
      getMock.mockResolvedValue(jsonResponse(PACKUMENT));

      const result = await registryService.getPackage('left-pad');

      expect(result).toEqual({
        name: 'left-pad',
        distTags: { latest: '1.3.0' },
        createdAt: '2014-03-14T00:00:00.000Z',
        modifiedAt: '2018-04-01T00:00:00.000Z',
        maintainers: [{ name: 'azer', email: 'azer@example.com' }],
        versions: [
          {
            version: '1.3.0',
            publishedAt: '2018-04-01T00:00:00.000Z',
            publishedBy: 'azer',
            dependencies: { lodash: '^4.0.0' },
            devDependencies: {},
            optionalDependencies: {},
            peerDependencies: {},
            scripts: { postinstall: 'node setup.js' },
            maintainers: [{ name: 'azer' }],
            tarballUrl:
              'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz',
            shasum: 'abc123',
            integrity: 'sha512-xyz',
            unpackedSize: 2048,
          },
        ],
      });
    });

    it('fills missing fields with empty values', async () => {
      getMock.mockResolvedValue(
        jsonResponse({
          name: 'bare',
          versions: { '1.0.0': { version: '1.0.0' } },
        }),
      );

      const result = await registryService.getPackage('bare');

      expect(result.distTags).toEqual({});
      expect(result.createdAt).toBeNull();
      expect(result.versions[0]).toMatchObject({
        publishedAt: null,
        publishedBy: null,
        dependencies: {},
        scripts: {},
        tarballUrl: null,
      });
    });

    it('encodes scoped package names in the URL', async () => {
      getMock.mockResolvedValue(jsonResponse({ name: '@nestjs/core' }));

      await registryService.getPackage('@nestjs/core');

      expect(getMock.mock.calls[0][0]).toBe(
        'https://registry.npmjs.org/%40nestjs%2Fcore',
      );
    });

    it('throws NotFoundException on 404', async () => {
      getMock.mockResolvedValue(jsonResponse({}, 404));

      await expect(registryService.getPackage('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws a 429 HttpException when rate limited', async () => {
      getMock.mockResolvedValue(jsonResponse({}, 429));

      await expect(
        registryService.getPackage('left-pad'),
      ).rejects.toMatchObject({ status: 429 });
      await expect(registryService.getPackage('left-pad')).rejects.toThrow(
        HttpException,
      );
    });

    it('throws BadGatewayException on other error statuses', async () => {
      getMock.mockResolvedValue(jsonResponse({}, 503));

      await expect(registryService.getPackage('left-pad')).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('throws GatewayTimeoutException when the request times out', async () => {
      getMock.mockRejectedValue(
        new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED'),
      );

      await expect(registryService.getPackage('left-pad')).rejects.toThrow(
        GatewayTimeoutException,
      );
    });

    it('throws BadGatewayException when the registry is unreachable', async () => {
      getMock.mockRejectedValue(
        new AxiosError('getaddrinfo ENOTFOUND', 'ENOTFOUND'),
      );

      await expect(registryService.getPackage('left-pad')).rejects.toThrow(
        BadGatewayException,
      );
    });
  });

  describe('getWeeklyDownloads', () => {
    it('returns the weekly download count', async () => {
      getMock.mockResolvedValue(
        jsonResponse({
          downloads: 1234,
          start: '2026-10-21',
          end: '2026-10-27',
          package: 'left-pad',
        }),
      );

      const result = await registryService.getWeeklyDownloads('left-pad');

      expect(result).toEqual({
        downloads: 1234,
        start: '2026-10-21',
        end: '2026-10-27',
      });
      expect(getMock.mock.calls[0][0]).toBe(
        'https://api.npmjs.org/downloads/point/last-week/left-pad',
      );
    });

    it('throws NotFoundException on 404', async () => {
      getMock.mockResolvedValue(jsonResponse({}, 404));

      await expect(registryService.getWeeklyDownloads('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
