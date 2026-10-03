# UI style guide

Agreed 2026-10-03. Applies to clinical, Admin, and Review interfaces on desktop
and mobile.

Build compact, consistent workspaces that use agency branding and keep the
current task within the available screen. Scrollable lists and content panels
are welcome. Avoid building long pages by stacking unrelated tasks.

## Scope for agents

Read this guide before developing UI. New or changed UI must follow these
rules, including shared components needed for the work. Reuse or extend shared
styles and components instead of introducing a separate visual language.

Record other existing departures in the
[remediation backlog](ui-style-guide-backlog.md) for future work. Keep unrelated
redesigns outside the current task. Existing inconsistencies are not precedents
to copy. This guide defines the intended behavior; it does not imply every
existing screen already complies.

## Screen layout and navigation

- Aim to fit each desktop workspace within the viewport. Keep navigation and
  relevant actions accessible while its content scrolls.
- Divide different tasks into tabs. Use pagination for large collections and
  bounded scroll regions for lists or content that exceed the available space.
  Pagination alone does not prevent a tall page: account for headers, filters,
  actions, and the pagination controls when sizing the list.
- Avoid stacking settings, editors, results, and unrelated sections down one
  long page. Show the current task in the available workspace.
- On mobile, preserve the task divisions and adapt to available width. Allow
  vertical scrolling when needed to keep text and controls usable. Enlarged
  text, a small viewport, or the on-screen keyboard must not make content or
  actions unreachable. Do not enforce screen fit by clipping content.
- Use tables for repeated records when they support comparison. Adapt wide
  content for smaller screens without shrinking text to fit.

Use the current Review queue as the reference for list/detail interactions:

1. Selecting a row opens an inspector alongside the list when space permits.
2. The explicit **View** action opens the full report within the same browser
   page, replacing the list workspace.
3. Complex editing uses a dedicated view. Short tasks can use a dialog.
4. On mobile, detail uses the available width rather than squeezing beside a
   narrow list.
5. Returning to the list preserves filters, pagination, and scroll position.

The reference is implemented in `selectReport`, the row click handler, and the
View action in [review-shell.tsx](../../apps/web/components/review-shell.tsx).
[Review interaction tests](../../apps/web/e2e/review-call-window.spec.ts) describe
the inspector and full-report transitions. Verify state preservation for the
work being changed; the reference is not exempt from the rest of this guide.

## Agency and semantic colors

Use the shared agency configuration and CSS properties. Do not hardcode the
default agency palette into components.

| Purpose | Current CSS property | Configuration field |
| --- | --- | --- |
| Accent | `--green` | `accentColor` |
| Dark/hover accent | `--green-dark` | `accentDarkColor` |
| Destructive actions | `--destructive` | `destructiveColor` |
| Inactive button background | `--inactive-button` | `inactiveButtonColor` |
| Normal text | `--text-color` | `textColor` |

Despite their legacy names, `--green` and `--green-dark` represent the agency's
chosen accent. The mapping lives in
[installation-settings.ts](../../apps/web/app/installation-settings.ts);
[styles.css](../../apps/web/app/styles.css) defines shared styles and defaults.

Keep warning, error, success, and clinical status colors consistent across
agencies. Pair semantic colors with labels or meaningful icons so status does
not depend on color alone. A configured destructive button color does not
redefine an error or clinical status color. Preserve legible text and visible
focus indicators when using a nondefault agency palette.

## Buttons and controls

Use one button hierarchy across all workspaces:

| Role or state | Treatment |
| --- | --- |
| Primary action | Agency accent fill with legible contrasting text |
| Selected tab or toggle | Agency accent fill and a clear selected state |
| Secondary action or unselected tab | Agency inactive background, agency text color, and accent border |
| Destructive action | Agency destructive color |
| Disabled control | Visibly disabled and noninteractive; distinct from an unselected control |

Use native control semantics and expose selection, expansion, and disabled
states to assistive technology. Preserve keyboard access and visible focus.
Give icon-only actions accessible names. Do not use color as the sole indicator
of selected, disabled, or error states.

## Density, typography, and spacing

Minimize dead space. Use modest headings, restrained spacing, and minimal
decorative cards. Group related information clearly without repeatedly wrapping
it in padded containers.

Use the existing type roles as the starting scale:

| Role | Shared property | Starting size |
| --- | --- | --- |
| Caption | `--text-caption` | 12px |
| Body | `--text-body` | 14px |
| Control | `--text-control` | 16px |
| Heading | `--text-heading` | 24px |

Keep buttons and text-entry controls at least 44px tall. Small checkbox/radio
marks can sit within a usable labeled target. Fit content by organizing it,
not by shrinking text or controls.

Apply consistent margins and alignment across screens, panels, and field
groups. Prefer shared spacing values and layout gaps over one-off adjustments.
Use consistent outer insets, label-to-control gaps, spacing between fields,
and action-row spacing. Avoid doubled padding from nested containers.

Every text field, select, and textarea must receive the shared field treatment:
internal padding, border, typography, text color, focus and disabled states,
and space between the field and surrounding content. Labels, help text, and
validation messages belong with their control. An unstyled browser input or a
field pressed against its label or container edge is a defect, not a compact
layout. Check fields inside conditional editors and dialogs as well as the
main form.

## Editing, tabs, and save status

- Preserve in-progress edits when switching tabs within an editor.
- Keep Save/Cancel accessible in workflows that use explicit saving.
- Identify tabs containing validation errors and make the affected field easy
  to reach. Errors in hidden tabs must not leave users guessing why saving failed.
- Prompt before leaving an editor in a way that would discard unsaved changes.
- Preserve existing autosave workflows. Show save status, including pending or
  failed saves; avoid reporting success before persistence has completed.
- Returning from a dialog or detail view should restore useful keyboard focus.

## UI change review checklist

Apply the checks relevant to the changed workflow. Browser inspection is
needed for layout and appearance; source inspection alone cannot prove screen
fit. Use meaningful existing tests or add focused coverage for changed behavior.

- [ ] The desktop workspace stays focused on the current task; long collections
      scroll within their allotted area and pagination remains reachable.
- [ ] Mobile layout and enlarged text keep content and controls reachable.
- [ ] A nondefault agency palette reaches the changed controls; semantic
      statuses retain their meaning.
- [ ] Primary, secondary, selected, destructive, and disabled treatments are
      consistent; keyboard focus and labels remain clear.
- [ ] Fields have consistent padding, margins, typography, and alignment;
      unnecessary empty space and nested padding have been removed.
- [ ] Where applicable, list state survives detail navigation, drafts survive
      tab switches, hidden errors are discoverable, and save status is clear.
- [ ] Newly discovered unrelated violations are recorded in the backlog with
      evidence; any resolved entry includes the change and verification.

The [backlog](ui-style-guide-backlog.md) separates confirmed source findings
from checks still needing browser verification. Its initial audit is partial.
