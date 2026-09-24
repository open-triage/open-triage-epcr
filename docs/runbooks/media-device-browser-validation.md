# Media device and browser validation

This is the human verification gate for issue #502. Automated coverage is necessary but does not substitute for real-device capture, browser permission prompts, audio output, or responsive visual review. Record the exact OS and browser versions, tester, date, result, and any approved exception in this table. Do not close #502 until a human reviewer approves every representative row.

## Representative matrix

| Platform | Exact version tested | Journeys | Result | Approved exception / evidence |
| --- | --- | --- | --- | --- |
| iPhone or iPad · current major iOS Safari | _Unverified_ | Live rear/front photo capture; preview and rotation; spoken-audio record/stop/preview; offline staging; close/reopen; reconnect/resume; timeline open/play; readiness | **HITL pending** | — |
| iPhone or iPad · previous major iOS Safari | _Unverified_ | Same complete mobile journey | **HITL pending** | — |
| Android · current major Chrome | _Unverified_ | Same complete mobile journey | **HITL pending** | — |
| Android · previous major Chrome | _Unverified_ | Same complete mobile journey | **HITL pending** | — |
| Desktop · current Chrome | _Unverified_ | Stationary timeline All/Notes filters; photo open; direct audio play/pause; caption edit; delete confirmation; keyboard/focus; responsive layout | **HITL pending** | — |
| Desktop · current Edge | _Unverified_ | Same complete Stationary journey | **HITL pending** | — |
| Desktop · current Safari | _Unverified_ | Same complete Stationary journey | **HITL pending** | — |
| Desktop · current Firefox | _Unverified_ | Same complete Stationary journey | **HITL pending** | — |

## Required negative checks

On at least one representative mobile device, deny camera and microphone permission, then verify the explanation names browser site settings and that Text note still opens. Test the installed application from an intentionally insecure non-localhost HTTP origin, or use an approved equivalent lab setup, and verify media capture explains the HTTPS requirement while Text note remains available. On a device/browser without a capture API, verify the unsupported explanation is visible and actionable.

## Accessibility checkpoint

Using keyboard-only desktop navigation and the mobile screen readers used by the agency, verify focus enters each media dialog, stays within it, returns to its trigger, and remains visible; Escape behavior does not discard a recording silently; toggle state and live status changes are announced; photo thumbnails have useful surrounding button names; direct audio playback is named and operable; dialogs, previews, timeline rows, and sticky actions do not clip or overlap at supported viewport sizes and text zoom.

## Automated evidence

The web unit and Playwright suites cover capture capability/error copy, Text-note preservation, keyboard/dialog focus, filter toggles, live regions, button names, decorative thumbnail alternatives with descriptive surrounding controls, direct playback, responsive widths, protected offline staging/resume, readiness, and axe serious/critical violations. Playwright emulation and engines are supporting evidence only; the versioned rows above remain unverified until tested on the named real browsers/devices.

## Approval

- Reviewer: _Pending_
- Date: _Pending_
- Decision: **Pending human confirmation**
- Approved exceptions: _None recorded_
