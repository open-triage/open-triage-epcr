# CE marking of ambulance medical record systems

Research date: **28 September 2026**.

## Summary

Public manufacturer statements and EUDAMED records identify several ambulance
software platforms with CE-marked medical-device functionality. The evidence does
not establish that every platform's complete electronic patient record (ePR/ePCR)
application is covered.

The strongest registry findings are:

- **Ortivus:** an MDR certificate and its product-list annex confirm **MobiMed
  Monitor** and **MobiMed Clinical Review Solution**, both Class IIb. The annex
  does **not** name **MobiMed ePR**. Standalone ePR coverage remains unverified.
- **CGI:** **Merlot Medi Physio v3.1** has an on-market MDR Class IIb device entry;
  a separate MDR certificate explicitly names Merlot Medi Physio.
- **corpuls:** **corpuls.mission LIVE** has an on-market MDR Class IIb software
  entry. This does not establish coverage of **corpuls.mission REPORT**.
- **Aweria:** the manufacturer publishes a Class IIa CE/MDR claim, but it was not
  independently verified in the EUDAMED searches completed.
- **LIFENET:** historical CE documentation was found, but current LIFENET-specific
  certification was not verified.

This is an evidence-based research summary, **not an exhaustive register of all
CE-marked ambulance record systems**. An unmatched search is not evidence that a
product is uncertified.

## Findings by product

