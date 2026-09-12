# NEXUS INDIA — SIH 2026 Working Full-Stack Prototype

## What this is
A 3–4 person team-sized prototype for a criminal-intelligence platform focused on early human-trafficking pattern detection in India.

It is deliberately NOT a claim of access to police databases. Public statistics come from official Indian sources; individual/network records are synthetic.

## Features
- Express REST backend
- Modern responsive dashboard
- India NCRB/MHA statistics
- Human Trafficking Sentinel scoring model
- Dynamic relationship graph
- Case/lead workspace
- SHA-256 chained evidence ledger ("blockchain-inspired" audit layer)
- Source/provenance page
- Add synthetic entities and demo cases
- No frontend framework required, so it stays fast

## Run
Node.js 20+
```bash
npm install
npm start
```
Open http://localhost:3000

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
3. AI/ML: feature engineering, scoring, evaluation, explainability
4. Blockchain/data engineering: evidence ledger, provenance, audit trail

## Next SIH-level upgrades
- PostgreSQL for cases/evidence
- Neo4j for graph relationships
- Python FastAPI model service
- Role-based access control + audit logs
- Real government API/data ingestion where legally and technically available
- Missing-person/open-case correlation only through authorized datasets
- Geospatial hotspot layer using public administrative boundaries
- Model evaluation, false-positive monitoring and human-in-the-loop approval
- Encrypt sensitive data and avoid exposing PII in dashboards
