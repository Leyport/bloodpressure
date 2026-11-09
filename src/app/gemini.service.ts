import { Injectable } from '@angular/core';
import { Content, getGenerativeModel, Part } from 'firebase/ai';
import * as XLSX from 'xlsx';
import { ai, GEMINI_MODEL } from './firebase';
import { ChatMessage, ITEM_KIND_LABELS, LibraryItem } from './library.model';

const SYSTEM_INSTRUCTION = `You are a helpful assistant reviewing a person's own health records:
blood pressure readings, medical appointments, letters, test results and other documents.
- Explain things in plain, friendly English and keep answers well organised with short headings or bullet points.
- Refer to documents by their name when you draw on them, and point out connections between them
  (e.g. blood pressure trends around appointment dates).
- Do not diagnose or prescribe. Where something looks concerning, say so clearly and suggest discussing it with their doctor.
- If something isn't in the documents, say so rather than guessing.`;

/** Gemini accepts these inline; everything else is converted to text first. */
const INLINE_MIME = /^(application\/pdf|image\/(png|jpeg|webp|heic|heif))$/;
const TEXT_EXT = /\.(txt|md|csv|tsv|ics|json)$/i;
const SHEET_EXT = /\.(xlsx|xls|ods)$/i;
/** Gemini's inline request limit is ~20 MB; leave headroom for base64 + text. */
const MAX_INLINE_BYTES = 14 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private model = getGenerativeModel(ai, {
    model: GEMINI_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION,
  });

  /** Converts library items into Gemini request parts. Throws on unsupported or oversized input. */
  async buildSourceParts(items: LibraryItem[]): Promise<Part[]> {
    const parts: Part[] = [];
    let inlineBytes = 0;
    for (const item of items) {
      const header = this.describe(item);
      if (item.text !== undefined) {
        parts.push({ type: 'text', text: `${header}\n${item.text}` });
        continue;
      }
      if (!item.blob) continue;
      const mime = item.mimeType || this.mimeFromName(item.name);
      if (INLINE_MIME.test(mime)) {
        inlineBytes += item.blob.size;
        if (inlineBytes > MAX_INLINE_BYTES) {
          throw new Error('The selected PDFs/images are too large to send together (limit ~14 MB). Select fewer files.');
        }
        parts.push({ type: 'text', text: header });
        parts.push({ type: 'inlineData', inlineData: { mimeType: mime, data: await this.toBase64(item.blob) } });
      } else if (SHEET_EXT.test(item.name)) {
        parts.push({ type: 'text', text: `${header}\n${await this.sheetToCsv(item.blob)}` });
      } else if (TEXT_EXT.test(item.name) || mime.startsWith('text/')) {
        parts.push({ type: 'text', text: `${header}\n${await item.blob.text()}` });
      } else {
        throw new Error(`"${item.name}" is a file type Gemini can't read. Use PDF, image, text or spreadsheet files.`);
      }
    }
    return parts;
  }

  /**
   * Streams a reply. The first user turn carries the source documents;
   * `history` holds every message so far, ending with the new question.
   */
  async *ask(sourceParts: Part[], history: ChatMessage[]): AsyncGenerator<string> {
    const contents: Content[] = history.map((m, i) => ({
      role: m.role,
      parts: i === 0 ? [...sourceParts, this.text(m.text)] : [this.text(m.text)],
    }));
    const result = await this.model.generateContentStream({ contents });
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  }

  private text(text: string): Part {
    return { type: 'text', text };
  }

  private describe(item: LibraryItem): string {
    const date = item.appointmentDate ? `, appointment date ${new Date(item.appointmentDate).toLocaleString()}` : '';
    return `--- ${ITEM_KIND_LABELS[item.kind]}: "${item.name}"${date} ---`;
  }

  private mimeFromName(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase();
    return ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      webp: 'image/webp', heic: 'image/heic' } as Record<string, string>)[ext ?? ''] ?? '';
  }

  private async sheetToCsv(blob: Blob): Promise<string> {
    const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array', cellDates: true });
    return wb.SheetNames
      .map(n => `Sheet "${n}":\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`)
      .join('\n\n');
  }

  private toBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
}
