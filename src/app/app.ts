import { Component, signal, computed, inject, ElementRef, viewChild, effect, HostListener } from '@angular/core';
import { DecimalPipe, DatePipe, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BpParserService } from './bp-parser.service';
import { FileStorageService } from './file-storage.service';
import { BpReading, BpCategory, getBpCategory, BP_CATEGORY_COLORS, SavedDataset } from './bp.model';
import { APP_VERSION } from './version';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-root',
  imports: [DecimalPipe, DatePipe, NgClass, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private parser = inject(BpParserService);
  private storage = inject(FileStorageService);

  readonly version = APP_VERSION;

  readings = signal<BpReading[]>([]);
  loading = signal(false);
  error = signal('');
  dragOver = signal(false);

  savedDatasets = signal<SavedDataset[]>([]);
  activeDatasetId = signal<string | null>(null);
  saveName = signal('');
  saveSuccess = signal(false);
  deleteConfirmId = signal<string | null>(null);
  renameId = signal<string | null>(null);
  renameDraft = signal('');
  dropdownOpen = signal(false);

  filterYear = signal<number | null>(null);
  filterMonth = signal<number | null>(null);

  availableYears = computed(() =>
    [...new Set(this.readings().map(r => r.date.getFullYear()))].sort((a, b) => a - b)
  );

  availableMonths = computed(() => {
    const year = this.filterYear();
    const source = year ? this.readings().filter(r => r.date.getFullYear() === year) : this.readings();
    return [...new Set(source.map(r => r.date.getMonth() + 1))].sort((a, b) => a - b);
  });

  filteredReadings = computed(() => {
    const year = this.filterYear();
    const month = this.filterMonth();
    if (!year && !month) return this.readings();
    return this.readings().filter(r => {
      if (year && r.date.getFullYear() !== year) return false;
      if (month && r.date.getMonth() + 1 !== month) return false;
      return true;
    });
  });

  sortColumn = signal<'date' | 'systolic' | 'diastolic' | 'pulse' | 'category'>('date');
  sortDir = signal<'asc' | 'desc'>('asc');

  sortedReadings = computed(() => {
    const col = this.sortColumn();
    const dir = this.sortDir();
    return [...this.filteredReadings()].sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (col) {
        case 'date':     av = a.date.getTime(); bv = b.date.getTime(); break;
        case 'systolic': av = a.systolic;       bv = b.systolic;       break;
        case 'diastolic':av = a.diastolic;      bv = b.diastolic;      break;
        case 'pulse':    av = a.pulse ?? -1;    bv = b.pulse ?? -1;    break;
        case 'category': av = getBpCategory(a.systolic, a.diastolic);
                         bv = getBpCategory(b.systolic, b.diastolic);  break;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === 'asc' ? cmp : -cmp;
    });
  });

  private trendCanvas = viewChild<ElementRef<HTMLCanvasElement>>('trendChart');
  private monthCanvas = viewChild<ElementRef<HTMLCanvasElement>>('monthChart');
  private categoryCanvas = viewChild<ElementRef<HTMLCanvasElement>>('categoryChart');

  private trendChartInstance: Chart | null = null;
  private monthChartInstance: Chart | null = null;
  private categoryChartInstance: Chart | null = null;

  // ── Computed stats ──────────────────────────────────────────────────────────

  stats = computed(() => {
    const r = this.readings();
    if (!r.length) return null;
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const sys = r.map(x => x.systolic);
    const dia = r.map(x => x.diastolic);
    const pulses = r.filter(x => x.pulse).map(x => x.pulse!);
    return {
      count: r.length,
      avgSys: avg(sys),
      avgDia: avg(dia),
      avgPulse: pulses.length ? avg(pulses) : null,
      maxSys: Math.max(...sys),
      minSys: Math.min(...sys),
      maxDia: Math.max(...dia),
      minDia: Math.min(...dia),
      category: getBpCategory(avg(sys), avg(dia)),
    };
  });

  monthlyStats = computed(() => {
    const r = this.readings();
    const map = new Map<string, { sys: number[]; dia: number[]; pulses: number[] }>();
    for (const reading of r) {
      const key = `${reading.date.getFullYear()}-${String(reading.date.getMonth() + 1).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, { sys: [], dia: [], pulses: [] });
      const entry = map.get(key)!;
      entry.sys.push(reading.systolic);
      entry.dia.push(reading.diastolic);
      if (reading.pulse) entry.pulses.push(reading.pulse);
    }
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        label: new Date(month + '-01').toLocaleString('default', { month: 'short', year: 'numeric' }),
        avgSys: avg(data.sys),
        avgDia: avg(data.dia),
        avgPulse: data.pulses.length ? avg(data.pulses) : null,
        count: data.sys.length,
        category: getBpCategory(avg(data.sys), avg(data.dia)),
      }));
  });

  categoryBreakdown = computed(() => {
    const r = this.readings();
    const counts: Record<BpCategory, number> = {
      Normal: 0, Elevated: 0, 'High Stage 1': 0, 'High Stage 2': 0, Crisis: 0, Low: 0,
    };
    for (const reading of r) counts[getBpCategory(reading.systolic, reading.diastolic)]++;
    return (Object.entries(counts) as [BpCategory, number][])
      .filter(([, count]) => count > 0)
      .map(([category, count]) => ({ category, count, pct: (count / r.length) * 100, color: BP_CATEGORY_COLORS[category] }));
  });

  isSaved = computed(() => this.activeDatasetId() !== null);

  activeDatasetName = computed(() => {
    const id = this.activeDatasetId();
    return id ? (this.savedDatasets().find(d => d.id === id)?.name ?? '') : '';
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  constructor() {
    this.savedDatasets.set(this.storage.list());

    effect(() => {
      const r = this.readings();
      if (r.length) {
        Promise.resolve().then(() => {
          this.renderTrendChart(r);
          this.renderMonthChart();
          this.renderCategoryChart();
        });
      }
    });
  }

  // ── Save / load / delete ─────────────────────────────────────────────────────

  saveDataset() {
    const name = this.saveName().trim();
    if (!name || !this.readings().length) return;
    const dataset = this.storage.save(name, this.readings());
    this.savedDatasets.set(this.storage.list());
    this.activeDatasetId.set(dataset.id);
    this.saveSuccess.set(true);
    setTimeout(() => this.saveSuccess.set(false), 2500);
  }

  loadDataset(id: string) {
    const readings = this.storage.load(id);
    if (!readings) return;
    this.destroyCharts();
    this.readings.set(readings);
    this.activeDatasetId.set(id);
    this.saveName.set(this.savedDatasets().find(d => d.id === id)?.name ?? '');
    this.error.set('');
  }

  @HostListener('document:click')
  closeDropdown() { this.dropdownOpen.set(false); }

  toggleDropdown(e: MouseEvent) {
    e.stopPropagation();
    this.dropdownOpen.update(v => !v);
  }

  selectDataset(e: MouseEvent, id: string) {
    e.stopPropagation();
    this.dropdownOpen.set(false);
    if (id !== this.activeDatasetId()) this.loadDataset(id);
  }

  confirmDelete(id: string) {
    this.renameId.set(null);
    this.deleteConfirmId.set(id);
  }

  cancelDelete() {
    this.deleteConfirmId.set(null);
  }

  deleteDataset(id: string) {
    this.storage.delete(id);
    this.savedDatasets.set(this.storage.list());
    this.deleteConfirmId.set(null);
    if (this.activeDatasetId() === id) {
      this.reset();
    }
  }

  startRename(ds: { id: string; name: string }) {
    this.deleteConfirmId.set(null);
    this.renameId.set(ds.id);
    this.renameDraft.set(ds.name);
  }

  confirmRename() {
    const id = this.renameId();
    const name = this.renameDraft().trim();
    if (!id || !name) return;
    this.storage.rename(id, name);
    this.savedDatasets.set(this.storage.list());
    if (this.activeDatasetId() === id) {
      this.saveName.set(name);
    }
    this.renameId.set(null);
  }

  cancelRename() {
    this.renameId.set(null);
  }

  // ── Chart rendering ─────────────────────────────────────────────────────────

  private renderTrendChart(readings: BpReading[]) {
    const canvas = this.trendCanvas()?.nativeElement;
    if (!canvas) return;
    this.trendChartInstance?.destroy();
    this.trendChartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: readings.map(r => r.date.toLocaleDateString()),
        datasets: [
          {
            label: 'Systolic',
            data: readings.map(r => r.systolic),
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.08)',
            tension: 0.3,
            fill: false,
            pointRadius: readings.length > 60 ? 0 : 3,
          },
          {
            label: 'Diastolic',
            data: readings.map(r => r.diastolic),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.08)',
            tension: 0.3,
            fill: false,
            pointRadius: readings.length > 60 ? 0 : 3,
          },
          ...(readings.some(r => r.pulse) ? [{
            label: 'Pulse',
            data: readings.map(r => r.pulse ?? null),
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.08)',
            tension: 0.3,
            fill: false,
            pointRadius: readings.length > 60 ? 0 : 3,
            borderDash: [4, 4],
          }] : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          y: { beginAtZero: false, title: { display: true, text: 'mmHg / bpm' } },
          x: { ticks: { maxTicksLimit: 12 } },
        },
      },
    });
  }

  private renderMonthChart() {
    const canvas = this.monthCanvas()?.nativeElement;
    if (!canvas) return;
    const monthly = this.monthlyStats();
    this.monthChartInstance?.destroy();
    this.monthChartInstance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: monthly.map(m => m.label),
        datasets: [
          {
            label: 'Avg Systolic',
            data: monthly.map(m => m.avgSys),
            backgroundColor: 'rgba(239,68,68,0.7)',
            borderColor: '#ef4444',
            borderWidth: 1,
          },
          {
            label: 'Avg Diastolic',
            data: monthly.map(m => m.avgDia),
            backgroundColor: 'rgba(59,130,246,0.7)',
            borderColor: '#3b82f6',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: false, title: { display: true, text: 'mmHg' } } },
      },
    });
  }

  private renderCategoryChart() {
    const canvas = this.categoryCanvas()?.nativeElement;
    if (!canvas) return;
    const cats = this.categoryBreakdown();
    this.categoryChartInstance?.destroy();
    this.categoryChartInstance = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: cats.map(c => c.category),
        datasets: [{
          data: cats.map(c => c.count),
          backgroundColor: cats.map(c => c.color),
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right' } },
      },
    });
  }

  // ── File handling ────────────────────────────────────────────────────────────

  async onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) await this.loadFile(file, file.name.replace(/\.[^.]+$/, ''));
  }

  onDragOver(e: DragEvent) { e.preventDefault(); this.dragOver.set(true); }
  onDragLeave() { this.dragOver.set(false); }

  async onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragOver.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) await this.loadFile(file, file.name.replace(/\.[^.]+$/, ''));
  }

  private async loadFile(file: File, suggestedName: string) {
    this.loading.set(true);
    this.error.set('');
    this.activeDatasetId.set(null);
    this.saveName.set(suggestedName);
    this.destroyCharts();
    try {
      const readings = await this.parser.parseFile(file);
      if (!readings.length) throw new Error('No valid readings found. Check that your spreadsheet has systolic and diastolic columns.');
      this.readings.set(readings);
    } catch (e: any) {
      this.error.set(e.message ?? 'Failed to parse file.');
      this.readings.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private destroyCharts() {
    this.trendChartInstance?.destroy(); this.trendChartInstance = null;
    this.monthChartInstance?.destroy(); this.monthChartInstance = null;
    this.categoryChartInstance?.destroy(); this.categoryChartInstance = null;
  }

  setFilterYear(value: number | null) {
    this.filterYear.set(value);
    // reset month if it no longer exists in the newly selected year
    if (value && this.filterMonth() && !this.availableMonths().includes(this.filterMonth()!)) {
      this.filterMonth.set(null);
    }
  }

  setFilterMonth(value: number | null) {
    this.filterMonth.set(value);
  }

  clearFilters() {
    this.filterYear.set(null);
    this.filterMonth.set(null);
  }

  monthName(m: number): string {
    return new Date(2000, m - 1, 1).toLocaleString('default', { month: 'long' });
  }

  sortBy(col: 'date' | 'systolic' | 'diastolic' | 'pulse' | 'category') {
    if (this.sortColumn() === col) {
      this.sortDir.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(col);
      this.sortDir.set('asc');
    }
  }

  getCategoryColor(cat: BpCategory): string {
    return BP_CATEGORY_COLORS[cat];
  }

  getReadingCategory(r: BpReading): BpCategory {
    return getBpCategory(r.systolic, r.diastolic);
  }

  reset() {
    this.destroyCharts();
    this.readings.set([]);
    this.error.set('');
    this.activeDatasetId.set(null);
    this.saveName.set('');
    this.saveSuccess.set(false);
    this.deleteConfirmId.set(null);
    this.renameId.set(null);
    this.dropdownOpen.set(false);
    this.filterYear.set(null);
    this.filterMonth.set(null);
  }
}
