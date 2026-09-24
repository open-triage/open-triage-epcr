# Legislation and regulatory guidance

Reviewed: 2026-09-24. See the [scope and status](README.md).

This is an applicability register, not a complete legal opinion. Laws and binding
regulations are distinguished from non-binding guidance, standards and local
requirements. Use consolidated texts and recheck amendments at each release.
Some authority pages expose only search-indexed text without JavaScript; the
region should retain authoritative copies in its controlled legal register.

## Core requirements

| ID | Framework and primary source | Relevance and required assessment |
| --- | --- | --- |
| L01 | [GDPR, Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng); [Swedish supplementary Act (2018:218)](https://data.riksdagen.se/dokument/sfs-2018-218.html) | Applies to identifiable health information, including pseudonymized data. Establish controller/processor roles, Article 6 basis and Article 9 condition, purpose limitation, minimization, transparency, rights handling, processor agreements, security, breach handling and international-transfer safeguards. Relevant GDPR articles include 5, 6, 9, 12–22, 25, 28, 30, 32–36 and 44–49. |
| L02 | [Patientdatalagen (2008:355)](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/patientdatalag-2008355_sfs-2008-355/) | Patient records, accountability for entries/corrections, need-based access, patient rights and retention. Chapter 3 section 17 sets a minimum of ten years after the last entry in the record document; public records also engage archive rules. A reporting-date cutoff is not automatically the statutory retention clock. |
| L03 | [HSLF-FS 2016:40, consolidated](https://www.socialstyrelsen.se/kunskapsstod-och-regler/regler-och-riktlinjer/foreskrifter-och-allmanna-rad/konsoliderade-foreskrifter/201640-om-journalforing-och-behandling-av-personuppgifter-i-halso--och-sjukvarden/) | Recordkeeping and information-security requirements, including access governance, availability and operational controls. The reviewed consolidation includes HSLF-FS 2025:57, effective 1 February 2026. Chapter 3 section 15 requires MFA for the specified electronic access/disclosure. Chapter 4 sections 9–9b require patient-access logging, user/patient identity, action, time and care-unit/process context, recurring documented checks, and at least five years' log retention. |
| L04 | [MDR, Regulation (EU) 2017/745](https://eur-lex.europa.eu/eli/reg/2017/745/oj/eng) | Conditional medical-device applicability. Article 5(5) is the proposed in-house route; Annex I remains relevant. See the [pathway](README.md#proposed-deployment-and-regulatory-pathway). |
| L05 | [Act (2021:600)](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-2021600-med-kompletterande-bestammelser_sfs-2021-600/), Ordinance (2021:631), and [HSLF-FS 2021:32, as amended](https://www.lakemedelsverket.se/sv/lagar-och-regler/foreskrifter/2021-32) | Swedish supplementary medical-device rules and authority responsibilities. Confirm current notification, change-reporting and technical-document retention requirements with the region's regulatory lead; use IVO's current process. Medical-device documentation retention is distinct from patient-record retention. |
| L06 | [Hälso- och sjukvårdslagen (2017:30)](https://data.riksdagen.se/dokument/sfs-2017-30.html), [Patientsäkerhetslagen (2010:659)](https://data.riksdagen.se/dokument/sfs-2010-659.html), [Patientlagen (2014:821)](https://data.riksdagen.se/dokument/sfs-2014-821.html) | Safe, good-quality care, provider accountability, patient information/participation and investigation of safety events. Software deployment must support the actual care workflow. |
| L07 | SOSFS 2011:9 — [quality-management requirements](https://www.socialstyrelsen.se/kunskapsstod-och-regler/regler-och-riktlinjer/Ledningssystem/); HSLF-FS 2021:52 — medical-device use, described by [IVO](https://www.ivo.se/vard-omsorgsgivare/anmal-handelse-lamna-underrattelse/medicintekniska-produkter/) | Integrate device manufacture/use into the provider's quality system, competence management and incident process. Device incidents and lex Maria assessments are related but distinct reporting duties; see [IVO's reporting explanation](https://www.ivo.se/vard-omsorgsgivare/anmal-lex-maria-lex-sarah/lex-maria/). |
| L08 | Tryckfrihetsförordningen, chapter 2; [Offentlighets- och sekretesslagen (2009:400)](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/offentlighets-och-sekretesslag-2009400_sfs-2009-400/); [Arkivlagen (1990:782)](https://data.riksdagen.se/dokument/sfs-1990-782.html) | Public-region records require lawful disclosure/secrecy assessment and preservation or authorized disposal. Apply the region's archive regulations and information-management plan. An application administrator's approval is not itself legal authority to destroy public records. |
| L09 | [Cybersäkerhetslagen (2025:1506)](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/cybersakerhetslag-20251506_sfs-2025-1506/) and [Cybersäkerhetsförordningen (2025:1507)](https://rkrattsbaser.gov.se/sfst?bet=2025%3A1507), implementing NIS2 | In force from 15 January 2026. Assess the region/provider's scope, registration, governance, risk measures, supplier security, continuity and incident reporting. These are organization-level obligations; a secure application alone does not discharge them. Confirm current implementing rules and reporting channels. |

For the proposed regional deployment, treat a data protection impact assessment
(DPIA) as a pre-adoption requirement. It must cover the complete processing chain,
including offline devices, logs, support, integrations and analytics. Consult the
DPO and assess prior consultation with IMY if high residual risk remains.
[IMY: when a DPIA is needed](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/konsekvensbedomning/nar-ska-en-konsekvensbedomning-genomforas/)

Clinical processing normally needs a healthcare/public-task or legal-obligation
analysis rather than blanket GDPR consent. Consent to care, record-sharing
conditions and a GDPR lawful basis are different questions.
[IMY: legal bases for healthcare providers](https://www.imy.se/verksamhet/dataskydd/dataskydd-pa-olika-omraden/vard/grundlaggande-principer-och-rattslig-grund-for-vardgivare/)

## Conditional and future requirements

| ID | Framework | Applicability decision |
| --- | --- | --- |
| L10 | [HSLF-FS 2022:42 — national medical information systems (NMI)](https://www.lakemedelsverket.se/sv/medicinteknik/tillverka/nationella-medicinska-informationssystem) | Assess the recordkeeping platform and any non-MDR modules separately. NMI has its own requirements and registration route, not MDR CE marking. The local-development exclusion is narrower than the MDR legal-entity boundary: an ambulance-wide deployment does not automatically qualify. Document the bounded operation and intended distribution. [Läkemedelsverket's definitions](https://www.lakemedelsverket.se/sv/medicinteknik/tillverka/nationella-medicinska-informationssystem/termer-och-begrepp-for-nmi). |
| L11 | [Act (2022:913) on sammanhållen vård- och omsorgsdokumentation](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-2022913-om-sammanhallen-vard-och_sfs-2022-913/) | Applies when the relevant cross-provider access/sharing arrangement is introduced. Establish patient information, blocking, access conditions and emergency-access handling. A database organization identifier does not implement these requirements. Ordinary handover/disclosure also needs a lawful basis, but is not automatically this specific sharing arrangement. |
| L12 | [EHDS, Regulation (EU) 2025/327](https://eur-lex.europa.eu/eli/reg/2025/327/oj/eng) | Assess whether the platform is an EHR system in scope, its data categories, harmonized interoperability/logging components and secondary-use responsibilities. Article 26(2) covers relevant in-house systems; Article 105 phases Chapter III for those systems to 26 March 2031. Other provisions have different dates, including 2027/2029 phases. MDR in-house status is not an EHDS exemption. Track implementing specifications. [Commission timeline](https://health.ec.europa.eu/ehealth-digital-health-and-care/european-health-data-space-regulation-ehds_en). |
| L13 | [Cyber Resilience Act, Regulation (EU) 2024/2847](https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act) | Assess by component, distribution model and applicable exclusions. Products covered by MDR/IVDR have a sectoral exclusion; other software or distributed components need separate analysis. Neither a public repository nor an open-source licence settles applicability. For in-scope products, reporting provisions apply from 11 September 2026 and main obligations from 11 December 2027. |
| L14 | [AI Act, Regulation (EU) 2024/1689](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai) | Fixed score arithmetic is not automatically AI; evaluate the actual system against the definition. Reassess before adding predictive models, generative documentation or inference-based decision support, including provider/deployer duties and the then-applicable timetable. AI-assisted software development does not itself make the delivered application an AI system. [Commission definition guidance](https://digital-strategy.ec.europa.eu/en/library/commission-publishes-guidelines-ai-system-definition-facilitate-first-ai-acts-rules-application). |
| L15 | Act (2018:1937) on accessibility to digital public services; [Digg's DOS guidance](https://www.digg.se/webbriktlinjer/lagar-och-krav/dos-lagen-och-diggs-foreskrifter) | Assess the regional web application's obligations, including relevant EN 301 549 requirements, statement and feedback process. Internal use is not a blanket exclusion: [new intranets/extranets can be covered](https://www.digg.se/kunskap-och-stod/regler-och-rekommendationer/regler-och-rekommendationer/intranat-och-extranat-slutna-grupper-ska-vara-tillgangliga). |

Also screen deployment-specific procurement, employment/IP and security-protection
requirements. Research, quality-register reporting, prescribing, patient-facing
access and new national integrations each need their own scope assessment before
activation. Hosting in the EU/EEA does not alone establish GDPR compliance: remote
support, subprocessors and onward transfers still matter.

## Guidance and standards: evidence frameworks, not blanket certifications

- [MDCG 2023-1](https://health.ec.europa.eu/system/files/2023-01/mdcg_2023-1_en.pdf): in-house exemption interpretation.
- [MDCG 2019-11 rev. 1](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en?filename=md_mdcg_2019_11_guidance_qualification_classification_software_en.pdf): software qualification, classification and module boundaries.
- [MDCG 2019-16 rev. 1](https://health.ec.europa.eu/system/files/2022-01/md_cybersecurity_en.pdf): cybersecurity lifecycle, testing and safety/security risk management.
- [ISO 13485](https://www.iso.org/iso-13485-medical-devices.html): medical-device QMS; [ISO 14971](https://www.iso.org/standard/72704.html): device risk management.
- IEC 62304, IEC 62366-1 and IEC 81001-5-1 are candidate frameworks for software lifecycle, usability and health-software security. See the [IEC medical-software standards overview](https://assets.iec.ch/public/tc62/62-502A-INF.pdf?2024112020=).

Select applicable editions and European adoptions through the QMS; verify any
claimed harmonized status. ISO certification is not assumed to be a prerequisite
for Article 5(5), and none is claimed here. Standards do not replace legal duties.
Regional requirements and Inera/SITHS/HSA integration conditions may add controls;
those services are not universally mandated merely by choosing this pathway.
NEMSIS catalog compatibility is not Swedish clinical or legal conformity.
