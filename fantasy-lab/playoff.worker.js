'use strict';
function simulate({teams,weeks,slots,selected,forced={},trials=6000,sd=30}){
 const n=teams.length, ids=teams.map(t=>t.id), divisions=[...new Set(teams.map(t=>t.division))];
 if(n!==12||slots!==8||divisions.length!==2||new Set(ids).size!==n)throw Error('Expected 12 teams, two divisions and eight playoff places.');
 const avg=teams.reduce((s,t)=>s+t.pf,0)/Math.max(1,teams.reduce((s,t)=>s+t.w+t.l+t.t,0));
 const means=teams.map(t=>(t.pf+3*avg)/(t.w+t.l+t.t+3));
 let seed=2166136261;for(const c of JSON.stringify({teams,weeks,forced,sd}))seed=Math.imul(seed^c.charCodeAt(0),16777619);
 const rand=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
 const draw=i=>Math.max(0,means[i]+sd*Math.sqrt(-2*Math.log(Math.max(1e-10,rand())))*Math.cos(2*Math.PI*rand()));
 const counts=teams.map(()=>Array(9).fill(0)), champs=teams.map(()=>0), opponents={}, finalWins=teams.map(()=>0);
 const games=weeks.flatMap(w=>w.pairs.map(p=>({week:w.week,pair:p,key:`${w.week}:${Math.min(...p)}-${Math.max(...p)}`})));
 const paths=teams.map(()=>Array.from({length:weeks.length+1},()=>({total:0,in:0}))), effects=games.map(g=>({...g,outcomes:g.pair.map(id=>({id,total:0,in:ids.map(()=>0)})),ties:0}));
 for(let k=0;k<trials;k++){const outcomes=[];
  const w=teams.map(t=>t.w+t.t/2), pf=teams.map(t=>t.pf);
  for(const week of weeks)for(const pair of week.pairs){const a=ids.indexOf(pair[0]),b=ids.indexOf(pair[1]);let x=draw(a),y=draw(b);const f=forced[`${week.week}:${Math.min(...pair)}-${Math.max(...pair)}`];if(f===ids[a]||f===ids[b]){const homeWins=f===ids[a];const hi=Math.max(x,y),lo=Math.min(x,y);x=homeWins?hi+0.01:lo;y=homeWins?lo:hi+0.01;}outcomes.push(x>y?ids[a]:y>x?ids[b]:null);pf[a]+=x;pf[b]+=y;if(x>y)w[a]++;else if(y>x)w[b]++;else {w[a]+=.5;w[b]+=.5;}}
  for(let i=0;i<n;i++)finalWins[i]+=w[i];
  const rank=(a,b)=>w[b]-w[a]||pf[b]-pf[a]||ids[a]-ids[b];const order=ids.map((_,i)=>i).sort(rank);const leaders=divisions.map(d=>order.find(i=>teams[i].division===d)).sort(rank);const field=leaders.concat(order.filter(i=>!leaders.includes(i))).slice(0,slots);
  for(let i=0;i<n;i++){const s=field.indexOf(i);counts[i][s<0?8:s]++;const added=w[i]-teams[i].w-teams[i].t/2;if(Number.isInteger(added)){const b=paths[i][added];b.total++;if(s>=0)b.in++;}}
  effects.forEach((g,j)=>{const o=g.outcomes.find(o=>o.id===outcomes[j]);if(!o){g.ties++;return;}o.total++;field.forEach(i=>o.in[i]++);});
  const si=field.indexOf(ids.indexOf(selected));if(si>=0){const opp=ids[field[7-si]];opponents[opp]=(opponents[opp]||0)+1;}
  const win=(a,b)=>draw(a)>=draw(b)?a:b;const a=win(field[0],field[7]),b=win(field[3],field[4]),c=win(field[1],field[6]),d=win(field[2],field[5]);champs[win(win(a,b),win(c,d))]++;
 }
 return {trials,rows:teams.map((t,i)=>({id:t.id,mean:means[i],finalWins:finalWins[i]/trials,seeds:counts[i].slice(0,8),out:counts[i][8],champ:champs[i]})),opponents,paths,effects};
}
if(typeof self!=='undefined')self.onmessage=e=>{try{self.postMessage({result:simulate(e.data)});}catch(e){self.postMessage({error:e.message});}};
if(typeof module!=='undefined')module.exports=simulate;
