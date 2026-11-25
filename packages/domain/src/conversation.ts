import { readFileSync } from 'node:fs';
export const programme = JSON.parse(readFileSync(new URL('../../../fixtures/programme.json', import.meta.url), 'utf8'));
export const boundary = "I can help with service information, but I can't assess symptoms or recommend treatment. A programme callback is not emergency care. If you need urgent help, seek local emergency care rather than waiting for a callback.";
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const button = new RegExp(`^cb_(confirm|cancel):(${uuid}):([1-9][0-9]{0,8})$`, 'i');
export function parseButton(text: string) {
 const m = button.exec(text);
 return m ? {intent:m[1].toLowerCase() as 'confirm'|'cancel',actionId:m[2].toLowerCase(),revision:Number(m[3])} : null;
}
export function exactIntent(text: string) {
 const t = text.trim().replace(/[.!?]+$/, '').toLowerCase();
 if (t==='yes'||t==='confirm') return 'confirm';
 if (t==='no'||t==='cancel') return 'cancel';
 return null;
}
export function validSource(source: any, now: Date) {
 const start = Date.parse(source.valid_from), end = Date.parse(source.valid_until);
 return source.status==='published' && Number.isFinite(start) && Number.isFinite(end) && start<end && start<=now.getTime() && now.getTime()<end;
}
export function lookup(area: string, service: string, now: Date) {
 return programme.clinics.filter((c:any)=>c.area.toLowerCase()===area.toLowerCase() && c.services.includes(service) && validSource(c.source,now));
}
export function detectArea(text: string): string | undefined {
 return programme.programme.areas.find((a:string)=>new RegExp(`\\b${a}\\b`,'i').test(text));
}
export function detectService(text: string) {
 if (/maternal|maternity/i.test(text)) return 'maternal_care';
 if (/child|wellness/i.test(text)) return 'child_wellness';
 if (/general|consultation/i.test(text)) return 'general_consultation';
 return undefined;
}
export function navigation(text: string, context: any, now: Date) {
 // This deterministic router is an administrative baseline, not a clinical detector.
 if (/medicine|medication|diagnos|symptom|treatment|dose/i.test(text)) return {body:boundary,context:{}};
 if (/fee|cost|price|insurance/i.test(text)) return {body:"I don't have published fees or insurance information. Would you like to request a telephone callback from a programme officer?",context:{}};
 const service=detectService(text) ?? context.service;
 const area=detectArea(text) ?? context.area;
 if (!service) return {body:'Which listed service do you need: general consultations, child wellness or maternal care?',context:{area}};
 if (!area) return {body:'Which area would you prefer: North, East or West?',context:{service}};
 const matches=lookup(area,service,now);
 return {body:matches.length ? matches.map((c:any)=>`${c.name} lists ${service.replaceAll('_',' ')}. Published hours: ${c.published_hours}. Appointment availability isn't listed.`).join('\n') : "I don't have current published information for that service in that area. You can request a programme officer.",context:{area,service,sources:matches.map((c:any)=>c.source)}};
}
