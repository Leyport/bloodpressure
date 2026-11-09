export type ItemKind = 'appointment' | 'document' | 'spreadsheet';

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  appointment: 'Appointment',
  document: 'Document',
  spreadsheet: 'Spreadsheet',
};

export const ITEM_KIND_ICONS: Record<ItemKind, string> = {
  appointment: '📅',
  document: '📄',
  spreadsheet: '📊',
};

/** An item in the local document library (stored in IndexedDB). */
export interface LibraryItem {
  id: string;
  name: string;
  kind: ItemKind;
  addedAt: string;
  /** Appointment date/time (ISO), if known. */
  appointmentDate?: string;
  mimeType: string;
  size: number;
  /** Uploaded file contents. Absent for manually entered appointments. */
  blob?: Blob;
  /** Plain-text contents for manually entered appointments. */
  text?: string;
  /** True for entries derived from saved BP datasets (not stored in IndexedDB). */
  virtual?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  at: string;
}

export interface SourceRef {
  id: string;
  name: string;
  kind: ItemKind;
}

/** A Gemini conversation as stored in Firestore at users/{uid}/conversations/{id}. */
export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sources: SourceRef[];
  messages: ChatMessage[];
}

const SPREADSHEET_EXT = /\.(xlsx|xls|ods|csv|tsv)$/i;
const APPOINTMENT_EXT = /\.ics$/i;

export function guessKind(file: File): ItemKind {
  if (APPOINTMENT_EXT.test(file.name)) return 'appointment';
  if (SPREADSHEET_EXT.test(file.name)) return 'spreadsheet';
  if (/appointment|appt|clinic|referral/i.test(file.name)) return 'appointment';
  return 'document';
}

export const ACCEPTED_FILES =
  '.pdf,.png,.jpg,.jpeg,.webp,.heic,.txt,.md,.csv,.tsv,.xlsx,.xls,.ods,.ics,.json';
