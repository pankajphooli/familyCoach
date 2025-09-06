'use client'
export async function captureError(message: string, e?: any, path?: string, family_id?: string){
  try{
    await fetch('/api/log-error', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ message, stack: e?.stack || String(e||''), path: path || (typeof window!=='undefined'?window.location.pathname:null), family_id })
    })
  }catch{ /* no-op */ }
}
