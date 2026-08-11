import { pool } from "@workspace/db";
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  for(let i=0;i<40;i++){
    const r=await pool.query(`SELECT signals, phase, substance_state FROM stock_stage_verdict WHERE ticker='228340' ORDER BY computed_at DESC LIMIT 1`);
    const s=r.rows[0]?.signals;
    if(s && (s.recentQuarterOpmPct != null)){
      console.log(`✅ 국면=${r.rows[0].phase} 상태=${r.rows[0].substance_state}`);
      console.log(`   최신분기 OPM 수준: ${s.recentQuarterOpmPct?.toFixed(1)}%`);
      console.log(`   최신분기 매출 YoY: ${s.recentQuarterRevGrowthPct?.toFixed(0)}%`);
      break;
    }
    const st=await pool.query(`SELECT status,current_step FROM analyses WHERE id=1220`);
    console.log(`[${i}] ${st.rows[0]?.current_step}`);
    await sleep(15000);
  }
})().catch(e=>console.error(e.message)).finally(()=>pool.end());
