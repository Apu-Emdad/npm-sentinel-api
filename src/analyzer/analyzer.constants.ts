import { Severity } from '../generated/prisma/enums.js';

/** Saved on every scan; bump it when checks or weights change. */
export const ANALYZER_VERSION = '0.1.0';

/** A scan that takes longer than this fails with `timeout`. */
export const SCAN_TIMEOUT_MS = 120_000;

/** Points each finding adds to the score. Starting values, tuned once checks 3 to 5 exist. */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  [Severity.low]: 10,
  [Severity.medium]: 25,
  [Severity.high]: 50,
};
