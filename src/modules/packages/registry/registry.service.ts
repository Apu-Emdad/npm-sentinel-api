import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import type {
  RawDownloads,
  RawPackument,
  RegistryDownloads,
  RegistryPackage,
} from './registry.types.js';

const REGISTRY_URL = 'https://registry.npmjs.org';
const DOWNLOADS_URL = 'https://api.npmjs.org/downloads/point/last-week';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Reads package data from the public npm registry.
 *
 * Only JSON metadata is fetched. Package code is never downloaded or run.
 */
@Injectable()
export class RegistryService {
  async getPackage(name: string): Promise<RegistryPackage> {
    const raw = await this.request<RawPackument>(
      `${REGISTRY_URL}/${encodeURIComponent(name)}`,
      name,
    );

    return {
      name: raw.name,
      distTags: raw['dist-tags'] ?? {},
      createdAt: raw.time?.created ?? null,
      modifiedAt: raw.time?.modified ?? null,
      maintainers: raw.maintainers ?? [],
      versions: Object.values(raw.versions ?? {}).map((version) => ({
        version: version.version,
        publishedAt: raw.time?.[version.version] ?? null,
        publishedBy: version._npmUser?.name ?? null,
        dependencies: version.dependencies ?? {},
        devDependencies: version.devDependencies ?? {},
        optionalDependencies: version.optionalDependencies ?? {},
        peerDependencies: version.peerDependencies ?? {},
        scripts: version.scripts ?? {},
        maintainers: version.maintainers ?? [],
        tarballUrl: version.dist?.tarball ?? null,
        shasum: version.dist?.shasum ?? null,
        integrity: version.dist?.integrity ?? null,
        unpackedSize: version.dist?.unpackedSize ?? null,
      })),
    };
  }

  async getWeeklyDownloads(name: string): Promise<RegistryDownloads> {
    const raw = await this.request<RawDownloads>(
      `${DOWNLOADS_URL}/${encodeURIComponent(name)}`,
      name,
    );

    return { downloads: raw.downloads, start: raw.start, end: raw.end };
  }

  private async request<T>(url: string, name: string): Promise<T> {
    // validateStatus lets every HTTP status through, so only network errors reach .catch().
    const response = await axios
      .get<T>(url, {
        headers: { accept: 'application/json' },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      })
      .catch((error: unknown) => {
        if (
          axios.isAxiosError(error) &&
          (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
        ) {
          throw new GatewayTimeoutException('npm registry timed out');
        }
        throw new BadGatewayException('npm registry is unreachable');
      });

    if (response.status === HttpStatus.NOT_FOUND) {
      throw new NotFoundException(`Package "${name}" was not found`);
    }
    if (response.status === HttpStatus.TOO_MANY_REQUESTS) {
      throw new HttpException(
        'npm registry rate limit reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new BadGatewayException(
        `npm registry responded with status ${response.status}`,
      );
    }

    return response.data;
  }
}
