import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import axios, { type AxiosRequestConfig } from 'axios';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { extract } from 'tar-stream';
import type {
  PackageFile,
  RawDownloads,
  RawPackument,
  RegistryDownloads,
  RegistryPackage,
} from './registry.types.js';

const REGISTRY_URL = 'https://registry.npmjs.org';
const DOWNLOADS_URL = 'https://api.npmjs.org/downloads/point/last-week';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TARBALL_BYTES = 50 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;

const gunzipAsync = promisify(gunzip);

/**
 * Reads package data from the public npm registry.
 *
 * Fetches JSON metadata and, for a scan, the version tarball. The tarball is
 * unpacked in memory only; package code is never written to disk or run.
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

  /**
   * Downloads a version tarball and returns the files inside it
   *
   * Everything stays in memory. Only regular files are kept: symlinks, folders
   * and paths that are absolute or contain `..` are skipped. The `package/`
   * folder every tarball starts with is removed from the paths. A tarball
   * over 50 MB, or over 200 MB once unzipped, throws PayloadTooLargeException.
   */
  async getFiles(tarballUrl: string, name: string): Promise<PackageFile[]> {
    // 1. downloading the tarball
    const tarball = await this.request<Buffer>(tarballUrl, name, {
      headers: { accept: 'application/octet-stream' },
      responseType: 'arraybuffer',
      maxContentLength: MAX_TARBALL_BYTES,
    });

    // 2. unzipping it
    const tar = await gunzipAsync(tarball, {
      maxOutputLength: MAX_UNPACKED_BYTES,
    }).catch(() => {
      throw new PayloadTooLargeException('Unpacked tarball is too large');
    });

    // 3. reading the files out of the tar
    const files: PackageFile[] = [];
    const entries = extract();
    entries.end(tar);

    for await (const entry of entries) {
      const chunks: Buffer[] = [];
      for await (const chunk of entry) chunks.push(chunk as Buffer);

      const path = this.getSafePath(entry.header.name);
      if (entry.header.type === 'file' && path) {
        files.push({ path, content: Buffer.concat(chunks) });
      }
    }

    return files;
  }

  /** Removes the top folder from a tar path, or returns null when the path is unsafe. */
  private getSafePath(name: string): string | null {
    const parts = name.split('/').slice(1);
    if (name.startsWith('/') || parts.includes('..') || !parts.length) {
      return null;
    }
    return parts.join('/');
  }

  private async request<T>(
    url: string,
    name: string,
    options: AxiosRequestConfig = {},
  ): Promise<T> {
    // validateStatus lets every HTTP status through, so only network errors reach .catch().
    const response = await axios
      .get<T>(url, {
        headers: { accept: 'application/json' },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
        ...options,
      })
      .catch((error: unknown) => {
        if (
          axios.isAxiosError(error) &&
          error.message.includes('maxContentLength')
        ) {
          throw new PayloadTooLargeException('Tarball is too large');
        }
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
