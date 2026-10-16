/** ISO weekday: Monday=1 ... Sunday=7; local wall-clock minute precision. */
export interface ShiftBreakpoint { weekday: number; time: string; graceMinutes: number; }
export interface WeeklyScheduleVersion { revision: number; effectiveAt: string; breakpoints: ShiftBreakpoint[]; }
export interface WeeklySchedule { id: string; groupId: string; name: string; revision: number; versions: WeeklyScheduleVersion[]; }
export interface SaveWeeklySchedule { name: string; breakpoints: ShiftBreakpoint[]; expectedRevision?: number; previewToken?: string; }
export interface ShiftCheckpoint { at: string; graceStartsAt: string; revision: number; }
export interface UnitSchedulePreview {
  unitId: string; timeZone: string; evaluatedAt: string; selectionRevision: number;
  scheduleId: string | null; scheduleName: string | null; effectiveAt: string | null;
  pending: { scheduleId: string | null; effectiveAt: string } | null;
  activeVersion?: WeeklyScheduleVersion | null; nextVersion?: WeeklyScheduleVersion | null;
  state: 'missing' | 'blank' | 'scheduled'; activeCheckpoint: ShiftCheckpoint | null;
  nextCheckpoint: ShiftCheckpoint | null; graceCheckpoints: ShiftCheckpoint[];
}

/** Server-authored, session-bound draft preview; save may reject an expired or changed context. */
export interface ScheduleChangePreview { effectiveAt: string; evaluatedAt: string; previewToken: string; }
