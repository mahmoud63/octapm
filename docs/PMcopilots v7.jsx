import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";

/* ═══════════════════════════════════════════════════════════════════════
   PMcopilots — AI Construction Schedule Generator
   Version 2.0 — Full PM Suite
═══════════════════════════════════════════════════════════════════════ */

const PHASES = ["Preliminary & General","Earthworks & Foundations","Concrete Structure","Masonry & Blockwork","Roofing","External Works & Façade","Internal Finishes","Mechanical Services","Electrical Services","Specialist Systems","External Landscaping","Testing & Commissioning"];

const SAMPLE_BOQ = [
  {id:1,ref:"P&G-01",description:"Mobilization & Site Setup",unit:"LS",qty:1,rate:85000,amount:85000,section:"Preliminary & General"},
  {id:2,ref:"EW-01",description:"Site Clearing & Topsoil Removal",unit:"m²",qty:3200,rate:8,amount:25600,section:"Earthworks & Foundations"},
  {id:3,ref:"EW-02",description:"Bulk Excavation for Basement",unit:"m³",qty:4500,rate:22,amount:99000,section:"Earthworks & Foundations"},
  {id:4,ref:"EW-03",description:"Sheet Piling / Shoring",unit:"m²",qty:850,rate:145,amount:123250,section:"Earthworks & Foundations"},
  {id:5,ref:"EW-04",description:"Reinforced Concrete Raft Foundation",unit:"m³",qty:620,rate:420,amount:260400,section:"Earthworks & Foundations"},
  {id:6,ref:"STR-01",description:"Basement Retaining Walls (300mm RC)",unit:"m³",qty:320,rate:520,amount:166400,section:"Concrete Structure"},
  {id:7,ref:"STR-02",description:"Ground Floor Columns & Slab (RC)",unit:"m³",qty:333,rate:530,amount:176490,section:"Concrete Structure"},
  {id:8,ref:"STR-03",description:"Upper Floors Columns & Slabs (4 floors)",unit:"m³",qty:820,rate:495,amount:405900,section:"Concrete Structure"},
  {id:9,ref:"STR-04",description:"Roof Slab (200mm RC)",unit:"m³",qty:195,rate:495,amount:96525,section:"Concrete Structure"},
  {id:10,ref:"EXT-01",description:"Aluminum Curtain Wall System",unit:"m²",qty:2200,rate:385,amount:847000,section:"External Works & Façade"},
  {id:11,ref:"EXT-02",description:"External Glazing (DGU 8+12+6mm)",unit:"m²",qty:850,rate:280,amount:238000,section:"External Works & Façade"},
  {id:12,ref:"FIN-01",description:"Raised Access Floor System (600×600mm)",unit:"m²",qty:3800,rate:85,amount:323000,section:"Internal Finishes"},
  {id:13,ref:"FIN-02",description:"Suspended Ceiling Grid & Tile",unit:"m²",qty:4100,rate:72,amount:295200,section:"Internal Finishes"},
  {id:14,ref:"FIN-03",description:"Internal Painting (Emulsion 2 Coats)",unit:"m²",qty:16800,rate:12,amount:201600,section:"Internal Finishes"},
  {id:15,ref:"MEP-M01",description:"HVAC — Air Handling Units (AHU×8)",unit:"Nr",qty:8,rate:28000,amount:224000,section:"Mechanical Services"},
  {id:16,ref:"MEP-M02",description:"HVAC Ductwork (Galvanised Steel)",unit:"kg",qty:18500,rate:12,amount:222000,section:"Mechanical Services"},
  {id:17,ref:"MEP-M03",description:"Fire Fighting Sprinkler System",unit:"Nr",qty:980,rate:185,amount:181300,section:"Mechanical Services"},
  {id:18,ref:"MEP-E01",description:"Main LV Switchgear & Distribution",unit:"LS",qty:1,rate:185000,amount:185000,section:"Electrical Services"},
  {id:19,ref:"MEP-E02",description:"Power & Lighting Wiring",unit:"m",qty:42000,rate:8,amount:336000,section:"Electrical Services"},
  {id:20,ref:"MEP-E03",description:"LED Lighting Fixtures (Office)",unit:"Nr",qty:1850,rate:285,amount:527250,section:"Electrical Services"},
  {id:21,ref:"SPC-01",description:"Passenger Lifts (10-Person, 6-Stop × 3)",unit:"Nr",qty:3,rate:185000,amount:555000,section:"Specialist Systems"},
  {id:22,ref:"SPC-02",description:"Building Management System (BMS)",unit:"LS",qty:1,rate:285000,amount:285000,section:"Specialist Systems"},
  {id:23,ref:"LND-01",description:"External Paving & Hard Landscaping",unit:"m²",qty:1850,rate:65,amount:120250,section:"External Landscaping"},
  {id:24,ref:"TCH-01",description:"Testing, Commissioning & Handover",unit:"LS",qty:1,rate:85000,amount:85000,section:"Testing & Commissioning"},
];

const mkRow = () => ({id:Date.now()+Math.random(),ref:"",description:"",unit:"LS",qty:"",rate:"",amount:"",section:""});
const fmtUSD = n => n ? "$"+Number(n).toLocaleString("en-US",{maximumFractionDigits:0}) : "—";

/* ── Design tokens ── */
const C = {
  bg:"#040C1E",surface:"#081428",card:"#0C1B30",border:"#0F2040",border2:"#163060",
  blue:"#1E6BFF",blueL:"#4D8FFF",blueDim:"#0A2860",blueGlow:"rgba(30,107,255,0.2)",
  accent:"#00D4FF",gold:"#F59E0B",red:"#EF4444",green:"#22C55E",orange:"#F97316",
  purple:"#A855F7",teal:"#14B8A6",pink:"#EC4899",
  text:"#C0D4EE",textDim:"#3A5070",textMid:"#6A8AAA",white:"#EEF6FF",
};

/* ════════════════════════════════════════════════════════════════════
   SHARED UI PRIMITIVES
════════════════════════════════════════════════════════════════════ */
const Tag = ({children,style={}}) => (
  <span style={{display:"inline-block",padding:"2px 7px",borderRadius:20,fontSize:9,fontWeight:700,letterSpacing:"0.5px",...style}}>{children}</span>
);
const TagCrit  = ({children}) => <Tag style={{background:"#2D0808",color:"#F87171",border:"1px solid #5D1515"}}>{children}</Tag>;
const TagNear  = ({children}) => <Tag style={{background:"#2D1500",color:"#FB923C",border:"1px solid #5D3000"}}>{children}</Tag>;
const TagFree  = ({children}) => <Tag style={{background:"#0A2D15",color:"#4ADE80",border:"1px solid #155D30"}}>{children}</Tag>;
const TagMS    = ({children}) => <Tag style={{background:"#1A0D35",color:"#A855F7",border:"1px solid #4B1D8F"}}>{children}</Tag>;
const TagBlue  = ({children}) => <Tag style={{background:`${C.blue}1A`,color:C.blueL,border:`1px solid ${C.blue}44`}}>{children}</Tag>;
const TagGold  = ({children}) => <Tag style={{background:"#2D1E00",color:C.gold,border:"1px solid #5D3E00"}}>{children}</Tag>;

function FTag({tf,crit,ms}){
  if(ms) return <TagMS>MILESTONE</TagMS>;
  if(crit) return <TagCrit>CRITICAL</TagCrit>;
  if(tf!=null&&tf<=5) return <TagNear>TF {tf}d</TagNear>;
  return <TagFree>TF {tf??'—'}d</TagFree>;
}

const SectionTitle = ({icon,children}) => (
  <div style={{fontSize:10,fontWeight:700,color:C.blueL,letterSpacing:"2px",textTransform:"uppercase",marginBottom:12,paddingBottom:6,borderBottom:`1px solid ${C.border2}`,fontFamily:"'Sora','Segoe UI',sans-serif",display:"flex",alignItems:"center",gap:6}}>
    {icon && <span style={{fontSize:14}}>{icon}</span>}{children}
  </div>
);

/* ── CSS text ── */
const GLOBAL_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#040C1E}
input:focus,select:focus{border-color:#1E6BFF!important;outline:none!important}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:#040C1E}
::-webkit-scrollbar-thumb{background:#163060;border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:#1E6BFF55}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulseBlue{0%,100%{box-shadow:0 0 12px rgba(30,107,255,.15)}50%{box-shadow:0 0 28px rgba(30,107,255,.4)}}
@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes ping{0%{transform:scale(1);opacity:1}75%,100%{transform:scale(2);opacity:0}}
.gen-btn:hover{filter:brightness(1.1);transform:translateY(-1px);transition:all .15s}
.gen-btn:active{transform:translateY(0)}
.upload-zone:hover{border-color:#1E6BFF!important;background:rgba(30,107,255,.1)!important}
.row-hover:hover{background:#071A3B!important}
.tab-hover:hover{color:#7BB3FF!important}
.action-btn:hover{opacity:.85}
@media print{.no-print{display:none!important}.print-only{display:block!important}}
`;

/* ════════════════════════════════════════════════════════════════════
   P6-STYLE GANTT WITH DEPENDENCY ARROWS
════════════════════════════════════════════════════════════════════ */
const ROW_H = 30;
const BAR_H = 14;
const LABEL_W = 230;
const TIMESCALE_H = 36;

function P6Gantt({activities}) {
  const containerRef = useRef(null);
  const [hoveredId, setHoveredId] = useState(null);

  const validActs = (activities||[]).filter(a=>a.id && !a.isMilestone && a.earlyFinish >= a.earlyStart);
  const milestones = (activities||[]).filter(a=>a.isMilestone);

  const maxDay = Math.max(...(activities||[]).map(a=>a.earlyFinish||0), 10);
  const pxPerDay = 4;
  const chartW = maxDay * pxPerDay;
  const totalH = (activities||[]).length * ROW_H;

  // Index activities by id for fast lookup
  const actById = useMemo(()=>{
    const m={};
    (activities||[]).forEach((a,i)=>{ m[a.id]={...a,rowIdx:i}; });
    return m;
  },[activities]);

  // Compute bar left/right x positions
  const barX = a => a.earlyStart * pxPerDay;
  const barW = a => Math.max(8, a.duration * pxPerDay);
  const barY = rowIdx => TIMESCALE_H + rowIdx * ROW_H + (ROW_H - BAR_H) / 2;

  // Build dependency arrows
  const arrows = useMemo(()=>{
    const lines = [];
    (activities||[]).forEach(succ=>{
      if(!succ.predecessors) return;
      const preds = succ.predecessors.split(",").map(s=>s.trim()).filter(Boolean);
      preds.forEach(predStr=>{
        const [predId, depType="FS"] = predStr.split(/[\s-]/);
        const pred = actById[predId];
        if(!pred) return;
        const type = succ.depType || depType || "FS";
        const si = succ.rowIdx ?? (activities||[]).findIndex(a=>a.id===succ.id);
        const pi = pred.rowIdx ?? (activities||[]).findIndex(a=>a.id===predId);

        const sBarX = barX(succ);
        const sBarR = sBarX + barW(succ);
        const sBY   = TIMESCALE_H + si * ROW_H + ROW_H/2;
        const pBarX = barX(pred);
        const pBarR = pBarX + barW(pred);
        const pBY   = TIMESCALE_H + pi * ROW_H + ROW_H/2;

        let x1,y1,x2,y2,mid;
        if(type==="FS"){
          x1=pBarR; y1=pBY; x2=sBarX; y2=sBY;
          mid=Math.max(x1+6, (x1+x2)/2);
          lines.push({x1,y1,x2,y2,mid,type,id:`${pred.id}-${succ.id}`});
        } else if(type==="SS"){
          x1=pBarX; y1=pBY; x2=sBarX; y2=sBY;
          mid=Math.min(x1-6,(x1+x2)/2);
          lines.push({x1,y1,x2,y2,mid,type,id:`${pred.id}-${succ.id}`});
        } else if(type==="FF"){
          x1=pBarR; y1=pBY; x2=sBarR; y2=sBY;
          mid=Math.max(x1+6,(x1+x2)/2);
          lines.push({x1,y1,x2,y2,mid,type,id:`${pred.id}-${succ.id}`});
        } else {
          // SF
          x1=pBarX; y1=pBY; x2=sBarR; y2=sBY;
          lines.push({x1,y1,x2,y2,mid:(x1+x2)/2,type,id:`${pred.id}-${succ.id}`});
        }
      });
    });
    return lines;
  },[activities, actById]);

  // Arrow color by type
  const arrowColor = t => ({FS:"#3B82F6",SS:"#22C55E",FF:"#F59E0B",SF:"#A855F7"}[t]||"#3B82F6");

  // Month scale
  const monthTicks = useMemo(()=>{
    const ticks=[]; let d=0;
    while(d<=maxDay){ ticks.push(d); d+=22; }
    return ticks;
  },[maxDay]);

  return (
    <div style={{overflowX:"auto",overflowY:"auto",maxHeight:600,border:`1px solid ${C.border}`,borderRadius:8,background:C.surface}}>
      <div style={{display:"flex",minWidth:LABEL_W+chartW+40}}>
        {/* Left label column */}
        <div style={{width:LABEL_W,flexShrink:0,borderRight:`1px solid ${C.border2}`}}>
          {/* Header */}
          <div style={{height:TIMESCALE_H,display:"flex",alignItems:"center",padding:"0 10px",background:C.card,borderBottom:`1px solid ${C.border2}`}}>
            <span style={{fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",fontWeight:700}}>ACTIVITY NAME</span>
          </div>
          {(activities||[]).map((a,i)=>{
            const isCrit=a.critical===true||a.critical==="YES";
            const bg=a.isMilestone?"#12082B":isCrit?"#160808":i%2===0?"#080F22":C.surface;
            return (
              <div key={a.id||i}
                onMouseEnter={()=>setHoveredId(a.id)}
                onMouseLeave={()=>setHoveredId(null)}
                style={{height:ROW_H,display:"flex",alignItems:"center",padding:"0 8px 0 12px",background:hoveredId===a.id?"#0F2A50":bg,borderBottom:`1px solid ${C.border}`,cursor:"default",transition:"background .1s"}}>
                <div style={{display:"flex",alignItems:"center",gap:5,overflow:"hidden",width:"100%"}}>
                  {a.isMilestone && <span style={{color:C.purple,fontSize:10,flexShrink:0}}>◆</span>}
                  <span style={{
                    fontSize:10,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
                    color:a.isMilestone?C.purple:isCrit?"#F87171":C.text,
                    fontWeight:a.isMilestone||isCrit?600:400
                  }}>{a.name}</span>
                  {isCrit && <span style={{fontSize:7,color:"#F87171",flexShrink:0,marginLeft:"auto"}}>●</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Chart area */}
        <div style={{position:"relative",flexGrow:1}}>
          <svg width={chartW+40} height={TIMESCALE_H+totalH+10} style={{display:"block"}}>
            {/* Time scale background */}
            <rect x={0} y={0} width={chartW+40} height={TIMESCALE_H} fill={C.card}/>

            {/* Month tick lines & labels */}
            {monthTicks.map((d,i)=>(
              <g key={i}>
                <line x1={d*pxPerDay} y1={TIMESCALE_H} x2={d*pxPerDay} y2={TIMESCALE_H+totalH} stroke={C.border} strokeWidth={0.5}/>
                <text x={d*pxPerDay+3} y={TIMESCALE_H-18} fill={C.textDim} fontSize={8} fontFamily="monospace">M{i+1}</text>
                <text x={d*pxPerDay+3} y={TIMESCALE_H-6} fill={C.textDim} fontSize={7} fontFamily="monospace">d{d}</text>
              </g>
            ))}
            {/* Timescale bottom border */}
            <line x1={0} y1={TIMESCALE_H} x2={chartW+40} y2={TIMESCALE_H} stroke={C.border2} strokeWidth={1}/>

            {/* Row backgrounds */}
            {(activities||[]).map((_,i)=>(
              <rect key={i} x={0} y={TIMESCALE_H+i*ROW_H} width={chartW+40} height={ROW_H}
                fill={i%2===0?"#080F2288":"#0A142888"}/>
            ))}

            {/* Today line */}
            <line x1={30*pxPerDay} y1={TIMESCALE_H} x2={30*pxPerDay} y2={TIMESCALE_H+totalH}
              stroke="#F59E0B" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.7}/>
            <text x={30*pxPerDay+2} y={TIMESCALE_H+8} fill="#F59E0B" fontSize={7}>TODAY</text>

            {/* Dependency arrows */}
            <defs>
              {["FS","SS","FF","SF"].map(t=>(
                <marker key={t} id={`arrow-${t}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L6,3 z" fill={arrowColor(t)} opacity={0.8}/>
                </marker>
              ))}
            </defs>
            {arrows.map(ln=>{
              const clr=arrowColor(ln.type);
              // P6-style right-angle routing
              const path = ln.type==="FS"
                ? `M${ln.x1},${ln.y1} H${ln.mid} V${ln.y2} H${ln.x2}`
                : ln.type==="SS"
                ? `M${ln.x1},${ln.y1} H${ln.mid} V${ln.y2} H${ln.x2}`
                : `M${ln.x1},${ln.y1} H${ln.mid} V${ln.y2} H${ln.x2}`;
              return (
                <path key={ln.id} d={path} fill="none"
                  stroke={clr} strokeWidth={1.2} opacity={0.65}
                  markerEnd={`url(#arrow-${ln.type})`}/>
              );
            })}

            {/* Activity bars */}
            {(activities||[]).map((a,i)=>{
              const isCrit=a.critical===true||a.critical==="YES";
              const bx=barX(a), bw=barW(a), by=barY(i);
              const isHov=hoveredId===a.id;
              const barClr=a.isMilestone?C.purple:isCrit?C.red:C.blue;

              if(a.isMilestone){
                const mx=a.earlyStart*pxPerDay;
                return (
                  <g key={a.id||i}>
                    <polygon points={`${mx},${by+2} ${mx+7},${by+BAR_H/2} ${mx},${by+BAR_H-2} ${mx-7},${by+BAR_H/2}`}
                      fill={C.purple} opacity={isHov?1:0.85}/>
                  </g>
                );
              }
              return (
                <g key={a.id||i}
                  onMouseEnter={()=>setHoveredId(a.id)}
                  onMouseLeave={()=>setHoveredId(null)}>
                  {/* Float bar (total float) */}
                  {(a.totalFloat>0) && (
                    <rect x={bx+bw} y={by+3} width={a.totalFloat*pxPerDay} height={BAR_H-6}
                      fill={C.teal} opacity={0.15} rx={2}/>
                  )}
                  {/* Main bar */}
                  <rect x={bx} y={by} width={bw} height={BAR_H}
                    fill={barClr} opacity={isHov?1:0.82} rx={2}
                    style={{filter:isHov?`drop-shadow(0 0 4px ${barClr})`:"none"}}/>
                  {/* Stripe pattern for critical */}
                  {isCrit && (
                    <rect x={bx} y={by} width={bw} height={BAR_H}
                      fill="url(#critStripe)" opacity={0.15} rx={2}/>
                  )}
                  {/* Duration label if wide enough */}
                  {bw>30 && (
                    <text x={bx+bw/2} y={by+BAR_H/2+3.5} textAnchor="middle"
                      fill="#fff" fontSize={7.5} fontWeight={600} fontFamily="monospace"
                      style={{pointerEvents:"none"}}>
                      {a.duration}d
                    </text>
                  )}
                </g>
              );
            })}

            {/* Stripe pattern def */}
            <defs>
              <pattern id="critStripe" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
                <line x1={0} y1={0} x2={0} y2={6} stroke="#fff" strokeWidth={2}/>
              </pattern>
            </defs>
          </svg>
        </div>
      </div>

      {/* Legend */}
      <div style={{padding:"8px 14px",borderTop:`1px solid ${C.border}`,display:"flex",gap:16,flexWrap:"wrap",background:C.card}}>
        {[
          [C.red,"Critical Path","●"],
          [C.blue,"Non-Critical","●"],
          [C.purple,"Milestone","◆"],
          [C.teal,"Total Float","▬"],
          ["#3B82F6","FS Arrow","→"],
          ["#22C55E","SS Arrow","→"],
          ["#F59E0B","FF Arrow","→"],
          ["#F59E0B","Today","—"],
        ].map(([clr,lbl,sym])=>(
          <span key={lbl} style={{display:"flex",alignItems:"center",gap:4,fontSize:9,color:C.textMid}}>
            <span style={{color:clr,fontSize:11}}>{sym}</span>{lbl}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   EXPORT FUNCTIONS
════════════════════════════════════════════════════════════════════ */
function exportToExcel(schedule, proj) {
  if(!schedule) return;
  const wb = XLSX.utils.book_new();

  // Sheet 1: Master Schedule
  const schData = [
    ["WBS","Activity ID","Activity Name","Phase","Duration (d)","Early Start","Early Finish","Late Start","Late Finish","Total Float","Free Float","Critical","Milestone","Predecessors","Dep Type","Labor","Equipment","Materials","Subcontractor","Budget (USD)","Long Lead","Remarks"],
    ...(schedule.activities||[]).map(a=>[
      a.wbs,a.id,a.name,a.phase,a.duration,a.earlyStart,a.earlyFinish,a.lateStart,a.lateFinish,
      a.totalFloat,a.freeFloat,a.critical?"YES":"NO",a.isMilestone?"YES":"NO",
      a.predecessors,a.depType,a.labor,a.equipment,a.materials,a.subcontractor,
      a.budget,a.longLead?"YES":"NO",a.remarks
    ])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(schData), "Master Schedule");

  // Sheet 2: Critical Path
  const cpData = [
    ["Seq","Activity ID","Activity Name","Duration","Early Start","Early Finish","Why Critical"],
    ...(schedule.criticalPath||[]).map(c=>[c.seq,c.id,c.name,c.duration,c.earlyStart,c.earlyFinish,c.whyCritical])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cpData), "Critical Path");

  // Sheet 3: Risks
  const riskData = [
    ["Ref","Description","Probability","Impact","Severity","Mitigation"],
    ...(schedule.risks||[]).map(r=>[r.ref,r.description,r.probability,r.impact,r.severity,r.mitigation])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(riskData), "Risk Register");

  // Sheet 4: Assumptions
  const assData = [
    ["Ref","Title","Description","Impact"],
    ...(schedule.assumptions||[]).map(a=>[a.ref,a.title,a.description,a.impact])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(assData), "Assumptions");

  // Sheet 5: Long Lead
  const llData = [
    ["Item","Lead Weeks","Order By","Activity","Criticality","Risk"],
    ...(schedule.longLeadItems||[]).map(l=>[l.item,l.leadWeeks,l.orderBy,l.activity,l.criticality,l.risk])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(llData), "Long Lead Items");

  // Sheet 6: WBS
  const wbsData = [
    ["WBS Code","Level","Name","Duration","Budget","Activities","Responsible"],
    ...(schedule.wbs||[]).map(w=>[w.code,w.level,w.name,w.duration,w.budget,w.activities,w.responsible])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wbsData), "WBS");

  XLSX.writeFile(wb, `PMcopilots_Schedule_${proj.name.replace(/\s+/g,"_")}.xlsx`);
}

function exportToPDF(schedule, proj) {
  const w = window.open("","_blank");
  if(!w) { alert("Please allow popups to export PDF."); return; }
  const acts = (schedule?.activities||[]);
  const rows = acts.map(a=>{
    const crit=a.critical===true||a.critical==="YES";
    return `<tr style="background:${a.isMilestone?"#1a0d35":crit?"#1a0808":"#f8f9fa"}">
      <td>${a.wbs||""}</td><td>${a.id||""}</td>
      <td style="color:${a.isMilestone?"#7c3aed":crit?"#dc2626":"#111"}">${a.isMilestone?"◆ ":""}${a.name}</td>
      <td style="text-align:center">${a.isMilestone?"—":a.duration}</td>
      <td style="text-align:center">${a.earlyStart??""}</td>
      <td style="text-align:center">${a.earlyFinish??""}</td>
      <td style="text-align:center;color:${crit?"#dc2626":"#16a34a"}">${a.isMilestone?"MS":a.totalFloat??""}</td>
      <td style="color:${crit?"#dc2626":"#111"};font-weight:${crit?"700":"400"}">${crit?"CRITICAL":"—"}</td>
      <td>${a.predecessors||"—"}</td>
      <td style="text-align:right;color:#b45309">${a.budget?"$"+Number(a.budget).toLocaleString():"—"}</td>
    </tr>`;
  }).join("");

  const risks = (schedule?.risks||[]).map(r=>`<tr>
    <td>${r.ref}</td><td>${r.description}</td><td>${r.probability}</td><td>${r.impact}</td>
    <td style="font-weight:700;color:${r.severity==="HIGH"||r.severity==="CRITICAL"?"#dc2626":r.severity==="MEDIUM"?"#d97706":"#16a34a"}">${r.severity}</td>
    <td>${r.mitigation}</td></tr>`).join("");

  w.document.write(`<!DOCTYPE html><html><head><title>PMcopilots Schedule — ${proj.name}</title>
  <style>
    *{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:10px;color:#111;margin:20px}
    h1{font-size:18px;color:#1e3a8a;margin-bottom:4px}h2{font-size:12px;color:#1e3a8a;margin:16px 0 6px;border-bottom:2px solid #1e3a8a;padding-bottom:3px}
    .meta{color:#555;font-size:9px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:9px}
    th{background:#1e3a8a;color:#fff;padding:5px 6px;text-align:left;font-weight:700}
    td{padding:4px 6px;border-bottom:1px solid #e5e7eb}
    tr:hover{background:#f0f4ff}
    .stats{display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap}
    .stat{background:#f0f4ff;border:1px solid #bfdbfe;border-radius:6px;padding:8px 14px;text-align:center;min-width:100px}
    .stat-val{font-size:20px;font-weight:700;color:#1e40af}.stat-lbl{font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:1px}
    .crit{color:#dc2626;font-weight:700}.ms{color:#7c3aed;font-weight:700}
    @media print{body{margin:10px}}
  </style></head><body>
  <h1>PMcopilots — Construction Baseline Schedule</h1>
  <div class="meta">
    Project: <strong>${proj.name}</strong> &nbsp;|&nbsp; Type: ${proj.type} &nbsp;|&nbsp; Location: ${proj.location}<br>
    Start: ${schedule.projectSummary?.startDate} &nbsp;|&nbsp; End: ${schedule.projectSummary?.endDate} &nbsp;|&nbsp; Duration: ${schedule.projectSummary?.totalDuration} &nbsp;|&nbsp; Budget: $${Number(schedule.projectSummary?.totalBudget||0).toLocaleString()}<br>
    <em>Generated by PMcopilots AI Scheduler — ${new Date().toLocaleDateString()}</em>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-val">${schedule.projectSummary?.totalActivities||0}</div><div class="stat-lbl">Activities</div></div>
    <div class="stat"><div class="stat-val" style="color:#dc2626">${schedule.projectSummary?.criticalActivities||0}</div><div class="stat-lbl">Critical</div></div>
    <div class="stat"><div class="stat-val" style="color:#7c3aed">${schedule.projectSummary?.totalMilestones||0}</div><div class="stat-lbl">Milestones</div></div>
    <div class="stat"><div class="stat-val" style="color:#d97706">$${Number(schedule.projectSummary?.totalBudget||0).toLocaleString()}</div><div class="stat-lbl">Budget</div></div>
  </div>
  <h2>MASTER SCHEDULE</h2>
  <table><thead><tr><th>WBS</th><th>ID</th><th>Activity</th><th>Dur</th><th>ES</th><th>EF</th><th>TF</th><th>Status</th><th>Predecessors</th><th>Budget</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>RISK REGISTER</h2>
  <table><thead><tr><th>Ref</th><th>Description</th><th>Probability</th><th>Impact</th><th>Severity</th><th>Mitigation</th></tr></thead><tbody>${risks}</tbody></table>
  <script>window.onload=()=>{window.print()}</script></body></html>`);
  w.document.close();
}

/* ════════════════════════════════════════════════════════════════════
   PM DASHBOARD
════════════════════════════════════════════════════════════════════ */
function PMDashboard({schedule, proj}) {
  const [currentDay, setCurrentDay] = useState(30);
  const [blockers, setBlockers] = useState([{id:1,text:"",severity:"HIGH"}]);
  const [completedYesterday, setCompletedYesterday] = useState([]);
  const [activeSection, setActiveSection] = useState("overview");

  if(!schedule) return null;

  const acts       = schedule.activities || [];
  const critActs   = acts.filter(a=>a.critical===true||a.critical==="YES");
  const llItems    = schedule.longLeadItems || [];
  const risks      = schedule.risks || [];
  const milestones = schedule.milestones || [];
  const highRisks  = risks.filter(r=>r.severity==="HIGH"||r.severity==="CRITICAL");
  const totalDays  = Math.max(...acts.map(a=>a.earlyFinish||0),10);
  const totalBudget= schedule.projectSummary?.totalBudget || 1;

  /* ── Earned Value Metrics ─────────────────────────────────────── */
  // PV = sum of budgets for activities that should be done by currentDay (based on planned schedule)
  const PV = acts.filter(a=>!a.isMilestone && a.budget>0 && a.earlyFinish<=currentDay)
               .reduce((s,a)=>s+(a.budget||0),0);
  // EV = assume actual progress matches planned (simulation) with slight under-performance
  const performanceFactor = 0.92; // simulate 92% performance (realistic)
  const EV = PV * performanceFactor;
  // AC = actual cost = EV / CPI (assume CPI=0.95 to simulate slight overspend)
  const AC = EV / 0.95;
  const SPI = PV>0 ? EV/PV : 1;
  const CPI = AC>0 ? EV/AC : 1;
  const spiColor = SPI>=0.95?C.green:SPI>=0.85?C.gold:C.red;
  const cpiColor = CPI>=0.95?C.green:CPI>=0.85?C.gold:C.red;
  // Planned % complete vs actual
  const plannedPct = Math.min(100, Math.round((currentDay/totalDays)*100));
  const actualPct  = Math.min(100, Math.round(plannedPct * performanceFactor));
  const daysBehind = Math.round((plannedPct - actualPct) * totalDays / 100);
  // Projected finish
  const projectedFinish = SPI>0 ? Math.round(totalDays / SPI) : totalDays;
  const projectedDelta  = projectedFinish - totalDays;

  /* ── Activity categories ──────────────────────────────────────── */
  const activeNow     = acts.filter(a=>!a.isMilestone && a.earlyStart<=currentDay && a.earlyFinish>=currentDay);
  const startingIn7   = acts.filter(a=>!a.isMilestone && a.earlyStart>currentDay && a.earlyStart<=currentDay+7);
  const startingIn14  = acts.filter(a=>!a.isMilestone && a.earlyStart>currentDay+7 && a.earlyStart<=currentDay+14);
  const recentlyDone  = acts.filter(a=>!a.isMilestone && a.earlyFinish>=currentDay-5 && a.earlyFinish<currentDay);
  const nearCrit      = acts.filter(a=>!a.critical && !a.isMilestone && (a.totalFloat??99)<=5 && (a.totalFloat??99)>=0);

  /* ── S-Curve data points ──────────────────────────────────────── */
  const sCurvePoints = useMemo(()=>{
    const pts=[];
    for(let d=0;d<=totalDays;d+=Math.max(1,Math.round(totalDays/20))){
      const pv=acts.filter(a=>!a.isMilestone&&a.budget>0&&a.earlyFinish<=d).reduce((s,a)=>s+(a.budget||0),0);
      const planned=Math.round((d/totalDays)*100);
      const actual= d<=currentDay ? Math.round(planned*performanceFactor) : null;
      pts.push({d, planned, actual, pv, ev: d<=currentDay?pv*performanceFactor:null});
    }
    return pts;
  },[acts,totalDays,currentDay]);

  /* ── Float consumption trend (simulated weekly) ───────────────── */
  const floatTrend = useMemo(()=>{
    const weeks=[];
    for(let w=0;w<=Math.min(8,Math.round(currentDay/5));w++){
      const day=w*5;
      const avgF=acts.filter(a=>!a.isMilestone&&!a.critical&&a.earlyStart<=day).reduce((s,a,_,arr)=>s+(a.totalFloat||0)/arr.length,0);
      weeks.push({w,avgFloat:Math.max(0,Math.round(avgF*(1-w*0.04)))});
    }
    return weeks;
  },[acts,currentDay]);

  /* ── Procurement alerts ───────────────────────────────────────── */
  const procAlerts = llItems.map(ll=>{
    const daysUntil = (ll.leadWeeks||0)*5 - currentDay;
    return {...ll, daysUntil, urgent:daysUntil<=10, warning:daysUntil<=20&&daysUntil>10};
  }).sort((a,b)=>a.daysUntil-b.daysUntil);

  /* ── Milestones countdown ─────────────────────────────────────── */
  const upcomingMS = milestones.filter(m=>m.day>currentDay).sort((a,b)=>a.day-b.day);
  const nextMS     = upcomingMS[0];

  /* ── Health score ─────────────────────────────────────────────── */
  const healthScore = Math.max(0, Math.min(100,
    100
    - (SPI<0.85?15:SPI<0.95?7:0)
    - (CPI<0.85?15:CPI<0.95?7:0)
    - (highRisks.length * 5)
    - (nearCrit.length * 3)
    - (procAlerts.filter(p=>p.urgent).length * 8)
    - (daysBehind>5?10:daysBehind>2?5:0)
  ));
  const healthColor = healthScore>=75?C.green:healthScore>=50?C.gold:C.red;
  const healthLabel = healthScore>=75?"ON TRACK":healthScore>=50?"AT RISK":"CRITICAL";

  /* ── Mini SVG chart helper ────────────────────────────────────── */
  const MiniLineChart = ({data,keys,colors,h=80,label}) => {
    const W=300, H=h;
    const maxY=Math.max(...data.flatMap(d=>keys.map(k=>d[k]??0)),1);
    const toX=(i)=>W/Math.max(data.length-1,1)*i;
    const toY=(v)=>H-4-(v/maxY)*(H-12);
    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
        <defs>{keys.map((k,i)=>(
          <linearGradient key={k} id={`grad-${k}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors[i]} stopOpacity="0.25"/>
            <stop offset="100%" stopColor={colors[i]} stopOpacity="0"/>
          </linearGradient>
        ))}</defs>
        {/* Grid lines */}
        {[0,25,50,75,100].map(v=>(
          <line key={v} x1={0} y1={toY(v)} x2={W} y2={toY(v)} stroke={C.border} strokeWidth={0.5}/>
        ))}
        {/* Area + line per key */}
        {keys.map((k,ki)=>{
          const pts=data.map((d,i)=>d[k]!=null?[toX(i),toY(d[k])]:null).filter(Boolean);
          if(pts.length<2) return null;
          const linePath=pts.map((p,i)=>`${i===0?"M":"L"}${p[0]},${p[1]}`).join(" ");
          const areaPath=linePath+` L${pts[pts.length-1][0]},${H} L${pts[0][0]},${H} Z`;
          return (
            <g key={k}>
              <path d={areaPath} fill={`url(#grad-${k})`}/>
              <path d={linePath} fill="none" stroke={colors[ki]} strokeWidth={1.5}/>
              {pts.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r={2} fill={colors[ki]}/>)}
            </g>
          );
        })}
      </svg>
    );
  };

  /* ── AlertCard ────────────────────────────────────────────────── */
  const AlertCard = ({icon,title,body,severity="info",action}) => {
    const colors = {
      info: [C.blue,"#040E28",`${C.blue}33`],
      warn: [C.gold,"#1A0C00","#92400E44"],
      crit: [C.red,"#1A0505","#7F1D1D44"],
      ok:   [C.green,"#061A0E","#16653444"]
    };
    const [clr,bg,br] = colors[severity]||colors.info;
    return (
      <div style={{background:bg,border:`1px solid ${br}`,borderRadius:9,padding:"9px 12px",display:"flex",gap:9,alignItems:"flex-start",marginBottom:7}}>
        <span style={{fontSize:15,flexShrink:0,marginTop:1}}>{icon}</span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{color:clr,fontWeight:700,fontSize:10,marginBottom:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{title}</div>
          <div style={{color:C.textMid,fontSize:9,lineHeight:1.5}}>{body}</div>
        </div>
        {action&&<span style={{fontSize:9,color:clr,flexShrink:0,marginTop:1,cursor:"pointer",textDecoration:"underline"}}>{action}</span>}
      </div>
    );
  };

  /* ── MetricCard ───────────────────────────────────────────────── */
  const MetricCard = ({label,value,sub,color=C.blueL,trend,badge}) => (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
      <div style={{fontSize:8,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:4}}>{label}</div>
      <div style={{fontSize:22,fontWeight:800,color,fontFamily:"'Sora','Segoe UI',sans-serif",lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:8,color:C.textDim,marginTop:3}}>{sub}</div>}
      {trend!=null&&<div style={{fontSize:9,color:trend>=0?C.green:C.red,marginTop:2,fontWeight:700}}>{trend>=0?"▲":"▼"} {Math.abs(trend)}</div>}
      {badge&&<div style={{marginTop:5,display:"inline-block",padding:"1px 7px",borderRadius:20,fontSize:8,fontWeight:700,background:`${color}1A`,color,border:`1px solid ${color}44`}}>{badge}</div>}
    </div>
  );

  /* ── Section nav pills ────────────────────────────────────────── */
  const sections = [
    {k:"overview",l:"📊 Overview"},
    {k:"ev",l:"💰 Earned Value"},
    {k:"scurve",l:"📈 S-Curve"},
    {k:"critical",l:"🔴 Critical Path"},
    {k:"lookahead",l:"🔭 2-Week Look-Ahead"},
    {k:"milestones",l:"◆ Milestones"},
    {k:"procurement",l:"📦 Procurement"},
    {k:"resources",l:"👷 Resources"},
    {k:"pulse",l:"📋 Daily Pulse"},
    {k:"alerts",l:"🚨 Alerts"},
  ];

  return (
    <div style={{animation:"fadeUp .4s ease"}}>

      {/* ── TOP: Day simulator bar ── */}
      <div style={{background:`linear-gradient(90deg,#071A40,${C.card})`,border:`1px solid ${C.blue}33`,borderRadius:11,padding:"12px 16px",marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7,flexWrap:"wrap",gap:8}}>
          <span style={{fontSize:10,color:C.blueL,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",fontFamily:"'Sora','Segoe UI',sans-serif"}}>
            📅 Project Day Simulator
          </span>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontSize:12,color:C.gold,fontWeight:700}}>Day {currentDay} / {totalDays}</span>
            <span style={{fontSize:10,color:C.textMid}}>·</span>
            <span style={{fontSize:10,color:C.textMid}}>Planned: <strong style={{color:C.blueL}}>{plannedPct}%</strong></span>
            <span style={{fontSize:10,color:C.textMid}}>·</span>
            <span style={{fontSize:10,color:C.textMid}}>Actual: <strong style={{color:actualPct<plannedPct?C.orange:C.green}}>{actualPct}%</strong></span>
            {daysBehind>0&&<span style={{padding:"2px 8px",borderRadius:20,fontSize:9,fontWeight:700,background:"#2D1500",color:C.orange,border:"1px solid #5D3000"}}>{daysBehind}d behind</span>}
            {daysBehind<=0&&<span style={{padding:"2px 8px",borderRadius:20,fontSize:9,fontWeight:700,background:"#0A2D15",color:C.green,border:"1px solid #155D30"}}>On track</span>}
          </div>
        </div>
        <div style={{position:"relative",height:6,background:C.surface,borderRadius:3,overflow:"visible"}}>
          <div style={{height:"100%",width:`${plannedPct}%`,background:`${C.blue}44`,borderRadius:3,position:"absolute",top:0,left:0}}/>
          <div style={{height:"100%",width:`${actualPct}%`,background:C.blue,borderRadius:3,position:"absolute",top:0,left:0,transition:"width .5s"}}/>
        </div>
        <input type="range" min={0} max={totalDays} value={currentDay}
          onChange={e=>setCurrentDay(+e.target.value)}
          style={{width:"100%",marginTop:6,accentColor:C.blue,cursor:"pointer"}}/>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:C.textDim,marginTop:1}}>
          <span>Day 0 — Start</span>
          {[25,50,75].map(p=><span key={p}>Day {Math.round(totalDays*p/100)}</span>)}
          <span>Day {totalDays} — Finish</span>
        </div>
      </div>

      {/* ── KPI STRIP — always visible ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:8,marginBottom:12}}>
        {/* Health */}
        <div style={{background:C.card,border:`1px solid ${healthColor}44`,borderRadius:10,padding:"10px",textAlign:"center",gridColumn:"span 1"}}>
          <div style={{fontSize:8,color:C.textDim,letterSpacing:"1px",textTransform:"uppercase",marginBottom:3}}>Health</div>
          <div style={{fontSize:24,fontWeight:900,color:healthColor,fontFamily:"'Sora','Segoe UI',sans-serif",lineHeight:1}}>{healthScore}</div>
          <div style={{fontSize:8,color:healthColor,fontWeight:700,marginTop:2}}>{healthLabel}</div>
          <div style={{marginTop:5,height:3,background:C.surface,borderRadius:2,overflow:"hidden"}}>
            <div style={{width:`${healthScore}%`,height:"100%",background:healthColor,transition:"width .5s"}}/>
          </div>
        </div>
        <MetricCard label="SPI" value={SPI.toFixed(2)} sub="Schedule Perf." color={spiColor} badge={SPI>=1?"AHEAD":SPI>=0.9?"ON TRACK":"BEHIND"}/>
        <MetricCard label="CPI" value={CPI.toFixed(2)} sub="Cost Perf." color={cpiColor} badge={CPI>=1?"UNDER BUDGET":CPI>=0.9?"ON BUDGET":"OVER BUDGET"}/>
        <MetricCard label="Active" value={activeNow.length} sub="in progress" color={C.blueL}/>
        <MetricCard label="Near-Crit" value={nearCrit.length} sub="float ≤5d" color={nearCrit.length>0?C.orange:C.green}/>
        <MetricCard label="Proj. Finish" value={`d${projectedFinish}`} sub={projectedDelta>0?`+${projectedDelta}d late`:projectedDelta<0?`${projectedDelta}d early`:"On time"} color={projectedDelta>5?C.red:projectedDelta>0?C.gold:C.green}/>
        <MetricCard label="Next MS" value={nextMS?`d${nextMS.day}`:"—"} sub={nextMS?nextMS.name.slice(0,16)+"…":"No upcoming"} color={C.purple}/>
        <MetricCard label="Procurement" value={procAlerts.filter(p=>p.urgent).length} sub="urgent orders" color={procAlerts.filter(p=>p.urgent).length>0?C.red:C.green}/>
      </div>

      {/* ── Section navigation ── */}
      <div style={{display:"flex",gap:5,marginBottom:12,overflowX:"auto",paddingBottom:4,flexWrap:"wrap"}}>
        {sections.map(({k,l})=>(
          <button key={k} onClick={()=>setActiveSection(k)}
            style={{padding:"5px 11px",borderRadius:20,border:`1px solid ${activeSection===k?C.blue:C.border}`,background:activeSection===k?`${C.blue}22`:C.surface,color:activeSection===k?C.blueL:C.textDim,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"'Sora','Segoe UI',sans-serif",letterSpacing:"0.5px",whiteSpace:"nowrap",transition:"all .15s"}}>
            {l}
          </button>
        ))}
      </div>

      {/* ══════════════════════════ OVERVIEW ══════════════════════════ */}
      {activeSection==="overview" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          {/* Left: Status summary */}
          <div>
            <SectionTitle icon="📊">Project Status Summary</SectionTitle>
            {[
              ["Overall % Complete (Planned)",`${plannedPct}%`,C.blueL],
              ["Overall % Complete (Actual)",`${actualPct}%`,actualPct<plannedPct?C.orange:C.green],
              ["Days Behind Schedule",daysBehind>0?`${daysBehind} days`:"On Track",daysBehind>0?C.orange:C.green],
              ["Projected Finish",`Day ${projectedFinish}`,projectedDelta>5?C.red:projectedDelta>0?C.gold:C.green],
              ["Budget Spent (EV)",`$${Math.round(EV).toLocaleString()}`,C.gold],
              ["Actual Cost (AC)",`$${Math.round(AC).toLocaleString()}`,CPI<0.95?C.red:C.green],
              ["SPI — Schedule Performance Index",SPI.toFixed(3),spiColor],
              ["CPI — Cost Performance Index",CPI.toFixed(3),cpiColor],
            ].map(([k,v,c])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"7px 10px",borderRadius:6,marginBottom:4,background:C.surface,border:`1px solid ${C.border}`}}>
                <span style={{fontSize:10,color:C.textMid}}>{k}</span>
                <span style={{fontSize:11,fontWeight:700,color:c}}>{v}</span>
              </div>
            ))}
          </div>

          {/* Right: float trend mini + milestone next */}
          <div>
            <SectionTitle icon="📉">Float Consumption Trend</SectionTitle>
            <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",marginBottom:12}}>
              <MiniLineChart data={floatTrend} keys={["avgFloat"]} colors={[C.teal]} h={70}/>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:C.textDim,marginTop:4}}>
                <span>Week 0</span><span>Week {floatTrend.length-1}</span>
              </div>
              <div style={{fontSize:9,color:C.textDim,marginTop:4}}>Average float across non-critical activities. Declining = schedule tightening.</div>
            </div>

            <SectionTitle icon="◆">Next Milestone Countdown</SectionTitle>
            {nextMS ? (
              <div style={{background:"#12082B",border:`1px solid ${C.purple}44`,borderRadius:9,padding:"12px 14px"}}>
                <div style={{fontSize:14,fontWeight:700,color:C.purple,marginBottom:4}}>{nextMS.name}</div>
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
                  <span style={{fontSize:28,fontWeight:900,color:C.purple,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{nextMS.day-currentDay}</span>
                  <span style={{fontSize:10,color:C.textDim}}>working days away<br/>(Day {nextMS.day})</span>
                </div>
                <div style={{height:4,background:C.surface,borderRadius:2,overflow:"hidden"}}>
                  <div style={{width:`${Math.min(100,(currentDay/nextMS.day)*100)}%`,height:"100%",background:C.purple,transition:"width .5s"}}/>
                </div>
                <div style={{fontSize:9,color:C.textDim,marginTop:4}}>{nextMS.description}</div>
              </div>
            ) : <div style={{color:C.textDim,fontSize:10,padding:"10px 0"}}>All milestones completed.</div>}
          </div>
        </div>
      )}

      {/* ══════════════════════════ EARNED VALUE ══════════════════════ */}
      {activeSection==="ev" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
            {[
              ["Planned Value (PV)",`$${Math.round(PV).toLocaleString()}`,"Budget for work planned to date",C.blue],
              ["Earned Value (EV)",`$${Math.round(EV).toLocaleString()}`,"Value of work actually completed",C.green],
              ["Actual Cost (AC)",`$${Math.round(AC).toLocaleString()}`,"What you've actually spent",AC>EV?C.red:C.green],
              ["Schedule Variance (SV)",`$${Math.round(EV-PV).toLocaleString()}`,EV>=PV?"Ahead of schedule":"Behind schedule",EV>=PV?C.green:C.red],
              ["Cost Variance (CV)",`$${Math.round(EV-AC).toLocaleString()}`,EV>=AC?"Under budget":"Over budget",EV>=AC?C.green:C.red],
              ["Estimate at Completion",`$${Math.round(totalBudget/Math.max(CPI,0.01)).toLocaleString()}`,"Projected total cost",CPI<0.9?C.red:CPI<0.97?C.gold:C.green],
            ].map(([k,v,sub,c])=>(
              <div key={k} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"13px 15px"}}>
                <div style={{fontSize:9,color:C.textDim,letterSpacing:"1px",textTransform:"uppercase",marginBottom:5}}>{k}</div>
                <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif",marginBottom:3}}>{v}</div>
                <div style={{fontSize:9,color:C.textMid}}>{sub}</div>
              </div>
            ))}
          </div>

          {/* SPI / CPI gauge bars */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {[["Schedule Performance Index (SPI)",SPI,spiColor,"SPI < 1.0 = behind schedule · SPI > 1.0 = ahead"],
              ["Cost Performance Index (CPI)",CPI,cpiColor,"CPI < 1.0 = over budget · CPI > 1.0 = under budget"]
            ].map(([label,val,clr,hint])=>(
              <div key={label} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,padding:"13px 15px"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:10,color:C.textMid,fontWeight:600}}>{label}</span>
                  <span style={{fontSize:18,fontWeight:800,color:clr,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{val.toFixed(3)}</span>
                </div>
                <div style={{height:12,background:C.card,borderRadius:6,overflow:"hidden",position:"relative"}}>
                  {/* 1.0 baseline */}
                  <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:2,background:C.border2,zIndex:2}}/>
                  <div style={{width:`${Math.min(100,val*50)}%`,height:"100%",background:clr,transition:"width .5s",borderRadius:6}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:C.textDim,marginTop:3}}>
                  <span>0.0</span><span>1.0 baseline</span><span>2.0</span>
                </div>
                <div style={{fontSize:9,color:C.textDim,marginTop:5}}>{hint}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════ S-CURVE ═══════════════════════════ */}
      {activeSection==="scurve" && (
        <div>
          <SectionTitle icon="📈">S-Curve — Planned vs Actual % Complete</SectionTitle>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 16px",marginBottom:12}}>
            <svg width="100%" viewBox="0 0 600 200" style={{overflow:"visible"}}>
              <defs>
                <linearGradient id="planGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.blue} stopOpacity="0.3"/>
                  <stop offset="100%" stopColor={C.blue} stopOpacity="0.02"/>
                </linearGradient>
                <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.green} stopOpacity="0.35"/>
                  <stop offset="100%" stopColor={C.green} stopOpacity="0.02"/>
                </linearGradient>
              </defs>
              {/* Grid */}
              {[0,25,50,75,100].map(v=>(
                <g key={v}>
                  <line x1={40} y1={180-(v/100)*160} x2={590} y2={180-(v/100)*160} stroke={C.border} strokeWidth={0.7}/>
                  <text x={35} y={180-(v/100)*160+3} textAnchor="end" fill={C.textDim} fontSize={8}>{v}%</text>
                </g>
              ))}
              {/* X axis ticks */}
              {sCurvePoints.filter((_,i)=>i%4===0).map((p,i)=>(
                <text key={i} x={40+(p.d/totalDays)*550} y={195} textAnchor="middle" fill={C.textDim} fontSize={7}>d{p.d}</text>
              ))}
              {/* Planned area */}
              {sCurvePoints.length>1&&(()=>{
                const pts=sCurvePoints.map(p=>[40+(p.d/totalDays)*550, 180-(p.planned/100)*160]);
                const linePath=pts.map((p,i)=>`${i===0?"M":"L"}${p[0]},${p[1]}`).join(" ");
                const areaPath=linePath+` L${pts[pts.length-1][0]},180 L40,180 Z`;
                return <>
                  <path d={areaPath} fill="url(#planGrad)"/>
                  <path d={linePath} fill="none" stroke={C.blue} strokeWidth={1.8} strokeDasharray="5,3"/>
                </>;
              })()}
              {/* Actual line (up to currentDay) */}
              {(()=>{
                const pts=sCurvePoints.filter(p=>p.actual!=null).map(p=>[40+(p.d/totalDays)*550, 180-(p.actual/100)*160]);
                if(pts.length<2) return null;
                const linePath=pts.map((p,i)=>`${i===0?"M":"L"}${p[0]},${p[1]}`).join(" ");
                const areaPath=linePath+` L${pts[pts.length-1][0]},180 L40,180 Z`;
                return <>
                  <path d={areaPath} fill="url(#actGrad)"/>
                  <path d={linePath} fill="none" stroke={C.green} strokeWidth={2.2}/>
                  {pts.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill={C.green}/>)}
                </>;
              })()}
              {/* Today line */}
              <line x1={40+(currentDay/totalDays)*550} y1={15} x2={40+(currentDay/totalDays)*550} y2={180} stroke={C.gold} strokeWidth={1.5} strokeDasharray="4,3"/>
              <text x={40+(currentDay/totalDays)*550+3} y={28} fill={C.gold} fontSize={8}>TODAY</text>
              {/* Legend */}
              <g>
                <line x1={450} y1={12} x2={470} y2={12} stroke={C.blue} strokeWidth={2} strokeDasharray="5,3"/>
                <text x={473} y={15} fill={C.textMid} fontSize={8}>Planned</text>
                <line x1={520} y1={12} x2={540} y2={12} stroke={C.green} strokeWidth={2}/>
                <text x={543} y={15} fill={C.textMid} fontSize={8}>Actual</text>
              </g>
            </svg>
          </div>

          <SectionTitle icon="📉">SPI Weekly Trend</SectionTitle>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,padding:"12px 14px"}}>
            <div style={{display:"flex",gap:8,alignItems:"flex-end",height:60}}>
              {floatTrend.map((pt,i)=>{
                const spiEst=Math.max(0.7,1-(i*0.01));
                const h=Math.round(spiEst*50);
                const clr=spiEst>=0.95?C.green:spiEst>=0.85?C.gold:C.red;
                return (
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                    <span style={{fontSize:7,color:clr}}>{spiEst.toFixed(2)}</span>
                    <div style={{width:"100%",height:h,background:clr,borderRadius:"3px 3px 0 0",opacity:.8}}/>
                    <span style={{fontSize:7,color:C.textDim}}>W{pt.w}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════ CRITICAL PATH ═════════════════════ */}
      {activeSection==="critical" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div>
              <SectionTitle icon="🔴">CP Activities — Live Status</SectionTitle>
              <div style={{maxHeight:420,overflowY:"auto"}}>
                {critActs.filter(a=>!a.isMilestone).map((a,i)=>{
                  const status=a.earlyFinish<currentDay?"DONE":a.earlyStart<=currentDay?"IN PROGRESS":"NOT STARTED";
                  const pct=status==="DONE"?100:status==="IN PROGRESS"?Math.min(99,Math.round(((currentDay-a.earlyStart)/a.duration)*100)):0;
                  const slipping=status==="IN PROGRESS"&&pct<Math.round(((currentDay-a.earlyStart)/a.duration)*100)-5;
                  return (
                    <div key={i} style={{background:"#160808",border:`1px solid ${slipping?"#F871714D":"#5D151533"}`,borderRadius:8,padding:"9px 12px",marginBottom:6}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,gap:6}}>
                        <span style={{fontSize:10,color:"#F87171",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{a.name}</span>
                        <div style={{display:"flex",gap:5,flexShrink:0}}>
                          {slipping&&<span style={{fontSize:8,color:C.red,fontWeight:700,background:"#2D0808",padding:"1px 5px",borderRadius:10}}>SLIPPING</span>}
                          <span style={{fontSize:9,color:status==="DONE"?C.green:status==="IN PROGRESS"?C.gold:C.textDim,fontWeight:700}}>{status}</span>
                        </div>
                      </div>
                      <div style={{height:5,background:C.surface,borderRadius:3,overflow:"hidden",marginBottom:4}}>
                        <div style={{width:`${pct}%`,height:"100%",background:status==="DONE"?C.green:slipping?C.red:C.gold,transition:"width .5s",borderRadius:3}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:C.textDim}}>
                        <span>{a.wbs} · d{a.earlyStart}→d{a.earlyFinish}</span>
                        <span>{pct}% complete</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <SectionTitle icon="🔶">Near-Critical Activities (Float ≤ 5d)</SectionTitle>
              {nearCrit.length===0
                ? <div style={{color:C.green,fontSize:10,padding:"10px 0"}}>✅ No near-critical activities — good schedule buffer.</div>
                : nearCrit.map((a,i)=>(
                  <div key={i} style={{background:"#160A00",border:"1px solid #5D300044",borderRadius:8,padding:"9px 12px",marginBottom:6}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:10,color:C.orange,fontWeight:600,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span>
                      <TagNear>TF {a.totalFloat}d</TagNear>
                    </div>
                    <div style={{fontSize:9,color:C.textDim}}>
                      {a.wbs} · d{a.earlyStart}→d{a.earlyFinish} · <span style={{color:C.orange}}>Float consuming {Math.max(0,5-a.totalFloat)} days above threshold</span>
                    </div>
                    <div style={{marginTop:5,height:3,background:C.surface,borderRadius:2,overflow:"hidden"}}>
                      <div style={{width:`${(a.totalFloat/5)*100}%`,height:"100%",background:C.orange}}/>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════ 2-WEEK LOOK-AHEAD ═════════════════ */}
      {activeSection==="lookahead" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {/* This week */}
            <div>
              <SectionTitle icon="📌">Starting This Week (Days {currentDay+1}–{currentDay+7})</SectionTitle>
              {startingIn7.length===0
                ? <div style={{color:C.textDim,fontSize:10,padding:"10px 0"}}>Nothing starting in next 7 days.</div>
                : startingIn7.map((a,i)=>{
                  const isCrit=a.critical===true||a.critical==="YES";
                  return (
                    <div key={i} style={{background:isCrit?"#160808":"#080F22",border:`1px solid ${isCrit?"#5D151533":C.border}`,borderRadius:8,padding:"9px 12px",marginBottom:6}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,gap:6}}>
                        <span style={{fontSize:10,color:isCrit?"#F87171":C.text,fontWeight:isCrit?600:400,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span>
                        <TagBlue>+{a.earlyStart-currentDay}d</TagBlue>
                      </div>
                      <div style={{fontSize:9,color:C.textDim,marginBottom:3}}>{a.wbs} · Duration: {a.duration}d · {isCrit?"🔴 CRITICAL":"Float: "+a.totalFloat+"d"}</div>
                      {a.labor&&<div style={{fontSize:9,color:C.textMid}}>👷 {a.labor}</div>}
                      {a.materials&&<div style={{fontSize:9,color:C.textMid}}>📦 Confirm: {a.materials}</div>}
                      {a.longLead&&<div style={{fontSize:9,color:C.gold,marginTop:2}}>⚠ Long-lead material — confirm delivery</div>}
                    </div>
                  );
                })
              }
            </div>
            {/* Week 2 */}
            <div>
              <SectionTitle icon="🗓">Week 2 Horizon (Days {currentDay+8}–{currentDay+14})</SectionTitle>
              {startingIn14.length===0
                ? <div style={{color:C.textDim,fontSize:10,padding:"10px 0"}}>Nothing starting in this window.</div>
                : startingIn14.map((a,i)=>{
                  const isCrit=a.critical===true||a.critical==="YES";
                  return (
                    <div key={i} style={{background:"#080F22",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",marginBottom:6}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,gap:6}}>
                        <span style={{fontSize:10,color:isCrit?"#F87171":C.textMid,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span>
                        <span style={{fontSize:9,color:C.teal}}>+{a.earlyStart-currentDay}d</span>
                      </div>
                      <div style={{fontSize:9,color:C.textDim}}>{a.wbs} · {a.duration}d · Float: {a.totalFloat??'—'}d</div>
                      {a.subcontractor&&<div style={{fontSize:9,color:C.textDim,marginTop:2}}>🏗 Sub: {a.subcontractor}</div>}
                    </div>
                  );
                })
              }
              {/* Constraints section */}
              <div style={{marginTop:12}}>
                <SectionTitle icon="🚧">Constraints & Pre-requisites</SectionTitle>
                {startingIn7.filter(a=>a.longLead||a.materials).map((a,i)=>(
                  <div key={i} style={{background:"#1A0C00",border:"1px solid #92400E33",borderRadius:7,padding:"7px 10px",marginBottom:5,fontSize:9}}>
                    <div style={{color:C.gold,fontWeight:700,marginBottom:2}}>⚡ {a.name}</div>
                    {a.materials&&<div style={{color:C.textMid}}>📦 Materials to confirm: {a.materials}</div>}
                    {a.equipment&&<div style={{color:C.textMid}}>🔧 Equipment needed: {a.equipment}</div>}
                    {a.subcontractor&&<div style={{color:C.textMid}}>🏗 Subcontractor: {a.subcontractor}</div>}
                  </div>
                ))}
                {startingIn7.filter(a=>a.longLead||a.materials).length===0&&
                  <div style={{fontSize:9,color:C.textDim}}>No material constraints identified for this week.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════ MILESTONES ════════════════════════ */}
      {activeSection==="milestones" && (
        <div>
          <SectionTitle icon="◆">All Milestones — Timeline View</SectionTitle>
          {/* Visual timeline */}
          <div style={{position:"relative",marginBottom:18,overflowX:"auto"}}>
            <div style={{height:3,background:C.border2,borderRadius:2,margin:"24px 20px 24px",position:"relative"}}>
              <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${(currentDay/totalDays)*100}%`,background:C.blue,borderRadius:2}}/>
            </div>
            <div style={{position:"relative",height:60,margin:"0 20px"}}>
              {milestones.map((m,i)=>{
                const pct=(m.day/totalDays)*100;
                const done=m.day<=currentDay;
                const clr=done?C.green:m.critical?C.purple:C.blueL;
                return (
                  <div key={i} style={{position:"absolute",left:`${pct}%`,transform:"translateX(-50%)",textAlign:"center",top:0}}>
                    <div style={{width:14,height:14,background:clr,transform:"rotate(45deg)",borderRadius:2,margin:"0 auto 4px",opacity:done?.6:1}}/>
                    <div style={{fontSize:8,color:clr,whiteSpace:"nowrap",maxWidth:80,overflow:"hidden",textOverflow:"ellipsis"}}>{m.name.split(" ").slice(0,2).join(" ")}</div>
                    <div style={{fontSize:7,color:C.textDim}}>d{m.day}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:9}}>
            {milestones.map((m,i)=>{
              const done=m.day<=currentDay;
              const daysAway=m.day-currentDay;
              const clr=done?C.green:m.critical?C.purple:C.blueL;
              return (
                <div key={i} style={{background:done?"#061A0E":m.critical?"#12082B":"#080F22",border:`1px solid ${clr}33`,borderRadius:9,padding:"11px 13px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                    <span style={{fontSize:11,fontWeight:700,color:clr}}>{done?"✓":m.critical?"◆":"◇"} {m.name}</span>
                    {done
                      ? <span style={{fontSize:9,color:C.green,fontWeight:700}}>DONE</span>
                      : <Tag style={{background:`${clr}1A`,color:clr,border:`1px solid ${clr}44`}}>{daysAway}d</Tag>}
                  </div>
                  <div style={{height:3,background:C.surface,borderRadius:2,overflow:"hidden",marginBottom:5}}>
                    <div style={{width:`${Math.min(100,(currentDay/m.day)*100)}%`,height:"100%",background:clr,transition:"width .5s"}}/>
                  </div>
                  <div style={{fontSize:9,color:C.textDim}}>{m.phase} · Day {m.day}{m.dateStr?` · ${m.dateStr}`:""}</div>
                  {m.description&&<div style={{fontSize:9,color:C.textMid,marginTop:3}}>{m.description}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════ PROCUREMENT ═══════════════════════ */}
      {activeSection==="procurement" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div>
              <SectionTitle icon="⚡">Urgent Orders (≤10 days)</SectionTitle>
              {procAlerts.filter(p=>p.urgent).length===0
                ? <div style={{background:"#061A0E",border:"1px solid #16653444",borderRadius:9,padding:"12px",fontSize:10,color:C.green}}>✅ No urgent procurement items right now.</div>
                : procAlerts.filter(p=>p.urgent).map((ll,i)=>(
                  <div key={i} style={{background:"#1A0505",border:"1px solid #7F1D1D44",borderRadius:9,padding:"11px 13px",marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                      <span style={{fontSize:11,color:C.red,fontWeight:700}}>{ll.item}</span>
                      <span style={{fontSize:22,fontWeight:900,color:C.red,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{Math.max(0,Math.round(ll.daysUntil))}d</span>
                    </div>
                    <div style={{fontSize:9,color:C.textDim,marginBottom:5}}>Lead time: {ll.leadWeeks}w · Activity: {ll.activity}</div>
                    {ll.risk&&<div style={{fontSize:9,color:C.orange}}>⚠ {ll.risk}</div>}
                    <div style={{marginTop:6,height:3,background:C.surface,borderRadius:2,overflow:"hidden"}}>
                      <div style={{width:`${Math.max(0,(1-(ll.daysUntil/10))*100)}%`,height:"100%",background:C.red}}/>
                    </div>
                  </div>
                ))
              }
            </div>
            <div>
              <SectionTitle icon="📦">All Long-Lead Items — Order Countdown</SectionTitle>
              {procAlerts.map((ll,i)=>{
                const days=Math.max(0,Math.round(ll.daysUntil));
                const clr=ll.urgent?C.red:ll.warning?C.gold:C.green;
                const pct=Math.min(100,Math.max(0,((ll.leadWeeks*5-days)/(ll.leadWeeks*5))*100));
                return (
                  <div key={i} style={{background:C.surface,border:`1px solid ${clr}22`,borderRadius:8,padding:"8px 12px",marginBottom:6,display:"flex",gap:10,alignItems:"center"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:10,color:clr,fontWeight:700,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ll.item}</div>
                      <div style={{height:4,background:C.card,borderRadius:2,overflow:"hidden"}}>
                        <div style={{width:`${pct}%`,height:"100%",background:clr,transition:"width .5s"}}/>
                      </div>
                      <div style={{fontSize:8,color:C.textDim,marginTop:2}}>Lead: {ll.leadWeeks}w · Order by: {ll.orderBy||"—"} · {ll.criticality}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:18,fontWeight:900,color:clr,fontFamily:"'Sora','Segoe UI',sans-serif",lineHeight:1}}>{days}</div>
                      <div style={{fontSize:7,color:C.textDim}}>days left</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════ RESOURCES ═════════════════════════ */}
      {activeSection==="resources" && (
        <div>
          <SectionTitle icon="👷">Resource Utilization — By Phase</SectionTitle>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:9,marginBottom:16}}>
            {(schedule.resourceSummary||[]).map((r,i)=>{
              const util=Math.min(100,Math.round((r.avgLabor/Math.max(r.peakLabor,1))*100));
              const utilClr=util>90?C.red:util>75?C.gold:C.green;
              return (
                <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px"}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.blueL,marginBottom:2}}>{r.phase}</div>
                  <div style={{fontSize:8,color:C.textDim,marginBottom:8}}>{r.period}</div>
                  <div style={{display:"flex",gap:8,marginBottom:9}}>
                    {[["Peak",r.peakLabor,C.red],["Avg",r.avgLabor,C.orange]].map(([l,v,c])=>(
                      <div key={l} style={{flex:1,background:C.surface,borderRadius:6,padding:"6px",textAlign:"center"}}>
                        <div style={{fontSize:16,fontWeight:700,color:c}}>{v}</div>
                        <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase"}}>{l} workers</div>
                      </div>
                    ))}
                  </div>
                  <div style={{marginBottom:5}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                      <span style={{fontSize:8,color:C.textDim}}>Utilization</span>
                      <span style={{fontSize:8,color:utilClr,fontWeight:700}}>{util}%</span>
                    </div>
                    <div style={{height:5,background:C.surface,borderRadius:3,overflow:"hidden"}}>
                      <div style={{width:`${util}%`,height:"100%",background:utilClr,transition:"width .5s"}}/>
                    </div>
                  </div>
                  <div style={{fontSize:8,color:C.textMid,lineHeight:1.5}}>
                    {r.keyEquipment&&<div>🔧 {r.keyEquipment}</div>}
                    {r.keyMaterials&&<div>📦 {r.keyMaterials}</div>}
                  </div>
                </div>
              );
            })}
          </div>

          <SectionTitle icon="📊">Workforce Today</SectionTitle>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,padding:"12px 14px"}}>
            <div style={{display:"flex",gap:8,alignItems:"flex-end",height:80}}>
              {(schedule.resourceSummary||[]).map((r,i)=>{
                const peak=schedule.resourceSummary.reduce((mx,x)=>Math.max(mx,x.peakLabor),1);
                const h=Math.round((r.avgLabor/peak)*70);
                return (
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                    <span style={{fontSize:7,color:C.blueL,fontWeight:700}}>{r.avgLabor}</span>
                    <div style={{width:"100%",height:h,background:C.blue,borderRadius:"3px 3px 0 0",opacity:.75}}/>
                    <span style={{fontSize:7,color:C.textDim,textAlign:"center",maxWidth:60,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.phase.split(" ")[0]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════ DAILY PULSE ═══════════════════════ */}
      {activeSection==="pulse" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <SectionTitle icon="✅">Completed Yesterday</SectionTitle>
            {recentlyDone.length===0
              ? <div style={{color:C.textDim,fontSize:10,padding:"8px 0"}}>No activities completed in last 5 days.</div>
              : recentlyDone.map((a,i)=>(
                <div key={i} style={{background:"#061A0E",border:"1px solid #16653433",borderRadius:8,padding:"8px 12px",marginBottom:5,display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{color:C.green,fontSize:14}}>✓</span>
                  <div>
                    <div style={{fontSize:10,color:C.green,fontWeight:600}}>{a.name}</div>
                    <div style={{fontSize:9,color:C.textDim}}>{a.wbs} · Finished day {a.earlyFinish}</div>
                  </div>
                </div>
              ))
            }

            <div style={{marginTop:12}}>
              <SectionTitle icon="📋">Today's Planned Activities</SectionTitle>
              {activeNow.length===0
                ? <div style={{color:C.textDim,fontSize:10}}>No activities active today.</div>
                : activeNow.slice(0,8).map((a,i)=>{
                  const isCrit=a.critical===true||a.critical==="YES";
                  return (
                    <div key={i} style={{background:isCrit?"#160808":"#080F22",border:`1px solid ${isCrit?"#5D151533":C.border}`,borderRadius:8,padding:"8px 12px",marginBottom:5}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                        <span style={{fontSize:10,color:isCrit?"#F87171":C.text,fontWeight:isCrit?600:400}}>{a.name}</span>
                        {isCrit&&<TagCrit>CP</TagCrit>}
                      </div>
                      <div style={{fontSize:9,color:C.textDim}}>{a.labor||"—"} · ends d{a.earlyFinish}</div>
                    </div>
                  );
                })
              }
            </div>
          </div>

          <div>
            <SectionTitle icon="🚧">Active Blockers / Issues Log</SectionTitle>
            {blockers.map((b,i)=>(
              <div key={b.id} style={{background:"#1A0505",border:"1px solid #7F1D1D33",borderRadius:8,padding:"8px 10px",marginBottom:6,display:"flex",gap:7}}>
                <select value={b.severity} onChange={e=>setBlockers(p=>p.map(x=>x.id===b.id?{...x,severity:e.target.value}:x))}
                  style={{background:"transparent",border:"none",color:b.severity==="HIGH"?C.red:b.severity==="MEDIUM"?C.gold:C.green,fontSize:9,fontWeight:700,fontFamily:"inherit",cursor:"pointer",padding:0,width:60}}>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
                <input value={b.text} placeholder="Describe blocker / issue…"
                  onChange={e=>setBlockers(p=>p.map(x=>x.id===b.id?{...x,text:e.target.value}:x))}
                  style={{flex:1,background:"transparent",border:"none",color:C.text,fontSize:10,fontFamily:"inherit",outline:"none"}}/>
                <button onClick={()=>setBlockers(p=>p.filter(x=>x.id!==b.id))} style={{background:"transparent",border:"none",color:C.textDim,cursor:"pointer",fontSize:12}}>✕</button>
              </div>
            ))}
            <button onClick={()=>setBlockers(p=>[...p,{id:Date.now(),text:"",severity:"HIGH"}])}
              style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontFamily:"inherit",width:"100%",marginBottom:12}}>
              + Add Blocker / Issue
            </button>

            <SectionTitle icon="📌">Starting Tomorrow (Next 3 days)</SectionTitle>
            {acts.filter(a=>!a.isMilestone&&a.earlyStart>currentDay&&a.earlyStart<=currentDay+3).map((a,i)=>{
              const isCrit=a.critical===true||a.critical==="YES";
              return (
                <div key={i} style={{background:isCrit?"#160808":"#080F22",border:`1px solid ${isCrit?"#5D151533":C.border}`,borderRadius:8,padding:"8px 12px",marginBottom:5}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                    <span style={{fontSize:10,color:isCrit?"#F87171":C.text}}>{a.name}</span>
                    <TagBlue>+{a.earlyStart-currentDay}d</TagBlue>
                  </div>
                  <div style={{fontSize:9,color:C.textDim}}>
                    {a.labor&&`👷 ${a.labor} · `}{a.materials&&`📦 Confirm: ${a.materials}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════ ALERTS FEED ═══════════════════════ */}
      {activeSection==="alerts" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <SectionTitle icon="🔴">Critical Alerts — Action Required</SectionTitle>
            {procAlerts.filter(p=>p.urgent).map((p,i)=>(
              <AlertCard key={i} icon="⚠" severity="crit"
                title={`ORDER NOW: ${p.item}`}
                body={`Lead time ${p.leadWeeks}w. ${Math.max(0,Math.round(p.daysUntil))} working days left. Risk: ${p.risk||"Delivery delay to critical activity"}`}/>
            ))}
            {nearCrit.slice(0,4).map((a,i)=>(
              <AlertCard key={i} icon="🔶" severity="warn"
                title={`Near-Critical Float: ${a.name}`}
                body={`TF=${a.totalFloat}d. One delay converts to critical. Assign dedicated oversight.`}/>
            ))}
            {highRisks.slice(0,4).map((r,i)=>(
              <AlertCard key={i} icon="🔴" severity="crit"
                title={`${r.severity} Risk: ${r.ref}`}
                body={`${r.description.slice(0,80)} · Mitigation: ${r.mitigation?.slice(0,60)}`}/>
            ))}
            {SPI<0.9&&<AlertCard icon="📉" severity="crit" title="SPI Below 0.9 — Schedule Recovery Required" body={`Current SPI=${SPI.toFixed(2)}. Project is ${daysBehind} days behind. Consider acceleration or re-sequencing.`}/>}
            {CPI<0.9&&<AlertCard icon="💸" severity="crit" title="CPI Below 0.9 — Cost Overrun Warning" body={`Current CPI=${CPI.toFixed(2)}. Review cost drivers and implement variance recovery plan.`}/>}
            {highRisks.length===0&&nearCrit.length===0&&procAlerts.filter(p=>p.urgent).length===0&&SPI>=0.9&&CPI>=0.9&&
              <AlertCard icon="✅" severity="ok" title="No Critical Alerts" body="All key indicators are within acceptable thresholds. Continue monitoring."/>}
          </div>
          <div>
            <SectionTitle icon="🟡">Watch Items — Monitor Closely</SectionTitle>
            {procAlerts.filter(p=>p.warning).map((p,i)=>(
              <AlertCard key={i} icon="📦" severity="warn"
                title={`Procurement Watch: ${p.item}`}
                body={`Order within ${Math.round(p.daysUntil)} working days. Lead: ${p.leadWeeks}w. Activity: ${p.activity}`}/>
            ))}
            {startingIn7.slice(0,4).map((a,i)=>(
              <AlertCard key={i} icon="📌" severity="info"
                title={`Starting in ${a.earlyStart-currentDay}d: ${a.name}`}
                body={`Resources: ${a.labor||"—"} · Materials: ${a.materials||"—"} · Sub: ${a.subcontractor||"—"}`}/>
            ))}
            {risks.filter(r=>r.severity==="MEDIUM").slice(0,3).map((r,i)=>(
              <AlertCard key={i} icon="🟡" severity="warn"
                title={`Medium Risk: ${r.ref} — ${r.description.slice(0,50)}`}
                body={`P: ${r.probability} · I: ${r.impact} · Mitigation: ${r.mitigation?.slice(0,60)}`}/>
            ))}
            {projectedDelta>5&&<AlertCard icon="⏱" severity="warn"
              title={`Projected Finish ${projectedDelta}d Late`}
              body={`At current SPI=${SPI.toFixed(2)}, projected completion is Day ${projectedFinish} vs baseline Day ${totalDays}. Consider schedule acceleration.`}/>}
          </div>
        </div>
      )}

    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   DAILY CHECKLIST
════════════════════════════════════════════════════════════════════ */
function DailyChecklist({schedule}) {
  const [day, setDay] = useState(15);
  const [checked, setChecked] = useState({});
  const [notes, setNotes] = useState({});

  if(!schedule) return null;
  const acts = (schedule.activities||[]).filter(a=>!a.isMilestone);

  const overdue    = acts.filter(a=>a.earlyFinish < day && !checked[a.id+"_done"]);
  const todayActs  = acts.filter(a=>a.earlyStart<=day && a.earlyFinish>=day);
  const upcoming7  = acts.filter(a=>a.earlyStart>day && a.earlyStart<=day+7);
  const upcoming14 = acts.filter(a=>a.earlyStart>day+7 && a.earlyStart<=day+14);

  const toggle = (key) => setChecked(p=>({...p,[key]:!p[key]}));

  const CheckItem = ({a, group}) => {
    const isCrit = a.critical===true||a.critical==="YES";
    const doneKey = `${a.id}_done`;
    const isDone = checked[doneKey];
    const noteKey = `${a.id}_note`;
    return (
      <div style={{background:isDone?"#0A1E14":isCrit?"#160808":"#080F22",border:`1px solid ${isDone?C.green:isCrit?"#5D1515":C.border}`,borderRadius:8,padding:"10px 12px",marginBottom:6,transition:"all .2s"}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
          <div onClick={()=>toggle(doneKey)} style={{width:18,height:18,borderRadius:4,border:`2px solid ${isDone?C.green:isCrit?C.red:C.border2}`,background:isDone?C.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,marginTop:1,transition:"all .15s"}}>
            {isDone && <span style={{color:"#fff",fontSize:11,fontWeight:900}}>✓</span>}
          </div>
          <div style={{flex:1}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
              <span style={{fontSize:11,color:isDone?C.textDim:isCrit?"#F87171":C.text,fontWeight:isCrit?600:400,textDecoration:isDone?"line-through":"none"}}>{a.name}</span>
              <div style={{display:"flex",gap:5,flexShrink:0}}>
                {isCrit && <TagCrit>CP</TagCrit>}
                {a.longLead && <Tag style={{background:"#1A2200",color:"#84CC16",border:"1px solid #3B5000",fontSize:9}}>LL</Tag>}
                <TagBlue>{a.wbs}</TagBlue>
              </div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:3,flexWrap:"wrap"}}>
              {a.labor && <span style={{fontSize:9,color:C.textDim}}>👷 {a.labor}</span>}
              {a.equipment && <span style={{fontSize:9,color:C.textDim}}>🔧 {a.equipment}</span>}
              {group==="today" && <span style={{fontSize:9,color:C.gold}}>📍 d{a.earlyStart}→d{a.earlyFinish} ({a.duration}d)</span>}
              {group==="upcoming" && <span style={{fontSize:9,color:C.blueL}}>🗓 Starts day {a.earlyStart} ({a.earlyStart-day}d away)</span>}
              {group==="overdue" && <span style={{fontSize:9,color:C.red}}>🚨 Was due day {a.earlyFinish} ({day-a.earlyFinish}d overdue)</span>}
            </div>
            <div style={{marginTop:5,display:"flex",gap:6}}>
              <input
                placeholder={`Note for ${a.id}…`}
                value={notes[noteKey]||""}
                onChange={e=>setNotes(p=>({...p,[noteKey]:e.target.value}))}
                style={{flex:1,background:C.surface,border:`1px solid ${C.border2}`,borderRadius:4,padding:"3px 8px",color:C.text,fontSize:10,fontFamily:"inherit"}}/>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const SectionHeader = ({icon,title,count,color=C.blueL,urgent}) => (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:C.card,border:`1px solid ${C.border}`,borderRadius:"8px 8px 0 0",marginBottom:2}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:14}}>{icon}</span>
        <span style={{fontSize:11,fontWeight:700,color,fontFamily:"'Sora','Segoe UI',sans-serif",letterSpacing:"0.5px"}}>{title}</span>
        {urgent && <span style={{width:8,height:8,borderRadius:"50%",background:C.red,display:"inline-block",animation:"ping 1.5s infinite"}}/>}
      </div>
      <Tag style={{background:`${color}22`,color,border:`1px solid ${color}44`,fontSize:10}}>{count} activities</Tag>
    </div>
  );

  return (
    <div style={{animation:"fadeUp .4s ease"}}>
      {/* Day selector */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
        <span style={{fontSize:10,color:C.blueL,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",whiteSpace:"nowrap"}}>📅 Project Day</span>
        <input type="range" min={0} max={Math.max(...(schedule.activities||[]).map(a=>a.earlyFinish||0),100)}
          value={day} onChange={e=>setDay(+e.target.value)}
          style={{flex:1,minWidth:200,accentColor:C.blue}}/>
        <span style={{fontSize:14,fontWeight:700,color:C.gold,whiteSpace:"nowrap",fontFamily:"'Sora','Segoe UI',sans-serif"}}>Day {day}</span>
        <div style={{display:"flex",gap:6}}>
          {[0,7,14,30,60].map(d=>(
            <button key={d} onClick={()=>setDay(d)}
              style={{background:day===d?`${C.blue}33`:"transparent",border:`1px solid ${day===d?C.blue:C.border}`,color:day===d?C.blueL:C.textDim,borderRadius:5,padding:"3px 8px",cursor:"pointer",fontSize:9}}>
              d{d}
            </button>
          ))}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        {/* Left column */}
        <div>
          {/* Overdue */}
          {overdue.length>0 && (
            <div style={{marginBottom:14}}>
              <SectionHeader icon="🚨" title="OVERDUE — Immediate Attention Required" count={overdue.length} color={C.red} urgent/>
              <div style={{border:`1px solid #5D151544`,borderRadius:"0 0 8px 8px",padding:"8px",background:"#0D0505"}}>
                {overdue.map((a,i)=><CheckItem key={i} a={a} group="overdue"/>)}
              </div>
            </div>
          )}

          {/* Today */}
          <div style={{marginBottom:14}}>
            <SectionHeader icon="📋" title={`TODAY — Day ${day} Activities`} count={todayActs.length} color={C.blueL}/>
            <div style={{border:`1px solid ${C.border}`,borderRadius:"0 0 8px 8px",padding:"8px",background:"#060E1E"}}>
              {todayActs.length===0
                ? <div style={{textAlign:"center",color:C.textDim,fontSize:11,padding:"20px 0"}}>No activities active today</div>
                : todayActs.map((a,i)=><CheckItem key={i} a={a} group="today"/>)}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div>
          {/* Upcoming 7d */}
          <div style={{marginBottom:14}}>
            <SectionHeader icon="📌" title="STARTING THIS WEEK (Next 7 Days)" count={upcoming7.length} color={C.gold}/>
            <div style={{border:`1px solid ${C.border}`,borderRadius:"0 0 8px 8px",padding:"8px",background:"#060E1E"}}>
              {upcoming7.length===0
                ? <div style={{textAlign:"center",color:C.textDim,fontSize:11,padding:"20px 0"}}>Nothing starting in next 7 days</div>
                : upcoming7.map((a,i)=><CheckItem key={i} a={a} group="upcoming"/>)}
            </div>
          </div>

          {/* Upcoming 14d */}
          <div>
            <SectionHeader icon="🗓" title="ON THE HORIZON (Days 8–14)" count={upcoming14.length} color={C.teal}/>
            <div style={{border:`1px solid ${C.border}`,borderRadius:"0 0 8px 8px",padding:"8px",background:"#060E1E"}}>
              {upcoming14.length===0
                ? <div style={{textAlign:"center",color:C.textDim,fontSize:11,padding:"20px 0"}}>No activities in this window</div>
                : upcoming14.map((a,i)=><CheckItem key={i} a={a} group="upcoming14"/>)}
            </div>
          </div>
        </div>
      </div>

      <div style={{marginTop:10,padding:"8px 12px",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,fontSize:10,color:C.textDim,display:"flex",gap:6,alignItems:"center"}}>
        <span>ℹ</span>
        <span>Check off activities as complete. Add notes to any item. Use the day slider to navigate your project timeline. <strong style={{color:C.blueL}}>Checkboxes persist during your session.</strong></span>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   RISK PLAN FULL
════════════════════════════════════════════════════════════════════ */
function RiskPlan({schedule}) {
  if(!schedule) return null;
  const risks = schedule.risks || [];

  const matrix = [
    ["","Rare","Unlikely","Possible","Likely","Almost Certain"],
    ["Catastrophic","M","H","H","C","C"],
    ["Major","M","M","H","H","C"],
    ["Moderate","L","M","M","H","H"],
    ["Minor","L","L","M","M","H"],
    ["Insignificant","L","L","L","M","M"],
  ];
  const mColors = {"C":"#3D0808","H":"#2D1500","M":"#1A1500","L":"#0A2D15","":"#0C1B30"};
  const mText   = {"C":"#F87171","H":"#FB923C","M":"#FDE68A","L":"#4ADE80","":"#475569"};
  const mLabel  = {"C":"CRITICAL","H":"HIGH","M":"MEDIUM","L":"LOW","":"—"};

  return (
    <div style={{animation:"fadeUp .4s ease"}}>
      {/* Risk Matrix */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <div>
          <SectionTitle icon="🎯">Risk Probability-Impact Matrix</SectionTitle>
          <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
            {matrix.map((row,ri)=>(
              <div key={ri} style={{display:"grid",gridTemplateColumns:`1fr repeat(5,1fr)`}}>
                {row.map((cell,ci)=>{
                  const isHeader = ri===0 || ci===0;
                  const bg = isHeader ? C.card : mColors[cell]||C.surface;
                  const clr = isHeader ? C.textDim : mText[cell]||C.textDim;
                  return (
                    <div key={ci} style={{background:bg,padding:"7px 6px",textAlign:"center",fontSize:9,fontWeight:isHeader?700:900,color:clr,border:`1px solid ${C.border}`,letterSpacing:isHeader?"0.5px":"0",textTransform:isHeader?"uppercase":"none"}}>
                      {cell ? (isHeader ? cell : mLabel[cell]) : ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
            {[["C","#F87171","CRITICAL"],["H","#FB923C","HIGH"],["M","#FDE68A","MEDIUM"],["L","#4ADE80","LOW"]].map(([k,c,l])=>(
              <span key={k} style={{fontSize:9,color:c,display:"flex",alignItems:"center",gap:3}}>
                <span style={{width:8,height:8,borderRadius:2,background:mColors[k],border:`1px solid ${c}55`,display:"inline-block"}}/>
                {l}
              </span>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div>
          <SectionTitle icon="📊">Risk Summary</SectionTitle>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
            {[
              [risks.filter(r=>r.severity==="CRITICAL").length,"Critical",C.red],
              [risks.filter(r=>r.severity==="HIGH").length,"High",C.orange],
              [risks.filter(r=>r.severity==="MEDIUM").length,"Medium",C.gold],
              [risks.filter(r=>r.severity==="LOW").length,"Low",C.green],
            ].map(([v,l,c])=>(
              <div key={l} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px",textAlign:"center"}}>
                <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px"}}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
            <div style={{fontSize:9,color:C.blueL,fontWeight:700,marginBottom:8,textTransform:"uppercase",letterSpacing:"1px"}}>Risk Distribution</div>
            {[["CRITICAL",C.red],["HIGH",C.orange],["MEDIUM",C.gold],["LOW",C.green]].map(([sev,clr])=>{
              const cnt=risks.filter(r=>r.severity===sev).length;
              const pct=risks.length?Math.round((cnt/risks.length)*100):0;
              return (
                <div key={sev} style={{marginBottom:6}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                    <span style={{fontSize:9,color:clr,fontWeight:700}}>{sev}</span>
                    <span style={{fontSize:9,color:C.textDim}}>{cnt} ({pct}%)</span>
                  </div>
                  <div style={{height:5,background:C.card,borderRadius:3,overflow:"hidden"}}>
                    <div style={{width:`${pct}%`,height:"100%",background:clr,borderRadius:3}}/>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Risk Register Table */}
      <SectionTitle icon="📋">Risk Register</SectionTitle>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr>
              {["Ref","Risk Description","Probability","Impact","Severity","Affected Phase","Mitigation Strategy","Owner","Status"].map(h=>(
                <th key={h} style={{background:C.surface,padding:"7px 10px",textAlign:"left",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {risks.map((r,i)=>{
              const sev=r.severity?.toUpperCase()||"LOW";
              const colors = {"CRITICAL":["#2D0808","#F87171"],"HIGH":["#2D1500","#FB923C"],"MEDIUM":["#1A1500","#FDE68A"],"LOW":["#0A2D15","#4ADE80"]};
              const [rbg,rclr]=colors[sev]||["#080F22",C.textMid];
              return (
                <tr key={i} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                  <td style={{padding:"7px 10px",fontSize:10,fontWeight:700,color:C.blueL,borderBottom:`1px solid ${C.border}`}}>{r.ref}</td>
                  <td style={{padding:"7px 10px",fontSize:10,color:C.text,maxWidth:200,borderBottom:`1px solid ${C.border}`}}>{r.description}</td>
                  <td style={{padding:"7px 10px",fontSize:10,color:C.textMid,textAlign:"center",borderBottom:`1px solid ${C.border}`}}>{r.probability}</td>
                  <td style={{padding:"7px 10px",fontSize:10,color:C.textMid,textAlign:"center",borderBottom:`1px solid ${C.border}`}}>{r.impact}</td>
                  <td style={{padding:"7px 10px",borderBottom:`1px solid ${C.border}`}}>
                    <span style={{...{display:"inline-block",padding:"3px 8px",borderRadius:20,fontSize:9,fontWeight:700},background:rbg,color:rclr}}>{sev}</span>
                  </td>
                  <td style={{padding:"7px 10px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{r.phase||"All Phases"}</td>
                  <td style={{padding:"7px 10px",fontSize:10,color:C.green,maxWidth:220,borderBottom:`1px solid ${C.border}`}}>{r.mitigation}</td>
                  <td style={{padding:"7px 10px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{r.owner||"PM"}</td>
                  <td style={{padding:"7px 10px",borderBottom:`1px solid ${C.border}`}}>
                    <span style={{display:"inline-block",padding:"2px 7px",borderRadius:20,fontSize:9,background:"#1A1500",color:C.gold,border:`1px solid ${C.gold}44`}}>OPEN</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   ASSUMPTIONS REGISTER
════════════════════════════════════════════════════════════════════ */
function AssumptionsRegister({schedule}) {
  if(!schedule) return null;
  const assumptions = schedule.assumptions || [];
  const [filter, setFilter] = useState("ALL");

  const impactColors = {"HIGH":C.red,"MEDIUM":C.gold,"LOW":C.green,"CRITICAL":C.red};

  return (
    <div style={{animation:"fadeUp .4s ease"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
        {[
          [assumptions.length,"Total Assumptions",C.blueL],
          [assumptions.filter(a=>a.impact?.toUpperCase()==="HIGH"||a.impact?.toUpperCase()==="CRITICAL").length,"High Impact",C.red],
          [assumptions.filter(a=>a.impact?.toUpperCase()==="MEDIUM").length,"Medium Impact",C.gold],
        ].map(([v,l,c])=>(
          <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 16px",textAlign:"center"}}>
            <div style={{fontSize:26,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
            <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>

      <SectionTitle icon="📝">Assumptions Register</SectionTitle>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:10,marginBottom:16}}>
        {assumptions.map((a,i)=>{
          const imp = a.impact?.toUpperCase()||"LOW";
          const clr = impactColors[imp]||C.textMid;
          return (
            <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"13px 14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                <div style={{display:"flex",gap:7,alignItems:"center"}}>
                  <TagBlue>{a.ref||`A-${String(i+1).padStart(2,"0")}`}</TagBlue>
                  <span style={{fontSize:11,fontWeight:700,color:C.white}}>{a.title}</span>
                </div>
                <span style={{display:"inline-block",padding:"2px 8px",borderRadius:20,fontSize:9,fontWeight:700,background:`${clr}1A`,color:clr,border:`1px solid ${clr}44`,flexShrink:0,marginLeft:6}}>{imp}</span>
              </div>
              <div style={{fontSize:10,color:C.textMid,lineHeight:1.6,marginBottom:6}}>{a.description}</div>
              {a.impact && <div style={{fontSize:9,color:clr,borderTop:`1px solid ${C.border}`,paddingTop:5,marginTop:2}}>
                ⚡ Schedule Impact: {a.impact}
              </div>}
            </div>
          );
        })}
      </div>

      <SectionTitle icon="📊">Assumptions Table</SectionTitle>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr>
              {["Ref","Assumption Title","Description","Impact Level","Schedule Effect","Verified?","Date Logged"].map(h=>(
                <th key={h} style={{background:C.surface,padding:"7px 10px",textAlign:"left",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assumptions.map((a,i)=>{
              const imp=a.impact?.toUpperCase()||"LOW";
              const clr=impactColors[imp]||C.textMid;
              return (
                <tr key={i} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                  <td style={{padding:"7px 10px",fontSize:10,fontWeight:700,color:C.blueL,borderBottom:`1px solid ${C.border}`}}>{a.ref||`A-${String(i+1).padStart(2,"0")}`}</td>
                  <td style={{padding:"7px 10px",fontSize:10,fontWeight:600,color:C.white,borderBottom:`1px solid ${C.border}`}}>{a.title}</td>
                  <td style={{padding:"7px 10px",fontSize:10,color:C.textMid,maxWidth:250,borderBottom:`1px solid ${C.border}`}}>{a.description}</td>
                  <td style={{padding:"7px 10px",borderBottom:`1px solid ${C.border}`}}>
                    <span style={{display:"inline-block",padding:"2px 7px",borderRadius:20,fontSize:9,fontWeight:700,background:`${clr}1A`,color:clr,border:`1px solid ${clr}44`}}>{imp}</span>
                  </td>
                  <td style={{padding:"7px 10px",fontSize:10,color:clr,maxWidth:180,borderBottom:`1px solid ${C.border}`}}>{a.impact}</td>
                  <td style={{padding:"7px 10px",borderBottom:`1px solid ${C.border}`}}>
                    <span style={{display:"inline-block",padding:"2px 7px",borderRadius:20,fontSize:9,background:"#0A2D15",color:C.green,border:`1px solid ${C.green}44`}}>ASSUMED</span>
                  </td>
                  <td style={{padding:"7px 10px",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{new Date().toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   MAIN APP
════════════════════════════════════════════════════════════════════ */
export default function PMcopilots() {
  const [proj, setProj] = useState({
    name:"Skyline Office Complex — Block A",type:"5-Story Commercial Office Building",
    location:"Downtown Business District",start:"2026-04-01",duration:"18",unit:"months",value:"",
  });
  const setP = (k,v) => setProj(p=>({...p,[k]:v}));

  const [rows, setRows]         = useState(SAMPLE_BOQ);
  const [parsing, setParsing]   = useState(false);
  const [parseMsg, setParseMsg] = useState("");
  const [loading, setLoading]   = useState(false);
  const [loadMsg, setLoadMsg]   = useState("");
  const [schedule, setSchedule] = useState(null);
  const [error, setError]       = useState(null);
  const [tab, setTab] = useState("dashboard");
  const fileRef = useRef(null);

  /* ── New module state ── */
  const mkId = () => Date.now()+Math.random();
  const [changeOrders, setChangeOrders] = useState([
    {id:1001,ref:"CO-001",description:"Additional basement waterproofing",value:45000,status:"Approved",scheduleImpact:3,submittedDate:"2026-04-15",approvedDate:"2026-04-22",raisedBy:"Contractor"},
    {id:1002,ref:"CO-002",description:"Upgraded facade glazing specification",value:128000,status:"Pending",scheduleImpact:5,submittedDate:"2026-05-01",approvedDate:"",raisedBy:"Client"},
    {id:1003,ref:"CO-003",description:"Additional MEP distribution boards",value:22500,status:"Pending",scheduleImpact:0,submittedDate:"2026-05-10",approvedDate:"",raisedBy:"Contractor"},
  ]);
  const [rfis, setRfis] = useState([
    {id:2001,ref:"RFI-001",subject:"Pile cap reinforcement detail clarification",discipline:"Structural",raisedBy:"Site Eng.",raisedDate:"2026-04-10",dueDate:"2026-04-17",answeredDate:"2026-04-16",status:"Answered",priority:"High",scheduleImpact:0},
    {id:2002,ref:"RFI-002",subject:"Curtain wall anchor bracket spacing",discipline:"Façade",raisedBy:"Sub A",raisedDate:"2026-05-02",dueDate:"2026-05-09",answeredDate:"",status:"Open",priority:"High",scheduleImpact:3},
    {id:2003,ref:"RFI-003",subject:"BMS integration points with HVAC",discipline:"MEP",raisedBy:"MEP Sub",raisedDate:"2026-05-08",dueDate:"2026-05-15",answeredDate:"",status:"Overdue",priority:"Critical",scheduleImpact:5},
  ]);
  const [submittals, setSubmittals] = useState([
    {id:3001,ref:"SUB-001",description:"Structural steel shop drawings",discipline:"Structural",submittedDate:"2026-04-20",dueDate:"2026-05-04",returnDate:"2026-05-03",status:"Approved",rev:"A",submittedBy:"Steel Sub"},
    {id:3002,ref:"SUB-002",description:"Curtain wall system shop drawings",discipline:"Façade",submittedDate:"2026-05-05",dueDate:"2026-05-19",returnDate:"",status:"Under Review",rev:"A",submittedBy:"Façade Sub"},
    {id:3003,ref:"SUB-003",description:"HVAC equipment data sheets",discipline:"Mechanical",submittedDate:"2026-05-01",dueDate:"2026-05-15",returnDate:"",status:"Pending",rev:"A",submittedBy:"MEP Sub"},
    {id:3004,ref:"SUB-004",description:"Lift installation method statement",discipline:"Specialist",submittedDate:"2026-04-28",dueDate:"2026-05-12",returnDate:"",status:"Revise & Resubmit",rev:"A",submittedBy:"Lift Sub"},
  ]);
  const [actualProgress, setActualProgress] = useState({});
  const [subcontractors, setSubcontractors] = useState([
    {id:4001,name:"Excavation & Piling Co.",trade:"Earthworks",planned:18,actual:16,contract:340000,paymentStatus:"Current",lastPayment:"2026-04-30",performanceScore:88,notes:""},
    {id:4002,name:"StructBuild Ltd",trade:"Concrete Structure",planned:42,actual:38,contract:1850000,paymentStatus:"Current",lastPayment:"2026-04-30",performanceScore:91,notes:""},
    {id:4003,name:"FaçadeTech Systems",trade:"Curtain Wall",planned:24,actual:20,contract:1085000,paymentStatus:"Delayed",lastPayment:"2026-03-31",performanceScore:74,notes:"Payment dispute – risk of slowdown"},
    {id:4004,name:"MEP Contractors Ltd",trade:"Mechanical & Electrical",planned:35,actual:34,contract:1266550,paymentStatus:"Current",lastPayment:"2026-04-30",performanceScore:85,notes:""},
    {id:4005,name:"Lift Systems Inc.",trade:"Specialist",planned:8,actual:8,contract:555000,paymentStatus:"Current",lastPayment:"2026-04-30",performanceScore:95,notes:""},
    {id:4006,name:"Interior Finish Co.",trade:"Internal Finishes",planned:28,actual:22,contract:819800,paymentStatus:"Current",lastPayment:"2026-04-15",performanceScore:79,notes:"Labour shortage reported"},
  ]);
  const [safetyIncidents, setSafetyIncidents] = useState([
    {id:5001,date:"2026-04-18",type:"Near Miss",description:"Unsecured load on scaffold level 2",severity:"Medium",injured:"None",trade:"StructBuild",actionTaken:"Toolbox talk + re-briefing",status:"Closed",daysLost:0},
    {id:5002,date:"2026-05-03",type:"First Aid",description:"Minor laceration to hand during formwork",severity:"Low",injured:"1 worker",trade:"StructBuild",actionTaken:"First aid given, incident reported",status:"Closed",daysLost:0},
  ]);
  const [safetyStats] = useState({ltiDays:0,nearMisses:2,firstAid:1,toolboxThisMonth:6,lastInspection:"2026-05-08",inspectionScore:87});
  const [weatherLog, setWeatherLog] = useState([
    {id:6001,date:"2026-04-22",condition:"Heavy Rain",lostHours:8,activitiesAffected:"Concrete pours, Excavation",contractAllowance:"Y",notes:"Full day lost"},
    {id:6002,date:"2026-05-01",condition:"High Winds >60km/h",lostHours:4,activitiesAffected:"Crane ops, Facade work",contractAllowance:"Y",notes:"Half day – crane grounded"},
    {id:6003,date:"2026-05-07",condition:"Heavy Rain",lostHours:8,activitiesAffected:"External works",contractAllowance:"Y",notes:"Full day lost"},
  ]);
  const [decisions, setDecisions] = useState([
    {id:7001,ref:"DEC-001",description:"Approve revised pile cap design",requiredFrom:"Structural Engineer",raisedDate:"2026-04-12",dueDate:"2026-04-19",decidedDate:"2026-04-18",status:"Decided",priority:"High",impact:"Unblocks foundation pour"},
    {id:7002,ref:"DEC-002",description:"Confirm final curtain wall colour selection",requiredFrom:"Client",raisedDate:"2026-05-01",dueDate:"2026-05-15",decidedDate:"",status:"Pending",priority:"High",impact:"Blocks facade procurement order"},
    {id:7003,ref:"DEC-003",description:"Approve change to raised floor system spec",requiredFrom:"Client / Engineer",raisedDate:"2026-05-08",dueDate:"2026-05-22",decidedDate:"",status:"Pending",priority:"Medium",impact:"3-day impact if delayed past due date"},
  ]);
  const [actionItems, setActionItems] = useState([
    {id:8001,ref:"ACT-001",description:"Issue revised structural drawings to site",owner:"Design Manager",dueDate:"2026-05-14",status:"Open",priority:"High",meeting:"Design Coordination – 08 May"},
    {id:8002,ref:"ACT-002",description:"Submit BMS integration schedule to MEP sub",owner:"PM",dueDate:"2026-05-12",status:"Overdue",priority:"Critical",meeting:"MEP Coordination – 06 May"},
    {id:8003,ref:"ACT-003",description:"Confirm concrete pour sequence with structural engineer",owner:"Site Engineer",dueDate:"2026-05-16",status:"Open",priority:"Medium",meeting:"Weekly Site Meeting – 09 May"},
  ]);

  /* ── Phase 3 module state ── */
  // Cash Flow
  const [cashFlow] = useState([
    {month:"Apr 2026",planned:180000,actual:162000,cumPlanned:180000,cumActual:162000,certified:155000,paid:155000},
    {month:"May 2026",planned:340000,actual:298000,cumPlanned:520000,cumActual:460000,certified:285000,paid:285000},
    {month:"Jun 2026",planned:520000,actual:0,cumPlanned:1040000,cumActual:0,certified:0,paid:0},
    {month:"Jul 2026",planned:680000,actual:0,cumPlanned:1720000,cumActual:0,certified:0,paid:0},
    {month:"Aug 2026",planned:750000,actual:0,cumPlanned:2470000,cumActual:0,certified:0,paid:0},
    {month:"Sep 2026",planned:820000,actual:0,cumPlanned:3290000,cumActual:0,certified:0,paid:0},
    {month:"Oct 2026",planned:860000,actual:0,cumPlanned:4150000,cumActual:0,certified:0,paid:0},
    {month:"Nov 2026",planned:900000,actual:0,cumPlanned:5050000,cumActual:0,certified:0,paid:0},
  ]);
  const [paymentCerts, setPaymentCerts] = useState([
    {id:9001,ref:"IPC-001",period:"April 2026",submitted:"2026-05-01",certified:"2026-05-08",paid:"2026-05-15",claimAmount:162000,certifiedAmount:155000,status:"Paid",retention:7750},
    {id:9002,ref:"IPC-002",period:"May 2026",submitted:"2026-06-01",certified:"",paid:"",claimAmount:298000,certifiedAmount:0,status:"Under Assessment",retention:0},
  ]);

  // Drawing Register
  const [drawings, setDrawings] = useState([
    {id:10001,drawingNo:"STR-001",title:"Foundation Layout & Pile Cap Details",discipline:"Structural",rev:"C",issued:"2026-04-10",status:"Issued for Construction",format:"A1",siteConfirmed:true,notes:""},
    {id:10002,drawingNo:"STR-002",title:"Ground Floor Slab Reinforcement",discipline:"Structural",rev:"B",issued:"2026-04-18",status:"Issued for Construction",format:"A1",siteConfirmed:true,notes:""},
    {id:10003,drawingNo:"STR-003",title:"Upper Floor Typical Beam Schedule",discipline:"Structural",rev:"A",issued:"2026-05-02",status:"For Comment",format:"A1",siteConfirmed:false,notes:"Rev B expected 20 May"},
    {id:10004,drawingNo:"ARC-001",title:"Curtain Wall Elevation & Details",discipline:"Architecture",rev:"A",issued:"2026-05-05",status:"For Approval",format:"A0",siteConfirmed:false,notes:"Pending client sign-off"},
    {id:10005,drawingNo:"MEP-001",title:"HVAC Ductwork Layout — L01",discipline:"Mechanical",rev:"B",issued:"2026-04-28",status:"Issued for Construction",format:"A1",siteConfirmed:true,notes:""},
    {id:10006,drawingNo:"MEP-002",title:"LV Distribution Single Line Diagram",discipline:"Electrical",rev:"A",issued:"2026-05-01",status:"For Comment",format:"A1",siteConfirmed:false,notes:""},
  ]);

  // Defects & Snagging
  const [defects, setDefects] = useState([
    {id:11001,ref:"DEF-001",description:"Honeycombing on column C3 ground floor",location:"GF – Grid C3",discipline:"Structural",raisedBy:"Site Engineer",raisedDate:"2026-04-20",dueDate:"2026-04-27",closedDate:"2026-04-26",status:"Closed",priority:"High",responsible:"StructBuild Ltd",cost:3200,photo:false},
    {id:11002,ref:"DEF-002",description:"Curtain wall seal gap at floor 2 corner junction",location:"FL2 – North Facade",discipline:"Façade",raisedBy:"QA Inspector",raisedDate:"2026-05-04",dueDate:"2026-05-11",closedDate:"",status:"Open",priority:"High",responsible:"FaçadeTech Systems",cost:0,photo:false},
    {id:11003,ref:"DEF-003",description:"Raised floor panel misalignment — floor 1 east wing",location:"FL1 – East Wing",discipline:"Finishes",raisedBy:"PM",raisedDate:"2026-05-06",dueDate:"2026-05-13",closedDate:"",status:"Open",priority:"Medium",responsible:"Interior Finish Co.",cost:0,photo:false},
    {id:11004,ref:"DEF-004",description:"Incorrect pipe insulation spec in plant room",location:"Roof – Plant Room",discipline:"Mechanical",raisedBy:"MEP Inspector",raisedDate:"2026-05-08",dueDate:"2026-05-15",closedDate:"",status:"Open",priority:"Medium",responsible:"MEP Contractors Ltd",cost:0,photo:false},
  ]);

  // Daily Site Diary
  const [diaryEntries, setDiaryEntries] = useState([
    {id:12001,date:"2026-05-09",weather:"Sunny 24°C",totalWorkers:127,visitors:"Client rep — John Smith",workDone:"Poured columns B4-B8 GF. Curtain wall brackets installed FL1 north. MEP first fix commenced FL2.",issues:"Concrete pump broke down 2 hrs — delay to pour schedule.",instructions:"PM instructed StructBuild to accelerate slab reinforcement next week.",plant:"Tower crane, concrete pump, scissor lift x2, forklift",materials:"Concrete 32 m³, Rebar 4.2t, Curtain wall brackets batch 3",notes:""},
  ]);
  const [newDiary, setNewDiary] = useState({date:new Date().toISOString().split("T")[0],weather:"",totalWorkers:0,visitors:"",workDone:"",issues:"",instructions:"",plant:"",materials:"",notes:""});

  // What-If Scenario
  const [scenarios, setScenarios] = useState([
    {id:13001,name:"Curtain Wall 2-Week Delay",activityId:"",delayDays:14,description:"FaçadeTech unable to mobilise on time",impactOnCritical:true,projectedNewFinish:"",mitigationOptions:"Accelerate internal finishes in parallel; pre-order all fixings",createdDate:"2026-05-09"},
    {id:13002,name:"MEP Re-sequencing",activityId:"",delayDays:7,description:"BMS integration RFI causes MEP rework",impactOnCritical:false,projectedNewFinish:"",mitigationOptions:"Engage BMS specialist for rapid response",createdDate:"2026-05-09"},
  ]);

  // Project Directory
  const [contacts, setContacts] = useState([
    {id:14001,name:"Ahmed Al-Rashidi",role:"Project Manager",company:"Main Contractor",phone:"+971 50 123 4567",email:"ahmed@contractor.com",discipline:"Management",category:"Client-Facing"},
    {id:14002,name:"Sarah Mitchell",role:"Structural Engineer",company:"Design Consultants LLC",phone:"+971 55 234 5678",email:"sarah@design.com",discipline:"Structural",category:"Design Team"},
    {id:14003,name:"Khalid Hassan",role:"Client Representative",company:"Property Development Co.",phone:"+971 50 345 6789",email:"khalid@client.com",discipline:"Client",category:"Client"},
    {id:14004,name:"Maria Santos",role:"QA/QC Manager",company:"Main Contractor",phone:"+971 55 456 7890",email:"maria@contractor.com",discipline:"Quality",category:"Site Team"},
    {id:14005,name:"James O'Brien",role:"MEP Manager",company:"MEP Contractors Ltd",phone:"+971 50 567 8901",email:"james@mep.com",discipline:"MEP",category:"Subcontractor"},
  ]);

  // Permits
  const [permits, setPermits] = useState([
    {id:15001,ref:"PERM-001",description:"Building Construction Permit",authority:"Municipality",applied:"2026-03-01",approved:"2026-03-20",expiry:"2027-03-20",status:"Active",notes:""},
    {id:15002,ref:"PERM-002",description:"Excavation & Shoring Permit",authority:"Municipality",applied:"2026-03-10",approved:"2026-03-25",expiry:"2026-09-25",status:"Active",notes:"Renewal required before Sep"},
    {id:15003,ref:"PERM-003",description:"Crane Erection Permit",authority:"Civil Aviation",applied:"2026-04-01",approved:"2026-04-12",expiry:"2027-04-12",status:"Active",notes:""},
    {id:15004,ref:"PERM-004",description:"Temporary Power Connection",authority:"Utility Authority",applied:"2026-04-15",approved:"",expiry:"",status:"Pending",notes:"Chased 5 May — awaiting approval"},
  ]);

  /* ── Phase 4 module state ── */
  // AI Assistant
  const [aiPanel, setAiPanel] = useState(false);
  const [aiMode, setAiMode] = useState("briefing");
  const [aiOutput, setAiOutput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMeetingNotes, setAiMeetingNotes] = useState("");

  // ITP - Inspection & Test Plans
  const [itpItems, setItpItems] = useState([
    {id:16001,ref:"ITP-001",activity:"Pile Installation",description:"Pre-pour inspection of piling rig alignment",discipline:"Structural",phase:"Earthworks",inspectedBy:"Site Engineer",witnessedBy:"Structural Engineer",type:"Hold Point",status:"Passed",date:"2026-04-08",result:"Pass",notes:""},
    {id:16002,ref:"ITP-002",activity:"Raft Foundation Concrete Pour",description:"Pre-pour reinforcement check & concrete slump test",discipline:"Structural",phase:"Earthworks",inspectedBy:"QA Manager",witnessedBy:"Structural Engineer",type:"Hold Point",status:"Passed",date:"2026-04-20",result:"Pass",notes:"Slump 110mm — within spec"},
    {id:16003,ref:"ITP-003",activity:"Ground Floor Slab RC Pour",description:"Formwork inspection + rebar cover check + cube sampling",discipline:"Structural",phase:"Concrete Structure",inspectedBy:"Site Engineer",witnessedBy:"Structural Engineer",type:"Witness Point",status:"Passed",date:"2026-05-03",result:"Pass",notes:"3 cube samples taken"},
    {id:16004,ref:"ITP-004",activity:"Curtain Wall Level 01 Installation",description:"Anchor bracket torque test + alignment check",discipline:"Façade",phase:"External Works",inspectedBy:"QA Manager",witnessedBy:"Façade Consultant",type:"Hold Point",status:"Pending",date:"",result:"",notes:"Scheduled when facade sub mobilises"},
    {id:16005,ref:"ITP-005",activity:"HVAC Ductwork Pressure Test",description:"Ductwork leakage test at 1.5× operating pressure",discipline:"Mechanical",phase:"MEP",inspectedBy:"MEP Engineer",witnessedBy:"Client Rep",type:"Witness Point",status:"Not Due",date:"",result:"",notes:""},
  ]);

  // NCR - Non-Conformance Reports
  const [ncrs, setNcrs] = useState([
    {id:17001,ref:"NCR-001",description:"Column C3 GF: honeycombing exceeds 50mm depth — remediation required",discipline:"Structural",raisedBy:"QA Manager",raisedDate:"2026-04-21",dueDate:"2026-04-28",closedDate:"2026-04-27",status:"Closed",severity:"Major",disposition:"Repair: epoxy injection + render",responsible:"StructBuild Ltd",rootCause:"Inadequate vibration during pour",cost:4200},
    {id:17002,ref:"NCR-002",description:"Rebar cover insufficient on beam B7 FL2 — min 40mm required, 28mm found",discipline:"Structural",raisedBy:"Site Engineer",raisedDate:"2026-05-05",dueDate:"2026-05-12",closedDate:"",status:"Open",severity:"Major",disposition:"Pending structural engineer review",responsible:"StructBuild Ltd",rootCause:"Wrong spacers used",cost:0},
    {id:17003,ref:"NCR-003",description:"Curtain wall bracket installed at wrong elevation — 15mm low on grid D FL1",discipline:"Façade",raisedBy:"QA Manager",raisedDate:"2026-05-07",dueDate:"2026-05-14",closedDate:"",status:"Open",severity:"Minor",disposition:"Reposition bracket pending consultant approval",responsible:"FaçadeTech Systems",rootCause:"Incorrect setting-out",cost:0},
  ]);

  // Baseline vs Current
  const [showBaseline, setShowBaseline] = useState(true);

  // Full Procurement Tracker
  const [procurement, setProcurement] = useState([
    {id:18001,ref:"PROC-001",item:"Tower Crane",category:"Plant",supplier:"CraneHire Ltd",tenderDate:"2026-03-01",awardDate:"2026-03-10",shopDrawings:"N/A",fabricationStart:"N/A",deliveryPlanned:"2026-04-01",deliveryActual:"2026-04-01",installPlanned:"2026-04-05",installActual:"2026-04-05",status:"Installed",leadWeeks:4,notes:""},
    {id:18002,ref:"PROC-002",item:"Structural Steel",category:"Material",supplier:"SteelFab Co.",tenderDate:"2026-03-15",awardDate:"2026-03-28",shopDrawings:"Approved",fabricationStart:"2026-04-05",deliveryPlanned:"2026-05-20",deliveryActual:"",installPlanned:"2026-05-25",installActual:"",status:"In Fabrication",leadWeeks:8,notes:"Shop drawings approved 03 May"},
    {id:18003,ref:"PROC-003",item:"Curtain Wall System",category:"Specialist",supplier:"FaçadeTech Systems",tenderDate:"2026-03-20",awardDate:"2026-04-05",shopDrawings:"Under Review",fabricationStart:"",deliveryPlanned:"2026-06-15",deliveryActual:"",installPlanned:"2026-06-22",installActual:"",status:"Shop Drawings",leadWeeks:12,notes:"Awaiting client colour approval (DEC-002)"},
    {id:18004,ref:"PROC-004",item:"Passenger Lifts ×3",category:"Specialist",supplier:"Lift Systems Inc.",tenderDate:"2026-03-01",awardDate:"2026-03-18",shopDrawings:"Approved",fabricationStart:"2026-04-01",deliveryPlanned:"2026-07-01",deliveryActual:"",installPlanned:"2026-07-15",installActual:"",status:"In Fabrication",leadWeeks:16,notes:""},
    {id:18005,ref:"PROC-005",item:"AHU Units ×8",category:"Equipment",supplier:"HVAC Supply Co.",tenderDate:"2026-04-01",awardDate:"2026-04-15",shopDrawings:"Approved",fabricationStart:"2026-05-01",deliveryPlanned:"2026-06-30",deliveryActual:"",installPlanned:"2026-07-10",installActual:"",status:"In Fabrication",leadWeeks:10,notes:""},
    {id:18006,ref:"PROC-006",item:"Main LV Switchgear",category:"Electrical",supplier:"ElecDist Ltd",tenderDate:"2026-04-01",awardDate:"2026-04-20",shopDrawings:"Approved",fabricationStart:"2026-05-10",deliveryPlanned:"2026-07-15",deliveryActual:"",installPlanned:"2026-07-22",installActual:"",status:"Order Placed",leadWeeks:12,notes:"Factory inspection required"},
  ]);

  // EOT & LD
  const [eotClaims, setEotClaims] = useState([
    {id:19001,ref:"EOT-001",event:"Unforeseen ground conditions — additional pile depths",dateOfEvent:"2026-04-08",noticeSent:"2026-04-10",daysClamed:14,daysGranted:10,status:"Partially Approved",value:145000,ldExposure:0,linkedRFI:"",linkedCO:"CO-001",notes:"Structural engineer confirmed additional piling scope"},
    {id:19002,ref:"EOT-002",event:"Client delay in curtain wall colour approval",dateOfEvent:"2026-05-01",noticeSent:"2026-05-03",daysClamed:10,daysGranted:0,status:"Under Assessment",value:0,ldExposure:0,linkedRFI:"RFI-002",linkedCO:"CO-002",notes:"Dependent on DEC-002 decision"},
  ]);
  const [ldRate] = useState(8500); // liquidated damages per day
  const [contractCompletionDay] = useState(390);

  // Material Test Results
  const [materialTests, setMaterialTests] = useState([
    {id:20001,ref:"TEST-001",material:"Concrete C32/40 — Raft Foundation",testType:"Cube Compressive Strength",date:"2026-04-22",specValue:"32 MPa @ 28 days",actualValue:"36.2 MPa",result:"Pass",testedBy:"Lab Services Ltd",certificate:"CERT-0042",notes:"28-day result"},
    {id:20002,ref:"TEST-002",material:"Concrete C32/40 — GF Columns",testType:"Cube Compressive Strength",date:"2026-05-05",specValue:"32 MPa @ 28 days",actualValue:"34.8 MPa",result:"Pass",testedBy:"Lab Services Ltd",certificate:"CERT-0051",notes:""},
    {id:20003,ref:"TEST-003",material:"Rebar B500B — 16mm dia",testType:"Tensile Strength",date:"2026-04-15",specValue:"500 MPa yield",actualValue:"512 MPa",result:"Pass",testedBy:"Lab Services Ltd",certificate:"CERT-0038",notes:"Mill cert also received"},
    {id:20004,ref:"TEST-004",material:"Compacted Fill — Basement",testType:"Proctor Compaction",date:"2026-04-10",specValue:"≥95% MDD",actualValue:"93.2%",result:"Fail",testedBy:"Geotech Lab",certificate:"",notes:"Recompaction ordered — retest pending"},
  ]);

  // Productivity Tracker
  const [productivity, setProductivity] = useState([
    {id:21001,trade:"Concrete Structure",metric:"Concrete placed",unit:"m³/day",planned:45,actual:38,week:"W18",phase:"Concrete Structure",notes:"Pump downtime affected output"},
    {id:21002,trade:"Reinforcement",metric:"Rebar fixed",unit:"t/day",planned:3.5,actual:3.2,week:"W18",phase:"Concrete Structure",notes:""},
    {id:21003,trade:"Curtain Wall",metric:"Panels installed",unit:"panels/day",planned:12,actual:0,week:"W18",phase:"External Works",notes:"Not yet mobilised"},
    {id:21004,trade:"MEP First Fix",metric:"Conduit installed",unit:"m/day",planned:180,actual:165,week:"W18",phase:"MEP",notes:"Good progress"},
  ]);

  /* ── Phase 5 module state ── */
  // Handover & Commissioning
  const [commSystems, setCommSystems] = useState([
    {id:22001,system:"HVAC — Chillers & AHUs",discipline:"Mechanical",contractor:"MEP Contractors Ltd",preComm:"Passed",staticComm:"Pending",dynamicComm:"Not Started",clientWitness:"Not Started",omatReceived:false,asBuiltReceived:false,warrantyReceived:false,trainingDone:false,status:"In Progress",targetDate:"2027-01-15",notes:""},
    {id:22002,system:"LV Switchgear & Distribution",discipline:"Electrical",contractor:"MEP Contractors Ltd",preComm:"Passed",staticComm:"Passed",dynamicComm:"Pending",clientWitness:"Not Started",omatReceived:false,asBuiltReceived:false,warrantyReceived:false,trainingDone:false,status:"In Progress",targetDate:"2027-01-20",notes:""},
    {id:22003,system:"Passenger Lifts ×3",discipline:"Specialist",contractor:"Lift Systems Inc.",preComm:"Not Started",staticComm:"Not Started",dynamicComm:"Not Started",clientWitness:"Not Started",omatReceived:false,asBuiltReceived:false,warrantyReceived:false,trainingDone:false,status:"Not Started",targetDate:"2027-02-01",notes:"Installation not yet commenced"},
    {id:22004,system:"Fire Detection & Alarm",discipline:"Fire Protection",contractor:"MEP Contractors Ltd",preComm:"Passed",staticComm:"Passed",dynamicComm:"Passed",clientWitness:"Passed",omatReceived:true,asBuiltReceived:true,warrantyReceived:false,trainingDone:true,status:"Near Complete",targetDate:"2026-12-15",notes:"Warranty cert expected Dec"},
    {id:22005,system:"BMS — Building Management",discipline:"Controls",contractor:"BMS Specialist",preComm:"Not Started",staticComm:"Not Started",dynamicComm:"Not Started",clientWitness:"Not Started",omatReceived:false,asBuiltReceived:false,warrantyReceived:false,trainingDone:false,status:"Not Started",targetDate:"2027-02-15",notes:"Awaiting RFI-003 resolution"},
    {id:22006,system:"Curtain Wall — Water Tightness",discipline:"Façade",contractor:"FaçadeTech Systems",preComm:"Not Started",staticComm:"Not Started",dynamicComm:"Not Started",clientWitness:"Not Started",omatReceived:false,asBuiltReceived:false,warrantyReceived:false,trainingDone:false,status:"Not Started",targetDate:"2027-01-10",notes:""},
  ]);

  // Handover Checklist Items
  const [handoverItems, setHandoverItems] = useState([
    {id:23001,category:"Documentation",item:"As-Built Drawings (all disciplines)",responsible:"Design Manager",dueDate:"2027-02-01",status:"Pending",notes:""},
    {id:23002,category:"Documentation",item:"O&M Manuals (all systems)",responsible:"PM",dueDate:"2027-02-01",status:"Pending",notes:""},
    {id:23003,category:"Documentation",item:"Material & Equipment Warranties",responsible:"PM",dueDate:"2027-02-01",status:"Pending",notes:""},
    {id:23004,category:"Documentation",item:"Test & Commissioning Certificates",responsible:"QA Manager",dueDate:"2027-02-01",status:"Pending",notes:""},
    {id:23005,category:"Regulatory",item:"Final Building Completion Certificate",responsible:"PM",dueDate:"2027-02-10",status:"Not Started",notes:""},
    {id:23006,category:"Regulatory",item:"Fire Authority Clearance",responsible:"PM",dueDate:"2027-01-20",status:"Pending",notes:"Inspection booked"},
    {id:23007,category:"Regulatory",item:"Elevator Inspector Certificate",responsible:"Lift Systems Inc.",dueDate:"2027-02-05",status:"Not Started",notes:""},
    {id:23008,category:"Physical",item:"Snagging List Cleared (100%)",responsible:"PM",dueDate:"2027-02-01",status:"In Progress",notes:""},
    {id:23009,category:"Physical",item:"All Keys & Access Cards Handed Over",responsible:"Site Manager",dueDate:"2027-02-15",status:"Not Started",notes:""},
    {id:23010,category:"Physical",item:"Temporary Fencing & Hoarding Removed",responsible:"Site Manager",dueDate:"2027-02-14",status:"Not Started",notes:""},
    {id:23011,category:"Training",item:"Client Facilities Team HVAC Training",responsible:"MEP Contractors Ltd",dueDate:"2027-02-10",status:"Completed",notes:"Done 08 May"},
    {id:23012,category:"Training",item:"Client IT Team BMS Interface Training",responsible:"BMS Specialist",dueDate:"2027-02-12",status:"Not Started",notes:""},
  ]);

  // Transmittal Register
  const [transmittals, setTransmittals] = useState([
    {id:24001,ref:"TR-001",subject:"Issue Structural Drawings Rev C for Construction",from:"Design Consultants LLC",to:"Main Contractor",date:"2026-04-10",documents:"STR-001 Rev C, STR-002 Rev B",purpose:"For Construction",received:true,receivedDate:"2026-04-11",notes:""},
    {id:24002,ref:"TR-002",subject:"Submittal: Structural Steel Shop Drawings",from:"StructBuild Ltd",to:"Design Consultants LLC",date:"2026-04-20",documents:"SUB-001 Rev A",purpose:"For Approval",received:true,receivedDate:"2026-04-20",notes:""},
    {id:24003,ref:"TR-003",subject:"RFI Response: Pile Cap Reinforcement",from:"Design Consultants LLC",to:"Main Contractor",date:"2026-04-16",documents:"RFI-001 Response",purpose:"For Information",received:true,receivedDate:"2026-04-16",notes:""},
    {id:24004,ref:"TR-004",subject:"Issue Curtain Wall Shop Drawings for Review",from:"FaçadeTech Systems",to:"Design Consultants LLC",date:"2026-05-05",documents:"SUB-002 Rev A",purpose:"For Comment",received:false,receivedDate:"",notes:"Awaiting confirmation of receipt"},
    {id:24005,ref:"TR-005",subject:"EOT-001 Notice & Supporting Documentation",from:"Main Contractor",to:"Client / QS",date:"2026-04-10",documents:"EOT-001 Claim Pack",purpose:"For Approval",received:true,receivedDate:"2026-04-11",notes:""},
  ]);

  // Correspondence Log
  const [correspondence, setCorrespondence] = useState([
    {id:25001,ref:"LTR-001",type:"Letter",subject:"Notice of Delay — Unforeseen Ground Conditions",from:"Main Contractor",to:"Client",date:"2026-04-10",direction:"Sent",category:"EOT / Claim",status:"Acknowledged",linkedRef:"EOT-001",notes:"Formal notice under clause 28.1"},
    {id:25002,ref:"LTR-002",type:"Letter",subject:"Response to Notice of Delay — Request for Further Evidence",from:"Client",to:"Main Contractor",date:"2026-04-18",direction:"Received",category:"EOT / Claim",status:"Action Required",linkedRef:"EOT-001",notes:"Geotechnical report requested"},
    {id:25003,ref:"EMAIL-001",type:"Email of Record",subject:"Client Direction — Curtain Wall Colour Deferral",from:"Client Rep (Khalid Hassan)",to:"PM (Ahmed Al-Rashidi)",date:"2026-05-03",direction:"Received",category:"Client Instruction",status:"Acknowledged",linkedRef:"DEC-002",notes:"Confirms client is aware of schedule consequence"},
    {id:25004,ref:"LTR-003",type:"Formal Notice",subject:"Warning Notice — Payment Overdue (FaçadeTech Systems)",from:"Main Contractor",to:"FaçadeTech Systems",date:"2026-05-05",direction:"Sent",category:"Commercial",status:"Pending Response",linkedRef:"",notes:"7-day notice period. Risk of suspension of works."},
  ]);

  // Schedule Compression Scenarios
  const [compressionScenarios, setCompressionScenarios] = useState([
    {id:26001,name:"Overtime — Critical Trade 6d/week",description:"Extend structural and MEP crews to 6 days/week",timeSaved:18,additionalCost:145000,feasibility:"High",risks:"Fatigue, HSE compliance, premium rates",status:"Under Review"},
    {id:26002,name:"Fast-Track MEP & Finishes",description:"Commence MEP first fix before all concrete structure complete",timeSaved:12,additionalCost:65000,feasibility:"Medium",risks:"Interface clashes, coordination risk, potential rework",status:"Approved"},
    {id:26003,name:"Additional Tower Crane",description:"Mobilise second tower crane to serve north and south zones independently",timeSaved:25,additionalCost:280000,feasibility:"Medium",risks:"Site congestion, planning approval needed, 3wk mobilisation",status:"Rejected"},
    {id:26004,name:"Pre-fabricated MEP Modules",description:"Switch to pre-fab risers and bathroom pods off-site",timeSaved:15,additionalCost:195000,feasibility:"Low",risks:"Design freeze required immediately, supplier lead time 10 weeks",status:"Under Review"},
  ]);

  // Cost-to-Complete by Phase
  const [phaseFinancials] = useState([
    {phase:"Earthworks & Piling",budgeted:850000,spent:892000,committed:892000,forecast:892000,status:"Complete"},
    {phase:"Concrete Structure",budgeted:2200000,spent:980000,committed:1350000,forecast:2310000,status:"In Progress"},
    {phase:"External Façade",budgeted:1085000,spent:0,committed:108500,forecast:1140000,status:"Not Started"},
    {phase:"Mechanical & Electrical",budgeted:1266550,spent:95000,committed:380000,forecast:1320000,status:"In Progress"},
    {phase:"Lifts & Specialist",budgeted:555000,spent:0,committed:55500,forecast:555000,status:"Not Started"},
    {phase:"Internal Finishes",budgeted:819800,spent:0,committed:0,forecast:860000,status:"Not Started"},
    {phase:"External Works",budgeted:324650,spent:0,committed:0,forecast:324650,status:"Not Started"},
  ]);

  /* ══ PHASE 6: INTEGRATED COST CONTROL & INVOICING ══ */

  // Cost Code Master
  const [costCodes] = useState([
    {code:"01.00",desc:"Preliminaries & Mobilisation",trade:"General",category:"Indirect"},
    {code:"02.10",desc:"Excavation & Earthworks",trade:"Civil",category:"Direct"},
    {code:"02.20",desc:"Piling & Foundations",trade:"Civil",category:"Direct"},
    {code:"03.10",desc:"Concrete Structure — Below Grade",trade:"Structural",category:"Direct"},
    {code:"03.20",desc:"Concrete Structure — Superstructure",trade:"Structural",category:"Direct"},
    {code:"03.30",desc:"Reinforcement Steel",trade:"Structural",category:"Direct"},
    {code:"03.40",desc:"Structural Steel",trade:"Structural",category:"Direct"},
    {code:"04.10",desc:"Masonry & Blockwork",trade:"Architectural",category:"Direct"},
    {code:"05.10",desc:"Curtain Wall & Glazing",trade:"Façade",category:"Direct"},
    {code:"06.10",desc:"Roofing & Waterproofing",trade:"Architectural",category:"Direct"},
    {code:"07.10",desc:"Mechanical — HVAC",trade:"MEP",category:"Direct"},
    {code:"07.20",desc:"Plumbing & Drainage",trade:"MEP",category:"Direct"},
    {code:"07.30",desc:"Electrical — LV",trade:"MEP",category:"Direct"},
    {code:"07.40",desc:"Fire Protection",trade:"MEP",category:"Direct"},
    {code:"07.50",desc:"BMS & Controls",trade:"MEP",category:"Direct"},
    {code:"08.10",desc:"Passenger Lifts",trade:"Specialist",category:"Direct"},
    {code:"09.10",desc:"Internal Partitions & Ceilings",trade:"Finishes",category:"Direct"},
    {code:"09.20",desc:"Floor Finishes",trade:"Finishes",category:"Direct"},
    {code:"09.30",desc:"Painting & Decoration",trade:"Finishes",category:"Direct"},
    {code:"10.10",desc:"External Hardscape & Landscaping",trade:"External",category:"Direct"},
    {code:"11.00",desc:"Provisional Sums",trade:"General",category:"Provisional"},
    {code:"99.10",desc:"Site Overheads",trade:"General",category:"Overhead"},
    {code:"99.20",desc:"Head Office Overhead",trade:"General",category:"Overhead"},
    {code:"99.30",desc:"Contingency Reserve",trade:"General",category:"Contingency"},
  ]);

  // Activity Cost Breakdown (per activity, linked to schedule)
  const [activityCosts, setActivityCosts] = useState([
    {id:"AC001",activityRef:"1",costCode:"02.10",wbs:"1.1",zone:"Zone A — Basement",trade:"Civil",
     budgetLabour:28000,budgetMaterial:12000,budgetEquipment:45000,budgetSubcontract:0,budgetIndirect:4000,budgetOverhead:6000,budgetContingency:4750,
     committedLabour:28000,committedMaterial:12000,committedEquipment:45000,committedSubcontract:0,
     actualLabour:26500,actualMaterial:11200,actualEquipment:44000,actualSubcontract:0,
     forecastLabour:27000,forecastMaterial:12000,forecastEquipment:45000,forecastSubcontract:0,
     status:"Complete",percentComplete:100,notes:""},
    {id:"AC002",activityRef:"2",costCode:"02.20",wbs:"1.2",zone:"Zone A — Basement",trade:"Civil",
     budgetLabour:42000,budgetMaterial:85000,budgetEquipment:95000,budgetSubcontract:118000,budgetIndirect:8000,budgetOverhead:12000,budgetContingency:18000,
     committedLabour:42000,committedMaterial:85000,committedEquipment:95000,committedSubcontract:118000,
     actualLabour:39500,actualMaterial:82000,actualEquipment:93000,actualSubcontract:115000,
     forecastLabour:39500,forecastMaterial:82000,forecastEquipment:93000,forecastSubcontract:115000,
     status:"Complete",percentComplete:100,notes:""},
    {id:"AC003",activityRef:"3",costCode:"03.10",wbs:"2.1",zone:"Zone A-D — Ground Floor",trade:"Structural",
     budgetLabour:65000,budgetMaterial:220000,budgetEquipment:35000,budgetSubcontract:0,budgetIndirect:12000,budgetOverhead:16000,budgetContingency:17400,
     committedLabour:65000,committedMaterial:218000,committedEquipment:35000,committedSubcontract:0,
     actualLabour:61000,actualMaterial:210000,actualEquipment:34000,actualSubcontract:0,
     forecastLabour:63000,forecastMaterial:215000,forecastEquipment:35000,forecastSubcontract:0,
     status:"Complete",percentComplete:100,notes:""},
    {id:"AC004",activityRef:"4",costCode:"03.20",wbs:"2.2",zone:"Zone A-D — FL1 to RF",trade:"Structural",
     budgetLabour:180000,budgetMaterial:620000,budgetEquipment:85000,budgetSubcontract:0,budgetIndirect:32000,budgetOverhead:45000,budgetContingency:48100,
     committedLabour:175000,committedMaterial:605000,committedEquipment:82000,committedSubcontract:0,
     actualLabour:90000,actualMaterial:310000,actualEquipment:42000,actualSubcontract:0,
     forecastLabour:185000,forecastMaterial:630000,forecastEquipment:86000,forecastSubcontract:0,
     status:"In Progress",percentComplete:52,notes:"Floors 1-3 complete; 4-5 in progress"},
    {id:"AC005",activityRef:"5",costCode:"05.10",wbs:"3.1",zone:"All Elevations",trade:"Façade",
     budgetLabour:45000,budgetMaterial:680000,budgetEquipment:22000,budgetSubcontract:338000,budgetIndirect:18000,budgetOverhead:25000,budgetContingency:56400,
     committedLabour:45000,committedMaterial:680000,committedEquipment:22000,committedSubcontract:338000,
     actualLabour:0,actualMaterial:0,actualEquipment:0,actualSubcontract:0,
     forecastLabour:48000,forecastMaterial:695000,forecastEquipment:24000,forecastSubcontract:350000,
     status:"Not Started",percentComplete:0,notes:"Awaiting client colour approval"},
    {id:"AC006",activityRef:"6",costCode:"07.10",wbs:"4.1",zone:"All Floors",trade:"MEP",
     budgetLabour:95000,budgetMaterial:485000,budgetEquipment:18000,budgetSubcontract:0,budgetIndirect:24000,budgetOverhead:32000,budgetContingency:32700,
     committedLabour:90000,committedMaterial:470000,committedEquipment:17000,committedSubcontract:0,
     actualLabour:20000,actualMaterial:95000,actualEquipment:4000,actualSubcontract:0,
     forecastLabour:98000,forecastMaterial:492000,forecastEquipment:19000,forecastSubcontract:0,
     status:"In Progress",percentComplete:18,notes:"First fix FL1-FL2 in progress"},
    {id:"AC007",activityRef:"7",costCode:"07.30",wbs:"4.3",zone:"All Floors",trade:"MEP",
     budgetLabour:88000,budgetMaterial:392000,budgetEquipment:12000,budgetSubcontract:0,budgetIndirect:20000,budgetOverhead:28000,budgetContingency:27000,
     committedLabour:85000,committedMaterial:385000,committedEquipment:12000,committedSubcontract:0,
     actualLabour:18000,actualMaterial:78000,actualEquipment:3000,actualSubcontract:0,
     forecastLabour:91000,forecastMaterial:398000,forecastEquipment:13000,forecastSubcontract:0,
     status:"In Progress",percentComplete:19,notes:""},
    {id:"AC008",activityRef:"8",costCode:"08.10",wbs:"5.1",zone:"Core — All Floors",trade:"Specialist",
     budgetLabour:0,budgetMaterial:0,budgetEquipment:0,budgetSubcontract:555000,budgetIndirect:12000,budgetOverhead:18000,budgetContingency:28500,
     committedLabour:0,committedMaterial:0,committedEquipment:0,committedSubcontract:555000,
     actualLabour:0,actualMaterial:0,actualEquipment:0,actualSubcontract:0,
     forecastLabour:0,forecastMaterial:0,forecastEquipment:0,forecastSubcontract:555000,
     status:"Not Started",percentComplete:0,notes:""},
    {id:"AC009",activityRef:"9",costCode:"09.10",wbs:"6.1",zone:"All Office Floors",trade:"Finishes",
     budgetLabour:120000,budgetMaterial:380000,budgetEquipment:8000,budgetSubcontract:0,budgetIndirect:20000,budgetOverhead:26000,budgetContingency:27700,
     committedLabour:0,committedMaterial:0,committedEquipment:0,committedSubcontract:0,
     actualLabour:0,actualMaterial:0,actualEquipment:0,actualSubcontract:0,
     forecastLabour:125000,forecastMaterial:390000,forecastEquipment:9000,forecastSubcontract:0,
     status:"Not Started",percentComplete:0,notes:""},
    {id:"AC010",activityRef:"10",costCode:"10.10",wbs:"7.1",zone:"External",trade:"External",
     budgetLabour:38000,budgetMaterial:185000,budgetEquipment:15000,budgetSubcontract:0,budgetIndirect:8000,budgetOverhead:12000,budgetContingency:12900,
     committedLabour:0,committedMaterial:0,committedEquipment:0,committedSubcontract:0,
     actualLabour:0,actualMaterial:0,actualEquipment:0,actualSubcontract:0,
     forecastLabour:38000,forecastMaterial:185000,forecastEquipment:15000,forecastSubcontract:0,
     status:"Not Started",percentComplete:0,notes:""},
  ]);

  // Material Master (linked to BOQ items and activities)
  const [materialMaster] = useState([
    {code:"MAT-CON-001",name:"Ready Mix Concrete C32/40",spec:"BS EN 206, C32/40, XC2, S3",unit:"m³",category:"Concrete",supplier:"Gulf Concrete Co.",leadWeeksProcure:1,unitCost:165,minStock:50,reorderPoint:80,warehouseLoc:"Batch Plant / Direct Delivery",notes:"Direct delivery to pour location"},
    {code:"MAT-CON-002",name:"Ready Mix Concrete C25/30 (Blinding)",spec:"BS EN 206, C25/30, S3",unit:"m³",category:"Concrete",supplier:"Gulf Concrete Co.",leadWeeksProcure:1,unitCost:148,minStock:0,reorderPoint:0,warehouseLoc:"Direct Delivery",notes:"Order on demand"},
    {code:"MAT-RBR-001",name:"Rebar B500B — 10mm dia",spec:"BS 4449:2005, B500B, Ribbed",unit:"tonne",category:"Reinforcement",supplier:"SteelFab Co.",leadWeeksProcure:3,unitCost:820,minStock:10,reorderPoint:20,warehouseLoc:"Laydown Area — Zone C",notes:""},
    {code:"MAT-RBR-002",name:"Rebar B500B — 16mm dia",spec:"BS 4449:2005, B500B, Ribbed",unit:"tonne",category:"Reinforcement",supplier:"SteelFab Co.",leadWeeksProcure:3,unitCost:810,minStock:15,reorderPoint:25,warehouseLoc:"Laydown Area — Zone C",notes:"Mill certs required with each delivery"},
    {code:"MAT-RBR-003",name:"Rebar B500B — 20mm dia",spec:"BS 4449:2005, B500B, Ribbed",unit:"tonne",category:"Reinforcement",supplier:"SteelFab Co.",leadWeeksProcure:3,unitCost:800,minStock:20,reorderPoint:35,warehouseLoc:"Laydown Area — Zone C",notes:""},
    {code:"MAT-FWK-001",name:"Formwork — Slab (DOKA or equiv)",spec:"DOKA Framax or equiv, 350kg/m² capacity",unit:"m²",category:"Formwork",supplier:"FormRent Ltd",leadWeeksProcure:2,unitCost:28,minStock:200,reorderPoint:300,warehouseLoc:"Laydown Area — Zone B",notes:"Rental, includes erection/striking"},
    {code:"MAT-FWK-002",name:"Formwork — Column (DOKA or equiv)",spec:"Circular/Square column form",unit:"m",category:"Formwork",supplier:"FormRent Ltd",leadWeeksProcure:2,unitCost:45,minStock:50,reorderPoint:80,warehouseLoc:"Laydown Area — Zone B",notes:""},
    {code:"MAT-BWK-001",name:"Hollow Block 200mm",spec:"200×400×200mm, 7N/mm²",unit:"Nr",category:"Masonry",supplier:"BlockPro LLC",leadWeeksProcure:2,unitCost:2.8,minStock:500,reorderPoint:1000,warehouseLoc:"Laydown Area — Zone D",notes:""},
    {code:"MAT-WPF-001",name:"Waterproofing Membrane — Crystalline",spec:"Xypex or equiv, 1.0kg/m² application",unit:"m²",category:"Waterproofing",supplier:"WaterSeal Ltd",leadWeeksProcure:3,unitCost:38,minStock:100,reorderPoint:200,warehouseLoc:"Secure Store — Warehouse A",notes:""},
    {code:"MAT-STL-001",name:"Structural Steel — 254×254 UC",spec:"S275, BS EN 10025, hot-dip galv",unit:"tonne",category:"Structural Steel",supplier:"SteelFab Co.",leadWeeksProcure:8,unitCost:1850,minStock:0,reorderPoint:0,warehouseLoc:"Laydown Area — Zone C",notes:"Fabricated to shop drawings"},
    {code:"MAT-MEP-001",name:"HVAC Ductwork — Galv. Steel",spec:"GI sheet 0.8mm, SMACNA Class 1",unit:"m",category:"Mechanical",supplier:"HVAC Supply Co.",leadWeeksProcure:4,unitCost:85,minStock:50,reorderPoint:100,warehouseLoc:"Warehouse B — MEP Store",notes:""},
    {code:"MAT-MEP-002",name:"HVAC AHU — 12,000 CFM",spec:"AHU as per spec, 12000 CFM, DX coil",unit:"Nr",category:"Mechanical",supplier:"HVAC Supply Co.",leadWeeksProcure:10,unitCost:28500,minStock:0,reorderPoint:0,warehouseLoc:"Warehouse B — MEP Store",notes:"Long lead — order placed"},
    {code:"MAT-ELC-001",name:"Cable — XLPE 4C×16mm²",spec:"BS 6724, XLPE insulated, armoured",unit:"m",category:"Electrical",supplier:"ElecDist Ltd",leadWeeksProcure:4,unitCost:18,minStock:200,reorderPoint:400,warehouseLoc:"Warehouse B — MEP Store",notes:""},
    {code:"MAT-ELC-002",name:"Main LV Switchboard",spec:"Form 4, Type 7, TPN, 2500A",unit:"Nr",category:"Electrical",supplier:"ElecDist Ltd",leadWeeksProcure:12,unitCost:85000,minStock:0,reorderPoint:0,warehouseLoc:"Warehouse B — MEP Store",notes:"Factory inspection required — PROC-006"},
    {code:"MAT-FIN-001",name:"Raised Access Floor — Steel panel",spec:"600×600×33mm, 12kN/m² SLL",unit:"m²",category:"Finishes",supplier:"Interior Finish Co.",leadWeeksProcure:5,unitCost:95,minStock:0,reorderPoint:0,warehouseLoc:"Secure Store — Warehouse A",notes:""},
    {code:"MAT-FIN-002",name:"Suspended Ceiling — Mineral Fibre 600×600",spec:"Armstrong Ultima or equiv",unit:"m²",category:"Finishes",supplier:"Interior Finish Co.",leadWeeksProcure:4,unitCost:42,minStock:0,reorderPoint:0,warehouseLoc:"Secure Store — Warehouse A",notes:""},
    {code:"MAT-EXT-001",name:"Paving — Concrete Block 400×200×60",spec:"Pre-cast, 35N/mm², approved colour",unit:"m²",category:"External",supplier:"Pave & Landscape Co.",leadWeeksProcure:3,unitCost:55,minStock:0,reorderPoint:0,warehouseLoc:"Direct Delivery — External Laydown",notes:""},
  ]);

  // Activity Material Requirements
  const [activityMaterials] = useState([
    {id:"AM001",activityRef:"AC004",materialCode:"MAT-CON-001",requiredQty:1850,wasteAllowance:0.05,totalPlannedQty:1943,deliveryPlanned:"2026-06-15",deliveryActual:"",issuedQty:962,remainingQty:981,status:"Partially Delivered"},
    {id:"AM002",activityRef:"AC004",materialCode:"MAT-RBR-002",requiredQty:148,wasteAllowance:0.08,totalPlannedQty:160,deliveryPlanned:"2026-06-10",deliveryActual:"2026-06-08",issuedQty:78,remainingQty:82,status:"Delivered"},
    {id:"AM003",activityRef:"AC004",materialCode:"MAT-RBR-003",requiredQty:92,wasteAllowance:0.08,totalPlannedQty:100,deliveryPlanned:"2026-06-10",deliveryActual:"2026-06-08",issuedQty:48,remainingQty:52,status:"Delivered"},
    {id:"AM004",activityRef:"AC004",materialCode:"MAT-FWK-001",requiredQty:2400,wasteAllowance:0.02,totalPlannedQty:2448,deliveryPlanned:"2026-05-20",deliveryActual:"2026-05-19",issuedQty:2448,remainingQty:0,status:"Issued"},
    {id:"AM005",activityRef:"AC005",materialCode:"MAT-STL-001",requiredQty:85,wasteAllowance:0.03,totalPlannedQty:88,deliveryPlanned:"2026-08-01",deliveryActual:"",issuedQty:0,remainingQty:88,status:"On Order"},
    {id:"AM006",activityRef:"AC006",materialCode:"MAT-MEP-001",requiredQty:2800,wasteAllowance:0.10,totalPlannedQty:3080,deliveryPlanned:"2026-07-01",deliveryActual:"",issuedQty:420,remainingQty:2660,status:"Partially Delivered"},
    {id:"AM007",activityRef:"AC006",materialCode:"MAT-MEP-002",requiredQty:8,wasteAllowance:0,totalPlannedQty:8,deliveryPlanned:"2026-09-30",deliveryActual:"",issuedQty:0,remainingQty:8,status:"On Order"},
    {id:"AM008",activityRef:"AC007",materialCode:"MAT-ELC-001",requiredQty:18500,wasteAllowance:0.10,totalPlannedQty:20350,deliveryPlanned:"2026-07-15",deliveryActual:"",issuedQty:3200,remainingQty:17150,status:"Partially Delivered"},
    {id:"AM009",activityRef:"AC007",materialCode:"MAT-ELC-002",requiredQty:1,wasteAllowance:0,totalPlannedQty:1,deliveryPlanned:"2026-09-15",deliveryActual:"",issuedQty:0,remainingQty:1,status:"In Fabrication"},
    {id:"AM010",activityRef:"AC009",materialCode:"MAT-FIN-001",requiredQty:3800,wasteAllowance:0.05,totalPlannedQty:3990,deliveryPlanned:"2026-11-01",deliveryActual:"",issuedQty:0,remainingQty:3990,status:"Not Ordered"},
    {id:"AM011",activityRef:"AC009",materialCode:"MAT-FIN-002",requiredQty:4200,wasteAllowance:0.05,totalPlannedQty:4410,deliveryPlanned:"2026-11-15",deliveryActual:"",issuedQty:0,remainingQty:4410,status:"Not Ordered"},
    {id:"AM012",activityRef:"AC010",materialCode:"MAT-EXT-001",requiredQty:1850,wasteAllowance:0.08,totalPlannedQty:1998,deliveryPlanned:"2027-01-01",deliveryActual:"",issuedQty:0,remainingQty:1998,status:"Not Ordered"},
  ]);

  // Stock Balance (Current Inventory)
  const [stockBalance, setStockBalance] = useState([
    {id:"STK001",materialCode:"MAT-RBR-001",onHand:28.5,reserved:15,available:13.5,unit:"t",location:"Laydown Area — Zone C",lastUpdated:"2026-05-09",reorderAlert:false},
    {id:"STK002",materialCode:"MAT-RBR-002",onHand:42.0,reserved:30,available:12,unit:"t",location:"Laydown Area — Zone C",lastUpdated:"2026-05-09",reorderAlert:false},
    {id:"STK003",materialCode:"MAT-RBR-003",onHand:24.5,reserved:20,available:4.5,unit:"t",location:"Laydown Area — Zone C",lastUpdated:"2026-05-09",reorderAlert:true},
    {id:"STK004",materialCode:"MAT-FWK-001",onHand:850,reserved:800,available:50,unit:"m²",location:"Laydown Area — Zone B",lastUpdated:"2026-05-09",reorderAlert:true},
    {id:"STK005",materialCode:"MAT-BWK-001",onHand:2400,reserved:1000,available:1400,unit:"Nr",location:"Laydown Area — Zone D",lastUpdated:"2026-05-08",reorderAlert:false},
    {id:"STK006",materialCode:"MAT-WPF-001",onHand:180,reserved:120,available:60,unit:"m²",location:"Secure Store — Warehouse A",lastUpdated:"2026-05-07",reorderAlert:false},
    {id:"STK007",materialCode:"MAT-MEP-001",onHand:480,reserved:420,available:60,unit:"m",location:"Warehouse B — MEP Store",lastUpdated:"2026-05-09",reorderAlert:true},
    {id:"STK008",materialCode:"MAT-ELC-001",onHand:3800,reserved:3200,available:600,unit:"m",location:"Warehouse B — MEP Store",lastUpdated:"2026-05-09",reorderAlert:false},
  ]);

  // Goods Receipt Notes (GRN)
  const [goodsReceipts, setGoodsReceipts] = useState([
    {id:"GRN001",date:"2026-04-08",poRef:"PO-2026-011",materialCode:"MAT-RBR-002",description:"Rebar B500B 16mm",quantityOrdered:50,quantityReceived:50,unit:"t",supplier:"SteelFab Co.",deliveryNote:"DN-SF-0442",inspector:"Maria Santos",activityRef:"AC004",costCode:"03.30",zone:"Laydown Area — Zone C",status:"Accepted",notes:"Mill certs received"},
    {id:"GRN002",date:"2026-04-08",poRef:"PO-2026-011",materialCode:"MAT-RBR-003",description:"Rebar B500B 20mm",quantityOrdered:30,quantityReceived:30,unit:"t",supplier:"SteelFab Co.",deliveryNote:"DN-SF-0442",inspector:"Maria Santos",activityRef:"AC004",costCode:"03.30",zone:"Laydown Area — Zone C",status:"Accepted",notes:""},
    {id:"GRN003",date:"2026-04-19",poRef:"PO-2026-012",materialCode:"MAT-FWK-001",description:"Slab Formwork",quantityOrdered:2448,quantityReceived:2448,unit:"m²",supplier:"FormRent Ltd",deliveryNote:"DN-FR-0198",inspector:"Site Engineer",activityRef:"AC004",costCode:"03.20",zone:"Laydown Area — Zone B",status:"Accepted",notes:""},
    {id:"GRN004",date:"2026-05-01",poRef:"PO-2026-018",materialCode:"MAT-RBR-002",description:"Rebar B500B 16mm",quantityOrdered:40,quantityReceived:38,unit:"t",supplier:"SteelFab Co.",deliveryNote:"DN-SF-0489",inspector:"Maria Santos",activityRef:"AC004",costCode:"03.30",zone:"Laydown Area — Zone C",status:"Partial — 2t Rejected",notes:"2t rejected — bent/damaged in transit"},
    {id:"GRN005",date:"2026-05-05",poRef:"PO-2026-022",materialCode:"MAT-MEP-001",description:"GI Ductwork",quantityOrdered:500,quantityReceived:500,unit:"m",supplier:"HVAC Supply Co.",deliveryNote:"DN-HV-0102",inspector:"James O'Brien",activityRef:"AC006",costCode:"07.10",zone:"Warehouse B — MEP Store",status:"Accepted",notes:""},
    {id:"GRN006",date:"2026-05-07",poRef:"PO-2026-025",materialCode:"MAT-ELC-001",description:"XLPE Cable 4C×16mm²",quantityOrdered:4000,quantityReceived:4000,unit:"m",supplier:"ElecDist Ltd",deliveryNote:"DN-ED-0078",inspector:"James O'Brien",activityRef:"AC007",costCode:"07.30",zone:"Warehouse B — MEP Store",status:"Accepted",notes:""},
  ]);

  // Material Issue Vouchers (MIV)
  const [materialIssues, setMaterialIssues] = useState([
    {id:"MIV001",date:"2026-04-10",materialCode:"MAT-RBR-002",description:"Rebar B500B 16mm",quantityIssued:35,unit:"t",issuedTo:"StructBuild Ltd",requestRef:"MR-001",activityRef:"AC004",costCode:"03.30",zone:"Zone A-D — GF Slab",engineer:"Site Engineer",notes:"GF slab reinforcement"},
    {id:"MIV002",date:"2026-04-10",materialCode:"MAT-RBR-003",description:"Rebar B500B 20mm",quantityIssued:22,unit:"t",issuedTo:"StructBuild Ltd",requestRef:"MR-001",activityRef:"AC004",costCode:"03.30",zone:"Zone A-D — GF Slab",engineer:"Site Engineer",notes:"GF slab reinforcement"},
    {id:"MIV003",date:"2026-04-20",materialCode:"MAT-FWK-001",description:"Slab Formwork",quantityIssued:1200,unit:"m²",issuedTo:"StructBuild Ltd",requestRef:"MR-002",activityRef:"AC004",costCode:"03.20",zone:"Zone A-D — FL1 Slab",engineer:"Site Engineer",notes:"FL1 slab falsework"},
    {id:"MIV004",date:"2026-05-01",materialCode:"MAT-RBR-002",description:"Rebar B500B 16mm",quantityIssued:28,unit:"t",issuedTo:"StructBuild Ltd",requestRef:"MR-004",activityRef:"AC004",costCode:"03.30",zone:"Zone A-D — FL2 Slab",engineer:"Site Engineer",notes:"FL2 slab reinforcement"},
    {id:"MIV005",date:"2026-05-08",materialCode:"MAT-MEP-001",description:"GI Ductwork",quantityIssued:420,unit:"m",issuedTo:"MEP Contractors Ltd",requestRef:"MR-006",activityRef:"AC006",costCode:"07.10",zone:"FL1 — MEP Zone",engineer:"James O'Brien",notes:"FL1 ductwork installation"},
    {id:"MIV006",date:"2026-05-09",materialCode:"MAT-ELC-001",description:"XLPE Cable 4C×16mm²",quantityIssued:3200,unit:"m",issuedTo:"MEP Contractors Ltd",requestRef:"MR-007",activityRef:"AC007",costCode:"07.30",zone:"FL1 — Electrical Zone",engineer:"James O'Brien",notes:"Main distribution cables"},
  ]);

  // Wastage / Damaged Log
  const [wastageLog, setWastageLog] = useState([
    {id:"WST001",date:"2026-04-15",materialCode:"MAT-CON-001",description:"Concrete C32/40",quantityWasted:4.5,unit:"m³",reason:"Pump breakdown — concrete went off",activityRef:"AC004",costCode:"03.20",value:743,responsible:"StructBuild Ltd",action:"Charged to sub",zone:"Zone B — FL1"},
    {id:"WST002",date:"2026-04-20",materialCode:"MAT-RBR-002",description:"Rebar B500B 16mm",quantityWasted:0.8,unit:"t",reason:"Incorrect cutting — waste at ends",activityRef:"AC004",costCode:"03.30",value:648,responsible:"StructBuild Ltd",action:"Noted — normal cutting waste",zone:"Zone C — Laydown"},
    {id:"WST003",date:"2026-05-04",materialCode:"MAT-RBR-002",description:"Rebar B500B 16mm",quantityWasted:2.0,unit:"t",reason:"Delivery damage — bent in transit — see GRN004",activityRef:"AC004",costCode:"03.30",value:1620,responsible:"SteelFab Co.",action:"Supplier claim raised",zone:"Laydown Area — Zone C"},
  ]);

  // Progress Measurements (Quantity-based — BOQ items)
  const [progressMeasurements, setProgressMeasurements] = useState([
    {id:"PM001",boqRef:"A.01",description:"Excavation to formation level",unit:"m³",contractQty:4200,plannedQtyToDate:4200,actualQtyToDate:4200,installedQty:4200,activityRef:"AC001",costCode:"02.10",zone:"Zone A — Basement",percentComplete:100,earnedValue:168000,unitRate:40,notes:""},
    {id:"PM002",boqRef:"B.01",description:"Bored piles 600mm dia",unit:"Nr",contractQty:86,plannedQtyToDate:86,actualQtyToDate:86,installedQty:86,activityRef:"AC002",costCode:"02.20",zone:"Zone A — Basement",percentComplete:100,earnedValue:340000,unitRate:3953,notes:""},
    {id:"PM003",boqRef:"C.01",description:"RC raft foundation slab",unit:"m³",contractQty:420,plannedQtyToDate:420,actualQtyToDate:420,installedQty:420,activityRef:"AC003",costCode:"03.10",zone:"Zone A-D — GF",percentComplete:100,earnedValue:189000,unitRate:450,notes:""},
    {id:"PM004",boqRef:"C.02",description:"RC suspended slab FL1-RF",unit:"m³",contractQty:1850,plannedQtyToDate:960,actualQtyToDate:962,installedQty:962,activityRef:"AC004",costCode:"03.20",zone:"Zone A-D — FL1-RF",percentComplete:52,earnedValue:432900,unitRate:450,notes:"FL1-FL3 complete; FL4-5 pending"},
    {id:"PM005",boqRef:"C.03",description:"Rebar supply and fix",unit:"t",contractQty:320,plannedQtyToDate:168,actualQtyToDate:166,installedQty:166,activityRef:"AC004",costCode:"03.30",zone:"Zone A-D — FL1-RF",percentComplete:52,earnedValue:216580,unitRate:1305,notes:""},
    {id:"PM006",boqRef:"E.01",description:"Curtain wall system",unit:"m²",contractQty:3200,plannedQtyToDate:0,actualQtyToDate:0,installedQty:0,activityRef:"AC005",costCode:"05.10",zone:"All Elevations",percentComplete:0,earnedValue:0,unitRate:339,notes:"Not started"},
    {id:"PM007",boqRef:"G.01",description:"HVAC ductwork installation",unit:"m",contractQty:2800,plannedQtyToDate:520,actualQtyToDate:495,installedQty:495,activityRef:"AC006",costCode:"07.10",zone:"All Floors",percentComplete:17.7,earnedValue:148995,unitRate:301,notes:"FL1-FL2 first fix"},
    {id:"PM008",boqRef:"G.02",description:"LV cabling and wiring",unit:"m",contractQty:18500,plannedQtyToDate:3500,actualQtyToDate:3200,installedQty:3200,activityRef:"AC007",costCode:"07.30",zone:"All Floors",percentComplete:17.3,earnedValue:115200,unitRate:36,notes:"FL1 main distribution"},
    {id:"PM009",boqRef:"H.01",description:"Lift installation complete",unit:"Nr",contractQty:3,plannedQtyToDate:0,actualQtyToDate:0,installedQty:0,activityRef:"AC008",costCode:"08.10",zone:"Core — All Floors",percentComplete:0,earnedValue:0,unitRate:185000,notes:""},
    {id:"PM010",boqRef:"I.01",description:"Raised access floor",unit:"m²",contractQty:3800,plannedQtyToDate:0,actualQtyToDate:0,installedQty:0,activityRef:"AC009",costCode:"09.10",zone:"All Office Floors",percentComplete:0,earnedValue:0,unitRate:150,notes:""},
  ]);

  // Client Invoice Items (Billing Schedule)
  const [clientInvoiceItems, setClientInvoiceItems] = useState([
    {id:"INV001",boqRef:"A.01",description:"Excavation to formation level",unit:"m³",contractQty:4200,unitRate:40,
     prevCertQty:4200,currExecQty:0,currCertQty:0,
     prevCertValue:168000,variationValue:0,retention:8400,deductions:0,notes:""},
    {id:"INV002",boqRef:"B.01",description:"Bored piles 600mm dia — supply and install",unit:"Nr",contractQty:86,unitRate:3953,
     prevCertQty:86,currExecQty:0,currCertQty:0,
     prevCertValue:339958,variationValue:0,retention:16998,deductions:0,notes:""},
    {id:"INV003",boqRef:"C.01",description:"RC raft foundation slab including rebar",unit:"m³",contractQty:420,unitRate:450,
     prevCertQty:420,currExecQty:0,currCertQty:0,
     prevCertValue:189000,variationValue:0,retention:9450,deductions:0,notes:""},
    {id:"INV004",boqRef:"C.02",description:"RC suspended slabs FL1-RF",unit:"m³",contractQty:1850,unitRate:450,
     prevCertQty:480,currExecQty:482,currCertQty:460,
     prevCertValue:216000,variationValue:0,retention:10800,deductions:0,notes:"FL4 slab poured this month"},
    {id:"INV005",boqRef:"C.03",description:"Rebar B500B supply and fix",unit:"t",contractQty:320,unitRate:1305,
     prevCertQty:80,currExecQty:86,currCertQty:82,
     prevCertValue:104400,variationValue:0,retention:5220,deductions:0,notes:""},
    {id:"INV006",boqRef:"E.01",description:"Curtain wall glazed system",unit:"m²",contractQty:3200,unitRate:339,
     prevCertQty:0,currExecQty:0,currCertQty:0,
     prevCertValue:0,variationValue:0,retention:0,deductions:0,notes:"Not started"},
    {id:"INV007",boqRef:"G.01",description:"HVAC ductwork supply and install",unit:"m",contractQty:2800,unitRate:301,
     prevCertQty:250,currExecQty:245,currCertQty:230,
     prevCertValue:75250,variationValue:0,retention:3763,deductions:0,notes:""},
    {id:"INV008",boqRef:"G.02",description:"LV cabling — supply, pull and terminate",unit:"m",contractQty:18500,unitRate:36,
     prevCertQty:1600,currExecQty:1600,currCertQty:1500,
     prevCertValue:57600,variationValue:0,retention:2880,deductions:0,notes:""},
    {id:"INV009",boqRef:"H.01",description:"Passenger lifts — supply and install",unit:"Nr",contractQty:3,unitRate:185000,
     prevCertQty:0,currExecQty:0,currCertQty:0,
     prevCertValue:0,variationValue:0,retention:0,deductions:0,notes:"Not started"},
    {id:"INV010",boqRef:"I.01",description:"Raised access floor supply and lay",unit:"m²",contractQty:3800,unitRate:150,
     prevCertQty:0,currExecQty:0,currCertQty:0,
     prevCertValue:0,variationValue:0,retention:0,deductions:0,notes:""},
  ]);
  const [retentionRate] = useState(0.05); // 5%
  const [currentIPCPeriod, setCurrentIPCPeriod] = useState("June 2026");

  // Subcontractor Billing / Valuations
  const [subValuations, setSubValuations] = useState([
    {id:"SV001",subcontractor:"Excavation & Piling Co.",period:"April 2026",scopeRef:"SC-001",
     contractValue:340000,measuredValue:340000,prevPayment:255000,currClaim:85000,currCertified:85000,
     retention:17000,backCharges:2400,deductions:0,
     status:"Certified",certDate:"2026-05-08",payDate:"2026-05-15",notes:"Final payment — scope complete"},
    {id:"SV002",subcontractor:"StructBuild Ltd",period:"April 2026",scopeRef:"SC-002",
     contractValue:1850000,measuredValue:980000,prevPayment:588000,currClaim:196000,currCertified:186000,
     retention:49000,backCharges:0,deductions:0,
     status:"Paid",certDate:"2026-05-05",payDate:"2026-05-15",notes:""},
    {id:"SV003",subcontractor:"StructBuild Ltd",period:"May 2026",scopeRef:"SC-002",
     contractValue:1850000,measuredValue:980000,prevPayment:774000,currClaim:210000,currCertified:0,
     retention:0,backCharges:4200,deductions:0,
     status:"Under Assessment",certDate:"",payDate:"",notes:"NCR-001 rectification cost deducted as back charge"},
    {id:"SV004",subcontractor:"MEP Contractors Ltd",period:"May 2026",scopeRef:"SC-004",
     contractValue:1266550,measuredValue:228000,prevPayment:0,currClaim:120000,currCertified:114000,
     retention:6000,backCharges:0,deductions:0,
     status:"Certified",certDate:"2026-05-10",payDate:"2026-05-20",notes:"First payment"},
    {id:"SV005",subcontractor:"FaçadeTech Systems",period:"May 2026",scopeRef:"SC-003",
     contractValue:1085000,measuredValue:0,prevPayment:0,currClaim:108500,currCertified:0,
     retention:0,backCharges:0,deductions:108500,
     status:"On Hold",certDate:"",payDate:"",notes:"Payment suspended pending DEC-002 resolution and payment dispute"},
  ]);

  const totalBOQ = rows.reduce((s,r)=>s+(parseFloat(r.amount)||0),0);

  const updRow = (id,f,v) => setRows(p=>p.map(r=>{
    if(r.id!==id) return r;
    const u={...r,[f]:v};
    if(f==="qty"||f==="rate"){ u.amount=(parseFloat(f==="qty"?v:u.qty)||0)*(parseFloat(f==="rate"?v:u.rate)||0); }
    return u;
  }));

  /* File upload & parse */
  const handleFile = async (file) => {
    if(!file) return;
    const ext=file.name.split(".").pop().toLowerCase();
    setParsing(true); setParseMsg("Reading file…"); setError(null);
    try {
      let extractedText="";
      if(["xlsx","xls","csv"].includes(ext)){
        setParseMsg("Parsing spreadsheet…");
        const buf=await file.arrayBuffer();
        const wb=XLSX.read(buf,{type:"array"});
        const ws=wb.Sheets[wb.SheetNames[0]];
        extractedText=XLSX.utils.sheet_to_json(ws,{header:1,defval:""}).map(r=>r.join(" | ")).join("\n");
      } else if(ext==="pdf"){
        setParseMsg("Reading PDF…");
        const b64=await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result.split(",")[1]); fr.onerror=()=>rej(new Error("File read failed")); fr.readAsDataURL(file); });
        setParseMsg("Extracting BOQ from PDF…");
        const r2=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:3000,messages:[{role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}},{type:"text",text:"Extract ALL rows from this Bill of Quantities. Return plain text: Ref | Description | Unit | Quantity | Rate | Amount | Section. One row per line. No headers."}]}]})});
        const d2=await r2.json(); extractedText=d2.content?.find(b=>b.type==="text")?.text||"";
      } else { throw new Error("Unsupported format. Use .xlsx, .xls, .csv, or .pdf"); }
      if(!extractedText.trim()) throw new Error("No content found in file.");
      setParseMsg("AI interpreting BOQ items…");
      const pr=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:4000,system:"You are a BOQ parser. Return ONLY valid JSON array. No markdown.",messages:[{role:"user",content:`Parse this BOQ data. Return JSON array where each object has: "ref","description","unit"(one of LS m m² m³ Nr kg t hr),"qty"(number),"rate"(number),"amount"(number),"section"(one of: ${PHASES.join(", ")}). Skip header/total rows. Only return the JSON array.\n\nDATA:\n${extractedText.slice(0,6000)}`}]})});
      const pd=await pr.json();
      const raw=pd.content?.find(b=>b.type==="text")?.text||"[]";
      const parsed=JSON.parse(raw.replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/```\s*$/i,"").trim());
      if(!Array.isArray(parsed)||parsed.length===0) throw new Error("No BOQ items found.");
      const numbered=parsed.map((r,i)=>({...r,id:Date.now()+i,qty:Number(r.qty)||0,rate:Number(r.rate)||0,amount:Number(r.amount)||(Number(r.qty)*Number(r.rate))}));
      setRows(numbered);
      setParseMsg(`✓ Loaded ${numbered.length} items — generating schedule…`);
      await generateSchedule(numbered, proj);
    } catch(e){ setError("File parse error: "+e.message); }
    finally{ setParsing(false); }
  };

  const repairJSON = (raw) => {
    let s=raw.trim().replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/```\s*$/i,"").trim();
    try{ return JSON.parse(s); }catch(_){}
    const opens=(s.match(/"/g)||[]).length; if(opens%2!==0) s+='"';
    const stack=[]; for(const ch of s){ if(ch==="{"||ch==="[") stack.push(ch==="{"?"}":"]"); else if(ch==="}"||ch==="]") stack.pop(); }
    s=s.replace(/,\s*$/,""); while(stack.length) s+=stack.pop();
    return JSON.parse(s);
  };

  const generateSchedule = useCallback(async (boqOverride, projOverride) => {
    const activeRows=(boqOverride||rows).filter(r=>r.description);
    const activePrj=projOverride||proj;
    if(!activeRows.length){ setError("Please add at least one BOQ item."); return; }
    setLoading(true); setError(null); setSchedule(null);
    const msgs=["Parsing BOQ items…","Identifying activities…","Building WBS…","Calculating durations…","Mapping predecessors…","Running CPM forward pass…","Running CPM backward pass…","Calculating float & slack…","Assigning resources…","Identifying long-lead items…","Generating milestones…","Finalizing schedule…"];
    let mi=0; setLoadMsg(msgs[0]);
    const iv=setInterval(()=>{ mi=(mi+1)%msgs.length; setLoadMsg(msgs[mi]); },2000);
    const boqText=activeRows.map(r=>`${r.ref||"—"}|${r.description}|${r.unit}|Qty:${r.qty}|Rate:${r.rate}|Amt:${r.amount}|Sec:${r.section}`).join("\n");
    const cv=activePrj.value?`USD ${activePrj.value}`:`USD ${totalBOQ.toFixed(0)}`;
    try {
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        model:"claude-sonnet-4-20250514",max_tokens:16000,
        system:"Expert construction planning engineer. Return ONLY raw JSON object. No markdown, no fences, no commentary. Keep all string values under 60 chars.",
        messages:[{role:"user",content:`Generate CPM construction schedule JSON.

PROJECT: ${activePrj.name}|${activePrj.type}|${activePrj.location}
Start:${activePrj.start}|Duration:${activePrj.duration} ${activePrj.unit}|Value:${cv}

BOQ(${activeRows.length} items):
${boqText}

Return this JSON structure exactly (no extra keys, strings<60 chars):
{"projectSummary":{"name":"","type":"","startDate":"","endDate":"","totalDuration":"","totalBudget":0,"totalActivities":0,"criticalActivities":0,"totalMilestones":0},"activities":[{"id":"","wbs":"","name":"","phase":"","duration":0,"unit":"","qtyBasis":"","earlyStart":0,"earlyFinish":0,"lateStart":0,"lateFinish":0,"totalFloat":0,"freeFloat":0,"critical":false,"isMilestone":false,"predecessors":"","successors":"","depType":"FS","labor":"","equipment":"","materials":"","subcontractor":"","budget":0,"longLead":false,"longLeadWeeks":0,"remarks":""}],"criticalPath":[{"seq":0,"id":"","name":"","duration":0,"earlyStart":0,"earlyFinish":0,"whyCritical":""}],"wbs":[{"code":"","level":1,"name":"","duration":0,"budget":0,"responsible":"","activities":0}],"milestones":[{"id":"","name":"","day":0,"dateStr":"","phase":"","critical":false,"description":""}],"longLeadItems":[{"item":"","leadWeeks":0,"orderBy":"","activity":"","criticality":"","risk":""}],"resourceSummary":[{"phase":"","period":"","peakLabor":0,"avgLabor":0,"keyEquipment":"","keyMaterials":"","notes":""}],"risks":[{"ref":"","description":"","probability":"","impact":"","severity":"","mitigation":"","phase":"","owner":""}],"floatAnalysis":{"criticalCount":0,"nearCriticalCount":0,"nonCriticalCount":0,"avgFloat":0,"maxFloat":0},"assumptions":[{"ref":"","title":"","description":"","impact":""}]}

RULES: ES/EF/LS/LF=working days from day 0. TF=LF-EF. 30-45 activities. Fit ${activePrj.duration} ${activePrj.unit}. 6-8 risks with severity HIGH/MEDIUM/LOW/CRITICAL. 5-8 assumptions. 5-8 long-lead items. Predecessors field: comma-separated activity IDs. depType: FS/SS/FF/SF. COMPLETE the full JSON — do not truncate.`}]
      })});
      clearInterval(iv);
      if(!res.ok){
        const eBody=await res.json().catch(()=>({}));
        if(res.status===429||eBody?.type==="exceeded_limit"||eBody?.windows){ const resets=eBody?.resets_at||eBody?.windows?.["5h"]?.resets_at||eBody?.resetsAt; throw new Error(`RATE_LIMIT::${resets?new Date(resets*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"soon"}`); }
        if(res.status===529) throw new Error("OVERLOADED");
        if(res.status===401) throw new Error("AUTH");
        throw new Error(eBody?.error?.message||`API ${res.status}`);
      }
      const data=await res.json();
      const raw=data.content.filter(b=>b.type==="text").map(b=>b.text).join("");
      let parsed;
      if(data.stop_reason==="max_tokens"){ try{ parsed=repairJSON(raw); }catch(_){ throw new Error("TRUNCATED"); } }
      else{ parsed=repairJSON(raw); }
      setSchedule(parsed);
      setTab("dashboard");
    } catch(e){
      clearInterval(iv);
      const m=e.message||"";
      if(m.startsWith("RATE_LIMIT::")) setError(m);
      else if(m==="OVERLOADED") setError("OVERLOADED");
      else if(m==="AUTH") setError("AUTH");
      else if(m==="TRUNCATED") setError("TRUNCATED");
      else setError("Generation failed: "+m);
    } finally{ setLoading(false); setLoadMsg(""); }
  },[rows,proj,totalBOQ]);

  const totalDays=schedule?.activities?.length?Math.max(...schedule.activities.map(a=>a.earlyFinish||0)):260;

  const TABS = [
    {k:"dashboard",l:"🏠 PM Dashboard"},
    {k:"checklist",l:"✅ Daily Checklist"},
    {k:"ai",l:"🤖 AI Copilot"},
    // ── Schedule ──
    {k:"schedule",l:"📅 Master Schedule"},
    {k:"baseline",l:"📏 Baseline vs Current"},
    {k:"progress",l:"📍 Actual Progress"},
    {k:"quantities",l:"📐 Progress & Quantities"},
    {k:"gantt",l:"📊 Gantt (P6)"},
    {k:"critical",l:"🔴 Critical Path"},
    {k:"wbs",l:"🏗 WBS"},
    {k:"resources",l:"👷 Resources"},
    {k:"productivity",l:"📈 Productivity"},
    {k:"compression",l:"⚡ Compression"},
    {k:"milestones",l:"◆ Milestones"},
    // ── Cost Control ──
    {k:"costcontrol",l:"🧮 Cost Control"},
    {k:"commercial",l:"💰 Commercial"},
    {k:"cashflow",l:"💵 Cash Flow"},
    {k:"costphase",l:"📊 Cost by Phase"},
    {k:"eot",l:"⚖ EOT & LD"},
    // ── Invoicing ──
    {k:"clientinvoice",l:"🧾 Client Invoice"},
    {k:"subbilling",l:"💳 Sub Billing"},
    // ── Materials & Procurement ──
    {k:"materials",l:"🧱 Materials MBS"},
    {k:"warehouse",l:"🏭 Warehouse"},
    {k:"grn",l:"📦 Goods Receipts"},
    {k:"issues",l:"📤 Material Issues"},
    {k:"wastage",l:"⚠ Wastage Log"},
    {k:"procurement",l:"🚚 Procurement"},
    {k:"rfi",l:"📄 RFI & Submittals"},
    {k:"drawings",l:"📐 Drawings"},
    {k:"transmittals",l:"📬 Transmittals"},
    {k:"correspondence",l:"✉ Correspondence"},
    // ── Quality ──
    {k:"subcontractors",l:"🏗 Subcontractors"},
    {k:"itp",l:"📋 ITP"},
    {k:"ncr",l:"🔴 NCR"},
    {k:"tests",l:"🧪 Material Tests"},
    {k:"defects",l:"🔧 Defects"},
    // ── Site ──
    {k:"safety",l:"🦺 Safety"},
    {k:"weather",l:"🌦 Weather"},
    {k:"diary",l:"📔 Site Diary"},
    // ── Analysis ──
    {k:"whatif",l:"🔮 What-If"},
    {k:"costreports",l:"📊 Cost Reports"},
    // ── Handover ──
    {k:"commissioning",l:"🔌 Commissioning"},
    {k:"handover",l:"🏁 Handover"},
    // ── Admin ──
    {k:"decisions",l:"🗂 Decisions"},
    {k:"directory",l:"👤 Directory"},
    {k:"permits",l:"🏛 Permits"},
    {k:"reports",l:"📑 Reports"},
    {k:"riskplan",l:"⚠ Risk Plan"},
    {k:"assumptions",l:"📝 Assumptions"},
    {k:"longlead",l:"⏳ Long-Lead"},
  ];

  /* Input section always visible */
  const InputSection = () => (
    <>
      {/* Project settings */}
      <div style={{background:"#0C1B30",border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden",marginBottom:12}}>
        <div style={{background:`linear-gradient(90deg,#071A40,#0C1B30)`,borderBottom:`1px solid ${C.blue}33`,padding:"9px 16px",display:"flex",alignItems:"center",gap:8}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.blueL} strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/></svg>
          <span style={{fontSize:9,fontWeight:700,color:C.textMid,letterSpacing:"2px",textTransform:"uppercase",fontFamily:"'Sora','Segoe UI',sans-serif"}}>Project Settings</span>
        </div>
        <div style={{padding:"12px 16px"}}>
          <div style={{display:"grid",gridTemplateColumns:"2fr 2fr 1.5fr 1.2fr 1fr 1.2fr",gap:10,alignItems:"end"}}>
            {[["name","Project Name","text",""],["type","Type","text",""],["location","Location","text",""],["start","Start Date","date",""],["value","Contract Value (USD)","number",""]].map(([k,lbl,type,ph])=>(
              <div key={k}>
                <label style={{display:"block",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:4}}>{lbl}</label>
                <input style={{width:"100%",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:6,padding:"7px 9px",color:C.text,fontSize:11,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}} type={type} placeholder={ph} value={proj[k]} onChange={e=>setP(k,e.target.value)}/>
              </div>
            ))}
            <div>
              <label style={{display:"block",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:4}}>Duration</label>
              <div style={{display:"flex",gap:5}}>
                <input style={{width:60,background:C.surface,border:`1px solid ${C.border2}`,borderRadius:6,padding:"7px 8px",color:C.text,fontSize:11,fontFamily:"inherit",outline:"none"}} type="number" min="1" value={proj.duration} onChange={e=>setP("duration",e.target.value)}/>
                <select style={{flex:1,background:C.surface,border:`1px solid ${C.border2}`,borderRadius:6,padding:"7px 8px",color:C.text,fontSize:11,fontFamily:"inherit",outline:"none"}} value={proj.unit} onChange={e=>setP("unit",e.target.value)}>
                  <option value="weeks">Weeks</option><option value="months">Months</option><option value="days">Days</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BOQ section */}
      <div style={{background:"#0C1B30",border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden",marginBottom:12}}>
        <div style={{background:`linear-gradient(90deg,#071A40,#0C1B30)`,borderBottom:`1px solid ${C.blue}33`,padding:"9px 16px",display:"flex",alignItems:"center",gap:8}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.blueL} strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span style={{fontSize:9,fontWeight:700,color:C.textMid,letterSpacing:"2px",textTransform:"uppercase",fontFamily:"'Sora','Segoe UI',sans-serif"}}>Bill of Quantities</span>
          <span style={{marginLeft:"auto",display:"inline-block",padding:"2px 8px",borderRadius:20,fontSize:9,fontWeight:700,background:`${C.blue}1A`,color:C.blueL,border:`1px solid ${C.blue}44`}}>
            {rows.filter(r=>r.description).length} items · {fmtUSD(totalBOQ)}
          </span>
        </div>
        <div style={{padding:"12px 16px"}}>
          {/* Upload zone */}
          <div className="upload-zone" onClick={()=>!parsing&&fileRef.current?.click()}
            onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f);}}
            onDragOver={e=>e.preventDefault()}
            style={{border:`2px dashed ${C.blue}55`,borderRadius:10,padding:"14px 16px",display:"flex",alignItems:"center",gap:14,cursor:"pointer",background:`${C.blue}08`,marginBottom:10,transition:"all .2s",opacity:parsing?.7:1}}>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" style={{display:"none"}} onChange={e=>e.target.files[0]&&handleFile(e.target.files[0])}/>
            <div style={{width:42,height:42,borderRadius:9,background:`${C.blue}22`,border:`1px solid ${C.blue}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>
              {parsing?<span style={{animation:"spin 1s linear infinite",display:"block"}}>⟳</span>:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.blueL} strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>}
            </div>
            <div>
              <div style={{color:C.white,fontWeight:700,fontSize:12,marginBottom:2}}>{parsing?parseMsg:"Upload BOQ File — Excel, CSV or PDF"}</div>
              <div style={{color:C.textDim,fontSize:9}}>{parsing?"AI is reading and interpreting your BOQ…":"Drag & drop · auto-fills table & generates schedule"}</div>
              <div style={{display:"flex",gap:5,marginTop:5}}>
                {[["📊","Excel"],["📄","CSV"],["📋","PDF"],["⚡","Auto-schedules"]].map(([ico,lbl])=>(
                  <span key={lbl} style={{display:"inline-block",padding:"2px 7px",borderRadius:20,fontSize:8,fontWeight:700,background:`${C.blue}1A`,color:C.blueL,border:`1px solid ${C.blue}44`}}>{ico} {lbl}</span>
                ))}
              </div>
            </div>
          </div>

          {parseMsg&&!parsing&&<div style={{background:"#040E28",border:`1px solid ${C.blue}33`,color:"#7BB3F0",borderRadius:7,padding:"7px 12px",fontSize:10,marginBottom:8,display:"flex",gap:6}}>✓ {parseMsg}</div>}

          {/* Toolbar */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{display:"inline-block",padding:"3px 10px",borderRadius:6,fontSize:10,fontWeight:700,background:`${C.blue}18`,border:`1px solid ${C.blue}33`,color:C.blueL}}>Total: {fmtUSD(totalBOQ)}</span>
            <div style={{display:"flex",gap:6}}>
              {[["Load Sample",()=>setRows(SAMPLE_BOQ)],["Clear",()=>setRows([mkRow()])],["+ Row",()=>setRows(p=>[...p,mkRow()])]].map(([l,fn])=>(
                <button key={l} onClick={fn} style={{padding:"5px 11px",borderRadius:5,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>{l}</button>
              ))}
            </div>
          </div>

          {/* BOQ Table */}
          <div style={{overflowX:"auto",overflowY:"auto",maxHeight:280,borderRadius:7,border:`1px solid ${C.border}`}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr>{["#","Ref","Description","Unit","Qty","Rate","Amount","Section",""].map(h=><th key={h} style={{background:C.surface,padding:"6px 7px",textAlign:"left",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",position:"sticky",top:0,zIndex:2}}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row,i)=>(
                  <tr key={row.id} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                    <td style={{padding:"4px 7px",fontSize:10,color:C.textDim,textAlign:"center",width:28,borderBottom:`1px solid ${C.border}`}}>{i+1}</td>
                    <td style={{padding:"3px 5px",borderBottom:`1px solid ${C.border}`}}><input style={{width:75,background:"transparent",border:"none",color:C.blueL,fontSize:10,fontFamily:"inherit",outline:"none",padding:"2px 4px"}} value={row.ref} onChange={e=>updRow(row.id,"ref",e.target.value)} placeholder="REF"/></td>
                    <td style={{padding:"3px 5px",borderBottom:`1px solid ${C.border}`}}><input style={{minWidth:200,background:"transparent",border:"none",color:C.text,fontSize:10,fontFamily:"inherit",outline:"none",padding:"2px 4px"}} value={row.description} onChange={e=>updRow(row.id,"description",e.target.value)} placeholder="Description…"/></td>
                    <td style={{padding:"3px 5px",borderBottom:`1px solid ${C.border}`}}><select style={{width:65,background:"transparent",border:"none",color:C.textMid,fontSize:10,fontFamily:"inherit",outline:"none",padding:"2px 3px"}} value={row.unit} onChange={e=>updRow(row.id,"unit",e.target.value)}>{["LS","m","m²","m³","Nr","kg","t","hr"].map(u=><option key={u}>{u}</option>)}</select></td>
                    {["qty","rate"].map(f=><td key={f} style={{padding:"3px 5px",borderBottom:`1px solid ${C.border}`}}><input style={{width:75,background:"transparent",border:"none",color:C.text,fontSize:10,fontFamily:"inherit",outline:"none",padding:"2px 4px",textAlign:"right"}} type="number" value={row[f]} onChange={e=>updRow(row.id,f,e.target.value)}/></td>)}
                    <td style={{padding:"4px 7px",textAlign:"right",fontWeight:700,color:C.gold,fontSize:10,whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`}}>{fmtUSD(parseFloat(row.amount)||0)}</td>
                    <td style={{padding:"3px 5px",borderBottom:`1px solid ${C.border}`}}><select style={{width:170,background:"transparent",border:"none",color:C.textMid,fontSize:9,fontFamily:"inherit",outline:"none",padding:"2px 3px"}} value={row.section} onChange={e=>updRow(row.id,"section",e.target.value)}><option value="">— Section —</option>{PHASES.map(p=><option key={p} value={p}>{p}</option>)}</select></td>
                    <td style={{padding:"4px 7px",borderBottom:`1px solid ${C.border}`}}><button onClick={()=>setRows(p=>p.filter(r=>r.id!==row.id))} style={{background:"#1A0808",color:"#F87171",border:"1px solid #3D1515",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontSize:10}}>✕</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} style={{padding:"6px 7px",textAlign:"right",color:C.textDim,fontWeight:700,background:C.surface,fontSize:10}}>TOTAL BOQ</td>
                  <td style={{padding:"6px 7px",textAlign:"right",color:C.gold,fontWeight:700,fontSize:13,background:C.surface}}>{fmtUSD(totalBOQ)}</td>
                  <td colSpan={2} style={{background:C.surface}}/>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Generate row */}
          <div style={{marginTop:12,display:"flex",gap:12,alignItems:"center"}}>
            <div style={{flex:1,background:"#040E28",border:`1px solid ${C.blue}33`,color:"#7BB3F0",borderRadius:7,padding:"8px 12px",fontSize:10,display:"flex",gap:8,alignItems:"center"}}>
              <span style={{flexShrink:0}}>ℹ</span>
              AI analyzes BOQ → builds WBS → sequences activities → runs CPM → assigns resources → identifies critical path — optimized for <strong style={{color:C.blueL}}>{proj.duration} {proj.unit}</strong>.
            </div>
            <button className="gen-btn" disabled={loading||parsing}
              style={{padding:"10px 24px",borderRadius:8,border:"none",cursor:loading||parsing?"not-allowed":"pointer",fontSize:11,fontWeight:900,fontFamily:"'Sora','Segoe UI',sans-serif",letterSpacing:"0.5px",background:`linear-gradient(135deg,${C.blue},${C.accent})`,color:"#000D1F",animation:"pulseBlue 3s infinite",opacity:loading||parsing?.7:1,whiteSpace:"nowrap"}}
              onClick={()=>generateSchedule()}>
              {loading?"⏳ Generating…":"⚡ Generate Schedule"}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  /* Error display */
  const ErrorDisplay = () => {
    if(!error||loading) return null;
    const isRL=error.startsWith("RATE_LIMIT::");
    const isOL=error==="OVERLOADED", isAU=error==="AUTH", isTR=error==="TRUNCATED";
    const resetTime=isRL?error.split("::")[1]:null;
    const [clr,bg]= isRL||isOL?[C.purple,"#0D0A1A"]:isTR?[C.blue,"#040E28"]:["#F87171","#1A0505"];
    return (
      <div style={{background:bg,border:`1px solid ${clr}44`,borderRadius:10,padding:"14px 16px",marginBottom:12,display:"flex",gap:12,alignItems:"flex-start",animation:"fadeUp .3s ease"}}>
        <span style={{fontSize:20,flexShrink:0}}>{isRL?"⏳":isOL?"🔄":isAU?"🔑":isTR?"✂":"⚠"}</span>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:12,color:clr,marginBottom:5,fontFamily:"'Sora','Segoe UI',sans-serif"}}>
            {isRL?"API Usage Limit Reached":isOL?"API Temporarily Overloaded":isAU?"Authentication Error":isTR?"Response Was Too Large — Retry Will Fix This":"Schedule Generation Failed"}
          </div>
          <div style={{fontSize:10,color:C.textMid,lineHeight:1.6}}>
            {isRL&&<>Your 5-hour usage window is full. Resets at <strong style={{color:C.purple}}>{resetTime}</strong>. Options: wait for reset, upgrade plan at console.anthropic.com, or use a different API key.</>}
            {isOL&&"API is temporarily overloaded. Wait 60 seconds and retry."}
            {isAU&&"API key missing or invalid. Ensure this app runs in the Claude.ai artifact context."}
            {isTR&&"The generated JSON was truncated. The token limit has been raised — retry should succeed with a complete response."}
            {!isRL&&!isOL&&!isAU&&!isTR&&error}
          </div>
          <div style={{display:"flex",gap:7,marginTop:8}}>
            <button onClick={()=>setError(null)} style={{padding:"4px 10px",borderRadius:5,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontFamily:"inherit"}}>Dismiss</button>
            {(isOL||isTR)&&<button onClick={()=>{setError(null);generateSchedule();}} style={{padding:"4px 12px",borderRadius:5,border:"none",background:`linear-gradient(135deg,${C.blue},${C.accent})`,color:"#000D1F",cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>↺ Retry</button>}
          </div>
        </div>
      </div>
    );
  };

  /* ─── RENDER ─────────────────────────────────────────────────────── */
  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'IBM Plex Mono','Courier New',monospace",fontSize:12}}>
      <style>{GLOBAL_CSS}</style>

      {/* HEADER */}
      <header style={{background:`linear-gradient(90deg,${C.surface} 0%,#060F26 100%)`,borderBottom:`1px solid ${C.border2}`,padding:"0 24px",height:54,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:200,boxShadow:"0 2px 20px rgba(0,0,0,.7)"}}>
        <div style={{display:"flex",alignItems:"center",gap:11}}>
          <div style={{width:36,height:36,background:`linear-gradient(135deg,${C.blue},${C.accent})`,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900,color:C.white,boxShadow:`0 0 14px ${C.blueGlow}`,fontFamily:"'Sora','Segoe UI',sans-serif",letterSpacing:"-1px"}}>PM</div>
          <div>
            <div style={{fontSize:18,fontWeight:700,color:C.white,letterSpacing:"-0.5px",fontFamily:"'Sora','Segoe UI',sans-serif",lineHeight:1}}>
              PMcopilots<span style={{color:C.blue}}>.</span>
            </div>
            <div style={{fontSize:8,color:C.textDim,letterSpacing:"2px",textTransform:"uppercase",marginTop:1}}>AI Construction Schedule Generator</div>
          </div>
        </div>
        <div style={{display:"flex",gap:7,alignItems:"center"}}>
          {schedule && (
            <>
              <button onClick={()=>exportToExcel(schedule,proj)} className="action-btn"
                style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${C.green}44`,background:`${C.green}12`,color:C.green,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"'Sora','Segoe UI',sans-serif",display:"flex",alignItems:"center",gap:5,transition:"opacity .15s"}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export Excel
              </button>
              <button onClick={()=>exportToPDF(schedule,proj)} className="action-btn"
                style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${C.red}44`,background:`${C.red}12`,color:C.red,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"'Sora','Segoe UI',sans-serif",display:"flex",alignItems:"center",gap:5,transition:"opacity .15s"}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Export PDF
              </button>
            </>
          )}
          {[["CPM ENGINE"],["BOQ → SCHEDULE"],["AI-POWERED"]].map(([l])=>(
            <span key={l} style={{background:`${C.blue}18`,border:`1px solid ${C.blue}44`,color:C.blueL,padding:"3px 9px",borderRadius:20,fontSize:8,letterSpacing:"1.5px"}}>{l}</span>
          ))}
        </div>
      </header>

      <div style={{maxWidth:1500,margin:"0 auto",padding:"16px 18px 40px"}}>
        {/* Always-visible input section */}
        <InputSection/>

        <ErrorDisplay/>

        {/* Loading */}
        {loading && (
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"40px",textAlign:"center",animation:"fadeUp .3s ease"}}>
            <div style={{fontSize:36,marginBottom:12,animation:"spin 2s linear infinite",display:"inline-block"}}>⚙</div>
            <div style={{fontSize:15,color:C.blueL,fontFamily:"'Sora','Segoe UI',sans-serif",fontWeight:700,marginBottom:6}}>Running CPM Engine</div>
            <div style={{color:C.textDim,marginBottom:18,minHeight:16}}>{loadMsg}</div>
            <div style={{maxWidth:400,margin:"0 auto",height:4,background:C.surface,borderRadius:2,overflow:"hidden",position:"relative"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,bottom:0,background:`linear-gradient(90deg,${C.blue},${C.accent})`,animation:"shimmer 1.5s linear infinite"}}/>
            </div>
          </div>
        )}

        {/* Results */}
        {schedule && !loading && (
          <div style={{animation:"fadeUp .5s ease"}}>
            {/* Stats strip */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
              {[
                [schedule.projectSummary?.totalActivities??"—","Activities",C.blueL],
                [schedule.projectSummary?.criticalActivities??"—","Critical",C.red],
                [schedule.floatAnalysis?.nearCriticalCount??"—","Near-Critical",C.orange],
                [schedule.projectSummary?.totalMilestones??"—","Milestones",C.purple],
                [fmtUSD(schedule.projectSummary?.totalBudget),"Budget",C.gold],
                [schedule.projectSummary?.totalDuration??"—","Duration",C.accent],
              ].map(([v,l,c])=>(
                <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px",textAlign:"center"}}>
                  <div style={{fontSize:18,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                  <div style={{fontSize:8,color:C.textDim,letterSpacing:"1px",textTransform:"uppercase",marginTop:2}}>{l}</div>
                </div>
              ))}
            </div>

            {/* Info strip */}
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
              <button onClick={()=>{setSchedule(null);}} style={{padding:"4px 10px",borderRadius:5,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontFamily:"inherit"}}>← New Schedule</button>
              <span style={{color:C.textDim,fontSize:10}}>{schedule.projectSummary?.name}</span>
              <span style={{color:C.border2}}>·</span>
              <span style={{color:C.textDim,fontSize:10}}>{schedule.projectSummary?.startDate} → {schedule.projectSummary?.endDate}</span>
            </div>

            {/* Tab panel */}
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden"}}>
              <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,padding:"0 16px",gap:2,overflowX:"auto",background:`linear-gradient(90deg,#071A40,${C.card})`}}>
                {TABS.map(({k,l})=>(
                  <button key={k} className="tab-hover"
                    style={{padding:"10px 13px",border:"none",background:"transparent",cursor:"pointer",fontSize:9,fontWeight:700,letterSpacing:"0.8px",textTransform:"uppercase",fontFamily:"'Sora','Segoe UI',sans-serif",transition:"all .15s",borderBottom:`2px solid ${tab===k?C.blue:"transparent"}`,color:tab===k?C.blueL:C.textDim,whiteSpace:"nowrap"}}
                    onClick={()=>setTab(k)}>{l}</button>
                ))}
              </div>

              <div style={{padding:18}}>
                {/* PM DASHBOARD */}
                {tab==="dashboard" && <PMDashboard schedule={schedule} proj={proj}/>}

                {/* DAILY CHECKLIST */}
                {tab==="checklist" && <DailyChecklist schedule={schedule}/>}

                {/* MASTER SCHEDULE */}
                {tab==="schedule" && (
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr>{["WBS","ID","Activity","Dur","ES","EF","LS","LF","TF","FF","Status","Pred.","Labor","Equipment","Budget"].map(h=><th key={h} style={{background:C.surface,padding:"6px 8px",textAlign:"left",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                      <tbody>
                        {(schedule.activities||[]).map((a,i)=>{
                          const crit=a.critical===true||a.critical==="YES";
                          const bg=a.isMilestone?"#12082B":crit?"#160808":i%2===0?"#080F22":C.surface;
                          return <tr key={a.id||i} className="row-hover" style={{background:bg}}>
                            <td style={{padding:"5px 8px",color:C.gold,fontSize:10,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{a.wbs}</td>
                            <td style={{padding:"5px 8px",color:C.textDim,fontSize:9,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{a.id}</td>
                            <td style={{padding:"5px 8px",color:a.isMilestone?C.purple:crit?"#F87171":C.text,fontWeight:a.isMilestone||crit?600:400,fontSize:10,minWidth:180,borderBottom:`1px solid ${C.border}`}}>
                              {a.isMilestone?"▶ ":""}{a.name}
                              {a.longLead&&<Tag style={{background:"#1A2200",color:"#84CC16",border:"1px solid #3B5000",fontSize:8,marginLeft:5}}>LL</Tag>}
                            </td>
                            <td style={{padding:"5px 8px",textAlign:"center",borderBottom:`1px solid ${C.border}`}}>{a.isMilestone?"—":a.duration}</td>
                            {["earlyStart","earlyFinish","lateStart","lateFinish"].map(f=><td key={f} style={{padding:"5px 8px",textAlign:"center",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{a[f]??'—'}</td>)}
                            <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`}}><FTag tf={a.totalFloat} crit={crit} ms={a.isMilestone}/></td>
                            <td style={{padding:"5px 8px",textAlign:"center",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{a.freeFloat??'—'}</td>
                            <td style={{padding:"5px 8px",borderBottom:`1px solid ${C.border}`}}><FTag tf={a.totalFloat} crit={crit} ms={a.isMilestone}/></td>
                            <td style={{padding:"5px 8px",fontSize:9,color:C.textDim,maxWidth:100,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",borderBottom:`1px solid ${C.border}`}}>{a.predecessors||"—"}</td>
                            <td style={{padding:"5px 8px",fontSize:9,color:C.textMid,maxWidth:130,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",borderBottom:`1px solid ${C.border}`}}>{a.labor||"—"}</td>
                            <td style={{padding:"5px 8px",fontSize:9,color:C.textMid,maxWidth:110,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",borderBottom:`1px solid ${C.border}`}}>{a.equipment||"—"}</td>
                            <td style={{padding:"5px 8px",textAlign:"right",color:C.gold,fontSize:10,whiteSpace:"nowrap",borderBottom:`1px solid ${C.border}`}}>{a.budget?fmtUSD(a.budget):"—"}</td>
                          </tr>;
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* P6 GANTT */}
                {tab==="gantt" && <div style={{animation:"fadeUp .3s ease"}}><div style={{background:"#040E28",border:`1px solid ${C.blue}33`,color:"#7BB3F0",borderRadius:7,padding:"8px 12px",fontSize:10,marginBottom:10,display:"flex",gap:7}}><span>ℹ</span><span>P6-style Gantt. Right-angle arrows show FS/SS/FF/SF dependencies. <span style={{color:C.teal}}>Teal bar = total float</span>. <span style={{color:C.gold}}>Gold line = simulated today (Day 30)</span>. Hover activity names to highlight.</span></div><P6Gantt activities={schedule.activities}/></div>}

                {/* CRITICAL PATH */}
                {tab==="critical" && (
                  <div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                      {[[schedule.floatAnalysis?.criticalCount,"Critical",C.red],[schedule.floatAnalysis?.nearCriticalCount,"Near-Critical",C.orange],[schedule.floatAnalysis?.nonCriticalCount,"Non-Critical",C.green],[(schedule.floatAnalysis?.avgFloat??'—')+"d","Avg Float",C.blueL]].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px",textAlign:"center"}}>
                          <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <SectionTitle icon="🔴">Critical Path Chain</SectionTitle>
                    {(schedule.criticalPath||[]).map((cp,i,arr)=>(
                      <div key={i} style={{display:"flex",alignItems:"flex-start",marginBottom:5,position:"relative"}}>
                        {i<arr.length-1&&<div style={{position:"absolute",left:13,top:30,width:2,height:20,background:`${C.red}44`}}/>}
                        <div style={{width:26,height:26,borderRadius:"50%",background:i===0||i===arr.length-1?"#2D1060":"#2D0808",border:`2px solid ${i===0||i===arr.length-1?C.purple:C.red}`,display:"flex",alignItems:"center",justifyContent:"center",color:i===0||i===arr.length-1?C.purple:"#F87171",fontSize:9,fontWeight:700,flexShrink:0,marginRight:9}}>{cp.seq}</div>
                        <div style={{flex:1,background:"#160808",border:"1px solid #5D151533",borderRadius:7,padding:"6px 11px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                            <span style={{color:"#F87171",fontWeight:700,fontSize:10}}>{cp.name}</span>
                            <div style={{display:"flex",gap:5,flexShrink:0}}>
                              <span style={{fontSize:9,color:C.textDim}}>d{cp.earlyStart}→d{cp.earlyFinish}</span>
                              <TagCrit>{cp.duration}d</TagCrit>
                            </div>
                          </div>
                          {cp.whyCritical&&<div style={{color:C.textDim,fontSize:9,marginTop:2}}>↳ {cp.whyCritical}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* WBS */}
                {tab==="wbs" && (
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr>{["WBS","Lvl","Name","Duration","Budget","Activities","Responsible"].map(h=><th key={h} style={{background:C.surface,padding:"6px 8px",textAlign:"left",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {(schedule.wbs||[]).map((w,i)=>{
                        const isTop=w.level===1;
                        return <tr key={i} className="row-hover" style={{background:isTop?"#071A40":i%2===0?"#080F22":C.surface}}>
                          <td style={{padding:"6px 8px",color:C.gold,fontWeight:isTop?700:400,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{w.code}</td>
                          <td style={{padding:"6px 8px",borderBottom:`1px solid ${C.border}`}}><Tag style={{background:["","#1D4ED833","#065F4633","#92400E33","#6B21A833"][Math.min(w.level,4)],color:["","#60A5FA","#34D399","#FCD34D","#C084FC"][Math.min(w.level,4)],border:"none"}}>L{w.level}</Tag></td>
                          <td style={{padding:"6px 8px",fontWeight:isTop?700:400,color:isTop?C.white:C.text,fontSize:10,paddingLeft:`${(w.level-1)*14+8}px`,borderBottom:`1px solid ${C.border}`}}>{w.name}</td>
                          <td style={{padding:"6px 8px",textAlign:"center",color:C.textMid,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{w.duration}d</td>
                          <td style={{padding:"6px 8px",textAlign:"right",color:C.gold,fontWeight:isTop?700:400,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{fmtUSD(w.budget)}</td>
                          <td style={{padding:"6px 8px",textAlign:"center",color:C.textDim,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{w.activities}</td>
                          <td style={{padding:"6px 8px",color:C.textMid,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{w.responsible}</td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                )}

                {/* RESOURCES */}
                {tab==="resources" && (
                  <div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:9,marginBottom:14}}>
                      {(schedule.resourceSummary||[]).map((r,i)=>(
                        <div key={i} style={{background:"#080F22",border:`1px solid ${C.border}`,borderRadius:9,padding:12}}>
                          <div style={{color:C.blueL,fontWeight:700,fontSize:10,marginBottom:3,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{r.phase}</div>
                          <div style={{color:C.textDim,fontSize:9,marginBottom:8}}>{r.period}</div>
                          <div style={{display:"flex",gap:7,marginBottom:8}}>
                            {[["Peak",r.peakLabor,C.red],["Avg",r.avgLabor,C.orange]].map(([l,v,c])=>(
                              <div key={l} style={{flex:1,textAlign:"center",background:C.surface,borderRadius:5,padding:"6px 0"}}>
                                <div style={{color:c,fontSize:14,fontWeight:700}}>{v}</div>
                                <div style={{color:C.textDim,fontSize:8,textTransform:"uppercase",letterSpacing:"1px"}}>{l}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{fontSize:9,color:C.textMid,marginBottom:2}}><span style={{color:C.textDim}}>Equipment: </span>{r.keyEquipment||"—"}</div>
                          <div style={{fontSize:9,color:C.textMid}}><span style={{color:C.textDim}}>Materials: </span>{r.keyMaterials||"—"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── CLIENT INVOICE ── */}
                {tab==="clientinvoice" && (()=>{
                  const items=clientInvoiceItems;
                  const calcRow=r=>{const cv=r.currCertQty*r.unitRate;const cumQ=r.prevCertQty+r.currCertQty;const cumV=cumQ*r.unitRate;const ret=cumV*retentionRate;const net=cv-(r.deductions||0);return{cv,cumQ,cumV,ret,net};};
                  const tots=items.reduce((a,r)=>{const c=calcRow(r);return{cv:a.cv+c.cv,cumV:a.cumV+c.cumV,ret:a.ret+c.ret,net:a.net+c.net,prevV:a.prevV+(r.prevCertQty*r.unitRate),vo:a.vo+(r.variationValue||0),ded:a.ded+(r.deductions||0)};},{cv:0,cumV:0,ret:0,net:0,prevV:0,vo:0,ded:0});
                  return(<div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{background:`linear-gradient(135deg,#04142E,#071A40)`,border:`1px solid ${C.blue}44`,borderRadius:12,padding:"14px 18px",marginBottom:14}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                        <div>
                          <div style={{fontSize:16,fontWeight:700,color:C.white,fontFamily:"'Sora','Segoe UI',sans-serif"}}>INTERIM PAYMENT CERTIFICATE (IPC)</div>
                          <div style={{fontSize:10,color:C.blueL,marginTop:2}}>Project: {proj.name||"Commercial Office Building"} · Period: {currentIPCPeriod}</div>
                          <div style={{fontSize:9,color:C.textDim,marginTop:1}}>Contract Value: <strong style={{color:C.gold}}>${parseFloat(proj.value||12100000).toLocaleString()}</strong> · Retention: <strong style={{color:C.orange}}>{(retentionRate*100).toFixed(0)}%</strong></div>
                        </div>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          <input value={currentIPCPeriod} onChange={e=>setCurrentIPCPeriod(e.target.value)} style={{background:C.surface,border:`1px solid ${C.border2}`,borderRadius:6,padding:"5px 10px",color:C.text,fontSize:10,fontFamily:"inherit",width:130}}/>
                          <button onClick={()=>{const csv=["BOQ Ref,Description,Unit,Contract Qty,Rate,Prev Cert Qty,Curr Exec Qty,Curr Cert Qty,Cum Cert Qty,Prev Cert $,Curr Cert $,Cum Cert $,Retention,Variation,Deductions,Net Payable",...items.map(r=>{const c=calcRow(r);return`${r.boqRef},"${r.description}",${r.unit},${r.contractQty},${r.unitRate},${r.prevCertQty},${r.currExecQty},${r.currCertQty},${c.cumQ},${r.prevCertQty*r.unitRate},${c.cv},${c.cumV},${c.ret},${r.variationValue||0},${r.deductions||0},${c.net}`;})].join("\n");const a=document.createElement("a");a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);a.download=`IPC_${currentIPCPeriod.replace(/ /g,"_")}.csv`;a.click();}} style={{background:`linear-gradient(135deg,${C.blue},${C.accent})`,border:"none",borderRadius:6,padding:"6px 14px",color:"#000D1F",fontWeight:700,fontSize:9,cursor:"pointer",fontFamily:"inherit"}}>↓ Export CSV</button>
                        </div>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:14}}>
                      {[["Previous Certified","$"+(tots.prevV/1e6).toFixed(2)+"M",C.textMid],["This Certificate","$"+(tots.cv/1e3).toFixed(0)+"K",C.blueL],["Cumulative Certified","$"+(tots.cumV/1e6).toFixed(2)+"M",C.gold],["Retention Held","$"+(tots.ret/1e3).toFixed(0)+"K",C.orange],["Net Payable","$"+(tots.net/1e3).toFixed(0)+"K",C.green]].map(([l,v,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                          <div style={{fontSize:15,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:9,minWidth:1500}}>
                        <thead><tr>{[["BOQ Ref","60"],["Description","170"],["Unit","38"],["Contract Qty","78"],["Rate","62"],["Prev Cert Qty","82"],["Curr Exec Qty","82"],["Curr Cert Qty","82"],["Cum Cert Qty","80"],["Prev Cert $","82"],["Curr Cert $","82"],["Cum Cert $","82"],["Retention","78"],["Variations","78"],["Deductions","78"],["NET PAYABLE","90"]].map(([h,w])=>(
                          <th key={h} style={{background:C.surface,padding:"5px 7px",color:C.textDim,letterSpacing:"1px",textTransform:"uppercase",borderBottom:`1px solid ${C.blue}55`,whiteSpace:"nowrap",textAlign:"right",minWidth:w}}>{h}</th>
                        ))}</tr></thead>
                        <tbody>{items.map((r,i)=>{
                          const c=calcRow(r);
                          return(<tr key={r.id} className="row-hover" style={{background:r.currCertQty>0?"#040E1C":i%2===0?"#080F22":C.surface}}>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontWeight:700}}>{r.boqRef}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.text,maxWidth:170,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.description}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"center",color:C.textDim}}>{r.unit}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid}}>{r.contractQty.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.gold}}>${r.unitRate.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textDim}}>{r.prevCertQty.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid}}>{r.currExecQty.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:r.currCertQty>0?C.blueL:C.textDim,fontWeight:r.currCertQty>0?700:400}}>{r.currCertQty.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid}}>{c.cumQ.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textDim}}>${(r.prevCertQty*r.unitRate).toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:c.cv>0?C.green:C.textDim,fontWeight:c.cv>0?700:400}}>${c.cv.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.gold}}>${c.cumV.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.orange}}>${c.ret.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:(r.variationValue||0)>0?C.blueL:C.textDim}}>${(r.variationValue||0).toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:(r.deductions||0)>0?C.red:C.textDim}}>{(r.deductions||0)>0?"-$"+r.deductions.toLocaleString():"—"}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:c.net>0?C.accent:C.textDim,fontWeight:700}}>${c.net.toLocaleString()}</td>
                          </tr>);
                        })}
                        <tr style={{background:"#040E28",borderTop:`2px solid ${C.blue}`}}>
                          <td colSpan={9} style={{padding:"7px",color:C.blueL,fontWeight:700,fontSize:10}}>CERTIFICATE TOTALS</td>
                          <td style={{padding:"7px",textAlign:"right",color:C.textDim,fontWeight:700}}>${tots.prevV.toLocaleString()}</td>
                          <td style={{padding:"7px",textAlign:"right",color:C.green,fontWeight:700}}>${tots.cv.toLocaleString()}</td>
                          <td style={{padding:"7px",textAlign:"right",color:C.gold,fontWeight:700}}>${tots.cumV.toLocaleString()}</td>
                          <td style={{padding:"7px",textAlign:"right",color:C.orange,fontWeight:700}}>${tots.ret.toLocaleString()}</td>
                          <td style={{padding:"7px",textAlign:"right",color:C.blueL,fontWeight:700}}>${tots.vo.toLocaleString()}</td>
                          <td style={{padding:"7px",textAlign:"right",color:tots.ded>0?C.red:C.textDim,fontWeight:700}}>{tots.ded>0?"-$"+tots.ded.toLocaleString():"—"}</td>
                          <td style={{padding:"7px",textAlign:"right",color:C.accent,fontWeight:900,fontSize:11}}>${tots.net.toLocaleString()}</td>
                        </tr></tbody>
                      </table>
                    </div>
                    <SectionTitle icon="📋">Variation / Change Order Schedule</SectionTitle>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}>
                        <thead><tr>{["VO Ref","Description","Value ($)","Status","Included This Cert"].map(h=><th key={h} style={{background:C.surface,padding:"5px 9px",color:C.textDim,textTransform:"uppercase",letterSpacing:"1.5px",borderBottom:`1px solid ${C.border2}`,textAlign:"left"}}>{h}</th>)}</tr></thead>
                        <tbody>{changeOrders.map((co,i)=>(
                          <tr key={co.id} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontWeight:700}}>{co.ref||`CO-${co.id}`}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,color:C.text}}>{co.description}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.gold,fontWeight:700}}>${(co.value||0).toLocaleString()}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:9,fontWeight:700,color:co.status==="Approved"?C.green:co.status==="Pending"?C.gold:C.red,background:`${co.status==="Approved"?C.green:C.gold}1A`,padding:"2px 7px",borderRadius:20}}>{co.status}</span></td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,color:co.status==="Approved"?C.green:C.textDim,fontWeight:700}}>{co.status==="Approved"?"✓ Yes":"—"}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>);
                })()}

                {/* ── SUBCONTRACTOR BILLING ── */}
                {tab==="subbilling" && (()=>{
                  const calcSub=r=>{const net=r.currCertified-r.retention-r.backCharges-(r.deductions||0);return{net};};
                  const tots=subValuations.reduce((a,r)=>{const c=calcSub(r);return{contract:a.contract+(r.contractValue||0),measured:a.measured+(r.measuredValue||0),prevPaid:a.prevPaid+(r.prevPayment||0),currCert:a.currCert+(r.currCertified||0),ret:a.ret+(r.retention||0),bc:a.bc+(r.backCharges||0),net:a.net+c.net};},{contract:0,measured:0,prevPaid:0,currCert:0,ret:0,bc:0,net:0});
                  const stC={"Paid":C.green,"Certified":C.blueL,"Under Assessment":C.gold,"On Hold":C.red,"Pending":C.textMid};
                  return(<div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:14}}>
                      {[["Total Subcontract Value","$"+(tots.contract/1e6).toFixed(2)+"M",C.blueL],["Measured to Date","$"+(tots.measured/1e6).toFixed(2)+"M",C.textMid],["Previously Paid","$"+(tots.prevPaid/1e3).toFixed(0)+"K",C.textDim],["This Valuation Certified","$"+(tots.currCert/1e3).toFixed(0)+"K",C.gold],["Net Payable","$"+(tots.net/1e3).toFixed(0)+"K",C.green]].map(([l,v,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                          <div style={{fontSize:15,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:9,minWidth:1300}}>
                        <thead><tr>{[["#","40"],["Subcontractor","145"],["Period","85"],["Scope","72"],["Contract Val","88"],["Measured","82"],["Prev Paid","82"],["Curr Claim","82"],["Certified","82"],["Retention","78"],["Back Charges","88"],["Deductions","82"],["NET PAYABLE","90"],["Status","95"],["Cert Date","82"],["Pay Date","82"],["Notes","115"]].map(([h,w])=>(
                          <th key={h} style={{background:C.surface,padding:"5px 7px",color:C.textDim,letterSpacing:"1px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"right",minWidth:w}}>{h}</th>
                        ))}</tr></thead>
                        <tbody>{subValuations.map((r,i)=>{
                          const c=calcSub(r); const sc=stC[r.status]||C.textMid;
                          return(<tr key={r.id} className="row-hover" style={{background:r.status==="On Hold"?"#160808":r.status==="Paid"?"#061A0E":i%2===0?"#080F22":C.surface}}>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontWeight:700}}>{String(i+1).padStart(2,"0")}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.text,fontWeight:600}}>{r.subcontractor}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{r.period}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.gold,fontWeight:700,fontSize:8}}>{r.scopeRef}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid}}>${r.contractValue.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid}}>${r.measuredValue.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textDim}}>${r.prevPayment.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid}}>${r.currClaim.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.gold,fontWeight:700}}>${r.currCertified.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.orange}}>${r.retention.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:r.backCharges>0?C.red:C.textDim}}>{r.backCharges>0?"-$"+r.backCharges.toLocaleString():"—"}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:(r.deductions||0)>0?C.red:C.textDim}}>{(r.deductions||0)>0?"-$"+r.deductions.toLocaleString():"—"}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:c.net>0?C.accent:C.red,fontWeight:700,fontSize:10}}>${Math.max(0,c.net).toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`}}>
                              <select value={r.status} onChange={e=>setSubValuations(p=>p.map(x=>x.id===r.id?{...x,status:e.target.value}:x))} style={{background:"transparent",border:`1px solid ${sc}44`,color:sc,borderRadius:20,padding:"2px 6px",fontSize:8,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                {["Pending","Under Assessment","Certified","Paid","On Hold"].map(s=><option key={s}>{s}</option>)}
                              </select>
                            </td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{r.certDate||"—"}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:r.payDate?C.green:C.textDim,fontSize:8}}>{r.payDate||"Pending"}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.orange,fontSize:8,maxWidth:115}}>{r.notes||"—"}</td>
                          </tr>);
                        })}
                        <tr style={{background:"#040E28",borderTop:`2px solid ${C.blue}`}}>
                          <td colSpan={4} style={{padding:"7px",color:C.blueL,fontWeight:700,fontSize:10}}>TOTALS</td>
                          {[tots.contract,tots.measured,tots.prevPaid,0,tots.currCert,tots.ret,tots.bc,0].map((v,j)=>(
                            <td key={j} style={{padding:"7px",textAlign:"right",color:j===4?C.gold:C.textMid,fontWeight:j===4?700:400}}>{v>0?`$${v.toLocaleString()}`:"—"}</td>
                          ))}
                          <td style={{padding:"7px",textAlign:"right",color:C.accent,fontWeight:900,fontSize:11}}>${tots.net.toLocaleString()}</td>
                          <td colSpan={3}/>
                        </tr></tbody>
                      </table>
                    </div>
                    <button onClick={()=>setSubValuations(p=>[...p,{id:Date.now(),subcontractor:"",period:currentIPCPeriod,scopeRef:"",contractValue:0,measuredValue:0,prevPayment:0,currClaim:0,currCertified:0,retention:0,backCharges:0,deductions:0,status:"Pending",certDate:"",payDate:"",notes:""}])} style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Add Valuation</button>
                  </div>);
                })()}

                {/* MILESTONES */}
                {tab==="milestones" && (
                  <div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:9,marginBottom:14}}>
                      {(schedule.milestones||[]).map((m,i,arr)=>(
                        <div key={i} style={{background:m.critical?"#12082B":"#080F22",border:`1px solid ${m.critical?C.purple:C.border}`,borderRadius:9,padding:12,display:"flex",gap:9}}>
                          <div style={{width:32,height:32,borderRadius:7,background:m.critical?`${C.purple}22`:`${C.blue}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>
                            {i===0?"🚀":i===arr.length-1?"🏁":"◆"}
                          </div>
                          <div style={{flex:1}}>
                            <div style={{color:m.critical?C.purple:C.textMid,fontWeight:700,fontSize:10}}>{m.name}</div>
                            <div style={{display:"flex",gap:5,marginTop:3}}><TagMS>Day {m.day}</TagMS>{m.dateStr&&<span style={{color:C.textDim,fontSize:9,lineHeight:"18px"}}>{m.dateStr}</span>}</div>
                            {m.description&&<div style={{color:C.textDim,fontSize:9,marginTop:3}}>{m.description}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* RISK PLAN */}
                {tab==="riskplan" && <RiskPlan schedule={schedule}/>}

                {/* ASSUMPTIONS */}
                {tab==="assumptions" && <AssumptionsRegister schedule={schedule}/>}

                {/* LONG LEAD */}
                {/* ══ AI COPILOT ══ */}
                {tab==="ai" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{background:`linear-gradient(135deg,#04142E,#071A40)`,border:`1px solid ${C.blue}44`,borderRadius:12,padding:"16px 18px",marginBottom:14,display:"flex",gap:12,alignItems:"center"}}>
                      <div style={{width:48,height:48,borderRadius:12,background:`linear-gradient(135deg,${C.blue},${C.accent})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,boxShadow:`0 0 20px ${C.blueGlow}`}}>🤖</div>
                      <div>
                        <div style={{fontSize:16,fontWeight:700,color:C.white,fontFamily:"'Sora','Segoe UI',sans-serif"}}>PMcopilots AI Copilot</div>
                        <div style={{fontSize:10,color:C.textMid,marginTop:2}}>Powered by Claude · Reads your live project data · Gives expert PM guidance</div>
                      </div>
                    </div>

                    {/* Mode selector */}
                    <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                      {[
                        {k:"briefing",l:"📋 Daily Briefing",desc:"What needs attention today?"},
                        {k:"recovery",l:"🔧 Recovery Advisor",desc:"How do I get back on track?"},
                        {k:"risks",l:"⚠ Risk Identifier",desc:"What risks am I missing?"},
                        {k:"minutes",l:"📝 Meeting Minutes",desc:"Turn notes into formal minutes"},
                        {k:"report",l:"📊 Weekly Report",desc:"Write my progress report"},
                      ].map(m=>(
                        <button key={m.k} onClick={()=>{setAiMode(m.k);setAiOutput("");}}
                          style={{padding:"9px 13px",borderRadius:9,border:`1px solid ${aiMode===m.k?C.blue:C.border}`,background:aiMode===m.k?`${C.blue}22`:C.surface,color:aiMode===m.k?C.blueL:C.textDim,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"'Sora','Segoe UI',sans-serif",transition:"all .15s",textAlign:"left"}}>
                          <div>{m.l}</div>
                          <div style={{fontSize:8,color:aiMode===m.k?`${C.blueL}99`:C.textDim,marginTop:1,fontWeight:400}}>{m.desc}</div>
                        </button>
                      ))}
                    </div>

                    {/* Meeting notes input */}
                    {aiMode==="minutes" && (
                      <div style={{marginBottom:12}}>
                        <label style={{display:"block",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:5}}>Paste Raw Meeting Notes</label>
                        <textarea value={aiMeetingNotes} onChange={e=>setAiMeetingNotes(e.target.value)} rows={6} placeholder="Paste your rough meeting notes here — who attended, what was discussed, decisions made, actions agreed…"
                          style={{width:"100%",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:8,padding:"10px 12px",color:C.text,fontSize:10,fontFamily:"inherit",outline:"none",resize:"vertical",lineHeight:1.6}}/>
                      </div>
                    )}

                    {/* Generate button */}
                    <button disabled={aiLoading} onClick={async()=>{
                      if(!schedule){setAiOutput("Please generate a schedule first so I have project data to analyse.");return;}
                      setAiLoading(true); setAiOutput("");
                      const acts=schedule.activities||[];
                      const critActs=acts.filter(a=>a.critical===true||a.critical==="YES");
                      const openRFIs=rfis.filter(r=>r.status!=="Answered");
                      const openDefects=defects.filter(d=>d.status==="Open");
                      const pendingDecisions=decisions.filter(d=>d.status==="Pending");
                      const overdueActions=actionItems.filter(a=>a.status==="Overdue");
                      const urgentProcure=(schedule.longLeadItems||[]).filter(ll=>(ll.leadWeeks*5-30)<=10);
                      const openNCRs=ncrs.filter(n=>n.status!=="Closed");
                      const projectContext=`
PROJECT: ${proj.name} | ${proj.type} | ${proj.location}
Contract Value: $${(parseFloat(proj.value)||schedule.projectSummary?.totalBudget||0).toLocaleString()}
Duration: ${proj.duration} ${proj.unit} | Start: ${proj.start}
Total Activities: ${acts.length} | Critical Path: ${critActs.length} activities
SPI: ~0.92 | CPI: ~0.95 | Approx Day 30 of project
Open RFIs: ${openRFIs.length} (${openRFIs.filter(r=>r.status==="Overdue").length} overdue)
Open Defects: ${openDefects.length} | Open NCRs: ${openNCRs.length}
Pending Decisions: ${pendingDecisions.map(d=>d.description).join("; ")}
Overdue Actions: ${overdueActions.map(a=>a.description).join("; ")}
Urgent Procurement: ${urgentProcure.map(l=>l.item).join(", ")||"None"}
Active Change Orders: ${changeOrders.filter(c=>c.status==="Pending").length} pending (value: $${changeOrders.filter(c=>c.status==="Pending").reduce((s,c)=>s+c.value,0).toLocaleString()})
Open Safety Issues: ${safetyIncidents.filter(s=>s.status==="Open").length}
Near-Critical Activities (TF≤5): ${acts.filter(a=>!a.critical&&(a.totalFloat??99)<=5&&!a.isMilestone).map(a=>a.name).slice(0,5).join(", ")}
Top Critical Path: ${critActs.slice(0,5).map(a=>a.name).join(" → ")}`;

                      const prompts={
                        briefing:`You are a senior construction Project Manager assistant. Based on the project data below, produce a concise but complete DAILY PM BRIEFING. Format it as:
1. 🚦 OVERALL STATUS (1 line: RAG status + key headline)
2. 🔴 CRITICAL ACTIONS TODAY (top 5 things PM must do today, numbered)
3. ⚠ WATCH ITEMS (things to monitor, 3-5 bullets)
4. 📦 PROCUREMENT ALERTS (any items needing ordering)
5. 💬 SUGGESTED COMMUNICATIONS (who to call/email today and why)
6. 🔮 FORECAST (one-line outlook for next 7 days)
Be direct, specific, and actionable. Use the real data provided.\n\n${projectContext}`,
                        recovery:`You are a senior construction planner. The project is running behind schedule (SPI 0.92). Analyse the project data and produce a SCHEDULE RECOVERY PLAN with:
1. ROOT CAUSE ANALYSIS (why are we behind?)
2. RECOVERY OPTIONS (list 4-6 specific options with time saved, cost, and feasibility for each)
3. RECOMMENDED STRATEGY (which combination to implement and why)
4. IMPLEMENTATION STEPS (week by week for next 4 weeks)
5. RISK OF RECOVERY PLAN (what could go wrong)
Be specific to THIS project's data — reference real activities, subs, and risks.\n\n${projectContext}`,
                        risks:`You are a construction risk manager. Based on the project data below, identify RISKS NOT YET LOGGED that the PM should be aware of. For each risk provide: Risk description, Probability (H/M/L), Impact (H/M/L), Severity, and Mitigation action. Focus on risks arising from the specific combination of this project's RFIs, NCRs, procurement status, near-critical activities, and pending decisions. Identify at least 8 new risks.\n\n${projectContext}`,
                        minutes:`You are a construction project administrator. Convert the following raw meeting notes into formal MEETING MINUTES in this structure:
PROJECT: ${proj.name}
DATE: ${new Date().toLocaleDateString()}
ATTENDEES: [extract from notes or list as "To be confirmed"]
1. MATTERS ARISING FROM LAST MINUTES
2. PROGRESS UPDATE
3. DESIGN & TECHNICAL
4. COMMERCIAL
5. HEALTH & SAFETY
6. ACTION ITEMS (table: No | Action | Owner | Due Date | Status)
7. DATE OF NEXT MEETING

MEETING NOTES:
${aiMeetingNotes||"No notes provided — please paste your meeting notes above."}`,
                        report:`You are a construction PM writing a WEEKLY PROGRESS REPORT to the client. Write a professional, concise report covering:
EXECUTIVE SUMMARY (3-4 lines)
WORK COMPLETED THIS WEEK (bullet points by discipline)
WORK PLANNED NEXT WEEK
SCHEDULE STATUS (SPI, critical path, any slippage)
COMMERCIAL STATUS (COs, budget)
QUALITY & SAFETY (incidents, NCRs, inspections)
OPEN ISSUES & DECISIONS REQUIRED FROM CLIENT
LOOK-AHEAD (next 2 weeks key activities)
Tone: professional, factual, client-facing. This will be sent to the client rep.\n\n${projectContext}`,
                      };
                      try {
                        const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
                          model:"claude-sonnet-4-20250514",max_tokens:2000,
                          system:"You are an expert construction project management advisor with 25 years experience on large commercial projects. Provide specific, actionable, data-driven advice. Use the exact project data provided.",
                          messages:[{role:"user",content:prompts[aiMode]}]
                        })});
                        const data=await res.json();
                        setAiOutput(data.content?.find(b=>b.type==="text")?.text||"No response generated.");
                      } catch(e){ setAiOutput("Error: "+e.message); }
                      setAiLoading(false);
                    }} className="gen-btn"
                      style={{padding:"10px 24px",borderRadius:8,border:"none",cursor:aiLoading?"not-allowed":"pointer",fontSize:11,fontWeight:900,fontFamily:"'Sora','Segoe UI',sans-serif",background:`linear-gradient(135deg,${C.blue},${C.accent})`,color:"#000D1F",animation:"pulseBlue 3s infinite",opacity:aiLoading?.7:1,marginBottom:14}}>
                      {aiLoading?"🤖 Analysing project data…":{briefing:"📋 Generate Daily Briefing",recovery:"🔧 Generate Recovery Plan",risks:"⚠ Identify Hidden Risks",minutes:"📝 Format Meeting Minutes",report:"📊 Write Weekly Report"}[aiMode]}
                    </button>

                    {/* Output */}
                    {aiOutput && (
                      <div style={{background:"#040E28",border:`1px solid ${C.blue}33`,borderRadius:10,padding:"16px 18px",animation:"fadeUp .3s ease"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                          <span style={{fontSize:10,color:C.blueL,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase"}}>🤖 AI Copilot Response</span>
                          <button onClick={()=>{navigator.clipboard?.writeText(aiOutput);}} style={{background:C.surface,border:`1px solid ${C.border2}`,color:C.textMid,borderRadius:5,padding:"3px 10px",cursor:"pointer",fontSize:9,fontFamily:"inherit"}}>Copy</button>
                        </div>
                        <div style={{fontSize:11,color:C.text,lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"'IBM Plex Mono',monospace"}}>{aiOutput}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* ══ BASELINE VS CURRENT ══ */}
                {tab==="baseline" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{background:"#040E28",border:`1px solid ${C.blue}33`,color:"#7BB3F0",borderRadius:7,padding:"8px 12px",fontSize:10,marginBottom:12,display:"flex",gap:7,justifyContent:"space-between",alignItems:"center"}}>
                      <span>📏 Baseline = original approved schedule (Day 0). Current = schedule with simulated 8% slippage. Slippage shown in orange. Critical path slippage in red.</span>
                      <button onClick={()=>setShowBaseline(p=>!p)} style={{background:C.surface,border:`1px solid ${C.border2}`,color:C.textMid,borderRadius:5,padding:"3px 10px",cursor:"pointer",fontSize:9,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                        {showBaseline?"Hide Baseline":"Show Baseline"}
                      </button>
                    </div>

                    {/* Summary slippage stats */}
                    {(()=>{
                      const acts=schedule?.activities||[];
                      const slipFactor=1.08;
                      const slipped=acts.filter(a=>!a.isMilestone).map(a=>({...a,currentFinish:Math.round(a.earlyFinish*slipFactor),slip:Math.round(a.earlyFinish*(slipFactor-1))}));
                      const critSlipped=slipped.filter(a=>(a.critical===true||a.critical==="YES")&&a.slip>0);
                      const maxSlip=slipped.reduce((mx,a)=>Math.max(mx,a.slip),0);
                      const avgSlip=Math.round(slipped.reduce((s,a)=>s+a.slip,0)/Math.max(slipped.length,1));
                      return(
                        <>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                            {[
                              [maxSlip+"d","Max Activity Slippage",C.red],
                              [avgSlip+"d","Avg Activity Slippage",C.orange],
                              [critSlipped.length,"Critical Activities Slipped",C.red],
                              [Math.round((schedule?.activities||[]).reduce((mx,a)=>Math.max(mx,a.earlyFinish||0),0)*0.08)+"d","Project Float Eroded",C.gold],
                            ].map(([v,l,c])=>(
                              <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                                <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                                <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                              </div>
                            ))}
                          </div>

                          <div style={{overflowX:"auto"}}>
                            <table style={{width:"100%",borderCollapse:"collapse"}}>
                              <thead><tr>
                                {["WBS","Activity","Critical","Baseline Finish","Current Finish","Slippage","Baseline Float","Status"].map(h=>(
                                  <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                                ))}
                              </tr></thead>
                              <tbody>
                                {slipped.map((a,i)=>{
                                  const isCrit=a.critical===true||a.critical==="YES";
                                  const slipClr=a.slip>10?C.red:a.slip>5?C.orange:a.slip>0?C.gold:C.green;
                                  return (
                                    <tr key={a.id||i} className="row-hover" style={{background:isCrit&&a.slip>0?"#160808":i%2===0?"#080F22":C.surface}}>
                                      <td style={{padding:"5px 9px",color:C.gold,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{a.wbs}</td>
                                      <td style={{padding:"5px 9px",fontSize:10,color:isCrit?"#F87171":C.text,fontWeight:isCrit?600:400,borderBottom:`1px solid ${C.border}`,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</td>
                                      <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`}}>{isCrit?<TagCrit>CP</TagCrit>:<span style={{color:C.textDim,fontSize:10}}>—</span>}</td>
                                      <td style={{padding:"5px 9px",textAlign:"center",color:C.blueL,fontSize:10,borderBottom:`1px solid ${C.border}`}}>d{a.earlyFinish}</td>
                                      <td style={{padding:"5px 9px",textAlign:"center",color:a.slip>0?slipClr:C.green,fontWeight:a.slip>0?700:400,fontSize:10,borderBottom:`1px solid ${C.border}`}}>d{a.currentFinish}</td>
                                      <td style={{padding:"5px 9px",textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
                                        {a.slip>0
                                          ?<span style={{display:"inline-block",padding:"2px 8px",borderRadius:20,fontSize:9,fontWeight:700,background:`${slipClr}1A`,color:slipClr,border:`1px solid ${slipClr}44`}}>+{a.slip}d</span>
                                          :<span style={{color:C.green,fontSize:10}}>On Time</span>}
                                      </td>
                                      <td style={{padding:"5px 9px",textAlign:"center",color:C.textDim,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{a.totalFloat??0}d</td>
                                      <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`}}>
                                        {a.slip===0?<TagFree>No Change</TagFree>:isCrit?<TagCrit>Delayed</TagCrit>:<TagNear>Behind</TagNear>}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* ══ EOT & LD ══ */}
                {tab==="eot" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    {(()=>{
                      const totalGranted=eotClaims.filter(e=>e.status==="Approved"||e.status==="Partially Approved").reduce((s,e)=>s+(e.daysGranted||0),0);
                      const totalClaimed=eotClaims.reduce((s,e)=>s+(e.daysClamed||0),0);
                      const currentExposure=Math.max(0,(contractCompletionDay+30)-contractCompletionDay-totalGranted)*ldRate;
                      const potentialLD=Math.max(0,30-totalGranted)*ldRate;
                      return(
                        <>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                            {[
                              [totalClaimed+"d","Total Days Claimed",C.blueL],
                              [totalGranted+"d","Days Granted",C.green],
                              [`$${currentExposure.toLocaleString()}`,"LD Exposure (Current)",currentExposure>0?C.red:C.green],
                              [`$${ldRate.toLocaleString()}/d`,"LD Rate",C.orange],
                            ].map(([v,l,c])=>(
                              <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                                <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                                <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                              </div>
                            ))}
                          </div>

                          <div style={{background:"#160A00",border:"1px solid #92400E44",borderRadius:9,padding:"12px 14px",marginBottom:14,display:"flex",gap:12,alignItems:"center"}}>
                            <span style={{fontSize:22}}>⚖</span>
                            <div>
                              <div style={{fontSize:11,fontWeight:700,color:C.gold,marginBottom:3}}>Liquidated Damages Tracker</div>
                              <div style={{fontSize:10,color:C.textMid}}>LD Rate: <strong style={{color:C.gold}}>${ldRate.toLocaleString()}/day</strong> · Contract Completion: <strong style={{color:C.blueL}}>Day {contractCompletionDay}</strong> · Total Exposure if 30d late with {totalGranted}d EOT granted: <strong style={{color:potentialLD>0?C.red:C.green}}>${potentialLD.toLocaleString()}</strong></div>
                            </div>
                          </div>

                          <SectionTitle icon="📋">Extension of Time Register</SectionTitle>
                          <div style={{overflowX:"auto",marginBottom:12}}>
                            <table style={{width:"100%",borderCollapse:"collapse"}}>
                              <thead><tr>
                                {["Ref","Delay Event","Date","Notice Sent","Days Claimed","Days Granted","Status","Value","LD Exposure","Linked CO","Notes"].map(h=>(
                                  <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                                ))}
                              </tr></thead>
                              <tbody>
                                {eotClaims.map((e,i)=>{
                                  const sc={"Approved":C.green,"Partially Approved":C.gold,"Rejected":C.red,"Under Assessment":C.blueL}[e.status]||C.textMid;
                                  return(
                                    <tr key={e.id} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                                      <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{e.ref}</td>
                                      <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:200,borderBottom:`1px solid ${C.border}`}}>{e.event}</td>
                                      <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{e.dateOfEvent}</td>
                                      <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{e.noticeSent}</td>
                                      <td style={{padding:"6px 9px",textAlign:"center",fontWeight:700,color:C.orange,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{e.daysClamed}d</td>
                                      <td style={{padding:"6px 9px",textAlign:"center",fontWeight:700,color:e.daysGranted>0?C.green:C.textDim,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{e.daysGranted}d</td>
                                      <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                        <select value={e.status} onChange={ev=>setEotClaims(p=>p.map(x=>x.id===e.id?{...x,status:ev.target.value}:x))}
                                          style={{background:"transparent",border:`1px solid ${sc}44`,color:sc,borderRadius:20,padding:"2px 7px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                          {["Under Assessment","Approved","Partially Approved","Rejected"].map(s=><option key={s}>{s}</option>)}
                                        </select>
                                      </td>
                                      <td style={{padding:"6px 9px",textAlign:"right",color:C.gold,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{e.value>0?`$${e.value.toLocaleString()}`:"—"}</td>
                                      <td style={{padding:"6px 9px",textAlign:"right",color:e.ldExposure>0?C.red:C.green,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{e.ldExposure>0?`$${e.ldExposure.toLocaleString()}`:"Nil"}</td>
                                      <td style={{padding:"6px 9px",fontSize:9,color:C.blueL,borderBottom:`1px solid ${C.border}`}}>{e.linkedCO||"—"}</td>
                                      <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,maxWidth:160,borderBottom:`1px solid ${C.border}`}}>{e.notes}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <button onClick={()=>setEotClaims(p=>[...p,{id:Date.now(),ref:`EOT-${String(p.length+1).padStart(3,"0")}`,event:"",dateOfEvent:new Date().toISOString().split("T")[0],noticeSent:"",daysClamed:0,daysGranted:0,status:"Under Assessment",value:0,ldExposure:0,linkedRFI:"",linkedCO:"",notes:""}])}
                            style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Add EOT Claim</button>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* ── MATERIALS MBS ── */}
                {tab==="materials" && (()=>{
                  return(<div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
                      {[[materialMaster.length,"Material Codes Defined",C.blueL],[activityMaterials.filter(m=>["Partially Delivered","On Order","In Fabrication"].includes(m.status)).length,"Active Procurement Lines",C.gold],[activityMaterials.filter(m=>m.status==="Not Ordered").length,"Items Not Yet Ordered",C.orange],[stockBalance.filter(s=>s.reorderAlert).length,"Reorder Alerts",C.red]].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <SectionTitle icon="📦">Material Master Register</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:14}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:9,minWidth:1400}}>
                        <thead><tr>{[["Code","100"],["Name","170"],["Specification","195"],["Unit","45"],["Category","95"],["Lead wk","60"],["Unit Cost","72"],["Min Stock","72"],["Reorder Pt","72"],["Warehouse Location","145"],["Supplier","125"],["Notes","120"]].map(([h,w])=>(
                          <th key={h} style={{background:C.surface,padding:"5px 7px",color:C.textDim,letterSpacing:"1px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left",minWidth:w}}>{h}</th>
                        ))}</tr></thead>
                        <tbody>{materialMaster.map((m,i)=>(
                          <tr key={m.code} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",fontSize:8}}>{m.code}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.white,fontWeight:600}}>{m.name}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textMid,fontSize:8}}>{m.spec}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"center",color:C.textDim}}>{m.unit}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:8,fontWeight:700,color:C.blueL,background:`${C.blue}1A`,padding:"2px 6px",borderRadius:20}}>{m.category}</span></td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"center",color:m.leadWeeksProcure>=8?C.red:m.leadWeeksProcure>=4?C.gold:C.green,fontWeight:700}}>{m.leadWeeksProcure}w</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.gold}}>${m.unitCost.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textDim}}>{m.minStock}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.orange}}>{m.reorderPoint}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textMid,fontSize:8}}>{m.warehouseLoc}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textMid,fontWeight:600,fontSize:8}}>{m.supplier}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{m.notes||"—"}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <SectionTitle icon="🔗">Activity Material Requirements (MBS)</SectionTitle>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:9,minWidth:1300}}>
                        <thead><tr>{[["ID","55"],["Activity","65"],["Material Code","120"],["Req Qty","72"],["Waste %","60"],["Total Planned","82"],["Del Plan","82"],["Del Actual","88"],["Issued Qty","72"],["Remaining","72"],["Status","120"],["Est Value","80"]].map(([h,w])=>(
                          <th key={h} style={{background:C.surface,padding:"5px 7px",color:C.textDim,letterSpacing:"1px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"right",minWidth:w}}>{h}</th>
                        ))}</tr></thead>
                        <tbody>{activityMaterials.map((am,i)=>{
                          const mat=materialMaster.find(m=>m.code===am.materialCode);
                          const stC={"Issued":C.green,"Delivered":C.blueL,"Partially Delivered":C.gold,"On Order":C.orange,"In Fabrication":C.textMid,"Not Ordered":C.red}[am.status]||C.textDim;
                          return(<tr key={am.id} className="row-hover" style={{background:am.status==="Not Ordered"?"#160808":i%2===0?"#080F22":C.surface}}>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontWeight:700}}>{am.id}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.gold,fontSize:8}}>{am.activityRef}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontFamily:"'IBM Plex Mono',monospace",fontSize:8}}>{am.materialCode}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid}}>{am.requiredQty.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.orange}}>{(am.wasteAllowance*100).toFixed(0)}%</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid,fontWeight:700}}>{am.totalPlannedQty.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textDim,fontSize:8}}>{am.deliveryPlanned||"—"}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:am.deliveryActual?C.green:C.textDim,fontSize:8}}>{am.deliveryActual||"Pending"}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:am.issuedQty>0?C.green:C.textDim}}>{am.issuedQty.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:am.remainingQty>0?C.orange:C.green}}>{am.remainingQty.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:8,fontWeight:700,color:stC,background:`${stC}1A`,padding:"2px 7px",borderRadius:20,border:`1px solid ${stC}33`}}>{am.status}</span></td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.gold}}>{mat?"$"+(am.totalPlannedQty*mat.unitCost).toLocaleString():"—"}</td>
                          </tr>);
                        })}</tbody>
                      </table>
                    </div>
                  </div>);
                })()}

                {/* ── WAREHOUSE / STOCK ── */}
                {tab==="warehouse" && (()=>{
                  return(<div style={{animation:"fadeUp .3s ease"}}>
                    {stockBalance.filter(s=>s.reorderAlert).length>0&&(
                      <div style={{background:"#160808",border:`1px solid ${C.red}44`,borderRadius:9,padding:"10px 14px",marginBottom:12,display:"flex",gap:10,alignItems:"flex-start"}}>
                        <span style={{fontSize:18}}>🔴</span>
                        <div>
                          <div style={{fontSize:11,fontWeight:700,color:C.red,marginBottom:4}}>REORDER ALERTS — ACTION REQUIRED</div>
                          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                            {stockBalance.filter(s=>s.reorderAlert).map(s=>{
                              const mat=materialMaster.find(m=>m.code===s.materialCode);
                              return(<span key={s.id} style={{fontSize:9,fontWeight:700,color:C.orange,background:"#2A0C0C",padding:"3px 9px",borderRadius:20,border:`1px solid ${C.red}33`}}>{mat?.name||s.materialCode}: {s.available} {s.unit} available (reorder at {mat?.reorderPoint||"?"})</span>);
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                    <SectionTitle icon="📊">Current Stock Balance</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:14}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}>
                        <thead><tr>{["Code","Material Name","On Hand","Reserved","Available","Unit","Min Stock","Reorder Pt","Location","Status","Last Updated"].map(h=>(
                          <th key={h} style={{background:C.surface,padding:"5px 9px",color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"right",textAlignLast:"left"}}>{h}</th>
                        ))}</tr></thead>
                        <tbody>{stockBalance.map((s,i)=>{
                          const mat=materialMaster.find(m=>m.code===s.materialCode);
                          return(<tr key={s.id} className="row-hover" style={{background:s.reorderAlert?"#160A00":i%2===0?"#080F22":C.surface}}>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontFamily:"'IBM Plex Mono',monospace",fontSize:8}}>{s.materialCode}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,color:C.white,fontWeight:600}}>{mat?.name||"—"}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid,fontWeight:700}}>{s.onHand}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.orange}}>{s.reserved}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:s.reorderAlert?C.red:C.green,fontWeight:700,fontSize:10}}>{s.available}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"center",color:C.textDim}}>{s.unit}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textDim}}>{mat?.minStock||0}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.orange}}>{mat?.reorderPoint||0}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,color:C.textMid,fontSize:8}}>{s.location}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"center"}}>{s.reorderAlert?<span style={{color:C.red,fontWeight:700,fontSize:9}}>🔴 REORDER</span>:<span style={{color:C.green,fontSize:9}}>✓ OK</span>}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{s.lastUpdated}</td>
                          </tr>);
                        })}</tbody>
                      </table>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
                      {[{title:"Warehouse A — Secure Store",items:stockBalance.filter(s=>s.location.includes("Warehouse A"))},{title:"Warehouse B — MEP Store",items:stockBalance.filter(s=>s.location.includes("Warehouse B"))},{title:"Site Laydown Areas",items:stockBalance.filter(s=>s.location.includes("Laydown")||s.location.includes("Batch"))}].map(({title,items})=>(
                        <div key={title} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,padding:"12px 14px"}}>
                          <div style={{fontSize:10,fontWeight:700,color:C.white,marginBottom:7}}>{title}</div>
                          {items.length===0?<div style={{fontSize:9,color:C.textDim}}>No items</div>:items.map(s=>{
                            const mat=materialMaster.find(m=>m.code===s.materialCode);
                            return(<div key={s.id} style={{display:"flex",justifyContent:"space-between",marginBottom:5,paddingBottom:5,borderBottom:`1px solid ${C.border}`}}>
                              <span style={{fontSize:9,color:C.textMid,maxWidth:"65%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{mat?.name||s.materialCode}</span>
                              <span style={{fontSize:9,fontWeight:700,color:s.reorderAlert?C.red:C.green}}>{s.available} {s.unit}</span>
                            </div>);
                          })}
                        </div>
                      ))}
                    </div>
                  </div>);
                })()}

                {/* ── GRN ── */}
                {tab==="grn" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
                      {[[goodsReceipts.length,"Total GRNs",C.blueL],[goodsReceipts.filter(g=>g.status==="Accepted").length,"Accepted",C.green],[goodsReceipts.filter(g=>g.status.includes("Partial")||g.status.includes("Rejected")).length,"Partial / Issues",C.orange],["$"+goodsReceipts.reduce((s,g)=>s+(g.quantityReceived*(materialMaster.find(m=>m.code===g.materialCode)?.unitCost||0)),0).toLocaleString(),"Total Value Received",C.gold]].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                          <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <SectionTitle icon="📦">Goods Receipt Note Register</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:9,minWidth:1300}}>
                        <thead><tr>{["GRN","Date","PO Ref","Mat Code","Description","Ordered","Received","Unit","Supplier","Del Note","Inspector","Activity","Cost Code","Zone","Status","Notes"].map(h=>(
                          <th key={h} style={{background:C.surface,padding:"5px 7px",color:C.textDim,letterSpacing:"1px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                        ))}</tr></thead>
                        <tbody>{goodsReceipts.map((g,i)=>{
                          const stC=g.status==="Accepted"?C.green:g.status.includes("Partial")||g.status.includes("Rejected")?C.orange:C.textDim;
                          return(<tr key={g.id} className="row-hover" style={{background:g.status.includes("Partial")?"#160A00":i%2===0?"#080F22":C.surface}}>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontWeight:700}}>{g.id}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{g.date}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.gold,fontSize:8}}>{g.poRef}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontFamily:"'IBM Plex Mono',monospace",fontSize:8}}>{g.materialCode}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.text,fontSize:8}}>{g.description}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid}}>{g.quantityOrdered}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:g.quantityReceived<g.quantityOrdered?C.orange:C.green,fontWeight:700}}>{g.quantityReceived}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"center",color:C.textDim}}>{g.unit}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textMid,fontSize:8}}>{g.supplier}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{g.deliveryNote}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{g.inspector}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.gold,fontSize:8}}>{g.activityRef}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.gold,fontSize:8}}>{g.costCode}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8,maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.zone}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:8,fontWeight:700,color:stC,background:`${stC}1A`,padding:"2px 7px",borderRadius:20}}>{g.status}</span></td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{g.notes||"—"}</td>
                          </tr>);
                        })}</tbody>
                      </table>
                    </div>
                    <button onClick={()=>setGoodsReceipts(p=>[...p,{id:`GRN${String(p.length+1).padStart(3,"0")}`,date:new Date().toISOString().split("T")[0],poRef:"",materialCode:"",description:"",quantityOrdered:0,quantityReceived:0,unit:"",supplier:"",deliveryNote:"",inspector:"",activityRef:"",costCode:"",zone:"",status:"Accepted",notes:""}])} style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Add GRN</button>
                  </div>
                )}

                {/* ── MATERIAL ISSUES ── */}
                {tab==="issues" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
                      {[[materialIssues.length,"Total Issue Vouchers",C.blueL],[[...new Set(materialIssues.map(m=>m.issuedTo))].length,"Subcontractors Issued To",C.textMid],["$"+materialIssues.reduce((s,m)=>s+(materialMaster.find(x=>x.code===m.materialCode)?.unitCost||0)*m.quantityIssued,0).toLocaleString(),"Total Value Issued",C.gold],[[...new Set(materialIssues.map(m=>m.activityRef))].length,"Activities Covered",C.green]].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                          <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <SectionTitle icon="📤">Material Issue Voucher Register</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:9,minWidth:1200}}>
                        <thead><tr>{["MIV Ref","Date","Mat Code","Description","Qty Issued","Unit","Issued To","MR Ref","Activity","Cost Code","Zone","Engineer","Est. Value","Notes"].map(h=>(
                          <th key={h} style={{background:C.surface,padding:"5px 7px",color:C.textDim,letterSpacing:"1px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                        ))}</tr></thead>
                        <tbody>{materialIssues.map((m,i)=>{
                          const mat=materialMaster.find(x=>x.code===m.materialCode);
                          return(<tr key={m.id} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontWeight:700}}>{m.id}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{m.date}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontFamily:"'IBM Plex Mono',monospace",fontSize:8}}>{m.materialCode}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.text,fontSize:8}}>{m.description}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.gold,fontWeight:700}}>{m.quantityIssued}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"center",color:C.textDim}}>{m.unit}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textMid,fontWeight:600,fontSize:8}}>{m.issuedTo}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{m.requestRef}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.gold,fontSize:8}}>{m.activityRef}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.gold,fontSize:8}}>{m.costCode}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8,maxWidth:115,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.zone}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{m.engineer}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.orange}}>{mat?"$"+(m.quantityIssued*mat.unitCost).toLocaleString():"—"}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8,maxWidth:115}}>{m.notes||"—"}</td>
                          </tr>);
                        })}</tbody>
                      </table>
                    </div>
                    <button onClick={()=>setMaterialIssues(p=>[...p,{id:`MIV${String(p.length+1).padStart(3,"0")}`,date:new Date().toISOString().split("T")[0],materialCode:"",description:"",quantityIssued:0,unit:"",issuedTo:"",requestRef:`MR-${String(p.length+1).padStart(3,"0")}`,activityRef:"",costCode:"",zone:"",engineer:"",notes:""}])} style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Issue Materials</button>
                  </div>
                )}

                {/* ── WASTAGE LOG ── */}
                {tab==="wastage" && (()=>{
                  const totalWV=wastageLog.reduce((s,w)=>s+(w.value||0),0);
                  const byResp=[...new Set(wastageLog.map(w=>w.responsible))].map(r=>({name:r,total:wastageLog.filter(w=>w.responsible===r).reduce((s,w)=>s+(w.value||0),0),count:wastageLog.filter(w=>w.responsible===r).length}));
                  return(<div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
                      {[[wastageLog.length,"Wastage Events",C.orange],["$"+totalWV.toLocaleString(),"Total Waste Value",C.red],[[...new Set(wastageLog.map(w=>w.materialCode))].length,"Materials Affected",C.blueL],[wastageLog.filter(w=>w.action.includes("Charged")||w.action.includes("claim")).length,"Recovery Actions",C.green]].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                          <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:12,marginBottom:14}}>
                      <div>
                        <SectionTitle icon="⚠">Wastage & Damaged Goods Register</SectionTitle>
                        <div style={{overflowX:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}>
                            <thead><tr>{["Ref","Date","Material","Qty","Unit","Reason","Activity","Cost Code","Value","Responsible","Action","Zone"].map(h=><th key={h} style={{background:C.surface,padding:"5px 7px",color:C.textDim,letterSpacing:"1px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>)}</tr></thead>
                            <tbody>{wastageLog.map((w,i)=>(
                              <tr key={w.id} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                                <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontWeight:700}}>{w.id}</td>
                                <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{w.date}</td>
                                <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.text,fontSize:8}}>{w.description}</td>
                                <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.orange,fontWeight:700}}>{w.quantityWasted}</td>
                                <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"center",color:C.textDim}}>{w.unit}</td>
                                <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textMid,fontSize:8,maxWidth:140}}>{w.reason}</td>
                                <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.gold,fontSize:8}}>{w.activityRef}</td>
                                <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.gold,fontSize:8}}>{w.costCode}</td>
                                <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.red,fontWeight:700}}>${w.value.toLocaleString()}</td>
                                <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textMid,fontSize:8}}>{w.responsible}</td>
                                <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{w.action}</td>
                                <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{w.zone}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                        </div>
                      </div>
                      <div>
                        <SectionTitle icon="👷">Waste by Responsible Party</SectionTitle>
                        {byResp.map(r=>(
                          <div key={r.name} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",marginBottom:7}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                              <span style={{fontSize:10,color:C.text,fontWeight:600}}>{r.name}</span>
                              <span style={{fontSize:9,color:C.textDim}}>{r.count} events</span>
                            </div>
                            <div style={{fontSize:14,fontWeight:700,color:C.red,marginBottom:4}}>${r.total.toLocaleString()}</div>
                            <div style={{height:5,background:C.card,borderRadius:3,overflow:"hidden"}}>
                              <div style={{width:`${Math.round((r.total/totalWV)*100)}%`,height:"100%",background:C.red}}/>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <button onClick={()=>setWastageLog(p=>[...p,{id:`WST${String(p.length+1).padStart(3,"0")}`,date:new Date().toISOString().split("T")[0],materialCode:"",description:"",quantityWasted:0,unit:"",reason:"",activityRef:"",costCode:"",value:0,responsible:"",action:"",zone:""}])} style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Log Wastage</button>
                  </div>);
                })()}

                {/* ══ FULL PROCUREMENT TRACKER ══ */}
                {tab==="procurement" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [procurement.filter(p=>p.status==="Installed"||p.status==="Complete").length,"Installed/Complete",C.green],
                        [procurement.filter(p=>p.status==="In Fabrication").length,"In Fabrication",C.blueL],
                        [procurement.filter(p=>p.status==="Shop Drawings").length,"Shop Drawings Stage",C.gold],
                        [procurement.filter(p=>p.status==="Order Placed").length,"Order Placed",C.orange],
                        [procurement.filter(p=>p.status==="Tendering").length,"Tendering",C.purple],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                          <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>

                    {/* Pipeline visual */}
                    <SectionTitle icon="🚚">Procurement Pipeline</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:14}}>
                      {procurement.map((p,i)=>{
                        const stages=["Tendering","Order Placed","Shop Drawings","In Fabrication","Delivery","Installed"];
                        const stageIdx=stages.indexOf(p.status);
                        return (
                          <div key={p.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 14px",marginBottom:7}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,gap:8,flexWrap:"wrap"}}>
                              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                                <TagBlue>{p.ref}</TagBlue>
                                <span style={{fontSize:11,fontWeight:700,color:C.white}}>{p.item}</span>
                                <TagGold>{p.category}</TagGold>
                              </div>
                              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                                <span style={{fontSize:9,color:C.textDim}}>Lead: <strong style={{color:C.gold}}>{p.leadWeeks}w</strong></span>
                                <span style={{fontSize:9,color:C.textDim}}>Supplier: <strong style={{color:C.textMid}}>{p.supplier}</strong></span>
                              </div>
                            </div>
                            {/* Stage pipeline */}
                            <div style={{display:"flex",gap:0,marginBottom:6}}>
                              {stages.map((s,si)=>{
                                const done=si<=stageIdx;
                                const active=si===stageIdx;
                                return(
                                  <div key={s} style={{flex:1,textAlign:"center",position:"relative"}}>
                                    <div style={{height:4,background:done?C.blue:C.card,borderRadius:si===0?"3px 0 0 3px":si===stages.length-1?"0 3px 3px 0":"0",transition:"background .3s"}}/>
                                    <div style={{width:10,height:10,borderRadius:"50%",background:done?C.blue:C.card,border:`2px solid ${done?C.blue:C.border2}`,margin:"-7px auto 3px",position:"relative",boxShadow:active?`0 0 8px ${C.blue}`:""}}/>
                                    <div style={{fontSize:7,color:active?C.blueL:done?`${C.blueL}88`:C.textDim,fontWeight:active?700:400,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s}</div>
                                  </div>
                                );
                              })}
                            </div>
                            <div style={{display:"flex",gap:14,fontSize:9,color:C.textDim,flexWrap:"wrap"}}>
                              {p.awardDate&&<span>📋 Awarded: <span style={{color:C.textMid}}>{p.awardDate}</span></span>}
                              {p.shopDrawings!=="N/A"&&<span>📐 Shop Drawings: <span style={{color:p.shopDrawings==="Approved"?C.green:C.gold}}>{p.shopDrawings}</span></span>}
                              {p.deliveryPlanned&&<span>📦 Delivery Planned: <span style={{color:C.textMid}}>{p.deliveryPlanned}</span></span>}
                              {p.deliveryActual&&<span>✓ Delivered: <span style={{color:C.green}}>{p.deliveryActual}</span></span>}
                            </div>
                            {p.notes&&<div style={{marginTop:5,fontSize:9,color:C.orange}}>⚠ {p.notes}</div>}
                          </div>
                        );
                      })}
                    </div>
                    <button onClick={()=>setProcurement(p=>[...p,{id:Date.now(),ref:`PROC-${String(p.length+1).padStart(3,"0")}`,item:"",category:"Material",supplier:"",tenderDate:"",awardDate:"",shopDrawings:"Pending",fabricationStart:"",deliveryPlanned:"",deliveryActual:"",installPlanned:"",installActual:"",status:"Tendering",leadWeeks:8,notes:""}])}
                      style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Add Procurement Item</button>
                  </div>
                )}

                {/* ══ ITP ══ */}
                {tab==="itp" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [itpItems.filter(i=>i.status==="Passed").length,"Passed",C.green],
                        [itpItems.filter(i=>i.status==="Pending"||i.status==="Not Due").length,"Pending / Not Due",C.gold],
                        [itpItems.filter(i=>i.status==="Failed").length,"Failed",C.red],
                        [itpItems.filter(i=>i.type==="Hold Point").length,"Hold Points",C.orange],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <SectionTitle icon="📋">Inspection & Test Plan Register</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Ref","Activity","Inspection Description","Discipline","Type","Inspected By","Witnessed By","Date","Result","Status","Notes"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {itpItems.map((itp,i)=>{
                            const typeClr={"Hold Point":C.red,"Witness Point":C.orange,"Review Point":C.gold}[itp.type]||C.textMid;
                            const stClr={"Passed":C.green,"Failed":C.red,"Pending":C.gold,"Not Due":C.textDim}[itp.status]||C.textMid;
                            return(
                              <tr key={itp.id} className="row-hover" style={{background:itp.type==="Hold Point"&&itp.status==="Pending"?"#160808":i%2===0?"#080F22":C.surface}}>
                                <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{itp.ref}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:140,borderBottom:`1px solid ${C.border}`}}>{itp.activity}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textMid,maxWidth:180,borderBottom:`1px solid ${C.border}`}}>{itp.description}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{itp.discipline}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <span style={{fontSize:9,fontWeight:700,color:typeClr}}>{itp.type}</span>
                                </td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{itp.inspectedBy}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{itp.witnessedBy}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{itp.date||"—"}</td>
                                <td style={{padding:"6px 9px",fontSize:9,fontWeight:700,color:itp.result==="Pass"?C.green:itp.result==="Fail"?C.red:C.textDim,borderBottom:`1px solid ${C.border}`}}>{itp.result||"—"}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <select value={itp.status} onChange={e=>setItpItems(p=>p.map(x=>x.id===itp.id?{...x,status:e.target.value,date:e.target.value==="Passed"||e.target.value==="Failed"?new Date().toISOString().split("T")[0]:x.date,result:e.target.value==="Passed"?"Pass":e.target.value==="Failed"?"Fail":x.result}:x))}
                                    style={{background:"transparent",border:`1px solid ${stClr}44`,color:stClr,borderRadius:20,padding:"2px 6px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                    {["Not Due","Pending","Passed","Failed"].map(s=><option key={s}>{s}</option>)}
                                  </select>
                                </td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,maxWidth:150,borderBottom:`1px solid ${C.border}`}}>{itp.notes||"—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={()=>setItpItems(p=>[...p,{id:Date.now(),ref:`ITP-${String(p.length+1).padStart(3,"0")}`,activity:"",description:"",discipline:"",phase:"",inspectedBy:"",witnessedBy:"",type:"Witness Point",status:"Not Due",date:"",result:"",notes:""}])}
                      style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Add ITP Item</button>
                  </div>
                )}

                {/* ══ NCR ══ */}
                {tab==="ncr" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [ncrs.filter(n=>n.status==="Open").length,"Open NCRs",ncrs.filter(n=>n.status==="Open").length>0?C.red:C.green],
                        [ncrs.filter(n=>n.severity==="Major"&&n.status==="Open").length,"Major Open",C.red],
                        [ncrs.filter(n=>n.status==="Closed").length,"Closed",C.green],
                        [ncrs.reduce((s,n)=>s+(n.cost||0),0),"Total Rectification Cost",C.orange],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                          <div style={{fontSize:v>999?"16px":"22px",fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{typeof v==="number"&&v>999?`$${v.toLocaleString()}`:v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>

                    {/* Trend by sub */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                      <div>
                        <SectionTitle icon="🏗">NCRs by Subcontractor</SectionTitle>
                        {[...new Set(ncrs.map(n=>n.responsible))].map(sub=>{
                          const cnt=ncrs.filter(n=>n.responsible===sub).length;
                          const open=ncrs.filter(n=>n.responsible===sub&&n.status==="Open").length;
                          const pct=Math.round((cnt/ncrs.length)*100);
                          return(
                            <div key={sub} style={{marginBottom:8}}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                                <span style={{fontSize:10,color:C.textMid}}>{sub}</span>
                                <div style={{display:"flex",gap:8}}>
                                  <span style={{fontSize:9,color:C.textDim}}>{cnt} total</span>
                                  {open>0&&<span style={{fontSize:9,fontWeight:700,color:C.red}}>{open} open</span>}
                                </div>
                              </div>
                              <div style={{height:5,background:C.surface,borderRadius:3,overflow:"hidden"}}>
                                <div style={{width:`${pct}%`,height:"100%",background:open>0?C.red:C.green}}/>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div>
                        <SectionTitle icon="📊">Severity Breakdown</SectionTitle>
                        {[["Critical",C.red],["Major",C.orange],["Minor",C.gold]].map(([sev,clr])=>{
                          const cnt=ncrs.filter(n=>n.severity===sev).length;
                          if(!cnt) return null;
                          return(
                            <div key={sev} style={{marginBottom:8}}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                                <span style={{fontSize:10,color:clr,fontWeight:700}}>{sev}</span>
                                <span style={{fontSize:9,color:C.textDim}}>{cnt} NCRs</span>
                              </div>
                              <div style={{height:5,background:C.surface,borderRadius:3,overflow:"hidden"}}>
                                <div style={{width:`${Math.round((cnt/ncrs.length)*100)}%`,height:"100%",background:clr}}/>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <SectionTitle icon="📋">NCR Register</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Ref","Description","Discipline","Severity","Raised","Due","Responsible","Disposition","Status","Root Cause","Cost"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {ncrs.map((n,i)=>{
                            const sevClr={"Critical":C.red,"Major":C.orange,"Minor":C.gold}[n.severity]||C.textMid;
                            return(
                              <tr key={n.id} className="row-hover" style={{background:n.severity==="Major"&&n.status==="Open"?"#160808":i%2===0?"#080F22":C.surface}}>
                                <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{n.ref}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:180,borderBottom:`1px solid ${C.border}`}}>{n.description}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{n.discipline}</td>
                                <td style={{padding:"6px 9px",fontSize:10,fontWeight:700,color:sevClr,borderBottom:`1px solid ${C.border}`}}>{n.severity}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{n.raisedDate}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:n.status==="Open"?C.orange:C.textDim,borderBottom:`1px solid ${C.border}`}}>{n.dueDate}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textMid,maxWidth:130,borderBottom:`1px solid ${C.border}`}}>{n.responsible}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,maxWidth:160,borderBottom:`1px solid ${C.border}`}}>{n.disposition}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <select value={n.status} onChange={e=>setNcrs(p=>p.map(x=>x.id===n.id?{...x,status:e.target.value,closedDate:e.target.value==="Closed"?new Date().toISOString().split("T")[0]:x.closedDate}:x))}
                                    style={{background:n.status==="Closed"?"#0A2D15":"#1A0808",border:`1px solid ${n.status==="Closed"?C.green:C.red}44`,color:n.status==="Closed"?C.green:C.red,borderRadius:20,padding:"2px 6px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                    {["Open","In Progress","Closed"].map(s=><option key={s}>{s}</option>)}
                                  </select>
                                </td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,maxWidth:140,borderBottom:`1px solid ${C.border}`}}>{n.rootCause}</td>
                                <td style={{padding:"6px 9px",textAlign:"right",color:n.cost>0?C.orange:C.textDim,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{n.cost>0?`$${n.cost.toLocaleString()}`:"—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={()=>setNcrs(p=>[...p,{id:Date.now(),ref:`NCR-${String(p.length+1).padStart(3,"0")}`,description:"",discipline:"",raisedBy:"QA Manager",raisedDate:new Date().toISOString().split("T")[0],dueDate:"",closedDate:"",status:"Open",severity:"Major",disposition:"Under review",responsible:"",rootCause:"",cost:0}])}
                      style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Raise NCR</button>
                  </div>
                )}

                {/* ══ MATERIAL TESTS ══ */}
                {tab==="tests" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [materialTests.filter(t=>t.result==="Pass").length,"Tests Passed",C.green],
                        [materialTests.filter(t=>t.result==="Fail").length,"Tests Failed",materialTests.filter(t=>t.result==="Fail").length>0?C.red:C.green],
                        [materialTests.filter(t=>!t.result).length,"Pending Results",C.gold],
                        [Math.round((materialTests.filter(t=>t.result==="Pass").length/Math.max(materialTests.length,1))*100)+"%","Pass Rate",C.blueL],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <SectionTitle icon="🧪">Material Test Results Register</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Ref","Material","Test Type","Date","Specified","Actual Result","Result","Tested By","Certificate","Notes"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {materialTests.map((t,i)=>(
                            <tr key={t.id} className="row-hover" style={{background:t.result==="Fail"?"#160808":i%2===0?"#080F22":C.surface}}>
                              <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{t.ref}</td>
                              <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:180,borderBottom:`1px solid ${C.border}`}}>{t.material}</td>
                              <td style={{padding:"6px 9px",fontSize:9,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{t.testType}</td>
                              <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{t.date}</td>
                              <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{t.specValue}</td>
                              <td style={{padding:"6px 9px",fontSize:10,fontWeight:700,color:t.result==="Pass"?C.green:t.result==="Fail"?C.red:C.textDim,borderBottom:`1px solid ${C.border}`}}>{t.actualValue||"—"}</td>
                              <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                <select value={t.result} onChange={e=>setMaterialTests(p=>p.map(x=>x.id===t.id?{...x,result:e.target.value}:x))}
                                  style={{background:t.result==="Pass"?"#0A2D15":t.result==="Fail"?"#1A0808":"transparent",border:`1px solid ${t.result==="Pass"?C.green:t.result==="Fail"?C.red:C.border2}44`,color:t.result==="Pass"?C.green:t.result==="Fail"?C.red:C.textDim,borderRadius:20,padding:"2px 7px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                  <option value="">Pending</option>
                                  <option value="Pass">Pass</option>
                                  <option value="Fail">Fail</option>
                                </select>
                              </td>
                              <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{t.testedBy}</td>
                              <td style={{padding:"6px 9px",fontSize:9,color:C.blueL,borderBottom:`1px solid ${C.border}`}}>{t.certificate||"—"}</td>
                              <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,maxWidth:150,borderBottom:`1px solid ${C.border}`}}>{t.notes||"—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={()=>setMaterialTests(p=>[...p,{id:Date.now(),ref:`TEST-${String(p.length+1).padStart(3,"0")}`,material:"",testType:"",date:new Date().toISOString().split("T")[0],specValue:"",actualValue:"",result:"",testedBy:"",certificate:"",notes:""}])}
                      style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Log Test Result</button>
                  </div>
                )}

                {/* ══ PRODUCTIVITY ══ */}
                {tab==="productivity" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{background:"#040E28",border:`1px solid ${C.blue}33`,color:"#7BB3F0",borderRadius:7,padding:"8px 12px",fontSize:10,marginBottom:12,display:"flex",gap:7}}>
                      <span>ℹ</span><span>Track actual vs planned production output by trade. Low productivity = early warning of schedule risk before it shows in float.</span>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10,marginBottom:16}}>
                      {productivity.map((p,i)=>{
                        const pct=p.planned>0?Math.round((p.actual/p.planned)*100):0;
                        const pctClr=pct>=90?C.green:pct>=75?C.gold:pct>0?C.red:C.textDim;
                        const variance=p.actual-p.planned;
                        return(
                          <div key={p.id} style={{background:C.card,border:`1px solid ${pct<75&&p.actual>0?C.red:C.border}`,borderRadius:10,padding:"13px 14px"}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                              <div style={{fontSize:11,fontWeight:700,color:C.white}}>{p.trade}</div>
                              <TagBlue>{p.week}</TagBlue>
                            </div>
                            <div style={{fontSize:10,color:C.textMid,marginBottom:8}}>{p.metric} ({p.unit})</div>
                            <div style={{display:"flex",gap:8,marginBottom:8}}>
                              <div style={{flex:1,background:C.surface,borderRadius:6,padding:"8px",textAlign:"center"}}>
                                <div style={{fontSize:16,fontWeight:700,color:C.blueL}}>{p.planned}</div>
                                <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase"}}>Planned</div>
                              </div>
                              <div style={{flex:1,background:C.surface,borderRadius:6,padding:"8px",textAlign:"center"}}>
                                <div style={{fontSize:16,fontWeight:700,color:p.actual>0?pctClr:C.textDim}}>{p.actual}</div>
                                <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase"}}>Actual</div>
                              </div>
                              <div style={{flex:1,background:C.surface,borderRadius:6,padding:"8px",textAlign:"center"}}>
                                <div style={{fontSize:16,fontWeight:700,color:pctClr}}>{p.actual>0?pct+"%":"—"}</div>
                                <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase"}}>Efficiency</div>
                              </div>
                            </div>
                            <div style={{height:6,background:C.surface,borderRadius:3,overflow:"hidden",marginBottom:6}}>
                              <div style={{width:`${Math.min(100,pct)}%`,height:"100%",background:pctClr,borderRadius:3,transition:"width .5s"}}/>
                            </div>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                              <span style={{fontSize:9,color:variance>=0?C.green:C.red,fontWeight:700}}>
                                {p.actual>0?(variance>=0?`+${variance}`:variance)+` ${p.unit.split("/")[0]}/day`:"Not mobilised"}
                              </span>
                              <button onClick={()=>{const v=prompt("Actual output:",p.actual);if(v!==null)setProductivity(prev=>prev.map(x=>x.id===p.id?{...x,actual:+v}:x));}}
                                style={{background:C.surface,border:`1px solid ${C.border2}`,color:C.textMid,borderRadius:5,padding:"2px 9px",cursor:"pointer",fontSize:8,fontFamily:"inherit"}}>Update</button>
                            </div>
                            {p.notes&&<div style={{marginTop:6,fontSize:9,color:C.orange,borderTop:`1px solid ${C.border}`,paddingTop:5}}>⚠ {p.notes}</div>}
                          </div>
                        );
                      })}
                      <button onClick={()=>setProductivity(p=>[...p,{id:Date.now(),trade:"",metric:"",unit:"units/day",planned:0,actual:0,week:`W${p.length+1}`,phase:"",notes:""}])}
                        style={{background:C.surface,border:`2px dashed ${C.border2}`,borderRadius:10,padding:"20px",cursor:"pointer",color:C.textDim,fontSize:10,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        + Add Trade
                      </button>
                    </div>

                    {/* Overall site efficiency bar */}
                    <SectionTitle icon="📊">Overall Site Efficiency This Week</SectionTitle>
                    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,padding:"12px 14px"}}>
                      <div style={{display:"flex",gap:6,alignItems:"flex-end",height:80}}>
                        {productivity.map((p,i)=>{
                          const pct=p.planned>0?Math.min(100,Math.round((p.actual/p.planned)*100)):0;
                          const clr=pct>=90?C.green:pct>=75?C.gold:pct>0?C.red:C.textDim;
                          return(
                            <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                              {p.actual>0&&<span style={{fontSize:7,color:clr,fontWeight:700}}>{pct}%</span>}
                              <div style={{width:"100%",height:p.actual>0?Math.max(4,Math.round(pct*0.7)):4,background:p.actual>0?clr:C.card,borderRadius:"3px 3px 0 0",opacity:.85}}/>
                              <span style={{fontSize:7,color:C.textDim,textAlign:"center",maxWidth:60,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.trade.split(" ")[0]}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}


                {/* ── COST CONTROL ── */}
                {tab==="costcontrol" && (()=>{
                  const cc=activityCosts;
                  const sumF=(f)=>cc.reduce((s,r)=>s+(r[f]||0),0);
                  const totB=cc.map(r=>r.budgetLabour+r.budgetMaterial+r.budgetEquipment+r.budgetSubcontract+r.budgetIndirect+r.budgetOverhead+r.budgetContingency);
                  const totC=cc.map(r=>r.committedLabour+r.committedMaterial+r.committedEquipment+r.committedSubcontract);
                  const totA=cc.map(r=>r.actualLabour+r.actualMaterial+r.actualEquipment+r.actualSubcontract);
                  const totF=cc.map(r=>r.forecastLabour+r.forecastMaterial+r.forecastEquipment+r.forecastSubcontract+r.budgetIndirect+r.budgetOverhead+r.budgetContingency);
                  const gB=totB.reduce((a,b)=>a+b,0),gA=totA.reduce((a,b)=>a+b,0),gF=totF.reduce((a,b)=>a+b,0),gC=totC.reduce((a,b)=>a+b,0);
                  const gCV=gB-gF;
                  return(<div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:14}}>
                      {[["Total Budget","$"+(gB/1e6).toFixed(2)+"M",C.blueL],["Committed","$"+(gC/1e6).toFixed(2)+"M",C.gold],["Actual Cost","$"+(gA/1e6).toFixed(2)+"M",C.orange],["Forecast EAC","$"+(gF/1e6).toFixed(2)+"M",gCV<0?C.red:C.green],["Cost Variance",(gCV<0?"-":"+")+` $${(Math.abs(gCV)/1e3).toFixed(0)}K`,gCV<0?C.red:C.green],["ETC","$"+((gF-gA)/1e6).toFixed(2)+"M",C.textMid]].map(([l,v,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                          <div style={{fontSize:17,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,padding:"12px 14px",marginBottom:14}}>
                      <div style={{fontSize:9,fontWeight:700,color:C.textMid,marginBottom:8,textTransform:"uppercase",letterSpacing:"1px"}}>Budget Breakdown by Cost Category</div>
                      {[["Labour",sumF("budgetLabour"),C.blue],["Material",sumF("budgetMaterial"),C.gold],["Equipment",sumF("budgetEquipment"),C.orange],["Subcontract",sumF("budgetSubcontract"),C.accent],["Indirect+OH",sumF("budgetIndirect")+sumF("budgetOverhead"),C.textMid],["Contingency",sumF("budgetContingency"),C.red]].map(([l,v,c])=>{
                        const pct=Math.round((v/gB)*100);
                        return(<div key={l} style={{display:"flex",alignItems:"center",gap:10,marginBottom:5}}>
                          <span style={{width:80,fontSize:9,color:C.textDim,textAlign:"right"}}>{l}</span>
                          <div style={{flex:1,height:6,background:C.card,borderRadius:3,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:c}}/></div>
                          <span style={{width:90,fontSize:9,color:c,fontWeight:700}}>${(v/1e3).toFixed(0)}K</span>
                          <span style={{width:30,fontSize:9,color:C.textDim}}>{pct}%</span>
                        </div>);
                      })}
                    </div>
                    <SectionTitle icon="📋">Activity Cost Control Register</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:9,minWidth:1500}}>
                        <thead><tr style={{background:C.surface}}>
                          {[["Act","60"],["Cost Code","80"],["WBS","65"],["Zone","105"],["Trade","75"],["Bgt Labour","78"],["Bgt Material","85"],["Bgt Equip","78"],["Bgt Sub","78"],["OH+Cont","75"],["TOTAL BUDGET","90"],["Committed","82"],["Actual","78"],["EAC","82"],["CV","75"],["ETC","78"],["% Comp","65"],["Status","85"]].map(([h,w])=>(
                            <th key={h} style={{padding:"5px 7px",color:C.textDim,letterSpacing:"1px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"right",minWidth:w,background:C.surface}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {cc.map((r,i)=>{
                            const bgt=r.budgetLabour+r.budgetMaterial+r.budgetEquipment+r.budgetSubcontract+r.budgetIndirect+r.budgetOverhead+r.budgetContingency;
                            const com=r.committedLabour+r.committedMaterial+r.committedEquipment+r.committedSubcontract;
                            const act=r.actualLabour+r.actualMaterial+r.actualEquipment+r.actualSubcontract;
                            const fcs=r.forecastLabour+r.forecastMaterial+r.forecastEquipment+r.forecastSubcontract+r.budgetIndirect+r.budgetOverhead+r.budgetContingency;
                            const cv=bgt-fcs; const etc=fcs-act;
                            const cvC=cv<0?C.red:C.green;
                            const stC={"Complete":C.green,"In Progress":C.blueL,"Not Started":C.textDim}[r.status]||C.textDim;
                            return(<tr key={r.id} className="row-hover" style={{background:cv<-10000?"#160808":i%2===0?"#080F22":C.surface}}>
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontWeight:700}}>{r.activityRef}</td>
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.gold,fontSize:8}}>{r.costCode}</td>
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{r.wbs}</td>
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textMid,fontSize:8,maxWidth:105,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.zone}</td>
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{r.trade}</td>
                              {[r.budgetLabour,r.budgetMaterial,r.budgetEquipment,r.budgetSubcontract].map((v,j)=>(
                                <td key={j} style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid,fontSize:9}}>${v.toLocaleString()}</td>
                              ))}
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textDim,fontSize:9}}>${(r.budgetIndirect+r.budgetOverhead+r.budgetContingency).toLocaleString()}</td>
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.blueL,fontWeight:700,fontSize:9}}>${bgt.toLocaleString()}</td>
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.gold,fontSize:9}}>${com.toLocaleString()}</td>
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.orange,fontSize:9}}>${act.toLocaleString()}</td>
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:cv<0?C.red:C.textMid,fontWeight:cv<0?700:400,fontSize:9}}>${fcs.toLocaleString()}</td>
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:cvC,fontWeight:700,fontSize:9}}>{cv<0?"-":"+"} ${Math.abs(cv).toLocaleString()}</td>
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid,fontSize:9}}>${etc.toLocaleString()}</td>
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"center"}}>
                                <div style={{position:"relative",height:13,background:C.card,borderRadius:3,overflow:"hidden",width:46,margin:"0 auto"}}>
                                  <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${r.percentComplete}%`,background:r.percentComplete===100?C.green:C.blue}}/>
                                  <span style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:700,color:"#fff"}}>{r.percentComplete}%</span>
                                </div>
                              </td>
                              <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`}}>
                                <span style={{fontSize:8,fontWeight:700,color:stC,background:`${stC}1A`,padding:"2px 6px",borderRadius:20,border:`1px solid ${stC}33`,whiteSpace:"nowrap"}}>{r.status}</span>
                              </td>
                            </tr>);
                          })}
                          <tr style={{background:"#040E28",borderTop:`2px solid ${C.blue}`}}>
                            <td colSpan={5} style={{padding:"6px 7px",color:C.blueL,fontWeight:700,fontSize:10}}>TOTALS</td>
                            {[sumF("budgetLabour"),sumF("budgetMaterial"),sumF("budgetEquipment"),sumF("budgetSubcontract")].map((v,j)=>(
                              <td key={j} style={{padding:"6px 7px",textAlign:"right",color:C.blueL,fontWeight:700,fontSize:9}}>${v.toLocaleString()}</td>
                            ))}
                            <td style={{padding:"6px 7px",textAlign:"right",color:C.blueL,fontWeight:700,fontSize:9}}>${(sumF("budgetIndirect")+sumF("budgetOverhead")+sumF("budgetContingency")).toLocaleString()}</td>
                            <td style={{padding:"6px 7px",textAlign:"right",color:C.accent,fontWeight:700,fontSize:10}}>${gB.toLocaleString()}</td>
                            <td style={{padding:"6px 7px",textAlign:"right",color:C.gold,fontWeight:700,fontSize:9}}>${gC.toLocaleString()}</td>
                            <td style={{padding:"6px 7px",textAlign:"right",color:C.orange,fontWeight:700,fontSize:9}}>${gA.toLocaleString()}</td>
                            <td style={{padding:"6px 7px",textAlign:"right",color:gCV<0?C.red:C.textMid,fontWeight:700,fontSize:9}}>${gF.toLocaleString()}</td>
                            <td style={{padding:"6px 7px",textAlign:"right",color:gCV<0?C.red:C.green,fontWeight:700,fontSize:9}}>{gCV<0?"-":"+"} ${Math.abs(gCV).toLocaleString()}</td>
                            <td style={{padding:"6px 7px",textAlign:"right",color:C.textMid,fontWeight:700,fontSize:9}}>${(gF-gA).toLocaleString()}</td>
                            <td colSpan={2}/>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <SectionTitle icon="🗂">Cost Code Master</SectionTitle>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}>
                        <thead><tr>{["Code","Description","Trade","Category"].map(h=><th key={h} style={{background:C.surface,padding:"5px 9px",color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,textAlign:"left"}}>{h}</th>)}</tr></thead>
                        <tbody>{costCodes.map((c,i)=>{
                          const cc2={"Direct":C.green,"Indirect":C.blueL,"Overhead":C.textDim,"Contingency":C.red,"Provisional":C.gold}[c.category]||C.textMid;
                          return(<tr key={c.code} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,color:C.gold,fontWeight:700}}>{c.code}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,color:C.text}}>{c.desc}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,color:C.textDim}}>{c.trade}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:9,fontWeight:700,color:cc2,background:`${cc2}1A`,padding:"2px 8px",borderRadius:20,border:`1px solid ${cc2}33`}}>{c.category}</span></td>
                          </tr>);
                        })}</tbody>
                      </table>
                    </div>
                  </div>);
                })()}

                {/* ── PROGRESS & INSTALLED QUANTITIES ── */}
                {tab==="quantities" && (()=>{
                  const totalEV=progressMeasurements.reduce((s,p)=>s+p.earnedValue,0);
                  const totalPVP=progressMeasurements.reduce((s,p)=>s+(p.plannedQtyToDate*p.unitRate),0);
                  const totalCV=progressMeasurements.reduce((s,p)=>s+(p.contractQty*p.unitRate),0);
                  const spi=(totalPVP>0?totalEV/totalPVP:0).toFixed(2);
                  return(<div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:14}}>
                      {[["Contract Value","$"+totalCV.toLocaleString(),C.blueL],["Earned Value","$"+totalEV.toLocaleString(),C.green],["Planned Value","$"+totalPVP.toLocaleString(),C.gold],["SPI",spi,parseFloat(spi)>=1?C.green:C.red],["Schedule Var","$"+(totalEV-totalPVP).toLocaleString(),totalEV>=totalPVP?C.green:C.red]].map(([l,v,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                          <div style={{fontSize:16,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:9,minWidth:1300}}>
                        <thead><tr>{[["BOQ Ref","65"],["Description","170"],["Unit","40"],["Contract Qty","78"],["Rate","65"],["Plan Qty","78"],["Actual Qty","78"],["Installed","75"],["% Comp","75"],["EV ($)","80"],["PV ($)","78"],["SV ($)","72"],["Activity","65"],["Cost Code","78"],["Zone","110"],["Notes","110"]].map(([h,w])=>(
                          <th key={h} style={{background:C.surface,padding:"5px 7px",color:C.textDim,letterSpacing:"1px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"right",minWidth:w}}>{h}</th>
                        ))}</tr></thead>
                        <tbody>{progressMeasurements.map((p,i)=>{
                          const pv=p.plannedQtyToDate*p.unitRate; const sv=p.earnedValue-pv;
                          const behind=p.actualQtyToDate<p.plannedQtyToDate&&p.plannedQtyToDate>0;
                          return(<tr key={p.id} className="row-hover" style={{background:behind?"#160808":i%2===0?"#080F22":C.surface}}>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontWeight:700}}>{p.boqRef}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.text,maxWidth:170,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.description}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"center",color:C.textDim}}>{p.unit}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid}}>{p.contractQty.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.gold}}>${p.unitRate}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid}}>{p.plannedQtyToDate.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:behind?C.red:C.green,fontWeight:700}}>{p.actualQtyToDate.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textMid}}>{p.installedQty.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"center"}}>
                              <div style={{position:"relative",height:13,background:C.card,borderRadius:3,overflow:"hidden",width:46,margin:"0 auto"}}>
                                <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${p.percentComplete}%`,background:p.percentComplete===100?C.green:behind?C.red:C.blue}}/>
                                <span style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:700,color:"#fff"}}>{p.percentComplete}%</span>
                              </div>
                            </td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.green,fontWeight:700}}>${p.earnedValue.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.gold}}>${pv.toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:sv>=0?C.green:C.red,fontWeight:700}}>{sv>=0?"+":"-"}${Math.abs(sv).toLocaleString()}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.blueL,fontSize:8}}>{p.activityRef}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.gold,fontSize:8}}>{p.costCode}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8,maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.zone}</td>
                            <td style={{padding:"5px 7px",borderBottom:`1px solid ${C.border}`,color:C.textDim,fontSize:8}}>{p.notes||"—"}</td>
                          </tr>);
                        })}</tbody>
                      </table>
                    </div>
                  </div>);
                })()}

                {tab==="progress" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{background:"#040E28",border:`1px solid ${C.blue}33`,color:"#7BB3F0",borderRadius:7,padding:"8px 12px",fontSize:10,marginBottom:12,display:"flex",gap:7}}>
                      <span>ℹ</span><span>Enter actual % complete for each activity. This drives accurate EV, SPI, and S-curve calculations on the PM Dashboard.</span>
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["WBS","Activity","Dur","Planned Start","Planned Finish","Planned %","Actual %","Status","Variance"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",textAlign:"left",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {(schedule.activities||[]).filter(a=>!a.isMilestone).map((a,i)=>{
                            const isCrit=a.critical===true||a.critical==="YES";
                            const actPct=actualProgress[a.id]??0;
                            const planPct=Math.min(100,Math.round(Math.max(0,((30-a.earlyStart)/Math.max(a.duration,1))*100)));
                            const variance=actPct-planPct;
                            const varClr=variance>=0?C.green:variance>=-10?C.gold:C.red;
                            return (
                              <tr key={a.id||i} className="row-hover" style={{background:isCrit?"#160808":i%2===0?"#080F22":C.surface}}>
                                <td style={{padding:"5px 9px",color:C.gold,fontSize:10,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{a.wbs}</td>
                                <td style={{padding:"5px 9px",fontSize:10,color:isCrit?"#F87171":C.text,borderBottom:`1px solid ${C.border}`,maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}{isCrit&&<span style={{marginLeft:5,fontSize:8,color:C.red}}>●CP</span>}</td>
                                <td style={{padding:"5px 9px",textAlign:"center",color:C.textMid,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{a.duration}d</td>
                                <td style={{padding:"5px 9px",textAlign:"center",color:C.textDim,fontSize:10,borderBottom:`1px solid ${C.border}`}}>d{a.earlyStart}</td>
                                <td style={{padding:"5px 9px",textAlign:"center",color:C.textDim,fontSize:10,borderBottom:`1px solid ${C.border}`}}>d{a.earlyFinish}</td>
                                <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                                    <div style={{flex:1,height:4,background:C.card,borderRadius:2,overflow:"hidden",minWidth:50}}>
                                      <div style={{width:`${planPct}%`,height:"100%",background:`${C.blue}88`,borderRadius:2}}/>
                                    </div>
                                    <span style={{fontSize:9,color:C.textDim,whiteSpace:"nowrap"}}>{planPct}%</span>
                                  </div>
                                </td>
                                <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                                    <input type="range" min={0} max={100} value={actPct}
                                      onChange={e=>setActualProgress(p=>({...p,[a.id]:+e.target.value}))}
                                      style={{width:80,accentColor:isCrit?C.red:C.green,cursor:"pointer"}}/>
                                    <span style={{fontSize:10,fontWeight:700,color:actPct>=planPct?C.green:C.gold,minWidth:28}}>{actPct}%</span>
                                  </div>
                                </td>
                                <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <span style={{display:"inline-block",padding:"2px 7px",borderRadius:20,fontSize:9,fontWeight:700,
                                    background:actPct===100?"#0A2D15":actPct>0?"#1A1500":"#080F22",
                                    color:actPct===100?C.green:actPct>0?C.gold:C.textDim}}>
                                    {actPct===100?"COMPLETE":actPct>0?"IN PROGRESS":"NOT STARTED"}
                                  </span>
                                </td>
                                <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"center"}}>
                                  <span style={{fontSize:10,fontWeight:700,color:varClr}}>{variance>0?"+":""}{variance}%</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* COMMERCIAL */}
                {tab==="commercial" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    {/* Summary KPIs */}
                    {(()=>{
                      const contractValue=parseFloat(proj.value)||schedule.projectSummary?.totalBudget||0;
                      const approvedCOs=changeOrders.filter(c=>c.status==="Approved").reduce((s,c)=>s+c.value,0);
                      const pendingCOs=changeOrders.filter(c=>c.status==="Pending").reduce((s,c)=>s+c.value,0);
                      const revisedContract=contractValue+approvedCOs;
                      const contingencyAllowance=contractValue*0.05;
                      const contingencyUsed=approvedCOs;
                      const contingencyLeft=contingencyAllowance-contingencyUsed;
                      const totalScheduleImpact=changeOrders.filter(c=>c.status==="Approved").reduce((s,c)=>s+c.scheduleImpact,0);
                      return (
                        <>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                            {[
                              ["Original Contract",`$${contractValue.toLocaleString()}`,C.blueL,"Signed contract sum"],
                              ["Approved COs",`$${approvedCOs.toLocaleString()}`,approvedCOs>0?C.gold:C.green,`${changeOrders.filter(c=>c.status==="Approved").length} orders approved`],
                              ["Revised Contract",`$${revisedContract.toLocaleString()}`,C.white,`+${((approvedCOs/Math.max(contractValue,1))*100).toFixed(1)}% variance`],
                              ["Contingency Left",`$${Math.max(0,contingencyLeft).toLocaleString()}`,contingencyLeft<0?C.red:contingencyLeft<contingencyAllowance*0.3?C.gold:C.green,`${Math.round((contingencyLeft/contingencyAllowance)*100)}% of 5% allowance`],
                            ].map(([l,v,c,sub])=>(
                              <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px"}}>
                                <div style={{fontSize:9,color:C.textDim,letterSpacing:"1px",textTransform:"uppercase",marginBottom:4}}>{l}</div>
                                <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif",marginBottom:2}}>{v}</div>
                                <div style={{fontSize:9,color:C.textMid}}>{sub}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                            <div>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                                <span style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px"}}>Contingency burn ({((contingencyUsed/contingencyAllowance)*100).toFixed(0)}% used)</span>
                                <span style={{fontSize:9,color:contingencyLeft<0?C.red:C.gold,fontWeight:700}}>${contingencyLeft.toLocaleString()} left</span>
                              </div>
                              <div style={{height:12,background:C.surface,borderRadius:6,overflow:"hidden"}}>
                                <div style={{width:`${Math.min(100,(contingencyUsed/contingencyAllowance)*100)}%`,height:"100%",background:contingencyLeft<0?C.red:C.gold,transition:"width .5s",borderRadius:6}}/>
                              </div>
                            </div>
                            <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"7px 12px",fontSize:10}}>
                              <span style={{color:C.textDim}}>Total schedule impact from COs: </span>
                              <span style={{color:totalScheduleImpact>0?C.orange:C.green,fontWeight:700}}>{totalScheduleImpact>0?`+${totalScheduleImpact} days`:"No impact"}</span>
                              <span style={{color:C.textDim}}> · Pending value: </span>
                              <span style={{color:C.gold,fontWeight:700}}>${pendingCOs.toLocaleString()}</span>
                            </div>
                          </div>
                        </>
                      );
                    })()}

                    {/* Change Orders table */}
                    <SectionTitle icon="📋">Change Order Register</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:14}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Ref","Description","Raised By","Submitted","Value (USD)","Status","Schedule Impact","Approved Date","Actions"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",textAlign:"left",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {changeOrders.map((co,i)=>{
                            const statusColors={"Approved":[C.green,"#0A2D15"],"Pending":[C.gold,"#1A1500"],"Rejected":[C.red,"#1A0505"]};
                            const [sc,sbg]=statusColors[co.status]||[C.textMid,C.surface];
                            return (
                              <tr key={co.id} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                                <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{co.ref}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:220,borderBottom:`1px solid ${C.border}`}}>{co.description}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{co.raisedBy}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{co.submittedDate}</td>
                                <td style={{padding:"6px 9px",textAlign:"right",fontWeight:700,color:C.gold,fontSize:10,borderBottom:`1px solid ${C.border}`}}>${co.value.toLocaleString()}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <select value={co.status} onChange={e=>setChangeOrders(p=>p.map(x=>x.id===co.id?{...x,status:e.target.value}:x))}
                                    style={{background:sbg,border:`1px solid ${sc}44`,color:sc,borderRadius:20,padding:"2px 7px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                    {["Approved","Pending","Rejected"].map(s=><option key={s} value={s}>{s}</option>)}
                                  </select>
                                </td>
                                <td style={{padding:"6px 9px",textAlign:"center",color:co.scheduleImpact>0?C.orange:C.green,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{co.scheduleImpact>0?`+${co.scheduleImpact}d`:"Nil"}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{co.approvedDate||"—"}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <button onClick={()=>setChangeOrders(p=>p.filter(x=>x.id!==co.id))} style={{background:"#1A0808",color:"#F87171",border:"1px solid #3D1515",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontSize:9}}>✕</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={()=>setChangeOrders(p=>[...p,{id:Date.now(),ref:`CO-${String(p.length+1).padStart(3,"0")}`,description:"",value:0,status:"Pending",scheduleImpact:0,submittedDate:new Date().toISOString().split("T")[0],approvedDate:"",raisedBy:""}])}
                      style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Add Change Order</button>
                  </div>
                )}

                {/* RFI & SUBMITTALS */}
                {tab==="rfi" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    {/* RFI Stats */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [rfis.filter(r=>r.status==="Open").length,"Open RFIs",C.blueL],
                        [rfis.filter(r=>r.status==="Overdue").length,"Overdue RFIs",C.red],
                        [submittals.filter(s=>s.status==="Revise & Resubmit").length,"Revise & Resubmit",C.orange],
                        [rfis.reduce((s,r)=>s+(r.scheduleImpact||0),0),"RFI Schedule Impact (d)",C.gold],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>

                    <SectionTitle icon="❓">RFI Log</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:16}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Ref","Subject","Discipline","Raised By","Raised","Due","Status","Priority","Schedule Impact","Answered"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {rfis.map((r,i)=>{
                            const stColors={"Open":[C.blueL,"#040E28"],"Answered":[C.green,"#061A0E"],"Overdue":[C.red,"#160808"]};
                            const [sc,sbg]=stColors[r.status]||[C.textMid,C.surface];
                            const prColors={"Critical":C.red,"High":C.orange,"Medium":C.gold,"Low":C.green};
                            return (
                              <tr key={r.id} className="row-hover" style={{background:r.status==="Overdue"?"#160808":i%2===0?"#080F22":C.surface}}>
                                <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{r.ref}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:200,borderBottom:`1px solid ${C.border}`,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.subject}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{r.discipline}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{r.raisedBy}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{r.raisedDate}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:r.status==="Overdue"?C.red:C.textDim,borderBottom:`1px solid ${C.border}`,fontWeight:r.status==="Overdue"?700:400}}>{r.dueDate}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <span style={{display:"inline-block",padding:"2px 7px",borderRadius:20,fontSize:9,fontWeight:700,background:sbg,color:sc,border:`1px solid ${sc}44`}}>{r.status}</span>
                                </td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <span style={{fontSize:10,fontWeight:700,color:prColors[r.priority]||C.textMid}}>{r.priority}</span>
                                </td>
                                <td style={{padding:"6px 9px",textAlign:"center",fontWeight:700,color:r.scheduleImpact>0?C.orange:C.green,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{r.scheduleImpact>0?`+${r.scheduleImpact}d`:"Nil"}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{r.answeredDate||"Pending"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <SectionTitle icon="📋">Submittal Log</SectionTitle>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Ref","Description","Discipline","Rev","Submitted By","Submitted","Due","Status","Return Date"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {submittals.map((s,i)=>{
                            const stC={"Approved":[C.green,"#061A0E"],"Under Review":[C.blueL,"#040E28"],"Pending":[C.textMid,C.surface],"Revise & Resubmit":[C.orange,"#160A00"]};
                            const [sc,sbg]=stC[s.status]||[C.textMid,C.surface];
                            return (
                              <tr key={s.id} className="row-hover" style={{background:s.status==="Revise & Resubmit"?"#160A00":i%2===0?"#080F22":C.surface}}>
                                <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{s.ref}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:200,borderBottom:`1px solid ${C.border}`}}>{s.description}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{s.discipline}</td>
                                <td style={{padding:"6px 9px",textAlign:"center",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{s.rev}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{s.submittedBy}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{s.submittedDate}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{s.dueDate}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <select value={s.status} onChange={e=>setSubmittals(p=>p.map(x=>x.id===s.id?{...x,status:e.target.value}:x))}
                                    style={{background:sbg,border:`1px solid ${sc}44`,color:sc,borderRadius:20,padding:"2px 6px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit",maxWidth:130}}>
                                    {["Pending","Under Review","Approved","Revise & Resubmit","Rejected"].map(st=><option key={st} value={st}>{st}</option>)}
                                  </select>
                                </td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{s.returnDate||"—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* SUBCONTRACTORS */}
                {tab==="subcontractors" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [subcontractors.reduce((s,x)=>s+x.actual,0),"Workers On Site Today",C.blueL],
                        [subcontractors.reduce((s,x)=>s+x.planned,0),"Total Planned Today",C.textMid],
                        [Math.round(subcontractors.reduce((s,x)=>s+(x.actual/Math.max(x.planned,1)),0)/subcontractors.length*100),`Avg Attendance %`,C.green],
                        [subcontractors.filter(x=>x.paymentStatus==="Delayed").length,"Payment Delayed",C.red],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>

                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:10,marginBottom:16}}>
                      {subcontractors.map((sub,i)=>{
                        const attPct=Math.round((sub.actual/Math.max(sub.planned,1))*100);
                        const attClr=attPct>=90?C.green:attPct>=75?C.gold:C.red;
                        const perfClr=sub.performanceScore>=85?C.green:sub.performanceScore>=70?C.gold:C.red;
                        const payClr=sub.paymentStatus==="Current"?C.green:C.red;
                        return (
                          <div key={sub.id} style={{background:C.card,border:`1px solid ${sub.paymentStatus==="Delayed"?C.red:C.border}`,borderRadius:10,padding:"12px 14px"}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                              <div>
                                <div style={{fontSize:11,fontWeight:700,color:C.white}}>{sub.name}</div>
                                <div style={{fontSize:9,color:C.textDim,marginTop:1}}>{sub.trade}</div>
                              </div>
                              <div style={{textAlign:"right"}}>
                                <div style={{fontSize:9,color:C.textDim}}>Contract</div>
                                <div style={{fontSize:10,color:C.gold,fontWeight:700}}>${sub.contract.toLocaleString()}</div>
                              </div>
                            </div>

                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:8}}>
                              <div style={{background:C.surface,borderRadius:6,padding:"7px 9px",textAlign:"center"}}>
                                <div style={{fontSize:18,fontWeight:700,color:attClr}}>{sub.actual}<span style={{fontSize:11,color:C.textDim}}>/{sub.planned}</span></div>
                                <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase"}}>Workers Today</div>
                                <div style={{marginTop:4,height:3,background:C.card,borderRadius:2,overflow:"hidden"}}>
                                  <div style={{width:`${attPct}%`,height:"100%",background:attClr}}/>
                                </div>
                              </div>
                              <div style={{background:C.surface,borderRadius:6,padding:"7px 9px",textAlign:"center"}}>
                                <div style={{fontSize:18,fontWeight:700,color:perfClr}}>{sub.performanceScore}</div>
                                <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase"}}>Performance</div>
                                <div style={{marginTop:4,height:3,background:C.card,borderRadius:2,overflow:"hidden"}}>
                                  <div style={{width:`${sub.performanceScore}%`,height:"100%",background:perfClr}}/>
                                </div>
                              </div>
                            </div>

                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                              <span style={{fontSize:9,color:C.textDim}}>Payment Status:</span>
                              <span style={{fontSize:9,fontWeight:700,color:payClr,background:`${payClr}1A`,padding:"1px 7px",borderRadius:20,border:`1px solid ${payClr}44`}}>{sub.paymentStatus}</span>
                            </div>
                            <div style={{fontSize:9,color:C.textDim,marginBottom:5}}>Last payment: {sub.lastPayment}</div>

                            {sub.notes&&<div style={{fontSize:9,color:C.orange,borderTop:`1px solid ${C.border}`,paddingTop:5,marginTop:4}}>⚠ {sub.notes}</div>}

                            <div style={{display:"flex",gap:5,marginTop:8}}>
                              <button onClick={()=>{const a=prompt("Actual workers today:",sub.actual);if(a!==null)setSubcontractors(p=>p.map(x=>x.id===sub.id?{...x,actual:+a}:x));}}
                                style={{flex:1,padding:"4px 0",borderRadius:5,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontFamily:"inherit"}}>Update Attendance</button>
                              <button onClick={()=>{const n=prompt("Performance score (0-100):",sub.performanceScore);if(n!==null)setSubcontractors(p=>p.map(x=>x.id===sub.id?{...x,performanceScore:+n}:x));}}
                                style={{flex:1,padding:"4px 0",borderRadius:5,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontFamily:"inherit"}}>Update Score</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* SAFETY */}
                {tab==="safety" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    {/* Safety KPIs */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [safetyStats.ltiDays,"LTI Days",safetyStats.ltiDays>0?C.red:C.green],
                        [safetyIncidents.filter(s=>s.type==="Near Miss").length,"Near Misses",C.orange],
                        [safetyIncidents.filter(s=>s.type==="First Aid").length,"First Aid",C.gold],
                        [safetyIncidents.filter(s=>s.type==="Lost Time").length,"Lost Time",safetyIncidents.filter(s=>s.type==="Lost Time").length>0?C.red:C.green],
                        [safetyStats.toolboxThisMonth,"Toolboxes This Month",C.blueL],
                        [safetyStats.inspectionScore+"%","Last Inspection",safetyStats.inspectionScore>=80?C.green:safetyStats.inspectionScore>=60?C.gold:C.red],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px",textAlign:"center"}}>
                          <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>

                    {/* Zero Harm Banner */}
                    <div style={{background:safetyStats.ltiDays===0?"#061A0E":"#160808",border:`1px solid ${safetyStats.ltiDays===0?C.green:C.red}44`,borderRadius:9,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{display:"flex",gap:12,alignItems:"center"}}>
                        <span style={{fontSize:28}}>{safetyStats.ltiDays===0?"🏆":"⚠"}</span>
                        <div>
                          <div style={{fontSize:14,fontWeight:700,color:safetyStats.ltiDays===0?C.green:C.red,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{safetyStats.ltiDays===0?"ZERO LTI — Target Maintained":"LTI RECORDED — Review Required"}</div>
                          <div style={{fontSize:10,color:C.textMid,marginTop:2}}>Last safety inspection: {safetyStats.lastInspection} · Score: {safetyStats.inspectionScore}/100</div>
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:28,fontWeight:900,color:C.green,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{safetyIncidents.reduce((mx,s,_,arr)=>{const safe=arr.filter(x=>x.daysLost===0).length;return safe;},0)}</div>
                        <div style={{fontSize:9,color:C.textDim}}>days without LTI</div>
                      </div>
                    </div>

                    <SectionTitle icon="📋">Incident & Near Miss Register</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Date","Type","Description","Severity","Injured","Trade","Action Taken","Status","Days Lost"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {safetyIncidents.map((inc,i)=>{
                            const sevColors={"High":C.red,"Critical":C.red,"Medium":C.orange,"Low":C.green};
                            const typeColors={"Lost Time":C.red,"First Aid":C.orange,"Near Miss":C.gold,"Property Damage":C.purple};
                            return (
                              <tr key={inc.id} className="row-hover" style={{background:inc.severity==="High"||inc.severity==="Critical"?"#160808":i%2===0?"#080F22":C.surface}}>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textMid,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{inc.date}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <span style={{fontSize:9,fontWeight:700,color:typeColors[inc.type]||C.textMid}}>{inc.type}</span>
                                </td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:200,borderBottom:`1px solid ${C.border}`}}>{inc.description}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <span style={{fontSize:9,fontWeight:700,color:sevColors[inc.severity]||C.textMid}}>{inc.severity}</span>
                                </td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{inc.injured}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{inc.trade}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textMid,maxWidth:200,borderBottom:`1px solid ${C.border}`}}>{inc.actionTaken}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <span style={{display:"inline-block",padding:"2px 7px",borderRadius:20,fontSize:9,fontWeight:700,background:inc.status==="Closed"?"#0A2D15":"#1A1500",color:inc.status==="Closed"?C.green:C.gold,border:"none"}}>{inc.status}</span>
                                </td>
                                <td style={{padding:"6px 9px",textAlign:"center",color:inc.daysLost>0?C.red:C.green,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{inc.daysLost}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={()=>setSafetyIncidents(p=>[...p,{id:Date.now(),date:new Date().toISOString().split("T")[0],type:"Near Miss",description:"",severity:"Medium",injured:"None",trade:"",actionTaken:"",status:"Open",daysLost:0}])}
                      style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Log Incident / Near Miss</button>
                  </div>
                )}

                {/* WEATHER */}
                {tab==="weather" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    {(()=>{
                      const totalLostDays=weatherLog.reduce((s,w)=>s+(w.lostHours>=8?1:w.lostHours/8),0);
                      const contractAllowance=10;
                      const remaining=contractAllowance-totalLostDays;
                      return (
                        <>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                            {[
                              [weatherLog.length,"Weather Events",C.blueL],
                              [weatherLog.reduce((s,w)=>s+w.lostHours,0)+"h","Total Hours Lost",C.orange],
                              [totalLostDays.toFixed(1),"Working Days Lost",C.red],
                              [remaining.toFixed(1),"Contract Days Remaining",remaining<=2?C.red:remaining<=5?C.gold:C.green],
                            ].map(([v,l,c])=>(
                              <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                                <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                                <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                              </div>
                            ))}
                          </div>

                          <div style={{marginBottom:14}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                              <span style={{fontSize:10,color:C.textMid}}>Contract weather allowance used ({((totalLostDays/contractAllowance)*100).toFixed(0)}%)</span>
                              <span style={{fontSize:10,color:remaining<=2?C.red:C.gold,fontWeight:700}}>{remaining.toFixed(1)} days remaining of {contractAllowance}</span>
                            </div>
                            <div style={{height:10,background:C.surface,borderRadius:5,overflow:"hidden"}}>
                              <div style={{width:`${Math.min(100,(totalLostDays/contractAllowance)*100)}%`,height:"100%",background:remaining<=2?C.red:remaining<=5?C.gold:C.blue,transition:"width .5s",borderRadius:5}}/>
                            </div>
                          </div>
                        </>
                      );
                    })()}

                    <SectionTitle icon="🌦">Weather Delay Log</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Date","Condition","Hours Lost","Activities Affected","Contract Claim","Notes","Actions"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {weatherLog.map((w,i)=>(
                            <tr key={w.id} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                              <td style={{padding:"6px 9px",fontSize:10,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{w.date}</td>
                              <td style={{padding:"6px 9px",fontSize:10,color:C.blueL,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>{w.condition}</td>
                              <td style={{padding:"6px 9px",textAlign:"center",color:w.lostHours>=8?C.red:C.orange,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{w.lostHours}h</td>
                              <td style={{padding:"6px 9px",fontSize:10,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{w.activitiesAffected}</td>
                              <td style={{padding:"6px 9px",textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
                                <span style={{fontSize:9,fontWeight:700,color:w.contractAllowance==="Y"?C.green:C.red}}>{w.contractAllowance==="Y"?"✓ Yes":"✗ No"}</span>
                              </td>
                              <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{w.notes}</td>
                              <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                <button onClick={()=>setWeatherLog(p=>p.filter(x=>x.id!==w.id))} style={{background:"#1A0808",color:"#F87171",border:"1px solid #3D1515",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontSize:9}}>✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={()=>setWeatherLog(p=>[...p,{id:Date.now(),date:new Date().toISOString().split("T")[0],condition:"",lostHours:0,activitiesAffected:"",contractAllowance:"Y",notes:""}])}
                      style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Log Weather Event</button>
                  </div>
                )}

                {/* DECISIONS & ACTIONS */}
                {tab==="decisions" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [decisions.filter(d=>d.status==="Pending").length,"Decisions Pending",C.red],
                        [decisions.filter(d=>d.status==="Decided").length,"Decisions Made",C.green],
                        [actionItems.filter(a=>a.status==="Overdue").length,"Actions Overdue",C.red],
                        [actionItems.filter(a=>a.status==="Open").length,"Actions Open",C.gold],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>

                    <SectionTitle icon="🗂">Decision Log</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:16}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Ref","Decision Required","From","Raised","Due","Status","Priority","Impact","Decided"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {decisions.map((d,i)=>{
                            const sc=d.status==="Decided"?C.green:d.status==="Pending"?C.gold:C.textMid;
                            const pc={"High":C.red,"Critical":C.red,"Medium":C.gold,"Low":C.green};
                            return (
                              <tr key={d.id} className="row-hover" style={{background:d.status==="Pending"&&d.priority==="High"?"#160808":i%2===0?"#080F22":C.surface}}>
                                <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{d.ref}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:180,borderBottom:`1px solid ${C.border}`}}>{d.description}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{d.requiredFrom}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{d.raisedDate}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:d.status==="Pending"?C.orange:C.textDim,borderBottom:`1px solid ${C.border}`,fontWeight:d.status==="Pending"?600:400}}>{d.dueDate}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <select value={d.status} onChange={e=>setDecisions(p=>p.map(x=>x.id===d.id?{...x,status:e.target.value}:x))}
                                    style={{background:"transparent",border:`1px solid ${sc}44`,color:sc,borderRadius:20,padding:"2px 7px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                    {["Pending","Decided","Escalated"].map(s=><option key={s} value={s}>{s}</option>)}
                                  </select>
                                </td>
                                <td style={{padding:"6px 9px",fontSize:10,fontWeight:700,color:pc[d.priority]||C.textMid,borderBottom:`1px solid ${C.border}`}}>{d.priority}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.orange,maxWidth:160,borderBottom:`1px solid ${C.border}`}}>{d.impact}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{d.decidedDate||"—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={()=>setDecisions(p=>[...p,{id:Date.now(),ref:`DEC-${String(p.length+1).padStart(3,"0")}`,description:"",requiredFrom:"",raisedDate:new Date().toISOString().split("T")[0],dueDate:"",decidedDate:"",status:"Pending",priority:"High",impact:""}])}
                      style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit",marginBottom:16}}>+ Add Decision</button>

                    <SectionTitle icon="✅">Meeting Action Items</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Ref","Action","Owner","Meeting","Due Date","Priority","Status"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {actionItems.map((a,i)=>{
                            const sc=a.status==="Closed"?C.green:a.status==="Overdue"?C.red:a.status==="In Progress"?C.blueL:C.gold;
                            const pc={"Critical":C.red,"High":C.orange,"Medium":C.gold,"Low":C.green};
                            return (
                              <tr key={a.id} className="row-hover" style={{background:a.status==="Overdue"?"#160808":i%2===0?"#080F22":C.surface}}>
                                <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{a.ref}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:220,borderBottom:`1px solid ${C.border}`}}>{a.description}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{a.owner}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,maxWidth:160,borderBottom:`1px solid ${C.border}`}}>{a.meeting}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:a.status==="Overdue"?C.red:C.textDim,fontWeight:a.status==="Overdue"?700:400,borderBottom:`1px solid ${C.border}`}}>{a.dueDate}</td>
                                <td style={{padding:"6px 9px",fontSize:10,fontWeight:700,color:pc[a.priority]||C.textMid,borderBottom:`1px solid ${C.border}`}}>{a.priority}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <select value={a.status} onChange={e=>setActionItems(p=>p.map(x=>x.id===a.id?{...x,status:e.target.value}:x))}
                                    style={{background:"transparent",border:`1px solid ${sc}44`,color:sc,borderRadius:20,padding:"2px 7px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                    {["Open","In Progress","Overdue","Closed"].map(s=><option key={s} value={s}>{s}</option>)}
                                  </select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={()=>setActionItems(p=>[...p,{id:Date.now(),ref:`ACT-${String(p.length+1).padStart(3,"0")}`,description:"",owner:"",dueDate:"",status:"Open",priority:"High",meeting:""}])}
                      style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Add Action Item</button>
                  </div>
                )}

                {/* ── CASH FLOW ── */}
                {tab==="cashflow" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    {(()=>{
                      const totalPaid=paymentCerts.filter(p=>p.status==="Paid").reduce((s,p)=>s+p.certifiedAmount,0);
                      const totalCertified=paymentCerts.reduce((s,p)=>s+p.certifiedAmount,0);
                      const totalRetention=paymentCerts.reduce((s,p)=>s+(p.retention||0),0);
                      const contractVal=parseFloat(proj.value)||schedule?.projectSummary?.totalBudget||5000000;
                      const maxMonthly=Math.max(...cashFlow.map(c=>c.planned),1);
                      const BAR_MAX=160;
                      return(<>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                          {[
                            [`$${totalPaid.toLocaleString()}`,"Total Paid",C.green],
                            [`$${totalCertified.toLocaleString()}`,"Total Certified",C.blueL],
                            [`$${totalRetention.toLocaleString()}`,"Retention Held",C.gold],
                            [paymentCerts.filter(p=>p.status==="Under Assessment").length,"IPCs Under Assessment",C.orange],
                          ].map(([v,l,c])=>(
                            <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                              <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                              <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                            </div>
                          ))}
                        </div>

                        <SectionTitle icon="📊">Monthly Cash Flow — Planned vs Actual</SectionTitle>
                        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"14px 16px",marginBottom:14}}>
                          <div style={{display:"flex",gap:4,alignItems:"flex-end",height:BAR_MAX+40,overflowX:"auto"}}>
                            {cashFlow.map((m,i)=>{
                              const ph=Math.round((m.planned/maxMonthly)*BAR_MAX);
                              const ah=m.actual>0?Math.round((m.actual/maxMonthly)*BAR_MAX):0;
                              return (
                                <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",minWidth:72,gap:3}}>
                                  <div style={{display:"flex",gap:3,alignItems:"flex-end",height:BAR_MAX}}>
                                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                                      <span style={{fontSize:7,color:C.blueL,fontWeight:700}}>${(m.planned/1000).toFixed(0)}k</span>
                                      <div style={{width:24,height:ph,background:`${C.blue}88`,borderRadius:"3px 3px 0 0"}}/>
                                    </div>
                                    {m.actual>0 && (
                                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                                        <span style={{fontSize:7,color:C.green,fontWeight:700}}>${(m.actual/1000).toFixed(0)}k</span>
                                        <div style={{width:24,height:ah,background:m.actual>=m.planned?C.green:C.orange,borderRadius:"3px 3px 0 0"}}/>
                                      </div>
                                    )}
                                  </div>
                                  <span style={{fontSize:8,color:C.textDim,textAlign:"center"}}>{m.month.split(" ")[0]}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div style={{display:"flex",gap:14,marginTop:8,fontSize:9,color:C.textDim}}>
                            <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:12,height:8,background:`${C.blue}88`,display:"inline-block",borderRadius:2}}/>Planned</span>
                            <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:12,height:8,background:C.green,display:"inline-block",borderRadius:2}}/>Actual</span>
                          </div>
                        </div>

                        <SectionTitle icon="📋">Payment Certificate Log</SectionTitle>
                        <div style={{overflowX:"auto",marginBottom:12}}>
                          <table style={{width:"100%",borderCollapse:"collapse"}}>
                            <thead><tr>
                              {["Ref","Period","Submitted","Claim (USD)","Certified (USD)","Retention","Status","Certified Date","Paid Date"].map(h=>(
                                <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {paymentCerts.map((p,i)=>{
                                const sc={"Paid":C.green,"Under Assessment":C.gold,"Rejected":C.red}[p.status]||C.textMid;
                                return (
                                  <tr key={p.id} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                                    <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{p.ref}</td>
                                    <td style={{padding:"6px 9px",fontSize:10,color:C.text,borderBottom:`1px solid ${C.border}`}}>{p.period}</td>
                                    <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{p.submitted}</td>
                                    <td style={{padding:"6px 9px",textAlign:"right",fontWeight:700,color:C.gold,fontSize:10,borderBottom:`1px solid ${C.border}`}}>${p.claimAmount.toLocaleString()}</td>
                                    <td style={{padding:"6px 9px",textAlign:"right",fontWeight:700,color:C.green,fontSize:10,borderBottom:`1px solid ${C.border}`}}>${p.certifiedAmount.toLocaleString()}</td>
                                    <td style={{padding:"6px 9px",textAlign:"right",color:C.orange,fontSize:10,borderBottom:`1px solid ${C.border}`}}>${(p.retention||0).toLocaleString()}</td>
                                    <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                      <span style={{display:"inline-block",padding:"2px 7px",borderRadius:20,fontSize:9,fontWeight:700,background:`${sc}1A`,color:sc,border:`1px solid ${sc}44`}}>{p.status}</span>
                                    </td>
                                    <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{p.certified||"—"}</td>
                                    <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{p.paid||"—"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <button onClick={()=>setPaymentCerts(p=>[...p,{id:Date.now(),ref:`IPC-${String(p.length+1).padStart(3,"0")}`,period:"",submitted:new Date().toISOString().split("T")[0],certified:"",paid:"",claimAmount:0,certifiedAmount:0,status:"Under Assessment",retention:0}])}
                          style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Add Payment Certificate</button>
                      </>);
                    })()}
                  </div>
                )}

                {/* ── DRAWINGS ── */}
                {tab==="drawings" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [drawings.filter(d=>d.status==="Issued for Construction").length,"IFC Drawings",C.green],
                        [drawings.filter(d=>d.status==="For Comment"||d.status==="For Approval").length,"Pending Approval",C.gold],
                        [drawings.filter(d=>!d.siteConfirmed).length,"Not Confirmed on Site",C.red],
                        [drawings.length,"Total Drawings",C.blueL],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:7,marginBottom:14}}>
                      {["Structural","Architecture","Mechanical","Electrical","Façade"].map(disc=>{
                        const d=drawings.filter(x=>x.discipline===disc);
                        const ifc=d.filter(x=>x.status==="Issued for Construction").length;
                        return (
                          <div key={disc} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 12px"}}>
                            <div style={{fontSize:10,fontWeight:700,color:C.blueL,marginBottom:4}}>{disc}</div>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                              <span style={{fontSize:9,color:C.textDim}}>{d.length} drawings</span>
                              <span style={{fontSize:9,color:C.green}}>{ifc} IFC</span>
                            </div>
                            <div style={{height:4,background:C.card,borderRadius:2,overflow:"hidden"}}>
                              <div style={{width:`${d.length?Math.round((ifc/d.length)*100):0}%`,height:"100%",background:C.green}}/>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <SectionTitle icon="📐">Drawing Register</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Drawing No.","Title","Discipline","Rev","Issued","Status","Format","On Site","Notes","Actions"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {drawings.map((d,i)=>{
                            const stC={"Issued for Construction":[C.green,"#061A0E"],"For Comment":[C.gold,"#1A1500"],"For Approval":[C.blueL,"#040E28"],"Superseded":[C.textDim,C.surface]};
                            const [sc,sbg]=stC[d.status]||[C.textMid,C.surface];
                            return (
                              <tr key={d.id} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                                <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{d.drawingNo}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:200,borderBottom:`1px solid ${C.border}`}}>{d.title}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{d.discipline}</td>
                                <td style={{padding:"6px 9px",textAlign:"center",fontWeight:700,color:C.gold,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{d.rev}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{d.issued}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <select value={d.status} onChange={e=>setDrawings(p=>p.map(x=>x.id===d.id?{...x,status:e.target.value}:x))}
                                    style={{background:sbg,border:`1px solid ${sc}44`,color:sc,borderRadius:20,padding:"2px 6px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                    {["Issued for Construction","For Comment","For Approval","Superseded"].map(s=><option key={s}>{s}</option>)}
                                  </select>
                                </td>
                                <td style={{padding:"6px 9px",textAlign:"center",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{d.format}</td>
                                <td style={{padding:"6px 9px",textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
                                  <button onClick={()=>setDrawings(p=>p.map(x=>x.id===d.id?{...x,siteConfirmed:!x.siteConfirmed}:x))}
                                    style={{background:d.siteConfirmed?"#0A2D15":"#1A0808",border:`1px solid ${d.siteConfirmed?C.green:C.red}44`,color:d.siteConfirmed?C.green:C.red,borderRadius:20,padding:"2px 8px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                    {d.siteConfirmed?"✓ Yes":"✗ No"}
                                  </button>
                                </td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,maxWidth:160,borderBottom:`1px solid ${C.border}`}}>{d.notes||"—"}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <button onClick={()=>setDrawings(p=>p.filter(x=>x.id!==d.id))} style={{background:"#1A0808",color:"#F87171",border:"1px solid #3D1515",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontSize:9}}>✕</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={()=>setDrawings(p=>[...p,{id:Date.now(),drawingNo:"",title:"",discipline:"",rev:"A",issued:new Date().toISOString().split("T")[0],status:"For Approval",format:"A1",siteConfirmed:false,notes:""}])}
                      style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Add Drawing</button>
                  </div>
                )}

                {/* ── DEFECTS & SNAGGING ── */}
                {tab==="defects" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [defects.filter(d=>d.status==="Open").length,"Open Defects",defects.filter(d=>d.status==="Open").length>0?C.red:C.green],
                        [defects.filter(d=>d.priority==="High"&&d.status==="Open").length,"High Priority Open",C.red],
                        [defects.filter(d=>d.status==="Closed").length,"Closed",C.green],
                        [Math.round((defects.filter(d=>d.status==="Closed").length/Math.max(defects.length,1))*100)+"%","Close-Out Rate",C.blueL],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>

                    {/* Defects by subcontractor */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                      <div>
                        <SectionTitle icon="🏗">Defects by Subcontractor</SectionTitle>
                        {[...new Set(defects.map(d=>d.responsible))].map(sub=>{
                          const cnt=defects.filter(d=>d.responsible===sub).length;
                          const open=defects.filter(d=>d.responsible===sub&&d.status==="Open").length;
                          return (
                            <div key={sub} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 10px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,marginBottom:5}}>
                              <span style={{fontSize:10,color:C.text}}>{sub}</span>
                              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                                <span style={{fontSize:9,color:C.textDim}}>{cnt} total</span>
                                {open>0&&<span style={{fontSize:9,fontWeight:700,color:C.red,background:"#1A0808",padding:"1px 7px",borderRadius:20,border:"1px solid #5D151533"}}>{open} open</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div>
                        <SectionTitle icon="📊">Defects by Discipline</SectionTitle>
                        {[...new Set(defects.map(d=>d.discipline))].map(disc=>{
                          const cnt=defects.filter(d=>d.discipline===disc).length;
                          const pct=Math.round((cnt/defects.length)*100);
                          return (
                            <div key={disc} style={{marginBottom:8}}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                                <span style={{fontSize:9,color:C.textMid}}>{disc}</span>
                                <span style={{fontSize:9,color:C.textDim}}>{cnt} ({pct}%)</span>
                              </div>
                              <div style={{height:5,background:C.surface,borderRadius:3,overflow:"hidden"}}>
                                <div style={{width:`${pct}%`,height:"100%",background:C.blue,borderRadius:3}}/>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <SectionTitle icon="📋">Defect & Snagging Register</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Ref","Description","Location","Discipline","Priority","Raised","Due","Responsible","Status","Cost","Actions"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {defects.map((d,i)=>{
                            const pc={"High":C.red,"Medium":C.gold,"Low":C.green,"Critical":C.red}[d.priority]||C.textMid;
                            return (
                              <tr key={d.id} className="row-hover" style={{background:d.priority==="High"&&d.status==="Open"?"#160808":i%2===0?"#080F22":C.surface}}>
                                <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{d.ref}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:180,borderBottom:`1px solid ${C.border}`}}>{d.description}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{d.location}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{d.discipline}</td>
                                <td style={{padding:"6px 9px",fontSize:10,fontWeight:700,color:pc,borderBottom:`1px solid ${C.border}`}}>{d.priority}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{d.raisedDate}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:d.status==="Open"?C.orange:C.textDim,borderBottom:`1px solid ${C.border}`}}>{d.dueDate}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textMid,maxWidth:140,borderBottom:`1px solid ${C.border}`}}>{d.responsible}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <select value={d.status} onChange={e=>setDefects(p=>p.map(x=>x.id===d.id?{...x,status:e.target.value,closedDate:e.target.value==="Closed"?new Date().toISOString().split("T")[0]:x.closedDate}:x))}
                                    style={{background:d.status==="Closed"?"#0A2D15":"#1A0808",border:`1px solid ${d.status==="Closed"?C.green:C.red}44`,color:d.status==="Closed"?C.green:C.red,borderRadius:20,padding:"2px 6px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                    {["Open","In Progress","Closed"].map(s=><option key={s}>{s}</option>)}
                                  </select>
                                </td>
                                <td style={{padding:"6px 9px",textAlign:"right",color:d.cost>0?C.orange:C.textDim,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{d.cost>0?`$${d.cost.toLocaleString()}`:"—"}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <button onClick={()=>setDefects(p=>p.filter(x=>x.id!==d.id))} style={{background:"#1A0808",color:"#F87171",border:"1px solid #3D1515",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontSize:9}}>✕</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={()=>setDefects(p=>[...p,{id:Date.now(),ref:`DEF-${String(p.length+1).padStart(3,"0")}`,description:"",location:"",discipline:"",raisedBy:"PM",raisedDate:new Date().toISOString().split("T")[0],dueDate:"",closedDate:"",status:"Open",priority:"Medium",responsible:"",cost:0,photo:false}])}
                      style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Log Defect / Snag</button>
                  </div>
                )}

                {/* ── SITE DIARY ── */}
                {tab==="diary" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    {/* New entry form */}
                    <div style={{background:C.card,border:`1px solid ${C.blue}33`,borderRadius:11,padding:"14px 16px",marginBottom:16}}>
                      <SectionTitle icon="✏">New Diary Entry</SectionTitle>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:9,marginBottom:9}}>
                        {[["date","Date","date"],["weather","Weather / Temp","text"],["totalWorkers","Total Workers on Site","number"],["visitors","Visitors","text"]].map(([k,lbl,t])=>(
                          <div key={k}>
                            <label style={{display:"block",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:3}}>{lbl}</label>
                            <input type={t} value={newDiary[k]} onChange={e=>setNewDiary(p=>({...p,[k]:e.target.value}))}
                              style={{width:"100%",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:6,padding:"6px 8px",color:C.text,fontSize:10,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                          </div>
                        ))}
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:9}}>
                        {[["workDone","Work Completed Today"],["issues","Issues / Problems"],["instructions","PM Instructions Given"],["plant","Plant & Equipment on Site"],["materials","Materials Delivered"],["notes","Additional Notes"]].map(([k,lbl])=>(
                          <div key={k}>
                            <label style={{display:"block",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:3}}>{lbl}</label>
                            <textarea value={newDiary[k]} onChange={e=>setNewDiary(p=>({...p,[k]:e.target.value}))} rows={2}
                              style={{width:"100%",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:6,padding:"6px 8px",color:C.text,fontSize:10,fontFamily:"inherit",outline:"none",resize:"vertical",boxSizing:"border-box"}}/>
                          </div>
                        ))}
                      </div>
                      <button onClick={()=>{
                        if(!newDiary.date) return;
                        setDiaryEntries(p=>[{...newDiary,id:Date.now()},...p]);
                        setNewDiary({date:new Date().toISOString().split("T")[0],weather:"",totalWorkers:0,visitors:"",workDone:"",issues:"",instructions:"",plant:"",materials:"",notes:""});
                      }} style={{padding:"7px 20px",borderRadius:7,border:"none",background:`linear-gradient(135deg,${C.blue},${C.accent})`,color:"#000D1F",cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit"}}>
                        💾 Save Diary Entry
                      </button>
                    </div>

                    {/* Past entries */}
                    <SectionTitle icon="📔">Site Diary Log</SectionTitle>
                    {diaryEntries.map((e,i)=>(
                      <div key={e.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"13px 16px",marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:9}}>
                          <div style={{display:"flex",gap:9,alignItems:"center",flexWrap:"wrap"}}>
                            <span style={{fontSize:12,fontWeight:700,color:C.white,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{e.date}</span>
                            <TagBlue>{e.weather||"—"}</TagBlue>
                            <Tag style={{background:`${C.blueL}1A`,color:C.blueL,border:`1px solid ${C.blueL}44`}}>👷 {e.totalWorkers} workers</Tag>
                            {e.visitors&&<Tag style={{background:`${C.purple}1A`,color:C.purple,border:`1px solid ${C.purple}44`}}>🧑‍💼 {e.visitors}</Tag>}
                          </div>
                          <button onClick={()=>setDiaryEntries(p=>p.filter(x=>x.id!==e.id))} style={{background:"transparent",border:"none",color:C.textDim,cursor:"pointer",fontSize:12}}>✕</button>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                          {[["✅ Work Completed",e.workDone],["⚠ Issues",e.issues],["📋 Instructions",e.instructions],["🔧 Plant",e.plant],["📦 Materials Delivered",e.materials],["📝 Notes",e.notes]].filter(([,v])=>v).map(([l,v])=>(
                            <div key={l} style={{background:C.surface,borderRadius:7,padding:"8px 10px"}}>
                              <div style={{fontSize:9,color:C.blueL,fontWeight:700,marginBottom:3,textTransform:"uppercase",letterSpacing:"1px"}}>{l}</div>
                              <div style={{fontSize:10,color:C.textMid,lineHeight:1.6}}>{v}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── WHAT-IF SCENARIO PLANNER ── */}
                {tab==="whatif" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{background:"#0A1E3A",border:`1px solid ${C.blue}44`,borderRadius:10,padding:"12px 16px",marginBottom:14,fontSize:10,color:C.textMid,lineHeight:1.7}}>
                      <strong style={{color:C.blueL}}>What-If Scenario Planner</strong> — Model the impact of delays, resource changes, or scope additions on your project completion date. Select any activity, apply a delay, and instantly see the projected new finish.
                    </div>

                    {/* Interactive analyzer */}
                    {(()=>{
                      const [selAct, setSelAct] = useState("");
                      const [delayDays, setDelayDays] = useState(7);
                      const [scenName, setScenName] = useState("");
                      const acts=schedule?.activities||[];
                      const selActObj=acts.find(a=>a.id===selAct);
                      const isCrit=selActObj?.critical===true||selActObj?.critical==="YES";
                      const totalDaysBase=Math.max(...acts.map(a=>a.earlyFinish||0),10);
                      const newFinish=isCrit?totalDaysBase+delayDays:Math.max(totalDaysBase,(selActObj?.earlyFinish||0)+delayDays-(selActObj?.totalFloat||0));
                      const impact=newFinish-totalDaysBase;
                      return (
                        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"16px",marginBottom:16}}>
                          <SectionTitle icon="🔮">Interactive Delay Analyzer</SectionTitle>
                          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 2fr 1fr",gap:10,marginBottom:12,alignItems:"end"}}>
                            <div>
                              <label style={{display:"block",fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1.5px",marginBottom:4}}>Select Activity</label>
                              <select value={selAct} onChange={e=>setSelAct(e.target.value)}
                                style={{width:"100%",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:6,padding:"7px 9px",color:C.text,fontSize:10,fontFamily:"inherit",outline:"none"}}>
                                <option value="">— Choose activity —</option>
                                {acts.filter(a=>!a.isMilestone).map(a=><option key={a.id} value={a.id}>{a.id}: {a.name}</option>)}
                              </select>
                            </div>
                            <div>
                              <label style={{display:"block",fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1.5px",marginBottom:4}}>Delay (days)</label>
                              <input type="number" min={1} max={180} value={delayDays} onChange={e=>setDelayDays(+e.target.value)}
                                style={{width:"100%",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:6,padding:"7px 9px",color:C.text,fontSize:10,fontFamily:"inherit",outline:"none"}}/>
                            </div>
                            <div>
                              <label style={{display:"block",fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1.5px",marginBottom:4}}>Scenario Name</label>
                              <input value={scenName} onChange={e=>setScenName(e.target.value)} placeholder="e.g. Curtain wall late delivery"
                                style={{width:"100%",background:C.surface,border:`1px solid ${C.border2}`,borderRadius:6,padding:"7px 9px",color:C.text,fontSize:10,fontFamily:"inherit",outline:"none"}}/>
                            </div>
                            <button onClick={()=>{
                              if(!selAct) return;
                              setScenarios(p=>[...p,{id:Date.now(),name:scenName||`Scenario ${p.length+1}`,activityId:selAct,delayDays,description:selActObj?.name||"",impactOnCritical:isCrit,projectedNewFinish:`Day ${newFinish}`,mitigationOptions:"",createdDate:new Date().toISOString().split("T")[0]}]);
                              setScenName(""); setSelAct(""); setDelayDays(7);
                            }} style={{padding:"8px 14px",borderRadius:7,border:"none",background:`linear-gradient(135deg,${C.blue},${C.accent})`,color:"#000D1F",cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit",marginTop:18}}>
                              + Save Scenario
                            </button>
                          </div>

                          {selAct && selActObj && (
                            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9}}>
                              <div style={{background:C.surface,borderRadius:8,padding:"10px",textAlign:"center",border:`1px solid ${isCrit?C.red:C.border}`}}>
                                <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",marginBottom:3}}>Activity Float</div>
                                <div style={{fontSize:20,fontWeight:700,color:isCrit?C.red:C.green}}>{selActObj.totalFloat??0}d</div>
                                <div style={{fontSize:8,color:isCrit?C.red:C.textDim}}>{isCrit?"ON CRITICAL PATH":"available buffer"}</div>
                              </div>
                              <div style={{background:C.surface,borderRadius:8,padding:"10px",textAlign:"center",border:`1px solid ${impact>0?C.red:C.green}`}}>
                                <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",marginBottom:3}}>Project Impact</div>
                                <div style={{fontSize:20,fontWeight:700,color:impact>0?C.red:C.green}}>{impact>0?`+${impact}d`:"No Impact"}</div>
                                <div style={{fontSize:8,color:impact>0?C.red:C.textDim}}>{impact>0?"to completion date":"float absorbs delay"}</div>
                              </div>
                              <div style={{background:C.surface,borderRadius:8,padding:"10px",textAlign:"center"}}>
                                <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",marginBottom:3}}>New Finish</div>
                                <div style={{fontSize:20,fontWeight:700,color:impact>0?C.red:C.blueL}}>Day {newFinish}</div>
                                <div style={{fontSize:8,color:C.textDim}}>vs baseline Day {totalDaysBase}</div>
                              </div>
                              <div style={{background:C.surface,borderRadius:8,padding:"10px",textAlign:"center"}}>
                                <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",marginBottom:3}}>Cost Exposure</div>
                                <div style={{fontSize:20,fontWeight:700,color:impact>0?C.orange:C.green}}>{impact>0?`$${(impact*8500).toLocaleString()}`:"Nil"}</div>
                                <div style={{fontSize:8,color:C.textDim}}>{impact>0?"est. prelims @ $8.5k/day":""}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Saved Scenarios */}
                    <SectionTitle icon="📋">Saved Scenarios</SectionTitle>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:10}}>
                      {scenarios.map((s,i)=>(
                        <div key={s.id} style={{background:s.impactOnCritical?"#160808":"#080F22",border:`1px solid ${s.impactOnCritical?C.red:C.border}`,borderRadius:10,padding:"12px 14px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                            <span style={{fontSize:11,fontWeight:700,color:s.impactOnCritical?C.red:C.text}}>{s.name}</span>
                            <div style={{display:"flex",gap:5}}>
                              {s.impactOnCritical?<TagCrit>CP IMPACT</TagCrit>:<TagFree>NO CP IMPACT</TagFree>}
                              <button onClick={()=>setScenarios(p=>p.filter(x=>x.id!==s.id))} style={{background:"transparent",border:"none",color:C.textDim,cursor:"pointer",fontSize:11}}>✕</button>
                            </div>
                          </div>
                          <div style={{fontSize:9,color:C.textDim,marginBottom:6}}>Activity: {s.description||s.activityId||"—"} · Delay: +{s.delayDays}d</div>
                          <div style={{display:"flex",gap:8,marginBottom:6}}>
                            <div style={{flex:1,background:C.surface,borderRadius:6,padding:"6px",textAlign:"center"}}>
                              <div style={{fontSize:14,fontWeight:700,color:s.impactOnCritical?C.red:C.green}}>{s.projectedNewFinish||"—"}</div>
                              <div style={{fontSize:8,color:C.textDim}}>Projected Finish</div>
                            </div>
                            <div style={{flex:1,background:C.surface,borderRadius:6,padding:"6px",textAlign:"center"}}>
                              <div style={{fontSize:14,fontWeight:700,color:C.orange}}>{s.createdDate}</div>
                              <div style={{fontSize:8,color:C.textDim}}>Created</div>
                            </div>
                          </div>
                          {s.mitigationOptions&&<div style={{fontSize:9,color:C.green,borderTop:`1px solid ${C.border}`,paddingTop:5}}>💡 {s.mitigationOptions}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── PROJECT DIRECTORY ── */}
                {tab==="directory" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10,marginBottom:14}}>
                      {contacts.map((c,i)=>{
                        const catColors={"Client-Facing":C.gold,"Design Team":C.blueL,"Client":C.purple,"Site Team":C.green,"Subcontractor":C.orange};
                        const clr=catColors[c.category]||C.textMid;
                        return (
                          <div key={c.id} style={{background:C.card,border:`1px solid ${clr}22`,borderRadius:10,padding:"12px 14px"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                              <div style={{width:36,height:36,borderRadius:"50%",background:`${clr}22`,border:`2px solid ${clr}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,color:clr,fontWeight:700}}>
                                {c.name.split(" ").map(n=>n[0]).join("").slice(0,2)}
                              </div>
                              <Tag style={{background:`${clr}1A`,color:clr,border:`1px solid ${clr}44`}}>{c.category}</Tag>
                            </div>
                            <div style={{fontSize:12,fontWeight:700,color:C.white,marginBottom:1}}>{c.name}</div>
                            <div style={{fontSize:10,color:clr,marginBottom:1}}>{c.role}</div>
                            <div style={{fontSize:9,color:C.textDim,marginBottom:7}}>{c.company} · {c.discipline}</div>
                            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                              <a href={`tel:${c.phone}`} style={{fontSize:9,color:C.blueL,textDecoration:"none",background:`${C.blue}12`,padding:"2px 8px",borderRadius:20,border:`1px solid ${C.blue}33`}}>📞 {c.phone}</a>
                              <a href={`mailto:${c.email}`} style={{fontSize:9,color:C.accent,textDecoration:"none",background:`${C.accent}12`,padding:"2px 8px",borderRadius:20,border:`1px solid ${C.accent}33`}}>✉ {c.email}</a>
                            </div>
                          </div>
                        );
                      })}
                      {/* Add contact card */}
                      <button onClick={()=>{const n=prompt("Name:");if(n)setContacts(p=>[...p,{id:Date.now(),name:n,role:"",company:"",phone:"",email:"",discipline:"",category:"Site Team"}]);}}
                        style={{background:C.surface,border:`2px dashed ${C.border2}`,borderRadius:10,padding:"20px",cursor:"pointer",color:C.textDim,fontSize:10,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                        + Add Contact
                      </button>
                    </div>
                  </div>
                )}

                {/* ── PERMITS ── */}
                {tab==="permits" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [permits.filter(p=>p.status==="Active").length,"Active Permits",C.green],
                        [permits.filter(p=>p.status==="Pending").length,"Pending Approval",C.gold],
                        [permits.filter(p=>p.status==="Expired").length,"Expired",C.red],
                        [permits.filter(p=>p.expiry&&new Date(p.expiry)<new Date(Date.now()+30*24*3600*1000)&&p.status==="Active").length,"Expiring < 30 Days",C.orange],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:10,marginBottom:14}}>
                      {permits.map((p,i)=>{
                        const sc={"Active":C.green,"Pending":C.gold,"Expired":C.red}[p.status]||C.textMid;
                        const expiringSoon=p.expiry&&new Date(p.expiry)<new Date(Date.now()+30*24*3600*1000)&&p.status==="Active";
                        return (
                          <div key={p.id} style={{background:expiringSoon?"#160A00":C.card,border:`1px solid ${expiringSoon?C.orange:sc}33`,borderRadius:10,padding:"12px 14px"}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                              <div>
                                <div style={{fontSize:9,color:C.blueL,fontWeight:700,marginBottom:1}}>{p.ref}</div>
                                <div style={{fontSize:11,fontWeight:700,color:C.white}}>{p.description}</div>
                              </div>
                              <span style={{display:"inline-block",padding:"2px 7px",borderRadius:20,fontSize:9,fontWeight:700,background:`${sc}1A`,color:sc,border:`1px solid ${sc}44`,height:"fit-content"}}>{p.status}</span>
                            </div>
                            <div style={{fontSize:9,color:C.textDim,marginBottom:3}}>Authority: <span style={{color:C.textMid}}>{p.authority}</span></div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,fontSize:9,marginBottom:5}}>
                              <div><span style={{color:C.textDim}}>Applied: </span><span style={{color:C.textMid}}>{p.applied}</span></div>
                              <div><span style={{color:C.textDim}}>Approved: </span><span style={{color:C.textMid}}>{p.approved||"Pending"}</span></div>
                              <div><span style={{color:C.textDim}}>Expiry: </span><span style={{color:expiringSoon?C.orange:C.textMid}}>{p.expiry||"—"}</span></div>
                            </div>
                            {expiringSoon&&<div style={{fontSize:9,color:C.orange,fontWeight:700}}>⚠ Expiring soon — arrange renewal</div>}
                            {p.notes&&<div style={{fontSize:9,color:C.textDim,marginTop:3}}>📝 {p.notes}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── REPORTS ── */}
                {tab==="reports" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{background:"#040E28",border:`1px solid ${C.blue}33`,color:"#7BB3F0",borderRadius:7,padding:"8px 12px",fontSize:10,marginBottom:14,display:"flex",gap:7}}>
                      <span>ℹ</span><span>Auto-generated reports from live project data. Click any report to generate and open a print-ready version.</span>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
                      {[
                        {icon:"📋",title:"Weekly Progress Report",desc:"Schedule status, EV metrics, activities completed, upcoming 2-week lookahead, open RFIs, procurement alerts, risks.",color:C.blueL,key:"weekly"},
                        {icon:"📊",title:"Monthly Executive Report",desc:"S-curve, EV trend, milestone status, commercial summary, key decisions, safety statistics, forecast completion.",color:C.green,key:"monthly"},
                        {icon:"🔭",title:"2-Week Lookahead",desc:"Activities starting in next 14 days, resource requirements, material confirmations, constraints and blockers.",color:C.gold,key:"lookahead"},
                        {icon:"💰",title:"Commercial Status Report",desc:"Change order register, payment certificate summary, contingency status, forecast final cost.",color:C.orange,key:"commercial"},
                        {icon:"🦺",title:"Safety & Quality Report",desc:"Incident register, near miss log, inspection scores, defect register summary, toolbox talks.",color:C.red,key:"safety"},
                        {icon:"📐",title:"Design & Procurement Status",desc:"Drawing register status, RFI log, submittal tracker, long-lead item countdown.",color:C.purple,key:"design"},
                      ].map(r=>(
                        <div key={r.key} style={{background:C.card,border:`1px solid ${r.color}22`,borderRadius:11,padding:"16px"}}>
                          <div style={{fontSize:28,marginBottom:8}}>{r.icon}</div>
                          <div style={{fontSize:13,fontWeight:700,color:r.color,fontFamily:"'Sora','Segoe UI',sans-serif",marginBottom:5}}>{r.title}</div>
                          <div style={{fontSize:10,color:C.textMid,lineHeight:1.6,marginBottom:12}}>{r.desc}</div>
                          <button onClick={()=>{
                            const w=window.open("","_blank");
                            if(!w){alert("Allow popups to generate reports.");return;}
                            const sched=schedule||{};
                            const acts=(sched.activities||[]);
                            const critCount=acts.filter(a=>a.critical===true||a.critical==="YES").length;
                            const openRFIs=rfis.filter(x=>x.status==="Open"||x.status==="Overdue").length;
                            const openDefects=defects.filter(x=>x.status==="Open").length;
                            const procUrgent=procAlerts_=(sched.longLeadItems||[]).filter(ll=>(ll.leadWeeks*5-30)<=10);
                            w.document.write(`<!DOCTYPE html><html><head><title>PMcopilots — ${r.title}</title>
                            <style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:24px;max-width:900px}
                            h1{font-size:20px;color:#1e3a8a;margin-bottom:4px}h2{font-size:13px;color:#1e3a8a;margin:18px 0 8px;border-bottom:2px solid #1e3a8a;padding-bottom:4px}
                            .meta{color:#555;font-size:9px;margin-bottom:18px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
                            .kpi{background:#f0f4ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px;text-align:center}
                            .kpi-val{font-size:22px;font-weight:700;color:#1e40af}.kpi-lbl{font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:1px}
                            table{width:100%;border-collapse:collapse;font-size:9px;margin-bottom:14px}
                            th{background:#1e3a8a;color:#fff;padding:5px 7px;text-align:left}td{padding:4px 7px;border-bottom:1px solid #e5e7eb}
                            .crit{color:#dc2626;font-weight:700}.ok{color:#16a34a;font-weight:700}.warn{color:#d97706;font-weight:700}
                            @media print{body{margin:10px}}</style></head><body>
                            <h1>${r.icon} ${r.title}</h1>
                            <div class="meta">Project: <strong>${proj.name}</strong> &nbsp;|&nbsp; ${proj.location} &nbsp;|&nbsp; Contract: $${(parseFloat(proj.value)||0).toLocaleString()} &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString()}</div>
                            <div class="grid">
                              <div class="kpi"><div class="kpi-val">${sched.projectSummary?.totalActivities||acts.length}</div><div class="kpi-lbl">Total Activities</div></div>
                              <div class="kpi"><div class="kpi-val" style="color:#dc2626">${critCount}</div><div class="kpi-lbl">Critical Path</div></div>
                              <div class="kpi"><div class="kpi-val" style="color:#d97706">${openRFIs}</div><div class="kpi-lbl">Open RFIs</div></div>
                              <div class="kpi"><div class="kpi-val" style="color:#dc2626">${openDefects}</div><div class="kpi-lbl">Open Defects</div></div>
                            </div>
                            <h2>SCHEDULE STATUS</h2>
                            <table><thead><tr><th>Activity</th><th>WBS</th><th>Start</th><th>Finish</th><th>Float</th><th>Status</th></tr></thead><tbody>
                            ${acts.slice(0,20).map(a=>`<tr><td>${a.name}</td><td>${a.wbs}</td><td>d${a.earlyStart}</td><td>d${a.earlyFinish}</td><td class="${(a.totalFloat||0)===0?"crit":(a.totalFloat||0)<=5?"warn":"ok"}">${a.totalFloat??0}d</td><td>${a.critical?"CRITICAL":"—"}</td></tr>`).join("")}
                            </tbody></table>
                            <h2>OPEN RFIs</h2>
                            <table><thead><tr><th>Ref</th><th>Subject</th><th>Due</th><th>Status</th><th>Schedule Impact</th></tr></thead><tbody>
                            ${rfis.map(r=>`<tr><td>${r.ref}</td><td>${r.subject}</td><td>${r.dueDate}</td><td class="${r.status==="Overdue"?"crit":"warn"}">${r.status}</td><td>${r.scheduleImpact>0?`+${r.scheduleImpact}d`:"Nil"}</td></tr>`).join("")}
                            </tbody></table>
                            <h2>OPEN DEFECTS</h2>
                            <table><thead><tr><th>Ref</th><th>Description</th><th>Priority</th><th>Responsible</th><th>Due</th></tr></thead><tbody>
                            ${defects.filter(d=>d.status==="Open").map(d=>`<tr><td>${d.ref}</td><td>${d.description}</td><td class="${d.priority==="High"?"crit":"warn"}">${d.priority}</td><td>${d.responsible}</td><td>${d.dueDate}</td></tr>`).join("")}
                            </tbody></table>
                            <h2>CHANGE ORDERS</h2>
                            <table><thead><tr><th>Ref</th><th>Description</th><th>Value</th><th>Status</th><th>Schedule Impact</th></tr></thead><tbody>
                            ${changeOrders.map(co=>`<tr><td>${co.ref}</td><td>${co.description}</td><td>$${co.value.toLocaleString()}</td><td>${co.status}</td><td>${co.scheduleImpact>0?`+${co.scheduleImpact}d`:"Nil"}</td></tr>`).join("")}
                            </tbody></table>
                            <p style="font-size:9px;color:#94a3b8;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:8px">Generated by PMcopilots AI Construction Management Platform · ${new Date().toISOString()}</p>
                            <script>window.onload=()=>window.print()</script></body></html>`);
                            w.document.close();
                          }} style={{width:"100%",padding:"8px 0",borderRadius:7,border:"none",background:`linear-gradient(135deg,${r.color}CC,${r.color})`,color:"#000D1F",cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"'Sora','Segoe UI',sans-serif"}}>
                            Generate & Print →
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ══ SCHEDULE COMPRESSION ══ */}
                {tab==="compression" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{background:"#040E28",border:`1px solid ${C.blue}33`,color:"#7BB3F0",borderRadius:7,padding:"8px 12px",fontSize:10,marginBottom:12,display:"flex",gap:7}}>
                      <span>⚡</span><span>Model acceleration strategies to recover schedule float or earn time back from delays. Each scenario shows time saved, cost premium, and implementation risk.</span>
                    </div>
                    {/* Summary */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [compressionScenarios.filter(s=>s.status==="Approved").length,"Approved Strategies",C.green],
                        [compressionScenarios.filter(s=>s.status==="Under Review").length,"Under Review",C.gold],
                        [compressionScenarios.filter(s=>s.status==="Approved").reduce((a,s)=>a+s.timeSaved,0)+"d","Time Recoverable",C.blueL],
                        [`$${compressionScenarios.filter(s=>s.status==="Approved").reduce((a,s)=>a+s.additionalCost,0).toLocaleString()}`,"Approved Premium Cost",C.orange],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                          <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>

                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:12,marginBottom:14}}>
                      {compressionScenarios.map((s,i)=>{
                        const stClr={"Approved":C.green,"Rejected":C.red,"Under Review":C.gold}[s.status]||C.textMid;
                        const feasClr={"High":C.green,"Medium":C.gold,"Low":C.red}[s.feasibility]||C.textMid;
                        return (
                          <div key={s.id} style={{background:C.card,border:`1px solid ${stClr}22`,borderRadius:11,padding:"14px 16px"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:7}}>
                              <div style={{fontSize:12,fontWeight:700,color:C.white,flex:1,paddingRight:8}}>{s.name}</div>
                              <select value={s.status} onChange={e=>setCompressionScenarios(p=>p.map(x=>x.id===s.id?{...x,status:e.target.value}:x))}
                                style={{background:`${stClr}1A`,border:`1px solid ${stClr}44`,color:stClr,borderRadius:20,padding:"2px 8px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
                                {["Under Review","Approved","Rejected"].map(st=><option key={st}>{st}</option>)}
                              </select>
                            </div>
                            <div style={{fontSize:10,color:C.textMid,marginBottom:10,lineHeight:1.5}}>{s.description}</div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:10}}>
                              {[["⏱ Time Saved",s.timeSaved+"d",C.green],["💰 Extra Cost",`$${s.additionalCost.toLocaleString()}`,C.orange],["✅ Feasibility",s.feasibility,feasClr]].map(([l,v,c])=>(
                                <div key={l} style={{background:C.surface,borderRadius:7,padding:"7px",textAlign:"center"}}>
                                  <div style={{fontSize:8,color:C.textDim,marginBottom:2}}>{l}</div>
                                  <div style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{background:C.surface,borderRadius:6,padding:"7px 9px",fontSize:9}}>
                              <span style={{color:C.orange,fontWeight:700}}>⚠ Risks: </span>
                              <span style={{color:C.textMid}}>{s.risks}</span>
                            </div>
                          </div>
                        );
                      })}
                      <button onClick={()=>setCompressionScenarios(p=>[...p,{id:Date.now(),name:"New Strategy",description:"",timeSaved:0,additionalCost:0,feasibility:"Medium",risks:"",status:"Under Review"}])}
                        style={{background:C.surface,border:`2px dashed ${C.border2}`,borderRadius:11,padding:"24px",cursor:"pointer",color:C.textDim,fontSize:10,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6,minHeight:160}}>
                        + Add Compression Scenario
                      </button>
                    </div>
                  </div>
                )}

                {/* ══ COST BY PHASE ══ */}
                {tab==="costphase" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    {(()=>{
                      const totalBudget=phaseFinancials.reduce((s,p)=>s+p.budgeted,0);
                      const totalForecast=phaseFinancials.reduce((s,p)=>s+p.forecast,0);
                      const totalSpent=phaseFinancials.reduce((s,p)=>s+p.spent,0);
                      const totalCommitted=phaseFinancials.reduce((s,p)=>s+p.committed,0);
                      const overallVariance=totalForecast-totalBudget;
                      return (<>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                          {[
                            [`$${totalBudget.toLocaleString()}`,"Total Budget",C.blueL],
                            [`$${totalSpent.toLocaleString()}`,"Spent to Date",C.gold],
                            [`$${totalForecast.toLocaleString()}`,"Forecast Final Cost",overallVariance>0?C.red:C.green],
                            [overallVariance>0?`+$${overallVariance.toLocaleString()}`:`-$${Math.abs(overallVariance).toLocaleString()}`,"Budget Variance",overallVariance>0?C.red:C.green],
                          ].map(([v,l,c])=>(
                            <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                              <div style={{fontSize:18,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                              <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                            </div>
                          ))}
                        </div>

                        {phaseFinancials.map((p,i)=>{
                          const spentPct=Math.round((p.spent/Math.max(p.budgeted,1))*100);
                          const commitPct=Math.round((p.committed/Math.max(p.budgeted,1))*100);
                          const forecastVariance=p.forecast-p.budgeted;
                          const varClr=forecastVariance>0?C.red:forecastVariance<0?C.green:C.textDim;
                          const stClr={"Complete":C.green,"In Progress":C.blueL,"Not Started":C.textDim}[p.status]||C.textDim;
                          return (
                            <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 16px",marginBottom:9}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                                  <span style={{fontSize:12,fontWeight:700,color:C.white}}>{p.phase}</span>
                                  <span style={{fontSize:9,fontWeight:700,color:stClr,background:`${stClr}1A`,padding:"2px 8px",borderRadius:20,border:`1px solid ${stClr}33`}}>{p.status}</span>
                                </div>
                                <div style={{display:"flex",gap:12,fontSize:10}}>
                                  <span><span style={{color:C.textDim}}>Budget: </span><span style={{color:C.blueL,fontWeight:700}}>${p.budgeted.toLocaleString()}</span></span>
                                  <span><span style={{color:C.textDim}}>Forecast: </span><span style={{color:varClr,fontWeight:700}}>${p.forecast.toLocaleString()}</span></span>
                                  <span style={{color:varClr,fontWeight:700}}>{forecastVariance>0?`▲ +$${forecastVariance.toLocaleString()}`:forecastVariance<0?`▼ -$${Math.abs(forecastVariance).toLocaleString()}`:"On Budget"}</span>
                                </div>
                              </div>
                              {/* Stacked spend bar */}
                              <div style={{height:8,background:C.surface,borderRadius:4,overflow:"hidden",marginBottom:4,position:"relative"}}>
                                <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${Math.min(100,commitPct)}%`,background:`${C.blue}55`,borderRadius:4}}/>
                                <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${Math.min(100,spentPct)}%`,background:p.status==="Complete"?C.green:C.blue,borderRadius:4}}/>
                              </div>
                              <div style={{display:"flex",gap:14,fontSize:9,color:C.textDim}}>
                                <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:8,height:8,background:C.blue,borderRadius:2,display:"inline-block"}}/>Spent: ${p.spent.toLocaleString()} ({spentPct}%)</span>
                                <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:8,height:8,background:`${C.blue}55`,borderRadius:2,display:"inline-block"}}/>Committed: ${p.committed.toLocaleString()} ({commitPct}%)</span>
                                <span>Cost-to-Complete: <strong style={{color:C.gold}}>${(p.forecast-p.spent).toLocaleString()}</strong></span>
                              </div>
                            </div>
                          );
                        })}
                      </>);
                    })()}
                  </div>
                )}

                {/* ══ TRANSMITTALS ══ */}
                {tab==="transmittals" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [transmittals.length,"Total Transmittals",C.blueL],
                        [transmittals.filter(t=>t.received).length,"Confirmed Received",C.green],
                        [transmittals.filter(t=>!t.received).length,"Awaiting Receipt Confirmation",C.orange],
                        [[...new Set(transmittals.map(t=>t.from))].length,"Parties",C.textMid],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Ref","Subject","From","To","Date","Documents","Purpose","Received","Received Date","Notes"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {transmittals.map((t,i)=>(
                            <tr key={t.id} className="row-hover" style={{background:!t.received?"#160A00":i%2===0?"#080F22":C.surface}}>
                              <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{t.ref}</td>
                              <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:200,borderBottom:`1px solid ${C.border}`,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.subject}</td>
                              <td style={{padding:"6px 9px",fontSize:9,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{t.from}</td>
                              <td style={{padding:"6px 9px",fontSize:9,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{t.to}</td>
                              <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{t.date}</td>
                              <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,maxWidth:150,borderBottom:`1px solid ${C.border}`,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.documents}</td>
                              <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                <span style={{fontSize:9,color:C.blueL,background:`${C.blue}1A`,padding:"2px 7px",borderRadius:20,border:`1px solid ${C.blue}33`}}>{t.purpose}</span>
                              </td>
                              <td style={{padding:"6px 9px",textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
                                <button onClick={()=>setTransmittals(p=>p.map(x=>x.id===t.id?{...x,received:!x.received,receivedDate:!x.received?new Date().toISOString().split("T")[0]:""}:x))}
                                  style={{background:t.received?"#0A2D15":"#1A0808",border:`1px solid ${t.received?C.green:C.red}44`,color:t.received?C.green:C.red,borderRadius:20,padding:"2px 8px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                  {t.received?"✓ Yes":"✗ No"}
                                </button>
                              </td>
                              <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{t.receivedDate||"—"}</td>
                              <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,maxWidth:150,borderBottom:`1px solid ${C.border}`}}>{t.notes||"—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={()=>setTransmittals(p=>[...p,{id:Date.now(),ref:`TR-${String(p.length+1).padStart(3,"0")}`,subject:"",from:"",to:"",date:new Date().toISOString().split("T")[0],documents:"",purpose:"For Information",received:false,receivedDate:"",notes:""}])}
                      style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Add Transmittal</button>
                  </div>
                )}

                {/* ══ CORRESPONDENCE ══ */}
                {tab==="correspondence" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                      {[
                        [correspondence.filter(c=>c.direction==="Sent").length,"Sent",C.blueL],
                        [correspondence.filter(c=>c.direction==="Received").length,"Received",C.textMid],
                        [correspondence.filter(c=>c.status==="Action Required").length,"Action Required",C.red],
                        [[...new Set(correspondence.map(c=>c.category))].length,"Categories",C.gold],
                      ].map(([v,l,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{overflowX:"auto",marginBottom:12}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr>
                          {["Ref","Type","Subject","From","To","Date","Direction","Category","Status","Linked Ref","Notes"].map(h=>(
                            <th key={h} style={{background:C.surface,padding:"6px 9px",fontSize:9,color:C.textDim,letterSpacing:"1.5px",textTransform:"uppercase",borderBottom:`1px solid ${C.border2}`,whiteSpace:"nowrap",textAlign:"left"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {correspondence.map((c,i)=>{
                            const stClr={"Action Required":C.red,"Acknowledged":C.green,"Pending Response":C.gold,"Closed":C.textDim}[c.status]||C.textMid;
                            const dirClr=c.direction==="Sent"?C.blueL:C.orange;
                            return (
                              <tr key={c.id} className="row-hover" style={{background:c.status==="Action Required"?"#160808":i%2===0?"#080F22":C.surface}}>
                                <td style={{padding:"6px 9px",color:C.blueL,fontWeight:700,fontSize:10,borderBottom:`1px solid ${C.border}`}}>{c.ref}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textMid,borderBottom:`1px solid ${C.border}`}}>{c.type}</td>
                                <td style={{padding:"6px 9px",fontSize:10,color:C.text,maxWidth:200,borderBottom:`1px solid ${C.border}`,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.subject}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textMid,maxWidth:130,borderBottom:`1px solid ${C.border}`,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.from}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textMid,maxWidth:130,borderBottom:`1px solid ${C.border}`,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.to}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{c.date}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <span style={{fontSize:9,fontWeight:700,color:dirClr,background:`${dirClr}1A`,padding:"2px 7px",borderRadius:20,border:`1px solid ${dirClr}33`}}>{c.direction==="Sent"?"↑ Sent":"↓ Received"}</span>
                                </td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,borderBottom:`1px solid ${C.border}`}}>{c.category}</td>
                                <td style={{padding:"6px 9px",borderBottom:`1px solid ${C.border}`}}>
                                  <select value={c.status} onChange={e=>setCorrespondence(p=>p.map(x=>x.id===c.id?{...x,status:e.target.value}:x))}
                                    style={{background:"transparent",border:`1px solid ${stClr}44`,color:stClr,borderRadius:20,padding:"2px 6px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                    {["Action Required","Acknowledged","Pending Response","Closed"].map(s=><option key={s}>{s}</option>)}
                                  </select>
                                </td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.blueL,borderBottom:`1px solid ${C.border}`}}>{c.linkedRef||"—"}</td>
                                <td style={{padding:"6px 9px",fontSize:9,color:C.textDim,maxWidth:150,borderBottom:`1px solid ${C.border}`}}>{c.notes}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={()=>setCorrespondence(p=>[...p,{id:Date.now(),ref:`LTR-${String(p.length+1).padStart(3,"0")}`,type:"Letter",subject:"",from:"Main Contractor",to:"",date:new Date().toISOString().split("T")[0],direction:"Sent",category:"General",status:"Acknowledged",linkedRef:"",notes:""}])}
                      style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Log Correspondence</button>
                  </div>
                )}

                {/* ══ COMMISSIONING ══ */}
                {tab==="commissioning" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    {(()=>{
                      const commStages=["preComm","staticComm","dynamicComm","clientWitness"];
                      const stageLabels={"preComm":"Pre-Commission","staticComm":"Static Comm.","dynamicComm":"Dynamic Comm.","clientWitness":"Client Witness"};
                      const stageColors={"Passed":C.green,"In Progress":C.blueL,"Pending":C.gold,"Not Started":C.textDim,"Failed":C.red};
                      const totalComplete=commSystems.filter(s=>s.status==="Near Complete"||s.status==="Complete").length;
                      const totalSystems=commSystems.length;
                      return (<>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:14}}>
                          {[
                            [totalComplete,"Systems Near Complete / Done",C.green],
                            [commSystems.filter(s=>s.status==="In Progress").length,"In Progress",C.blueL],
                            [commSystems.filter(s=>s.status==="Not Started").length,"Not Started",C.textDim],
                            [Math.round((commSystems.reduce((s,sys)=>{const passed=commStages.filter(st=>sys[st]==="Passed").length;return s+passed;},0)/(totalSystems*commStages.length))*100)+"%","Overall Commissioning Progress",C.gold],
                          ].map(([v,l,c])=>(
                            <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",textAlign:"center"}}>
                              <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                              <div style={{fontSize:9,color:C.textDim,textTransform:"uppercase",letterSpacing:"1px",marginTop:2}}>{l}</div>
                            </div>
                          ))}
                        </div>

                        {commSystems.map((sys,i)=>{
                          const phasePct=Math.round((commStages.filter(st=>sys[st]==="Passed").length/commStages.length)*100);
                          const docsComplete=[sys.omatReceived,sys.asBuiltReceived,sys.warrantyReceived,sys.trainingDone].filter(Boolean).length;
                          const stClr={"Complete":C.green,"Near Complete":C.blueL,"In Progress":C.gold,"Not Started":C.textDim}[sys.status]||C.textDim;
                          return (
                            <div key={sys.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",marginBottom:9}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                                <div>
                                  <div style={{fontSize:11,fontWeight:700,color:C.white}}>{sys.system}</div>
                                  <div style={{fontSize:9,color:C.textDim,marginTop:1}}>{sys.discipline} · {sys.contractor} · Target: {sys.targetDate}</div>
                                </div>
                                <div style={{display:"flex",gap:7,alignItems:"center"}}>
                                  <span style={{fontSize:11,fontWeight:700,color:C.gold}}>{phasePct}%</span>
                                  <select value={sys.status} onChange={e=>setCommSystems(p=>p.map(x=>x.id===sys.id?{...x,status:e.target.value}:x))}
                                    style={{background:`${stClr}1A`,border:`1px solid ${stClr}44`,color:stClr,borderRadius:20,padding:"2px 7px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                    {["Not Started","In Progress","Near Complete","Complete"].map(s=><option key={s}>{s}</option>)}
                                  </select>
                                </div>
                              </div>

                              {/* Commissioning stages */}
                              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:8}}>
                                {commStages.map(stage=>{
                                  const val=sys[stage];
                                  const stc=stageColors[val]||C.textDim;
                                  return (
                                    <div key={stage} style={{background:C.surface,borderRadius:6,padding:"6px",textAlign:"center",border:`1px solid ${stc}33`}}>
                                      <div style={{fontSize:8,color:C.textDim,marginBottom:2}}>{stageLabels[stage]}</div>
                                      <select value={val} onChange={e=>setCommSystems(p=>p.map(x=>x.id===sys.id?{...x,[stage]:e.target.value}:x))}
                                        style={{background:"transparent",border:"none",color:stc,fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit",width:"100%",textAlign:"center"}}>
                                        {["Not Started","Pending","In Progress","Passed","Failed"].map(s=><option key={s}>{s}</option>)}
                                      </select>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Documentation checkboxes */}
                              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                                {[["omatReceived","O&M Manual"],["asBuiltReceived","As-Built Drawings"],["warrantyReceived","Warranty Cert"],["trainingDone","Training Done"]].map(([field,label])=>(
                                  <label key={field} style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:9,color:sys[field]?C.green:C.textDim}}>
                                    <input type="checkbox" checked={sys[field]} onChange={e=>setCommSystems(p=>p.map(x=>x.id===sys.id?{...x,[field]:e.target.checked}:x))}
                                      style={{accentColor:C.green,cursor:"pointer"}}/>
                                    {label}
                                  </label>
                                ))}
                                <span style={{fontSize:9,color:C.textDim,marginLeft:"auto"}}>{docsComplete}/4 docs complete</span>
                              </div>
                              {sys.notes&&<div style={{marginTop:6,fontSize:9,color:C.orange}}>⚠ {sys.notes}</div>}
                            </div>
                          );
                        })}
                      </>);
                    })()}
                  </div>
                )}

                {/* ══ HANDOVER CHECKLIST ══ */}
                {tab==="handover" && (
                  <div style={{animation:"fadeUp .3s ease"}}>
                    {(()=>{
                      const total=handoverItems.length;
                      const done=handoverItems.filter(h=>h.status==="Completed").length;
                      const pct=Math.round((done/Math.max(total,1))*100);
                      const categories=[...new Set(handoverItems.map(h=>h.category))];
                      return (<>
                        {/* Handover readiness banner */}
                        <div style={{background:pct>=80?"#061A0E":pct>=50?"#160A00":"#160808",border:`1px solid ${pct>=80?C.green:pct>=50?C.gold:C.red}44`,borderRadius:11,padding:"14px 18px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div>
                            <div style={{fontSize:16,fontWeight:700,color:pct>=80?C.green:pct>=50?C.gold:C.red,fontFamily:"'Sora','Segoe UI',sans-serif",marginBottom:3}}>
                              {pct>=90?"🏆 Ready for Handover":pct>=70?"⚡ Nearly Ready — Close Out Outstanding Items":"⚠ Not Ready for Handover"}
                            </div>
                            <div style={{fontSize:10,color:C.textMid}}>{done} of {total} checklist items complete · {total-done} remaining</div>
                            <div style={{marginTop:7,height:8,background:C.surface,borderRadius:4,overflow:"hidden",width:300}}>
                              <div style={{width:`${pct}%`,height:"100%",background:pct>=80?C.green:pct>=50?C.gold:C.red,borderRadius:4,transition:"width .5s"}}/>
                            </div>
                          </div>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:40,fontWeight:900,color:pct>=80?C.green:pct>=50?C.gold:C.red,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{pct}%</div>
                            <div style={{fontSize:9,color:C.textDim}}>Handover Readiness</div>
                          </div>
                        </div>

                        {/* Category sections */}
                        {categories.map(cat=>{
                          const items=handoverItems.filter(h=>h.category===cat);
                          const catDone=items.filter(h=>h.status==="Completed").length;
                          return (
                            <div key={cat} style={{marginBottom:14}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                                <SectionTitle icon={cat==="Documentation"?"📄":cat==="Regulatory"?"🏛":cat==="Physical"?"🔧":"🎓"}>{cat}</SectionTitle>
                                <span style={{fontSize:9,color:catDone===items.length?C.green:C.textDim}}>{catDone}/{items.length} complete</span>
                              </div>
                              {items.map((item,i)=>{
                                const stClr={"Completed":C.green,"In Progress":C.blueL,"Pending":C.gold,"Not Started":C.textDim}[item.status]||C.textDim;
                                return (
                                  <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:item.status==="Completed"?"#061A0E":i%2===0?"#080F22":C.surface,borderRadius:7,marginBottom:4,border:`1px solid ${item.status==="Completed"?`${C.green}22`:C.border}`}}>
                                    <input type="checkbox" checked={item.status==="Completed"} onChange={e=>setHandoverItems(p=>p.map(x=>x.id===item.id?{...x,status:e.target.checked?"Completed":"Pending"}:x))}
                                      style={{accentColor:C.green,cursor:"pointer",width:14,height:14,flexShrink:0}}/>
                                    <span style={{flex:1,fontSize:10,color:item.status==="Completed"?`${C.text}88`:C.text,textDecoration:item.status==="Completed"?"line-through":"none"}}>{item.item}</span>
                                    <span style={{fontSize:9,color:C.textDim,whiteSpace:"nowrap"}}>{item.responsible}</span>
                                    <span style={{fontSize:9,color:C.textDim,whiteSpace:"nowrap"}}>{item.dueDate}</span>
                                    <select value={item.status} onChange={e=>setHandoverItems(p=>p.map(x=>x.id===item.id?{...x,status:e.target.value}:x))}
                                      style={{background:"transparent",border:`1px solid ${stClr}44`,color:stClr,borderRadius:20,padding:"2px 6px",fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                      {["Not Started","Pending","In Progress","Completed"].map(s=><option key={s}>{s}</option>)}
                                    </select>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                        <button onClick={()=>setHandoverItems(p=>[...p,{id:Date.now(),category:"Documentation",item:"",responsible:"PM",dueDate:"",status:"Not Started",notes:""}])}
                          style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${C.border2}`,background:C.surface,color:C.textMid,cursor:"pointer",fontSize:9,fontWeight:700,fontFamily:"inherit"}}>+ Add Checklist Item</button>
                      </>);
                    })()}
                  </div>
                )}


                {/* ── INTEGRATED COST REPORTS ── */}
                {tab==="costreports" && (()=>{
                  const cc=activityCosts;
                  const gB=cc.reduce((s,r)=>s+r.budgetLabour+r.budgetMaterial+r.budgetEquipment+r.budgetSubcontract+r.budgetIndirect+r.budgetOverhead+r.budgetContingency,0);
                  const gA=cc.reduce((s,r)=>s+r.actualLabour+r.actualMaterial+r.actualEquipment+r.actualSubcontract,0);
                  const gF=cc.reduce((s,r)=>s+r.forecastLabour+r.forecastMaterial+r.forecastEquipment+r.forecastSubcontract+r.budgetIndirect+r.budgetOverhead+r.budgetContingency,0);
                  const totalEV=progressMeasurements.reduce((s,p)=>s+p.earnedValue,0);
                  const totalPVP=progressMeasurements.reduce((s,p)=>s+(p.plannedQtyToDate*p.unitRate),0);
                  const spi=(totalPVP>0?totalEV/totalPVP:0).toFixed(2);
                  const cpi=(gA>0?totalEV/gA:0).toFixed(2);
                  const totalIssued=materialIssues.reduce((s,m)=>s+(materialMaster.find(x=>x.code===m.materialCode)?.unitCost||0)*m.quantityIssued,0);
                  const totalWV=wastageLog.reduce((s,w)=>s+(w.value||0),0);
                  const certTotals=clientInvoiceItems.reduce((a,r)=>{const cv=r.currCertQty*r.unitRate;const cumV=(r.prevCertQty+r.currCertQty)*r.unitRate;return{cv:a.cv+cv,cumV:a.cumV+cumV,ret:a.ret+(cumV*retentionRate)};},{cv:0,cumV:0,ret:0});
                  return(<div style={{animation:"fadeUp .3s ease"}}>
                    <div style={{background:`linear-gradient(135deg,#04142E,#071A40)`,border:`1px solid ${C.blue}44`,borderRadius:12,padding:"14px 18px",marginBottom:14}}>
                      <div style={{fontSize:15,fontWeight:700,color:C.white,fontFamily:"'Sora','Segoe UI',sans-serif"}}>📊 Integrated Cost & Progress Report — {currentIPCPeriod}</div>
                      <div style={{fontSize:9,color:C.textDim,marginTop:2}}>Project: {proj.name||"5-Story Commercial Office Building"} · Export below for P6, Power BI, or ERP systems</div>
                    </div>

                    <SectionTitle icon="📅">A. Schedule & Earned Value</SectionTitle>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:14}}>
                      {[["PV","$"+totalPVP.toLocaleString(),C.textMid],["EV","$"+totalEV.toLocaleString(),C.green],["AC","$"+gA.toLocaleString(),C.orange],["SV","$"+(totalEV-totalPVP).toLocaleString(),totalEV>=totalPVP?C.green:C.red],["SPI",spi,parseFloat(spi)>=1?C.green:C.red],["CPI",cpi,parseFloat(cpi)>=1?C.green:C.red]].map(([l,v,c])=>(
                        <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 12px",textAlign:"center"}}>
                          <div style={{fontSize:15,fontWeight:700,color:c,fontFamily:"'Sora','Segoe UI',sans-serif"}}>{v}</div>
                          <div style={{fontSize:8,color:C.textDim,textTransform:"uppercase",marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>

                    <SectionTitle icon="🧮">B. Cost Control Summary by Trade</SectionTitle>
                    <div style={{overflowX:"auto",marginBottom:14}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}>
                        <thead><tr>{["Trade","Budget","Actual","Forecast EAC","Cost Variance","CV%","ETC"].map(h=><th key={h} style={{background:C.surface,padding:"5px 9px",color:C.textDim,textTransform:"uppercase",letterSpacing:"1.5px",borderBottom:`1px solid ${C.border2}`,textAlign:"right",textAlignLast:"left"}}>{h}</th>)}</tr></thead>
                        <tbody>{[...new Set(cc.map(r=>r.trade))].map((trade,i)=>{
                          const rs=cc.filter(r=>r.trade===trade);
                          const b=rs.reduce((s,r)=>s+r.budgetLabour+r.budgetMaterial+r.budgetEquipment+r.budgetSubcontract+r.budgetIndirect+r.budgetOverhead+r.budgetContingency,0);
                          const a=rs.reduce((s,r)=>s+r.actualLabour+r.actualMaterial+r.actualEquipment+r.actualSubcontract,0);
                          const f=rs.reduce((s,r)=>s+r.forecastLabour+r.forecastMaterial+r.forecastEquipment+r.forecastSubcontract+r.budgetIndirect+r.budgetOverhead+r.budgetContingency,0);
                          const cv=b-f; const cvP=b>0?((cv/b)*100).toFixed(1):"0";
                          return(<tr key={trade} className="row-hover" style={{background:i%2===0?"#080F22":C.surface}}>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,color:C.text,fontWeight:600}}>{trade}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.blueL}}>${b.toLocaleString()}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.orange}}>${a.toLocaleString()}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:cv<0?C.red:C.textMid}}>${f.toLocaleString()}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:cv<0?C.red:C.green,fontWeight:700}}>{cv<0?"-":"+"} ${Math.abs(cv).toLocaleString()}</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:cv<0?C.red:C.green,fontWeight:700}}>{cv<0?"-":"+"}{Math.abs(cvP)}%</td>
                            <td style={{padding:"5px 9px",borderBottom:`1px solid ${C.border}`,textAlign:"right",color:C.textDim}}>${(f-a).toLocaleString()}</td>
                          </tr>);
                        })}</tbody>
                      </table>
                    </div>

                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                      <div>
                        <SectionTitle icon="🧱">C. Material Consumption</SectionTitle>
                        {[["GRN Value Received","$"+goodsReceipts.reduce((s,g)=>s+(g.quantityReceived*(materialMaster.find(m=>m.code===g.materialCode)?.unitCost||0)),0).toLocaleString(),C.blueL],["Issued to Site","$"+totalIssued.toLocaleString(),C.gold],["Wastage Value","$"+totalWV.toLocaleString(),C.red],["Wastage %",totalIssued>0?((totalWV/totalIssued)*100).toFixed(1)+"%":"0%",totalWV/Math.max(totalIssued,1)>0.05?C.red:C.green]].map(([l,v,c])=>(
                          <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
                            <span style={{fontSize:10,color:C.textMid}}>{l}</span>
                            <span style={{fontSize:10,fontWeight:700,color:c}}>{v}</span>
                          </div>
                        ))}
                      </div>
                      <div>
                        <SectionTitle icon="🧾">D. Client & Sub Payment</SectionTitle>
                        {[["Cumulative IPC Certified","$"+certTotals.cumV.toLocaleString(),C.gold],["This Certificate","$"+certTotals.cv.toLocaleString(),C.blueL],["Retention Held","$"+certTotals.ret.toLocaleString(),C.orange],["Sub Total Certified","$"+subValuations.reduce((s,r)=>s+(r.currCertified||0),0).toLocaleString(),C.textMid],["Sub Back Charges","$"+subValuations.reduce((s,r)=>s+(r.backCharges||0),0).toLocaleString(),C.red],["Payments On Hold","$"+subValuations.filter(r=>r.status==="On Hold").reduce((s,r)=>s+(r.currClaim||0),0).toLocaleString(),C.red]].map(([l,v,c])=>(
                          <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
                            <span style={{fontSize:10,color:C.textMid}}>{l}</span>
                            <span style={{fontSize:10,fontWeight:700,color:c}}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <SectionTitle icon="🏭">E. Stock & Reorder Status</SectionTitle>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
                      {stockBalance.map(s=>{
                        const mat=materialMaster.find(m=>m.code===s.materialCode);
                        return(<div key={s.id} style={{background:s.reorderAlert?"#160A00":C.surface,border:`1px solid ${s.reorderAlert?C.red:C.border}`,borderRadius:8,padding:"8px 12px",minWidth:160}}>
                          <div style={{fontSize:9,color:C.textMid,marginBottom:3,maxWidth:155,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{mat?.name||s.materialCode}</div>
                          <div style={{display:"flex",justifyContent:"space-between"}}>
                            <span style={{fontSize:12,fontWeight:700,color:s.reorderAlert?C.red:C.green}}>{s.available} {s.unit}</span>
                            {s.reorderAlert&&<span style={{fontSize:9,fontWeight:700,color:C.red}}>REORDER</span>}
                          </div>
                        </div>);
                      })}
                    </div>

                    <div style={{display:"flex",gap:8,marginTop:4}}>
                      <button onClick={()=>{
                        const rows2=[["INTEGRATED COST & PROGRESS REPORT"],["Period: "+currentIPCPeriod],["Project: "+(proj.name||"5-Story Commercial Office Building")],[""],["=== EARNED VALUE ==="],["Metric,Value"],["PV,$"+totalPVP],["EV,$"+totalEV],["AC,$"+gA],["SPI,"+spi],["CPI,"+cpi],[""],["=== COST CONTROL ==="],["Trade,Budget,Actual,Forecast EAC,Cost Variance,ETC"],...[...new Set(cc.map(r=>r.trade))].map(t=>{const rs=cc.filter(r=>r.trade===t);const b=rs.reduce((s,r)=>s+r.budgetLabour+r.budgetMaterial+r.budgetEquipment+r.budgetSubcontract+r.budgetIndirect+r.budgetOverhead+r.budgetContingency,0);const a=rs.reduce((s,r)=>s+r.actualLabour+r.actualMaterial+r.actualEquipment+r.actualSubcontract,0);const f=rs.reduce((s,r)=>s+r.forecastLabour+r.forecastMaterial+r.forecastEquipment+r.forecastSubcontract+r.budgetIndirect+r.budgetOverhead+r.budgetContingency,0);return[t+","+b+","+a+","+f+","+(b-f)+","+(f-a)];}),[""],["=== PROGRESS MEASUREMENTS ==="],["BOQ Ref,Description,Unit,Contract Qty,Unit Rate,Plan Qty,Actual Qty,% Complete,EV,PV,SV"],...progressMeasurements.map(p=>p.boqRef+`,"${p.description}",`+p.unit+","+p.contractQty+","+p.unitRate+","+p.plannedQtyToDate+","+p.actualQtyToDate+","+p.percentComplete+","+p.earnedValue+","+(p.plannedQtyToDate*p.unitRate)+","+(p.earnedValue-(p.plannedQtyToDate*p.unitRate))),[""],["=== STOCK STATUS ==="],["Code,Material,On Hand,Reserved,Available,Unit,Reorder Alert"],...stockBalance.map(s=>{const m=materialMaster.find(x=>x.code===s.materialCode);return s.materialCode+`,"${m?.name||""}",`+s.onHand+","+s.reserved+","+s.available+","+s.unit+","+(s.reorderAlert?"YES":"OK");})];
                        const a=document.createElement("a");a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(rows2.join("\n"));a.download=`Integrated_Cost_Report_${currentIPCPeriod.replace(/ /g,"_")}.csv`;a.click();
                      }} style={{padding:"8px 18px",borderRadius:7,border:"none",cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit",background:`linear-gradient(135deg,${C.blue},${C.accent})`,color:"#000D1F"}}>↓ Export Full Report CSV (P6 / Power BI / ERP Ready)</button>
                      <button onClick={()=>{
                        const w=window.open("","_blank");
                        w.document.write(`<html><head><title>Cost Report</title><style>body{font-family:Arial;padding:28px;color:#111}table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:11px}th{background:#0A2A5C;color:#fff;padding:6px 9px;text-align:left}td{border:1px solid #ddd;padding:5px 9px}h2{color:#0A2A5C;border-bottom:3px solid #1E6BFF;padding-bottom:5px}.good{color:#16a34a;font-weight:700}.bad{color:#dc2626;font-weight:700}</style></head><body><h1>Integrated Cost &amp; Progress Report</h1><p><strong>Period:</strong> ${currentIPCPeriod} &nbsp; <strong>Project:</strong> ${proj.name||"5-Story Commercial Office Building"}</p><h2>Earned Value</h2><table><tr><th>Metric</th><th>Value</th></tr><tr><td>Planned Value</td><td>$${totalPVP.toLocaleString()}</td></tr><tr><td>Earned Value</td><td>$${totalEV.toLocaleString()}</td></tr><tr><td>Actual Cost</td><td>$${gA.toLocaleString()}</td></tr><tr><td>SPI</td><td class="${parseFloat(spi)>=1?"good":"bad"}">${spi}</td></tr><tr><td>CPI</td><td class="${parseFloat(cpi)>=1?"good":"bad"}">${cpi}</td></tr></table><h2>Client IPC</h2><table><tr><th>Item</th><th>Value</th></tr><tr><td>Cumulative Certified</td><td>$${certTotals.cumV.toLocaleString()}</td></tr><tr><td>This Certificate</td><td>$${certTotals.cv.toLocaleString()}</td></tr><tr><td>Retention Held</td><td>$${certTotals.ret.toLocaleString()}</td></tr></table><h2>Material Wastage</h2><table><tr><th>Item</th><th>Value</th></tr><tr><td>Total Issued to Site</td><td>$${totalIssued.toLocaleString()}</td></tr><tr><td>Total Wastage</td><td class="${totalWV>5000?"bad":"good"}">$${totalWV.toLocaleString()}</td></tr><tr><td>Wastage Rate</td><td>${totalIssued>0?((totalWV/totalIssued)*100).toFixed(1):0}%</td></tr></table></body></html>`);
                        w.document.close(); w.print();
                      }} style={{padding:"8px 18px",borderRadius:7,border:`1px solid ${C.border2}`,cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit",background:C.surface,color:C.textMid}}>🖨 Print Report</button>
                    </div>
                  </div>);
                })()}

                {tab==="longlead" && (
                  <div>
                    <div style={{background:"#1A0C00",border:"1px solid #92400E44",color:"#FCD34D",borderRadius:7,padding:"8px 12px",fontSize:10,marginBottom:12,display:"flex",gap:7}}><span>⚡</span><span>These items must be procured in advance. Late orders cascade directly to the critical path.</span></div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:9,marginBottom:14}}>
                      {(schedule.longLeadItems||[]).map((ll,i)=>{
                        const [clr,bg]=ll.criticality==="CRITICAL"?[C.red,"#160808"]:ll.criticality==="HIGH"?[C.orange,"#160A00"]:[C.green,"#0A1E14"];
                        return <div key={i} style={{background:bg,border:`1px solid ${clr}33`,borderRadius:9,padding:12}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}>
                            <span style={{color:clr,fontWeight:700,fontSize:10}}>{ll.item}</span>
                            <Tag style={{background:`${clr}22`,color:clr,border:`1px solid ${clr}55`}}>{ll.criticality}</Tag>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,fontSize:9}}>
                            <div><span style={{color:C.textDim}}>Lead Time: </span><span style={{color:C.gold,fontWeight:700}}>{ll.leadWeeks}w</span></div>
                            <div><span style={{color:C.textDim}}>Order By: </span><span style={{color:C.textMid}}>{ll.orderBy}</span></div>
                            <div style={{gridColumn:"span 2"}}><span style={{color:C.textDim}}>Activity: </span><span style={{color:C.textMid}}>{ll.activity}</span></div>
                            {ll.risk&&<div style={{gridColumn:"span 2",color:C.orange,borderTop:`1px solid ${C.border}`,paddingTop:4,marginTop:3}}>⚠ {ll.risk}</div>}
                          </div>
                        </div>;
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!schedule&&!loading&&(
          <div style={{textAlign:"center",padding:"30px 20px",color:C.textDim}}>
            <div style={{fontSize:36,marginBottom:8,opacity:.25}}>⚙</div>
            <div style={{fontSize:12,color:C.textMid,marginBottom:3}}>Ready to generate your schedule</div>
            <div style={{fontSize:10}}>Fill project settings, add BOQ items or upload a file, then click <strong style={{color:C.blueL}}>Generate Schedule</strong></div>
          </div>
        )}
      </div>
    </div>
  );
}
