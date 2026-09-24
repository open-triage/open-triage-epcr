# Clinical adoption checklist

Status: all gates open until evidence is reviewed for a named region and release.
See [scope/pathway](README.md), [legislation](legislation.md) and
[current-state findings](current-state.md).

The owners below are proposed roles, not appointed people. For every item, record
the accountable person, evidence location/version, review date, decision and next
review date in the region's controlled system. “Not applicable” requires a
documented scope-based rationale. A future legal obligation needs a tracked plan;
it does not necessarily block a release before its application date.

## Gate 1 — Establish authority and lawful scope

- [ ] **G01 — Region management / regulatory lead:** identify the manufacturing healthcare institution, organization number, authorized sponsor and accountable clinical owner. Map ambulance staff, contractors, hosting and support to the legal-entity boundary. Confirm that resources and authority exist to maintain a device, not merely develop software.
- [ ] **G02 — Regulatory lead / clinical owner:** approve intended purpose, target patients, clinical decisions, users, environments, exclusions, device/module boundary and Rule 11 analysis. Record separate MDR/NMI decisions for non-device functions. Specify whether the initial release actually includes decision support.
- [ ] **G03 — Regulatory/legal lead / clinical owner:** complete and approve the Article 5(5)(c) unmet-needs justification, supported by a documented comparison of patient needs, required performance and available equivalent devices. Establish periodic review and an alternative route if the exemption is unavailable.
- [ ] **G04 — Legal / IP / regulatory leads:** approve employment/IP authority, third-party algorithm and terminology rights, AGPL obligations, contributions, distribution and other-region reuse arrangements. Review any shared service or transfer separately.
- [ ] **G05 — Controller / DPO / legal:** complete the DPIA and processing register; approve lawful bases, notices, rights processes, processors/subprocessors, support access and transfer assessments. Keep real patient data out of public issues, repositories, demos and unapproved AI/support services.
- [ ] **G06 — Records manager / legal / clinical owner:** approve the system's status within the official patient record, record ownership, Swedish content/language requirements, corrections, patient access and disclosure procedures, and regional preservation/disposal decisions.

## Gate 2 — Operate the QMS and assemble the device file

- [ ] **G07 — Quality lead:** establish an operational QMS before clinical release, covering design/change control, document approval, competence, supplier/component control, configuration, incident management, corrective/preventive action (CAPA), internal review and management review. Integrate it with the provider's quality system and retain evidence that the processes are operating effectively.
- [ ] **G08 — Engineering / quality:** identify the controlled release: source commit, build artifacts/digests, dependencies and software bill of materials, database migrations, browsers/devices, deployment settings, forms, terminology and rule versions. Establish traceability from requirements and hazards to implementation and tests.
- [ ] **G09 — Clinical safety / security:** produce a combined safety/security risk file. Include incorrect identity, stale/missing observations, wrong units, score errors, unauthorized changes, outages, offline expiry/loss, time skew, failed handovers and unsafe configuration. Document controls, verification and authorized residual-risk decisions.
- [ ] **G10 — Regulatory / quality:** complete an Annex I applicability-and-evidence matrix, intended-purpose specification, architecture/data flows, manufacturing/build procedure, performance evidence and instructions for use. Justify exclusions; do not use an “exception” to accept an unsafe device. Adopt Annex II-style organization where useful without claiming every ordinary CE-route requirement automatically applies.
- [ ] **G11 — Clinical owner / validation lead:** establish clinical evaluation and performance evidence proportionate to the intended use. For each selected NEWS/NEWS2, WEST or SATS version, validate the exact specification, population, limits, units, thresholds, missing/stale inputs, score-to-action mapping, overrides and displayed explanations. Include independent reference cases and boundary tests; assess the complete workflow, not just arithmetic.
- [ ] **G12 — Validation / clinical owner:** execute and retain unit, integration, database-permission, browser, regression, security, load and failure-recovery results against the release candidate. Conduct representative ambulance usability validation and clinical acceptance. Unit tests alone do not establish safe clinical performance.
- [ ] **G13 — Quality / clinical owner:** establish operational incident detection, triage, patient-impact assessment, corrective releases and rollback/withdrawal. Integrate device vigilance and lex Maria assessment with the region's reporting system; internal feedback must escalate to accountable staff.

Clinical evaluation may require additional evidence collection. Before a real-world
study or patient-affecting pilot, determine whether medical-device clinical
investigation rules, ethics review or other permissions apply. Do not treat a
pilot as an exemption from applicable obligations.

