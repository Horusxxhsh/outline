import crypto from "node:crypto";
import env from "@server/env";
import { InternalError } from "@server/errors";
import fetch from "@server/utils/fetch";

export type ReportAgentBlockType =
  | "attachment"
  | "blockquote"
  | "block"
  | "code_block"
  | "heading"
  | "image"
  | "list"
  | "list_item"
  | "paragraph"
  | "table"
  | "table_cell"
  | "table_row";

export type ReportAgentPrimitive = boolean | number | string | null;

export interface ReportAgentBlock {
  id: string;
  type: ReportAgentBlockType;
  text?: string;
  level?: number;
  language?: string;
  ordered?: boolean;
  checked?: boolean;
  attachmentId?: string;
  attrs?: Record<string, ReportAgentPrimitive>;
  children?: ReportAgentBlock[];
}

export type ReportAgentAssetKind =
  | "image"
  | "markdown"
  | "pdf"
  | "text"
  | "word";

export interface ReportAgentAsset {
  id: string;
  attachmentId: string;
  documentId: string;
  name: string;
  contentType: string;
  size: number;
  kind: ReportAgentAssetKind;
  content: Buffer;
}

export interface ReportAgentAssetMetadata {
  id: string;
  attachmentId: string;
  documentId: string;
  name: string;
  contentType: string;
  size: number;
  kind: ReportAgentAssetKind;
}

export interface ReportAgentDocument {
  id: string;
  title: string;
  text: string;
  blocks: ReportAgentBlock[];
  url: string;
  updatedAt: string;
}

export interface ReportAgentRequest {
  jobId: string;
  teamId: string;
  documentId: string;
  requestedBy: string;
  locale: string;
  timezone: string;
  scope: string;
  format: string;
  document: ReportAgentDocument;
  children: ReportAgentDocument[];
  assets: ReportAgentAsset[];
  constraints: {
    maxTokens: number;
    includeCitations: boolean;
    includeActionItems: boolean;
  };
}

export interface ReportAgentResult {
  title: string;
  summary: string;
  content: string;
  model: string;
  promptVersion: string;
  metadata: {
    agentJobId?: string;
    inputTokens?: number;
    outputTokens?: number;
    durationMs?: number;
    includedDocumentIds?: string[];
    includedAssetIds?: string[];
  };
}

interface ExternalReportAgentResult {
  jobId: string;
  status: "completed" | "failed";
  report?: {
    title: string;
    summary: string;
    content: string;
  };
  model?: string;
  promptVersion?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Client for generating document reports through an external Agent service, or
 * through a local mock implementation when no Agent service is configured.
 */
class ReportAgentClient {
  /**
   * Generate a report for authorized document content.
   *
   * @param input authorized report input prepared by Outline.
   * @returns generated report content.
   */
  public async generate(input: ReportAgentRequest): Promise<ReportAgentResult> {
    if (!env.AGENT_REPORT_SERVICE_URL) {
      return this.generateMock(input);
    }

    const result = await this.generateExternal(input);
    if (result.status === "failed") {
      throw InternalError(result.error?.message ?? "Agent report failed");
    }

    if (!result.report) {
      throw InternalError("Agent report response did not include a report");
    }

    return {
      title: result.report.title,
      summary: result.report.summary,
      content: result.report.content,
      model: result.model ?? "external-agent",
      promptVersion: result.promptVersion ?? "external",
      metadata: {
        agentJobId: result.jobId,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        includedDocumentIds: [
          input.document.id,
          ...input.children.map((document) => document.id),
        ],
        includedAssetIds: input.assets.map((asset) => asset.attachmentId),
      },
    };
  }