| Product / supplier | Evidence found | Scope and limitations |
| --- | --- | --- |
| **MobiMed — Ortivus MobiMed AB** | EUDAMED MDR QMS certificate **28620161156**, revision **00**, status **Issued**; notified body **2862**, Intertek Medical Notified Body AB; validity **2023-11-28 to 2028-11-27**. | Attached product list names **MobiMed Monitor** and **MobiMed Clinical Review Solution**, Class IIb. It does not name MobiMed ePR. [Certificate record](https://ec.europa.eu/tools/eudamed/#/screen/certificates/3d12026c-2b53-444b-bd02-a537d994737f), [certificate and annex PDF](https://ec.europa.eu/tools/eudamed/api/documents/59c1b651-96ff-4cce-83fd-aee9daf34bed). |
| **Merlot Medi Physio — CGI Suomi Oy** | Current device **v3.1**: MDR, Class IIb, **on the market**. MDR QMS certificate **CR-03-1156-859-24**, revision **02**, status **Supplemented**, issued **2025-10-06**, expiry **2029-12-09**; notified body **0537**, Eurofins Electric & Electronics Finland Oy. | Certificate scope explicitly names Merlot Medi Physio. This is component-level evidence, not certification of every Merlot Medi function. [Current device record](https://ec.europa.eu/tools/eudamed/#/screen/search-device/e7e8617f-72d1-402b-a9cf-0ef2eac65900), [certificate record](https://ec.europa.eu/tools/eudamed/#/screen/certificates/36b30597-e8c0-44ac-a559-23e4c06a9ed4), [certificate PDF](https://ec.europa.eu/tools/eudamed/api/documents/6af38300-d56e-4307-8161-e52c33b0a993). |
| **corpuls.mission LIVE — GS Elektromedizinische Geräte G. Stemple GmbH** | EUDAMED device entry identifies MDR software, Class IIb, **on the market**. | Device registration verified. Its linked-certificate list was empty, and certificate searches by manufacturer name and SRN returned no match. REPORT coverage remains unverified. [Device record](https://ec.europa.eu/tools/eudamed/#/screen/search-device/f809f76c-ffb7-464d-b184-dd1143545024), [manufacturer MDR statement naming LIVE](https://corpuls.world/loesungen/telenotarztsystem/). |
| **Aweria / Aweria Prehospital — Omda** | Manufacturer states that Aweria is CE marked, Class IIa; its website specifies MDR (EU) 2017/745. | No matching Aweria trade-name entry or certificate match for Aweria, Omda or CSAM was returned. Additional actor/model searches failed or timed out. Registry verification is incomplete. [Manufacturer product and CE information](https://www.aweria.com/produkten/), [English product information](https://www.aweria.com/en/the-product/). |
| **LIFENET System — Physio-Control / Stryker** | A manufacturer declaration dated **2015-03-05** lists LIFENET ePCR Client, Adapter and Printer within a Class IIa MDD declaration. | Historical evidence only. No LIFENET trade-name match was returned. The current Physio-Control certificate retrieved concerned defibrillation/arrhythmology products and did not identify LIFENET. [Historical declaration in procurement attachment](https://smlouvy.gov.cz/smlouva/soubor/8286031/10.7.2018_P%C5%99%C3%ADlohy%20ke%20smlouv%C4%9B_defibril%C3%A1tory_v%C5%A1e_A.pdf), [current manufacturer certificate inspected](https://ec.europa.eu/tools/eudamed/#/screen/certificates/cac40ae8-25d2-4401-a1d7-55a3510e3be4). |

## Ortivus MobiMed: precise certificate scope

Ortivus announced its MDR certificate on **29 November 2023**, stating that the
certificate had been received the previous day and that MobiMed had previously
been CE marked under the MDD. Its current certification page describes its
products as Class IIb medical devices under MDR.
[Ortivus announcement](https://ortivus.com/mfn_news/ortivus-receives-mdr-certificate/),
[quality and certifications](https://ortivus.com/quality-and-certifications/).

The EUDAMED certificate record provides more precise evidence:

| Identifier | Value |
| --- | --- |
| Legal manufacturer | Ortivus MobiMed AB |
| Manufacturer SRN | **SE-MF-000003568** |
| Certificate | **28620161156**, revision **00** |
| Notified body | **2862 — Intertek Medical Notified Body AB** |
| Certificate type | MDR quality management system, Annex IX Chapters I and III |
| Listed MobiMed products | **410010331 — MobiMed Monitor**; **410018824 — MobiMed Clinical Review Solution** |
| Basic UDI-DI for those products | **735013931410010331ZE** |
| Classification | **Class IIb** |
| Intended-use scope | Measurement and monitoring of vital functions |

The certificate's structured scope includes the name “MobiMed”, while its scanned
product-list annex specifies the two products above. **MobiMed ePR is not named in
that annex.** Neither its absence nor the general platform name resolves whether
an ePR configuration is covered elsewhere.
[Certificate data](https://ec.europa.eu/tools/eudamed/api/certificates/3d12026c-2b53-444b-bd02-a537d994737f),
[full certificate and product list](https://ec.europa.eu/tools/eudamed/api/documents/59c1b651-96ff-4cce-83fd-aee9daf34bed).

**Correction to the initial research:** describing MobiMed broadly as a confirmed
CE-marked ambulance record platform overstated the evidence for the standalone
ePR product. The verified scope is the named monitoring products. To resolve ePR
coverage, obtain its EU Declaration of Conformity and the applicable certificate
schedule, identifying exact modules and software versions.

## Other useful identifiers and version distinctions

| Product | Manufacturer SRN | Device identifier | Basic UDI-DI |
| --- | --- | --- | --- |
| Merlot Medi Physio v3.1 | **FI-MF-000012661** | **06430078950022** | **643007895MMPHYSIO01QL** |
| corpuls.mission LIVE | **DE-MF-000007648** | **04064542016536** | **42601783500013J2** |

Merlot Medi Physio v3.1 has a blank trade-name field in the search response. It was
found through its manufacturer SRN, then identified through its Basic UDI record
and reference field. The older **v3.0.4** MDD legacy entry is marked **no longer on
the market**; this does not describe the current v3.1 entry.
[Current Basic UDI record](https://ec.europa.eu/tools/eudamed/api/devices/basicUdiData/udiDiData/e7e8617f-72d1-402b-a9cf-0ef2eac65900),
[older device record](https://ec.europa.eu/tools/eudamed/#/screen/search-device/a8801697-0a81-464e-bb3d-3c1bd0a4fff8).

For corpuls, documentation from history-taking to handover is described under
**REPORT**, whereas the verified medical-device entry is **LIVE**.
[Manufacturer module descriptions](https://corpuls.hospital/produkte/corpuls.mission/).

## Additional candidates

The broader online search also identified **Dedalus amPHI** and **LogObject
AmbulancePad** as ambulance record products. Public CE evidence was insufficient
to classify them as confirmed matches. A supplementary EUDAMED trade-name search
returned unrelated products for “amPHI” and no matches for “AmbulancePad”; these
were not full manufacturer/certificate investigations.
[amPHI product information](https://www.dedalus.com/anz/our-offer/products/amphi-prehospital/),
[AmbulancePad product information](https://logobject.com/fr/solutions/securite-publique-et-autorites/chaine-de-sauvetage-numerique/documentation-dintervention-mobile).

## EUDAMED access and research limitations

[EUDAMED's public database](https://ec.europa.eu/tools/eudamed/) exposes device,
manufacturer and certificate information. The actual certificate PDFs for Ortivus,
CGI and Physio-Control were downloaded during this investigation. Device
registration, a QMS certificate and a manufacturer's Declaration of Conformity
are different forms of evidence; their product scope must be reconciled.
[Commission certificate-module explanation](https://health.ec.europa.eu/medical-devices-eudamed/notified-bodies-and-certificates-module_en).

The investigation used the public search endpoints employed by EUDAMED's
JavaScript interface. Product-name searches included historical versions and
products no longer on the market; manufacturer identifiers were used where
available. Some manufacturer-name, actor and model queries returned errors or
timed out. One page of the wider Physio-Control device listing also timed out.
Failed queries were not treated as empty results.

Mandatory use of the certificate module began **28 May 2026**. The transition
timeline gives **28 May 2027** as the deadline for registering certificates issued
under MDR/IVDR before mandatory use. Missing entries therefore do not establish
absence of certification.
[Commission transition timeline](https://health.ec.europa.eu/document/download/9aea934d-85b0-4118-92e0-ec6b7c8fdc95_en?filename=md_eudamed_tp-cert-devices_en.pdf).

EUDAMED record links require JavaScript and may change when records are revised.
If a link fails, search using the certificate number, SRN or UDI identifiers
recorded above. This summary records the evidence available on the research date;
it does not establish coverage of every current software release or add-on.
