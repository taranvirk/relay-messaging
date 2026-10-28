# Recorded load-test results

These are historical local measurements, including failed and superseded runs.
See [verification](../../docs/verification.md) for test topology, dates, qualified
results and limitations. They do not establish AWS capacity or independent-user
capacity.

Before the initial GitHub publication, session JWTs in `setup_data` were replaced
with `[REDACTED_TEST_SESSION]`. Every report's `metrics` object was checked to be
unchanged. Identifiers and measured results are retained for traceability.

Raw k6 exports can include setup cookies. Remove credentials and session tokens
before committing future results; never publish an authenticated raw export.
