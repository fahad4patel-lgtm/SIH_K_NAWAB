const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

let neo4j;
try {
    neo4j = require("neo4j-driver");
} catch {
    neo4j = null;
}

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


const authenticData = JSON.parse(
    fs.readFileSync(
        path.join(__dirname, "data", "authentic-data.json"),
        "utf8"
    )
);

function parseCsvLine(line) {
    const fields = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"' && line[index + 1] === '"') {
            field += '"';
            index += 1;
        } else if (character === '"') {
            quoted = !quoted;
        } else if (character === "," && !quoted) {
            fields.push(field);
            field = "";
        } else {
            field += character;
        }
    }

    fields.push(field);
    return fields;
}

function readCsv(fileName) {
    const lines = fs.readFileSync(path.join(__dirname, "data", fileName), "utf8")
        .trim()
        .split(/\r?\n/);
    const headers = parseCsvLine(lines.shift());

    return lines.map(line => Object.fromEntries(
        parseCsvLine(line).map((value, index) => [headers[index], value])
    ));
}

const neo4jDriver = neo4j && process.env.NEO4J_URI
    ? neo4j.driver(
        process.env.NEO4J_URI,
        neo4j.auth.basic(
            process.env.NEO4J_USER || "neo4j",
            process.env.NEO4J_PASSWORD || "neo4j"
        )
    )
    : null;

const pool = new Pool({
    user: process.env.PGUSER || "postgres",
    host: process.env.PGHOST || "localhost",
    database: process.env.PGDATABASE || "Nexora_DB",
    password: process.env.PGPASSWORD || "1234",
    port: Number(process.env.PGPORT) || 5432
});

function hashBlock(index, event, previousHash) {
    return crypto.createHash("sha256")
        .update(`${index}:${event}:${previousHash}`)
        .digest("hex")
        .slice(0, 24);
}

async function ensureDatabase() {
    await pool.query(`
        ALTER TABLE persons ADD COLUMN IF NOT EXISTS entity_type VARCHAR(30) DEFAULT 'person';
        ALTER TABLE persons ADD COLUMN IF NOT EXISTS source_reference TEXT NOT NULL DEFAULT 'Legacy demo record';
        ALTER TABLE persons ADD COLUMN IF NOT EXISTS source_url TEXT;
        ALTER TABLE connections ADD COLUMN IF NOT EXISTS source_reference TEXT NOT NULL DEFAULT 'Legacy demo record';
        ALTER TABLE connections ADD COLUMN IF NOT EXISTS source_url TEXT;
        ALTER TABLE connections ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ DEFAULT NOW();
        ALTER TABLE person_cases ADD COLUMN IF NOT EXISTS source_reference TEXT NOT NULL DEFAULT 'Incident record';
        ALTER TABLE person_cases ADD COLUMN IF NOT EXISTS source_url TEXT;
        ALTER TABLE person_cases ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ DEFAULT NOW();
        ALTER TABLE person_cases ADD COLUMN IF NOT EXISTS relationship VARCHAR(100) NOT NULL DEFAULT 'linked to incident';
        ALTER TABLE cases ADD COLUMN IF NOT EXISTS source_reference TEXT NOT NULL DEFAULT 'Legacy demo record';
        ALTER TABLE cases ADD COLUMN IF NOT EXISTS source_url TEXT;
        CREATE TABLE IF NOT EXISTS record_identifiers (
            identifier_id SERIAL PRIMARY KEY,
            record_key VARCHAR(30) NOT NULL,
            identifier_type VARCHAR(20) NOT NULL CHECK (identifier_type IN ('phone', 'phone_ref', 'case', 'vehicle')),
            normalized_value VARCHAR(80) NOT NULL,
            display_value VARCHAR(80) NOT NULL,
            UNIQUE (record_key, identifier_type, normalized_value)
        );
        ALTER TABLE record_identifiers DROP CONSTRAINT IF EXISTS record_identifiers_identifier_type_check;
        ALTER TABLE record_identifiers ADD CONSTRAINT record_identifiers_identifier_type_check CHECK (identifier_type IN ('phone', 'phone_ref', 'case', 'vehicle'));
        CREATE INDEX IF NOT EXISTS record_identifiers_match_idx ON record_identifiers (identifier_type, normalized_value);
        CREATE INDEX IF NOT EXISTS connections_person_1_idx ON connections (person_1);
        CREATE INDEX IF NOT EXISTS connections_person_2_idx ON connections (person_2);
        CREATE INDEX IF NOT EXISTS person_cases_case_id_idx ON person_cases (case_id);
        ALTER TABLE cases ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'MEDIUM';
        ALTER TABLE cases ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'OPEN';
        ALTER TABLE cases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
        ALTER TABLE cases ADD COLUMN IF NOT EXISTS case_description TEXT NOT NULL DEFAULT '';
        CREATE TABLE IF NOT EXISTS evidence_blocks (
            block_index INTEGER PRIMARY KEY,
            event VARCHAR(150) NOT NULL,
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            previous_hash VARCHAR(64) NOT NULL,
            hash VARCHAR(64) NOT NULL
        );
    `);
    await pool.query(`
        UPDATE cases
        SET priority = CASE WHEN arrest_status = 'Absconding' THEN 'HIGH' ELSE 'MEDIUM' END,
            status = CASE WHEN arrest_status = 'Under investigation' THEN 'REVIEW' ELSE 'OPEN' END
        WHERE priority IS NULL OR status IS NULL;
    `);
    const count = await pool.query("SELECT COUNT(*)::int AS count FROM evidence_blocks");
    if (count.rows[0].count === 0) {
        let previousHash = "0";
        for (const [index, event] of ["Evidence intake", "Pattern review", "Human validation"].entries()) {
            const hash = hashBlock(index, event, previousHash);
            await pool.query(
                "INSERT INTO evidence_blocks (block_index, event, previous_hash, hash) VALUES ($1, $2, $3, $4)",
                [index, event, previousHash, hash]
            );
            previousHash = hash;
        }
    }
}

