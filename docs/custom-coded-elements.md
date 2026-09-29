# Custom coded elements

An administrator creates a custom coded element in a catalog draft with a stable UUID, namespace and slug, a custom code system URI, and one or more stable code/label pairs. The optional `nemsisElement` and per-choice `nemsisCode` fields record mappings to the pinned NEMSIS 3.5.1 catalog. They do not replace the custom element or code identity. Mapped codes must exist for the mapped element in that catalog release. Published definitions are immutable and travel with the pinned release.

The potential NOT codes are `7701001`, `7701003`, and `7701005`. The potential pertinent negative codes are the NEMSIS 3.5.1 `eCustomConfiguration.08` enumeration. A definition may permit a subset. A form field separately enables exceptional codes and chooses the order and enabled subset of ordinary and NOT choices. The runtime control uses that effective policy in both clinical views. Reports store the chosen code and its custom code system, with NOT and pertinent negative attributes stored separately, so save and reload preserve them.

To add a local option to an eligible existing NEMSIS list, edit that list in the catalog authoring view. A custom coded element has its own identity and cannot claim the NEMSIS code system. It does not expand a restricted standard list.
