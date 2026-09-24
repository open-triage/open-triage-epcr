# Sweden / EU clinical adoption and compliance

Status: planning baseline; not a conformity declaration or authorization for clinical use.
Reviewed: 2026-09-24.
Repository baseline: `995106fa5e4276613baa85b976fe45f1490a7aea`.
Accountable healthcare institution, organization number, document owner and approvers: **to be assigned**.

OpenTriage has technical controls that can support compliance, but compliance and
clinical readiness have **not been established**. This assessment is based on
selected source files, tests and repository documentation, not an exhaustive
security audit, clinical evaluation or inspection of a deployed environment.
Tests were inspected but were not executed for this documentation update.

## Documents

- [Legislation and regulatory guidance](legislation.md): applicability, legal sources and future obligations.
- [Current platform assessment](current-state.md): evidence, limitations and implementation gaps.
- [Clinical adoption checklist](clinical-adoption.md): proposed owners, required evidence and release gates.

Existing repository documents labelled “approved” record project decisions.
They do not establish approval by a Swedish region's legal, clinical, information
security or archive authorities. This baseline does not supersede those documents
or change application behavior; it identifies matters that need reconciliation.

## Proposed deployment and regulatory pathway

The deployment model assessed here is a Swedish region manufacturing, validating,
operating and maintaining its own controlled OpenTriage release for use by its
ambulance service. Potential scope includes patient-specific, rule-based decision support
such as NEWS/NEWS2, WEST and SATS. Exact algorithms, versions, populations and
clinical actions remain to be specified. Their implementation and validation are
not established in the current baseline.

The proposed route is an **in-house medical device (egentillverkad medicinteknisk
produkt) under MDR Article 5(5)**, with information submitted to IVO about the
institution's manufacturing and use. This is a conditional exemption, not a
general self-certification route. IVO uses the information for risk-based
supervision; notification is not product approval.
[IVO: medical devices](https://www.ivo.se/vard-omsorgsgivare/anmal-handelse-lamna-underrattelse/medicintekniska-produkter/)

Qualification follows intended purpose and actual functionality. Record storage
and documentation validation do not automatically make the whole platform a
medical device. Patient-specific diagnostic/therapeutic decision support is
likely to qualify. Define the medical-device boundary, supporting components and
interfaces before claiming this route. Assess Rule 11: class IIa is a possible
starting point, with IIb or III depending on the consequences of the decisions.
Algorithmic simplicity does not determine risk class. Classification is useful for the
risk analysis and any alternative CE route; it does not by itself require a
notified body under a valid Article 5(5) exemption.
[MDCG 2019-11 rev. 1](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en?filename=md_mdcg_2019_11_guidance_qualification_classification_software_en.pdf)

### Conditions to establish

| MDR provision | Required position |
| --- | --- |
| Article 5(5), opening text | Meet applicable Annex I general safety and performance requirements. |
| 5(5)(a) | No transfer to another legal entity. |
| 5(5)(b) | Appropriate QMS covering manufacture and use. |
| 5(5)(c) | Document why equivalent market devices cannot adequately meet the target patient group's specific needs. |
| 5(5)(d) | Provide the competent authority with requested information and justification. |
| 5(5)(e) | Publish the required institution/device identification and Annex I compliance declaration, including reasoned exceptions. |
| 5(5)(f)–(g) | Maintain design, manufacturing, intended-purpose and performance documentation; manufacture accordingly. |
| 5(5)(h) | Review clinical-use experience and take corrective action. |
| Final limitation | Manufacture must not be on an industrial scale. |

Source: [MDR, Article 5(5)](https://eur-lex.europa.eu/eli/reg/2017/745/oj/eng).
The exemption removes most other MDR obligations only while its conditions hold;
it does not remove data protection, recordkeeping or healthcare-provider duties.

### Organizational boundary

Ambulance-only use defines the operational scope but does not establish eligibility.
Confirm the actual legal entity responsible for manufacturing and use. A
contracted ambulance operator may be a separate legal entity even when working
for the region. A vehicle's physical location outside a hospital does not itself
prevent in-house use. Document users, contractors, remote support and hosting.
[MDCG 2023-1, sections 3.2 and 3.4](https://health.ec.europa.eu/system/files/2023-01/mdcg_2023-1_en.pdf)

### Justification of unmet patient needs

The Article 5(5)(c) justification has not yet been established.

The assessment must identify the target patient group's specific needs, define
the required performance and document whether equivalent devices available on
the market can meet those needs. Technical and security requirements must be
supported by relevant evidence, with alternative means of meeting them included
in the comparison. The assessment requires review throughout the device lifecycle.
[MDCG 2023-1, section 3.6](https://health.ec.europa.eu/system/files/2023-01/mdcg_2023-1_en.pdf)

The region's regulatory/legal lead and clinical owner are responsible for
completing and approving this assessment before clinical release under the
in-house pathway. If the justification cannot be substantiated, the scope and
regulatory route require reassessment, including consideration of a CE-marked
solution or conventional conformity assessment.

### Open-source collaboration and other regions

The repository is [AGPL-3.0-only](../../LICENSE). The proposed collaboration model
is that another region may reuse source and documentation, while taking its own
responsibility for its release, validation, operation and regulatory basis.

Whether a particular distribution is source collaboration, supply of a finished
device, or a shared clinical service needs a separate assessment. A fork and an
IVO notification alone do not establish eligibility. No region inherits another
region's unmet-needs justification or release approval. Shared hosting or
cross-entity use must not be assumed to fit the exemption. Establish employer IP
authority, contribution review, release provenance, licensing permissions and
security-disclosure arrangements before formalizing this model.

## Release position

Continue development and evaluation with synthetic data. This document does not
authorize real patient data or patient-affecting use, including a “pilot”.
Any such evaluation needs its own lawful basis and applicable clinical/research
authorization. The [adoption checklist](clinical-adoption.md) must be resolved
for the exact deployed release and scope before routine clinical adoption.