function parseIdentifiers(body) {
    const fields = [
        { type: "phone", key: "phoneNumber", normalize: value => {
            const digits = value.replace(/\D/g, "");
            if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
            if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
            return digits;
        }, valid: value => /^[+()\-\s\d]+$/.test(value) },
        { type: "phone_ref", key: "phoneId", normalize: value => value.toUpperCase().replace(/[^A-Z0-9-]/g, ""), valid: value => /^[A-Z0-9-]+$/i.test(value) },
        { type: "case", key: "caseNumber", normalize: value => value.toUpperCase().replace(/[^A-Z0-9]/g, ""), valid: () => true },
        { type: "vehicle", key: "vehicleNumber", normalize: value => value.toUpperCase().replace(/[^A-Z0-9]/g, ""), valid: () => true }
    ];
    const identifiers = [];
    for (const field of fields) {
        const raw = body[field.key];
        if (raw === undefined || raw === null || raw === "") continue;
        if (typeof raw !== "string" || raw.length > 80 || !field.valid(raw)) {
            return { error: `Enter a valid ${field.type} identifier.` };
        }
        const displayValue = raw.trim();
        const normalizedValue = field.normalize(displayValue);
        if (!normalizedValue || (field.type === "phone" && (normalizedValue.length < 7 || normalizedValue.length > 15))) {
            return { error: `Enter a valid ${field.type} identifier.` };
        }
        identifiers.push({ type: field.type, displayValue, normalizedValue });
    }
    return { identifiers };
}

async function saveIdentifiers(recordKey, identifiers) {
    for (const identifier of identifiers) {
        await pool.query(`
            INSERT INTO record_identifiers (record_key, identifier_type, normalized_value, display_value)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (record_key, identifier_type, normalized_value) DO NOTHING
        `, [recordKey, identifier.type, identifier.normalizedValue, identifier.displayValue]);
    }
}