  private async generateExternal(
    input: ReportAgentRequest
  ): Promise<ExternalReportAgentResult> {
    const multipart = this.buildMultipartBody(input);
    const headers: Record<string, string> = {
      "Content-Type": multipart.contentType,
    };

    if (env.AGENT_REPORT_SERVICE_TOKEN) {
      headers.Authorization = `Bearer ${env.AGENT_REPORT_SERVICE_TOKEN}`;
    }

    const response = await fetch(
      `${env.AGENT_REPORT_SERVICE_URL}/agent/report-jobs`,
      {
        method: "POST",
        headers,
        body: multipart.body,
        allowPrivateIPAddress: true,
        timeout: 30000,
      }
    );

    if (!response.ok) {
      throw InternalError("Agent service failed to generate a report");
    }

    return response.json() as Promise<ExternalReportAgentResult>;
  }

  private buildMultipartBody(input: ReportAgentRequest) {
    const boundary = `outline-report-${crypto.randomUUID()}`;
    const metadata = {
      ...input,
      assets: input.assets.map(toAssetMetadata),
    };
    const parts: MultipartPart[] = [
      {
        name: "metadata",
        contentType: "application/json",
        body: JSON.stringify(metadata),
      },
      ...input.assets.map((asset) => ({
        name: asset.id,
        filename: asset.name,
        contentType: asset.contentType,
        body: asset.content,
      })),
    ];
    const body = Buffer.concat(
      parts.flatMap((part) => {
        const headers = [
          `--${boundary}`,
          getDisposition(part),
          part.contentType ? `Content-Type: ${part.contentType}` : undefined,
          "",
        ].filter(Boolean);

        return [
          Buffer.from(`${headers.join("\r\n")}\r\n`, "utf8"),
          typeof part.body === "string"
            ? Buffer.from(part.body, "utf8")
            : part.body,
          Buffer.from("\r\n", "utf8"),
        ];
      })
    );

    return {
      body: Buffer.concat([body, Buffer.from(`--${boundary}--\r\n`, "utf8")]),
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  private generateMock(input: ReportAgentRequest): ReportAgentResult {
    const documents = [input.document, ...input.children];
    const plainText = documents
      .map((document) => document.text)
      .join("\n\n")
      .trim();
    const excerpt = plainText.length
      ? plainText.replace(/\s+/g, " ").slice(0, 500)
      : "This document does not contain enough text to summarize yet.";

    return {
      title: `Report: ${input.document.title || "Untitled"}`,
      summary: excerpt,
      content: [
        `# Report: ${input.document.title || "Untitled"}`,
        "",
        "## Summary",
        excerpt,
        "",
        "## Source Coverage",
        `This report was generated from ${documents.length} authorized document${
          documents.length === 1 ? "" : "s"
        }.`,
        "",
        "## Action Items",
        "- Review the generated summary.",
        "- Connect an external Agent service for production-quality reports.",
      ].join("\n"),
      model: "outline-local-mock",
      promptVersion: "mock-v1",
      metadata: {
        agentJobId: input.jobId,
        inputTokens: Math.ceil(plainText.length / 4),
        outputTokens: Math.ceil(excerpt.length / 4),
        includedDocumentIds: documents.map((document) => document.id),
        includedAssetIds: input.assets.map((asset) => asset.attachmentId),
      },
    };
  }
}

export default new ReportAgentClient();

interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  body: Buffer | string;
}

function getDisposition(part: MultipartPart) {
  const values = [`form-data; name="${escapeMultipartValue(part.name)}"`];
  if (part.filename) {
    values.push(`filename="${escapeMultipartValue(part.filename)}"`);
  }

  return `Content-Disposition: ${values.join("; ")}`;
}

function escapeMultipartValue(value: string) {
  return value.replace(/"/g, "%22").replace(/\r|\n/g, " ");
}

function toAssetMetadata(asset: ReportAgentAsset): ReportAgentAssetMetadata {
  return {
    id: asset.id,
    attachmentId: asset.attachmentId,
    documentId: asset.documentId,
    name: asset.name,
    contentType: asset.contentType,
    size: asset.size,
    kind: asset.kind,
  };
}
