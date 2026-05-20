import copy from "copy-to-clipboard";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Text from "~/components/Text";
import type Document from "~/models/Document";
import { client } from "~/utils/ApiClient";

type ReportFormat =
  | "action_items"
  | "audit_report"
  | "executive_summary"
  | "technical_report";

type ReportScope = "document" | "document_with_children";

type ReportStatus = "pending" | "running" | "completed" | "failed" | "canceled";

interface DocumentReport {
  id: string;
  status: ReportStatus;
  title: string;
  summary: string | null;
  content: string | null;
  format: ReportFormat;
  scope: ReportScope;
  createdAt: string;
}

interface ReportsListResponse {
  data: DocumentReport[];
}

interface ReportsCreateResponse {
  data: DocumentReport;
}

interface ReportsDeleteResponse {
  success: boolean;
}

type Props = {
  document: Document;
  onRequestClose: () => void;
};

/**
 * Dialog for generating and viewing document reports.
 *
 * @param props component props.
 * @returns rendered document report dialog.
 */
export default function DocumentReportDialog({
  document,
  onRequestClose,
}: Props) {
  const { t } = useTranslation();
  const [reports, setReports] = React.useState<DocumentReport[]>([]);
  const [selectedReportId, setSelectedReportId] = React.useState<string>();
  const [scope, setScope] = React.useState<ReportScope>("document");
  const [isLoading, setIsLoading] = React.useState(true);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const selectedReport =
    reports.find((report) => report.id === selectedReportId) ?? reports[0];

  const fetchReports = React.useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await client.post<ReportsListResponse>("/reports.list", {
        documentId: document.id,
      });
      setReports(response.data);
      setSelectedReportId(response.data[0]?.id);
    } finally {
      setIsLoading(false);
    }
  }, [document.id]);

  React.useEffect(() => {
    void fetchReports();
  }, [fetchReports]);

  const handleGenerate = React.useCallback(async () => {
    setIsGenerating(true);

    try {
      const response = await client.post<ReportsCreateResponse>(
        "/reports.create",
        {
          documentId: document.id,
          format: "audit_report",
          scope,
        }
      );

      setReports((existingReports) => [response.data, ...existingReports]);
      setSelectedReportId(response.data.id);

      if (response.data.status === "completed") {
        toast.success(t("Report generated"));
      } else {
        toast.error(t("Report generation failed"));
      }
    } finally {
      setIsGenerating(false);
    }
  }, [document.id, scope, t]);

  const handleCopy = React.useCallback(() => {
    if (!selectedReport?.content) {
      return;
    }

    copy(selectedReport.content);
    toast.success(t("Report copied to clipboard"));
  }, [selectedReport, t]);

  const handleDelete = React.useCallback(async () => {
    if (!selectedReport) {
      return;
    }

    if (!window.confirm(t("Delete this report?"))) {
      return;
    }

    setIsDeleting(true);

    try {
      await client.post<ReportsDeleteResponse>("/reports.delete", {
        id: selectedReport.id,
      });
      setReports((existingReports) => {
        const remainingReports = existingReports.filter(
          (report) => report.id !== selectedReport.id
        );
        setSelectedReportId(remainingReports[0]?.id);

        return remainingReports;
      });
      toast.success(t("Report deleted"));
    } finally {
      setIsDeleting(false);
    }
  }, [selectedReport, t]);

  const handleScopeChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      setScope(toReportScope(event.target.value));
    },
    []
  );

  const handleReportChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedReportId(event.target.value);
    },
    []
  );

  return (
    <Container>
      <Controls>
        <Field>
          <Label>{t("Scope")}</Label>
          <Select value={scope} onChange={handleScopeChange}>
            <option value="document">{t("Current document")}</option>
            <option value="document_with_children">
              {t("Document and children")}
            </option>
          </Select>
        </Field>
        <Button onClick={handleGenerate} disabled={isGenerating}>
          {isGenerating ? t("Generating") : t("Generate")}
        </Button>
      </Controls>

      {reports.length > 1 && (
        <Field>
          <Label>{t("Reports")}</Label>
          <Select value={selectedReport?.id} onChange={handleReportChange}>
            {reports.map((report) => (
              <option key={report.id} value={report.id}>
                {new Date(report.createdAt).toLocaleString()}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {isLoading ? (
        <EmptyState>{t("Loading")}</EmptyState>
      ) : selectedReport ? (
        <Report>
          <Header>
            <div>
              <Text size="large" weight="bold">
                {selectedReport.title}
              </Text>
              <Meta>{selectedReport.status}</Meta>
            </div>
            <HeaderActions>
              <Button
                neutral
                onClick={handleCopy}
                disabled={!selectedReport.content}
              >
                {t("Copy")}
              </Button>
              <Button danger onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? t("Deleting") : t("Delete")}
              </Button>
            </HeaderActions>
          </Header>
          <Content>{selectedReport.content ?? selectedReport.summary}</Content>
        </Report>
      ) : (
        <EmptyState>{t("No reports generated yet")}</EmptyState>
      )}

      <Actions>
        <Button neutral onClick={onRequestClose}>
          {t("Close")}
        </Button>
      </Actions>
    </Container>
  );
}

const Container = styled.div`
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
`;

const Controls = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Label = styled.span`
  color: ${s("textSecondary")};
  font-size: 13px;
`;

const Select = styled.select`
  box-sizing: border-box;
  height: 32px;
  max-width: 100%;
  min-width: 0;
  width: 100%;
  border: 1px solid ${s("inputBorder")};
  border-radius: 6px;
  background: ${s("inputBackground")};
  color: ${s("text")};
  padding: 0 8px;
`;

const Report = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
`;

const HeaderActions = styled.div`
  display: flex;
  gap: 8px;
`;

const Meta = styled.div`
  color: ${s("textTertiary")};
  font-size: 13px;
  margin-top: 4px;
`;

const Content = styled.pre`
  color: ${s("text")};
  background: ${s("sidebarBackground")};
  border-radius: 6px;
  font: inherit;
  line-height: 1.5;
  margin: 0;
  max-height: 360px;
  overflow: auto;
  padding: 12px;
  white-space: pre-wrap;
`;

const EmptyState = styled.div`
  color: ${s("textSecondary")};
  padding: 24px 0;
  text-align: center;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
`;

function toReportScope(value: string): ReportScope {
  if (value === "document_with_children") {
    return value;
  }

  return "document";
}
