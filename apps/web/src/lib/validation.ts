import { z } from "zod";
import type { FieldErrors } from "./api";

/** Validates a form with a shared schema; returns parsed data or field errors keyed like the API's. */
export function validate<S extends z.ZodType>(
  schema: S,
  values: unknown,
): { data: z.output<S>; errors?: undefined } | { data?: undefined; errors: FieldErrors } {
  const result = schema.safeParse(values);
  if (result.success) return { data: result.data };
  const flat = z.flattenError(result.error);
  const errors: FieldErrors = { ...flat.fieldErrors };
  if (flat.formErrors.length > 0) errors._form = flat.formErrors;
  return { errors };
}

/** Empty strings from inputs mean "not provided" for optional fields. */
export function blankToUndefined<T extends Record<string, unknown>>(values: T): { [K in keyof T]: T[K] | undefined } {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === "string" && v.trim() === "" ? undefined : v])) as {
    [K in keyof T]: T[K] | undefined;
  };
}
