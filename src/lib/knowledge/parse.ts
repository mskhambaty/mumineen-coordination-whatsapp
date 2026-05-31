import mammoth from "mammoth";
import * as XLSX from "xlsx";

export type KnowledgeFileType = "csv" | "excel" | "word" | "pdf";

// Map a filename/MIME to a supported type, or null if unsupported.
export function detectFileType(filename: string, mime: string): KnowledgeFileType | null {
  const lower = filename.toLowerCase();
  const m = mime.toLowerCase();
  if (lower.endsWith(".csv") || m === "text/csv") return "csv";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || m.includes("spreadsheet") || m.includes("excel")) return "excel";
  if (lower.endsWith(".docx") || m.includes("wordprocessingml") || m.includes("msword")) return "word";
  if (lower.endsWith(".pdf") || m === "application/pdf") return "pdf";
  return null;
}

// Extract plain text from an uploaded file buffer for vectorization.
export async function extractText(buffer: Buffer, type: KnowledgeFileType): Promise<string> {
  switch (type) {
    case "csv":
      return buffer.toString("utf8");
    case "excel": {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      return workbook.SheetNames.map((name) => `# ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`)
        .join("\n\n")
        .trim();
    }
    case "word": {
      const result = await mammoth.extractRawText({ buffer });
      return result.value.trim();
    }
    case "pdf": {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      return (result.text ?? "").trim();
    }
  }
}
