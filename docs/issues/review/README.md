# Review issue hierarchy

Status: Historical publication record; local bodies reflect current requirements.

Parent: [#642: Review workflows and basic analytics](https://github.com/open-triage/open-triage-epcr/issues/642).  
Repository: [open-triage/open-triage-epcr](https://github.com/open-triage/open-triage-epcr).  
Implementation branch: feature/review.  
Source: [Review PRD](../../prds/review.md).

The [Unified analytics workspace PRD](../../prds/unified-analytics-workspace.md)
defines the current Analytics interface. This hierarchy records the original
backend and workflow delivery dependencies; it is not a separate interface plan.

All 25 children are attached using actual GitHub sub-issue relationships. The parent contains the full PRD and a linked child/dependency index. Each child includes its approved scope, acceptance criteria, AFK classification, covered user stories, and published prerequisite links.

All 68 PRD stories are covered. Tests belong to the relevant delivery slice. The approved product choices leave no separate HITL checkpoint in this hierarchy.

## Published slices

1. **[#643: Enter Review and browse reports within the user's scope](https://github.com/open-triage/open-triage-epcr/issues/643)** — AFK. Blocked by: none — ready. User stories: US-1, US-2, US-3, US-4, US-5, US-8, US-9, US-10, US-11, US-12, US-13, US-66. [Local body](001-enter-review.md).

2. **[#644: Inspect signed reports with consistent identifying-data restrictions](https://github.com/open-triage/open-triage-epcr/issues/644)** — AFK. Blocked by: [#643](https://github.com/open-triage/open-triage-epcr/issues/643). User stories: US-2, US-4, US-5, US-8, US-9, US-17, US-32, US-57. [Local body](002-inspect-report.md).

3. **[#645: Author and publish review priorities in the validation rule editor](https://github.com/open-triage/open-triage-epcr/issues/645)** — AFK. Blocked by: none — ready. User stories: US-14, US-15, US-19. [Local body](003-author-priorities.md).

4. **[#646: Create one durable review item per matching signed report and criterion](https://github.com/open-triage/open-triage-epcr/issues/646)** — AFK. Blocked by: [#643](https://github.com/open-triage/open-triage-epcr/issues/643), [#644](https://github.com/open-triage/open-triage-epcr/issues/644), [#645](https://github.com/open-triage/open-triage-epcr/issues/645). User stories: US-16, US-17, US-18, US-19, US-21, US-22, US-34, US-68. [Local body](004-sign-to-queue.md).

5. **[#647: Claim eligible unassigned review items](https://github.com/open-triage/open-triage-epcr/issues/647)** — AFK. Blocked by: [#646](https://github.com/open-triage/open-triage-epcr/issues/646). User stories: US-24, US-28, US-30. [Local body](005-claim-item.md).

6. **[#648: Manage assignments and automatic routing by criterion](https://github.com/open-triage/open-triage-epcr/issues/648)** — AFK. Blocked by: [#647](https://github.com/open-triage/open-triage-epcr/issues/647). User stories: US-6, US-7, US-23, US-25, US-68. [Local body](006-route-assignments.md).

7. **[#649: Complete assigned reviews with agency-configured outcomes](https://github.com/open-triage/open-triage-epcr/issues/649)** — AFK. Blocked by: [#647](https://github.com/open-triage/open-triage-epcr/issues/647). User stories: US-27, US-28, US-29, US-30, US-32. [Local body](007-complete-reviews.md).

8. **[#650: Exchange scoped review comments and request clinician responses](https://github.com/open-triage/open-triage-epcr/issues/650)** — AFK. Blocked by: [#649](https://github.com/open-triage/open-triage-epcr/issues/649). User stories: US-9, US-28, US-31, US-32. [Local body](008-review-discussion.md).

9. **[#651: Require independent review for selected criteria](https://github.com/open-triage/open-triage-epcr/issues/651)** — AFK. Blocked by: [#648](https://github.com/open-triage/open-triage-epcr/issues/648), [#649](https://github.com/open-triage/open-triage-epcr/issues/649). User stories: US-23, US-30, US-33. [Local body](009-independent-review.md).

10. **[#652: Bulk claim, assign, and reassign selected review items](https://github.com/open-triage/open-triage-epcr/issues/652)** — AFK. Blocked by: [#648](https://github.com/open-triage/open-triage-epcr/issues/648), [#651](https://github.com/open-triage/open-triage-epcr/issues/651). User stories: US-6, US-24, US-25, US-26, US-27, US-33. [Local body](010-bulk-assignments.md).

11. **[#653: Return amended reports for re-review and apply agency clearance policy](https://github.com/open-triage/open-triage-epcr/issues/653)** — AFK. Blocked by: [#649](https://github.com/open-triage/open-triage-epcr/issues/649), [#651](https://github.com/open-triage/open-triage-epcr/issues/651). User stories: US-21, US-35, US-36, US-37, US-57, US-68. [Local body](011-amendment-rereview.md).

12. **[#654: Follow up overdue unsigned drafts and resolve them on signing](https://github.com/open-triage/open-triage-epcr/issues/654)** — AFK. Blocked by: [#648](https://github.com/open-triage/open-triage-epcr/issues/648), [#649](https://github.com/open-triage/open-triage-epcr/issues/649). User stories: US-38, US-39, US-40, US-41, US-42, US-47. [Local body](012-overdue-drafts.md).

13. **[#655: Record exceptional closure of an unsigned overdue item](https://github.com/open-triage/open-triage-epcr/issues/655)** — AFK. Blocked by: [#654](https://github.com/open-triage/open-triage-epcr/issues/654). User stories: US-43, US-47. [Local body](013-overdue-exceptions.md).

14. **[#656: Preview and run retrospective review over a selected period](https://github.com/open-triage/open-triage-epcr/issues/656)** — AFK. Blocked by: [#648](https://github.com/open-triage/open-triage-epcr/issues/648), [#649](https://github.com/open-triage/open-triage-epcr/issues/649). User stories: US-19, US-20, US-21, US-22, US-68. [Local body](014-retrospective-review.md).

15. **[#657: Show in-app attention indicators for review work](https://github.com/open-triage/open-triage-epcr/issues/657)** — AFK. Blocked by: [#650](https://github.com/open-triage/open-triage-epcr/issues/650), [#653](https://github.com/open-triage/open-triage-epcr/issues/653), [#654](https://github.com/open-triage/open-triage-epcr/issues/654). User stories: US-34, US-44, US-68. [Local body](015-in-app-attention.md).

16. **[#658: View scoped report-volume analytics with visible freshness](https://github.com/open-triage/open-triage-epcr/issues/658)** — AFK. Blocked by: [#643](https://github.com/open-triage/open-triage-epcr/issues/643). User stories: US-3, US-4, US-5, US-8, US-9, US-45, US-48, US-49, US-50, US-58, US-66, US-67. [Local body](016-call-volume-bi.md).

17. **[#659: Build simple analyses of single-valued structured fields](https://github.com/open-triage/open-triage-epcr/issues/659)** — AFK. Blocked by: [#658](https://github.com/open-triage/open-triage-epcr/issues/658). User stories: US-9, US-45, US-48, US-49, US-53. [Local body](017-basic-field-analysis.md).

18. **[#660: Analyze repeated fields using explicit per-report reductions](https://github.com/open-triage/open-triage-epcr/issues/660)** — AFK. Blocked by: [#659](https://github.com/open-triage/open-triage-epcr/issues/659). User stories: US-48, US-50, US-51, US-52, US-53. [Local body](018-repeated-field-analysis.md).

19. **[#661: Analyze standalone custom values from the long analytics table](https://github.com/open-triage/open-triage-epcr/issues/661)** — AFK. Blocked by: [#659](https://github.com/open-triage/open-triage-epcr/issues/659). User stories: US-54, US-55, US-56, US-57, US-67. [Local body](019-custom-scalar-analytics.md).

20. **[#662: Analyze repeated and grouped custom values without losing their relationships](https://github.com/open-triage/open-triage-epcr/issues/662)** — AFK. Blocked by: [#660](https://github.com/open-triage/open-triage-epcr/issues/660), [#661](https://github.com/open-triage/open-triage-epcr/issues/661). User stories: US-51, US-52, US-54, US-55, US-56, US-57. [Local body](020-custom-grouped-analytics.md).

21. **[#663: Analyze response, scene, and transport durations](https://github.com/open-triage/open-triage-epcr/issues/663)** — AFK. Blocked by: [#659](https://github.com/open-triage/open-triage-epcr/issues/659). User stories: US-48, US-49, US-53, US-57, US-58. [Local body](021-operational-time-analysis.md).

22. **[#664: Analyze review workload and filter clinical BI by review findings](https://github.com/open-triage/open-triage-epcr/issues/664)** — AFK. Blocked by: [#653](https://github.com/open-triage/open-triage-epcr/issues/653), [#655](https://github.com/open-triage/open-triage-epcr/issues/655), [#656](https://github.com/open-triage/open-triage-epcr/issues/656), [#659](https://github.com/open-triage/open-triage-epcr/issues/659). User stories: US-43, US-45, US-46, US-47, US-49, US-53. [Local body](022-review-workload-analysis.md).

23. **[#665: Save personal analyses and publish permission-scoped shared views](https://github.com/open-triage/open-triage-epcr/issues/665)** — AFK. Blocked by: [#659](https://github.com/open-triage/open-triage-epcr/issues/659). User stories: US-59, US-60, US-61. [Local body](023-saved-analyses.md).

24. **[#666: Export each visualization's displayed aggregate values as CSV](https://github.com/open-triage/open-triage-epcr/issues/666)** — AFK. Blocked by: [#659](https://github.com/open-triage/open-triage-epcr/issues/659). User stories: US-62, US-64, US-65. [Local body](024-aggregate-csv.md).

25. **[#667: Export the exact report records underlying any supported visualization](https://github.com/open-triage/open-triage-epcr/issues/667)** — AFK. Blocked by: [#660](https://github.com/open-triage/open-triage-epcr/issues/660), [#662](https://github.com/open-triage/open-triage-epcr/issues/662), [#663](https://github.com/open-triage/open-triage-epcr/issues/663), [#664](https://github.com/open-triage/open-triage-epcr/issues/664), [#666](https://github.com/open-triage/open-triage-epcr/issues/666). User stories: US-9, US-50, US-51, US-52, US-54, US-56, US-57, US-63, US-64, US-65, US-67. [Local body](025-underlying-record-csv.md).

## Dependency order

- Start independently with **#643** (scoped Review entry) and **#645** (priority authoring).
- Review progresses through report inspection and sign-to-queue, then branches into routing, completion, independent review, discussion, amendments, overdue follow-up, retrospective review, and notifications.
- BI starts with **#658** after **#643**; **#659** enables the independent repeated-field, custom-scalar, operational-time, stored-definition API, and aggregate-export work.
- **#662** combines repeated-field behavior with custom long-table storage. **#664** joins review workflows and BI. **#667** completes underlying-record exports for the supported measures and populations.
- The blockers listed above and in manifest.json are authoritative; each references an earlier slice and the graph has no cycles.

## Recorded publication verification

- The live parent body contains the complete source PRD.
- The live parent has exactly the 25 approved child issues attached as real sub-issues.
- At publication, each child matched its local body, was classified AFK, linked back to the parent, and referenced published GitHub issues for blockers. Local documentation has since been updated for unified Analytics.
- No publication or relationship failures remain.
- Stable review markers and recorded GitHub IDs/URLs in manifest.json support duplicate-safe inspection and resumption.
