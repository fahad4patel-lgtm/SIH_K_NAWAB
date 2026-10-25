# NEXORA — SIH 2026 Network Analysis Prototype

## What this is
A graph-first investigative analysis prototype for exploring documented links between entities and incident records.

It does not connect to police databases. Public statistics come from official Indian sources; person, incident, and relationship records in the demo graph are synthetic. The current matcher links exact normalized phone, case, and vehicle identifiers; it is deterministic graph logic, not an AI/ML model.

## Features
- Express REST API backed by PostgreSQL
- Modern responsive dashboard
- India NCRB/MHA aggregate statistics
- Network graph with entity and incident records
- Phone, case, and vehicle identifier intake
- Automatic exact-identifier matching
- Focused neighborhood graph with search and full-network view
- Identifier-match node and relationship CSV exports
- Incident record workspace
- SHA-256 chained evidence ledger ("blockchain-inspired" audit layer)
- Source/provenance page
- No frontend framework required, so it stays fast

This prototype has no authentication, authorization, or production-grade protection for sensitive personal information. Use synthetic or otherwise non-sensitive data only until access controls, encryption, retention policies, and legal authorization are implemented.

## Run
Node.js 20+
```bash
npm install
npm start
```
Open http://localhost:3000

## Graph data
The running graph is served from PostgreSQL. Download node and relationship
records, including relationship types and masked identifier hints, from
`/api/network/csv/nodes` and `/api/network/csv/relationships`. Neo4j storage is
not wired into this prototype yet.

## Authentic sources used
1. Open Government Data Platform India / NCRB Crime in India 2023:
   https://www.data.gov.in/resource/stateut-wise-human-trafficking-cases-indian-penal-code-ipc-during-2023
2. Ministry of Home Affairs Anti-Trafficking Cell:
   https://www.mha.gov.in/en/commoncontent/anti-trafficking-section
3. MHA state/UT AHT Units during 2020:
   https://www.mha.gov.in/MHA1/Par2017/pdfs/par2022-pdfs/LS-08022022/1093.pdf
4. NCRB Crime in India 2023 reference:
   https://www.ncrb.gov.in/uploads/files/3CrimeinIndia2023PartIII2.pdf

## Suggested 4-person team split
1. Frontend + UX: dashboard, graph, responsive UI
2. Backend: APIs, authentication, data layer
3. Graph/ML: feature engineering, evaluation, explainability
4. Blockchain/data engineering: evidence ledger, provenance, audit trail

## Next SIH-level upgrades
- Neo4j for native graph queries
- An evaluated graph-analysis or model service
- Role-based access control + audit logs
- Authorized, provenance-preserving data ingestion where legally and technically available
- Missing-person/open-case correlation only through authorized datasets
- Geospatial hotspot layer using public administrative boundaries
- Evaluated graph/ML methods, false-positive monitoring, and human review
- Encrypt sensitive data and avoid exposing PII in dashboards
