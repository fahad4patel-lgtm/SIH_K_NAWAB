const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let state={network:null,cases:null,ledger:null};
let selectedEntityId=null;

async function api(url,opt={}){const r=await fetch(url,{headers:{"Content-Type":"application/json"},...opt});const data=await r.json();if(!r.ok)throw Error(data.error||("API "+r.status));return data}
function toast(t){const x=$("#toast");x.textContent=t;x.classList.add("show");setTimeout(()=>x.classList.remove("show"),1800)}
function go(id){$$('.page').forEach(x=>x.classList.toggle('active',x.id===id));$$('.nav').forEach(x=>x.classList.toggle('active',x.dataset.page===id));$('#pageTitle').textContent={sentinel:'Pattern Analysis',network:'Network Analysis',cases:'Incident Records',ledger:'Evidence Ledger',sources:'Data Sources'}[id];load(id)}
$$(".nav").forEach(b=>b.addEventListener("click",()=>go(b.dataset.page)));
$$("[data-go]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.go)));

function addStat(container,label,value){const item=document.createElement("div");item.className="analysisStat";const number=document.createElement("strong");number.textContent=value;const caption=document.createElement("span");caption.textContent=label;item.append(number,caption);container.appendChild(item)}
function addFinding(container,title,summary,evidence){const item=document.createElement("article");item.className="patternFinding";const heading=document.createElement("h3");heading.textContent=title;const detail=document.createElement("p");detail.textContent=summary;const list=document.createElement("ul");evidence.forEach(entry=>{const row=document.createElement("li");row.textContent=entry;list.appendChild(row)});item.append(heading,detail,list);container.appendChild(item)}
async function loadSentinel(){
 if(!state.network)state.network=await api("/api/network");
 const {entities,edgeDetails=[]}=state.network;
 const incidents=entities.filter(entity=>entity.type==="incident");
 const people=entities.filter(entity=>entity.type!=="incident");
 const stats=$("#analysisStats");stats.replaceChildren();
 addStat(stats,"ENTITY RECORDS",people.length);addStat(stats,"INCIDENT RECORDS",incidents.length);addStat(stats,"DOCUMENTED LINKS",edgeDetails.length);
 const results=$("#patternResults");results.replaceChildren();
 const byId=new Map(entities.map(entity=>[entity.id,entity]));
 const linkedIncidents=incidents.map(incident=>({incident,links:edgeDetails.filter(edge=>edge.source===incident.id||edge.target===incident.id)})).filter(group=>group.links.length>1);
 linkedIncidents.forEach(({incident,links})=>{
  const linked=links.map(edge=>byId.get(edge.source===incident.id?edge.target:edge.source)).filter(Boolean);
  const names=[...new Set(linked.map(entity=>entity.name))];
  const sources=links.map(edge=>`${edge.relationship}: ${edge.sourceReference||"source not recorded"}`);
  addFinding(results,"Shared incident record",`${incident.name} has documented links to ${names.length} other records (${names.join(", ")}). This is a record overlap, not evidence of joint conduct.`,sources);
 });
 const adjacency=new Map(entities.map(entity=>[entity.id,new Set()]));
 edgeDetails.forEach(edge=>{adjacency.get(edge.source)?.add(edge.target);adjacency.get(edge.target)?.add(edge.source)});
 const visited=new Set();let largest=[];
 entities.forEach(entity=>{if(visited.has(entity.id))return;const queue=[entity.id],component=[];visited.add(entity.id);while(queue.length){const id=queue.shift();component.push(id);adjacency.get(id).forEach(next=>{if(!visited.has(next)){visited.add(next);queue.push(next)}})}if(component.length>largest.length)largest=component});
 if(largest.length>1){const connected=largest.map(id=>byId.get(id)).filter(Boolean);addFinding(results,"Largest connected component",`${connected.length} records are connected by ${edgeDetails.filter(edge=>largest.includes(edge.source)&&largest.includes(edge.target)).length} recorded links. Components describe database structure only.`,connected.slice(0,8).map(entity=>`${entity.type}: ${entity.name}`))}
 if(!results.children.length){const empty=document.createElement("p");empty.className="emptyState";empty.textContent="No shared-incident clusters are visible in the recorded links yet.";results.appendChild(empty)}
}
function renderGraph(d){
 const g=$("#graph");g.innerHTML="";
 const width=Math.max(g.clientWidth,320),height=Math.max(g.clientHeight,520),nodeRadius=72;
 const positions=Object.fromEntries(d.entities.map((entity,index)=>{const angle=(index/d.entities.length)*Math.PI*2;return [entity.id,{x:width/2+Math.cos(angle)*width*.32,y:height/2+Math.sin(angle)*height*.32}] }));
 for(let iteration=0;iteration<150;iteration+=1){
    const forces=Object.fromEntries(d.entities.map(entity=>[entity.id,{x:0,y:0}]));
    for(let first=0;first<d.entities.length;first+=1){for(let second=first+1;second<d.entities.length;second+=1){const a=positions[d.entities[first].id],b=positions[d.entities[second].id];let dx=b.x-a.x,dy=b.y-a.y,dist=Math.max(1,Math.hypot(dx,dy));const force=9000/(dist*dist),fx=dx/dist*force,fy=dy/dist*force;forces[d.entities[first].id].x-=fx;forces[d.entities[first].id].y-=fy;forces[d.entities[second].id].x+=fx;forces[d.entities[second].id].y+=fy}}
    d.edges.forEach(([from,to])=>{const a=positions[from],b=positions[to];if(!a||!b)return;const dx=b.x-a.x,dy=b.y-a.y,dist=Math.max(1,Math.hypot(dx,dy)),force=(dist-190)*.012,fx=dx/dist*force,fy=dy/dist*force;forces[from].x+=fx;forces[from].y+=fy;forces[to].x-=fx;forces[to].y-=fy});
    d.entities.forEach(entity=>{const p=positions[entity.id],f=forces[entity.id];p.x=Math.max(nodeRadius,Math.min(width-nodeRadius,p.x+f.x+(width/2-p.x)*.018));p.y=Math.max(70,Math.min(height-70,p.y+f.y+(height/2-p.y)*.018))});
 }
 const stage=document.createElement("div");stage.className="graphStage";const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox",`0 0 ${width} ${height}`);svg.setAttribute("aria-hidden","true");stage.appendChild(svg);g.appendChild(stage);
 d.edges.forEach(([a,b])=>{const A=positions[a],B=positions[b];if(!A||!B)return;const line=document.createElementNS("http://www.w3.org/2000/svg","line");line.setAttribute("x1",A.x);line.setAttribute("y1",A.y);line.setAttribute("x2",B.x);line.setAttribute("y2",B.y);line.classList.add("edge");svg.appendChild(line)});
 d.entities.forEach(e=>{const p=positions[e.id]||{x:width/2,y:height/2};const n=document.createElement("div");n.className="node";n.dataset.type=e.type;n.style.left=p.x+"px";n.style.top=p.y+"px";const button=document.createElement("button");button.title=`Inspect ${e.type} record`;const dot=document.createElement("span");dot.className="dot";const name=document.createElement("b");name.textContent=e.name;const meta=document.createElement("small");meta.textContent=`${e.type.toUpperCase()} · ${e.links||0} links`;button.append(dot,name,meta);button.onclick=()=>selectEntity(e);n.appendChild(button);stage.appendChild(n)});
 let scale=1,offsetX=0,offsetY=0,isDragging=false,startX=0,startY=0;
 const updateTransform=()=>stage.style.transform=`translate(${offsetX}px,${offsetY}px) scale(${scale})`;
 g.onwheel=event=>{event.preventDefault();scale=Math.max(.65,Math.min(1.8,scale+(event.deltaY<0?.1:-.1)));updateTransform()};
 g.onpointerdown=event=>{if(event.target.closest("button"))return;isDragging=true;startX=event.clientX-offsetX;startY=event.clientY-offsetY;g.setPointerCapture(event.pointerId)};
 g.onpointermove=event=>{if(!isDragging)return;offsetX=event.clientX-startX;offsetY=event.clientY-startY;updateTransform()};
 g.onpointerup=()=>{isDragging=false};
 if(d.entities.length)selectEntity(d.entities[0]);
}
function selectEntity(e){
 selectedEntityId=e.id;$("#avatar").textContent=e.type[0].toUpperCase();$("#entityName").textContent=e.name;$("#entityType").textContent=e.type.toUpperCase();$("#links").textContent=e.links||0;
 const evidence=$("#entityEvidence");evidence.replaceChildren();
 if(e.sourceReference){const item=document.createElement("div");item.className="entityEvidenceItem";const title=document.createElement("b");title.textContent="Record source";const source=document.createElement("small");source.textContent=e.sourceReference;item.append(title,source);if(e.sourceUrl){const link=document.createElement("a");link.href=e.sourceUrl;link.target="_blank";link.rel="noreferrer";link.textContent="Open source";item.appendChild(link)}evidence.appendChild(item)}
 const related=(state.network?.edgeDetails||[]).filter(edge=>edge.source===e.id||edge.target===e.id);
 related.forEach(edge=>{
  const otherId=edge.source===e.id?edge.target:edge.source;const other=state.network.entities.find(entity=>entity.id===otherId);
  const item=document.createElement("div");item.className="entityEvidenceItem";const title=document.createElement("b");title.textContent=`${edge.relationship} · ${other?.name||otherId}`;const source=document.createElement("small");source.textContent=`Source: ${edge.sourceReference||"not recorded"}`;item.append(title,source);
  if(edge.sourceUrl){const link=document.createElement("a");link.href=edge.sourceUrl;link.target="_blank";link.rel="noreferrer";link.textContent="Open source";item.appendChild(link)}evidence.appendChild(item)
 });
 if(!related.length){const empty=document.createElement("small");empty.textContent="No documented links";evidence.appendChild(empty)}
}
async function loadNetwork(){if(!state.network)state.network=await api("/api/network");renderGraph(state.network)}
async function loadCases(){if(!state.cases)state.cases=await api("/api/cases");const rows=$("#caseRows");rows.replaceChildren();state.cases.incidents.forEach(incident=>{const row=document.createElement("tr");const values=[incident.id,incident.category,incident.location,new Date(incident.observedAt).toLocaleDateString(),incident.linkedEntities];values.forEach(value=>{const cell=document.createElement("td");cell.textContent=value??"—";row.appendChild(cell)});const sourceCell=document.createElement("td");if(incident.sourceUrl){const link=document.createElement("a");link.href=incident.sourceUrl;link.target="_blank";link.rel="noreferrer";link.textContent=incident.sourceReference;sourceCell.appendChild(link)}else{sourceCell.textContent=incident.sourceReference}row.appendChild(sourceCell);rows.appendChild(row)})}
async function loadLedger(){if(!state.ledger)state.ledger=await api("/api/ledger");$("#chain").textContent=state.ledger.valid?"✓ CHAIN VALID · SHA-256 CONTINUITY VERIFIED":"✕ CHAIN INVALID";$("#blocks").innerHTML=state.ledger.blocks.slice().reverse().map(b=>`<div class="block"><b>#${b.index}</b><code>${b.hash}</code><small>${new Date(b.timestamp).toLocaleTimeString()}</small></div>`).join("")}
async function loadSources(){const s=await api("/api/sources");$("#sourceCards").innerHTML=s.map(x=>`<a class="card source" href="${x.url}" target="_blank" rel="noreferrer"><label>${x.name}</label><p>${x.use}</p><div class="url">${x.url}</div></a>`).join("")}
async function load(id){try{if(id==="sentinel")await loadSentinel();if(id==="network")await loadNetwork();if(id==="cases")await loadCases();if(id==="ledger")await loadLedger();if(id==="sources")await loadSources()}catch(e){toast("Backend unavailable")}}
$("#refresh").onclick=()=>{state={};load($(".page.active").id);toast("Data refreshed")};
$("#verify").onclick=async()=>{const d=await api("/api/ledger/verify",{method:"POST"});toast(d.valid?"Ledger verified":"Ledger check failed");state.ledger=null;loadLedger()};
$("#trace").onclick=()=>{if(!selectedEntityId)return toast("Select a record first");const count=(state.network?.edgeDetails||[]).filter(edge=>edge.source===selectedEntityId||edge.target===selectedEntityId).length;toast(`${count} documented link${count===1?"":"s"} shown`)};
const relationshipDialog=$("#relationshipDialog"),relationshipForm=$("#relationshipForm");
function closeRelationshipDialog(){relationshipDialog.close()}
relationshipDialog.addEventListener("click",event=>{if(event.target===relationshipDialog)closeRelationshipDialog()});
$("#addRelationship").onclick=async()=>{try{if(!state.network)state.network=await api("/api/network");const options=state.network.entities.map(entity=>{const option=document.createElement("option");option.value=entity.id;option.textContent=`${entity.name} · ${entity.id}`;return option});["#relationshipSource","#relationshipTarget"].forEach(selector=>{const select=$(selector);select.replaceChildren(...options.map(option=>option.cloneNode(true)))});if(selectedEntityId)$("#relationshipSource").value=selectedEntityId;relationshipDialog.showModal()}catch(error){toast(error.message||"Could not load network records")}};
$("#closeRelationshipDialog").onclick=closeRelationshipDialog;$("#cancelRelationship").onclick=closeRelationshipDialog;
relationshipForm.onsubmit=async event=>{event.preventDefault();const submit=$("#saveRelationship");submit.disabled=true;submit.textContent="Saving…";try{const details=Object.fromEntries(new FormData(relationshipForm));await api("/api/network/relationships",{method:"POST",body:JSON.stringify(details)});closeRelationshipDialog();relationshipForm.reset();state.network=null;await loadNetwork();toast("Sourced link added to network")}catch(error){toast(error.message||"Link could not be saved")}finally{submit.disabled=false;submit.textContent="Save link"}};
const entityDialog=$("#entityDialog"),entityForm=$("#entityForm");
function closeEntityDialog(){entityDialog.close()}
entityDialog.addEventListener("click",event=>{if(event.target===entityDialog)closeEntityDialog()});
$("#addEntity").onclick=()=>entityDialog.showModal();
$("#closeEntityDialog").onclick=closeEntityDialog;$("#cancelEntity").onclick=closeEntityDialog;
entityForm.onsubmit=async event=>{event.preventDefault();const submit=$("#saveEntity");submit.disabled=true;submit.textContent="Saving…";try{const details=Object.fromEntries(new FormData(entityForm));await api("/api/entities",{method:"POST",body:JSON.stringify(details)});closeEntityDialog();entityForm.reset();state.network=null;await loadNetwork();toast("Sourced record added to network")}catch(error){toast(error.message||"Record could not be saved")}finally{submit.disabled=false;submit.textContent="Save record"}};
const caseDialog=$("#caseDialog"),caseForm=$("#caseForm");
function closeCaseDialog(){caseDialog.close()}
caseDialog.addEventListener("click",event=>{if(event.target===caseDialog)closeCaseDialog()});
$("#newCase").onclick=()=>{const date=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);$("#caseDate").value=date;caseDialog.showModal();$("#caseType").focus()};
$("#closeCaseDialog").onclick=closeCaseDialog;
$("#cancelCase").onclick=closeCaseDialog;
caseForm.onsubmit=async event=>{event.preventDefault();const submit=$("#saveCase");submit.disabled=true;submit.textContent="Saving…";try{const details=Object.fromEntries(new FormData(caseForm));await api("/api/cases",{method:"POST",body:JSON.stringify(details)});closeCaseDialog();caseForm.reset();state.cases=null;state.network=null;await loadCases();toast("Sourced incident added to network")}catch(error){toast(error.message||"Incident could not be saved")}finally{submit.disabled=false;submit.textContent="Save incident"}};
$(".user").onclick=()=>toast("Analyst workspace active");
load("network");
