const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


const authenticData = JSON.parse(
    fs.readFileSync(
        path.join(__dirname, "data", "authentic-data.json"),
        "utf8"
    )
);

const networkEntities = [
    {
        id: "P-001",
        name: "Synthetic Subject A",
        type: "person",
        risk: 87,
        links: 8
    },
    {
        id: "P-002",
        name: "Synthetic Subject B",
        type: "person",
        risk: 74,
        links: 5
    },
    {
        id: "V-014",
        name: "Vehicle Demo 14",
        type: "vehicle",
        risk: 62,
        links: 4
    },
    {
        id: "L-021",
        name: "Location Demo 21",
        type: "location",
        risk: 55,
        links: 6
    },
    {
        id: "C-148",
        name: "Case Demo 148",
        type: "case",
        risk: 81,
        links: 7
    },
    {
        id: "PH-032",
        name: "Phone Demo 32",
        type: "phone",
        risk: 69,
        links: 3
    }
];

const networkEdges = [
    ["P-001", "V-014"],
    ["P-001", "C-148"],
    ["P-002", "C-148"],
    ["P-002", "L-021"],
    ["V-014", "L-021"],
    ["C-148", "PH-032"]
];

const caseRows = [
    [
        "NX-2026-0148",
        "Human trafficking",
        "HIGH",
        "8",
        "Today, 09:42",
        "REVIEW"
    ],
    [
        "NX-2026-0137",
        "Recruitment pattern",
        "MEDIUM",
        "5",
        "Yesterday, 16:10",
        "OPEN"
    ],
    [
        "NX-2026-0119",
        "Cross-case link",
        "HIGH",
        "11",
        "18 Sep 2026",
        "REVIEW"
    ]
];

let ledgerBlocks = [
    "Evidence intake",
    "Pattern review",
    "Human validation"
].map((event, index, blocks) => {
    const previousHash = index
        ? blocks[index - 1].hash
        : "0";

    const hash = crypto
        .createHash("sha256")
        .update(`${index}:${event}:${previousHash}`)
        .digest("hex")
        .slice(0, 24);

    return {
        index,
        event,
        timestamp: new Date(
            Date.now() - (blocks.length - index) * 3600000
        ).toISOString(),
        previousHash,
        hash
    };
});

function ledgerIsValid() {
    return ledgerBlocks.every((block, index) => {
        const previousHash = index
            ? ledgerBlocks[index - 1].hash
            : "0";

        const expected = crypto
            .createHash("sha256")
            .update(
                `${block.index}:${block.event}:${previousHash}`
            )
            .digest("hex")
            .slice(0, 24);

        return (
            block.previousHash === previousHash &&
            block.hash === expected
        );
    });
}

const pool = new Pool({
    user: "postgres",
    host: "localhost",
    database: "Nexora_DB",
    password: "1234",
    port: 5432
});

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

app.get("/api/persons", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM persons ORDER BY person_id"
        );

        res.json(result.rows);
    } catch (error) {
        console.error("PERSONS ERROR:", error.message);

        res.status(500).json({
            error: "Database error",
            details: error.message
        });
    }
});

app.get("/api/overview", (req, res) => {
    res.json({
        metrics: {
            caseCount: caseRows.length,
            networkEntities: networkEntities.length,
            reviewLeads: caseRows.filter(row => row[5] === "REVIEW").length,
            evidenceBlocks: ledgerBlocks.length
        },

        authentic: {
            humanTrafficking2023:
                authenticData.humanTrafficking2023
        }
    });
});

app.post("/api/analyze", (req, res) => {
    const values = Object.values(req.body)
        .map(Number)
        .filter(Number.isFinite);

    const score = values.length
        ? Math.round(
            values.reduce(
                (sum, value) =>
                    sum + Math.max(0, Math.min(100, value)),
                0
            ) / values.length
        )
        : 0;

    res.json({
        score,

        level:
            score >= 75
                ? "ELEVATED"
                : score >= 45
                    ? "WATCH"
                    : "LOW",

        notice:
            "Correlation lead only. Human investigator validation required."
    });
});

app.get("/api/network", (req, res) => {
    res.json({
        entities: networkEntities,
        edges: networkEdges
    });
});

app.post("/api/entities", (req, res) => {
    const entity = {
        id: `E-${String(networkEntities.length + 1).padStart(3, "0")}`,
        name: req.body.name || "Unnamed entity",
        type: req.body.type || "event",
        risk: Number(req.body.risk) || 0,
        links: 0
    };

    networkEntities.push(entity);

    res.status(201).json(entity);
});

app.get("/api/cases", (req, res) => {
    res.json({
        cases: caseRows
    });
});

app.post("/api/cases", (req, res) => {
    const row = [
        `NX-2026-${String(150 + caseRows.length).padStart(4, "0")}`,
        "Investigator lead",
        req.body.priority || "MEDIUM",
        "0",
        "Just now",
        "OPEN"
    ];

    caseRows.unshift(row);

    res.status(201).json(row);
});

app.get("/api/ledger", (req, res) => {
    res.json({
        valid: ledgerIsValid(),
        blocks: ledgerBlocks
    });
});

app.post("/api/ledger/verify", (req, res) => {
    res.json({
        valid: ledgerIsValid()
    });
});

app.get("/api/sources", (req, res) => {
    res.json(authenticData.sources);
});

app.use((req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

const port =
    Number(process.env.NEXORA_PORT || process.env.PORT) || 3000;

app.listen(port, () => {
    console.log(
        `NEXORA backend running at http://localhost:${port}`
    );
});