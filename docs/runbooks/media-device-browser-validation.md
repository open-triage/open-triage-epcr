# Media device and browser validation

This records human verification for issue #502. Automated coverage supports the
device checks below but does not substitute for them.

## Confirmed capture coverage — 8 October 2026

The project owner confirmed that **photo and audio capture are validated on
Android/Chrome and iOS/Safari**. This supersedes the earlier blanket statement
that real-device capture was unverified. Video capture is not part of this feature.

| Platform | Confirmed coverage | Evidence |
| --- | --- | --- |
| Android · Chrome | Photo and audio capture | Project-owner confirmation, 2026-10-08; exact OS/browser versions not recorded. |
| iOS · Safari | Photo and audio capture | Project-owner confirmation, 2026-10-08; exact OS/browser versions not recorded. |

The confirmation does not distinguish current and previous browser versions or
record results for every recovery, negative, and accessibility journey below.
Those entries remain a checklist for the additional coverage; they do not mean
the confirmed capture functionality is untested. Record exact versions, tester,
date, results, and approved exceptions when completing these checks. Closure of
the full issue requires review of that broader matrix.

## Extended journey and version matrix

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

The web unit and Playwright suites cover capture capability/error copy, Text-note preservation, keyboard/dialog focus, filter toggles, live regions, button names, decorative thumbnail alternatives with descriptive surrounding controls, direct playback, responsive widths, protected offline staging/resume, readiness, and axe serious/critical violations. Playwright emulation and engines are supporting evidence only. Platform-level capture validation is recorded above; version-specific full-journey results still need recording in the extended matrix.

## Full-matrix approval

- Reviewer: _Pending_
- Date: _Pending_
- Decision: **Pending human confirmation**
- Approved exceptions: _None recorded_
