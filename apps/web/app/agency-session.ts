import type {AuthenticatedSession} from '@open-triage/contracts';
import {storeClinicianSession} from './clinician-session';
import {clearFeedbackTelemetry} from './feedback-telemetry';
import {INSTALLATION_CONFIGURATION_STORAGE_KEY} from './installation-settings';

/** Common context cleanup has no dependency on native handoff orchestration. */
export function clearAgencyHandoffCaches(){
 clearFeedbackTelemetry();window.localStorage.removeItem(INSTALLATION_CONFIGURATION_STORAGE_KEY);
}
export function storeAgencyHandoffSession(session:AuthenticatedSession){
 clearAgencyHandoffCaches();storeClinicianSession(window.localStorage,session);
}
