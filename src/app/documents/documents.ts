import { Component, computed, ElementRef, inject, OnDestroy, output, signal, viewChild } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { Part } from 'firebase/ai';
import { marked } from 'marked';
import { auth } from '../firebase';
import { FileStorageService } from '../file-storage.service';
import { LibraryStorageService } from '../library-storage.service';
import { ConversationStoreService } from '../conversation-store.service';
import { GeminiService } from '../gemini.service';
import { SpeechService } from '../speech.service';
import {
  ACCEPTED_FILES, ChatMessage, Conversation, guessKind, ITEM_KIND_ICONS, ITEM_KIND_LABELS, ItemKind, LibraryItem,
} from '../library.model';
import { getBpCategory } from '../bp.model';

type KindFilter = ItemKind | 'all';

@Component({
  selector: 'app-documents',
  imports: [DatePipe, DecimalPipe, FormsModule],
  templateUrl: './documents.html',
  styleUrl: './documents.scss',
})
export class DocumentsComponent implements OnDestroy {
  private library = inject(LibraryStorageService);
  private bpStorage = inject(FileStorageService);
  private store = inject(ConversationStoreService);
  private gemini = inject(GeminiService);
  readonly speech = inject(SpeechService);

  readonly close = output<void>();

  readonly accepted = ACCEPTED_FILES;
  readonly kindLabels = ITEM_KIND_LABELS;
  readonly kindIcons = ITEM_KIND_ICONS;
  readonly kinds: ItemKind[] = ['appointment', 'document', 'spreadsheet'];
  readonly quickPrompts = [
    'Summarise these documents for me.',
    'How do my blood pressure readings compare around my appointment dates?',
    'What questions should I ask my doctor at my next appointment?',
    'Explain any medical terms or results in plain English.',
  ];

  // ── Auth ────────────────────────────────────────────────────────────────────
  user = signal<User | null>(null);
  authReady = signal(false);
  private unsubAuth = onAuthStateChanged(auth, u => {
    this.user.set(u);
    this.authReady.set(true);
    if (u) this.loadConversations();
    else { this.conversations.set([]); this.newConversation(); }
  });

  // ── Library ─────────────────────────────────────────────────────────────────
  items = signal<LibraryItem[]>([]);
  selected = signal<Set<string>>(new Set());
  kindFilter = signal<KindFilter>('all');
  dragOver = signal(false);
  libraryError = signal('');
  deleteConfirmId = signal<string | null>(null);

  showApptForm = signal(false);
  appt = { title: '', date: '', time: '', withWhom: '', location: '', notes: '' };

  /** Saved BP datasets appear as read-only spreadsheets. */
  private bpItems = computed<LibraryItem[]>(() =>
    this.bpStorage.list().map(ds => ({
      id: 'bp:' + ds.id,
      name: `${ds.name} (BP readings)`,
      kind: 'spreadsheet' as const,
      addedAt: ds.savedAt,
      mimeType: 'text/csv',
      size: 0,
      virtual: true,
      text: this.bpDatasetCsv(ds.id),
    }))
  );

  allItems = computed(() => [...this.items(), ...this.bpItems()]);

  visibleItems = computed(() => {
    const f = this.kindFilter();
    return f === 'all' ? this.allItems() : this.allItems().filter(i => i.kind === f);
  });

  /** Category new uploads go into when a specific tab is open. */
  uploadKindLabel = computed(() => {
    const f = this.kindFilter();
    return f === 'all' ? null : ITEM_KIND_LABELS[f];
  });

  kindCounts = computed(() => {
    const counts: Record<KindFilter, number> = { all: 0, appointment: 0, document: 0, spreadsheet: 0 };
    for (const i of this.allItems()) { counts[i.kind]++; counts.all++; }
    return counts;
  });

  selectedItems = computed(() => this.allItems().filter(i => this.selected().has(i.id)));

  // ── Conversation ────────────────────────────────────────────────────────────
  conversations = signal<Conversation[]>([]);
  convo = signal<Conversation | null>(null);
  prompt = signal('');
  busy = signal(false);
  streamingText = signal('');
  chatError = signal('');
  showHistory = signal(false);
  historyDeleteId = signal<string | null>(null);

  /** Gemini parts for the active conversation's sources, built once per conversation. */
  private sourceParts: Part[] | null = null;
  private messagesEnd = viewChild<ElementRef<HTMLElement>>('messagesEnd');

  /** Sources of the active conversation that are no longer in the local library. */
  missingSources = computed(() => {
    const c = this.convo();
    if (!c) return [];
    const ids = new Set(this.allItems().map(i => i.id));
    return c.sources.filter(s => !ids.has(s.id));
  });

  constructor() {
    this.refreshLibrary();
  }

  ngOnDestroy() {
    this.unsubAuth();
    this.speech.stop();
  }

