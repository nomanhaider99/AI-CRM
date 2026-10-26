import { z } from "zod";

export const idSchema = z.uuid();
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code");

// Money is sent as a number with at most 2 decimals; the DB stores numeric(12,2).
export const moneySchema = z
  .number()
  .nonnegative()
  .max(9_999_999_999.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, { message: "At most 2 decimal places" });

export const isoDateSchema = z.iso.date();
export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
