# WEST triage decision support

**Status** — Planned. Mobile interaction, four implementation modules, and test scope agreed on 2026-11-19. A draft WEST-A definition and an interactive mobile mockup exist.

## Problem Statement

A clinician taking repeat vital signs needs to know the patient's current WEST level, what drove it, and what changed since the last assessment. Today the vital entry has no shared way to combine observations with WEST warning criteria. A single report-level color would also lose the sequence of assessments, particularly when a clinician overrides the calculated level.

## Solution

Ship WEST-A as an installation-selectable, versioned JSON definition. In Mobile Vitals the clinician documents findings above the measurements, sees the live WEST result, and can choose any manual level. Every newly finalized WEST entry has exactly one effective color from green, yellow, orange, or red. The report uses the latest finalized measurement, and the timeline shows the color recorded at each assessment.

All WEST-specific behavior belongs in the definition. The application supplies the operations needed to interpret it. Changing a configured score band, a criterion's category, or a scale's color thresholds changes behavior through JSON alone.

## User Stories

1. As an administrator, I want to select a shipped decision support system or leave it disabled, so that crews use the system chosen for the installation.
2. As a clinician, I want to select a category and see its criteria in severity order, so that I can find an urgent finding quickly while the vital fields remain visible.
3. As a clinician, I want to browse freely and add findings from several categories, so that the record contains only the categories I assessed.
4. As a clinician, I want an explicit “No criteria met” choice in every category, so that a negative assessment is distinguishable from an unanswered question.
5. As a clinician, I want NEWS scoring to start on Standard and let me switch scales in one selector, so that I can use the appropriate tables and thresholds for the patient.
6. As a clinician, I want to see the calculated level, its driving finding or measurements, and whether the assessment is incomplete, so that I can act on what is already known.
7. As a clinician, I want an always-visible override that accepts any WEST color, so that I can document my judgment and still see the calculation.
8. As a clinician taking repeat vitals, I want my findings, scale choice, and manual override carried into the next entry, so that I can review them while entering fresh observations.
9. As a clinician moving between mobile encounter views, I want the current triage color visible at the screen edge, so that I can recognize the level while scrolling or charting.
10. As a clinician reviewing the timeline, I want each vital entry labeled with its own WEST result, so that I can see when urgency changed or a manual decision took effect.
11. As a clinician handing over the patient, I want the report to use the most recent measurement even when entries sync out of order, so that the handover reflects the latest assessment.
12. As a clinical reviewer, I want each assessment tied to its definition version, source findings, and override history, so that I can reconstruct the recorded decision.

## Implementation Decisions

### 1. Definition loading and Admin selection

Admin exposes one installation setting with **None** (default) and the shipped systems. Selecting WEST-A pins its key and version to new encounters. Existing encounters retain their definition when the setting or shipped version changes. The pinned definition must be available offline.

Register the WEST categories, criteria (including category-specific “No criteria met”), entry-wide “No warning criteria,” shared NEWS scale, and manual WEST color as custom elements in the installation's element catalog. An administrator can find them in the catalog and inspect their codes and association with the repeating Vitals group. Registration uses stable identities and is idempotent when the shipped definition is loaded again. Mobile writes the selected values to those same elements on the corresponding vital occurrence. The versioned WEST JSON supplies the codes and rules.

Register one additional catalog element for the calculated NEWS total. It is a read-only integer on the same vital occurrence, shared by all three scales.

The versioned JSON owns input bindings and units, coded choices, category-dependent criteria, display order, score bands, thresholds, partial-result rules, carry-forward and override rules, and source decisions. Labels use the localization system, with stable codes independent of display text. Validate that every supported input at its specified precision maps to exactly one score within its applicable scale and oxygen branch. Reject definitions with gaps or overlaps. Preserve the original source discrepancy and its resolution with the definition.

### 2. JSON-driven selections and scoring

**Category selection.** Browsing a category filters its dropdown. The first selected criterion, including “No criteria met,” adds the category to the documented list. Removing its last selection removes the category. Selecting “No criteria met” replaces findings only within that category. Selecting a finding replaces that category's negative choice. A cross-reference navigates to its target. Only the clinician selects clinical findings, including those whose wording mentions a numeric threshold.

**NEWS scale.** Start each WEST encounter with **Standard** selected. Its NEWS2 tables and thresholds apply immediately, including when the clinician leaves the selector untouched. The same selector offers **Obstetric** and **COPD**. A clinician can switch to either scale or back to Standard. Repeat vitals inherit the preceding selection within the encounter. Categories, findings, diagnoses, and pregnancy timing never change the scale. COPD uses the prescribed NEWS2 oxygen saturation Scale 2.

