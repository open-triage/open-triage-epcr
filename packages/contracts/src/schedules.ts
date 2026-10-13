/** ISO weekday: Monday=1 ... Sunday=7; local wall-clock minute precision. */
export interface ShiftBreakpoint { weekday: number; time: string; graceMinutes: number; }
export interface WeeklyScheduleVersion { revision: number; effectiveAt: string; breakpoints: ShiftBreakpoint[]; }
export interface WeeklySchedule { id: string; groupId: string; name: string; revision: number; versions: WeeklyScheduleVersion[]; }
export interface SaveWeeklySchedule { name: string; breakpoints: ShiftBreakpoint[]; expectedRevision?: number; }
export interface ShiftCheckpoint { at: string; graceStartsAt: string; revision: number; }
export interface UnitSchedulePreview {
  unitId: string; timeZone: string; evaluatedAt: string; selectionRevision: number;
  scheduleId: string | null; scheduleName: string | null; effectiveAt: string | null;
  pending: { scheduleId: string | null; effectiveAt: string } | null;
  state: 'missing' | 'blank' | 'scheduled'; activeCheckpoint: ShiftCheckpoint | null;
  nextCheckpoint: ShiftCheckpoint | null; graceCheckpoints: ShiftCheckpoint[];
}