async function getNetwork() {
    const [people, incidents, relationships, incidentLinks, identifierRows] = await Promise.all([
        pool.query(`
            WITH connection_counts AS (
                SELECT person_id, COUNT(*)::int AS links
                FROM (
                    SELECT person_1 AS person_id FROM connections
                    UNION ALL
                    SELECT person_2 AS person_id FROM connections
                ) connection_links
                WHERE person_id IS NOT NULL
                GROUP BY person_id
            ), case_counts AS (
                SELECT person_id, COUNT(*)::int AS links FROM person_cases GROUP BY person_id
            )
            SELECT p.person_id AS id, p.name, COALESCE(p.entity_type, 'person') AS type,
                p.occupation, p.city, p.state, p.age, p.gender,
                COALESCE(cc.links, 0) + COALESCE(pc.links, 0) AS links
            FROM persons p
            LEFT JOIN connection_counts cc ON cc.person_id = p.person_id
            LEFT JOIN case_counts pc ON pc.person_id = p.person_id
            ORDER BY p.person_id
        `),
        pool.query(`
            SELECT 'I-' || case_id AS id,
                'Incident ' || case_id || ' · ' || COALESCE(crime_type, 'Unclassified incident') AS name,
                'incident' AS type,
                COALESCE(pc.links, 0) AS links,
                location, case_date
            FROM cases c
            LEFT JOIN (SELECT case_id, COUNT(*)::int AS links FROM person_cases GROUP BY case_id) pc USING (case_id)
            ORDER BY case_id
        `),
        pool.query(`
            SELECT person_1 AS source, person_2 AS target, relationship,
                NULL::text AS "identifierHint", observed_at AS "observedAt"
            FROM connections ORDER BY connection_id
        `),
        pool.query(`
            SELECT person_id AS source, 'I-' || case_id AS target, relationship,
                NULL::text AS "identifierHint", observed_at AS "observedAt"
            FROM person_cases ORDER BY case_id, person_id
        `),
        pool.query(`
            SELECT record_key AS "recordKey", identifier_type AS "identifierType",
                normalized_value AS "normalizedValue"
            FROM record_identifiers
            ORDER BY identifier_type, normalized_value, record_key
        `)
    ]);
    const identifierEntities = new Map();
    const identifierLinks = identifierRows.rows.map(row => {
        const key = `${row.identifierType}:${row.normalizedValue}`;
        let entity = identifierEntities.get(key);
        if (!entity) {
            const suffix = row.normalizedValue.slice(-4);
            const id = `X-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
            const label = { phone: "PHONE", phone_ref: "PHONE ID", case: "CASE", vehicle: "VEHICLE" }[row.identifierType];
            entity = { id, name: `${label} ···${suffix}`, type: "identifier", identifierType: row.identifierType, links: 0 };
            identifierEntities.set(key, entity);
        }
        return {
            source: row.recordKey,
            target: entity.id,
            relationship: row.identifierType === "phone_ref" ? "shared phone ID" : `shared ${row.identifierType} number`,
            identifierHint: `Identifier ending ${row.normalizedValue.slice(-4)}`,
            observedAt: null
        };
    });
    const entities = [...people.rows, ...incidents.rows, ...identifierEntities.values()];
    const edgeDetails = [...relationships.rows, ...incidentLinks.rows, ...identifierLinks];
    const linkCounts = new Map(entities.map(entity => [entity.id, 0]));
    edgeDetails.forEach(edge => {
        linkCounts.set(edge.source, (linkCounts.get(edge.source) || 0) + 1);
        linkCounts.set(edge.target, (linkCounts.get(edge.target) || 0) + 1);
    });
    entities.forEach(entity => { entity.links = linkCounts.get(entity.id) || 0; });
    return {
        source: "postgres",
        entities,
        edges: edgeDetails.map(edge => [edge.source, edge.target]),
        edgeDetails
    };
}

async function getLedger() {
    const result = await pool.query("SELECT block_index AS index, event, timestamp, previous_hash AS \"previousHash\", hash FROM evidence_blocks ORDER BY block_index");
    const blocks = result.rows;
    return {
        valid: blocks.every((block, index) => block.previousHash === (index ? blocks[index - 1].hash : "0") && block.hash === hashBlock(block.index, block.event, block.previousHash)),
        blocks
    };
}

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        message: "NEXORA backend is running"
    });
});

app.get("/api/db-test", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW()");

        res.json({
            status: "connected",
            database: "Nexora_DB",
            time: result.rows[0].now
        });
    } catch (error) {
        console.error("DATABASE CONNECTION ERROR:", error.message);

        res.status(500).json({
            status: "error",
            message: error.message
        });
    }
});

app.get("/api/overview", async (req, res) => {
    try {
        const network = await getNetwork();
        res.json({
            metrics: {
                entityCount: network.entities.filter(entity => entity.type !== "incident" && entity.type !== "identifier").length,
                incidentCount: network.entities.filter(entity => entity.type === "incident").length,
                relationshipCount: network.edgeDetails.length
            },
            authentic: { humanTrafficking2023: authenticData.humanTrafficking2023 }
        });
    } catch (error) {
        res.status(500).json({ error: "Database error", details: error.message });
    }
});

app.get("/api/network", async (req, res) => {
    try {
        return res.json(await getNetwork());
    } catch (error) {
        return res.status(500).json({ error: "Database error", details: error.message });
    }
});

app.post("/api/network/identifiers", async (req, res) => {
    const { recordId, identifierType, identifierValue } = req.body || {};
    const inputKey = { phone: "phoneNumber", phone_ref: "phoneId", case: "caseNumber", vehicle: "vehicleNumber" }[identifierType];
    if (typeof recordId !== "string" || !inputKey) {
        return res.status(400).json({ error: "Choose a record and supported identifier type." });
    }
    const parsed = parseIdentifiers({ [inputKey]: identifierValue });
    if (parsed.error || !parsed.identifiers.length) {
        return res.status(400).json({ error: parsed.error || "Enter an identifier." });
    }
    try {
        let recordExists;
        if (recordId.startsWith("I-")) {
            recordExists = await pool.query("SELECT 1 FROM cases WHERE case_id = $1", [recordId.slice(2)]);
        } else {
            recordExists = await pool.query("SELECT 1 FROM persons WHERE person_id = $1", [recordId]);
        }
        if (!recordExists.rowCount) return res.status(404).json({ error: "The selected record no longer exists." });
        const identifier = parsed.identifiers[0];
        if (identifier.type !== "phone" && (recordId.startsWith("TM-") || recordId.startsWith("I-TM-"))) {
            identifier.normalizedValue = `TM-${identifier.normalizedValue}`;
        }
        await saveIdentifiers(recordId, [identifier]);
        const matches = await pool.query(`
            SELECT COUNT(DISTINCT record_key)::int AS count
            FROM record_identifiers
            WHERE identifier_type = $1 AND normalized_value = $2
        `, [identifier.type, identifier.normalizedValue]);
        return res.status(201).json({ saved: true, matches: Math.max(0, matches.rows[0].count - 1) });
    } catch (error) {
        return res.status(500).json({ error: "Identifier could not be saved.", details: error.message });
    }
});

app.get("/api/network/status", async (req, res) => {
    try {
        const network = await getNetwork();
        res.json({ source: network.source, neo4jConfigured: Boolean(neo4jDriver), nodes: network.entities.length, relationships: network.edges.length });
    } catch (error) {
        res.status(500).json({ error: "Database error", details: error.message });
    }
});

app.get("/api/network/csv/:file", (req, res) => {
    getNetwork().then(network => {
        const isNodes = req.params.file === "nodes";
        const isRelationships = req.params.file === "relationships";
        if (!isNodes && !isRelationships) return res.status(404).json({ error: "Unknown graph CSV" });
        const header = isNodes ? "id:ID,name,type,links\n" : ":START_ID,:END_ID,relationship,identifier_hint,observed_at\n";
        const csv = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const body = isNodes
            ? network.entities.map(entity => [entity.id, entity.name, entity.type, entity.links].map(csv).join(",")).join("\n")
            : network.edgeDetails.map(edge => [edge.source, edge.target, edge.relationship, edge.identifierHint, edge.observedAt].map(csv).join(",")).join("\n");
        res.type("text/csv").attachment(`${req.params.file}.csv`).send(header + body + "\n");
    }).catch(error => res.status(500).json({ error: "Database error", details: error.message }));
});

app.post("/api/entities", async (req, res) => {
    try {
        const body = req.body || {};
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const type = typeof body.type === "string" ? body.type : "";
        const allowedTypes = ["person", "organization", "vehicle", "phone", "location", "account", "device"];
        if (!name || name.length > 120) return res.status(400).json({ error: "Enter a record name (up to 120 characters)." });
        if (!allowedTypes.includes(type)) return res.status(400).json({ error: "Choose a supported record type." });
        const parsed = parseIdentifiers(body);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        const last = await pool.query("SELECT person_id FROM persons WHERE person_id LIKE 'E%' ORDER BY person_id DESC LIMIT 1");
        const nextNumber = last.rows.length ? Number(last.rows[0].person_id.slice(1)) + 1 : 1;
        const entity = { id: `E${String(nextNumber).padStart(3, "0")}`, name, type, links: 0 };
        await pool.query("INSERT INTO persons (person_id, name, entity_type) VALUES ($1, $2, $3)", [entity.id, entity.name, entity.type]);
        await saveIdentifiers(entity.id, parsed.identifiers);
        res.status(201).json(entity);
    } catch (error) {
        res.status(500).json({ error: "Database error", details: error.message });
    }
});

app.get("/api/entities/:id/connections", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.person_id AS id, p.name, c.relationship, p.occupation, p.city, p.state
            FROM connections c
            JOIN persons p ON p.person_id = CASE WHEN c.person_1 = $1 THEN c.person_2 ELSE c.person_1 END
            WHERE c.person_1 = $1 OR c.person_2 = $1
            ORDER BY p.person_id
        `, [req.params.id]);
        res.json({ entityId: req.params.id, connections: result.rows });
    } catch (error) {
        res.status(500).json({ error: "Database error", details: error.message });
    }
});

