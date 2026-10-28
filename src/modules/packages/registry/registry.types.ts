export interface RegistryMaintainer {
  name: string;
  email?: string;
}

export interface RegistryVersion {
  version: string;
  publishedAt: string | null;
  publishedBy: string | null;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  scripts: Record<string, string>;
  maintainers: RegistryMaintainer[];
  tarballUrl: string | null;
  shasum: string | null;
  integrity: string | null;
  unpackedSize: number | null;
}

export interface RegistryPackage {
  name: string;
  distTags: Record<string, string>;
  createdAt: string | null;
  modifiedAt: string | null;
  maintainers: RegistryMaintainer[];
  versions: RegistryVersion[];
}

export interface RegistryDownloads {
  downloads: number;
  start: string;
  end: string;
}

/**
 * Raw registry shapes
 *
 * Only the fields we read are listed. The registry returns more.
 */
export interface RawVersion {
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  maintainers?: RegistryMaintainer[];
  _npmUser?: RegistryMaintainer;
  dist?: {
    tarball?: string;
    shasum?: string;
    integrity?: string;
    unpackedSize?: number;
  };
}

export interface RawPackument {
  name: string;
  'dist-tags'?: Record<string, string>;
  time?: Record<string, string>;
  maintainers?: RegistryMaintainer[];
  versions?: Record<string, RawVersion>;
}

export interface RawDownloads {
  downloads: number;
  start: string;
  end: string;
}
