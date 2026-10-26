import { z } from "zod";
import { badRequest } from "./http-error";

/** Parses untrusted input (body, params, query) with a shared Zod schema; throws 400 on failure. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw badRequest("Invalid request", z.flattenError(result.error));
  return result.data;
}