  // ── Auth actions ────────────────────────────────────────────────────────────

  async signIn() {
    this.chatError.set('');
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e: any) {
      if (e?.code !== 'auth/popup-closed-by-user') this.chatError.set(this.friendlyError(e));
    }
  }

  async signOut() {
    this.speech.stop();
    await signOut(auth);
  }

  // ── Library actions ─────────────────────────────────────────────────────────

  async refreshLibrary() {
    try {
      this.items.set(await this.library.list());
    } catch {
      this.libraryError.set('Could not open local document storage in this browser.');
    }
  }

  onFilesSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) this.addFiles(Array.from(input.files));
    input.value = '';
  }

  onDragOver(e: DragEvent) { e.preventDefault(); this.dragOver.set(true); }
  onDragLeave() { this.dragOver.set(false); }
  onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragOver.set(false);
    if (e.dataTransfer?.files) this.addFiles(Array.from(e.dataTransfer.files));
  }

  async addFiles(files: File[]) {
    this.libraryError.set('');
    const filter = this.kindFilter();
    const added: string[] = [];
    try {
      for (const file of files) {
        const item: LibraryItem = {
          id: crypto.randomUUID(),
          name: file.name,
          // If the user is viewing a specific category, file uploads into it.
          kind: filter === 'all' ? guessKind(file) : filter,
          addedAt: new Date().toISOString(),
          mimeType: file.type,
          size: file.size,
          blob: file,
        };
        await this.library.put(item);
        added.push(item.id);
      }
    } catch {
      this.libraryError.set('Could not save the file locally — your browser storage may be full.');
    }
    await this.refreshLibrary();
    this.selected.update(s => new Set([...s, ...added]));
  }

  async saveAppointment() {
    const a = this.appt;
    if (!a.title.trim() || !a.date) return;
    const when = a.time ? `${a.date}T${a.time}` : a.date;
    const lines = [
      `Appointment: ${a.title.trim()}`,
      `Date: ${new Date(when).toLocaleString(undefined, { dateStyle: 'full', ...(a.time && { timeStyle: 'short' }) })}`,
      a.withWhom.trim() && `With: ${a.withWhom.trim()}`,
      a.location.trim() && `Location: ${a.location.trim()}`,
      a.notes.trim() && `Notes: ${a.notes.trim()}`,
    ].filter(Boolean);
    const text = lines.join('\n');
    const item: LibraryItem = {
      id: crypto.randomUUID(),
      name: a.title.trim(),
      kind: 'appointment',
      addedAt: new Date().toISOString(),
      appointmentDate: new Date(when).toISOString(),
      mimeType: 'text/plain',
      size: text.length,
      text,
    };
    await this.library.put(item);
    await this.refreshLibrary();
    this.selected.update(s => new Set([...s, item.id]));
    this.appt = { title: '', date: '', time: '', withWhom: '', location: '', notes: '' };
    this.showApptForm.set(false);
  }

  async changeKind(item: LibraryItem, kind: ItemKind) {
    if (item.virtual) return;
    await this.library.put({ ...item, kind });
    await this.refreshLibrary();
  }

  async deleteItem(id: string) {
    await this.library.delete(id);
    this.selected.update(s => { const n = new Set(s); n.delete(id); return n; });
    this.deleteConfirmId.set(null);
    await this.refreshLibrary();
  }

  toggleSelect(id: string) {
    this.selected.update(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  selectAllVisible() {
    this.selected.update(s => new Set([...s, ...this.visibleItems().map(i => i.id)]));
  }

  clearSelection() { this.selected.set(new Set()); }

  openItem(item: LibraryItem) {
    const blob = item.blob ?? new Blob([item.text ?? ''], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // ── Conversation actions ────────────────────────────────────────────────────

  async loadConversations() {
    const u = this.user();
    if (!u) return;
    try {
      this.conversations.set(await this.store.list(u.uid));
    } catch (e) {
      this.chatError.set(this.friendlyError(e));
    }
  }

  newConversation() {
    this.speech.stop();
    this.convo.set(null);
    this.sourceParts = null;
    this.streamingText.set('');
    this.chatError.set('');
    this.prompt.set('');
  }

  openConversation(c: Conversation) {
    this.newConversation();
    this.convo.set(c);
    // Re-select the conversation's sources so follow-ups use the same documents.
    this.selected.set(new Set(c.sources.map(s => s.id)));
    this.showHistory.set(false);
    this.scrollToEnd();
  }

  async deleteConversation(id: string) {
    const u = this.user();
    if (!u) return;
    try {
      await this.store.delete(u.uid, id);
      this.conversations.update(list => list.filter(c => c.id !== id));
      if (this.convo()?.id === id) this.newConversation();
    } catch (e) {
      this.chatError.set(this.friendlyError(e));
    }
    this.historyDeleteId.set(null);
  }

  usePrompt(p: string) { this.prompt.set(p); }

  async send() {
    const u = this.user();
    const question = this.prompt().trim();
    if (!u || !question || this.busy()) return;

    let convo = this.convo();
    if (!convo && !this.selectedItems().length) {
      this.chatError.set('Select at least one appointment, document or spreadsheet first.');
      return;
    }

    this.busy.set(true);
    this.chatError.set('');
    this.speech.stop();

    try {
      if (!convo) {
        const sources = this.selectedItems();
        this.sourceParts = await this.gemini.buildSourceParts(sources);
        const now = new Date().toISOString();
        convo = {
          id: crypto.randomUUID(),
          title: question.length > 70 ? question.slice(0, 67) + '…' : question,
          createdAt: now,
          updatedAt: now,
          sources: sources.map(s => ({ id: s.id, name: s.name, kind: s.kind })),
          messages: [],
        };
      } else if (!this.sourceParts) {
        // Resumed conversation: re-attach whichever sources are still available locally.
        const ids = new Set(convo.sources.map(s => s.id));
        this.sourceParts = await this.gemini.buildSourceParts(this.allItems().filter(i => ids.has(i.id)));
      }

      const userMsg: ChatMessage = { role: 'user', text: question, at: new Date().toISOString() };
      convo = { ...convo, messages: [...convo.messages, userMsg] };
      this.convo.set(convo);
      this.prompt.set('');
      this.scrollToEnd();

      let reply = '';
      for await (const chunk of this.gemini.ask(this.sourceParts, convo.messages)) {
        reply += chunk;
        this.streamingText.set(reply);
        this.scrollToEnd();
      }
      if (!reply.trim()) throw new Error('Gemini returned an empty response.');

      const modelMsg: ChatMessage = { role: 'model', text: reply, at: new Date().toISOString() };
      convo = { ...convo, messages: [...convo.messages, modelMsg], updatedAt: modelMsg.at };
      this.convo.set(convo);
      this.streamingText.set('');

      await this.store.save(u.uid, convo);
      const saved = convo;
      this.conversations.update(list => [saved, ...list.filter(c => c.id !== saved.id)]);

      if (this.speech.autoRead()) this.speech.speak(this.msgId(convo, convo.messages.length - 1), reply);
    } catch (e) {
      this.chatError.set(this.friendlyError(e));
      // Drop an unanswered question so a retry doesn't send it twice.
      const c = this.convo();
      if (c && c.messages.at(-1)?.role === 'user') {
        this.prompt.set(c.messages.at(-1)!.text);
        this.convo.set(c.messages.length > 1 ? { ...c, messages: c.messages.slice(0, -1) } : null);
        if (c.messages.length === 1) this.sourceParts = null;
      }
      this.streamingText.set('');
    } finally {
      this.busy.set(false);
    }
  }

  onPromptKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
  }

  // ── Read aloud ──────────────────────────────────────────────────────────────

  msgId(c: Conversation, index: number) { return `${c.id}:${index}`; }

  toggleSpeak(c: Conversation, index: number) {
    const id = this.msgId(c, index);
    if (this.speech.speakingId() === id) this.speech.stop();
    else this.speech.speak(id, c.messages[index].text);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  renderMarkdown(text: string): string {
    return marked.parse(text, { async: false, breaks: true }) as string;
  }

  formatSize(bytes: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private bpDatasetCsv(datasetId: string): string {
    const readings = this.bpStorage.load(datasetId) ?? [];
    const rows = readings.map(r => [
      r.date.toISOString().slice(0, 16).replace('T', ' '),
      r.systolic, r.diastolic, r.pulse ?? '',
      getBpCategory(r.systolic, r.diastolic),
      (r.notes ?? '').replace(/[\r\n,]+/g, ' '),
    ].join(','));
    return ['Date,Systolic,Diastolic,Pulse,Category,Notes', ...rows].join('\n');
  }

  private scrollToEnd() {
    setTimeout(() => this.messagesEnd()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  }

  private friendlyError(e: any): string {
    const msg: string = e?.message ?? String(e);
    if (e?.code === 'permission-denied' || /permission/i.test(msg)) {
      return 'Firebase denied access. Check that the Firestore rules are deployed and you are signed in.';
    }
    if (/api-not-enabled|firebasevertexai|firebaseml|AI Logic/i.test(msg)) {
      return 'Gemini is not enabled for this Firebase project yet. Enable "AI Logic" in the Firebase console, then try again.';
    }
    if (/auth\/(operation-not-allowed|configuration-not-found)/.test(msg)) {
      return 'Google sign-in is not enabled. Enable it in Firebase console → Authentication → Sign-in method.';
    }
    return msg;
  }
}
