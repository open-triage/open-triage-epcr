"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClinicalFormConfiguration, HospitalIdentifier, EpsContext, EpsLookup } from '@open-triage/contracts';
import { browserRequestConfiguration, browserRequestInit, browserRouteUrl } from '../app/browser-api';
import { applyProtectedAuthorityResponse, discardProtectedEps, protectedEps, protectedEpsPatientMapping, protectedStorageActive, protectedStorageStatus, retainProtectedEps, subscribeProtectedStorageStatus, type ProtectedEpsScope } from '../app/protected-clinical-storage';

import { patientSummaryDocumentKey } from '../app/patient-summary-identity';

type State = { key: string; status: string; result?: EpsLookup; cached?: boolean };
class EpsDenied extends Error {}
export function usePatientSummary(rawScope: ProtectedEpsScope, ready: boolean, form?: ClinicalFormConfiguration) {
  const [mapping, setMapping] = useState<HospitalIdentifier | undefined>(() => protectedEpsPatientMapping(rawScope));
  const documentKey = patientSummaryDocumentKey(rawScope.documentKey, mapping, form);
  const scope = { ...rawScope, documentKey };
  const key = JSON.stringify(scope);
  const { reportId, organizationId } = scope;
  const [state, setState] = useState<State>({ key: '', status: 'checking' });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [online, setOnline] = useState(true);
  const [authorizedKey, setAuthorizedKey] = useState<string | null>(null);
  const active = useRef('');
  const locked = useRef(protectedStorageStatus(reportId).mode === 'locked');
  const lockedReport = useRef(reportId);
  // One generation fences every async completion across scope, binding, lock
  // and explicit refresh transitions. A stale retention may remove only itself.
  const authority = useRef(0);
  const binding = useRef<string | null>(null);
  const invalidate = useCallback((nextBinding = binding.current) => {
    binding.current = nextBinding;
    return ++authority.current;
  }, []);
  const current = state.key === key ? state : { key, status: 'checking' };
  const latest = useRef(current);
  useEffect(() => { latest.current = current; });
  useEffect(() => {
    if (lockedReport.current !== reportId) { locked.current = protectedStorageStatus(reportId).mode === 'locked'; lockedReport.current = reportId; }
    active.current = key; invalidate(null);
    return () => { active.current = ''; invalidate(null); };
  }, [key, reportId, invalidate]);
  useEffect(() => {
    const changed = () => { setOnline(navigator.onLine); };
    changed(); window.addEventListener('online', changed); window.addEventListener('offline', changed);
    return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); };
  }, []);
  useEffect(() => {
    const enforce = () => {
      if (latest.current.key === key && latest.current.cached && latest.current.result?.context?.binding === binding.current && !protectedEps(JSON.parse(key) as ProtectedEpsScope)) {
        invalidate(null); setAuthorizedKey(null);
        setState({ key, status: 'failed' }); setOpenKey(null);
      }
    };
    const remove = subscribeProtectedStorageStatus((id, status) => {
      if (id !== reportId) return;
      if (status.mode === 'locked') { locked.current = true; setAuthorizedKey(null); invalidate(); setState({ key, status: 'failed' }); setOpenKey(null); }
      else if (locked.current && protectedStorageActive(reportId)) { locked.current = false; invalidate(); setRetry(value => value + 1); }
      else enforce();
    });
    const timer = setInterval(enforce, 1000);
    return () => { remove(); clearInterval(timer); };
  }, [key, reportId, invalidate]);
  useEffect(() => {
    if (browserRequestConfiguration().mode === 'static') return;
    const scope = JSON.parse(key) as ProtectedEpsScope;
    let stopped = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let generation = authority.current;
    const valid = () => !stopped && !locked.current && authority.current === generation && active.current === key;
    function fallback() {
      const result = protectedEps(scope);
      if (binding.current !== (result?.context?.binding ?? null)) generation = invalidate(result?.context?.binding ?? null);
      setState(result ? { key, status: 'available', result, cached: true } : { key, status: 'failed' });
      if (!result) setOpenKey(null);
    }
    async function read<T>(path: string): Promise<T> {
      const response = await fetch(browserRouteUrl(`/api/reports/${reportId}/eps${path}`), browserRequestInit({ signal: controller.signal }));
      if (!response.ok) {
        if (response.status >= 500) throw new Error('EPS temporarily unavailable');
        if (valid()) { generation = invalidate(null); setAuthorizedKey(null); discardProtectedEps(reportId); applyProtectedAuthorityResponse(reportId, response); }
        throw new EpsDenied();
      }
      return response.json() as Promise<T>;
    }
    async function check() {
      generation = authority.current;
      if (!valid()) return;
      try {
        if (!navigator.onLine) { if (valid()) fallback(); return; }
        if (!ready) return;
        const context = await read<EpsContext | null>('/context');
        if (!valid()) return;
        setAuthorizedKey(key);
        if (!context) { generation = invalidate(null); discardProtectedEps(reportId); setState({ key, status: 'disabled' }); setOpenKey(null); return; }
        if (context.organizationId !== organizationId || context.reportId !== reportId) throw new EpsDenied();
        if (binding.current !== context.binding) generation = invalidate(context.binding);
        if (form && JSON.stringify(mapping) !== JSON.stringify(context.patientIdentifier)) { setMapping(context.patientIdentifier); return; }
        const prior = latest.current;
        if (prior.key === key && prior.result?.context?.binding === context.binding && prior.status === 'available') return;
        if (protectedEps(scope)?.context?.binding !== context.binding) discardProtectedEps(reportId);
        setState({ key, status: 'checking' }); setOpenKey(null);
        const result = await read<EpsLookup>(`?binding=${encodeURIComponent(context.binding)}`);
        if (!valid()) return;
        if (result.context?.binding !== context.binding) throw new EpsDenied();
        setState({ key, status: result.status, result });
      } catch (error) {
        if (!valid()) return;
        if (error instanceof EpsDenied) { setAuthorizedKey(null); generation = invalidate(null); discardProtectedEps(reportId); setState({ key, status: 'failed' }); setOpenKey(null); }
        else fallback();
      } finally { if (!stopped && !locked.current && active.current === key) timer = setTimeout(() => void check(), 15000); }
    }
    timer = setTimeout(() => void check(), 300);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [key, reportId, organizationId, ready, retry, online, mapping, form, invalidate]);

  async function openSummary() {
    if (locked.current) return;
    const generation = authority.current;
    const valid = () => !locked.current && authority.current === generation && active.current === key;
    const saved = protectedEps(scope);
    if (!navigator.onLine) {
      if (saved) { setState({ key, status: 'available', result: saved, cached: true }); setOpenKey(key); }
      return;
    }
    try {
      const response = await fetch(browserRouteUrl(`/api/reports/${reportId}/eps/context`), browserRequestInit());
      if (!valid()) return;
      if (!response.ok) {
        if (response.status >= 500) throw new Error('EPS temporarily unavailable');
        invalidate(null); setAuthorizedKey(null); discardProtectedEps(reportId); applyProtectedAuthorityResponse(reportId, response);
        setState({ key, status: 'failed' }); setOpenKey(null); return;
      }
      const context = await response.json() as EpsContext | null;
      if (!valid()) return;
      if (context?.binding !== current.result?.context?.binding) {
        invalidate(context?.binding ?? null);
        discardProtectedEps(reportId); setState({ key, status: 'checking' }); setRetry(value => value + 1); return;
      }
      if (!current.result) return;
      // Persistence failure does not prevent authorized online reading, but never promises an offline copy.
      let cached = false;
      try { cached = await retainProtectedEps(scope, current.result, valid); } catch { /* Existing storage status explains the failure. */ }
      if (!valid()) return;
      setState({ ...current, cached }); setOpenKey(key);
    } catch (error) {
      if (!valid()) return;
      const retained = protectedEps(scope);
      if (!(error instanceof EpsDenied) && retained) { setState({ key, status: 'available', result: retained, cached: true }); setOpenKey(key); }
      else { setState({ key, status: 'failed' }); setOpenKey(null); }
    }
  }
  function refresh() {
    if (!navigator.onLine || locked.current) return;
    invalidate();
    // Remove only the current viewer copy. Imported provenance is part of the encounter, never touched here.
    latest.current = { key, status: 'checking' };
    setState({ key, status: 'checking' }); setOpenKey(null); setRetry(value => value + 1);
  }
  return { current, online, accessBlocked: authorizedKey !== key, open: openKey === key && current.status === 'available', openSummary, close: () => { invalidate(); setOpenKey(null); }, dismissed: () => setOpenKey(null), refresh };
}
