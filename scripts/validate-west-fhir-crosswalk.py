"""Check the WEST export mapping against a downloaded, pinned FHIR package."""
import hashlib
import json
import sys
import tarfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
definition = json.loads((root / "defines/decision_support/west-a-2025.json").read_text())
mapping = definition["fhir"]
archive = Path(sys.argv[1])
assert hashlib.sha256(archive.read_bytes()).hexdigest() == mapping["sha256"], "Different IG build"


with tarfile.open(archive) as package:
    def resource(filename):
        return json.load(package.extractfile("package/" + filename + ".json"))

    def concepts(name):
        return {term["code"]: term for term in resource("CodeSystem-west-a-" + name + "-cs")["concept"]}

    manifest = resource("package")
    assert (manifest["name"], manifest["version"], manifest["date"], manifest["canonical"]) == (
        mapping["package"], mapping["packageVersion"], mapping["packageDate"], mapping["canonical"])
    assert mapping["fhirVersion"] in manifest["fhirVersions"]
    complaints = concepts("chief-complaint")
    criteria = concepts("triage-criterion")
    priorities = concepts("triage-priority")
    binding = resource("ValueSet-west-a-triage-criterion-vs")["compose"]
    assert any(item["system"] == mapping["canonical"] + "/CodeSystem/west-a-triage-criterion-cs"
               for item in binding["include"])
    excluded = {term["code"] for item in binding["exclude"] for term in item.get("concept", [])}
    assert set(criteria) - excluded == set(mapping["criterion"].values()) | {mapping["noWarning"]}
    assert set(mapping["priority"].values()) == set(priorities)
    assert set(mapping["complaint"].values()) == set(complaints)

checked = set()
def check_category(category, chief):
    if category["id"] in mapping["complaint"]:
        assert mapping["complaint"][category["id"]] == chief
    for row in category["criteria"]:
        if row.get("population") == "paediatric" or row.get("navigateToCategory"):
            continue
        local = row["id"]
        term = criteria[mapping["criterion"][local]]
        props = term["property"]
        owners = {p["valueCoding"]["code"] for p in props if p["code"] == "complaint"}
        assert (chief in owners if chief else not owners), (local, term["code"], "complaint")
        assert any(p["code"] == "priority" and p["valueCoding"]["code"] == mapping["priority"][row["triage_color"]]
                   for p in props), (local, term["code"], "priority")
        checked.add(local)
    for child in category.get("subcategories", []):
        check_category(child, chief)

for category in definition["categories"]:
    check_category(category, mapping["complaint"].get(category["id"]))
assert checked == set(mapping["criterion"]), "Missing or surplus local codes"
print(f"{len(checked)} selectable findings, {len(set(mapping['criterion'].values()))} IG criteria, "
      f"{len(complaints)} chief complaints, {len(priorities)} priorities; all matched.")
