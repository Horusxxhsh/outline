import { z } from "zod";
import {
  DocumentReportFormat,
  DocumentReportScope,
} from "@server/models/DocumentReport";
import { ValidateDocumentId } from "@server/validation";
import { BaseSchema } from "../schema";

export const ReportsCreateSchema = BaseSchema.extend({
  body: z.object({
    documentId: z.string().refine(ValidateDocumentId.isValid, {
      message: ValidateDocumentId.message,
    }),
    format: z
      .enum(DocumentReportFormat)
      .optional()
      .default(DocumentReportFormat.AuditReport),
    scope: z
      .enum(DocumentReportScope)
      .optional()
      .default(DocumentReportScope.Document),
  }),
});

export type ReportsCreateReq = z.infer<typeof ReportsCreateSchema>;

export const ReportsInfoSchema = BaseSchema.extend({
  body: z.object({
    id: z.uuid(),
  }),
});

export type ReportsInfoReq = z.infer<typeof ReportsInfoSchema>;

export const ReportsDeleteSchema = BaseSchema.extend({
  body: z.object({
    id: z.uuid(),
  }),
});

export type ReportsDeleteReq = z.infer<typeof ReportsDeleteSchema>;

export const ReportsListSchema = BaseSchema.extend({
  body: z.object({
    documentId: z.string().refine(ValidateDocumentId.isValid, {
      message: ValidateDocumentId.message,
    }),
  }),
});

export type ReportsListReq = z.infer<typeof ReportsListSchema>;
