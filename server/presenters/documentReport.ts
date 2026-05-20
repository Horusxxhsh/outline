import type { DocumentReport } from "@server/models";

/**
 * Present a generated document report for API responses.
 *
 * @param report the report to present.
 * @returns serialized report data.
 */
export default function presentDocumentReport(report: DocumentReport) {
  return {
    id: report.id,
    documentId: report.documentId,
    userId: report.userId,
    status: report.status,
    title: report.title,
    summary: report.summary,
    content: report.content,
    format: report.format,
    scope: report.scope,
    model: report.model,
    promptVersion: report.promptVersion,
    inputHash: report.inputHash,
    error: report.error,
    metadata: report.metadata,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    completedAt: report.completedAt,
  };
}