Documentation requires review by designated approvers against supporting evidence.
Clinical validation, training, regulatory decisions and QMS activities require
their own records; documentation and software build results do not substitute
for those activities.

## Gate 3 — Close platform and deployment gaps

- [ ] **G14 — Identity/security lead:** implement and validate the required MFA chain for patient-data access. Establish identity proofing, provisioning/deprovisioning, least privilege, periodic reviews and recovery. Test protected access end to end, including APIs and offline recovery; document any infrastructure-supplied controls. Resolve the stale Supabase/session description.
- [ ] **G15 — Security / privacy / clinical operations:** establish comprehensive patient-access logging, including read/list/export and relevant offline access, with required attribution and protected retention. Provide log review, suspicious-access investigation and patient-facing access information. Demonstrate that diagnostic minimization and patient-access audit requirements both work.
- [ ] **G16 — Clinical owner / privacy:** validate care relationships, team and shift handover, protected identities, unknown/temporary patient identities, patient matching, access restrictions and applicable blocking/emergency-access workflows. Do not enable cross-provider sharing until its additional conditions are met.
- [ ] **G17 — Records manager / engineering:** reconcile retention clocks and settings with approved preservation rules. Test late amendments, holds, archive search/rendering/export, audit preservation and lawful deletion. Prevent clinical-data loss through synthetic expiry, unsigned-reset tooling or incompatible browser migrations.
- [ ] **G18 — Infrastructure / security:** commission the production environment: approved hosting and suppliers, network boundaries, TLS, storage/backups encryption, secret custody/rotation, workload privileges, endpoint protection, managed devices, patching, monitoring and recovery-key escrow. Verify no fixture account or development secret grants clinical access.
- [ ] **G19 — Security / quality:** perform independent threat review and penetration testing; resolve findings and establish vulnerability intake, patch deadlines and component monitoring. Include supply-chain risks and emerging attack methods relevant to the deployment. Retain evidence of the effectiveness of security controls.
- [ ] **G20 — Operations / clinical owner:** prove backups/restores, ransomware recovery, downtime documentation, emergency handover and reconciliation after reconnection. Set and meet clinically justified recovery objectives. Test lost devices, browser eviction, expired keys, outage beyond a shift and unsynchronized work; agree acceptable residual offline risks.
- [ ] **G21 — Integration / clinical owner:** validate Swedish configuration and each live dispatch/EHR interface, identity, terminology, units and timestamps. Approve message conflict/duplicate handling, acknowledgement and follow-up of failed deliveries. Determine whether applicable national services require SITHS/HSA/Inera agreements or other controls.
- [ ] **G22 — Accessibility / clinical validation:** complete the applicable accessibility assessment and representative human-factors testing. Resolve safety-critical usability issues; document any lawful exceptions and required accessibility statement/feedback route.
- [ ] **G23 — Security / regulatory / privacy:** align cybersecurity, personal-data breach and patient-safety reporting, each with its own thresholds, recipients and deadlines. Confirm NIS2/cybersäkerhetslagen scope and obligations. Maintain EHDS, CRA and AI Act applicability decisions and a dated change-watch plan.

## Gate 4 — Authorize a specific clinical release

- [ ] **G24 — Regulatory lead:** submit the required information to IVO using the current process and required lead time; retain submission evidence and arrangements for reporting changes. Do not represent the submission or acknowledgement as approval of the product. Publish the Article 5(5) declaration when its claims are supported.
- [ ] **G25 — Quality / records manager:** approve technical-document and evidence retention, including retired releases and their configurations, under the current Swedish requirements. Keep this separate from patient records, access logs, diagnostic logs and backups.
- [ ] **G26 — Clinical operations / management:** train and assess intended users and support staff. Approve Swedish instructions, limitations, downtime procedures, escalation, maintenance responsibilities and funded ongoing support.
- [ ] **G27 — Authorized region leadership:** sign the release decision identifying the device/release, configuration, approved users/sites, closed gates, residual risks and operating conditions. Retain clinical, quality, security and legal review outcomes and DPO advice. No unchecked mandatory gate may be waived merely to start a pilot.

After adoption, repeat change-impact assessment and proportionate validation for
software, infrastructure, rules, forms and terminology changes. Maintain clinical
experience review, incidents/CAPA, training, access reviews, recovery exercises,
market-equivalence review and legal monitoring. Another region or a materially
different deployment requires its own assessment and release decision.
