import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {fileURLToPath} from "url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
app.use(cors());
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

const authentic=JSON.parse(fs.readFileSync(path.join(__dirname,"data/authentic-data.json"),"utf8"));

const db={
  entities:[
    {id:"P-001",type:"person",name:"Synthetic Subject A",risk:87,links:8},
    {id:"P-002",type:"person",name:"Synthetic Subject B",risk:72,links:5},
    {id:"V-014",type:"vehicle",name:"DEMO VEHICLE 014",risk:69,links:6},
    {id:"L-021",type:"location",name:"Pune Corridor",risk:63,links:9},
    {id:"C-148",type:"case",name:"DEMO-HT-0148",risk:82,links:7},
    {id:"PH-032",type:"phone",name:"REDACTED CONTACT 032",risk:61,links:4}
  ],
  edges:[
    ["P-001","V-014"],["P-001","C-148"],["P-001","PH-032"],["P-001","L-021"],
    ["P-002","C-148"],["P-002","L-021"],["V-014","L-021"],["V-014","P-002"],
    ["C-148","L-021"],["PH-032","C-148"]
  ],
  cases:[
    ["DEMO-HT-0148","Human trafficking","HIGH","12","11 min ago","Human review"],
    ["DEMO-CN-0921","Criminal network","HIGH","24","18 min ago","Review"],
    ["DEMO-HT-0137","Human trafficking","MEDIUM","7","42 min ago","Active"],
    ["DEMO-CN-0904","Organised crime","MEDIUM","16","1 hr ago","Investigating"]
  ]
};

function scoreModel(x={}){
  const w={travel:.25,recruitment:.22,location:.18,vehicle:.13,communication:.12,caseLink:.10};
  const defaults={travel:92,recruitment:84,location:78,vehicle:72,communication:68,caseLink:82};
  let score=0;
  for(const k of Object.keys(w)){
    const n=Math.max(0,Math.min(100,Number(x[k]??defaults[k])));
    score+=n*w[k];
  }
  return Math.round(score);
}

function makeBlock(index,previousHash,evidence){
  const timestamp=new Date().toISOString();
  const payload=JSON.stringify({index,timestamp,previousHash,evidence});
  const hash=crypto.createHash("sha256").update(payload).digest("hex");
  return {index,timestamp,previousHash,evidence,hash};
}
let chain=[];
let prev="GENESIS";
for(let i=1;i<=10;i++){const b=makeBlock(i,prev,`DEMO-EVIDENCE-${String(i).padStart(3,"0")}`);chain.push(b);prev=b.hash}

app.get("/api/health",(req,res)=>res.json({ok:true,service:"NEXUS",time:new Date().toISOString()}));
app.get("/api/overview",(req,res)=>res.json({
  authentic,
  metrics:{indiaCases2023:authentic.humanTrafficking2023.indiaCases,victims2023:authentic.humanTrafficking2023.indiaVictimsReported,ahtu2020:authentic.ahtu2020.indiaUnits,networkEntities:db.entities.length},
  notice:"Public statistics are authentic-source data. Network/person records are synthetic demo data."
}));
app.get("/api/network",(req,res)=>res.json({entities:db.entities,edges:db.edges}));
app.get("/api/cases",(req,res)=>res.json({cases:db.cases}));
app.get("/api/sources",(req,res)=>res.json(authentic.sources));
app.get("/api/ledger",(req,res)=>res.json({blocks:chain,valid:verifyChain()}));
app.post("/api/analyze",(req,res)=>{
  const score=scoreModel(req.body);
  const level=score>=80?"ELEVATED":score>=60?"WATCH":"LOW";
  const factors=Object.entries(req.body).map(([key,value])=>({key,value:Number(value)})).sort((a,b)=>b.value-a.value).slice(0,3);
  res.json({score,level,factors,notice:"This is a correlation-based investigative lead, not a criminality or victim-status determination."});
});
app.post("/api/entities",(req,res)=>{
  const id="DEMO-"+String(db.entities.length+1).padStart(3,"0");
  const entity={id,type:String(req.body.type||"event"),name:String(req.body.name||"Synthetic entity"),risk:Math.max(0,Math.min(100,Number(req.body.risk||30))),links:0};
  db.entities.push({...entity,id});
  res.status(201).json(entity);
});
app.post("/api/cases",(req,res)=>{
  const id="DEMO-CASE-"+Math.floor(1000+Math.random()*8999);
  const row=[id,"Human trafficking",req.body.priority||"MEDIUM","0","just now","Human review"];
  db.cases.unshift(row);
  res.status(201).json({id,row});
});
app.post("/api/ledger/verify",(req,res)=>res.json({valid:verifyChain(),checked:chain.length}));

function verifyChain(){
  let prev="GENESIS";
  for(const b of chain){
    const payload=JSON.stringify({index:b.index,timestamp:b.timestamp,previousHash:prev,evidence:b.evidence});
    const expected=crypto.createHash("sha256").update(payload).digest("hex");
    if(expected!==b.hash || b.previousHash!==prev)return false;
    prev=b.hash;
  }
  return true;
}
app.listen(process.env.PORT||3000,()=>console.log("NEXUS → http://localhost:"+(process.env.PORT||3000)));
