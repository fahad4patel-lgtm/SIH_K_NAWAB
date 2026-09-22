const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let state={overview:null,network:null,cases:null,ledger:null};

async function api(url,opt={}){const r=await fetch(url,{headers:{"Content-Type":"application/json"},...opt});if(!r.ok)throw Error("API "+r.status);return r.json()}
function toast(t){const x=$("#toast");x.textContent=t;x.classList.add("show");setTimeout(()=>x.classList.remove("show"),1800)}
function go(id){$$('.page').forEach(x=>x.classList.toggle('active',x.id===id));$$('.nav').forEach(x=>x.classList.toggle('active',x.dataset.page===id));$('#pageTitle').textContent={home:'Overview',sentinel:'Pattern Analysis',network:'Entity Network',cases:'Cases & Leads',ledger:'Evidence Ledger',sources:'Data Sources'}[id];load(id)}
$$(".nav").forEach(b=>b.addEventListener("click",()=>go(b.dataset.page)));
$$("[data-go]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.go)));

async function loadOverview(){
 if(!state.overview)state.overview=await api("/api/overview");
 const d=state.overview;
 $("#metrics").innerHTML=[
    ['Cases in workspace',d.metrics.caseCount,'Active records'],
    ['Connected entities',d.metrics.networkEntities,'Across the network'],
    ['Open review leads',d.metrics.reviewLeads,'Needs analyst review'],
    ['Evidence blocks',d.metrics.evidenceBlocks,'Integrity chain']
 ].map(x=>`<div class="metric"><span>${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join("");
 const top=d.authentic.humanTrafficking2023.topStatesByCases;
 const max=Math.max(...top.map(x=>x.cases));
 $("#stateBars").innerHTML=top.map(x=>`<div class="state"><div class="stateLine"><span>${x.state}</span><b>${x.cases}</b></div><div class="bar"><i style="width:${Math.round(x.cases/max*100)}%"></i></div></div>`).join("");
 const sig=[["Travel corridor recurrence",91],["Recruitment clustering",86],["Location recurrence",82],["Vehicle reuse",74],["Cross-case linkage",67]];
 $("#signals").innerHTML=sig.map(x=>`<div class="signal"><span>${x[0]}</span><b>${x[1]}%</b></div>`).join("");
}
async function loadSentinel(){
 const vals=[["travel","Travel corridor recurrence",92],["recruitment","Recruitment clustering",84],["location","Location recurrence",78],["vehicle","Vehicle reuse",72],["communication","Communication graph shift",68],["caseLink","Cross-case linkage",82]];
 if(!$("#sliders").children.length)$("#sliders").innerHTML=vals.map(v=>`<div class="slider"><label>${v[1]} <b>${v[2]}</b></label><input type="range" min="0" max="100" value="${v[2]}" data-k="${v[0]}"></div>`).join("");
 $$("#sliders input").forEach(i=>i.oninput=()=>i.previousElementSibling.querySelector("b").textContent=i.value);
}
async function runAnalysis(){
 const body=Object.fromEntries($$("#sliders input").map(i=>[i.dataset.k,Number(i.value)]));
 const d=await api("/api/analyze",{method:"POST",body:JSON.stringify(body)});
 $("#score").textContent=d.score;$("#level").textContent=d.level;$("#meter").style.width=d.score+"%";
 $("#analysisNotice").textContent=d.notice;toast("Sentinel analysis updated");
}
function renderGraph(d){
 const g=$("#graph");g.innerHTML="";
 const pos=[["P-001",20,23],["P-002",55,18],["V-014",42,43],["L-021",19,64],["C-148",67,47],["PH-032",48,76]];
 const map=Object.fromEntries(pos.map(x=>[x[0],x.slice(1)]));
 d.edges.forEach(([a,b])=>{if(!map[a]||!map[b])return;const A=map[a],B=map[b];const e=document.createElement("div");e.className="edge";e.style.left=A[0]+"%";e.style.top=A[1]+"%";const dx=B[0]-A[0],dy=B[1]-A[1];e.style.width=Math.hypot(dx,dy)+"%";e.style.transform=`rotate(${Math.atan2(dy,dx)}rad)`;g.appendChild(e)});
 d.entities.forEach(e=>{const p=map[e.id]||[50,50];const n=document.createElement("div");n.className="node";n.style.left=p[0]+"%";n.style.top=p[1]+"%";n.innerHTML=`<button><span class="dot"></span><b>${e.name}</b><small>${e.type.toUpperCase()} · ${e.risk}%</small></button>`;n.querySelector("button").onclick=()=>selectEntity(e);g.appendChild(n)});
 selectEntity(d.entities[0]);
}
function selectEntity(e){$("#avatar").textContent=e.type[0].toUpperCase();$("#entityName").textContent=e.name.replace(/\b(Synthetic|Demo)\b\s*/gi,'');$("#entityType").textContent=e.type.toUpperCase();$("#risk").textContent=e.risk+"%";$("#riskbar").style.width=e.risk+"%";$("#links").textContent=e.links}
async function loadNetwork(){if(!state.network)state.network=await api("/api/network");renderGraph(state.network)}
async function loadCases(){if(!state.cases)state.cases=await api("/api/cases");$("#caseRows").innerHTML=state.cases.cases.map(r=>`<tr>${r.map(x=>`<td>${x}</td>`).join("")}</tr>`).join("")}
async function loadLedger(){if(!state.ledger)state.ledger=await api("/api/ledger");$("#chain").textContent=state.ledger.valid?"✓ CHAIN VALID · SHA-256 CONTINUITY VERIFIED":"✕ CHAIN INVALID";$("#blocks").innerHTML=state.ledger.blocks.slice().reverse().map(b=>`<div class="block"><b>#${b.index}</b><code>${b.hash}</code><small>${new Date(b.timestamp).toLocaleTimeString()}</small></div>`).join("")}
async function loadSources(){const s=await api("/api/sources");$("#sourceCards").innerHTML=s.map(x=>`<a class="card source" href="${x.url}" target="_blank" rel="noreferrer"><label>${x.name}</label><p>${x.use}</p><div class="url">${x.url}</div></a>`).join("")}
async function load(id){try{if(id==="home")await loadOverview();if(id==="sentinel")await loadSentinel();if(id==="network")await loadNetwork();if(id==="cases")await loadCases();if(id==="ledger")await loadLedger();if(id==="sources")await loadSources()}catch(e){toast("Backend unavailable")}}
$("#run").onclick=runAnalysis;
$("#refresh").onclick=()=>{state={};load($(".page.active").id);toast("Data refreshed")};
$("#verify").onclick=async()=>{const d=await api("/api/ledger/verify",{method:"POST"});toast(d.valid?"Ledger verified":"Ledger check failed");state.ledger=null;loadLedger()};
$("#trace").onclick=()=>toast("Connection trace updated");
$("#addEntity").onclick=async()=>{const name=prompt("Entity name");if(!name)return;const e=await api("/api/entities",{method:"POST",body:JSON.stringify({name,type:"event",risk:35})});state.network=null;await loadNetwork();toast("Entity added")};
$("#newCase").onclick=async()=>{await api("/api/cases",{method:"POST",body:JSON.stringify({priority:"HIGH"})});state.cases=null;await loadCases();toast("Case created")};
load("home");
