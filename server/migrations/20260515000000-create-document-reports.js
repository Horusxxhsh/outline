"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "document_reports",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
          },
          status: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          title: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          summary: {
            type: Sequelize.TEXT,
            allowNull: true,
          },
          content: {
            type: Sequelize.TEXT,
            allowNull: true,
          },
          format: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          scope: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          model: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          promptVersion: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          inputHash: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          error: {
            type: Sequelize.JSONB,
            allowNull: true,
          },
          metadata: {
            type: Sequelize.JSONB,
            allowNull: true,
          },
          completedAt: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          teamId: {
            type: Sequelize.UUID,
            allowNull: false,
            onDelete: "cascade",
            references: {
              model: "teams",
            },
          },
          documentId: {
            type: Sequelize.UUID,
            allowNull: false,
            onDelete: "cascade",
            references: {
              model: "documents",
            },
          },
          userId: {
            type: Sequelize.UUID,
            allowNull: false,
            onDelete: "cascade",
            references: {
              model: "users",
            },
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
        },
        { transaction }
      );

      await queryInterface.addIndex("document_reports", ["documentId"], {
        transaction,
      });
      await queryInterface.addIndex("document_reports", ["teamId", "status"], {
        transaction,
      });
      await queryInterface.addIndex("document_reports", ["userId"], {
        transaction,
      });
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex("document_reports", ["documentId"], {
        transaction,
      });
      await queryInterface.removeIndex(
        "document_reports",
        ["teamId", "status"],
        {
          transaction,
        }
      );
      await queryInterface.removeIndex("document_reports", ["userId"], {
        transaction,
      });
      await queryInterface.dropTable("document_reports", { transaction });
    });
  },
};
