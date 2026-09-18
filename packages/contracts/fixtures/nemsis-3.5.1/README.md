# Pinned NEMSIS 3.5.1 EMS Schematron inputs

`EMSDataSet.sch.xml` is the expanded official national EMS Schematron from the
NEMSIS public repository `release-3.5.1` branch at commit
`445011ab34a9fc49daf8da1b7ec5f3e4d6f684c4`. Its schema build is
`3.5.1.251001CP2` and its SHA-256 digest is
`b096fadc0efb1606dbee4d55d610562e895a6a2dbac0c3a622bf43f72196b8c2`.

`ems-fixture-outcomes.json` is the compact identity oracle extracted from every
official file in `SampleData/Schematron/EMS/svrl` at the same commit. It stores
the fixture name and the distinct `svrl:failed-assert` identities. The source
XML and generated SVRL occupy about 17 MiB and are not duplicated here; rerun
the generator against a checkout of that official commit to independently
rebuild the oracle:

```sh
npm run generate:nemsis-ems-import -w @open-triage/contracts -- \
  --official-root /path/to/nemsis_public
```

Ordinary builds run the generator in check mode without network or an external
checkout. Updating either pinned input requires an explicit source review.
