import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';
import { BpReading } from './bp.model';

@Injectable({ providedIn: 'root' })
export class BpParserService {

  parseFile(file: File): Promise<BpReading[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target!.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          resolve(this.mapRows(rows));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  private mapRows(rows: any[]): BpReading[] {
    if (!rows.length) return [];

    const headers = Object.keys(rows[0]).map(h => h.toLowerCase().trim());
    const col = (candidates: string[]) =>
      Object.keys(rows[0]).find(k => candidates.includes(k.toLowerCase().trim()));

    const dateCol = col(['date', 'datetime', 'time', 'timestamp', 'recorded', 'recorded date']);
    const sysCol = col(['systolic', 'sys', 'systolic (mmhg)', 'systolic pressure', 'bp systolic']);
    const diaCol = col(['diastolic', 'dia', 'diastolic (mmhg)', 'diastolic pressure', 'bp diastolic']);
    const pulseCol = col(['pulse', 'heart rate', 'hr', 'bpm']);
    const notesCol = col(['notes', 'note', 'comments', 'comment']);

    // fallback: try positional columns if headers don't match
    const keys = Object.keys(rows[0]);
    const dateKey = dateCol ?? keys[0];
    const sysKey = sysCol ?? keys[1];
    const diaKey = diaCol ?? keys[2];
    const pulseKey = pulseCol ?? keys[3];

    const readings: BpReading[] = [];
    for (const row of rows) {
      const rawDate = row[dateKey];
      const sys = Number(row[sysKey]);
      const dia = Number(row[diaKey]);

      if (!sys || !dia || isNaN(sys) || isNaN(dia)) continue;

      let date: Date;
      if (rawDate instanceof Date) {
        date = rawDate;
      } else if (typeof rawDate === 'number') {
        date = XLSX.SSF.parse_date_code(rawDate) ? new Date(rawDate) : new Date();
      } else {
        date = new Date(rawDate);
      }

      if (isNaN(date.getTime())) date = new Date();

      readings.push({
        date,
        systolic: sys,
        diastolic: dia,
        pulse: pulseKey && row[pulseKey] ? Number(row[pulseKey]) : undefined,
        notes: notesCol ? String(row[notesCol] ?? '') : undefined,
      });
    }

    return readings.sort((a, b) => a.date.getTime() - b.date.getTime());
  }
}
