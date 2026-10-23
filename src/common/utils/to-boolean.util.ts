import type { TransformFnParams } from 'class-transformer';

// Query params arrive as strings: '' means not set, 'true'/'false' become booleans.
// Use with @Transform(toBoolean), e.g. on an isActive query param.
export const toBoolean = ({ value }: TransformFnParams): unknown => {
  if (value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};