**Calculation.** Standard and COPD use respiratory rate, oxygen saturation, air or supplemental oxygen, systolic blood pressure, heart rate or pulse, consciousness including new confusion, and temperature. Obstetric applies its own bands and also requires diastolic pressure. The most urgent of the physiology color and the selected clinical findings determines the calculated WEST level. A finding contributes a color directly. With complete physiology, read the following thresholds from highest urgency downward. [SkaS WEST guide, PDF pages 10 and 24](https://mellanarkiv-offentlig.vgregion.se/alfresco/s/archive/stream/public/v1/source/available/sofia/skas13221-468498705-9/surrogate/WEST%20samt%20h%C3%A4nvisningsst%C3%B6d%20SkaS.pdf)

| Physiology profile | Red | Orange | Yellow | Green |
| --- | --- | --- | --- | --- |
| Standard or COPD | Total ≥7 | Total 5–6 | Any component scores 3 | Remaining totals 0–4 |
| Obstetric | Total ≥6 | Total 4–5 or any component scores 3 | Remaining totals 1–3 | Total 0 |

**Incomplete assessments.** Display a numeric total only when every required component has a valid score. Use the most urgent color supported by the available evidence. With missing measurements, label a supported yellow or orange **Provisional** because further observations may raise it. A supported red is definitive. Calculated green requires complete physiology and an explicit absence of warning findings, recorded entry-wide or through “No criteria met” in every documented category. An empty category list alone supplies no evidence.

**Finalization.** An unsupported draft displays gray **Unassessed**. Keep the draft and its measurements when the clinician tries to finalize it. Focus the override selector and explain that a supporting finding, sufficient measurements and findings assessment, or a manual color is required. Apply the same rule to online and offline finalization. Autosave can persist an unfinished draft. Only a finalized entry advances the report or timeline. An inherited manual override satisfies the color requirement and retains its provenance.

**Override.** The clinician can select Automatic or any of the four colors at any time. A manual color becomes the effective color. Continue displaying the calculated level, its basis, and any change since the override. Retain who selected the override, when, the calculated level at selection, and the source entry when inherited. Returning to Automatic immediately restores the current calculation.

### 3. Vital-entry storage and report history

Associate the WEST custom elements with the existing repeating vital group. Each occurrence stores its stable ID, measurement time, definition version, findings and explicit negatives, selected scale, calculation and completeness, override provenance, and effective result alongside its measurements.

On creation, copy findings, explicit negatives and any manual WEST override from the immediately preceding entry in **measurement-time order**. Use the latest preceding NEWS scale from this encounter, or Standard when there is no prior scale. Start fresh measurements, oxygen status, and consciousness. Calculate the score from this entry's observations and scale. Save the carried choices as a snapshot. A later correction to the source entry does not rewrite assessments that already inherited its selections.

The report projects the effective level and status from the **latest finalized vital entry by measurement time**, including a provisional or manual color. A newer unassessed draft leaves the last finalized result in the report. Re-evaluate which entry is latest after a correction, deletion, or out-of-order sync. Use a stable tie-breaker for equal measurement times so offline and online views agree. Retain historical results as recorded and leave legacy entries without a WEST assessment unlabeled.

### 4. Mobile Vitals and timeline

Place categories and criteria above the always-expanded vital inputs. Use a flat category picker with sentence-case labels and clinical acronyms preserved. Prefix each of the six gynecological subcategories with **Gyn 16+**. Combine trauma alerts and other injuries in **Trauma/skador** and append the source alert level to each applicable criterion name. Order clinical criteria red, orange, yellow, then green, with a readable severity label and color. Keep the neutral “No criteria met” choice available in every category.

Place the always-visible override selector beside the live WEST result. Draw a thin border along **all four edges of the entire mobile encounter viewport**, visible as content scrolls. The border uses the current effective color, including a manual override. Preview the live draft when it is the newest measurement, with a gray border while unassessed. Editing an older entry updates its own result while the border continues to show the current assessment.

In the Vitals selector, show the read-only **NEWS2 score** (or **ONEWS2 score** for Obstetric) beside the scale control as soon as every required observation for that scale has a valid score. Display zero explicitly. Recalculate on input or scale changes. If any required observation is missing or invalid, hide the whole score field and clear the derived value. Findings and color overrides affect WEST urgency independently of this total.

Each finalized WEST vital row in the timeline shows its **own saved** effective color and text, including “Manual” or “Provisional” when applicable. Keep clinical severity distinct from timeline validation indicators. Screen readers and keyboard users must be able to identify the level, status, and selection without relying on color.

## Testing Decisions

Test all four modules through their observable results. Extend the existing installation-settings, clinical form configuration, vitals-flow, canonical event, encounter timeline, and mobile vitals sync coverage.

| Module | Acceptance examples |
| --- | --- |
| Definition and Admin selection | An administrator enables WEST and opens an encounter offline with its pinned version. A later installation change applies to new encounters. Invalid references and unexplained overlaps produce visible configuration errors. With None selected, an ordinary vital entry still works. |
| Dependent selections and scoring | Change a rule through JSON alone. Exercise each valid score-band endpoint and both sides of the four resolved obstetric boundaries. Cover untouched Standard scoring, manual switching among all three scales, same-encounter carry-forward, and edits to categories or findings while a default or manual scale is active. Check isolated 3-point components, Scale 2 on air and oxygen, missing data, timed criteria, and explicit negatives. The same adult bleeding finding must return orange in either picker. |
| Vital storage and reporting | Save an orange entry, override it green, and add a later entry. Verify carry-forward, fresh measurements, corrections, deletion, equal times, backdating, and offline sync. Clearing an override in an unsupported draft must preserve its inputs, prevent finalization, and leave history intact. A manual color or newly supported color enables finalization. Every new finalized WEST entry has exactly one effective color. |
| Mobile Vitals and timeline | At 320 px and 390 px widths, enter findings and vitals with the override visible, scroll the screen, and change the effective level. Check all four border edges, the text and color on each historical row, keyboard access, localized labels, and the distinction between viewing an older entry and changing the current level. |
| Read-only NEWS total | Complete a set with zero points, change a scored observation, then clear it. The field shows 0, updates, then disappears. Switch from Standard to Obstetric with diastolic pressure missing, then enter it and confirm ONEWS2 appears. Saving and reopening retains the score for that entry. |

## Out of Scope

Future work includes Admin panels for editing and publishing rules, a general-purpose autofill facility for other form groups, and medication selection that prefills route or unit. This release covers the adult WEST-A assessment. Pediatric WEST, referral pathways, and treatment or monitoring orders are separate work.

## Further Notes

The draft definition under `defines/decision_support/` records an explicit decision and its basis for all 14 discrepancies. The supplied Östra category rows determine the selectable findings. The SkaS scoring tables determine physiology colors. Exceptions and local choices are recorded below. [WEST-A definition and decision register](../../defines/decision_support/west-a-2025.sv.json) · [Östra adult WEST guide](https://mellanarkiv-offentlig.vgregion.se/alfresco/s/archive/stream/public/v1/source/available/sofia/su1226-506079272-668/surrogate/WEST%20A%202025%20%C3%96stra.pdf)

- **Manual downgrades are a deliberate departure.** SkaS prohibits lowering red or orange by clinical assessment. The agreed product behavior permits both and preserves the calculated level alongside the clinician's decision. [SkaS WEST guide, PDF page 12](https://mellanarkiv-offentlig.vgregion.se/alfresco/s/archive/stream/public/v1/source/available/sofia/skas13221-468498705-9/surrogate/WEST%20samt%20h%C3%A4nvisningsst%C3%B6d%20SkaS.pdf#page=12)
- **Obstetric boundaries.** Use the contemporaneous Swedish obstetric NEWS2 chart to disambiguate the four endpoints in WEST 2025. Respiratory rate 10/min scores **0**, systolic pressure 80 mmHg scores **2**, diastolic pressure 90 mmHg scores **1**, and pulse 60/min scores **0**. All four contribute to the total normally. [Swedish obstetric NEWS2 chart used in the 2025 SFOG course](https://www.sfog.se/wp-content/uploads/2025/04/5-riskbedoemning-news-o-joanna-frykman-st-kurs-komplicerad-graviditet-25.pdf) · [Original authors’ chart](https://sfai.se/wp-content/uploads/2019/05/6.Hein-Obstetrisk-NEWS.pdf)
- **Gynecology.** For the identical heavy vaginal bleeding finding, use the more urgent published color, orange, in both the bleeding and non-pregnant gynecology pickers. The separate pregnancy-specific finding remains red. Record the original non-pregnant yellow in the source metadata. For timed green criteria, this configuration interprets the published 07–16 window as 07:00 inclusive through 16:00 exclusive, local to the measurement. [Definition and recorded handling](../../defines/decision_support/west-a-2025.sv.json)
- **Other source differences.** For wording and overview-only findings, use the supplied category inventory, including the inclusive potassium threshold of 6.0 with ECG changes. For COPD, use the RCP room-air band for the range omitted from the compact SkaS table. [Definition and recorded handling](../../defines/decision_support/west-a-2025.sv.json) · [RCP NEWS2 chart](https://www.rcp.ac.uk/media/eczf5mvm/news2-chart-3_news-observation-chart_2022_0_0.pdf)
