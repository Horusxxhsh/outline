import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Table,
} from "sequelize-typescript";
import Document from "./Document";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";
import Fix from "./decorators/Fix";

export enum DocumentReportFormat {
  AuditReport = "audit_report",
  ExecutiveSummary = "executive_summary",
  ActionItems = "action_items",
  TechnicalReport = "technical_report",
}

export enum DocumentReportScope {
  Document = "document",
  DocumentWithChildren = "document_with_children",
}

export enum DocumentReportStatus {
  Pending = "pending",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Canceled = "canceled",
}

interface DocumentReportMetadata {
  agentJobId?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  includedDocumentIds?: string[];
  includedAssetIds?: string[];
}

interface DocumentReportError {
  code: string;
  message: string;
}

/**
 * A generated report summary for a document.
 */
@Table({ tableName: "document_reports", modelName: "document_report" })
@Fix
class DocumentReport extends IdModel<
  InferAttributes<DocumentReport>,
  Partial<InferCreationAttributes<DocumentReport>>
> {
  @Column(DataType.STRING)
  status: DocumentReportStatus;

  @Column(DataType.STRING)
  title: string;

  @Column(DataType.TEXT)
  summary: string | null;

  @Column(DataType.TEXT)
  content: string | null;

  @Column(DataType.STRING)
  format: DocumentReportFormat;

  @Column(DataType.STRING)
  scope: DocumentReportScope;

  @Column(DataType.STRING)
  model: string | null;

  @Column(DataType.STRING)
  promptVersion: string | null;

  @Column(DataType.STRING)
  inputHash: string | null;

  @Column(DataType.JSONB)
  error: DocumentReportError | null;

  @Column(DataType.JSONB)
  metadata: DocumentReportMetadata | null;

  @Column(DataType.DATE)
  completedAt: Date | null;

  // associations

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => Document, "documentId")
  document: Document;

  @ForeignKey(() => Document)
  @Column(DataType.UUID)
  documentId: string;

  @BelongsTo(() => User, "userId")
  user: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  userId: string;
}

export default DocumentReport;
