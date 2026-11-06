# Security policy

## Supported versions

Only the latest release of Tobi gets security fixes. Update from the island (Settings, Updates) or from the [releases page](https://github.com/sailxx/Tobi/releases).

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

Report it privately: open the [Security tab](https://github.com/sailxx/Tobi/security/advisories/new) and choose "Report a vulnerability". Include the Tobi version, your system, and the steps to reproduce.

You can expect a first answer within 7 days. A confirmed problem is fixed in a new release, and the report is credited unless you prefer otherwise.

## What is in scope

- The phone link (pairing, the TLS connection and its certificate pinning, the pairing token).
- The local hook server that agents report to.
- Anything that lets a web page, another app or another device on the network read or control Tobi without the user's consent.
- The updater and the installers.

Out of scope: problems that need an attacker who already controls the user's account or computer.