app.get("/api/cases", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 'NX-2026-' || c.case_id AS id, c.crime_type AS category, c.case_description AS observation,
                c.location, c.case_date AS "observedAt",
                (SELECT display_value FROM record_identifiers i WHERE i.record_key = 'I-' || c.case_id AND i.identifier_type = 'case' LIMIT 1) AS "caseNumber",
                (SELECT COUNT(*) FROM person_cases pc WHERE pc.case_id = c.case_id)::int AS "linkedEntities"
            FROM cases c ORDER BY c.case_date DESC NULLS LAST, c.case_id DESC
        `);
        res.json({ incidents: result.rows });
    } catch (error) {
        res.status(500).json({ error: "Database error", details: error.message });
    }
});

app.post("/api/cases", async (req, res) => {
    try {
        const body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return res.status(400).json({ error: "Enter valid case details." });
        }

        const crimeType = typeof body.crimeType === "string" ? body.crimeType.trim() : "";
        const caseDescription = typeof body.description === "string" ? body.description.trim() : "";
        const location = typeof body.location === "string" ? body.location.trim() : "";
        const caseDate = typeof body.caseDate === "string" ? body.caseDate : "";
        const parsedDate = new Date(`${caseDate}T00:00:00.000Z`);
        const parsed = parseIdentifiers(body);

        if (!crimeType || crimeType.length > 100) {
            return res.status(400).json({ error: "Case type is required (up to 100 characters)." });
        }
        if (!caseDescription || caseDescription.length > 2000) {
            return res.status(400).json({ error: "A summary is required (up to 2,000 characters)." });
        }
        if (!location || location.length > 150) {
            return res.status(400).json({ error: "Location is required (up to 150 characters)." });
        }
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(caseDate) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== caseDate) {
            return res.status(400).json({ error: "Enter a valid case date." });
        }

        const next = await pool.query("SELECT COALESCE(MAX(CAST(SUBSTRING(case_id FROM 2) AS INTEGER)), 0) + 1 AS next FROM cases WHERE case_id ~ '^C[0-9]+$'");
        const caseId = `C${String(next.rows[0].next).padStart(3, "0")}`;
        await pool.query("INSERT INTO cases (case_id, crime_type, case_description, case_date, location, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())", [caseId, crimeType, caseDescription, caseDate, location]);
        await saveIdentifiers(`I-${caseId}`, parsed.identifiers);
        res.status(201).json({ id: `NX-2026-${caseId}` });
    } catch (error) {
        res.status(500).json({ error: "Database error", details: error.message });
    }
});

app.get("/api/ledger", async (req, res) => {
    try {
        res.json(await getLedger());
    } catch (error) {
        res.status(500).json({ error: "Database error", details: error.message });
    }
});

app.post("/api/ledger/verify", async (req, res) => {
    try {
        res.json({ valid: (await getLedger()).valid });
    } catch (error) {
        res.status(500).json({ error: "Database error", details: error.message });
    }
});

app.get("/api/sources", (req, res) => {
    res.json(authenticData.sources);
});

app.use("/api", (req, res) => {
    res.status(404).json({ error: "Unknown API route" });
});

app.use((req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

const port =
    Number(process.env.NEXORA_PORT || process.env.PORT) || 3000;

const teamMemberRecords = [
    { id: "P001", name: "Aarav Mehta", age: 29, gender: "Male", city: "Pune", state: "Maharashtra", occupation: "Used-car dealer", case: ["C001", "Vehicle theft", "2025-04-12", "Pune, Maharashtra", "Arrested"], vehicle: "V001", phone: "PH001", links: [["P014", "associate"], ["P003", "financer"]] },
    { id: "P002", name: "Rohan Kulkarni", age: 34, gender: "Male", city: "Nashik", state: "Maharashtra", occupation: "Transport contractor", case: ["C002", "Illegal transportation of stolen goods", "2025-05-19", "Nashik, Maharashtra", "Under Investigation"], vehicle: "V002", phone: "PH002", links: [["P021", "transporter"], ["P004", "associate"]] },
    { id: "P003", name: "Sameer Shaikh", age: 31, gender: "Male", city: "Mumbai", state: "Maharashtra", occupation: "Electronics wholesaler", case: ["C003", "Sale of stolen electronics", "2025-06-03", "Mumbai, Maharashtra", "Arrested"], vehicle: "V003", phone: "PH003", links: [["P027", "financer"], ["P001", "associate"]] },
    { id: "P004", name: "Vikram Deshmukh", age: 27, gender: "Male", city: "Aurangabad", state: "Maharashtra", occupation: "Delivery driver", case: ["C004", "Transporting stolen property", "2025-06-27", "Chhatrapati Sambhajinagar, Maharashtra", "Not Arrested"], vehicle: "V004", phone: "PH004", links: [["P032", "transporter"], ["P002", "associate"]] },
    { id: "P005", name: "Neha Patil", age: 26, gender: "Female", city: "Kolhapur", state: "Maharashtra", occupation: "Accountant", case: ["C005", "Financial fraud", "2025-07-14", "Kolhapur, Maharashtra", "Under Investigation"], vehicle: "V005", phone: "PH005", links: [["P045", "associate"], ["P006", "financer"]] },
    { id: "P006", name: "Kunal Jadhav", age: 30, gender: "Male", city: "Satara", state: "Maharashtra", occupation: "Small-business owner", case: ["C006", "Forged financial documents", "2025-08-02", "Satara, Maharashtra", "Arrested"], vehicle: "V006", phone: "PH006", links: [["P051", "associate"], ["P005", "associate"]] },
    { id: "P007", name: "Aditya More", age: 25, gender: "Male", city: "Solapur", state: "Maharashtra", occupation: "Freelance driver", case: ["C007", "Transporting stolen goods", "2025-08-21", "Solapur, Maharashtra", "Not Arrested"], vehicle: "V007", phone: "PH007", links: [["P027", "transporter"], ["P008", "associate"]] },
    { id: "P008", name: "Manish Rao", age: 36, gender: "Male", city: "Bengaluru", state: "Karnataka", occupation: "Warehouse manager", case: ["C008", "Concealing stolen property", "2025-09-09", "Bengaluru, Karnataka", "Under Investigation"], vehicle: "V008", phone: "PH008", links: [["P034", "associate"], ["P007", "associate"]] },
    { id: "P009", name: "Rohit Naik", age: 28, gender: "Male", city: "Panaji", state: "Goa", occupation: "Logistics coordinator", case: ["C009", "Illegal movement of goods", "2025-10-05", "Panaji, Goa", "Arrested"], vehicle: "V009", phone: "PH009", links: [["P045", "recruiter"], ["P010", "associate"]] },
    { id: "P010", name: "Sagar Bhosale", age: 33, gender: "Male", city: "Pune", state: "Maharashtra", occupation: "Scrap dealer", case: ["C010", "Possession of stolen vehicle parts", "2025-10-22", "Pune, Maharashtra", "Under Investigation"], vehicle: "V010", phone: "PH010", links: [["P021", "associate"], ["P009", "associate"]] }
];

async function importTeamMemberDataset() {
    const client = await pool.connect();
    const sourceReference = "Authorized Team Member Dataset";
    const personKey = id => `TM-${id}`;
    const caseKey = id => `TM-${id}`;
    const externalKey = id => `TM-X-${id}`;

    async function addConnection(firstId, secondId, relationship) {
        const [person1, person2] = [firstId, secondId].sort();
        await client.query(`
            INSERT INTO connections (person_1, person_2, relationship, source_reference, observed_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (person_1, person_2, relationship)
            DO UPDATE SET source_reference = EXCLUDED.source_reference
        `, [person1, person2, relationship, sourceReference]);
    }

    async function addIdentifier(recordKey, type, normalizedValue, displayValue) {
        await client.query(`
            INSERT INTO record_identifiers (record_key, identifier_type, normalized_value, display_value)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (record_key, identifier_type, normalized_value)
            DO UPDATE SET display_value = EXCLUDED.display_value
        `, [recordKey, type, normalizedValue, displayValue]);
    }

    try {
        await client.query("BEGIN");
        const memberIds = new Set(teamMemberRecords.map(record => record.id));
        const externalIds = [...new Set(teamMemberRecords.flatMap(record => record.links.map(([id]) => id)).filter(id => !memberIds.has(id)))];

        for (const externalId of externalIds) {
            await client.query(`
                INSERT INTO persons (person_id, name, entity_type, source_reference)
                VALUES ($1, $2, 'reference', $3)
                ON CONFLICT (person_id) DO NOTHING
            `, [externalKey(externalId), `Unresolved team reference ${externalId}`, sourceReference]);
        }

        for (const record of teamMemberRecords) {
            const [localCaseId, offence, date, location, arrestStatus] = record.case;
            await client.query(`
                INSERT INTO persons (person_id, name, age, gender, city, state, occupation, entity_type, source_reference)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'person', $8)
                ON CONFLICT (person_id) DO UPDATE SET
                    name = EXCLUDED.name, age = EXCLUDED.age, gender = EXCLUDED.gender,
                    city = EXCLUDED.city, state = EXCLUDED.state, occupation = EXCLUDED.occupation,
                    entity_type = EXCLUDED.entity_type, source_reference = EXCLUDED.source_reference
            `, [personKey(record.id), record.name, record.age, record.gender, record.city, record.state, record.occupation, sourceReference]);

            await client.query(`
                INSERT INTO cases (case_id, crime_type, case_description, case_date, location, arrest_status, source_reference, updated_at)
                VALUES ($1, $2, '', $3, $4, $5, $6, NOW())
                ON CONFLICT (case_id) DO UPDATE SET
                    crime_type = EXCLUDED.crime_type, case_date = EXCLUDED.case_date,
                    location = EXCLUDED.location, arrest_status = EXCLUDED.arrest_status,
                    source_reference = EXCLUDED.source_reference, updated_at = NOW()
            `, [caseKey(localCaseId), offence, date, location, arrestStatus, sourceReference]);

            await client.query(`
                INSERT INTO person_cases (person_id, case_id, relationship, source_reference, observed_at)
                VALUES ($1, $2, 'linked to incident', $3, NOW())
                ON CONFLICT (person_id, case_id) DO UPDATE SET
                    relationship = EXCLUDED.relationship, source_reference = EXCLUDED.source_reference
            `, [personKey(record.id), caseKey(localCaseId), sourceReference]);

            await addIdentifier(`I-${caseKey(localCaseId)}`, "case", `TM-${localCaseId}`, localCaseId);
            await addIdentifier(personKey(record.id), "phone_ref", `TM-${record.phone}`, record.phone);
            await addIdentifier(personKey(record.id), "vehicle", `TM-${record.vehicle}`, record.vehicle);

            for (const [connectedId, relationship] of record.links) {
                const targetId = memberIds.has(connectedId) ? personKey(connectedId) : externalKey(connectedId);
                await addConnection(personKey(record.id), targetId, relationship);
            }
        }

        await client.query("COMMIT");
        console.log(`Imported ${teamMemberRecords.length} Team Member records, ${teamMemberRecords.length} incidents, and ${externalIds.length} unresolved cross-team references.`);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

if (process.argv.includes("--import-team-member-data")) {
    ensureDatabase()
        .then(importTeamMemberDataset)
        .catch(error => {
            console.error("Team Member import failed; transaction rolled back:", error.message);
            process.exitCode = 1;
        })
        .finally(() => pool.end());
} else {
    ensureDatabase()
        .then(() => app.listen(port, () => {
            console.log(`NEXORA backend running at http://localhost:${port}`);
        }))
        .catch(error => {
            console.error("DATABASE INITIALIZATION ERROR:", error.message);
            process.exitCode = 1;
        });
}