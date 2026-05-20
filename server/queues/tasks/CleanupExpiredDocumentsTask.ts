import { addDays, differenceInCalendarDays, subDays } from "date-fns";
import { uniq } from "es-toolkit/compat";
import { Op } from "sequelize";
import { Minute } from "@shared/utils/time";
import documentPermanentDeleter from "@server/commands/documentPermanentDeleter";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import { Collection, Document, User } from "@server/models";
import NotificationGrpcClient from "@server/services/NotificationGrpcClient";
import { TaskPriority } from "./base/BaseTask";
import type { Props } from "./base/CronTask";
import { CronTask, TaskInterval } from "./base/CronTask";

const NOTIFY_DAYS_BEFORE_DELETE = 7;

type DeletableDocument = Pick<
  Document,
  "id" | "teamId" | "deletedAt" | "content" | "state" | "text"
>;

const documentAttributes: Array<keyof DeletableDocument> = [
  "id",
  "teamId",
  "deletedAt",
  "content",
  "state",
  "text",
];

export default class CleanupExpiredDocumentsTask extends CronTask {
  public async perform({ limit, partition }: Props) {
    if (!env.DOCUMENT_RETENTION_ENABLED) {
      return;
    }

    const cutoff = subDays(new Date(), env.DOCUMENT_RETENTION_DAYS);
    Logger.info(
      "task",
      `Permanently destroying up to ${limit} documents created before ${cutoff.toISOString()}`
    );

    const allRoots = await Document.unscoped().findAll({
      attributes: [
        ...documentAttributes,
        "collectionId",
        "parentDocumentId",
        "createdAt",
        "createdById",
        "title",
        "urlId",
      ],
      where: {
        createdAt: {
          [Op.lt]: cutoff,
        },
        deletedAt: {
          [Op.is]: null,
        },
        template: false,
        ...this.getPartitionWhereClause("id", partition),
      },
      paranoid: false,
      order: [["createdAt", "ASC"]],
      limit,
    });
    const roots = allRoots.filter(
      (document) =>
        !!document.createdById && !this.isExcludedDocument(document.id)
    );

    await this.notifyExpiringDocuments({ limit, partition });

    const documentIds = uniq(
      (
        await Promise.all(
          roots.map((document) => this.collectDocumentTreeIds(document.id))
        )
      ).flat()
    );

    if (documentIds.length === 0) {
      Logger.info("task", "No expired documents found");
      return;
    }

    await Promise.all(
      roots.map(async (document) => {
        if (!document.collectionId) {
          return;
        }

        const collection = await Collection.findByPk(document.collectionId, {
          includeDocumentStructure: true,
          paranoid: false,
        });

        await collection?.removeDocumentInStructure(document);
      })
    );

    await Document.unscoped().update(
      {
        deletedAt: new Date(),
      },
      {
        where: {
          id: {
            [Op.in]: documentIds,
          },
          deletedAt: {
            [Op.is]: null,
          },
        },
        paranoid: false,
      }
    );

    const documents = await Document.unscoped().findAll({
      attributes: documentAttributes,
      where: {
        id: {
          [Op.in]: documentIds,
        },
        deletedAt: {
          [Op.ne]: null,
        },
      },
      paranoid: false,
    });

    const countDeletedDocument = await documentPermanentDeleter(documents);
    Logger.info("task", `Destroyed ${countDeletedDocument} expired documents`);
  }

  public get options() {
    return {
      attempts: 1,
      priority: TaskPriority.Background,
    };
  }

  public get cron() {
    return {
      interval: TaskInterval.Day,
      partitionWindow: 30 * Minute.ms,
    };
  }

  private async collectDocumentTreeIds(documentId: string): Promise<string[]> {
    const children = await Document.unscoped().findAll({
      attributes: ["id", "createdById"],
      where: {
        parentDocumentId: documentId,
        deletedAt: {
          [Op.is]: null,
        },
        template: false,
      },
      paranoid: false,
    });
    const deletableChildren = children.filter(
      (child) => !!child.createdById && !this.isExcludedDocument(child.id)
    );

    const childIds = (
      await Promise.all(
        deletableChildren.map((child) => this.collectDocumentTreeIds(child.id))
      )
    ).flat();

    return [documentId, ...childIds];
  }

  private async notifyExpiringDocuments({ limit, partition }: Props) {
    if (!env.NOTIFICATION_GRPC_TARGET) {
      return;
    }

    const now = new Date();
    const cutoff = subDays(now, env.DOCUMENT_RETENTION_DAYS);
    const notificationCutoff = subDays(
      now,
      env.DOCUMENT_RETENTION_DAYS - NOTIFY_DAYS_BEFORE_DELETE
    );

    const documents = await Document.unscoped().findAll({
      attributes: ["id", "createdAt", "createdById", "title", "urlId"],
      where: {
        createdAt: {
          [Op.gte]: cutoff,
          [Op.lt]: notificationCutoff,
        },
        deletedAt: {
          [Op.is]: null,
        },
        template: false,
        ...this.getPartitionWhereClause("id", partition),
      },
      include: [
        {
          model: User,
          as: "createdBy",
          attributes: ["id", "name", "email"],
          paranoid: false,
          required: true,
        },
      ],
      paranoid: false,
      order: [["createdAt", "ASC"]],
      limit,
    });

    const documentsToNotify = documents.filter(
      (document) => !this.isExcludedDocument(document.id)
    );

    const client = new NotificationGrpcClient();
    await Promise.all(
      documentsToNotify.map(async (document) => {
        const expiresAt = addDays(
          document.createdAt,
          env.DOCUMENT_RETENTION_DAYS
        );
        const daysRemaining = Math.max(
          1,
          differenceInCalendarDays(expiresAt, now)
        );

        try {
          await client.sendMarkdownToChannel({
            channel: env.NOTIFICATION_GRPC_CHANNEL,
            title: "Outline document retention warning",
            contents: [
              `Document **${document.title || "Untitled"}** will be permanently deleted in **${daysRemaining} day${
                daysRemaining === 1 ? "" : "s"
              }**.`,
              `Owner: ${document.createdBy.name}${
                document.createdBy.email ? ` <${document.createdBy.email}>` : ""
              }`,
              `Link: ${env.URL}${document.path}`,
              `Document ID: ${document.id}`,
            ],
          });
        } catch (err) {
          Logger.warn(
            `Failed to send document retention warning for ${document.id}`,
            { error: err }
          );
        }
      })
    );
  }

  private isExcludedDocument(documentId: string) {
    return env.DOCUMENT_RETENTION_EXCLUDED_DOCUMENT_IDS.includes(documentId);
  }
}
