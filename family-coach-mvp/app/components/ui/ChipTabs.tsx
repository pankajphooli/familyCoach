'use client'
export default function ChipTabs<T extends string>({
  value, options, onChange
}: { value: T, options: { value: T, label: string }[], onChange: (v:T)=>void }){
  return (
    <div className="tabbar">
      {options.map(opt=> (
        <button
          key={String(opt.value)}
          className={`chip ${opt.value===value?'active':''}`}
          onClick={()=>onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
