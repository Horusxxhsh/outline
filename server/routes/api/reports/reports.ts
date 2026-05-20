import crypto from "node:crypto";
import type { Node } from "prosemirror-model";
import { Op } from "sequelize";
import Router from "koa-router";
import env from "@server/env";
import { AuthorizationError, NotFoundError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import validate from "@server/middlewares/validate";
import { Attachment, Document, DocumentReport } from "@server/models";
import {
  DocumentReportScope,
  DocumentReportStatus,
} from "@server/models/DocumentReport";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import { authorize } from "@server/policies";
import { presentDocumentReport } from "@server/presenters";
import ReportAgentClient from "@server/services/ReportAgentClient";
import type {
  ReportAgentAsset,
  ReportAgentAssetKind,
  ReportAgentBlock,
  ReportAgentBlockType,
  ReportAgentDocument,
  ReportAgentPrimitive,
} from "@server/services/ReportAgentClient";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { attachmentRedirectRegex } from "@shared/utils/ProsemirrorHelper";
import * as T from "./schema";

const router = new Router();
const maxReportAssets = 10;
const maxReportAssetBytes = 20 * 1024 * 1024;
const maxReportAssetsBytes = 50 * 1024 * 1024;

router.post(
  "reports.create",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.ReportsCreateSchema),
  async (ctx: APIContext<T.ReportsCreateReq>) => {
    if (!env.AI_REPORTS_ENABLED) {
      throw AuthorizationError("Document reports are disabled");
    }

    const { documentId, format, scope } = ctx.input.body;
    const { user } = ctx.state.auth;
    const document = await Document.findByPk(documentId, {
      userId: user.id,
      includeState: true,
      rejectOnEmpty: true,
    });

    authorize(user, "createReport", document);

    const includedDocuments = await getIncludedDocuments(
      document,
      user.id,
      scope
    );
    const reportInputDocuments = includedDocuments.map((includedDocument) => ({
      document: includedDocument,
      node: DocumentHelper.toProsemirror(includedDocument),
    }));
    const agentDocuments = reportInputDocuments.map(({ document, node }) =>
      toAgentDocument(document, node)
    );
    const assets = env.AGENT_REPORT_SERVICE_URL
      ? await getAgentAssets(reportInputDocuments, user.teamId)
      : [];
    const inputFingerprint = JSON.stringify({
      format,
      scope,
      documents: agentDocuments,
      assets: assets.map(toAssetFingerprint),
    });
    const inputHash = crypto
      .createHash("sha256")
      .update(inputFingerprint)
      .digest("hex");

    const report = await DocumentReport.create({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
      status: DocumentReportStatus.Running,
      title: `Report: ${document.titleWithDefault}`,
      summary: null,
      content: null,
      format,
      scope,
      model: null,
      promptVersion: null,
      inputHash,
      error: null,
      metadata: {
        includedDocumentIds: includedDocuments.map(
          (includedDocument) => includedDocument.id
        ),
        includedAssetIds: assets.map((asset) => asset.attachmentId),
      },
    });

    try {
      const result = await ReportAgentClient.generate({
        jobId: report.id,
        teamId: user.teamId,
        documentId: document.id,
        requestedBy: user.id,
        locale: user.language ?? env.DEFAULT_LANGUAGE,
        timezone: user.timezone ?? "UTC",
        scope,
        format,
        document: agentDocuments[0],
        children: agentDocuments.filter(
          (includedDocument) => includedDocument.id !== document.id
        ),
        assets,
        constraints: {
          maxTokens: 4000,
          includeCitations: true,
          includeActionItems: format !== "executive_summary",
        },
      });

      await report.update({
        status: DocumentReportStatus.Completed,
        title: result.title,
        summary: result.summary,
        content: result.content,
        model: result.model,
        promptVersion: result.promptVersion,
        metadata: result.metadata,
        completedAt: new Date(),
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown error");
      await report.update({
        status: DocumentReportStatus.Failed,
        error: {
          code: "agent_report_failed",
          message: error.message,
        },
      });
    }

    ctx.body = {
      data: presentDocumentReport(report),
    };
  }
);

router.post(
  "reports.info",
  auth(),
  validate(T.ReportsInfoSchema),
  async (ctx: APIContext<T.ReportsInfoReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const report = await DocumentReport.findByPk(id);
    if (!report || report.teamId !== user.teamId) {
      throw NotFoundError();
    }

    const document = await Document.findByPk(report.documentId, {
      userId: user.id,
      rejectOnEmpty: true,
    });
    authorize(user, "read", document);

    ctx.body = {
      data: presentDocumentReport(report),
    };
  }
);

router.post(
  "reports.delete",
  auth(),
  validate(T.ReportsDeleteSchema),
  async (ctx: APIContext<T.ReportsDeleteReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const report = await DocumentReport.findByPk(id);
    if (!report || report.teamId !== user.teamId) {
      throw NotFoundError();
    }

    const document = await Document.findByPk(report.documentId, {
      userId: user.id,
      rejectOnEmpty: true,
    });
    authorize(user, "read", document);

    if (report.userId !== user.id && !user.isAdmin) {
      throw AuthorizationError(
        "Only the report creator or an admin can delete reports"
      );
    }

    await report.destroy();

    ctx.body = {
      success: true,
    };
  }
);

router.post(
  "reports.list",
  auth(),
  validate(T.ReportsListSchema),
  async (ctx: APIContext<T.ReportsListReq>) => {
    const { documentId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const document = await Document.findByPk(documentId, {
      userId: user.id,
      rejectOnEmpty: true,
    });
    authorize(user, "read", document);

    const reports = await DocumentReport.findAll({
      where: {
        documentId: document.id,
        teamId: user.teamId,
        status: {
          [Op.ne]: DocumentReportStatus.Canceled,
        },
      },
      order: [["createdAt", "DESC"]],
      limit: 20,
    });

    ctx.body = {
      data: reports.map(presentDocumentReport),
    };
  }
);

async function getIncludedDocuments(
  document: Document,
  userId: string,
  scope: DocumentReportScope
) {
  if (scope === DocumentReportScope.Document) {
    return [document];
  }

  const childDocumentIds = await document.findAllChildDocumentIds();
  if (!childDocumentIds.length) {
    return [document];
  }

  const childDocuments = await Document.findByIds(childDocumentIds, {
    userId,
    includeState: true,
  });

  return [document, ...childDocuments];
}

function toAgentDocument(document: Document, node: Node): ReportAgentDocument {
  return {
    id: document.id,
    title: document.titleWithDefault,
    text: DocumentHelper.toPlainText(document),
    blocks: toAgentBlocks(node, document.id),
    url: `${env.URL}${document.path}`,
    updatedAt: document.updatedAt.toISOString(),
  };
}

async function getAgentAssets(
  documents: { document: Document; node: Node }[],
  teamId: string
): Promise<ReportAgentAsset[]> {
  const documentIdByAttachmentId = new Map<string, string>();
  for (const { document, node } of documents) {
    for (const attachmentId of ProsemirrorHelper.parseAttachmentIds(node)) {
      if (!documentIdByAttachmentId.has(attachmentId)) {
        documentIdByAttachmentId.set(attachmentId, document.id);
      }
    }
  }

  const attachmentIds = [...documentIdByAttachmentId.keys()];
  if (!attachmentIds.length) {
    return [];
  }

  const attachments = await Attachment.findAll({
    where: {
      id: attachmentIds,
      teamId,
    },
    order: [["createdAt", "ASC"]],
  });

  const assets: ReportAgentAsset[] = [];
  let totalSize = 0;
  for (const attachment of attachments) {
    if (assets.length >= maxReportAssets) {
      break;
    }

    const kind = getAgentAssetKind(attachment);
    if (!kind || attachment.size > maxReportAssetBytes) {
      continue;
    }

    if (totalSize + attachment.size > maxReportAssetsBytes) {
      continue;
    }

    const content = await attachment.buffer;
    totalSize += content.byteLength;
    assets.push({
      id: `asset_${assets.length}`,
      attachmentId: attachment.id,
      documentId: documentIdByAttachmentId.get(attachment.id) ?? "",
      name: attachment.name,
      contentType: normalizeContentType(attachment.contentType),
      size: content.byteLength,
      kind,
      content,
    });
  }

  return assets;
}

function toAgentBlocks(node: Node, documentId: string, path: number[] = []) {
  const blocks: ReportAgentBlock[] = [];
  node.forEach((child, _offset, index) => {
    const block = toAgentBlock(child, documentId, [...path, index]);
    if (block) {
      blocks.push(block);
    }
  });

  return blocks;
}

function toAgentBlock(
  node: Node,
  documentId: string,
  path: number[]
): ReportAgentBlock | undefined {
  if (node.isText) {
    return;
  }

  const type = getAgentBlockType(node);
  const attrs = getPrimitiveAttrs(node);
  const text = node.textContent.trim();
  const children = toAgentBlocks(node, documentId, path);
  const attachmentId = getAttachmentId(node);
  const block: ReportAgentBlock = {
    id: `${documentId}:${path.join(".")}`,
    type,
  };

  if (text) {
    block.text = text;
  }

  if (children.length) {
    block.children = children;
  }

  if (attrs) {
    block.attrs = attrs;
  }

  if (attachmentId) {
    block.attachmentId = attachmentId;
  }

  setBlockSpecificAttributes(block, node);

  return block;
}

function getAgentBlockType(node: Node): ReportAgentBlockType {
  switch (node.type.name) {
    case "attachment":
      return "attachment";
    case "blockquote":
      return "blockquote";
    case "bullet_list":
    case "checkbox_list":
    case "ordered_list":
      return "list";
    case "code_block":
      return "code_block";
    case "heading":
      return "heading";
    case "image":
      return "image";
    case "list_item":
    case "checkbox_item":
      return "list_item";
    case "paragraph":
      return "paragraph";
    case "table":
      return "table";
    case "table_cell":
    case "table_header":
      return "table_cell";
    case "table_row":
      return "table_row";
    default:
      return "block";
  }
}

function setBlockSpecificAttributes(block: ReportAgentBlock, node: Node) {
  if (node.type.name === "heading") {
    block.level = getNumberAttr(node, "level");
  }

  if (node.type.name === "ordered_list") {
    block.ordered = true;
  }

  if (node.type.name === "bullet_list" || node.type.name === "checkbox_list") {
    block.ordered = false;
  }

  if (node.type.name === "checkbox_item") {
    block.checked = getBooleanAttr(node, "checked");
  }

  if (node.type.name === "code_block") {
    block.language =
      getStringAttr(node, "language") ??
      getStringAttr(node, "params") ??
      getStringAttr(node, "languageName");
  }
}

function getPrimitiveAttrs(
  node: Node
): Record<string, ReportAgentPrimitive> | undefined {
  const attrs: Record<string, ReportAgentPrimitive> = {};
  for (const [key, value] of Object.entries(node.attrs)) {
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
    ) {
      attrs[key] = value;
    }
  }

  return Object.keys(attrs).length ? attrs : undefined;
}

function getAttachmentId(node: Node) {
  const source = getStringAttr(node, "src") ?? getStringAttr(node, "href");
  if (!source) {
    return;
  }

  const regex = new RegExp(attachmentRedirectRegex.source, "i");
  return regex.exec(source)?.groups?.id;
}

function getStringAttr(node: Node, name: string) {
  const value = node.attrs[name];
  return typeof value === "string" ? value : undefined;
}

function getNumberAttr(node: Node, name: string) {
  const value = node.attrs[name];
  return typeof value === "number" ? value : undefined;
}

function getBooleanAttr(node: Node, name: string) {
  const value = node.attrs[name];
  return typeof value === "boolean" ? value : undefined;
}

function getAgentAssetKind(
  attachment: Attachment
): ReportAgentAssetKind | undefined {
  const contentType = normalizeContentType(attachment.contentType);
  const name = attachment.name.toLowerCase();

  if (contentType.startsWith("image/")) {
    return "image";
  }

  if (contentType === "application/pdf" || name.endsWith(".pdf")) {
    return "pdf";
  }

  if (
    contentType === "application/msword" ||
    contentType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".doc") ||
    name.endsWith(".docx")
  ) {
    return "word";
  }

  if (
    contentType === "text/markdown" ||
    contentType === "text/x-markdown" ||
    name.endsWith(".md") ||
    name.endsWith(".markdown")
  ) {
    return "markdown";
  }

  if (contentType === "text/plain" || name.endsWith(".txt")) {
    return "text";
  }

  return undefined;
}

function normalizeContentType(contentType: string) {
  return contentType.split(";")[0].trim().toLowerCase();
}

function toAssetFingerprint(asset: ReportAgentAsset) {
  return {
    attachmentId: asset.attachmentId,
    documentId: asset.documentId,
    name: asset.name,
    contentType: asset.contentType,
    size: asset.size,
    kind: asset.kind,
  };
}

export default router;
