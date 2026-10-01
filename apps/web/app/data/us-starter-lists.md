# US starter choices

`us-starter-lists.json` pins application-curated, non-exhaustive choices for
external-code fields with no NEMSIS bundled list. These are starter choices,
not complete terminology or geographic datasets. The canonical installation
catalog includes them; the source audit verifies their contents and checksum.
They are separate from the ten official NEMSIS lists.

Reviewed 2026-10-01. Geographic defaults describe New York city, New York
County, New York, United States. Cities and counties offer additional New York
examples; states include all 50 states, DC and five inhabited territories.
City codes are GNIS identifiers (Census PLACENS), not Census PLACE codes.
Tracts retain their complete 11-digit GEOID, and state/county codes retain
leading zeros. The first choice is the deterministic Populate default.

Sources:

- [Census ANSI state codes](https://www.census.gov/library/reference/code-lists/ansi/ansi-codes-for-states.html)
- [Census New York incorporated places, ACS26](https://tigerweb.geo.census.gov/tigerwebmain/Files/acs26/tigerweb_acs26_incplace_ny.html)
- [Census New York counties, ACS26](https://tigerweb.geo.census.gov/tigerwebmain/Files/acs26/tigerweb_acs26_county_ny.html)
- [Census New York tracts, ACS26](https://tigerweb.geo.census.gov/tigerwebmain/Files/acs26/tigerweb_acs26_tract_ny.html)
- [Census country ISO codes](https://www.census.gov/foreign-trade/schedules/c/countrycodes.html)
- Current medication ingredients reuse RxNorm entries from the pinned NEMSIS
  `medications-given` list; diagnosis choices reuse ICD-10-CM entries from its
  `impression` list. These are terminology examples, not treatment guidance.
- [CMS PCS tables](https://www.cms.gov/files/document/2016-pcs-code-tables.pdf)
  provide manual cardiac output support (5A12012).
- [CMS PCS reference manual](https://www.cms.gov/Medicare/Coding/ICD10/Downloads/pcs_refman.pdf)
  provides chest radiography (BW03ZZZ) and noncontrast abdomen/pelvis CT (BW21ZZZ).

Updating repository definitions does not overwrite immutable published catalogs.
Existing installations must publish a catalog containing these choices and
activate a compatible form. Populate refreshes previously generated values;
clinician-entered values remain preserved.
