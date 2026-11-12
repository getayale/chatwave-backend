import { z } from "zod";

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Display name must be at least 2 characters")
    .max(40, "Display name cannot exceed 40 characters")
    .optional(),

  bio: z
    .string()
    .max(160, "Bio cannot exceed 160 characters")
    .nullable()
    .optional(),

  avatarUrl: z
    .string()
    .url("Please provide a valid avatar URL")
    .nullable()
    .optional(),
}).strict().refine(
  (data) => Object.keys(data).length > 0,
  "Please provide at least one field to update"
);