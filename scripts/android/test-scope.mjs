/** Explicit focused diagnosis never substitutes for the complete default acceptance run. */
export function androidTestScope(args) {
  const focused = args.includes('--pdf-clinical-only');
  if (focused && ['--tls-only','--oidc-only','--agency-only','--report-only','--external-apis','--skip-oidc'].some(value => args.includes(value))) {
    throw new Error('--pdf-clinical-only cannot be combined with another acceptance scope');
  }
  return { focusedPdfClinical: focused, startupAndComponents: !focused, pairing: !focused, managed: !focused, tls: !focused, agencyAndOidc: !focused };
}
