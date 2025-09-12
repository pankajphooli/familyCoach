'use client'
import React from 'react'

function ymdLocal(d: Date){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}
function nextNDatesFromToday(n:number){
  const s = new Date(); const out:string[]=[]
  for(let i=0;i<n;i++){ const d=new Date(s); d.setDate(s.getDate()+i); out.push(ymdLocal(d)) }
  return out
}
function labelFor(dstr:string){
  const d = new Date(dstr)
  const today = ymdLocal(new Date())
  if(dstr===today) return 'Today'
  return d.toLocaleDateString(undefined, { weekday:'short', day:'2-digit' })
}

export default function DateScroller({
  selected, onSelect, days=7,
}: { selected: string; onSelect: (d:string)=>void; days?: number }) {
  const dates = React.useMemo(()=> nextNDatesFromToday(days), [days])
  return (
    <div className="chips" style={{margin: '6px 0 10px'}}>
      {dates.map(d => (
        <button
          key={d}
          className={`chip ${selected===d?'on':''} ${d===ymdLocal(new Date())?'today':''}`}
          onClick={()=>onSelect(d)}
        >
          {labelFor(d)}
        </button>
      ))}
    </div>
  )
}
